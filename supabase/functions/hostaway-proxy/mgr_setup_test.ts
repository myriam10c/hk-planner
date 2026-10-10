import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { completePreventiveRun, mgrSetup, nextDueAfterEdit, setupAccess, setupLabel } from "./mgr_setup.ts";
import { parsePeopleMonth } from "./mgr_people.ts";

const seed = () => fakeDb({
  listing_config: [
    { listing_id: 11, internal_name: "1203 Marina Gate", listing_name: "x" },
    { listing_id: 22, internal_name: null, listing_name: "Beta Tower", apt_number: "" },
  ],
  vendors: [
    { id: 1, name: "Zed AC", specialty: "ac", phone: "+97150", is_active: true },
    { id: 2, name: "Ali Plumbing", specialty: "plumbing", is_active: true },
    { id: 3, name: "Gone Co", specialty: "other", is_active: false },
  ],
  equipment: [
    { id: 5, listing_id: "22", name: "Boiler", install_date: "2026-01-01", next_service: "2026-07-01" },
    { id: 4, listing_id: "11", name: "AC unit", install_date: null },
    { id: 6, listing_id: "999", name: "Fridge" },
  ],
  preventive_maintenance: [
    { id: 8, listing_id: "11", task_name: "AC filter", next_due_at: "2026-11-01T00:00:00Z", is_active: true, assigned_vendor_id: 3 },
    { id: 7, listing_id: null, task_name: "Pest control", next_due_at: "2026-10-20T00:00:00Z", is_active: true },
    { id: 9, listing_id: "11", task_name: "Old task", next_due_at: "2026-01-01T00:00:00Z", is_active: false },
  ],
  maintenance_costs: [
    { id: 30, listing_id: "11", amount: 150, date: "2026-10-01", vendor_id: 1, category: "ac" },
    { id: 31, listing_id: "22", amount: 80.5, date: "2026-10-31", vendor_id: 3, category: "plumbing" },
    { id: 32, listing_id: "11", amount: 999, date: "2026-11-01" },
    { id: 33, listing_id: "11", amount: 5, date: "2026-09-30" },
  ],
});

Deno.test("setupAccess: sans session 401, non manager 403, manager PIN ou email autorise", () => {
  assertEquals(setupAccess(null), { status: 401, error: "auth required" });
  for (const role of ["cleaner", "maintenance", "subcontractor", ""]) {
    assertEquals(setupAccess({ role }), { status: 403, error: "Only managers can do this." });
  }
  assertEquals(setupAccess({ role: "manager" }), null);
});

Deno.test("setupLabel: apt · immeuble, immeuble seul, id inconnu nomme", () => {
  const map = { "11": { apt: "1203", bld: "Marina Gate" }, "22": { apt: "", bld: "Beta Tower" } };
  assertEquals(setupLabel(map, "11"), "1203 · Marina Gate");
  assertEquals(setupLabel(map, 22), "Beta Tower");
  assertEquals(setupLabel(map, "999"), "Listing 999");
  assertEquals(setupLabel(map, null), null);
  assertEquals(setupLabel(map, ""), null);
});

Deno.test("mgr.setup: forme, prestataires actifs tries, libelles resolus, couts du mois seulement", async () => {
  const r = await mgrSetup(seed(), "2026-10");
  assertEquals(Object.keys(r).sort(), ["costs", "equipment", "listings", "month", "schedules", "vendors"]);
  assertEquals(r.month, "2026-10");
  assertEquals(r.vendors.map((v: any) => v.name), ["Ali Plumbing", "Zed AC"]);
  assertEquals(r.vendors[1].phone, "+97150");
  assertEquals(r.listings, [{ id: "22", apt: "", bld: "Beta Tower" }, { id: "11", apt: "1203", bld: "Marina Gate" }]);
  // Equipements : ordre des logements (inconnus en dernier) puis nom, libelle sans « Unknown ».
  assertEquals(r.equipment.map((e: any) => [e.id, e.listingLabel]),
    [[5, "Beta Tower"], [4, "1203 · Marina Gate"], [6, "Listing 999"]]);
  assertEquals(r.equipment[0].next_service, "2026-07-01");
  // Preventif : actifs seuls, par prochaine echeance, prestataire nomme meme inactif.
  assertEquals(r.schedules.map((s: any) => [s.id, s.listingLabel, s.vendorName]),
    [[7, null, null], [8, "1203 · Marina Gate", "Gone Co"]]);
  // Couts : bornes du mois sur la colonne date (31 compris, 1er du mois suivant exclu).
  assertEquals(r.costs.map((c: any) => [c.id, c.listingLabel, c.vendorName]),
    [[31, "Beta Tower", "Gone Co"], [30, "1203 · Marina Gate", "Zed AC"]]);
  assertEquals(r.costs[1].amount, 150);
});

Deno.test("mgr.setup: plus de 1000 couts dans le mois, tous lus", async () => {
  const many = Array.from({ length: 1500 }, (_, i) => ({ id: i + 1, listing_id: "11", amount: 1, date: "2026-10-15" }));
  const db = fakeDb({ listing_config: [], vendors: [], equipment: [], preventive_maintenance: [], maintenance_costs: many }, { maxRows: 1000 });
  const r = await mgrSetup(db, "2026-10");
  assertEquals(r.costs.length, 1500);
});

Deno.test("mgr.setup: une table illisible fait echouer la lecture (503 cote index)", async () => {
  const db = seed();
  (db as any).fail["vendors.select"] = { message: "boom" };
  await assertRejects(() => mgrSetup(db, "2026-10"));
});

