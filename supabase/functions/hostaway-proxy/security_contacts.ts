// Onglet Security : contacts concierge / securite des immeubles (2026-10-09).
//
// Avant : security-contacts.json servi en clair par Netlify, lisible par
// n'importe qui sans session (158 immeubles, noms, telephones, emails). Le
// document vit maintenant dans public.security_contacts_doc (une ligne, id = 1).
//   - getSecurityContacts (GET) : session d'equipe reelle obligatoire (Bearer ou
//     X-Cleaner-Token resolus vers un membre actif). Le X-App-Secret seul, qui
//     voyage dans le bundle JS public, ne suffit jamais.
//   - setSecurityContacts (POST) : server-only, X-Server-Secret (Tier A,
//     SERVER_ONLY_ACTIONS d'index.ts), appele par le job VPS
//     scheduled/hk_security_contacts.py toutes les 5 minutes.
// Sorti d'index.ts pour etre testable : index.ts appelle Deno.serve au chargement.
import { currentUser } from "./auth.ts";
import type { SessionUser } from "./auth.ts";

export const SECURITY_CONTACTS_TABLE = "security_contacts_doc";
export const SECURITY_CONTACTS_ROLES = ["manager", "cleaner", "maintenance", "subcontractor"];

export interface ActionResult {
  status: number;
  body: Record<string, unknown>;
}

// Egalite de contenu independante de l'ordre des cles : jsonb ne conserve pas
// l'ordre des cles d'un objet, une comparaison de JSON.stringify brut dirait
// « change » a chaque passage du job.
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonical((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function sameDoc(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function isValidDoc(data: unknown): data is { buildings: unknown[] } {
  return !!data && typeof data === "object" && !Array.isArray(data) &&
    Array.isArray((data as Record<string, unknown>).buildings);
}

export async function getSecurityContacts(
  sb: any,
  req: Request,
  resolveUser: (sb: any, req: Request) => Promise<SessionUser | null> = currentUser,
): Promise<ActionResult> {
  const me = await resolveUser(sb, req);
  if (!me) return { status: 401, body: { error: "session required" } };
  if (SECURITY_CONTACTS_ROLES.indexOf(String(me.role)) === -1) {
    return { status: 403, body: { error: "forbidden" } };
  }
  const { data, error } = await sb.from(SECURITY_CONTACTS_TABLE)
    .select("data, updated_at").eq("id", 1).maybeSingle();
  if (error) throw new Error("getSecurityContacts: lecture impossible: " + String(error?.message ?? error));
  if (!data || !data.data) return { status: 404, body: { error: "No security contacts published yet." } };
  // Meme forme que l'ancien security-contacts.json, plus updatedAt.
  return { status: 200, body: { ...data.data, updatedAt: data.updated_at } };
}

// Defense en profondeur : index.ts refuse deja l'action sans X-Server-Secret
// (SERVER_ONLY_ACTIONS), on reverifie ici pour qu'un cablage casse ne laisse
// jamais ecrire avec le seul X-App-Secret.
export function hasServerSecret(req: Request, serverSecret: string): boolean {
  return serverSecret !== "" && (req.headers.get("x-server-secret") ?? "") === serverSecret;
}

export async function setSecurityContacts(
  sb: any,
  req: Request,
  body: any,
  serverSecret: string,
): Promise<ActionResult> {
  if (!hasServerSecret(req, serverSecret)) return { status: 403, body: { error: "server auth required" } };
  const data = body && typeof body === "object" ? body.data : undefined;
  if (!isValidDoc(data)) return { status: 400, body: { error: "body.data must be an object with a buildings array" } };
  const { data: row, error: readErr } = await sb.from(SECURITY_CONTACTS_TABLE)
    .select("data").eq("id", 1).maybeSingle();
  if (readErr) throw new Error("setSecurityContacts: lecture impossible: " + String(readErr?.message ?? readErr));
  const changed = !row || !sameDoc(row.data, data);
  if (changed) {
    const { error } = await sb.from(SECURITY_CONTACTS_TABLE)
      .upsert({ id: 1, data, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw new Error("setSecurityContacts: ecriture impossible: " + String(error?.message ?? error));
  }
  return { status: 200, body: { status: "success", changed } };
}
