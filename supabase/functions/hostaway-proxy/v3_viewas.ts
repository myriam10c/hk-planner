// Mode « View as » de v3.myDay : un manager regarde la journee d'une cleaner,
// en lecture seule (demande de Hillal du 2026-10-02 : « faire une simulation de
// ce que voit un cleaner »).
//
// Sorti d'index.ts pour etre testable sans Deno.serve, et de v3.ts pour garder
// chaque module sous 400 lignes. Regles (plan 2026-10-02, Global Constraints) :
//   - echoue fermee : `as` envoye par un non-manager rend 403, avant toute
//     lecture de la cible ;
//   - cible non numerique, inexistante, inactive, ou d'un role autre que
//     cleaner/subcontractor : 400 « unknown team member » ;
//   - `as` egal a soi-meme : journee normale ;
//   - la liste `team` ne porte que id, name, role (jamais email, telephone,
//     pin_hash, telegram_chat_id).
// Aucune ecriture n'est ouverte ici : V3_ROLES (v3.ts) garde les ecritures
// fermees a un manager, quel que soit l'ecran qu'il regarde.
import { donneesOuLeve } from "./v3.ts";
import type { SessionUser } from "./v3.ts";

// Les seuls roles dont un manager peut ouvrir la journee : ceux qui font les
// menages. Un technicien ou un autre manager n'a pas de journee Today a montrer.
export const V3_VIEWAS_ROLES = ["cleaner", "subcontractor"];

export interface TeamMember {
  id: number;
  name: string;
  role: string;
}

export type ViewAsResult =
  // subject : la personne dont on construit la journee ; viewer : le manager
  // qui regarde, ou null pour une journee normale.
  | { ok: true; subject: SessionUser; viewer: SessionUser | null }
  | { ok: false; status: number; error: string };

const INCONNU: ViewAsResult = { ok: false, status: 400, error: "unknown team member" };

export async function resolveViewAs(
  sb: any,
  me: SessionUser,
  asRaw: string | null,
): Promise<ViewAsResult> {
  if (asRaw === null || asRaw === "") return { ok: true, subject: me, viewer: null };
  // Le role d'abord, la forme ensuite : un non-manager prend 403 quelle que soit
  // la valeur, et la cible n'est jamais lue pour lui.
  if (me.role !== "manager") return { ok: false, status: 403, error: "forbidden" };
  if (!/^\d{1,9}$/.test(asRaw)) return INCONNU;
  const id = Number(asRaw);
  if (id === Number(me.cleaner_id)) return { ok: true, subject: me, viewer: null };
  const { data, error } = await sb.from("cleaners")
    .select("id, name, role, color, is_active").eq("id", id).maybeSingle();
  // Une panne de lecture leve (500 avec error_id) : la confondre avec une cible
  // inconnue dirait au manager que la cleaner n'existe plus.
  if (error) throw new Error("v3.myDay: lecture cleaners impossible: " + String(error?.message ?? error));
  if (!data || data.is_active !== true || V3_VIEWAS_ROLES.indexOf(String(data.role)) === -1) {
    return INCONNU;
  }
  return {
    ok: true,
    subject: {
      cleaner_id: Number(data.id),
      name: String(data.name ?? ""),
      role: String(data.role),
      color: String(data.color ?? ""),
    },
    viewer: me,
  };
}

// Les membres dont un manager peut ouvrir la journee, pour le selecteur de
// Profile. Trie par nom ici aussi : l'ordre ne depend pas de la base.
export async function loadTeam(sb: any): Promise<TeamMember[]> {
  const rows = donneesOuLeve<any>(
    await sb.from("cleaners").select("id, name, role")
      .eq("is_active", true).in("role", V3_VIEWAS_ROLES).order("name"),
    "cleaners (equipe)",
  );
  return rows
    .map((r: any) => ({ id: Number(r.id), name: String(r.name ?? ""), role: String(r.role) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