Deno.test("mgr.setup: validation du mois (parsePeopleMonth)", () => {
  assertEquals(parsePeopleMonth(null, "2026-10-11"), { ok: true, month: "2026-10" });
  assertEquals(parsePeopleMonth("2026-13", "2026-10-11").ok, false);
  assert(!parsePeopleMonth("2026-1", "2026-10-11").ok);
});

// ==================== completePreventive ====================
// 01:00 a Dubai le 12/10 = 21:00 UTC le 11/10 : le jour enregistre doit etre le 12.
const AT_1AM_DUBAI = Date.parse("2026-10-11T21:00:00Z");
const pmDb = () => fakeDb({
  preventive_maintenance: [{ id: 8, listing_id: "11", equipment_id: 4, task_name: "AC filter", category: "ac", frequency_days: 60, assigned_vendor_id: 1, is_active: true }],
  equipment: [{ id: 4, listing_id: "11", name: "AC unit" }],
  maintenance_costs: [],
});
const runPm = (db: any, o: any = {}) => {
  const logs: any[] = [];
  return completePreventiveRun(db, {
    id: 8, actualCost: 350, notes: "All rooms", actor: "Walter", nowMs: AT_1AM_DUBAI,
    log: async (key: string, action: string, actor: string, details: any) => { logs.push({ key, action, actor, details }); },
    ...o,
  }).then((r) => ({ r, logs }));
};

Deno.test("completePreventive: echeance, cout du jour de Dubai avec les notes, equipement, journal", async () => {
  const db = pmDb();
  const { r, logs } = await runPm(db);
  assertEquals(r, { status: 200, body: { status: "success" } });
  const pm = db.tables.preventive_maintenance[0];
  assertEquals(pm.last_done_at, "2026-10-11T21:00:00.000Z");
  assertEquals(pm.next_due_at, new Date(AT_1AM_DUBAI + 60 * 86400000).toISOString());
  assertEquals(db.tables.maintenance_costs.length, 1);
  const c = db.tables.maintenance_costs[0];
  assertEquals([c.date, c.description, c.amount, c.listing_id, c.category, c.vendor_id],
    ["2026-10-12", "Preventive: AC filter · All rooms", 350, "11", "ac", 1]);
  assertEquals(db.tables.equipment[0].last_service, "2026-10-12");
  assertEquals(logs, [{ key: "preventive_8", action: "preventive_completed", actor: "Walter", details: { task_name: "AC filter", notes: "All rooms" } }]);
});

Deno.test("completePreventive: sans montant, aucun cout mais les notes restent au journal", async () => {
  const db = pmDb();
  const { r, logs } = await runPm(db, { actualCost: null, notes: "Checked only" });
  assertEquals(r.status, 200);
  assertEquals(db.tables.maintenance_costs.length, 0);
  assertEquals(logs[0].details.notes, "Checked only");
});

Deno.test("completePreventive: notes vides, description sans suffixe", async () => {
  const db = pmDb();
  await runPm(db, { notes: "  " });
  assertEquals(db.tables.maintenance_costs[0].description, "Preventive: AC filter");
});

Deno.test("completePreventive: tache absente 404", async () => {
  const { r } = await runPm(pmDb(), { id: 99 });
  assertEquals(r.status, 404);
});

Deno.test("completePreventive: echec de la mise a jour de l echeance, 500 et aucun cout", async () => {
  const db = pmDb();
  db.fail["preventive_maintenance.update"] = { message: "boom" };
  const { r, logs } = await runPm(db);
  assertEquals(r.status, 500);
  assertEquals(r.body.error, "Could not mark this task done. Try again.");
  assertEquals(db.tables.maintenance_costs.length, 0);
  assertEquals(db.tables.equipment[0].last_service, undefined);
  assertEquals(logs.length, 0);
});

Deno.test("completePreventive: echec de lecture de la tache, 500", async () => {
  const db = pmDb();
  db.fail["preventive_maintenance.select"] = { message: "boom" };
  const { r } = await runPm(db);
  assertEquals(r.status, 500);
  assertEquals(db.writes.length, 0);
});

Deno.test("completePreventive: echec du cout, 500 qui dit que la tache est faite", async () => {
  const db = pmDb();
  db.fail["maintenance_costs.insert"] = { message: "boom" };
  const { r } = await runPm(db);
  assertEquals(r.status, 500);
  assertEquals(r.body.error, "Task marked done, but the cost was not recorded. Add it in Costs.");
  assert(db.tables.preventive_maintenance[0].last_done_at);
});

Deno.test("completePreventive: echec de l equipement, 500 nomme", async () => {
  const db = pmDb();
  db.fail["equipment.update"] = { message: "boom" };
  const { r } = await runPm(db);
  assertEquals(r.status, 500);
  assertEquals(r.body.error, "Task marked done, but the equipment service date was not updated.");
  assertEquals(db.tables.maintenance_costs.length, 1);
});

Deno.test("nextDueAfterEdit: derniere fois + nouvelle frequence, null si jamais faite", () => {
  assertEquals(nextDueAfterEdit("2026-10-02T08:00:00.000Z", 30), "2026-11-01T08:00:00.000Z");
  assertEquals(nextDueAfterEdit(null, 30), null);
  assertEquals(nextDueAfterEdit("2026-10-02T08:00:00.000Z", null), null);
  assertEquals(nextDueAfterEdit("2026-10-02T08:00:00.000Z", 0), null);
});
