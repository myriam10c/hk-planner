// Regles pures de l'app manager /manager/ (spec 2026-10-09-hk-manager-app-design.md,
// section 5). Aucune base, aucun reseau : tout ce qui decide d'un statut vit ici.
import { plusDays } from "./v3.ts";
import { INSP_VALID_STATUSES } from "./insp_rules.ts";

export const MGR_DEFAULT_RISK_HOURS = 6;
// Heure d'arrivee supposee quand Hostaway n'en donne pas (check-in standard).
export const MGR_DEFAULT_CHECKIN_HOUR = 15;
// Fenetre des departs lus dans Hostaway pour retrouver le menage precedent.
export const MGR_LOOKBACK_DAYS = 14;
// Elite saisit ses jobs le lendemain vers 14:00 Dubai (Hermes auto-assign + done).
export const MGR_ELITE_LOG_HOUR = 14;
export const MGR_USUALLY_ELITE_MIN_JOBS = 2;
export const MGR_USUALLY_ELITE_WINDOW_DAYS = 60;

const H = 3600_000;
const DUBAI_OFFSET_MS = 4 * H;

export type Tone = "ok" | "warn" | "bad" | "idle";
export type Status = { tone: Tone; word: string; cause: string };
export type MgrReservation = {
  id: string; listingId: string; guest: string; arrival: string; departure: string; status: string;
  checkInTime: number | null; checkOutTime: number | null;
};
export type PrevCleaning = {
  key: string;
  checkoutDate: string;          // depart du sejour precedent
  checkoutHour: number | null;   // heure Hostaway, null = 00:00 / absente
  cleaningDate: string;          // checkoutDate, ou cleaning_postponed.new_date
  assignedNames: string[];
  done: boolean; started: boolean; cancelled: boolean;
  usuallyElite: boolean;
};

// Hostaway rend des heures entieres ; 0 (minuit) veut dire « non renseignee ».
const heure = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 24 ? Math.floor(n) : null;
};

// Texte voyageur d'une reservation Hostaway brute. Meme calcul que
// buildCheckoutsPayload (index.ts) : la cle de menage en depend. Today
// (normalizeMgrReservations) et l'autopilote (autopilot.ts) passent par ici.
export function hostawayGuest(r: any): string {
  return String(r?.guestName || ((r?.guestFirstName || "") + " " + (r?.guestLastName || "")).trim() || "");
}

export function normalizeMgrReservations(raw: any[]): MgrReservation[] {
  const seen = new Set<string>();
  const out: MgrReservation[] = [];
  for (const r of raw ?? []) {
    const listingId = String(r?.listingMapId ?? r?.listingId ?? "");
    if (!listingId || !r?.arrivalDate || !r?.departureDate) continue;
    const id = r?.id != null ? String(r.id) : listingId + "|" + r.arrivalDate + "|" + r.departureDate;
    if (seen.has(id)) continue;
    seen.add(id);
    const guest = hostawayGuest(r);
    out.push({
      id, listingId, guest, arrival: String(r.arrivalDate), departure: String(r.departureDate),
      status: String(r.status ?? ""), checkInTime: heure(r.checkInTime), checkOutTime: heure(r.checkOutTime),
    });
  }
  return out;
}

// Miroir de keyFor() dans app.js : `${checkOut}_${guest||'Guest'}`. Cle NUE : elle
// ne porte pas le logement. La cle d'un menage se calcule avec reservationKeys.
export function reservationKey(r: { departure: string; guest: string }): string {
  return r.departure + "_" + (r.guest || "Guest");
}

// Separateur du logement dans une cle de menage suffixee (lot 1, tache 7).
export const KEY_LISTING_SEP = "~";

export type KeyedStay = { id?: unknown; listingId: string; departure: string; guest: string };

// Rang d'anciennete : l'identifiant Hostaway en nombre (« 9 » avant « 10 ») ; un
// identifiant illisible passe apres tous les autres. A rang egal, le logement
// departage : jamais l'ordre de la liste, qui change d'une lecture a l'autre.
const anciennete = (id: unknown): number => {
  const n = Number(id);
  return id === null || id === undefined || id === "" || !Number.isFinite(n) ? Infinity : n;
};
const plusAncienne = (a: KeyedStay, b: KeyedStay): boolean => {
  const ra = anciennete(a.id), rb = anciennete(b.id);
  return ra !== rb ? ra < rb : a.listingId <= b.listingId;
};

