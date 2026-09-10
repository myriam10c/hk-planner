// Verification du JWT utilisateur Supabase Auth pour hostaway-proxy.
// Isole de index.ts pour etre testable : index.ts appelle Deno.serve au
// chargement, ce module non.
//
// Le projet signe en ES256 (cle asymetrique). On verifie donc contre le JWKS,
// jamais contre un secret partage : cote proxy on n'a que des cles publiques,
// une fuite de code ne permet de forger aucun jeton.
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "npm:jose@6.2.12";

declare const Deno: any;

export interface AuthUser {
  sub: string;
  email: string;
}

let _jwks: any = null;
// Chaine brute qui a produit _jwks. Le jeu LOCAL est fige a la construction : sans
// cette memoisation, un isolat deja chaud continuerait d'utiliser l'ancien document
// apres une rotation de cle Supabase (nouveaux jetons refuses, ancienne cle retiree
// toujours acceptee). Le repli reseau, lui, gere la rotation tout seul.
let _jwksRaw: string | null = null;

// SUPABASE_JWKS est injecte par la plateforme et contient le document JWKS
// complet. S'il est absent ou illisible, repli sur l'endpoint public (jose met
// le resultat en cache et gere la rotation par kid).
export function getJwks(): any {
  const raw = Deno.env.get("SUPABASE_JWKS") ?? "";
  if (_jwks && raw === _jwksRaw) return _jwks;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.keys) && parsed.keys.length > 0) {
      _jwks = createLocalJWKSet(parsed);
      _jwksRaw = raw;
      return _jwks;
    }
  } catch (_e) {
    // pas du JSON : on passe au repli reseau
  }
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  _jwks = createRemoteJWKSet(new URL(base + "/auth/v1/.well-known/jwks.json"));
  _jwksRaw = raw;
  return _jwks;
}

// Utilise par les tests, et par un futur rechargement a chaud des cles.
export function resetJwksCache(): void {
  _jwks = null;
  _jwksRaw = null;
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Ne leve jamais, ne journalise jamais le jeton. Retourne null des que quoi que
// ce soit cloche : signature, emetteur, audience, expiration, claims manquants.
export async function verifyUserJwt(token: string | null): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    // Lu DANS le try : hors Edge (tests, outillage) un Deno.env.get sans permission
    // leve, et le contrat de cette fonction est de ne jamais lever.
    const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    // Sans base, l'emetteur attendu degenererait en "/auth/v1" et un jeton portant
    // exactement ce iss serait accepte : on refuse plutot que de degrader.
    if (!base) return null;
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: base + "/auth/v1",
      audience: "authenticated",
      // Allowlist explicite : sans elle, un jeton HS256 signe avec une cle
      // publique connue passerait (confusion d'algorithme).
      algorithms: ["ES256", "RS256"],
      // Petite tolerance d'horloge : sans elle jose applique 0 et la moindre derive
      // entre le serveur Auth et le runtime edge produit des 401 parasites.
      clockTolerance: 5,
      // Un jeton sans exp n'expirerait jamais ; sub et email portent l'identite.
      requiredClaims: ["exp", "sub", "email"],
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    const sub = typeof payload.sub === "string" ? payload.sub : "";
    if (!email || !sub) return null;
    return { sub, email };
  } catch (_e) {
    return null;
  }
}

// Un JWT valide ne donne acces qu'a un membre d'equipe ACTIF portant exactement
// cet email. Un compte Auth orphelin (membre desactive, email retire) n'est
// personne : le proxy repondra 401 comme pour un jeton PIN revoque.
export async function resolveCleanerByEmail(
  sb: any,
  email: string,
): Promise<{ cleaner_id: number; name: string; role: string; color: string } | null> {
  const { data } = await sb.from("cleaners")
    .select("id, name, role, color")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  return { cleaner_id: data.id, name: data.name, role: data.role, color: data.color };
}

// Roles auxquels on peut attacher un compte email. `system` (le compte du CEO
// Agent) en est exclu volontairement : c'est un acteur machine, il ne se
// connecte jamais et ne doit jamais recevoir d'invitation.
export const INVITE_ROLES = new Set(["cleaner", "manager", "maintenance", "subcontractor"]);

