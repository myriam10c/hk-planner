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
// = mgr_rules.ts reservationKey (miroir de keyFor() dans app.js)
export function reservationKey(r: { departure: string; guest: string }): string {
  return r.departure + "_" + (r.guest || "Guest");
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
