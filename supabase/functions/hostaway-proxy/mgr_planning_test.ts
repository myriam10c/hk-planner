import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrPlanning, type CheckoutRow, type MgrPlanning } from "./mgr_planning.ts";

const START = "2026-10-05";
const TODAY = "2026-10-09";
const AT_11 = Date.parse("2026-10-09T07:00:00Z"); // vendredi 11:00 Dubai
const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "" };
const C = (listingId: string, guest: string, checkOut: string, o: any = {}): CheckoutRow =>
  ({ listingId, guest, checkOut, checkOutTime: 11, status: "confirmed", nextGuest: null, ...o });

const CHECKOUTS: CheckoutRow[] = [
  C("L1", "Ann Lee", "2026-10-06", { checkOutTime: 12 }),                                     // fait, linge compte
  C("L2", "Bo Ray", TODAY, { nextGuest: { guest: "X", date: TODAY, checkInTime: 15 } }),       // personne, arrivee le jour meme
  C("L9", "Cy Doe", TODAY),                                                                    // Elite habituel, pas encore saisi
  C("L3", "Di Fox", "2026-10-08", { checkOutTime: 0 }),                                        // heure absente, passe non fait
  C("L4", "Ed Gu", "2026-10-07"),                                                              // annule
  C("L5", "Fa Ho", "2026-10-10", { nextGuest: { guest: "Y", date: "2026-10-10", checkInTime: 15 } }), // reporte au 11, apres l'arrivee
  C("L6", "Gi Io", "2026-10-11"),                                                              // reporte au 13 : hors semaine
  C("L7", "Ha Ju", "2026-10-04"),                                                              // reporte du 04 au 05 : entre dans la semaine
  C("L7", "", TODAY, { status: "inquiry" }),                                                   // pas une reservation
];

const seed = () => fakeDb({
  listing_config: [
    { listing_id: "L1", internal_name: "308 - Binghatti Lavender" }, { listing_id: "L2", internal_name: "103 - Damac Reva" },
    { listing_id: "L3", internal_name: "805 - Azizi Riviera 39" }, { listing_id: "L4", internal_name: "404 - Elysee 1" },
    { listing_id: "L5", internal_name: "505 - Tower E" }, { listing_id: "L6", internal_name: "606 - Tower F" },
    { listing_id: "L7", internal_name: "707 - Tower G" }, { listing_id: "L8", internal_name: "808 - Tower H" },
    { listing_id: "L9", internal_name: "909 - Bloom Height" },
  ],
  cleaners: [
    { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 10, name: "Pionah", role: "cleaner", is_active: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 3, name: "Old", role: "cleaner", is_active: false },
    { id: 11, name: "Medini CEO Agent", role: "system", is_active: true },
  ],
  cleaning_assignments: [
    { reservation_key: "2026-10-06_Ann Lee", cleaner_id: 4, service_type: "CHC" },
    { reservation_key: "2026-10-08_Di Fox", cleaner_id: 10, service_type: "CHC" },
    { reservation_key: "2026-10-07_Ed Gu", cleaner_id: 12, service_type: "CHC" },
    { reservation_key: "extra_2026-10-09_mabc", cleaner_id: 10, service_type: "CHC" },
    { reservation_key: "2026-10-10_Fa Ho", cleaner_id: 4 },
  ],
  menage_done: [{ reservation_key: "2026-10-06_Ann Lee", done: true }, { reservation_key: "2026-10-08_Di Fox", done: false }],
  cleaning_timer: [],
  cleaning_cancelled: [{ reservation_key: "2026-10-07_Ed Gu", reason: "Guest extended", cancelled_by: "Walter" }],
  cleaning_postponed: [
    { reservation_key: "2026-10-10_Fa Ho", original_date: "2026-10-10", new_date: "2026-10-11" },
    { reservation_key: "2026-10-11_Gi Io", original_date: "2026-10-11", new_date: "2026-10-13" },
    { reservation_key: "2026-10-04_Ha Ju", original_date: "2026-10-04", new_date: START },
    { reservation_key: "extra_2026-08-01_old", original_date: "2026-08-01", new_date: "2026-10-07" },
  ],
  laundry_counts: [{
    reservation_key: "2026-10-06_Ann Lee", pillowcases: 4, bed_sheets: 2, duvet_covers: 2,
    small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2,
  }],
  extra_cleanings: [
    { id: 31, reservation_key: "extra_2026-10-09_mabc", listing_id: "L8", cleaning_date: TODAY, label: "Deep clean",
      guest_name: "Owner", price_billed: 250, cleaner_price: 120, notes: "Bring the steamer", status: "pending" },
    { id: 32, reservation_key: "extra_2026-10-08_gone", listing_id: "L8", cleaning_date: "2026-10-08", label: "Other", status: "cancelled" },
    { id: 20, reservation_key: "extra_2026-08-01_old", listing_id: "L1", cleaning_date: "2026-08-01", label: "Mid-stay", status: "pending" },
  ],
  leave_requests: [
    { cleaner_id: 4, start_date: "2026-10-10", end_date: "2026-10-12", status: "approved", leave_type: "sick" },
    { cleaner_id: 10, start_date: "2026-10-06", end_date: "2026-10-06", status: "pending" },
    { cleaner_id: 10, start_date: "2026-09-01", end_date: "2026-09-03", status: "approved" },
  ],
  public_holidays: [{ holiday_date: "2026-10-11", name: "Test holiday" }, { holiday_date: "2026-12-02", name: "National Day" }],
  cleaning_accounting_cache: [{ month: "2026-09", payload_json: { rows: [
    { listing_id: "L9", cleaning_date: "2026-09-20" }, { listing_id: "L9", cleaning_date: "2026-09-25" },
  ] } }],
});

