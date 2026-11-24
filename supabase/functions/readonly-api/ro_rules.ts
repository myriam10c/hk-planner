// Regles pures de l'API en lecture seule (assistant IA externe). Aucune base,
// aucun reseau : verification de la cle, filtres, mise en forme des sorties.
// Principe : liste blanche de champs. Rien ne sort qui ne soit nomme ici
// (pas de PIN, d'email, de telephone, de prix, de nom de guest, de photo).
//
// Fonction autonome : les helpers ci-dessous sont des copies de ceux du proxy
// (importer ses modules tirerait auth.ts et ses dependances). Les corriger
// ensemble avec leur original.

// = v3.ts plusDays
export function plusDays(date: string, n: number): string {
  const d = new Date(String(date) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// = mgr_rules.ts reservationKey (miroir de keyFor() dans app.js). Cle NUE : la cle
// d'un menage se calcule avec checkoutKeys.
export function reservationKey(r: { departure: string; guest: string }): string {
  return r.departure + "_" + (r.guest || "Guest");
}
// = insp_rules.ts INSP_VALID_STATUSES (statuts de reservation qui donnent un menage)
export const RO_VALID_RES = ["new", "modified", "confirmed", "ownerStay", "reserved"];
// = mgr_rules.ts KEY_LISTING_SEP
export const KEY_LISTING_SEP = "~";
type KeyedStay = { id?: unknown; listingId: string; departure: string; guest: string };
// = mgr_rules.ts anciennete, plusAncienne
const anciennete = (id: unknown): number => {
  const n = Number(id);
  return id === null || id === undefined || id === "" || !Number.isFinite(n) ? Infinity : n;
};
const plusAncienne = (a: KeyedStay, b: KeyedStay): boolean => {
  const ra = anciennete(a.id), rb = anciennete(b.id);
  return ra !== rb ? ra < rb : a.listingId <= b.listingId;
};
// = mgr_rules.ts reservationKeys (lot 1, tache 7 ; regle et limites decrites la-bas).
// Quand des reservations de logements differents partagent la cle nue, la plus
// ancienne (identifiant Hostaway le plus petit, puis le logement) la garde ; chaque
// autre logement recoit « cleNue~listingId ». Sans collision, la cle d'avant.
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
// = mgr_rules.ts checkoutKeys : meme regle sur les lignes du payload checkouts du
// proxy, celui que lisent Planning, la journee de la cleaner et cette API.
export function checkoutKeys(
  rows: Array<{ id?: unknown; listingId?: unknown; checkOut?: unknown; guest?: unknown; status?: unknown }>,
): string[] {
  return reservationKeys((rows ?? []).map((r) => ({
    id: r?.id, departure: String(r?.checkOut ?? ""), guest: String(r?.guest ?? ""),
    listingId: r?.status === undefined || RO_VALID_RES.includes(String(r.status)) ? String(r?.listingId ?? "") : "",
  })));
}
// = mgr_rules.ts hhmm
function hhmm(h: number | null): string | null {
  return h == null ? null : String(h).padStart(2, "0") + ":00";
}
// = mgr_planning_rules.ts hourOrNull
export function hourOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 24 ? Math.floor(n) : null;
}
// = mgr_rules.ts splitListing
function splitListing(
  row: { internal_name?: string | null; listing_name?: string | null; apt_number?: string | null } | null | undefined,
): { apt: string; bld: string } {
  const s = String(row?.internal_name ?? "").trim();
  const m = s.match(/^([A-Za-z]*\d[A-Za-z0-9]*)(?:\s*[-|·]\s*|\s+)(.+)$/);
  if (m) return { apt: m[1], bld: m[2].trim() };
  return { apt: String(row?.apt_number ?? "").trim(), bld: s || String(row?.listing_name ?? "").trim() || "Apartment" };
}

export const RO_OPEN = ["open", "assigned", "in_progress", "waiting_parts", "to_confirm"];
export const RO_CLOSED = ["resolved", "closed", "cancelled"];
export const RO_CATEGORIES = ["ac", "plumbing", "electrical", "appliance", "lock_door", "wifi_tv", "hot_water", "pest", "furniture", "other", "general"];
export const RO_CLEANING_STATUSES = ["not_started", "in_progress", "done", "cancelled"];
export const RO_MAX_RANGE_DAYS = 31;
export const RO_LIMIT_DEFAULT = 100;
export const RO_LIMIT_MAX = 500;
// Roles qui peuvent recevoir un ticket de maintenance (MGR_TICKET_ASSIGNEE_ROLES
// sans les cleaners) : la liste « techniciens » de l'API.
export const RO_TECH_ROLES = ["manager", "maintenance"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Cle ----------
export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// La cle arrive en X-API-Key ou en Authorization: Bearer. Seul son SHA-256 est
// stocke cote serveur (READONLY_API_KEY_SHA256) : la cle en clair n'existe que
// chez Hillal. Comparaison a temps constant sur les deux empreintes.
export async function keyOk(headers: Headers, expectedSha: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(expectedSha)) return false;
  const bearer = (headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const given = (headers.get("x-api-key") ?? bearer).trim();
  if (!given) return false;
  const got = await sha256Hex(given);
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= got.charCodeAt(i) ^ expectedSha.charCodeAt(i);
  return diff === 0;
}

// ---------- Filtres ----------
export type Bad = { error: string };
export const isBad = (x: unknown): x is Bad => !!x && typeof x === "object" && "error" in (x as any);

export function dateParam(q: URLSearchParams, name: string): string | null | Bad {
  const v = q.get(name);
  if (v === null || v === "") return null;
  if (!DATE_RE.test(v) || isNaN(Date.parse(v + "T00:00:00Z"))) return { error: name + " must be YYYY-MM-DD" };
  return v;
}

export function listParam(q: URLSearchParams, name: string, allowed: string[]): string[] | null | Bad {
  const v = q.get(name);
  if (v === null || v === "") return null;
  const out = [...new Set(v.split(",").map((s) => s.trim()).filter(Boolean))];
  const wrong = out.filter((s) => !allowed.includes(s));
  if (wrong.length) return { error: name + ": unknown value " + wrong.join(", ") + ". Allowed: " + allowed.join(", ") };
  return out;
}

export function intParam(q: URLSearchParams, name: string, dflt: number | null, max: number): number | null | Bad {
  const v = q.get(name);
  if (v === null || v === "") return dflt;
  if (!/^\d+$/.test(v)) return { error: name + " must be a positive integer" };
  return Math.min(Number(v), max);
}

// status=open / closed = groupes ; sinon statuts exacts separes par des virgules.
export function ticketStatuses(q: URLSearchParams): string[] | null | Bad {
  const v = q.get("status");
  if (v === "open") return RO_OPEN;
  if (v === "closed") return RO_CLOSED;
  return listParam(q, "status", [...RO_OPEN, ...RO_CLOSED]);
}

// Plage de dates des menages : from obligatoire, to = from + 6 par defaut, 31 jours max.
export function cleaningRange(q: URLSearchParams): { from: string; to: string } | Bad {
  const from = dateParam(q, "from");
  if (isBad(from)) return from;
  if (!from) return { error: "from is required (YYYY-MM-DD)" };
  const to = dateParam(q, "to");
  if (isBad(to)) return to;
  const end = to ?? plusDays(from, 6);
  if (end < from) return { error: "to must be on or after from" };
  if (plusDays(from, RO_MAX_RANGE_DAYS - 1) < end) return { error: "range is limited to " + RO_MAX_RANGE_DAYS + " days" };
  return { from, to: end };
}

// ---------- Texte libre ----------
// Les tickets nes d'un message guest peuvent contenir un telephone ou un email
// recopie : on les masque avant de les rendre.
const PHONE_RE = /(?:\+|00)?\d[\d\s().-]{7,}\d/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export function redact(s: unknown): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s);
  if (!t.trim()) return null;
  return t.replace(EMAIL_RE, "[email hidden]").replace(PHONE_RE, (m) =>
    m.replace(/\D/g, "").length >= 8 ? "[phone hidden]" : m);
}

