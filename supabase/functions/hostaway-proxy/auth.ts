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

// Ligne cleaners portant exactement cet email, ACTIVE OU NON. Le filtre
// is_active vivait ici ; il est remonte dans cleanerMeReason, sinon « membre
// desactive » et « aucun membre » restent indistinguables et le front envoie
// l'utilisateur vers un manager qui ne peut rien faire (revue finale, constat 4).
// Un JWT valide ne donne toujours acces qu'a un membre ACTIF : c'est
// currentUserDetailed qui refuse, exactement comme avant.
export interface CleanerRow {
  id: number;
  name: string;
  role: string;
  color: string;
  is_active?: boolean;
}

export async function lookupCleanerByEmail(sb: any, email: string): Promise<CleanerRow | null> {
  // cleaners_email_unique_idx garantit au plus une ligne par adresse :
  // maybeSingle ne peut pas tomber sur un doublon.
  const { data } = await sb.from("cleaners")
    .select("id, name, role, color, is_active")
    .eq("email", email)
    .maybeSingle();
  return data ?? null;
}

// Roles auxquels on peut attacher un compte email. `system` (le compte du CEO
// Agent) en est exclu volontairement : c'est un acteur machine, il ne se
// connecte jamais et ne doit jamais recevoir d'invitation.
export const INVITE_ROLES = new Set(["cleaner", "manager", "maintenance", "subcontractor"]);

// Libelles d'erreur rendus au client. Le front les affiche TELS QUELS dans un
// toast : une seule chaine par cas, en anglais de produit, en casse de phrase
// (revue finale, constat 2). A garder aligne sur INVITE_ROLES ci-dessus.
export const INVITE_ROLE_ERROR = "Role must be cleaner, manager, maintenance or subcontractor.";
// Les deux chemins du 409 (pre-controle en SELECT et index unique) disent la
// meme chose a l'equipe.
export const EMAIL_CONFLICT_MESSAGE = "This email is already used by another team member.";

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
  return (await currentUserDetailed(sb, req)).user;
}

// Pourquoi il n'y a pas de session. Rendu par l'action cleanerMe pour que le
// front sache quoi dire : une session expiree, un compte desactive et un compte
// jamais rattache appellent trois messages differents (revue finale, constat 4).
export type CleanerMeReason = "no_session" | "invalid_token" | "inactive" | "unlinked";

export interface SessionLookup {
  user: SessionUser | null;
  reason: CleanerMeReason | null;
}

// Logique pure, testable sans Supabase : elle ne fait que nommer l'echec.
//   hasCredential   : un Bearer ou un X-Cleaner-Token a ete presente
//   credentialValid : ce credential a ete accepte (JWT verifie, session PIN vivante)
//   memberFound     : une ligne cleaners porte cette identite
//   memberActive    : cette ligne est active
export function cleanerMeReason(state: {
  hasCredential: boolean;
  credentialValid: boolean;
  memberFound: boolean;
  memberActive: boolean;
}): CleanerMeReason | null {
  if (!state.hasCredential) return "no_session";
  if (!state.credentialValid) return "invalid_token";
  if (!state.memberFound) return "unlinked";
  if (!state.memberActive) return "inactive";
  return null;
}