async function run(db = seed(), me: any = ME) {
  const r = await mgrPlanning(db, {
    start: START, today: TODAY, nowMs: AT_11, me,
    loadCheckouts: async () => ({ reservations: CHECKOUTS, cachedAt: null }),
  });
  assertEquals(r.status, 200);
  return r.body as MgrPlanning;
}
const byKey = (b: MgrPlanning, k: string) => b.jobs.find((j) => j.key === k)!;

Deno.test("mgr.planning : chaque menage une fois, au jour de sa date effective", async () => {
  const b = await run();
  assertEquals(b.jobs.map((j) => [j.date, j.key]), [
    ["2026-10-05", "2026-10-04_Ha Ju"],
    ["2026-10-06", "2026-10-06_Ann Lee"],
    ["2026-10-07", "2026-10-07_Ed Gu"],
    ["2026-10-07", "extra_2026-08-01_old"],
    ["2026-10-08", "2026-10-08_Di Fox"],
    ["2026-10-09", "2026-10-09_Bo Ray"],
    ["2026-10-09", "2026-10-09_Cy Doe"],
    ["2026-10-09", "extra_2026-10-09_mabc"],
    ["2026-10-11", "2026-10-10_Fa Ho"],
  ]);
  assertEquals([b.start, b.end, b.today], [START, "2026-10-11", TODAY]);
  assertEquals(b.me, { id: 8, name: "Walter" });
  assertEquals(b.counts, { total: 8, unassigned: 4, done: 1, cancelled: 1 });
});