// Cle de menage de chaque reservation d'une liste, dans l'ordre de la liste (lot 1,
// tache 7). La cle nue ne porte pas le logement : un voyageur qui quittait deux
// logements le meme jour ne donnait qu'un menage, et l'affectation, le « fait » et
// l'etat de l'arrivee suivante du premier valaient pour les deux.
//   - Quand des reservations de logements DIFFERENTS partagent la cle nue, la plus
//     ancienne (identifiant Hostaway le plus petit, puis le logement) garde la cle
//     nue pour son logement ; chaque autre logement recoit « cleNue~listingId ».
//   - Deux reservations du meme logement restent un seul menage, comme avant.
//   - Sans collision, la cle est exactement celle d'avant (aucune migration).
//   - Une reservation sans logement garde la cle nue et ne la prend a personne.
// Today, Planning et la journee de la cleaner passent tous par ici, sur des listes
// prises AVANT tout filtre par logement ou par personne, statuts valides seulement :
// chaque lecture voit alors toutes les reservations qui partent le jour d'une cle,
// et rend la meme cle quel que soit l'ordre de sa liste. Alignes depuis la seconde
// lecture Fable (24/11) : l'API des agents (readonly-api, copie dans ro_rules.ts),
// l'autopilote (autopilot.ts, autopilotDepartures) et l'export CSV des chronos
// (index.ts, colonne voyageur par guestOfKey).
// Limites :
//   - l'ancienne app (app.js, keyFor) et le serveur Python du VPS (saisie d'Elite)
//     ecrivent toujours sous la cle nue, donc sur le menage de la reservation la
//     plus ancienne en cas de collision ;
//   - si la reservation gardienne est annulee apres coup, l'autre logement passe de
//     « cleNue~listingId » a la cle nue : il herite de l'etat ecrit pour le menage
//     annule (affectation, fait, chrono), et le sien reste orphelin sous la cle
//     suffixee. Les reservations annulees ne comptent pas parce que le payload
//     checkouts (buildCheckoutsPayload), lu par Planning et la journee de la
//     cleaner, ne les porte pas : les compter dans Today seul casserait l'egalite
//     des cles entre les trois lectures.
export function reservationKeys(list: KeyedStay[]): string[] {
  const out = (list ?? []).map(reservationKey);
  const groupes = new Map<string, number[]>();
  out.forEach((k, i) => { if (list[i].listingId) (groupes.get(k) ?? groupes.set(k, []).get(k)!).push(i); });
  for (const [nue, idx] of groupes) {
    const aine = idx.reduce((a, b) => (plusAncienne(list[a], list[b]) ? a : b));
    for (const i of idx) {
      if (list[i].listingId !== list[aine].listingId) out[i] = nue + KEY_LISTING_SEP + list[i].listingId;
    }
  }
  return out;
}

// Meme regle sur les lignes du payload checkouts (buildCheckoutsPayload, index.ts) :
// Planning et la journee de la cleaner lisent ce payload. Une ligne d'un statut
// non valide ne prend la cle nue a personne, comme dans Today qui l'ecarte avant
// ses cles (le payload n'en porte deja pas : meme liste de statuts).
export function checkoutKeys(
  rows: Array<{ id?: unknown; listingId?: unknown; checkOut?: unknown; guest?: unknown; status?: unknown }>,
): string[] {
  return reservationKeys((rows ?? []).map((r) => ({
    id: r?.id, departure: String(r?.checkOut ?? ""), guest: String(r?.guest ?? ""),
    listingId: r?.status === undefined || INSP_VALID_STATUSES.includes(String(r.status)) ? String(r?.listingId ?? "") : "",
  })));
}

// Les cles donnees plus leurs cles nues. Sert au filtre des reports de
// buildCheckoutsPayload (index.ts) : le report d'un menage suffixe doit garder dans
// le payload toutes les reservations de sa cle nue, sinon la lecture ne saurait plus
// laquelle garde la cle nue. Un « ~ » dans un nom de guest ajoute une cle de trop :
// elle ne garde qu'un depart hors plage, que chaque lecture ecarte par sa date.
export function withBareKeys(keys: string[]): Set<string> {
  const out = new Set<string>();
  for (const k of keys ?? []) {
    const s = String(k);
    out.add(s);
    const i = s.lastIndexOf(KEY_LISTING_SEP);
    if (i > 0) out.add(s.slice(0, i));
  }
  return out;
}