export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

// Volontairement permissif sur la partie locale et strict sur la forme : un
// domaine avec un point, pas d'espace, pas de second arobase. Miroir exact de
// la contrainte cleaners_email_format_chk cote base.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmail(email: string): boolean {
  return typeof email === "string" && email.length > 0 && email.length <= 200 && EMAIL_RE.test(email);
}

export function inviteRoleAllowed(role: unknown): boolean {
  return typeof role === "string" && INVITE_ROLES.has(role);
}

// ===========================================================================
// Session courante
// ===========================================================================

export interface SessionUser {
  cleaner_id: number;
  name: string;
  role: string;
  color: string;
}

// Valide un X-Cleaner-Token (session PIN heritee) et rend le membre, ou null si
// le jeton manque, est inconnu ou est revoque. Ne leve pas sur erreur RPC.
export async function validateCleanerToken(
  sb: any,
  token: string | null,
): Promise<SessionUser | null> {
  if (!token) return null;
  const { data, error } = await sb.rpc("validate_cleaner_session", { p_token: token });
  if (error || !data || data.length === 0) return null;
  return data[0];
}

// Session courante, deux credentials acceptes pendant toute la transition :
//   - Authorization: Bearer <JWT Supabase Auth>  (comptes email, cible)
//   - X-Cleaner-Token: <jeton de session PIN>    (heritage, deverrouillage rapide)
// Le Bearer est prioritaire : si un JWT est present et valide mais ne correspond
// a aucun membre actif, on refuse sans retomber sur le PIN, sinon un compte Auth
// desactive pourrait continuer a agir via un vieux jeton PIN du meme appareil.
// Vit ici et non dans index.ts pour etre testable : index.ts appelle Deno.serve
// au chargement (revue T3, constats 4 et 5).
export async function currentUser(sb: any, req: Request): Promise<SessionUser | null> {
  const token = bearerToken(req);
  if (token) {
    const user = await verifyUserJwt(token);
    if (!user) {
      console.log("[hostaway-proxy] Bearer invalide ou expire");
      return null;
    }
    const me = await resolveCleanerByEmail(sb, user.email);
    if (!me) console.log("[hostaway-proxy] JWT valide sans membre actif correspondant");
    return me;
  }
  const pinToken = req.headers.get("x-cleaner-token");
  return await validateCleanerToken(sb, pinToken);
}

// ===========================================================================
// Plan d'invitation (logique pure, testable sans Supabase)
// ===========================================================================

export interface InviteInput {
  kind: "ok";
  email: string;
  name: string;
  role: string;
  // Distingue « role absent du corps » (on ne touche pas a la ligne existante)
  // de « role explicitement demande ».
  roleProvided: boolean;
  // undefined = ne pas toucher a la colonne.
  phone: string | null | undefined;
  color: string | undefined;
}

export type InviteError = { kind: "error"; status: number; error: string };
export type InviteParse = InviteInput | InviteError;

// Valide le corps AVANT toute lecture en base : une adresse invalide ou un role
// interdit ne doit pas couter une requete Postgres, et le 400 doit primer sur un
// eventuel 404 d'identifiant inconnu.
export function parseInviteInput(body: any): InviteParse {
  if (!body || typeof body !== "object") {
    return { kind: "error", status: 400, error: "invalid json body" };
  }
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return { kind: "error", status: 400, error: "a valid email is required" };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const roleProvided = body.role !== undefined && body.role !== null;
  const role = roleProvided ? body.role : "cleaner";
  if (!inviteRoleAllowed(role)) {
    return { kind: "error", status: 400, error: "role must be one of " + [...INVITE_ROLES].join(", ") };
  }
  const phone = typeof body.phone === "string" ? (body.phone.trim() || null) : undefined;
  const color = typeof body.color === "string" && body.color ? body.color : undefined;
  return { kind: "ok", email, name, role, roleProvided, phone, color };
}

