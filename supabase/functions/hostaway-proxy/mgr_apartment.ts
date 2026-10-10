// Fiche logement de l'app manager (More > Apartment, phase 5a) : actions
// mgr.apartments (liste) et mgr.apartment (fiche). Lecture seule.
// Tout est repris des sources existantes, rien n'est recalcule a part :
//   - menages : memes tables et aides que mgr.planning (reservationKey, reports,
//     assignations, fait, annule, laundryRow), departs via loadCheckouts injecte
//     par index.ts (cache serveur des checkouts) ;
//   - tickets : reference MNT-<id> de ticketRow (mgr_inbox.ts) ;
//   - inspections : inspHistory (insp_read.ts), comme insp.history ;
//   - contacts securite : getSecurityContacts (security_contacts.ts), sans
//     portalPassword ni portalId ;
//   - sante : healthScore, la seule formule (l'ancien getPropertyHealth l'appelle).
// Une source en panne vide sa section et la nomme dans `unavailable`, jamais de 500.
import type { SessionUser } from "./auth.ts";
import { plusDays } from "./v3.ts";
import { dubaiDay, INSP_VALID_STATUSES } from "./insp_rules.ts";
import { inspHistory } from "./insp_read.ts";
import { getSecurityContacts } from "./security_contacts.ts";
import { MGR_OPEN_TICKET_STATUSES, normPriority, ticketRow, type RawTicket } from "./mgr_inbox.ts";
import { MGR_TICKET_COLS, vendorNames } from "./mgr_problems.ts";
import { reservationKey, splitListing } from "./mgr_rules.ts";
import { byKeys, listingMap, peopleMap, readAllRows } from "./mgr_today.ts";
import { LAUNDRY_FIELDS, laundryRow, type LaundryRow } from "./mgr_planning_rules.ts";
import type { CheckoutRow } from "./mgr_planning.ts";

export const APT_CLEAN_PAST_DAYS = 30;
export const APT_CLEAN_NEXT_DAYS = 7;
export const APT_RECENT_TICKET_DAYS = 90;
export const APT_RECENT_TICKET_MAX = 10;
export const APT_INSPECTIONS_MAX = 5;
const RESOLVED = ["resolved", "closed"];
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

// ==================== SANTE ====================
export type HealthInput = {
  tickets: Array<{ status?: unknown; priority?: unknown }>;
  equipment: Array<{ next_service?: unknown }>;
  costs: Array<{ amount?: unknown }>;
  feedback: Array<{ rating?: unknown }>;
  today: string;
};
export type Health = {
  score: number; openTickets: number; urgentOpen: number; overdueService: number; ratingPenalty: number;
  totalEquipment: number; totalCost: number; avgRating: number; totalFeedback: number;
};

// Formule de l'ancien getPropertyHealth : 100, -5 par ticket ouvert, -10 par ouvert
// urgent ou haut, -8 par equipement dont l'entretien est passe, -(4 - note moyenne) x 10
// sous 4 etoiles, borne 0..100. Les statuts ouverts sont la liste unique de mgr_inbox.ts
// (to_confirm compris, comme Today et Problems).
export function healthScore(i: HealthInput): Health {
  const open = i.tickets.filter((t) => MGR_OPEN_TICKET_STATUSES.includes(String(t.status ?? "")));
  const urgent = open.filter((t) => t.priority === "urgent" || t.priority === "high");
  const totalCost = i.costs.reduce((s, c) => s + Number(c.amount), 0);
  const avg = i.feedback.length > 0 ? i.feedback.reduce((s, f) => s + Number(f.rating), 0) / i.feedback.length : 0;
  const overdue = i.equipment.filter((e) => e.next_service && String(e.next_service) < i.today);
  const ratingPenalty = avg > 0 && avg < 4 ? (4 - avg) * 10 : 0;
  let score = 100 - open.length * 5 - urgent.length * 10 - overdue.length * 8 - ratingPenalty;
  score = Math.max(0, Math.min(100, score));
  return {
    score, openTickets: open.length, urgentOpen: urgent.length, overdueService: overdue.length, ratingPenalty,
    totalEquipment: i.equipment.length, totalCost, avgRating: Math.round(avg * 10) / 10, totalFeedback: i.feedback.length,
  };
}