// Meme decision que currentUser, avec la raison de l'echec en plus. Toute la
// logique vit ici ; currentUser n'en garde que l'utilisateur.
export async function currentUserDetailed(sb: any, req: Request): Promise<SessionLookup> {
  const token = bearerToken(req);
  if (token) {
    const user = await verifyUserJwt(token);
    if (!user) {
      console.log("[hostaway-proxy] Bearer invalide ou expire");
      return { user: null, reason: "invalid_token" };
    }
    const row = await lookupCleanerByEmail(sb, user.email);
    // is_active absent de la ligne (colonne non lue) = actif : on ne ferme
    // jamais un acces sur une colonne manquante, seulement sur un false explicite.
    const reason = cleanerMeReason({
      hasCredential: true,
      credentialValid: true,
      memberFound: !!row,
      memberActive: !!row && row.is_active !== false,
    });
    if (reason || !row) {
      console.log("[hostaway-proxy] JWT valide sans membre actif correspondant (" + reason + ")");
      return { user: null, reason };
    }
    return {
      user: { cleaner_id: row.id, name: row.name, role: row.role, color: row.color },
      reason: null,
    };
  }
  const pinToken = req.headers.get("x-cleaner-token");
  if (!pinToken) return { user: null, reason: "no_session" };
  const me = await validateCleanerToken(sb, pinToken);
  // Un jeton PIN inconnu ou revoque est un identifiant presente et refuse :
  // meme raison qu'un Bearer refuse, le front y repond « Sign in again ».
  return me ? { user: me, reason: null } : { user: null, reason: "invalid_token" };
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
    return { kind: "error", status: 400, error: "A valid email address is required." };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const roleProvided = body.role !== undefined && body.role !== null;
  const role = roleProvided ? body.role : "cleaner";
  if (!inviteRoleAllowed(role)) {
    return { kind: "error", status: 400, error: INVITE_ROLE_ERROR };
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
    return { kind: "error", status: 404, error: "Team member not found." };
  }
  // La ligne machine (le compte du CEO Agent) ne se connecte jamais. Le controle
  // est pose apres la resolution, donc il couvre aussi la branche par email
  // (revue T5, constat 3).
  if (target && target.role === "system") {
    return { kind: "error", status: 400, error: "This account cannot be invited." };
  }
  if (holderId !== null && (!target || Number(holderId) !== Number(target.id))) {
    return { kind: "error", status: 409, error: EMAIL_CONFLICT_MESSAGE };
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
  if (currentRole === "system") return "This account cannot be modified.";
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
  body: { error: EMAIL_CONFLICT_MESSAGE },
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
      return { status: 409, body: { error: "Could not replace the previous account." } };
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
    // Le libelle amont (limites de debit GoTrue et consorts) reste dans les
    // journaux, le client ne recoit qu'un message stable.
    console.warn("[inviteCleaner] echec de l'envoi Auth: " + String(authError.message ?? authError));
    // Incident du 11/09 : deux POST inviteCleaner a 241 ms d'ecart sur la meme
    // ligne. Le premier a cree le compte Auth, le second a trouve l'adresse
    // libre a sa lecture puis s'est heurte a l'unicite de auth.users
    // (« Database error saving new user ») et a ROLLBACK la colonne email, donc
    // efface le lien que le gagnant venait de poser. On relit donc les comptes
    // avant de defaire quoi que ce soit : si le compte existe maintenant, la
    // ligne est correctement reliee et le rollback ferait le degat.
    if (!existing) {
      let cree: any = null;
      try {
        cree = await findAuthUserByEmail(sb, email);
      } catch (_e) {
        cree = null;
      }
      if (cree) {
        console.warn("[inviteCleaner] compte deja cree par une requete concurrente, rien n'est defait");
        return { status: 200, body: { status: "success", id: cleanerId, mode: "invite" } };
      }
    }
    await rollbackInvite(sb, plan, cleanerId);
    return {
      status: 502,
      body: { error: existing ? "Could not send the reset email." : "Could not send the invitation." },
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
    return { status: 500, error: "Could not verify the member." };
  }
  const message = systemRowError(data?.role, nextRole);
  return message ? { status: 400, error: message } : null;
}

// ===========================================================================
// saveCleaner : le patch de mise a jour
// ===========================================================================

// Fonction pure, exportee pour une seule raison : verrouiller par un test que la
// colonne `email` n'entre JAMAIS dans ce patch. saveCleaner sert l'ecran Team
// (nom, telephone, couleur, role, chat Telegram, PIN) ; l'adresse de connexion
// ne se pose que par inviteCleaner ou linkEmail. Un patch qui la porterait
// effacerait le compte d'un membre des qu'un manager corrige son nom.
export function saveCleanerUpdatePatch(input: {
  name: string;
  phone?: unknown;
  color?: unknown;
  role?: unknown;
  telegramChatId?: string | null | undefined;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: input.name,
    phone: input.phone || null,
    color: input.color || "#e94560",
  };
  if (input.role !== undefined) patch.role = input.role;
  if (input.telegramChatId !== undefined) patch.telegram_chat_id = input.telegramChatId;
  return patch;
}

// ===========================================================================
// linkEmail : un membre cree lui-meme son compte, prouve par son PIN
// ===========================================================================

// Libelles rendus TELS QUELS par le front, en anglais de produit.
export const LINK_EMAIL_ROLE_ERROR = "This account cannot have a password.";
export const LINK_EMAIL_OTHER_ADDRESS =
  "Your profile already uses another email address. Ask a manager to change it.";
export const LINK_PASSWORD_TOO_SHORT = "Password too short. Use at least 8 characters.";

export interface LinkEmailInput {
  kind: "ok";
  email: string;
  password: string;
}
export type LinkEmailParse = LinkEmailInput | InviteError;

// Le corps ne porte QUE l'adresse et le mot de passe : l'identite vient de la
// session, jamais du client, sinon n'importe quel PIN relierait n'importe qui.
// Le mot de passe n'est ni journalise ni renvoye, ici comme ailleurs.
export function parseLinkEmailInput(body: any): LinkEmailParse {
  if (!body || typeof body !== "object") {
    return { kind: "error", status: 400, error: "invalid json body" };
  }
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return { kind: "error", status: 400, error: "A valid email address is required." };
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) {
    return { kind: "error", status: 400, error: LINK_PASSWORD_TOO_SHORT };
  }
  return { kind: "ok", email, password };
}