export type InvitePlan =
  | InviteError
  | { kind: "insert"; row: Record<string, unknown> }
  | {
    kind: "update";
    id: number;
    patch: Record<string, unknown>;
    // Adresse portee par la ligne avant ce changement, quand elle differe de la
    // nouvelle : son compte Auth doit etre supprime AVANT l'ecriture, sinon
    // l'ancien titulaire garde un acces que le manager croit avoir coupe
    // (revue T5, constat 1).
    previousEmail: string | null;
    // Etat d'avant, pour le rollback si l'appel Auth echoue.
    restore: { email: string | null; is_active: boolean };
  };

// `target` est la ligne cleaners resolue par l'appelant (par id, sinon par
// email), `requestedId` l'identifiant demande dans le corps, `holderId` l'id de
// la ligne qui porte deja cette adresse (null si aucune).
export function planInvite(
  input: InviteInput,
  requestedId: unknown,
  target: any | null,
  holderId: number | null,
): InvitePlan {
  if (requestedId && !target) {
    return { kind: "error", status: 404, error: "team member not found" };
  }
  // La ligne machine (le compte du CEO Agent) ne se connecte jamais. Le controle
  // est pose apres la resolution, donc il couvre aussi la branche par email
  // (revue T5, constat 3).
  if (target && target.role === "system") {
    return { kind: "error", status: 400, error: "this account cannot be invited" };
  }
  if (holderId !== null && (!target || Number(holderId) !== Number(target.id))) {
    return { kind: "error", status: 409, error: "another team member already uses this email" };
  }
  if (target) {
    // is_active : inviter une ligne desactivee la reactive, sinon le compte Auth
    // cree serait inutilisable (revue T5, constat 2).
    const patch: Record<string, unknown> = { email: input.email, is_active: true };
    if (input.name) patch.name = input.name;
    if (input.roleProvided) patch.role = input.role;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.color !== undefined) patch.color = input.color;
    const before = normalizeEmail(target.email);
    return {
      kind: "update",
      id: Number(target.id),
      patch,
      previousEmail: before && before !== input.email ? before : null,
      restore: { email: before || null, is_active: target.is_active !== false },
    };
  }
  if (!input.name) return { kind: "error", status: 400, error: "name required" };
  return {
    kind: "insert",
    row: {
      name: input.name,
      email: input.email,
      role: input.role,
      phone: input.phone ?? null,
      color: input.color ?? "#e94560",
      is_active: true,
    },
  };
}

// Rollback de l'ecriture cleaners quand l'appel a l'Admin API echoue apres elle
// (revue T5, constat 5). Une ligne creee dans cette requete est supprimee, une
// ligne existante retrouve son adresse et son etat d'activation.
export function planInviteRollback(
  plan: InvitePlan,
  cleanerId: number,
): { op: "delete"; id: number } | { op: "restore"; id: number; patch: Record<string, unknown> } | null {
  if (plan.kind === "insert") return { op: "delete", id: cleanerId };
  if (plan.kind === "update") return { op: "restore", id: plan.id, patch: { ...plan.restore } };
  return null;
}

// Course entre deux invitations de la meme adresse : le pre-controle en SELECT
// laisse passer la seconde, c'est l'index unique cleaners_email_unique_idx qui
// tranche et Postgres rend 23505. Seul index unique de la table hors cle
// primaire, que cette route ne renseigne jamais : un 23505 sur cleaners est donc
// toujours un conflit d'email (revue T5, constat 4).
export function isEmailUniqueViolation(error: unknown): boolean {
  return !!error && String((error as any).code ?? "") === "23505";
}

// La ligne `system` n'est ni modifiable ni invitable, et aucun role ne bascule
// vers ou depuis `system` : sans ce garde, deux clics de manager suffisent a
// passer cette ligne en `manager` puis a l'inviter (revue T7, constat 5).
export function systemRowError(currentRole: unknown, nextRole: unknown): string | null {
  if (currentRole === "system") return "this account cannot be modified";
  if (nextRole === "system") return "invalid role";
  return null;
}