// Les quatre tables de la sante d'un logement. Une table illisible compte pour vide
// (comportement de l'ancien handler) et son nom part dans `failed`.
export async function readHealthInputs(sb: any, listingId: string): Promise<{
  tickets: RawTicket[]; equipment: any[]; costs: any[]; feedback: any[]; failed: string[];
}> {
  const failed: string[] = [];
  const safe = async (what: string, p: () => Promise<any[]>) => {
    try { return await p(); } catch (e) { console.error("[mgr.apartment] " + what + ":", e); failed.push(what); return []; }
  };
  const one = async (q: any) => {
    const r = await q;
    if (r?.error) throw new Error(String(r.error.message ?? "read failed"));
    return r?.data ?? [];
  };
  const [tickets, equipment, costs, feedback] = await Promise.all([
    safe("maintenance_tickets", () => readAllRows((a: number, b: number) => sb.from("maintenance_tickets").select(MGR_TICKET_COLS)
      .eq("listing_id", listingId).order("id").range(a, b), "maintenance_tickets")),
    safe("equipment", () => one(sb.from("equipment").select("id, condition, next_service").eq("listing_id", listingId))),
    safe("maintenance_costs", () => one(sb.from("maintenance_costs").select("amount").eq("listing_id", listingId))),
    safe("guest_feedback", () => one(sb.from("guest_feedback").select("rating").eq("listing_id", listingId))),
  ]);
  return { tickets, equipment, costs, feedback, failed: failed.sort() };
}

// ==================== LISTE ====================
export type AptListItem = { id: string; apt: string; bld: string; excluded: boolean };

export async function mgrApartments(sb: any): Promise<{ status: number; body: { listings: AptListItem[] } }> {
  const rows = await readAllRows((a: number, b: number) => sb.from("listing_config")
    .select("listing_id, internal_name, listing_name, apt_number, inspection_excluded").order("listing_id").range(a, b), "listing_config");
  const listings = rows.map((l: any) => ({ id: String(l.listing_id), ...splitListing(l), excluded: !!l.inspection_excluded }))
    .sort((a: AptListItem, b: AptListItem) => a.bld.localeCompare(b.bld) || a.apt.localeCompare(b.apt, undefined, { numeric: true }));
  return { status: 200, body: { listings } };
}

// ==================== FICHE ====================
export type AptCleaning = {
  date: string; guest: string | null; by: string[]; done: boolean; cancelled: boolean; linen: LaundryRow | null;
  extra: string | null;
};
export type AptSecurityGroup = { units: string[]; phone: string | null; emails: string[]; portal: string | null; notes: string[] };
export type AptSection = "cleanings" | "tickets" | "inspections" | "security" | "health";
export type MgrApartment = {
  listing: { id: string; apt: string; bld: string };
  health: { score: number; openTickets: number; urgentOpen: number; overdueService: number; ratingPenalty: number };
  cleanings: AptCleaning[];
  tickets: {
    open: Array<{ ref: string; title: string; priority: string; createdAt: string; assignee: string | null }>;
    recent: Array<{ ref: string; title: string; resolvedAt: string }>;
  };
  inspections: Array<{ id: number; finishedAt: string; inspector: string; result: "clean" | "fixed" | "maintenance"; issues: number }>;
  security: { building: string; groups: AptSecurityGroup[] } | null;
  unavailable: AptSection[];
  generatedAt: string;
};

