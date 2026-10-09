import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadControl } from "./mgr_control.ts";
import type { MgrCore } from "./mgr_today.ts";

const DAY = "2026-10-09";
const P = (id: number, name: string, role: string) => ({ id, name, role, active: true });
const core = (nowIso: string): MgrCore => ({
  day: DAY, nowMs: Date.parse(nowIso), riskHours: 6, reservations: [],
  listings: { L1: { apt: "414", bld: "Azizi Riviera 11" }, L2: { apt: "421", bld: "Elysee 1" } },
  people: {
    "4": P(4, "Faiza", "cleaner"), "10": P(10, "Pionah", "cleaner"), "12": P(12, "Elite Cleaning", "subcontractor"),
    "5": P(5, "Ismaël", "manager"), "6": P(6, "Hillal", "manager"), "7": P(7, "Semax", "manager"),
    "11": P(11, "Medini CEO Agent", "system"),
  },
  tickets: [], eliteListings: new Set(), postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras: [],
});
const db = () => fakeDb({
  inspection_proposals: [
    { proposal_date: DAY, listing_id: "L1", claimed_by: 5 }, { proposal_date: DAY, listing_id: "L2", claimed_by: null },
    { proposal_date: "2026-10-08", listing_id: "L1", claimed_by: null },
  ],
  inspections: [
    { id: 1, listing_id: "L1", inspector_id: 6, inspection_date: "2026-10-05", finished_at: null },
    { id: 2, listing_id: "L2", inspector_id: 5, inspection_date: "2026-10-08", finished_at: "2026-10-08T09:00:00Z" },
    { id: 3, listing_id: "L2", inspector_id: 5, inspection_date: DAY, finished_at: "2026-10-09T05:00:00Z" },
    { id: 4, listing_id: "L1", inspector_id: 5, inspection_date: DAY, finished_at: null },
  ],
  menage_done: [
    { reservation_key: "2026-10-08_A", done: true, updated_at: "2026-10-08T12:00:00Z" },
    { reservation_key: "2026-10-08_B", done: true, updated_at: "2026-10-08T13:00:00Z" },
    { reservation_key: "2026-10-05_C", done: true, updated_at: "2026-10-06T10:00:00Z" },
    { reservation_key: "2026-10-09_D", done: true, updated_at: "2026-10-09T05:00:00Z" },
    { reservation_key: "2026-09-20_E", done: true, updated_at: "2026-09-21T10:00:00Z" },
    { reservation_key: "2026-10-07_F", done: false, updated_at: "2026-10-07T10:00:00Z" },
  ],
  cleaning_assignments: [
    { reservation_key: "2026-10-08_A", cleaner_id: 4 }, { reservation_key: "2026-10-08_B", cleaner_id: 4 },
    { reservation_key: "2026-10-08_B", cleaner_id: 10 }, { reservation_key: "2026-10-05_C", cleaner_id: 12 },
    { reservation_key: "2026-10-09_D", cleaner_id: 4 },
  ],
  laundry_counts: [{ reservation_key: "2026-10-08_A" }],
  team_tasks: [
    { id: 13, status: "open", assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00Z" },
    { id: 14, status: "open", assigned_cleaner_id: 7, due_at: "2026-10-01T08:00:00Z" },
    { id: 15, status: "open", assigned_cleaner_id: null, due_at: "2026-10-02T08:00:00Z" },
    { id: 16, status: "open", assigned_cleaner_id: 6, due_at: "2026-12-01T08:00:00Z" },
    { id: 20, status: "done", completed_by_cleaner_id: 6, completed_at: "2026-10-08T06:00:00Z" },
    { id: 21, status: "done", completed_by_cleaner_id: 6, completed_at: "2026-10-09T06:00:00Z" },
  ],
  maintenance_tickets: [
    { id: 1, resolved_at: "2026-10-08T09:00:00Z" }, { id: 2, resolved_at: "2026-10-09T05:00:00Z" },
  ],
});

Deno.test("inspections du jour et inspections jamais finies", async () => {
  const c = await loadControl(db(), core("2026-10-09T07:00:00Z"));
  assertEquals(c.inspections, {
    proposed: 2, claimed: 1, done: 1,
    unfinished: [{ apt: "414", bld: "Azizi Riviera 11", inspector: "Hillal", date: "05/10" }],
  });
});

Deno.test("linge manquant sur 7 jours (aujourd'hui exclu) et taches en retard", async () => {
  const c = await loadControl(db(), core("2026-10-09T07:00:00Z"));
  assertEquals(c.linen, { window: "last 7 days", rows: [
    { name: "Elite Cleaning", missing: 1, total: 1 }, { name: "Faiza", missing: 1, total: 2 }, { name: "Pionah", missing: 1, total: 1 },
  ] });
  assertEquals(c.overdue, { total: 3, rows: [{ name: "Semax", n: 2 }, { name: "Unassigned", n: 1 }] });
});

Deno.test("hier, a 11:00 : Elite pas encore saisi, managers actifs puis inactifs groupes, maintenance", async () => {
  const c = await loadControl(db(), core("2026-10-09T07:00:00Z"));
  assertEquals(c.yesterday, { date: "08/10", rows: [
    { name: "Faiza", text: "2 cleanings done, 1 linen count." },
    { name: "Pionah", text: "1 cleaning done, 0 linen counts." },
    { name: "Elite Cleaning", text: "Not logged yet. Elite logs its jobs around 14:00 the next day." },
    { name: "Hillal", text: "0 inspections done, 1 team task closed." },
    { name: "Ismaël", text: "1 inspection done, 0 team tasks closed." },
    { name: "Semax", text: "No inspection and no team task closed." },
    { name: "Maintenance", text: "1 ticket resolved." },
  ] });
});

Deno.test("hier, a 14:30 : Elite sans job saisi", async () => {
  const c = await loadControl(db(), core("2026-10-09T10:30:00Z"));
  assertEquals(c.yesterday.rows[2], { name: "Elite Cleaning", text: "No cleaning marked done." });
});