// Voyageur d'une cle de menage « date_voyageur » ou « date_voyageur~logement » :
// tout ce qui suit le premier « _ » (un « _ » du nom reste tel quel), sans le
// suffixe du logement, coupe au dernier « ~ » comme withBareKeys. Sert a la
// colonne voyageur de l'export CSV des chronos (exportCleaningsCsv, index.ts).
export function guestOfKey(key: string): string {
  const s = String(key ?? "");
  const i = s.indexOf("_");
  if (i < 0) return "";
  const rest = s.slice(i + 1);
  const j = rest.lastIndexOf(KEY_LISTING_SEP);
  return j > 0 ? rest.slice(0, j) : rest;
}

export function keyDate(key: string): string | null {
  const m = String(key || "").match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

export function hhmm(h: number | null): string | null {
  return h == null ? null : String(h).padStart(2, "0") + ":00";
}
export function ddmm(day: string): string {
  return String(day).slice(8, 10) + "/" + String(day).slice(5, 7);
}
// Instant UTC de « day a hour:00 » heure de Dubai.
export function dubaiMs(day: string, hour: number): number {
  return Date.parse(day + "T00:00:00Z") + hour * H - DUBAI_OFFSET_MS;
}
export function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? h + " h" + (r ? " " + String(r).padStart(2, "0") : "") : r + " min";
}
export function joinNames(a: string[]): string {
  if (a.length <= 1) return a[0] ?? "";
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}
export function plural(n: number, word: string): string {
  return n + " " + word + (n === 1 ? "" : "s");
}

// Meme lecture que listingLabel (insp_rules.ts), en deux morceaux.
export function splitListing(
  row: { internal_name?: string | null; listing_name?: string | null; apt_number?: string | null } | null | undefined,
): { apt: string; bld: string } {
  const s = String(row?.internal_name ?? "").trim();
  const m = s.match(/^([A-Za-z]*\d[A-Za-z0-9]*)(?:\s*[-|·]\s*|\s+)(.+)$/);
  if (m) return { apt: m[1], bld: m[2].trim() };
  return { apt: String(row?.apt_number ?? "").trim(), bld: s || String(row?.listing_name ?? "").trim() || "Apartment" };
}

const ROLE_ORDER: Record<string, number> = { cleaner: 0, subcontractor: 1 };
export function byRoleThenName(a: { role: string; name: string }, b: { role: string; name: string }): number {
  return (ROLE_ORDER[a.role] ?? 2) - (ROLE_ORDER[b.role] ?? 2) || a.name.localeCompare(b.name);
}

// Lignes de cleaning_accounting_cache.payload_json.rows : une ligne par job Elite.
export function usuallyEliteListings(rows: Array<{ listing_id: unknown; cleaning_date: unknown }>, day: string): Set<string> {
  const from = plusDays(day, -MGR_USUALLY_ELITE_WINDOW_DAYS);
  const n: Record<string, number> = {};
  for (const r of rows ?? []) {
    const d = String(r?.cleaning_date ?? "");
    const lid = r?.listing_id == null ? "" : String(r.listing_id);
    if (!lid || d < from || d >= day) continue;
    n[lid] = (n[lid] ?? 0) + 1;
  }
  return new Set(Object.keys(n).filter((k) => n[k] >= MGR_USUALLY_ELITE_MIN_JOBS));
}

// Garde « un collegue a change » d'assignCleaner (lot 4b). expect = la liste que
// l'ecran affiche (body.expect_ids). null = pas de garde (expect n'est pas un
// tableau) ou meme ensemble d'identifiants (ordre et doublons ignores, valeurs
// comparees en nombres) ; sinon la liste actuelle, sans doublon, triee.
export function assignConflict(current: number[], expect: unknown): number[] | null {
  if (!Array.isArray(expect)) return null;
  const cur = new Set(current.map(Number));
  const exp = new Set(expect.map(Number));
  if (cur.size === exp.size && [...cur].every((id) => exp.has(id))) return null;
  return [...cur].sort((a, b) => a - b);
}

export function eliteLogDeadlineMs(cleaningDate: string): number {
  return dubaiMs(plusDays(cleaningDate, 1), MGR_ELITE_LOG_HOUR);
}

