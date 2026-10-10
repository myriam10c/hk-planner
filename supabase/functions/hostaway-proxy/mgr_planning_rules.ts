// Regles pures de l'ecran Planning de /manager/ (spec 2026-10-09, sections 3, 4
// et 9.3). Aucune base, aucun reseau.
import { plusDays } from "./v3.ts";
import { byRoleThenName, eliteLogDeadlineMs, type Tone } from "./mgr_rules.ts";

// Champs quantites du linge : source unique, aussi lue par index.ts (saveLaundryCount).
export const LAUNDRY_FIELDS = [
  "pillowcases", "bed_sheets", "duvet_covers",
  "small_towels", "face_towels", "large_towels", "bath_mats",
] as const;
export type LaundryField = typeof LAUNDRY_FIELDS[number];
export type LaundryRow = Record<LaundryField, number> & { total: number };

// Fenetre de navigation : 26 semaines avant et apres la semaine en cours.
export const PLAN_MAX_WEEKS = 26;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function weekStart(day: string): string {
  const dow = (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = lundi
  return plusDays(day, -dow);
}
export function weekDays(start: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => plusDays(start, i));
}

export function parsePlanningStart(
  raw: string | null, today: string,
): { ok: true; start: string } | { ok: false; error: string } {
  const thisWeek = weekStart(today);
  if (raw === null || raw === "") return { ok: true, start: thisWeek };
  const t = Date.parse(raw + "T00:00:00Z");
  if (!DAY_RE.test(raw) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: "start must be YYYY-MM-DD" };
  }
  const start = weekStart(raw);
  const weeks = Math.round((Date.parse(start + "T00:00:00Z") - Date.parse(thisWeek + "T00:00:00Z")) / (7 * DAY_MS));
  if (Math.abs(weeks) > PLAN_MAX_WEEKS) return { ok: false, error: "start must be within 26 weeks of today" };
  return { ok: true, start };
}

// Hostaway rend des heures entieres ; 0 (minuit) ou vide veut dire « non renseignee ».
export function hourOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 24 ? Math.floor(n) : null;
}

export type PlanState = "done" | "in_progress" | "not_started";

// Mot et ton d'un menage de la semaine. Ordre : annule, fait, arrivee avant le
// menage (report trop loin), personne (Elite habituel tant que sa saisie du
// lendemain 14:00 n'est pas passee), en cours, passe non fait, prevu.
export function planStatus(i: {
  date: string; today: string; nowMs: number; assigned: number; state: PlanState;
  cancelled: boolean; usuallyElite: boolean; nextBefore: boolean;
}): { tone: Tone; word: string } {
  if (i.cancelled) return { tone: "idle", word: "Cancelled" };
  if (i.state === "done") return { tone: "ok", word: "Done" };
  if (i.nextBefore) return { tone: "bad", word: "Guest arrives first" };
  if (!i.assigned) {
    if (i.usuallyElite && i.nowMs < eliteLogDeadlineMs(i.date)) {
      return { tone: "warn", word: i.date > i.today ? "Usually Elite" : "Usually Elite · not logged yet" };
    }
    return { tone: "bad", word: "Unassigned" };
  }
  if (i.state === "in_progress") return { tone: "idle", word: "In progress" };
  if (i.date < i.today) return { tone: "warn", word: "Not marked done" };
  return { tone: "idle", word: "Scheduled" };
}

// Une couleur par personne : cleaners actifs par nom (p1 a p4, en boucle), puis
// inactifs ; sous-traitant (Elite) sur sa couleur propre. Les autres roles n'en ont pas.
export function personSlots(
  people: Array<{ id: number; name: string; role: string; active: boolean }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const team = people.filter((p) => p.role === "cleaner" || p.role === "subcontractor")
    .sort((a, b) => Number(!a.active) - Number(!b.active) || byRoleThenName(a, b));
  let n = 0;
  for (const p of team) out[String(p.id)] = p.role === "subcontractor" ? "sub" : "p" + ((n++ % 4) + 1);
  return out;
}

export function laundryRow(r: Record<string, unknown>): LaundryRow {
  const out: Record<string, number> = { total: 0 };
  for (const f of LAUNDRY_FIELDS) {
    const raw = r?.[f];
    const n = raw === null || raw === undefined || raw === "" ? 0 : Number(raw);
    const v = Number.isFinite(n) ? n : 0;
    out[f] = v;
    out.total += v;
  }
  return out as LaundryRow;
}
