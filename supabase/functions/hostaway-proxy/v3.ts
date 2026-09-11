// Actions v3 (ecrans cleaner) du proxy HK Planner.
// Isole d'index.ts pour etre testable : index.ts appelle Deno.serve au chargement,
// ce module non. index.ts ne garde que les lectures d'entree et le dispatch.
//
// Regles de la specification 2026-09-11 implementees ici :
//   - identite depuis la session, jamais depuis le corps (ruling 6) ;
//   - toute ecriture porte une cle d'idempotence (ruling 7) ;
//   - jamais de nom de guest complet cote cleaner (ruling 9).
import type { SessionUser } from "./auth.ts";

export type ActionResult = { status: number; body: Record<string, unknown> };

// Re-export du type de session : les modules d'action des taches 3 a 7 le
// prennent en parametre et n'ont ainsi qu'un seul import a faire.
export type { SessionUser };

// Mediane reelle : 94 min sur 235 menages chronometres depuis le 1er juillet
// (notes UX, section 2). Ponderation par type : specification, ruling 1.
export const V3_MEDIAN_MINUTES = 94;
export const V3_TYPE_WEIGHT: Record<string, number> = {
  "Studio": 1,
  "1 BHK": 1.25,
  "2 BHK": 1.75,
};

// Noms exacts des trois templates de checklist_templates (8, 10 et 12 lignes).
export const V3_TEMPLATE_NAME: Record<string, string> = {
  "Studio": "Studio",
  "1 BHK": "1 Bedroom",
  "2 BHK": "2 Bedrooms",
};

// Regle par defaut du technicien de permanence quand on_duty n'a pas de ligne
// pour la date. Par nom et non par identifiant : aucun id n'est en dur nulle part.
export const V3_DUTY_FALLBACK = ["Semax", "Ismael"];

// Meme bucket prive que l'app actuelle, prefixe v3/. Voir « Ambiguites tranchees »
// du plan : un seul bucket, une seule politique de retention, un seul helper de
// signature. Changer cette constante suffit a basculer vers un bucket dedie.
export const V3_PHOTO_BUCKET = "cleaning-photos";

// Jumeau volontaire de LAUNDRY_FIELDS dans index.ts : v3.ts ne peut pas importer
// index.ts (il appelle Deno.serve au chargement). Les deux listes doivent rester
// identiques ; un test le verifie mot pour mot.
export const V3_LINEN_FIELDS = [
  "pillowcases", "bed_sheets", "duvet_covers",
  "small_towels", "face_towels", "large_towels", "bath_mats",
] as const;

// Roles autorises par action (specification, section 4, tableau des actions).
// `v3.myDay` accepte en plus `manager` : un manager doit pouvoir ouvrir l'ecran
// d'une journee pour depanner une cleaner au telephone, et c'est une lecture.
// Toutes les ecritures d'un menage restent reservees a celui qui le fait.
export const V3_ROLES: Record<string, string[]> = {
  "v3.myDay": ["cleaner", "subcontractor", "maintenance", "manager"],
  "v3.startJob": ["cleaner", "subcontractor"],
  "v3.tick": ["cleaner", "subcontractor"],
  "v3.uploadPhoto": ["cleaner", "subcontractor", "maintenance"],
  "v3.finishJob": ["cleaner", "subcontractor"],
  "v3.reportProblem": ["cleaner", "subcontractor"],
  "v3.checkTicket": ["cleaner", "subcontractor"],
};

// Echoue fermee : une action inconnue de la table n'est autorisee a personne.
export function roleAllowed(action: string, role: string): boolean {
  const l = V3_ROLES[action];
  return !!l && l.indexOf(role) !== -1;
}

// Miroirs des fenetres de l'action checkouts d'index.ts. Memes valeurs, pour que
// la v3 et l'app actuelle aient exactement la meme notion de « frais » et de
// « perime » sur le meme cache.
export const V3_CACHE_FRESH_MS = 2 * 60 * 1000;
export const V3_CACHE_STALE_MS = 10 * 60 * 1000;

// Categories de la feuille « Report a problem » (specification, section 3), et
// leur equivalent dans maintenance_tickets.category.
export const V3_CATEGORIES: Record<string, { label: string; ticketCategory: string }> = {
  ac: { label: "AC", ticketCategory: "ac" },
  plumbing: { label: "Plumbing", ticketCategory: "plumbing" },
  electrical: { label: "Electrical", ticketCategory: "electrical" },
  appliance: { label: "Appliance", ticketCategory: "appliance" },
  pest: { label: "Pest", ticketCategory: "pest" },
  other: { label: "Other", ticketCategory: "general" },
};