// ---------- Sorties ----------
export type Place = { apartment: string; building: string };
export function placeMap(rows: any[]): Record<string, Place> {
  const out: Record<string, Place> = {};
  for (const r of rows) {
    const p = splitListing(r);
    out[String(r.listing_id)] = { apartment: p.apt, building: p.bld };
  }
  return out;
}

export function listingOut(r: any, map: Record<string, any>) {
  const p = splitListing(r);
  const m = map[String(r.listing_id)] ?? null;
  return {
    id: String(r.listing_id),
    apartment: p.apt || null,
    building: p.bld,
    name: r.internal_name ?? r.listing_name ?? null,
    bedrooms: r.bedrooms ?? null,
    unitType: r.unit_type ?? null,
    area: m?.address ?? null,
    inspectionExcluded: r.inspection_excluded === true,
  };
}

export function ticketOut(t: any, place: Record<string, Place>, people: Record<string, string>, vendors: Record<string, string>) {
  const lid = String(t.listing_id ?? "");
  const p = place[lid] ?? { apartment: "", building: "Listing " + lid };
  const tech = t.assigned_technician_id != null ? Number(t.assigned_technician_id) : null;
  const vend = t.assigned_vendor_id != null ? Number(t.assigned_vendor_id) : null;
  return {
    id: Number(t.id),
    ref: "MNT-" + t.id,
    listingId: lid || null,
    apartment: p.apartment || null,
    building: p.building,
    title: redact(t.title),
    description: redact(t.description),
    category: t.category ?? null,
    priority: t.priority ?? null,
    status: t.status ?? null,
    open: RO_OPEN.includes(String(t.status)),
    source: t.source ?? null,
    reportedBy: t.reported_by ?? null,
    assignee: tech !== null ? { type: "technician", id: tech, name: people[String(tech)] ?? null }
      : vend !== null ? { type: "vendor", id: vend, name: vendors[String(vend)] ?? null } : null,
    toConfirm: t.to_confirm === true,
    dueOn: t.due_on ?? null,
    createdAt: t.created_at ?? null,
    startedAt: t.started_at ?? null,
    resolvedAt: t.resolved_at ?? null,
    closedAt: t.closed_at ?? null,
    lastUpdate: t.last_update ?? null,
    resolutionNotes: redact(t.resolution_notes),
  };
}