function checkoutPhrase(p: PrevCleaning, day: string): string {
  if (p.checkoutDate !== day) return "checkout " + ddmm(p.checkoutDate);
  return p.checkoutHour == null ? "checkout time not set" : "checkout " + hhmm(p.checkoutHour);
}
function afterPhrase(p: PrevCleaning, day: string): string {
  if (p.checkoutDate !== day) return "the " + ddmm(p.checkoutDate) + " checkout";
  return p.checkoutHour == null ? "today's checkout (checkout time not set)" : "the " + hhmm(p.checkoutHour) + " checkout";
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function arrivalStatus(i: {
  day: string; nowMs: number; arrivalMs: number; riskHours: number;
  prev: PrevCleaning | null; urgent: Array<{ id: number; title: string }>;
}): Status {
  const u = i.urgent[0];
  // Meme format que problemRef (mgr_inbox.ts) : une seule reference partout.
  const tk = u ? u.title + " (MNT-" + u.id + ")" : "";
  const p = i.prev;
  if (!p) {
    if (u) return { tone: "bad", word: "Blocked", cause: "Urgent ticket open: " + tk + "." };
    return { tone: "ok", word: "Ready", cause: "No checkout in the last " + MGR_LOOKBACK_DAYS + " days, apartment empty." };
  }
  if (p.done) {
    if (u) return { tone: "bad", word: "Blocked", cause: "Clean, but urgent ticket open: " + tk + "." };
    return {
      tone: "ok", word: "Ready",
      cause: "Cleaned" + (p.assignedNames.length ? " by " + joinNames(p.assignedNames) : "") + " after " + afterPhrase(p, i.day) + ".",
    };
  }
  const extra = u ? " Urgent ticket open: " + tk + "." : "";
  if (p.cancelled) return { tone: "bad", word: "Blocked", cause: "Cleaning cancelled in HK Planner after " + afterPhrase(p, i.day) + "." + extra };
  if (p.cleaningDate > i.day) return { tone: "bad", word: "Blocked", cause: "Cleaning postponed to " + ddmm(p.cleaningDate) + "." + extra };
  if (!p.assignedNames.length) {
    if (u) return { tone: "bad", word: "Blocked", cause: "No cleaner assigned, and urgent ticket open: " + tk + "." };
    if (p.usuallyElite && i.nowMs < eliteLogDeadlineMs(p.cleaningDate)) {
      return {
        tone: "warn", word: "At risk",
        cause: "Not logged yet. Elite logs its jobs the next day around " + hhmm(MGR_ELITE_LOG_HOUR) + ".",
      };
    }
    const turn = p.checkoutDate === i.day && p.checkoutHour != null
      ? ", " + fmtDur(i.arrivalMs - dubaiMs(i.day, p.checkoutHour)) + " turnaround" : "";
    return { tone: "bad", word: "Blocked", cause: "No cleaner assigned. " + cap(checkoutPhrase(p, i.day)) + turn + "." };
  }
  if (u) return { tone: "bad", word: "Blocked", cause: "Urgent ticket open: " + tk + "." };
  const left = i.arrivalMs - i.nowMs;
  const who = joinNames(p.assignedNames);
  if (left <= i.riskHours * H) {
    const guest = left > 0 ? "Guest in " + fmtDur(left) : "Guest due now";
    return {
      tone: "warn", word: "At risk",
      cause: (p.started ? "Cleaning in progress, " : "Not started yet, ") + who + ". " + guest + ", " + checkoutPhrase(p, i.day) + ".",
    };
  }
  return { tone: "idle", word: "Scheduled", cause: "Not cleaned yet, " + who + " assigned. Guest in " + fmtDur(left) + "." };
}

// Acces a mgr.today (spec section 6) : managers seulement, session email
// obligatoire. hasBearer = un en-tete Authorization: Bearer est present ; s'il
// est invalide, currentUser rend null (401), jamais un repli sur le PIN.
export type MgrAccess = { ok: true } | { ok: false; status: number; error: string };
export function mgrAccess(hasBearer: boolean, me: { role: string } | null): MgrAccess {
  if (!me) return { ok: false, status: 401, error: "auth required" };
  if (!hasBearer) return { ok: false, status: 403, error: "email sign-in required" };
  if (me.role !== "manager") return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

// Acces au Planning (et aux gestes du Planning setCancelled / setPostponed) :
// memes regles que mgrAccess, ouvert aussi au role maintenance (Semax).
export const MGR_PLANNING_ROLES = ["manager", "maintenance"];
export function planningAccess(hasBearer: boolean, me: { role: string } | null): MgrAccess {
  if (!me) return { ok: false, status: 401, error: "auth required" };
  if (!hasBearer) return { ok: false, status: 403, error: "email sign-in required" };
  if (!MGR_PLANNING_ROLES.includes(me.role)) return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

export function parseRiskHours(v: unknown): number {
  if (v === null || v === undefined || v === "") return MGR_DEFAULT_RISK_HOURS;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : MGR_DEFAULT_RISK_HOURS;
}
