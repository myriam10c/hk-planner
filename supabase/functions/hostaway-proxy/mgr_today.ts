// Today de l'app manager : lecture des tables, blocs « Who does what today » et
// « Ready for today's arrivals » (spec 2026-10-09-hk-manager-app-design.md,
// sections 4 et 5). Les regles de statut vivent dans mgr_rules.ts.
import { plusDays } from "./v3.ts";
import { dubaiDay, INSP_VALID_STATUSES } from "./insp_rules.ts";
import {
  arrivalStatus, byRoleThenName, ddmm, dubaiMs, eliteLogDeadlineMs, hhmm, MGR_DEFAULT_CHECKIN_HOUR,
  MGR_LOOKBACK_DAYS, MGR_USUALLY_ELITE_WINDOW_DAYS, reservationKey, splitListing, usuallyEliteListings,
  type MgrReservation, type PrevCleaning, type Tone,
} from "./mgr_rules.ts";

export const MGR_OPEN_TICKET_STATUSES = ["open", "assigned", "in_progress"];

export type MgrPerson = { id: number; name: string; role: string; active: boolean };
export type MgrTicket = {
  id: number; listingId: string; title: string; priority: string; status: string;
  techId: number | null; vendorId: number | null; createdAt: string; source: string;
};
export type MgrCore = {
  day: string; nowMs: number; riskHours: number;
  reservations: MgrReservation[];
  listings: Record<string, { apt: string; bld: string }>;
  people: Record<string, MgrPerson>;
  tickets: MgrTicket[];
  eliteListings: Set<string>;
  postponed: Record<string, string>;
  assignments: Record<string, Array<{ cleanerId: number; serviceType: string }>>;
  done: Set<string>; started: Set<string>; cancelled: Set<string>;
  extras: Array<{ key: string; listingId: string; label: string }>;
};

// Une lecture ratee leve : Today ne doit jamais afficher un « Ready » calcule
// sur une table manquante. L'appelant rend une erreur, le front garde son cache.
export function readOrThrow(res: any, what: string): any[] {
  if (res?.error) throw new Error("[mgr] " + what + ": " + (res.error.message ?? "read failed"));
  return res?.data ?? [];
}

export async function byKeys(sb: any, table: string, cols: string, keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    out.push(...readOrThrow(await sb.from(table).select(cols).in("reservation_key", keys.slice(i, i + 100)), table));
  }
  return out;
}

function monthsBack(day: string, days: number): string[] {
  const out = new Set<string>();
  for (let d = plusDays(day, -days); d <= day; d = plusDays(d, 1)) out.add(d.slice(0, 7));
  return [...out];
}

