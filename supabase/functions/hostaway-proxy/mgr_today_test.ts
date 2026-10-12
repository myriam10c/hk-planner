import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { buildArrivals, buildJobs, buildTicketsByListing, buildWho, loadCore, readAllRows } from "./mgr_today.ts";

const DAY = "2026-10-09";
const AT_11 = Date.parse("2026-10-09T07:00:00Z");   // 11:00 Dubai
const AT_1430 = Date.parse("2026-10-09T10:30:00Z"); // 14:30 Dubai
const R = (id: string, listingId: string, guest: string, arrival: string, departure: string, o: any = {}) =>
  ({ id, listingId, guest, arrival, departure, status: "confirmed", checkInTime: 15, checkOutTime: 12, ...o });

const RES = [
  R("1", "L1", "Ann Lee", "2026-10-06", DAY),                                  // depart du jour, non assigne
  R("2", "L1", "Bob Ray", DAY, "2026-10-12"),                                  // arrivee du jour
  R("3", "L2", "Cy Doe", "2026-10-07", DAY, { checkOutTime: null }),           // depart 00:00 dans Hostaway
  R("4", "L2", "Di Fox", DAY, "2026-10-11"),
  R("5", "L3", "Ed Gu", "2026-10-04", "2026-10-08"),                           // Elite, saisi demain
  R("6", "L3", "Owner", DAY, "2026-10-15", { status: "ownerStay", checkInTime: 16 }),
  R("7", "L4", "Fa Ho", "2026-10-01", "2026-10-05"),                           // fait par Elite
  R("8", "L4", "Gi Io", DAY, "2026-10-13"),
  R("9", "L5", "Ha Ju", "2026-10-06", DAY),                                    // menage annule
  R("10", "L6", "In Ka", DAY, "2026-10-10", { status: "inquiry" }),           // pas une arrivee
  R("11", "L7", "Jo La", "2026-10-03", "2026-10-07"),                          // reporte au jour
  R("12", "L9", "Lu Mo", "2026-10-05", DAY),                                   // Elite habituel, depart du jour
];

const seed = () => fakeDb({
  listing_config: [
    { listing_id: "L1", internal_name: "101 - Tower A" }, { listing_id: "L2", internal_name: "202 - Tower B" },
    { listing_id: "L3", internal_name: "303 - Tower C" }, { listing_id: "L4", internal_name: "404 - Tower D" },
    { listing_id: "L5", internal_name: "505 - Tower E" }, { listing_id: "L7", internal_name: "707 - Tower G" },
    { listing_id: "L8", internal_name: "808 - Tower H" }, { listing_id: "L9", internal_name: "909 - Tower J" },
  ],
  cleaners: [
    { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 10, name: "Pionah", role: "cleaner", is_active: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 7, name: "Semax", role: "manager", is_active: true },
    { id: 11, name: "Medini CEO Agent", role: "system", is_active: true },
  ],
  cleaning_assignments: [
    { reservation_key: "2026-10-09_Cy Doe", cleaner_id: 4, service_type: "CHC" },
    { reservation_key: "2026-10-05_Fa Ho", cleaner_id: 12, service_type: "CHC" },
  ],
  menage_done: [{ reservation_key: "2026-10-05_Fa Ho", done: true }],
  cleaning_cancelled: [{ reservation_key: "2026-10-09_Ha Ju" }],
  cleaning_postponed: [{ reservation_key: "2026-10-07_Jo La", original_date: "2026-10-07", new_date: DAY }],
  extra_cleanings: [{ reservation_key: "extra_2026-10-09_deep", listing_id: "L8", cleaning_date: DAY, label: "Deep clean", status: "pending" }],
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent", status: "open", assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-07-09T08:00:00Z", source: "manual" },
    { id: 106, listing_id: "L4", title: "Balcony drain blocked", priority: "low", status: "assigned", assigned_technician_id: 7, assigned_vendor_id: null, created_at: "2026-04-27T08:00:00Z", source: "manual" },
    { id: 300, listing_id: "L4", title: "Old fixed thing", priority: "urgent", status: "resolved", created_at: "2026-05-01T08:00:00Z" },
  ],
  cleaning_accounting_cache: [{ month: "2026-09", payload_json: { rows: [
    { listing_id: "L3", cleaning_date: "2026-09-20" }, { listing_id: "L3", cleaning_date: "2026-09-28" },
    { listing_id: "L9", cleaning_date: "2026-09-22" }, { listing_id: "L9", cleaning_date: "2026-10-01" },
    { listing_id: "L4", cleaning_date: "2026-09-21" },
  ] } }],
});

const core = (nowMs: number) => loadCore(seed(), { day: DAY, nowMs, riskHours: 6, reservations: RES });

