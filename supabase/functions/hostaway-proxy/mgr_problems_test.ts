import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadProblems } from "./mgr_problems.ts";
import type { MgrCore, MgrTicket } from "./mgr_today.ts";

const DAY = "2026-10-09";
const T = (id: number, listingId: string, title: string, priority: string, createdAt: string, o: Partial<MgrTicket> = {}): MgrTicket =>
  ({ id, listingId, title, priority, status: "open", techId: null, vendorId: null, createdAt, source: "manual", ...o });

const core: MgrCore = {
  day: DAY, nowMs: Date.parse("2026-10-09T07:00:00Z"), riskHours: 6, reservations: [],
  listings: { L1: { apt: "103", bld: "Damac Reva" }, L2: { apt: "2609", bld: "Nobles by Tiger" }, L3: { apt: "1607", bld: "Central Park JVC" } },
  people: { "7": { id: 7, name: "Semax", role: "manager", active: true } },
  tickets: [
    T(429, "L1", "Gas not working", "urgent", "2026-07-09T08:00:00Z"),
    T(411, "L2", "Bathroom drainage clogged", "urgent", "2026-06-14T08:00:00Z"),
    T(440, "L3", "Cockroaches reported by guest", "high", "2026-07-15T08:00:00Z"),
    T(106, "L3", "Balcony drain blocked", "low", "2026-04-27T08:00:00Z", { techId: 7 }),
    T(500, "", "Shower leaking", "medium", "2026-09-01T08:00:00Z", { source: "hk_planner_v3" }),
  ],
  eliteListings: new Set(), postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras: [],
};
const arrivals = [{ listingId: "L1", kind: "Guest", time: "15:00" }] as any[];
const jobs = [{ listingId: "L2", kind: "checkout", postponedFrom: null, checkout: "12:00" }] as any[];
const db = () => fakeDb({
  team_tasks: [
    { id: 13, title: "AC not cooling", priority: "urgent", status: "open", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00Z", created_at: "2026-05-14T08:00:00Z" },
    { id: 14, title: "Buy light bulbs", priority: "normal", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: null, created_at: "2026-10-01T08:00:00Z" },
    { id: 15, title: "Check smoke detector", priority: "low", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: "2026-12-01T08:00:00Z", created_at: "2026-10-01T08:00:00Z" },
    { id: 16, title: "Closed one", priority: "urgent", status: "done", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-01T08:00:00Z", created_at: "2026-05-01T08:00:00Z" },
  ],
  inspection_items: [
    { id: 1, status: "not_ok", outcome: null }, { id: 2, status: "not_ok", outcome: null },
    { id: 3, status: "not_ok", outcome: "maintenance" }, { id: 4, status: "ok", outcome: null },
  ],
});

Deno.test("top 5 : urgence, puis ce qui touche aujourd'hui, puis le plus ancien", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.top.map((x) => x.ref), ["MNT-429", "MNT-411", "TSK-13", "MNT-440", "MNT-500"]);
  assertEquals(p.top[0], {
    ref: "MNT-429", source: "Maintenance", priority: "urgent", label: "Urgent", title: "Gas not working",
    listingId: "L1", apt: "103", bld: "Damac Reva",
    why: "A guest arrives today at 15:00. Open since 09/07, no technician assigned.", tone: "bad",
  });
  assertEquals(p.top[1].why, "Checkout today at 12:00. Open since 14/06, no technician assigned.");
  assertEquals([p.top[2].source, p.top[2].why, p.top[2].tone], ["Team task", "Assigned to Semax, overdue since 15/05.", "bad"]);
  assertEquals([p.top[3].tone, p.top[4].tone, p.top[4].apt, p.top[4].bld], ["warn", "warn", "", ""]);
});

Deno.test("compteurs : tickets, urgents, sans technicien, taches, retards, constats, signalements cleaner", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.counts, {
    ticketsOpen: 5, ticketsUrgent: 2, ticketsNoTech: 4, teamTasksOpen: 3, teamTasksOverdue: 1,
    inspectionFindingsOpen: 2, cleanerReportsOpen: 1,
  });
});

Deno.test("lecture team_tasks en erreur : leve", async () => {
  const sb = db();
  sb.fail["team_tasks.select"] = { message: "boom" };
  let msg = "";
  try { await loadProblems(sb, core, jobs, arrivals); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "[mgr] team_tasks: boom");
});