export async function loadCore(
  sb: any, a: { day: string; nowMs: number; riskHours: number; reservations: MgrReservation[] },
): Promise<MgrCore> {
  const day = a.day;
  const reservations = a.reservations.filter((r) => INSP_VALID_STATUSES.includes(r.status));
  const from = plusDays(day, -MGR_LOOKBACK_DAYS);
  const extras = readOrThrow(
    await sb.from("extra_cleanings").select("reservation_key, listing_id, label, status").eq("cleaning_date", day),
    "extra_cleanings",
  ).filter((e: any) => e.status !== "cancelled" && e.reservation_key)
    .map((e: any) => ({ key: String(e.reservation_key), listingId: String(e.listing_id ?? ""), label: String(e.label ?? "Extra cleaning") }));
  const keys = [...new Set([
    ...reservations.filter((r) => r.departure >= from && r.departure <= day).map(reservationKey),
    ...extras.map((e: { key: string }) => e.key),
  ])];
  const all = (p: any, what: string) => p.then((r: any) => readOrThrow(r, what));
  const [post, asg, done, timers, canc, listings, people, tickets, acc] = await Promise.all([
    byKeys(sb, "cleaning_postponed", "reservation_key, new_date", keys),
    byKeys(sb, "cleaning_assignments", "reservation_key, cleaner_id, service_type", keys),
    byKeys(sb, "menage_done", "reservation_key, done", keys),
    byKeys(sb, "cleaning_timer", "reservation_key, started_at, finished_at", keys),
    byKeys(sb, "cleaning_cancelled", "reservation_key", keys),
    all(sb.from("listing_config").select("listing_id, internal_name, listing_name, apt_number"), "listing_config"),
    all(sb.from("cleaners").select("id, name, role, is_active"), "cleaners"),
    all(sb.from("maintenance_tickets")
      .select("id, listing_id, title, priority, status, assigned_technician_id, assigned_vendor_id, created_at, source")
      .in("status", MGR_OPEN_TICKET_STATUSES), "maintenance_tickets"),
    all(sb.from("cleaning_accounting_cache").select("month, payload_json")
      .in("month", monthsBack(day, MGR_USUALLY_ELITE_WINDOW_DAYS)), "cleaning_accounting_cache"),
  ]);
  const core: MgrCore = {
    day, nowMs: a.nowMs, riskHours: a.riskHours, reservations,
    listings: Object.fromEntries(listings.map((l: any) => [String(l.listing_id), splitListing(l)])),
    people: Object.fromEntries(people.map((p: any) => [String(p.id), {
      id: Number(p.id), name: String(p.name ?? ""), role: String(p.role ?? ""), active: p.is_active !== false,
    }])),
    tickets: tickets.map((t: any) => ({
      id: Number(t.id), listingId: t.listing_id == null ? "" : String(t.listing_id), title: String(t.title ?? "Ticket"),
      priority: String(t.priority ?? "medium"), status: String(t.status ?? "open"),
      techId: t.assigned_technician_id ?? null, vendorId: t.assigned_vendor_id ?? null,
      createdAt: String(t.created_at ?? ""), source: String(t.source ?? ""),
    })),
    eliteListings: usuallyEliteListings(
      acc.flatMap((r: any) => Array.isArray(r?.payload_json?.rows) ? r.payload_json.rows : []), day),
    postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras,
  };
  for (const p of post) if (p.new_date) core.postponed[String(p.reservation_key)] = String(p.new_date);
  for (const r of asg) {
    (core.assignments[String(r.reservation_key)] ??= []).push({ cleanerId: Number(r.cleaner_id), serviceType: String(r.service_type || "CHC") });
  }
  for (const r of done) if (r.done === true) core.done.add(String(r.reservation_key));
  for (const t of timers) if (t.started_at && !t.finished_at) core.started.add(String(t.reservation_key));
  for (const x of canc) core.cancelled.add(String(x.reservation_key));
  return core;
}

export type MgrNext = { date: string; time: string | null; sameDay: boolean; owner: boolean };
export type MgrJob = {
  key: string; kind: "checkout" | "extra"; listingId: string; apt: string; bld: string;
  checkout: string | null; checkoutDate: string; postponedFrom: string | null;
  next: MgrNext | null;
  assigned: number[]; serviceType: string | null;
  state: "done" | "in_progress" | "not_started";
  tone: Tone; word: string;
};

const place = (c: MgrCore, listingId: string) => c.listings[listingId] ?? { apt: "", bld: "Listing " + listingId };

function nextStay(c: MgrCore, listingId: string, fromDate: string, excludeId: string): MgrNext | null {
  let best: MgrReservation | null = null;
  for (const r of c.reservations) {
    if (r.listingId !== listingId || r.id === excludeId || r.arrival < fromDate) continue;
    if (!best || r.arrival < best.arrival) best = r;
  }
  return best ? { date: best.arrival, time: hhmm(best.checkInTime), sameDay: best.arrival === c.day, owner: best.status === "ownerStay" } : null;
}