// Colonnes lues en base : jamais de couts, photos, identifiants WhatsApp ni compteurs de relance.
export const TICKET_COLS = "id, listing_id, title, description, category, priority, status, source, reported_by, " +
  "assigned_technician_id, assigned_vendor_id, to_confirm, due_on, created_at, started_at, resolved_at, closed_at, last_update, resolution_notes";

export type CheckoutIn = {
  id?: unknown; guest?: string | null; listingId?: string | null; checkOut?: string | null; checkOutTime?: unknown;
  status?: string | null; nextGuest?: { date?: string | null; checkInTime?: unknown } | null;
};
export type CleaningCtx = {
  from: string; to: string; place: Record<string, Place>; people: Record<string, string>;
  post: Record<string, { from: string | null; to: string }>;
  asg: Record<string, Array<{ id: number; st: string }>>;
  done: Set<string>;
  timer: Record<string, { started_at: string | null; finished_at: string | null; duration_minutes: number | null }>;
  canc: Record<string, string>;
};

// Un menage = un depart Hostaway (ou un extra), avec ce que l'equipe en a fait.
// L'identifiant public est l'id de reservation Hostaway (ou extra-<id>) : la cle
// interne contient le nom du guest et ne sort jamais.
export function cleaningOut(
  key: string, kind: "checkout" | "extra", publicId: string, listingId: string, baseDate: string,
  hour: number | null, next: { date: string; hour: number | null } | null, label: string | null, c: CleaningCtx,
) {
  const pm = c.post[key];
  const date = pm ? pm.to : baseDate;
  if (date < c.from || date > c.to) return null;
  const tm = c.timer[key];
  const cancelled = key in c.canc;
  const status = cancelled ? "cancelled" : c.done.has(key) ? "done" : tm?.started_at && !tm.finished_at ? "in_progress" : "not_started";
  const p = c.place[listingId] ?? { apartment: "", building: "Listing " + listingId };
  const rows = c.asg[key] ?? [];
  return {
    id: publicId,
    kind,
    listingId,
    apartment: p.apartment || null,
    building: p.building,
    date,
    postponedFrom: pm ? (pm.from ?? baseDate) : null,
    checkoutTime: pm ? null : hhmm(hour),
    nextCheckIn: next ? { date: next.date, time: hhmm(next.hour), sameDay: next.date === date } : null,
    label,
    status,
    assigned: rows.map((r) => ({ id: r.id, name: c.people[String(r.id)] ?? null })),
    serviceType: rows[0]?.st ?? null,
    startedAt: tm?.started_at ?? null,
    finishedAt: tm?.finished_at ?? null,
    durationMinutes: tm?.duration_minutes ?? null,
    cancelReason: cancelled ? redact(c.canc[key]) : null,
  };
}

// Departs du payload checkouts avec leur cle de menage (seconde lecture Fable, I1).
// Cles calculees sur le payload entier, avant tout filtre, comme mgr.planning qui
// lit le meme payload : en collision, chaque logement a sa cle finale, et la cle
// nue reste a la reservation la plus ancienne. Puis departs valides seulement.
export function keyedCheckouts(raw: CheckoutIn[]): Array<{ r: CheckoutIn; key: string }> {
  const list = raw ?? [];
  const keys = checkoutKeys(list);
  return list.map((r, i) => ({ r, key: keys[i] }))
    .filter(({ r }) => r && r.listingId && r.checkOut && RO_VALID_RES.includes(String(r.status ?? "")));
}

