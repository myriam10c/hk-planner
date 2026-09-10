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
    // Etat d'avant des colonnes que `patch` touche, pour le rollback si la suite
    // echoue. Meme jeu de cles que `patch` : restaurer moins laisserait un
    // changement de nom, de role, de telephone ou de couleur applique alors que
    // l'appelant recoit une erreur (revue 8a, constat 1).
    restore: Record<string, unknown>;
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
    const before = normalizeEmail(target.email);
    const patch: Record<string, unknown> = { email: input.email, is_active: true };
    const restore: Record<string, unknown> = {
      email: before || null,
      is_active: target.is_active !== false,
    };
    // Une colonne absente de la ligne lue (jamais le cas en production, ou le
    // select les ramene toutes) ne serait pas restaurable : on ne l'inscrit pas
    // dans le restore plutot que d'y ecrire undefined.
    const touche = (col: string, valeur: unknown, avant: unknown) => {
      patch[col] = valeur;
      if (avant !== undefined) restore[col] = avant;
    };
    if (input.name) touche("name", input.name, target.name);
    if (input.roleProvided) touche("role", input.role, target.role);
    if (input.phone !== undefined) touche("phone", input.phone, target.phone);
    if (input.color !== undefined) touche("color", input.color, target.color);
    return {
      kind: "update",
      id: Number(target.id),
      patch,
      previousEmail: before && before !== input.email ? before : null,
      restore,
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

// Rollback de l'ecriture cleaners quand la suite echoue (revue T5, constat 5).
// Une ligne creee dans cette requete est supprimee, une ligne existante retrouve
// l'etat d'avant de chacune des colonnes que l'ecriture avait touchees.
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

// ===========================================================================
// Execution de l'invitation (sequence des ecritures)
// ===========================================================================

// L'admin API n'expose pas de recherche par email. L'equipe tient tres largement
// sur une page, on liste et on filtre. Ne journalise jamais la liste.
export async function findAuthUserByEmail(sb: any, email: string): Promise<any | null> {
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const users = (data?.users ?? []) as any[];
  return users.find((u) => String(u.email ?? "").toLowerCase() === email) ?? null;
}

// Defait l'ecriture cleaners. Ne leve jamais : l'appelant est deja sur un chemin
// d'erreur. Observe en revanche l'erreur rendue par postgrest-js, qui ne leve pas
// non plus : sans ca, un rollback refuse par la base ne laissait aucune trace
// (revue 8a, constat 2).
export async function rollbackInvite(sb: any, plan: InvitePlan, cleanerId: number): Promise<void> {
  const undo = planInviteRollback(plan, cleanerId);
  if (!undo) return;
  try {
    const { error } = undo.op === "delete"
      ? await sb.from("cleaners").delete().eq("id", undo.id)
      : await sb.from("cleaners").update(undo.patch).eq("id", undo.id);
    if (error) {
      console.warn("[inviteCleaner] rollback refuse: " + String((error as any).message ?? error));
    }
  } catch (e) {
    console.warn("[inviteCleaner] rollback impossible: " + String(e));
  }
}

export interface InviteResult {
  status: number;
  body: Record<string, unknown>;
}

const EMAIL_CONFLICT: InviteResult = {
  status: 409,
  body: { error: "This email is already used by another team member" },
};

// Sequence des ecritures, et rollback qui en decoule :
//   1. l'ecriture cleaners d'abord. C'est la seule qui peut lever un 23505, et un
//      « This email is already used » doit vouloir dire que rien n'a bouge, ni
//      ici ni cote Auth (revue 8a, constat 3) ;
//   2. la destruction de l'ancien compte Auth ensuite, quand l'adresse de la
//      ligne change : sans elle l'ancien titulaire garde un acces que le manager
//      croit avoir coupe (revue T5, constat 1). Si elle echoue, on defait
//      l'ecriture et on refuse en 409, donc rien ne bouge nulle part ;
//   3. l'appel qui cree le compte et envoie l'email en dernier : le faire avant
//      une ecriture faillible enverrait un lien vers un compte a detruire. S'il
//      echoue, l'ecriture cleaners est defaite (revue T5, constat 5).
// Le seul etat residuel assume : au point 3, si l'adresse avait change, l'ancien
// compte Auth est deja detruit et ne revient pas.
export async function applyInvite(
  sb: any,
  plan: InvitePlan,
  email: string,
  redirectTo: string,
): Promise<InviteResult> {
  if (plan.kind === "error") return { status: plan.status, body: { error: plan.error } };

  let cleanerId: number;
  if (plan.kind === "update") {
    const { error } = await sb.from("cleaners").update(plan.patch).eq("id", plan.id);
    if (isEmailUniqueViolation(error)) return EMAIL_CONFLICT;
    if (error) throw error;
    cleanerId = plan.id;
  } else {
    const { data: inserted, error } = await sb.from("cleaners").insert(plan.row).select("id").single();
    if (isEmailUniqueViolation(error)) return EMAIL_CONFLICT;
    if (error) throw error;
    cleanerId = Number(inserted.id);
  }

  if (plan.kind === "update" && plan.previousEmail) {
    try {
      const previous = await findAuthUserByEmail(sb, plan.previousEmail);
      if (previous) {
        const { error } = await sb.auth.admin.deleteUser(previous.id);
        if (error) throw error;
      }
    } catch (e) {
      console.warn("[inviteCleaner] ancien compte Auth non supprime: " + String(e));
      await rollbackInvite(sb, plan, cleanerId);
      return { status: 409, body: { error: "Could not replace the previous account" } };
    }
  }

  // Si un compte porte deja cette adresse, une seconde invitation echouerait : on
  // envoie une reinitialisation, ce que le manager veut dans les deux cas
  // (« renvoie-lui son lien »).
  const existing = await findAuthUserByEmail(sb, email);
  const authError = existing
    ? (await sb.auth.resetPasswordForEmail(email, { redirectTo })).error
    : (await sb.auth.admin.inviteUserByEmail(email, { redirectTo })).error;
  if (authError) {
    await rollbackInvite(sb, plan, cleanerId);
    // Le libelle amont (limites de debit GoTrue et consorts) reste dans les
    // journaux, le client ne recoit qu'un message stable.
    console.warn("[inviteCleaner] echec de l'envoi Auth: " + String(authError.message ?? authError));
    return {
      status: 502,
      body: { error: existing ? "Could not send the reset email" : "Could not send the invitation" },
    };
  }
  console.log("[inviteCleaner] " + (existing ? "reset" : "invitation") +
    " envoye pour cleaner " + String(cleanerId));
  return { status: 200, body: { status: "success", id: cleanerId, mode: existing ? "reset" : "invite" } };
}

// Garde `system` de saveCleaner. Une garde de securite echoue FERMEE : si la
// lecture du role ne repond pas, on refuse au lieu de laisser passer (revue 8a,
// constat 4).
export async function systemRowGuard(
  sb: any,
  id: unknown,
  nextRole: unknown,
): Promise<{ status: number; error: string } | null> {
  const { data, error } = await sb.from("cleaners").select("role").eq("id", id).maybeSingle();
  if (error) {
    console.warn("[saveCleaner] lecture du role impossible: " + String((error as any).message ?? error));
    return { status: 500, error: "Could not verify the member" };
  }
  const message = systemRowError(data?.role, nextRole);
  return message ? { status: 400, error: message } : null;
}