Deno.test("mgr.planning : statuts, heures, reports, linge, extras", async () => {
  const b = await run();
  const ha = byKey(b, "2026-10-04_Ha Ju");
  assertEquals([ha.postponedFrom, ha.checkout, ha.tone, ha.word, ha.apt, ha.bld], ["2026-10-04", null, "bad", "Unassigned", "707", "Tower G"]);
  const ann = byKey(b, "2026-10-06_Ann Lee");
  assertEquals([ann.checkout, ann.state, ann.tone, ann.word, ann.assigned, ann.serviceType], ["12:00", "done", "ok", "Done", [4], "CHC"]);
  assertEquals(ann.laundry, { total: 22, pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2 });
  const ed = byKey(b, "2026-10-07_Ed Gu");
  assertEquals([ed.cancelled, ed.tone, ed.word], [{ reason: "Guest extended", by: "Walter" }, "idle", "Cancelled"]);
  const old = byKey(b, "extra_2026-08-01_old");
  assertEquals([old.kind, old.postponedFrom, old.extra?.cleaningDate, old.word], ["extra", "2026-08-01", "2026-08-01", "Unassigned"]);
  const di = byKey(b, "2026-10-08_Di Fox");
  assertEquals([di.checkout, di.state, di.tone, di.word], [null, "not_started", "warn", "Not marked done"]);
  const bo = byKey(b, "2026-10-09_Bo Ray");
  assertEquals([bo.guest, bo.next, bo.tone], ["Bo Ray", { date: TODAY, time: "15:00", sameDay: true, before: false }, "bad"]);
  assertEquals([byKey(b, "2026-10-09_Cy Doe").tone, byKey(b, "2026-10-09_Cy Doe").word], ["warn", "Not logged yet"]);
  const x = byKey(b, "extra_2026-10-09_mabc");
  assertEquals([x.kind, x.guest, x.next, x.assigned, x.tone, x.word], ["extra", null, null, [10], "idle", "Scheduled"]);
  assertEquals(x.extra, { id: 31, label: "Deep clean", guestName: "Owner", priceBilled: 250, cleanerPrice: 120, notes: "Bring the steamer", cleaningDate: TODAY });
  const fa = byKey(b, "2026-10-10_Fa Ho");
  assertEquals([fa.date, fa.postponedFrom, fa.serviceType, fa.tone, fa.word], ["2026-10-11", "2026-10-10", "CHC", "bad", "Guest arrives first"]);
  assertEquals(fa.next, { date: "2026-10-10", time: "15:00", sameDay: false, before: true });
});

Deno.test("mgr.planning : jours (conges approuves, jour ferie), personnes, conges, logements", async () => {
  const b = await run();
  assertEquals(b.days.map((d) => [d.date, d.holiday, d.off]), [
    ["2026-10-05", null, []], ["2026-10-06", null, []], ["2026-10-07", null, []], ["2026-10-08", null, []],
    ["2026-10-09", null, []], ["2026-10-10", null, [4]], ["2026-10-11", "Test holiday", [4]],
  ]);
  assertEquals(b.people, [
    { id: 4, name: "Faiza", role: "cleaner", slot: "p1", assignable: true },
    { id: 10, name: "Pionah", role: "cleaner", slot: "p2", assignable: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", slot: "sub", assignable: true },
  ]);
  // Le type de conge (donnee sensible) ne sort jamais.
  assertEquals(b.leaves, [{ cleanerId: 4, name: "Faiza", start: "2026-10-10", end: "2026-10-12" }]);
  assertEquals(b.listings.length, 9);
  assertEquals(b.listings[0], { id: "L3", apt: "805", bld: "Azizi Riviera 39" });
});

Deno.test("mgr.planning : Hostaway indisponible, 503 avec message lisible", async () => {
  const r = await mgrPlanning(seed(), {
    start: START, today: TODAY, nowMs: AT_11, me: ME,
    loadCheckouts: async () => { throw new Error("Hostaway API error 502"); },
  });
  assertEquals(r.status, 503);
  assertEquals(r.body, { error: "Bookings are unavailable right now. Try again in a few minutes." });
});

Deno.test("mgr.planning : une table illisible leve (jamais une semaine calculee a moitie)", async () => {
  const db = seed();
  db.fail["cleaning_assignments.select"] = { message: "boom" };
  let err = "";
  try { await run(db); } catch (e) { err = (e as Error).message; }
  assertEquals(err, "[mgr] cleaning_assignments: boom");
});

Deno.test("S6 : role maintenance = prix des extras omis (null), le reste de l'extra garde", async () => {
  const b = await run(seed(), { cleaner_id: 7, name: "Semax", role: "maintenance", color: "" });
  const x = byKey(b, "extra_2026-10-09_mabc");
  assertEquals(x.extra, { id: 31, label: "Deep clean", guestName: "Owner", priceBilled: null, cleanerPrice: null, notes: "Bring the steamer", cleaningDate: TODAY });
});
