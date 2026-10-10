import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadProblems, mgrProblems } from "./mgr_problems.ts";
import type { MgrCore } from "./mgr_today.ts";

export const DAY = "2026-10-09";
export const NOW = Date.parse("2026-10-09T07:00:00Z");
export const core: MgrCore = {
  day: DAY, nowMs: NOW, riskHours: 6, reservations: [],
  listings: { L1: { apt: "103", bld: "Damac Reva" }, L2: { apt: "2609", bld: "Nobles by Tiger" }, L3: { apt: "1607", bld: "Central Park JVC" } },
  people: {
    "7": { id: 7, name: "Semax", role: "manager", active: true },
    "8": { id: 8, name: "Walter", role: "manager", active: true },
  },
  tickets: [], eliteListings: new Set(), postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras: [],
};
const arrivals = [{ listingId: "L1", kind: "Guest", time: "15:00" }] as any[];
const jobs = [{ listingId: "L2", kind: "checkout", postponedFrom: null, checkout: "12:00" }] as any[];
const TK = (id: number, listing_id: string | null, title: string, priority: string, created_at: string, o: any = {}) => ({
  id, listing_id, title, priority, status: "open", source: "whatsapp", assigned_technician_id: null, assigned_vendor_id: null,
  created_at, sla_deadline: null, resolved_at: null, ...o,
});
export const db = () => fakeDb({
  maintenance_tickets: [
    TK(429, "L1", "Gas not working", "urgent", "2026-07-09T08:00:00Z"),
    TK(411, "L2", "Bathroom drainage clogged", "urgent", "2026-06-14T08:00:00Z"),
    TK(440, "L3", "Cockroaches reported by guest", "high", "2026-07-15T08:00:00Z", { assigned_vendor_id: 3, status: "assigned" }),
    TK(106, "L3", "Balcony drain blocked", "low", "2026-04-27T08:00:00Z", { assigned_technician_id: 7, status: "assigned" }),
    TK(500, null, "Shower leaking", "medium", "2026-09-01T08:00:00Z", { source: "hk_planner_v3" }),
    TK(501, "L2", "Bedroom: lamp broken", "medium", "2026-10-07T08:00:00Z", { source: "inspection" }),
    TK(502, "L1", "Door handle loose", "high", "2026-10-01T08:00:00Z", { status: "to_confirm" }),
    TK(300, "L1", "Old fixed thing", "urgent", "2026-05-01T08:00:00Z", { status: "resolved" }),
  ],
  team_tasks: [
    { id: 13, title: "AC not cooling", priority: "urgent", status: "open", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00+00:00", created_at: "2026-05-14T08:00:00Z", source_ref: null },
    { id: 14, title: "Buy light bulbs", priority: "normal", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: null, created_at: "2026-10-01T08:00:00Z", source_ref: null },
    { id: 15, title: "Check smoke detector", priority: "low", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: "2026-12-01T08:00:00Z", created_at: "2026-10-01T08:00:00Z", source_ref: null },
    { id: 16, title: "Closed one", priority: "urgent", status: "done", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-01T08:00:00Z", created_at: "2026-05-01T08:00:00Z", source_ref: null },
    { id: 17, title: "🔧 Gas not working", priority: "urgent", status: "open", listing_id: "L1", assigned_cleaner_id: 7, due_at: "2026-07-12T08:00:00Z", created_at: "2026-07-09T09:00:00Z", source_ref: "maint:429" },
    { id: 18, title: "Call owner", priority: "high", status: "in_progress", listing_id: null, assigned_cleaner_id: 8, due_at: null, created_at: "2026-10-05T08:00:00Z", source_ref: null },
  ],
  vendors: [{ id: 3, name: "CoolFix", specialty: "AC", is_active: true }, { id: 2, name: "Old Co", specialty: "", is_active: false }],
  listing_config: [
    { listing_id: "L1", internal_name: "103 - Damac Reva" }, { listing_id: "L2", internal_name: "2609 - Nobles by Tiger" },
    { listing_id: "L3", internal_name: "1607 - Central Park JVC" },
  ],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 4, name: "Faiza", role: "cleaner", is_active: true }, { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 11, name: "Medini CEO Agent", role: "system", is_active: true }, { id: 9, name: "Old Tech", role: "maintenance", is_active: false },
  ],
});

Deno.test("Today, top 5 : urgence, ce qui touche aujourd'hui, le plus ancien ; copie maint:429 jamais listee", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.top.map((x) => x.ref), ["MNT-429", "MNT-411", "TSK-13", "MNT-502", "MNT-440"]);
  assertEquals(p.top[0], {
    ref: "MNT-429", kind: "MNT", id: 429, source: "Maintenance", priority: "urgent", label: "Urgent", tone: "bad",
    title: "Gas not working", status: "open", closed: false, listingId: "L1", apt: "103", bld: "Damac Reva",
    assignee: null, createdAt: "2026-07-09T08:00:00Z", since: "09/07", dueAt: null, due: null, overdue: false, todayBoost: 0,
    why: "A guest arrives today at 15:00. Open since 09/07, no technician assigned.",
  });
  assertEquals(p.top[1].why, "Checkout today at 12:00. Open since 14/06, no technician assigned.");
  assertEquals([p.top[2].source, p.top[2].why, p.top[2].tone], ["Team task", "Assigned to Semax, overdue since 15/05.", "bad"]);
  assertEquals(p.top[3].why, "A guest arrives today at 15:00. Open since 01/10, no technician assigned. Checked by a cleaner, to confirm and close.");
  assertEquals([p.top[4].tone, p.top[4].why], ["warn", "Open since 15/07, sent to vendor CoolFix."]);
});

