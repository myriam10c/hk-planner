// Bloc Maintenance de Today (phase 2, tache 2) : memes regles que mnt.list.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadTodayMaintenance } from "./mgr_today_mnt.ts";

const NOW = Date.parse("2026-10-09T07:00:00Z");
const LISTINGS = { L1: { apt: "308", bld: "Binghatti Lavender" }, L2: { apt: "103", bld: "Damac Reva" } };
const PEOPLE = {
  "7": { id: 7, name: "Semax", role: "maintenance", active: true },
  "8": { id: 8, name: "Walter", role: "manager", active: true },
};
const TK = (id: number, priority: string, created_at: string, o: any = {}) => ({
  id, listing_id: "L1", title: "T" + id, category: null, priority, status: "open", source: "manual",
  assigned_technician_id: null, assigned_vendor_id: null, created_at, started_at: null, resolved_at: null, closed_at: null,
  resolution_notes: null, actual_cost: null, proposal_id: null, due_on: null, ...o,
});
const PR = (id: number, urgency: string, status = "pending") => ({
  id, listing_id: "L1", title: "P" + id, category: "plumbing", urgency, status, quotes: [], conversation_id: "c" + id,
  created_at: "2026-10-08T08:00:00Z", updated_at: "2026-10-08T08:00:00Z",
});
const db = () => fakeDb({
  maintenance_tickets: [
    TK(1, "medium", "2026-09-01T08:00:00Z", { assigned_technician_id: 7, status: "assigned" }),
    TK(2, "high", "2026-10-05T08:00:00Z", { listing_id: "L2", source: "guest_message", status: "in_progress", assigned_vendor_id: 3 }),
    TK(3, "urgent", "2026-10-08T08:00:00Z", { source: "inspection" }),
    TK(4, "high", "2026-09-20T08:00:00Z", { status: "waiting_parts", source: "hk_planner_v3" }),
    TK(5, "low", "2026-01-01T08:00:00Z"),
    TK(6, "urgent", "2026-10-01T08:00:00Z", { status: "to_confirm", assigned_technician_id: 7 }),
    TK(7, "medium", "2026-08-01T08:00:00Z"),
    TK(8, "urgent", "2026-01-01T08:00:00Z", { status: "resolved", resolved_at: "2026-10-01T08:00:00Z" }),
    TK(9, "urgent", "2026-01-01T08:00:00Z", { status: "cancelled" }),
  ],
  maintenance_proposals: [PR(1, "urgent"), PR(2, "normal"), PR(3, "high"), PR(4, "urgent", "rejected"), PR(5, "urgent", "accepted")],
  vendors: [{ id: 3, name: "CoolFix", is_active: true }],
});
const load = (sb: any) => loadTodayMaintenance(sb, { nowMs: NOW, listings: LISTINGS, people: PEOPLE });

Deno.test("bloc Maintenance : compteurs (propositions en attente, ouverts, urgents, sans intervenant)", async () => {
  const m = await load(db());
  assertEquals(m!.counts, { proposals: 3, proposalsUrgent: 1, open: 7, urgent: 2, unassigned: 4 });
});

Deno.test("bloc Maintenance : 5 tickets ouverts, urgent puis high puis le plus ancien, lignes de mnt.list", async () => {
  const m = await load(db());
  assertEquals(m!.top.map((t) => t.ref), ["MNT-6", "MNT-3", "MNT-4", "MNT-2", "MNT-7"]);
  assertEquals(m!.top[0], {
    id: 6, ref: "MNT-6", listingId: "L1", apt: "308", bld: "Binghatti Lavender", title: "T6", category: null,
    priority: "urgent", status: "to_confirm", stage: "to_confirm", origin: "manual",
    assignee: { kind: "member", id: 7, name: "Semax" }, dueOn: null, createdAt: "2026-10-01T08:00:00Z", startedAt: null,
    resolvedAt: null, resolvedBy: null, resolutionNotes: null, actualCost: null, proposalId: null,
  });
  assertEquals([m!.top[1].origin, m!.top[1].stage, m!.top[1].assignee], ["inspection", "todo", null]);
  assertEquals([m!.top[2].origin, m!.top[2].stage], ["cleaner_report", "waiting_parts"]);
  assertEquals([m!.top[3].origin, m!.top[3].stage, m!.top[3].apt, m!.top[3].assignee],
    ["guest_message", "in_progress", "103", { kind: "vendor", id: 3, name: "CoolFix" }]);
});

Deno.test("bloc Maintenance : lecture en erreur, null et erreur journalisee", async () => {
  for (const t of ["maintenance_tickets", "maintenance_proposals", "vendors"]) {
    const sb = db();
    sb.fail[t + ".select"] = { message: "boom" };
    const logs: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { logs.push(a); };
    try {
      assertEquals(await load(sb), null, t);
    } finally {
      console.error = orig;
    }
    assertEquals(logs.length, 1, t);
    assertEquals(String(logs[0][0]), "[mgr_today_mnt] maintenance block failed:");
  }
});

Deno.test("bloc Maintenance : rien d'ouvert, compteurs a zero et top vide", async () => {
  const m = await load(fakeDb({}));
  assertEquals(m, { counts: { proposals: 0, proposalsUrgent: 0, open: 0, urgent: 0, unassigned: 0 }, top: [] });
});
