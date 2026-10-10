// Action mgr.planning : la semaine de menages en un appel (spec 2026-10-09,
// sections 4, 6 et 9.3). Lecture seule : les gestes passent par les actions
// existantes (assignCleaner, setDone, setCancelled, setPostponed,
// saveLaundryCount, add/update/deleteExtraCleaning), aucune logique d'ecriture ici.
// Les departs viennent du meme chemin que l'ancien Planner (checkouts et son
// cache serveur), injecte par index.ts.
import type { SessionUser } from "./auth.ts";
import { plusDays } from "./v3.ts";
import { INSP_VALID_STATUSES } from "./insp_rules.ts";
import {
  byRoleThenName, hhmm, MGR_USUALLY_ELITE_WINDOW_DAYS, reservationKey, splitListing, usuallyEliteListings, type Tone,
} from "./mgr_rules.ts";
import { byKeys, monthsBack, peopleMap, readAllRows, readOrThrow } from "./mgr_today.ts";
import {
  hourOrNull, LAUNDRY_FIELDS, laundryRow, personSlots, planStatus, weekDays, type LaundryRow, type PlanState,
} from "./mgr_planning_rules.ts";

export type CheckoutRow = {
  guest?: string | null; listingId?: string | null; checkOut?: string | null; checkOutTime?: unknown;
  status?: string | null; nextGuest?: { date?: string | null; checkInTime?: unknown; [k: string]: unknown } | null;
};
export type PlanNext = { date: string; time: string | null; sameDay: boolean; before: boolean };
export type PlanExtra = {
  id: number; label: string; guestName: string | null; priceBilled: number | null;
  cleanerPrice: number | null; notes: string | null; cleaningDate: string;
};
export type PlanJob = {
  key: string; kind: "checkout" | "extra"; listingId: string; apt: string; bld: string;
  date: string; postponedFrom: string | null; checkout: string | null; guest: string | null;
  next: PlanNext | null; assigned: number[]; serviceType: string | null; state: PlanState;
  cancelled: { reason: string; by: string } | null; laundry: LaundryRow | null; extra: PlanExtra | null;
  tone: Tone; word: string;
};
export type MgrPlanning = {
  start: string; end: string; today: string; generatedAt: string; bookingsAt: string;
  me: { id: number; name: string };
  days: Array<{ date: string; holiday: string | null; off: number[] }>;
  jobs: PlanJob[];
  people: Array<{ id: number; name: string; role: string; slot: string; assignable: boolean }>;
  leaves: Array<{ cleanerId: number; name: string; start: string; end: string }>;
  listings: Array<{ id: string; apt: string; bld: string }>;
  counts: { total: number; unassigned: number; done: number; cancelled: number };
};

const EXTRA_COLS = "id, reservation_key, listing_id, cleaning_date, label, guest_name, price_billed, cleaner_price, notes, status";
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));
const TEAM = (role: string) => role === "cleaner" || role === "subcontractor";

