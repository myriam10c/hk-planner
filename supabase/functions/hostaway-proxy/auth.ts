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
