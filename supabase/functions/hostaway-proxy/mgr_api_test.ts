import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrToday } from "./mgr_api.ts";

const DAY = "2026-10-09";
const NOW = Date.parse("2026-10-09T07:00:00Z");
const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "#000" };
const R = (id: string, guest: string, arrival: string, departure: string) =>
  ({ id, listingId: "L1", guest, arrival, departure, status: "confirmed", checkInTime: 15, checkOutTime: 12 });
const RES = [R("1", "Ann Lee", "2026-10-06", DAY), R("2", "Bob Ray", DAY, "2026-10-12")];
const db = (cfg: any[] = []) => fakeDb({
  app_config: cfg,
  listing_config: [{ listing_id: "L1", internal_name: "308 - Binghatti Lavender" }, { listing_id: "L2", internal_name: "103 - Damac Reva" }],
  maintenance_tickets: [
    { id: 429, listing_id: "L2", title: "Gas not working", priority: "urgent", status: "open", source: "manual",
      assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-07-09T08:00:00Z" },
  ],
  maintenance_proposals: [{ id: 5, listing_id: "L1", title: "Leak", urgency: "urgent", status: "pending" }],
  team_tasks: [
    { id: 13, title: "Buy bulbs", priority: "normal", status: "open", listing_id: null, assigned_cleaner_id: null,
      due_at: null, created_at: "2026-10-01T08:00:00Z", source_ref: null },
  ],
  cleaners: [
    { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 99, name: "Gone", role: "cleaner", is_active: false },
  ],
});
const load = async () => ({ reservations: RES, cachedAt: null });

Deno.test("mgr.today : reponse complete, seuil lu dans app_config", async () => {
  const r = await mgrToday(db([{ key: "mgr_risk_hours", value: "3" }]), { day: DAY, nowMs: NOW, me: ME, loadReservations: load });
  assertEquals(r.status, 200);
  const b: any = r.body;
  assertEquals(Object.keys(b).sort(), [
    "arrivals", "assignable", "bookingsCachedAt", "control", "day", "generatedAt", "maintenance", "me", "problems",
    "riskHours", "strip", "ticketsByListing", "who",
  ]);
  assertEquals([b.day, b.generatedAt, b.riskHours, b.bookingsCachedAt], [DAY, "2026-10-09T07:00:00.000Z", 3, null]);
  assertEquals(b.me, { id: 8, name: "Walter" });
  assertEquals(b.strip, { cleanings: 1, unassigned: 1, arrivals: 1, notReady: 1 });
  assertEquals(b.assignable, [{ id: 4, name: "Faiza", role: "cleaner" }, { id: 12, name: "Elite Cleaning", role: "subcontractor" }]);
  assertEquals(b.arrivals.rows[0].cause, "No cleaner assigned. Checkout 12:00, 3 h turnaround.");
});

Deno.test("mgr.today : seuil invalide, defaut 6 ; Hostaway en cache de secours signale", async () => {
  const r = await mgrToday(db([{ key: "mgr_risk_hours", value: "abc" }]), {
    day: DAY, nowMs: NOW, me: ME, loadReservations: async () => ({ reservations: RES, cachedAt: "2026-10-09T06:12:00Z" }),
  });
  assertEquals([(r.body as any).riskHours, (r.body as any).bookingsCachedAt], [6, "2026-10-09T06:12:00Z"]);
});

Deno.test("mgr.today : Hostaway indisponible sans cache, 503 avec message lisible", async () => {
  const r = await mgrToday(db(), {
    day: DAY, nowMs: NOW, me: ME,
    loadReservations: async () => { throw new Error("Bookings are unavailable right now. Try again in a few minutes."); },
  });
  assertEquals(r, { status: 503, body: { error: "Bookings are unavailable right now. Try again in a few minutes." } });
});

Deno.test("mgr.today : bloc maintenance, problems ne porte plus que les taches d'equipe", async () => {
  const b: any = (await mgrToday(db(), { day: DAY, nowMs: NOW, me: ME, loadReservations: load })).body;
  assertEquals(b.maintenance.counts, { proposals: 1, proposalsUrgent: 1, open: 1, urgent: 1, unassigned: 1 });
  assertEquals(b.maintenance.top.map((t: any) => [t.ref, t.apt, t.bld]), [["MNT-429", "103", "Damac Reva"]]);
  assertEquals(b.problems.top.map((r: any) => r.ref), ["TSK-13"]);
  assertEquals([b.problems.counts.ticketsOpen, b.problems.counts.teamTasksOpen], [0, 1]);
});

Deno.test("mgr.today : lecture maintenance en erreur, maintenance null et le reste de Today servi", async () => {
  const sb = db();
  sb.fail["maintenance_proposals.select"] = { message: "boom" };
  const orig = console.error;
  console.error = () => {};
  let r: any;
  try {
    r = await mgrToday(sb, { day: DAY, nowMs: NOW, me: ME, loadReservations: load });
  } finally {
    console.error = orig;
  }
  assertEquals(r.status, 200);
  assertEquals(r.body.maintenance, null);
  assertEquals([r.body.strip.cleanings, r.body.problems.top.length], [1, 1]);
});