export async function mgrPlanning(sb: any, o: {
  start: string; today: string; nowMs: number; me: SessionUser;
  loadCheckouts: (start: string, end: string) => Promise<{ reservations: CheckoutRow[]; cachedAt: string | null }>;
}): Promise<{ status: number; body: MgrPlanning | { error: string } }> {
  const days = weekDays(o.start);
  const end = days[6];
  let loaded: { reservations: CheckoutRow[]; cachedAt: string | null };
  try {
    loaded = await o.loadCheckouts(o.start, end);
  } catch (e) {
    console.error("[mgr.planning] checkouts failed:", e);
    return { status: 503, body: { error: "Bookings are unavailable right now. Try again in a few minutes." } };
  }
  const res = (loaded.reservations ?? []).filter((r) =>
    r && r.listingId && r.checkOut && INSP_VALID_STATUSES.includes(String(r.status ?? "")));

  // Extras : ceux dont la date tombe pres de la semaine, plus ceux reportes dans
  // la semaine depuis plus loin (leur date d'origine est hors de la premiere lecture).
  const extrasWin = await readAllRows((a: number, b: number) => sb.from("extra_cleanings").select(EXTRA_COLS)
    .gte("cleaning_date", plusDays(o.start, -31)).lte("cleaning_date", end).order("id").range(a, b), "extra_cleanings");
  const postIn = await readAllRows((a: number, b: number) => sb.from("cleaning_postponed")
    .select("reservation_key, original_date, new_date")
    .gte("new_date", o.start).lte("new_date", end).order("reservation_key").range(a, b), "cleaning_postponed");
  const known = new Set(extrasWin.map((e: any) => String(e.reservation_key)));
  const missing = postIn.map((p: any) => String(p.reservation_key)).filter((k: string) => k.startsWith("extra_") && !known.has(k));
  const extras = [...extrasWin, ...(missing.length ? await byKeys(sb, "extra_cleanings", EXTRA_COLS, missing) : [])]
    .filter((e: any) => e.reservation_key && e.status !== "cancelled");

  const keys = [...new Set([
    ...res.map((r) => reservationKey({ departure: String(r.checkOut), guest: String(r.guest ?? "") })),
    ...extras.map((e: any) => String(e.reservation_key)),
  ])];
  const all = (p: any, what: string) => p.then((r: any) => readOrThrow(r, what));
  const [post, asg, done, timers, canc, linen, listings, people, leaves, hols, acc] = await Promise.all([
    byKeys(sb, "cleaning_postponed", "reservation_key, original_date, new_date", keys),
    byKeys(sb, "cleaning_assignments", "reservation_key, cleaner_id, service_type", keys),
    byKeys(sb, "menage_done", "reservation_key, done", keys),
    byKeys(sb, "cleaning_timer", "reservation_key, started_at, finished_at", keys),
    byKeys(sb, "cleaning_cancelled", "reservation_key, reason, cancelled_by", keys),
    byKeys(sb, "laundry_counts", ["reservation_key", ...LAUNDRY_FIELDS].join(", "), keys),
    readAllRows((a: number, b: number) => sb.from("listing_config")
      .select("listing_id, internal_name, listing_name, apt_number").order("listing_id").range(a, b), "listing_config"),
    readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, is_active").order("id").range(a, b), "cleaners"),
    all(sb.from("leave_requests").select("cleaner_id, start_date, end_date")
      .eq("status", "approved").lte("start_date", end).gte("end_date", o.start), "leave_requests"),
    all(sb.from("public_holidays").select("holiday_date, name").gte("holiday_date", o.start).lte("holiday_date", end), "public_holidays"),
    all(sb.from("cleaning_accounting_cache").select("month, payload_json")
      .in("month", monthsBack(o.today, MGR_USUALLY_ELITE_WINDOW_DAYS)), "cleaning_accounting_cache"),
  ]);

  const postMap: Record<string, { from: string | null; to: string }> = {};
  for (const p of post) {
    if (p.new_date) postMap[String(p.reservation_key)] = { from: p.original_date ? String(p.original_date) : null, to: String(p.new_date) };
  }
  const asgMap: Record<string, Array<{ id: number; st: string }>> = {};
  for (const r of asg) (asgMap[String(r.reservation_key)] ??= []).push({ id: Number(r.cleaner_id), st: String(r.service_type || "CHC") });
  const doneSet = new Set(done.filter((r: any) => r.done === true).map((r: any) => String(r.reservation_key)));
  const startedSet = new Set(timers.filter((t: any) => t.started_at && !t.finished_at).map((t: any) => String(t.reservation_key)));
  const cancMap: Record<string, { reason: string; by: string }> = {};
  for (const c of canc) cancMap[String(c.reservation_key)] = { reason: String(c.reason ?? ""), by: String(c.cancelled_by ?? "") };
  const linenMap: Record<string, LaundryRow> = {};
  for (const l of linen) linenMap[String(l.reservation_key)] = laundryRow(l);
  const place: Record<string, { apt: string; bld: string }> = {};
  for (const l of listings) place[String(l.listing_id)] = splitListing(l);
  const ppl = peopleMap(people);
  const elite = usuallyEliteListings(
    acc.flatMap((r: any) => Array.isArray(r?.payload_json?.rows) ? r.payload_json.rows : []), o.today);

  const jobs: PlanJob[] = [];
  const seen = new Set<string>();
  const add = (
    key: string, kind: "checkout" | "extra", listingId: string, baseDate: string, hour: number | null,
    guest: string | null, nx: { date: string; hour: number | null } | null, extra: PlanExtra | null,
  ) => {
    if (seen.has(key)) return;
    const pm = postMap[key];
    const date = pm ? pm.to : baseDate;
    if (date < o.start || date > end) return;
    seen.add(key);
    const rows = asgMap[key] ?? [];
    const state: PlanState = doneSet.has(key) ? "done" : startedSet.has(key) ? "in_progress" : "not_started";
    const next = nx ? { date: nx.date, time: hhmm(nx.hour), sameDay: nx.date === date, before: nx.date < date } : null;
    const cancelled = cancMap[key] ?? null;
    const st = planStatus({
      date, today: o.today, nowMs: o.nowMs, assigned: rows.length, state,
      cancelled: !!cancelled, usuallyElite: elite.has(listingId), nextBefore: !!next?.before,
    });
    const l = place[listingId] ?? { apt: "", bld: "Listing " + listingId };
    jobs.push({
      key, kind, listingId, apt: l.apt, bld: l.bld, date,
      postponedFrom: pm ? (pm.from ?? baseDate) : null,
      checkout: pm ? null : hhmm(hour), guest, next,
      assigned: rows.map((r) => r.id), serviceType: rows[0]?.st ?? null, state, cancelled,
      laundry: linenMap[key] ?? null, extra, tone: st.tone, word: st.word,
    });
  };
  for (const r of res) {
    const key = reservationKey({ departure: String(r.checkOut), guest: String(r.guest ?? "") });
    const ng = r.nextGuest && r.nextGuest.date ? { date: String(r.nextGuest.date), hour: hourOrNull(r.nextGuest.checkInTime) } : null;
    add(key, "checkout", String(r.listingId), String(r.checkOut), hourOrNull(r.checkOutTime), txt(r.guest), ng, null);
  }
  for (const e of extras) {
    add(String(e.reservation_key), "extra", String(e.listing_id ?? ""), String(e.cleaning_date), null, null, null, {
      id: Number(e.id), label: String(e.label ?? "Extra cleaning"), guestName: txt(e.guest_name),
      priceBilled: num(e.price_billed), cleanerPrice: num(e.cleaner_price), notes: txt(e.notes), cleaningDate: String(e.cleaning_date),
    });
  }
  jobs.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.checkout ?? "99").localeCompare(b.checkout ?? "99") ||
    (a.apt + a.bld).localeCompare(b.apt + b.bld) || a.key.localeCompare(b.key));

  const used = new Set<number>(jobs.flatMap((j) => j.assigned));
  const slots = personSlots(Object.values(ppl));
  const peopleOut = Object.values(ppl)
    .filter((p) => (TEAM(p.role) && p.active) || used.has(p.id))
    .sort(byRoleThenName)
    .map((p) => ({ id: p.id, name: p.name, role: p.role, slot: slots[String(p.id)] ?? "other", assignable: TEAM(p.role) && p.active }));
  const leavesOut = leaves
    .filter((l: any) => ppl[String(l.cleaner_id)] && ppl[String(l.cleaner_id)].role !== "system")
    .map((l: any) => ({ cleanerId: Number(l.cleaner_id), name: ppl[String(l.cleaner_id)].name, start: String(l.start_date), end: String(l.end_date) }))
    .sort((a: any, b: any) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const live = jobs.filter((j) => !j.cancelled);
  const generatedAt = new Date(o.nowMs).toISOString();
  return {
    status: 200,
    body: {
      start: o.start, end, today: o.today, generatedAt, bookingsAt: loaded.cachedAt ?? generatedAt,
      me: { id: o.me.cleaner_id, name: o.me.name },
      days: days.map((date) => ({
        date,
        holiday: (hols.find((h: any) => String(h.holiday_date) === date)?.name as string | undefined) ?? null,
        off: [...new Set<number>(leavesOut.filter((l: any) => l.start <= date && l.end >= date).map((l: any) => l.cleanerId as number))]
          .sort((a, b) => a - b),
      })),
      jobs, people: peopleOut, leaves: leavesOut,
      listings: Object.entries(place).map(([id, l]) => ({ id, apt: l.apt, bld: l.bld }))
        .sort((a, b) => a.bld.localeCompare(b.bld) || a.apt.localeCompare(b.apt, undefined, { numeric: true })),
      counts: {
        total: live.length,
        unassigned: live.filter((j) => !j.assigned.length && j.state !== "done").length,
        done: live.filter((j) => j.state === "done").length,
        cancelled: jobs.length - live.length,
      },
    },
  };
}