function makeJob(
  c: MgrCore, key: string, kind: "checkout" | "extra", listingId: string,
  checkoutDate: string, checkoutHour: number | null, next: MgrNext | null,
): MgrJob {
  const l = place(c, listingId);
  const rows = c.assignments[key] ?? [];
  const assigned = rows.map((r) => r.cleanerId);
  const done = c.done.has(key);
  const state = done ? "done" : c.started.has(key) ? "in_progress" : "not_started";
  const arrMs = next && next.sameDay
    ? dubaiMs(c.day, next.time ? Number(next.time.slice(0, 2)) : MGR_DEFAULT_CHECKIN_HOUR) : null;
  const risk = arrMs != null && arrMs - c.nowMs <= c.riskHours * 3600_000;
  let tone: Tone, word: string;
  if (done) { tone = "ok"; word = "Done"; }
  else if (!assigned.length) {
    const elite = c.eliteListings.has(listingId) && c.nowMs < eliteLogDeadlineMs(c.day);
    tone = elite ? "warn" : "bad";
    word = elite ? "Usually Elite · not logged yet" : "Unassigned";
  } else {
    tone = risk ? "warn" : "idle";
    word = state === "in_progress" ? "In progress" : "Not started";
  }
  return {
    key, kind, listingId, apt: l.apt, bld: l.bld,
    checkout: checkoutDate === c.day ? hhmm(checkoutHour) : null, checkoutDate,
    postponedFrom: checkoutDate !== c.day ? checkoutDate : null,
    next, assigned, serviceType: rows[0]?.serviceType ?? null, state, tone, word,
  };
}

export function buildJobs(c: MgrCore): MgrJob[] {
  const from = plusDays(c.day, -MGR_LOOKBACK_DAYS);
  const seen = new Set<string>();
  const jobs: MgrJob[] = [];
  for (const r of c.reservations) {
    if (r.departure < from || r.departure > c.day) continue;
    const key = reservationKey(r);
    if (seen.has(key) || c.cancelled.has(key) || (c.postponed[key] ?? r.departure) !== c.day) continue;
    seen.add(key);
    jobs.push(makeJob(c, key, "checkout", r.listingId, r.departure, r.checkOutTime, nextStay(c, r.listingId, c.day, r.id)));
  }
  for (const e of c.extras) {
    if (seen.has(e.key) || c.cancelled.has(e.key)) continue;
    seen.add(e.key);
    jobs.push(makeJob(c, e.key, "extra", e.listingId, c.day, null, nextStay(c, e.listingId, c.day, "")));
  }
  return jobs.sort((a, b) =>
    (a.checkout ?? "99").localeCompare(b.checkout ?? "99") || (a.apt + a.bld).localeCompare(b.apt + b.bld));
}

export type MgrWho = {
  jobs: MgrJob[];
  people: Array<{ id: number; name: string; role: string; keys: string[] }>;
  unassigned: string[];
  technicians: Array<{ id: number; name: string; open: number; oldest: { id: number; title: string; since: string } | null }>;
};

const since = (iso: string) => (iso ? ddmm(dubaiDay(iso)) : "");