Deno.test("menages du jour : departs, report, extra ; annule et inquiry exclus ; heure 00:00 non inventee", async () => {
  const jobs = buildJobs(await core(AT_11));
  assertEquals(jobs.map((j) => j.key), [
    "2026-10-09_Ann Lee", "2026-10-09_Lu Mo", "2026-10-09_Cy Doe", "2026-10-07_Jo La", "extra_2026-10-09_deep",
  ]);
  const by = Object.fromEntries(jobs.map((j) => [j.key, j]));
  assertEquals(by["2026-10-09_Ann Lee"].checkout, "12:00");
  assertEquals(by["2026-10-09_Ann Lee"].next, { date: DAY, time: "15:00", sameDay: true, owner: false });
  assertEquals([by["2026-10-09_Ann Lee"].tone, by["2026-10-09_Ann Lee"].word], ["bad", "Unassigned"]);
  assertEquals(by["2026-10-09_Cy Doe"].checkout, null);
  assertEquals(by["2026-10-09_Cy Doe"].assigned, [4]);
  assertEquals([by["2026-10-09_Cy Doe"].tone, by["2026-10-09_Cy Doe"].word], ["warn", "Not started"]);
  assertEquals([by["2026-10-09_Lu Mo"].tone, by["2026-10-09_Lu Mo"].word], ["warn", "Not logged yet"]);
  assertEquals(by["2026-10-07_Jo La"].postponedFrom, "2026-10-07");
  assertEquals(by["2026-10-07_Jo La"].checkout, null);
  assertEquals(by["extra_2026-10-09_deep"].kind, "extra");
});

Deno.test("Who does what : personnes, non assignes (arrivee du jour d'abord), techniciens", async () => {
  const c = await core(AT_11);
  const who = buildWho(c, buildJobs(c));
  assertEquals(who.people, [
    { id: 4, name: "Faiza", role: "cleaner", keys: ["2026-10-09_Cy Doe"] },
    { id: 10, name: "Pionah", role: "cleaner", keys: [] },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", keys: [] },
  ]);
  assertEquals(who.unassigned, ["2026-10-09_Ann Lee", "2026-10-09_Lu Mo", "2026-10-07_Jo La", "extra_2026-10-09_deep"]);
  assertEquals(who.technicians, [{ id: 7, name: "Semax", open: 1, oldest: { id: 106, title: "Balcony drain blocked", since: "27/04" } }]);
});

Deno.test("arrivees a 11:00 : bloque, a risque (00:00), pret, sejour proprietaire Elite pas encore saisi", async () => {
  const a = buildArrivals(await core(AT_11));
  assertEquals(a.rows.map((r) => [r.apt, r.time, r.kind, r.tone, r.cause]), [
    ["101", "15:00", "Guest", "bad", "No cleaner assigned, and urgent ticket open: Gas not working (MNT-429)."],
    ["202", "15:00", "Guest", "warn", "Not started yet, Faiza. Guest in 4 h, checkout time not set."],
    ["404", "15:00", "Guest", "ok", "Cleaned by Elite Cleaning after the 05/10 checkout."],
    ["303", "16:00", "Owner stay", "warn", "Not logged yet. Elite logs its jobs the next day around 14:00."],
  ]);
  assertEquals(a.counts, { ok: 1, warn: 2, bad: 1, idle: 0 });
  const l2 = a.rows[1];
  assertEquals([l2.prevKey, l2.prevCheckout, l2.assigned, l2.serviceType, l2.cleaners],
    ["2026-10-09_Cy Doe", { date: DAY, time: null }, [4], "CHC", ["Faiza"]]);
});

Deno.test("arrivees a 14:30 : Elite pas saisi passe au rouge", async () => {
  const a = buildArrivals(await core(AT_1430));
  const l3 = a.rows.find((r) => r.apt === "303")!;
  assertEquals([l3.tone, l3.cause], ["bad", "No cleaner assigned. Checkout 08/10."]);
});

Deno.test("tickets ouverts par logement, urgents d'abord", async () => {
  const t = buildTicketsByListing(await core(AT_11));
  assertEquals(t, {
    L1: [{ id: 429, title: "Gas not working", priority: "urgent", since: "09/07", tech: null }],
    L4: [{ id: 106, title: "Balcony drain blocked", priority: "low", since: "27/04", tech: "Semax" }],
  });
});

Deno.test("lectures paginees : au-dela de 1000 lignes rien n'est perdu", async () => {
  const many = Array.from({ length: 1205 }, (_, i) => ({ listing_id: "X" + i, internal_name: (i + 1) + " - Tower" }));
  const sb = fakeDb({ listing_config: many }, { maxRows: 1000 });
  const c = await loadCore(sb, { day: DAY, nowMs: AT_11, riskHours: 6, reservations: [] });
  assertEquals(Object.keys(c.listings).length, 1205);
  assertEquals(c.listings["X1204"], { apt: "1205", bld: "Tower" });
});

Deno.test("readAllRows : pages explicites, erreur levee avec le nom de la table", async () => {
  const sb = fakeDb({ t: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }, { maxRows: 2 });
  const rows = await readAllRows((a, b) => sb.from("t").select("id").order("id").range(a, b), "t", 2);
  assertEquals(rows.map((r) => r.id), [1, 2, 3, 4, 5]);
  sb.fail["t.select"] = { message: "boom" };
  let msg = "";
  try { await readAllRows((a, b) => sb.from("t").select("id").range(a, b), "t", 2); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "[mgr] t: boom");
});