// Sequence des ecritures, et pourquoi il n'y a AUCUN rollback :
//   1. ma ligne doit etre libre, ou porter deja exactement cette adresse (rejeu) ;
//   2. personne d'autre ne doit porter cette adresse, active ou non : l'index
//      unique cleaners_email_unique_idx ne filtre pas sur is_active, et reposer
//      le mot de passe d'un compte encore attache a quelqu'un serait une prise
//      de controle ;
//   3. le compte Auth, cree ou repris, AVANT l'ecriture cleaners ;
//   4. le lien en dernier. Un echec laisse au pire un compte Auth pret et non
//      relie, que le rejeu relie : l'action est idempotente. Defaire l'ecriture
//      cleaners sur un echec en aval est exactement ce qui a delie un membre le
//      11/09 (voir applyInvite), on ne le refait pas ici.
export async function applyLinkEmail(
  sb: any,
  me: SessionUser,
  input: LinkEmailInput,
): Promise<InviteResult> {
  // La ligne machine (le compte du CEO Agent) ne se connecte jamais.
  if (!INVITE_ROLES.has(me.role)) {
    return { status: 403, body: { error: LINK_EMAIL_ROLE_ERROR } };
  }

  const { data: mine, error: mineErr } = await sb.from("cleaners")
    .select("id, email").eq("id", me.cleaner_id).maybeSingle();
  if (mineErr) throw mineErr;
  const current = normalizeEmail(mine?.email);
  if (current && current !== input.email) {
    return { status: 409, body: { error: LINK_EMAIL_OTHER_ADDRESS } };
  }

  const { data: holder, error: holderErr } = await sb.from("cleaners")
    .select("id").eq("email", input.email).maybeSingle();
  if (holderErr) throw holderErr;
  if (holder && Number(holder.id) !== Number(me.cleaner_id)) {
    return { status: 409, body: { error: EMAIL_CONFLICT_MESSAGE } };
  }

  let existing: any = null;
  try {
    existing = await findAuthUserByEmail(sb, input.email);
  } catch (e) {
    console.warn("[linkEmail] lecture des comptes Auth impossible: " + String(e));
    return { status: 502, body: { error: "Could not reach the accounts service." } };
  }
  if (existing) {
    // Cas d'une invitation restee en plan : le compte existe deja, la personne
    // en reprend la main avec le mot de passe qu'elle vient de choisir.
    const { error } = await sb.auth.admin.updateUserById(existing.id, {
      password: input.password,
      email_confirm: true,
    });
    if (error) {
      console.warn("[linkEmail] mot de passe non pose: " + String((error as any).message ?? error));
      return { status: 502, body: { error: "Could not set your password." } };
    }
  } else {
    const { error } = await sb.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (error) {
      console.warn("[linkEmail] compte non cree: " + String((error as any).message ?? error));
      return { status: 502, body: { error: "Could not create your account." } };
    }
  }

  const { error: linkErr } = await sb.from("cleaners")
    .update({ email: input.email }).eq("id", me.cleaner_id);
  if (isEmailUniqueViolation(linkErr)) {
    return { status: 409, body: { error: EMAIL_CONFLICT_MESSAGE } };
  }
  if (linkErr) throw linkErr;
  console.log("[linkEmail] compte relie au membre " + String(me.cleaner_id));
  return { status: 200, body: { status: "success" } };
}