// Dubai est en UTC+4 toute l'annee, aucun changement d'heure : un decalage fixe
// suffit, pas besoin d'Intl ni de tzdata dans l'edge runtime.
const DUBAI_UTC_OFFSET_MS = 4 * 3600_000;

export function todayDubai(nowMs: number = Date.now()): string {
  return new Date(nowMs + DUBAI_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

// Arithmetique de dates en UTC pur : les chaines YYYY-MM-DD n'ont pas de fuseau,
// et un new Date(local) decalerait d'un jour selon l'heure de la machine.
export function plusDays(date: string, n: number): string {
  const d = new Date(String(date) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Cle de cache de l'app actuelle : fetchAll() demande toujours sept jours a partir
// du jour ou l'ecran est ouvert (getWeekRange dans app.js), donc
// « checkouts:<jour>_<jour+6> ». La v3 lit et ecrit la meme cle : les deux
// applications se rechauffent mutuellement le cache au lieu de s'ignorer.
export function weekKeyFor(date: string): string {
  return "checkouts:" + date + "_" + plusDays(date, 6);
}

// Choisit, parmi les lignes proxy_cache « checkouts:% », le plus frais instantane
// dont la plage couvre la date demandee. Rend aussi son age, pour que l'appelant
// decide : servir tel quel, servir et revalider en arriere-plan, ou repaginer.
// Fonction pure, donc testable sans base.
export function pickSnapshot(
  rows: any[], date: string, nowMs: number = Date.now(),
): { payload: any; ageMs: number } | null {
  let best: { payload: any; ageMs: number } | null = null;
  for (const row of rows ?? []) {
    const m = String(row?.key ?? "").match(/^checkouts:(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
    if (!m || !row?.payload) continue;
    if (date < m[1] || date > m[2]) continue;
    const age = nowMs - Date.parse(String(row.updated_at ?? ""));
    if (!Number.isFinite(age)) continue;
    if (!best || age < best.ageMs) best = { payload: row.payload, ageMs: age };
  }
  return best;
}

// Managers actifs. Une seule definition pour les deux actions qui notifient
// (reportProblem et finishJob), pour qu'elles ne divergent jamais.
export async function managerIds(sb: any): Promise<number[]> {
  const { data } = await sb.from("cleaners")
    .select("id, role, is_active").eq("is_active", true).eq("role", "manager");
  return (data ?? []).map((c: any) => Number(c.id));
}

// Hostaway rend checkInTime / checkOutTime en heures entieres. Seuls un nombre
// fini et une chaine purement numerique sont acceptes : un Number(false) valait 0
// et affichait « 00:00 » au-dessus du compte a rebours du Job, une heure inventee
// a partir d'une valeur mal typee (revue tache 2, constat 6).
export function formatHour(h: unknown): string | null {
  let n: number;
  if (typeof h === "number") n = h;
  else if (typeof h === "string" && /^\s*\d{1,2}\s*$/.test(h)) n = Number(h);
  else return null;
  if (!Number.isFinite(n) || n < 0 || n > 23) return null;
  return String(Math.floor(n)).padStart(2, "0") + ":00";
}

// listing_config.unit_type porte le tag Hostaway ("Studio", "1 BHK", "2 BHK",
// "3 BHK"). Quand il manque, on retombe sur le nombre de chambres. Deux chambres
// et plus sont traitees comme « 2 BHK » : la specification ne donne que trois
// ponderations.
export function normalizeUnitType(unitType: unknown, bedrooms: unknown): string {
  // Sans les espaces : le tag est du texte libre cote Hostaway, « 1BHK » et
  // « 1 BHK » doivent donner le meme type (revue tache 2, constat 5). Sinon
  // « 1BHK » tombait dans le cas generique et comptait 165 min au lieu de 118.
  const raw = typeof unitType === "string" ? unitType.toLowerCase().replace(/\s+/g, "") : "";
  if (raw === "studio") return "Studio";
  if (raw === "1bhk") return "1 BHK";
  if (raw.endsWith("bhk")) return "2 BHK";
  const b = Number(bedrooms);
  if (!Number.isFinite(b) || b <= 0) return "Studio";
  if (b === 1) return "1 BHK";
  return "2 BHK";
}

export function estimatedMinutes(unitType: string): number {
  const w = V3_TYPE_WEIGHT[unitType] ?? 1;
  return Math.round(V3_MEDIAN_MINUTES * w);
}

// Ruling 9 : prenom et initiale, jamais le nom complet, jamais de telephone.
// La virgule coupe au meme titre que l'espace : « Dupont, Marie » laissait la
// virgule collee au jeton (revue tache 2, constat 2).
export function shortGuest(full: unknown): string {
  const parts = String(full ?? "").trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) return "Guest";
  if (parts.length === 1) return parts[0];
  // Un deuxieme jeton d'un seul caractere est deja le mot entier (ideogrammes) :
  // en rendre « l'initiale » afficherait le nom complet. On ne rend que le premier.
  if (Array.from(parts[1]).length === 1) return parts[0];
  return parts[0] + " " + parts[1].charAt(0).toUpperCase() + ".";
}

// checklist_templates.items et photo_required_items sont tantot des tableaux,
// tantot du JSON en colonne texte selon la ligne.
export function templateItems(tmpl: any): { items: string[]; photoRequired: string[] } {
  const parse = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x));
    if (typeof v === "string") {
      try {
        const p = JSON.parse(v);
        return Array.isArray(p) ? p.map((x) => String(x)) : [];
      } catch (_e) {
        return [];
      }
    }
    return [];
  };
  return { items: parse(tmpl?.items), photoRequired: parse(tmpl?.photo_required_items) };
}

// La cle vient du telephone : on la borne pour qu'elle ne puisse ni etre vide ni
// servir de champ libre dans un index.
export function validIdem(v: unknown): boolean {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(v);
}

// Jumeau de readLaundryQty (index.ts), memes regles : entier, jamais negatif,
// valeur absolue plafonnee a 999, face_towels absent vaut 0.
export function readLinen(
  body: Record<string, any>,
): { values: Record<string, number> } | { error: string } {
  const values: Record<string, number> = {};
  for (const f of V3_LINEN_FIELDS) {
    if (f === "face_towels" && body[f] === undefined) { values[f] = 0; continue; }
    if (body[f] === null || body[f] === undefined) return { error: `${f} must be an integer` };
    const n = Number(body[f]);
    if (!Number.isInteger(n)) return { error: `${f} must be an integer` };
    if (n < 0) return { error: `${f} must be >= 0` };
    if (n > 999) return { error: `${f} is out of range` };
    values[f] = n;
  }
  return { values };
}

// ===========================================================================
// Idempotence
// ===========================================================================

// Le bloc vit dans v3_idem.ts depuis la revue de la tache 2 (il a grossi et v3.ts
// approchait le plafond de 400 lignes). Il est re-exporte ici pour que les imports
// existants `from "./v3.ts"` des taches 4 a 7 continuent de fonctionner.
export {
  claimEvent, purgeStaleClaims, recordResult, releaseEvent, replayResponse,
  staleClaimIds, V3_CLAIM_TTL_MS, V3_EVENT_TYPES,
} from "./v3_idem.ts";
export type { V3EventType } from "./v3_idem.ts";

// Jumeau d'addLog (index.ts) : meme table, memes colonnes. Un log rate ne casse
// jamais l'action qu'il enregistre, mais l'erreur est lue et journalisee.
export async function v3Log(
  sb: any, key: string, action: string, actor: string | null, details?: any,
): Promise<void> {
  const { error } = await sb.from("cleaning_log")
    .insert({ reservation_key: key, action, actor: actor || null, details: details || {} });
  if (error) console.error("[v3Log] insert failed:", action, key, (error as any).message);
}

// ===========================================================================
// Technicien de permanence
// ===========================================================================

// Ligne du jour si elle existe, sinon la regle par defaut : Semax, puis Ismael,
// puis le premier technicien actif. Aucun identifiant en dur.
export async function onDutyTechnician(sb: any, date: string): Promise<number | null> {
  const { data: techs } = await sb.from("cleaners")
    .select("id, name, role, is_active").eq("is_active", true).eq("role", "maintenance").order("id");
  const list: any[] = techs ?? [];
  const { data: row } = await sb.from("on_duty")
    .select("technician_id").eq("duty_date", date).maybeSingle();
  // La ligne administree ne gagne que si son technicien est toujours actif. Une
  // desactivation (le cas reel quand quelqu'un quitte l'equipe) ne supprime pas la
  // ligne on_duty : sans ce recoupement, le ticket partait vers un compte eteint
  // avec un push qui ne touche personne (revue tache 2, constat 3).
  if (row && row.technician_id) {
    const id = Number(row.technician_id);
    if (list.some((c) => Number(c.id) === id)) return id;
  }
  for (const wanted of V3_DUTY_FALLBACK) {
    const hit = list.find((c) =>
      String(c.name ?? "").toLowerCase().startsWith(wanted.toLowerCase()));
    if (hit) return Number(hit.id);
  }
  return list.length > 0 ? Number(list[0].id) : null;
}