const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && String(x).trim() !== "").map(String) : []);
// Nom d'immeuble compare sans casse, sans accents, espaces resserres.
export function foldName(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Groupes de l'immeuble, champ par champ : portalPassword et portalId ne sortent jamais.
export function securityFor(doc: any, bld: string): MgrApartment["security"] {
  const want = foldName(bld);
  if (!want || !Array.isArray(doc?.buildings)) return null;
  const b = doc.buildings.find((x: any) => foldName(x?.name) === want);
  if (!b) return null;
  return {
    building: String(b.name),
    groups: (Array.isArray(b.groups) ? b.groups : []).map((g: any) => ({
      units: strs(g?.units), phone: txt(g?.phone) ?? txt(g?.phoneDigits), emails: strs(g?.emails),
      portal: txt(g?.portal), notes: strs(g?.notes),
    })),
  };
}

async function loadCleanings(sb: any, o: {
  listingId: string; from: string; to: string; people: Record<string, { name: string }>;
  loadCheckouts: (start: string, end: string) => Promise<{ reservations: CheckoutRow[]; cachedAt: string | null }>;
}): Promise<{ rows: AptCleaning[]; bookingsFailed: boolean }> {
  let bookingsFailed = false;
  let res: CheckoutRow[] = [];
  try {
    const loaded = await o.loadCheckouts(o.from, o.to);
    res = (loaded.reservations ?? []).filter((r) => r && String(r.listingId ?? "") === o.listingId && r.checkOut &&
      INSP_VALID_STATUSES.includes(String(r.status ?? "")));
  } catch (e) {
    console.error("[mgr.apartment] checkouts failed:", e);
    bookingsFailed = true;
  }
  // Extras du logement (peu nombreux) : la date effective tient compte des reports.
  const extras = (await readAllRows((a: number, b: number) => sb.from("extra_cleanings")
    .select("id, reservation_key, listing_id, cleaning_date, label, guest_name, status")
    .eq("listing_id", o.listingId).order("id").range(a, b), "extra_cleanings"))
    .filter((e: any) => e.reservation_key && e.status !== "cancelled");
  const keys = [...new Set([
    ...res.map((r) => reservationKey({ departure: String(r.checkOut), guest: String(r.guest ?? "") })),
    ...extras.map((e: any) => String(e.reservation_key)),
  ])];
  const [post, asg, done, canc, linen] = await Promise.all([
    byKeys(sb, "cleaning_postponed", "reservation_key, original_date, new_date", keys),
    byKeys(sb, "cleaning_assignments", "reservation_key, cleaner_id", keys),
    byKeys(sb, "menage_done", "reservation_key, done", keys),
    byKeys(sb, "cleaning_cancelled", "reservation_key", keys),
    byKeys(sb, "laundry_counts", ["reservation_key", ...LAUNDRY_FIELDS].join(", "), keys),
  ]);
  const postTo: Record<string, string> = {};
  for (const p of post) if (p.new_date) postTo[String(p.reservation_key)] = String(p.new_date);
  const by: Record<string, string[]> = {};
  for (const a of asg) {
    const n = o.people[String(a.cleaner_id)]?.name ?? "Someone";
    const k = String(a.reservation_key);
    if (!(by[k] ??= []).includes(n)) by[k].push(n);
  }
  const doneSet = new Set(done.filter((r: any) => r.done === true).map((r: any) => String(r.reservation_key)));
  const cancSet = new Set(canc.map((r: any) => String(r.reservation_key)));
  const linenMap: Record<string, LaundryRow> = {};
  for (const l of linen) linenMap[String(l.reservation_key)] = laundryRow(l);

  const out: Array<AptCleaning & { key: string }> = [];
  const seen = new Set<string>();
  const add = (key: string, baseDate: string, guest: string | null, extra: string | null) => {
    if (seen.has(key)) return;
    const date = postTo[key] ?? baseDate;
    if (date < o.from || date > o.to) return;
    seen.add(key);
    out.push({
      key, date, guest, by: by[key] ?? [], done: doneSet.has(key), cancelled: cancSet.has(key),
      linen: linenMap[key] ?? null, extra,
    });
  };
  for (const r of res) add(reservationKey({ departure: String(r.checkOut), guest: String(r.guest ?? "") }), String(r.checkOut), txt(r.guest), null);
  for (const e of extras) add(String(e.reservation_key), String(e.cleaning_date), txt(e.guest_name), String(e.label ?? "Extra cleaning"));
  out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
  return { rows: out.map(({ key: _k, ...c }) => c), bookingsFailed };
}

export async function mgrApartment(sb: any, o: {
  listingId: string; today: string; nowMs: number; me: SessionUser; req: Request;
  loadCheckouts: (start: string, end: string) => Promise<{ reservations: CheckoutRow[]; cachedAt: string | null }>;
}): Promise<{ status: number; body: MgrApartment | { error: string } }> {
  const id = String(o.listingId ?? "").trim();
  if (!id) return { status: 400, body: { error: "listingId required" } };
  const { data: row, error } = await sb.from("listing_config")
    .select("listing_id, internal_name, listing_name, apt_number").eq("listing_id", id).maybeSingle();
  if (error) {
    console.error("[mgr.apartment] listing_config:", error);
    return { status: 503, body: { error: "Could not load this apartment. Try again." } };
  }
  if (!row) return { status: 404, body: { error: "Apartment not found" } };
  const place = splitListing(row);
  const unavailable = new Set<AptSection>();
  const guard = async <T>(section: AptSection, empty: T, p: () => Promise<T>): Promise<T> => {
    try { return await p(); } catch (e) { console.error("[mgr.apartment] " + section + ":", e); unavailable.add(section); return empty; }
  };

  // Noms (cleaners et prestataires) : une panne laisse des noms generiques, pas une section vide.
  const [people, vendors] = await Promise.all([
    guard("cleanings", [] as any[], () => readAllRows((a: number, b: number) => sb.from("cleaners")
      .select("id, name, role, is_active").order("id").range(a, b), "cleaners")),
    guard("tickets", [] as any[], () => readAllRows((a: number, b: number) => sb.from("vendors")
      .select("id, name, specialty, is_active").order("id").range(a, b), "vendors")),
  ]);
  const ppl = peopleMap(people);
  const from = plusDays(o.today, -APT_CLEAN_PAST_DAYS);
  const to = plusDays(o.today, APT_CLEAN_NEXT_DAYS);

  const [hin, cleanings, inspections, security] = await Promise.all([
    readHealthInputs(sb, id),
    guard("cleanings", [] as AptCleaning[], async () => {
      const r = await loadCleanings(sb, { listingId: id, from, to, people: ppl, loadCheckouts: o.loadCheckouts });
      if (r.bookingsFailed) unavailable.add("cleanings");
      return r.rows;
    }),
    guard("inspections", [] as MgrApartment["inspections"], async () => {
      const h = await inspHistory(sb, id, o.today);
      return (h.inspections ?? []).filter((i: any) => i.finishedAt)
        .sort((a: any, b: any) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
        .slice(0, APT_INSPECTIONS_MAX)
        .map((i: any) => {
          const items = Array.isArray(i.items) ? i.items : [];
          const result: "clean" | "fixed" | "maintenance" = !items.length ? "clean"
            : items.some((it: any) => it.outcome === "maintenance") ? "maintenance" : "fixed";
          return { id: Number(i.id), finishedAt: String(i.finishedAt), inspector: String(i.inspector), result, issues: items.length };
        });
    }),
    guard("security", null as MgrApartment["security"], async () => {
      const r = await getSecurityContacts(sb, o.req, async () => o.me);
      if (r.status === 404) return null;
      if (r.status !== 200) throw new Error("security contacts: " + r.status);
      return securityFor(r.body, place.bld);
    }),
  ]);

  if (hin.failed.length) unavailable.add("health");
  if (hin.failed.includes("maintenance_tickets")) unavailable.add("tickets");
  const h = healthScore({ tickets: hin.tickets, equipment: hin.equipment, costs: hin.costs, feedback: hin.feedback, today: o.today });

  const ctx = {
    nowMs: o.nowMs, listings: listingMap([row]), people: ppl, vendors: vendorNames(vendors),
    today: { arrivals: {}, checkouts: {} },
  };
  const open = hin.tickets.filter((t) => MGR_OPEN_TICKET_STATUSES.includes(String(t.status ?? "open")))
    .map((t) => ticketRow(t, ctx))
    .sort((a, b) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
    .map((r) => ({
      ref: r.ref, title: r.title, priority: normPriority(r.priority), createdAt: r.createdAt,
      assignee: r.assignee ? (r.assignee.kind === "vendor" ? "Vendor " + r.assignee.name : r.assignee.name) : null,
    }));
  const since = plusDays(o.today, -APT_RECENT_TICKET_DAYS);
  const recent = hin.tickets
    .filter((t) => RESOLVED.includes(String(t.status ?? "")) && t.resolved_at &&
      Number.isFinite(Date.parse(String(t.resolved_at))) && dubaiDay(new Date(Date.parse(String(t.resolved_at))).toISOString()) >= since)
    .sort((a, b) => Date.parse(String(b.resolved_at)) - Date.parse(String(a.resolved_at)))
    .slice(0, APT_RECENT_TICKET_MAX)
    .map((t) => {
      const r = ticketRow(t, ctx);
      return { ref: r.ref, title: r.title, resolvedAt: String(t.resolved_at) };
    });

  return {
    status: 200,
    body: {
      listing: { id, apt: place.apt, bld: place.bld },
      health: { score: h.score, openTickets: h.openTickets, urgentOpen: h.urgentOpen, overdueService: h.overdueService, ratingPenalty: h.ratingPenalty },
      cleanings, tickets: { open, recent }, inspections, security,
      unavailable: [...unavailable].sort() as AptSection[],
      generatedAt: new Date(o.nowMs).toISOString(),
    },
  };
}