export function buildWho(c: MgrCore, jobs: MgrJob[]): MgrWho {
  const map = new Map<number, { id: number; name: string; role: string; keys: string[] }>();
  const add = (id: number) => {
    if (!map.has(id)) {
      const p = c.people[String(id)];
      map.set(id, { id, name: p?.name || "Member " + id, role: p?.role || "unknown", keys: [] });
    }
    return map.get(id)!;
  };
  for (const p of Object.values(c.people)) {
    if (p.active && (p.role === "cleaner" || p.role === "subcontractor")) add(p.id);
  }
  for (const j of jobs) for (const id of j.assigned) add(id).keys.push(j.key);
  const people = [...map.values()].sort(byRoleThenName);
  const unassigned = jobs.filter((j) => !j.assigned.length)
    .sort((a, b) =>
      Number(a.state === "done") - Number(b.state === "done") ||
      Number(!a.next?.sameDay) - Number(!b.next?.sameDay) ||
      (a.checkout ?? "99").localeCompare(b.checkout ?? "99"))
    .map((j) => j.key);
  const tech = new Map<number, MgrWho["technicians"][number]>();
  for (const t of [...c.tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (t.techId == null) continue;
    const e = tech.get(t.techId) ?? { id: t.techId, name: c.people[String(t.techId)]?.name || "Member " + t.techId, open: 0, oldest: null };
    e.open++;
    if (!e.oldest) e.oldest = { id: t.id, title: t.title, since: since(t.createdAt) };
    tech.set(t.techId, e);
  }
  return { jobs, people, unassigned, technicians: [...tech.values()].sort((a, b) => b.open - a.open) };
}

export type MgrArrival = {
  id: string; listingId: string; apt: string; bld: string;
  time: string; timeSet: boolean; kind: "Guest" | "Owner stay";
  tone: Tone; word: string; cause: string;
  prevKey: string | null; prevCheckout: { date: string; time: string | null } | null;
  cleaners: string[]; assigned: number[]; serviceType: string | null; done: boolean;
};
export type MgrArrivals = { counts: Record<Tone, number>; rows: MgrArrival[] };
const SEVERITY: Record<Tone, number> = { bad: 0, warn: 1, idle: 2, ok: 3 };

export function buildArrivals(c: MgrCore): MgrArrivals {
  const rows: MgrArrival[] = [];
  for (const a of c.reservations) {
    if (a.arrival !== c.day) continue;
    let prev: MgrReservation | null = null;
    for (const r of c.reservations) {
      if (r.listingId !== a.listingId || r.id === a.id || r.departure > a.arrival) continue;
      if (!prev || r.departure > prev.departure) prev = r;
    }
    const l = place(c, a.listingId);
    const hour = a.checkInTime ?? MGR_DEFAULT_CHECKIN_HOUR;
    let pc: PrevCleaning | null = null;
    let assigned: number[] = [];
    let serviceType: string | null = null;
    if (prev) {
      const key = reservationKey(prev);
      const asg = c.assignments[key] ?? [];
      assigned = asg.map((x) => x.cleanerId);
      serviceType = asg[0]?.serviceType ?? null;
      pc = {
        key, checkoutDate: prev.departure, checkoutHour: prev.checkOutTime,
        cleaningDate: c.postponed[key] ?? prev.departure,
        assignedNames: assigned.map((id) => c.people[String(id)]?.name || "Member " + id),
        done: c.done.has(key), started: c.started.has(key), cancelled: c.cancelled.has(key),
        usuallyElite: c.eliteListings.has(a.listingId),
      };
    }
    const urgent = c.tickets.filter((t) => t.listingId === a.listingId && t.priority === "urgent")
      .map((t) => ({ id: t.id, title: t.title }));
    const st = arrivalStatus({ day: c.day, nowMs: c.nowMs, arrivalMs: dubaiMs(c.day, hour), riskHours: c.riskHours, prev: pc, urgent });
    rows.push({
      id: a.id, listingId: a.listingId, apt: l.apt, bld: l.bld,
      time: hhmm(hour)!, timeSet: a.checkInTime != null, kind: a.status === "ownerStay" ? "Owner stay" : "Guest",
      ...st,
      prevKey: pc ? pc.key : null,
      prevCheckout: prev ? { date: prev.departure, time: hhmm(prev.checkOutTime) } : null,
      cleaners: pc ? pc.assignedNames : [], assigned, serviceType, done: pc ? pc.done : false,
    });
  }
  rows.sort((x, y) => x.time.localeCompare(y.time) || SEVERITY[x.tone] - SEVERITY[y.tone] || x.apt.localeCompare(y.apt));
  const counts: Record<Tone, number> = { ok: 0, warn: 0, bad: 0, idle: 0 };
  for (const r of rows) counts[r.tone]++;
  return { counts, rows };
}

export type MgrTicketLite = { id: number; title: string; priority: string; since: string; tech: string | null };
const PRIO: Record<string, number> = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3 };

export function buildTicketsByListing(c: MgrCore): Record<string, MgrTicketLite[]> {
  const out: Record<string, MgrTicketLite[]> = {};
  const sorted = [...c.tickets].sort((a, b) =>
    (PRIO[a.priority] ?? 2) - (PRIO[b.priority] ?? 2) || a.createdAt.localeCompare(b.createdAt));
  for (const t of sorted) {
    if (!t.listingId) continue;
    (out[t.listingId] ??= []).push({
      id: t.id, title: t.title, priority: t.priority, since: since(t.createdAt),
      tech: t.techId != null ? (c.people[String(t.techId)]?.name ?? null) : null,
    });
  }
  return out;
}