// Menages de la plage, un par cle finale (deux reservations du meme logement et du
// meme voyageur le meme jour restent un menage), chacun avec sa cle interne (_key,
// nom du guest compris) et sa date d'origine (_orig) : utiles aux ecritures,
// retires avant toute sortie.
export function cleaningRows(
  deps: Array<{ r: CheckoutIn; key: string }>,
  extras: Array<{ id?: unknown; reservation_key?: unknown; listing_id?: unknown; cleaning_date?: unknown; label?: string | null }>,
  c: CleaningCtx,
): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  const push = (key: string, base: string, row: any) => {
    if (row && !seen.has(key)) { seen.add(key); out.push({ ...row, _key: key, _orig: c.post[key]?.from ?? base }); }
  };
  for (const { r, key } of deps) {
    const ng = r.nextGuest?.date ? { date: String(r.nextGuest.date), hour: hourOrNull(r.nextGuest.checkInTime) } : null;
    push(key, String(r.checkOut),
      cleaningOut(key, "checkout", String(r.id ?? key.slice(0, 10)), String(r.listingId), String(r.checkOut), hourOrNull(r.checkOutTime), ng, null, c));
  }
  for (const e of extras) {
    const k = String(e.reservation_key);
    push(k, String(e.cleaning_date),
      cleaningOut(k, "extra", "extra-" + e.id, String(e.listing_id ?? ""), String(e.cleaning_date), null, null, e.label ?? "Extra cleaning", c));
  }
  return out;
}

// Le menage que designe un id publie par GET /cleanings : ses ecritures partent
// de sa cle finale (_key), jamais d'une cle nue recomposee.
export function pickCleaning(rows: any[], id: string): any | null {
  return rows.find((j) => j.id === id) ?? null;
}

// Proposition : citations des guests en texte masque, jamais leur nom.
export function proposalOut(p: any, place: Record<string, Place>) {
  const lid = String(p.listing_id ?? "");
  const pl = place[lid] ?? { apartment: "", building: lid ? "Listing " + lid : "" };
  const quotes = Array.isArray(p.quotes) ? p.quotes : [];
  return {
    id: Number(p.id),
    ref: "PRP-" + p.id,
    listingId: lid || null,
    apartment: pl.apartment || null,
    building: pl.building || null,
    stayFrom: p.stay_from ?? null,
    stayTo: p.stay_to ?? null,
    title: redact(p.title),
    category: p.category ?? null,
    urgency: p.urgency ?? null,
    quotes: quotes.map((q: any) => redact(typeof q === "string" ? q : q?.text ?? q?.body ?? "")).filter(Boolean),
    status: p.status ?? null,
    ticketId: p.ticket_id ?? null,
    openTicketId: p.open_ticket_id ?? null,
    decidedBy: p.decided_by ?? null,
    decidedAt: p.decided_at ?? null,
    rejectReason: p.reject_reason ?? null,
    createdAt: p.created_at ?? null,
  };
}

// Reponses du proxy rendues a l'assistant : la cle interne d'un menage contient
// le nom du guest, on la retire partout avec les autres champs guest.
const SCRUBBED = new Set(["key", "reservation_key", "guest_name", "guestName", "guest", "phone"]);
export function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SCRUBBED.has(k)).map(([k, x]) => [k, scrub(x)]));
  }
  return v;
}

// Qui a ouvert et qui a ferme : meme regle que ticketActors du proxy (premier
// « opened », derniere cloture, une reouverture efface la cloture).
export const RO_TICKET_EVENTS = ["opened", "closed", "cancelled", "reopened", "status"];
export function actorsFrom(rows: any[]): { openedBy: Record<string, string>; closedBy: Record<string, { by: string; at: string }> } {
  const openedBy: Record<string, string> = {}, closedBy: Record<string, { by: string; at: string }> = {};
  const sorted = rows.slice().sort((a, b) => String(a.at).localeCompare(String(b.at)) || Number(a.id) - Number(b.id));
  for (const e of sorted) {
    const k = String(e.ticket_id);
    if (e.event === "opened" && !(k in openedBy)) openedBy[k] = String(e.actor);
    else if (e.event === "reopened") delete closedBy[k];
    else if (e.event === "closed" || e.event === "cancelled") closedBy[k] = { by: String(e.actor), at: String(e.at) };
  }
  return { openedBy, closedBy };
}
export function eventOut(e: any) {
  return { id: Number(e.id), ticketId: Number(e.ticket_id), ref: "MNT-" + e.ticket_id, event: e.event,
    fromStatus: e.from_status ?? null, toStatus: e.to_status ?? null, by: e.actor, at: e.at };
}
