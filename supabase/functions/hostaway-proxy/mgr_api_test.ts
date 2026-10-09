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
  listing_config: [{ listing_id: "L1", internal_name: "308 - Binghatti Lavender" }],
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
    "arrivals", "assignable", "bookingsCachedAt", "control", "day", "generatedAt", "me", "problems",
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