Deno.test("Today, compteurs : copies exclues, sources inspection et cleaner, retards en temps", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.counts, {
    urgent: 3, ticketsOpen: 7, ticketsUrgent: 2, ticketsNoTech: 5, teamTasksOpen: 4, teamTasksOverdue: 1,
    inspectionTicketsOpen: 1, cleanerReportsOpen: 1,
  });
});

Deno.test("lecture team_tasks en erreur : leve", async () => {
  const sb = db();
  sb.fail["team_tasks.select"] = { message: "boom" };
  let msg = "";
  try { await loadProblems(sb, core, jobs, arrivals); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "[mgr] team_tasks: boom");
});

const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "#000" };
const RESV = [
  { id: "r1", listingId: "L1", guest: "G", arrival: DAY, departure: "2026-10-12", status: "confirmed", checkInTime: 15, checkOutTime: 11 },
  { id: "r2", listingId: "L2", guest: "H", arrival: "2026-10-05", departure: DAY, status: "confirmed", checkInTime: 15, checkOutTime: 12 },
];
const Q = (o: Record<string, unknown> = {}) =>
  ({ urgent: false, mine: false, unassigned: false, listingId: null, source: null, q: "", offset: 0, limit: 50, ...o }) as any;
const list = (sb: any, o: Record<string, unknown> = {}, load: any = async () => ({ reservations: RESV, cachedAt: null })) =>
  mgrProblems(sb, { day: DAY, nowMs: NOW, me: ME, query: Q(o), loadReservations: load });

Deno.test("mgr.problems : meme tri que Today, compteurs globaux, logements, options d'affectation", async () => {
  const r = await list(db());
  assertEquals(r.status, 200);
  const b: any = r.body;
  assertEquals(Object.keys(b).sort(), [
    "apartments", "assignees", "bookingsCachedAt", "bookingsUnavailable", "counts", "day", "generatedAt", "limit", "me",
    "offset", "rows", "total", "vendors",
  ]);
  assertEquals(b.rows.map((x: any) => x.ref), [
    "MNT-429", "MNT-411", "TSK-13", "MNT-502", "MNT-440", "TSK-18", "MNT-501", "MNT-500", "TSK-14", "MNT-106", "TSK-15",
  ]);
  assertEquals([b.total, b.offset, b.limit, b.bookingsUnavailable, b.bookingsCachedAt, b.me], [11, 0, 50, false, null, { id: 8, name: "Walter" }]);
  assertEquals(b.counts, {
    open: 11, urgent: 3, mine: 1, unassigned: 7, overdue: 1,
    bySource: { Maintenance: 5, Inspection: 1, "Cleaner report": 1, "Team task": 4 },
  });
  assertEquals(b.apartments, [
    { listingId: "L1", apt: "103", bld: "Damac Reva", n: 2 },
    { listingId: "L3", apt: "1607", bld: "Central Park JVC", n: 2 },
    { listingId: "L2", apt: "2609", bld: "Nobles by Tiger", n: 2 },
  ]);
  assertEquals(b.assignees, [
    { id: 7, name: "Semax", role: "manager", takesTasks: true },
    { id: 8, name: "Walter", role: "manager", takesTasks: true },
    { id: 4, name: "Faiza", role: "cleaner", takesTasks: false },
  ]);
  assertEquals(b.vendors, [{ id: 3, name: "CoolFix", specialty: "AC" }]);
});

Deno.test("mgr.problems : filtres et pages ; total apres filtre, compteurs avant filtre", async () => {
  const b: any = (await list(db(), { urgent: true, offset: 1, limit: 1 })).body;
  assertEquals([b.total, b.rows.map((x: any) => x.ref), b.counts.open], [3, ["MNT-411"], 11]);
  const m: any = (await list(db(), { mine: true })).body;
  assertEquals(m.rows.map((x: any) => x.ref), ["TSK-18"]);
  const z: any = (await list(db(), { limit: 0 })).body;
  assertEquals([z.rows, z.total, z.counts.urgent], [[], 11, 3]);
});

Deno.test("mgr.problems : Hostaway indisponible, liste servie sans le coup de pouce du jour", async () => {
  const b: any = (await list(db(), {}, async () => { throw new Error("down"); })).body;
  assertEquals(b.bookingsUnavailable, true);
  assertEquals(b.rows.slice(0, 3).map((x: any) => x.ref), ["TSK-13", "MNT-411", "MNT-429"]);
});
