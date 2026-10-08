// Date de rectification programmee (zone Not OK envoyee en maintenance).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { saveItem, setFixSchedule, startInspection } from "./insp_write.ts";
import { inspHistory, inspReports } from "./insp_read.ts";
import { fixLine, fixOverdue, inspRoleAllowed } from "./insp_rules.ts";

const WALTER = { cleaner_id: 2, name: "Walter", role: "manager", color: "#000" };
const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const SEMAX = { cleaner_id: 4, name: "Semax", role: "maintenance", color: "#111" };
const NOW = Date.parse("2026-10-06T08:00:00Z"); // 12:00 Dubai, jour 2026-10-06
const seed = () => fakeDb({
  cleaners: [
    { id: 2, name: "Walter", role: "manager", is_active: true },
    { id: 3, name: "Faiza", role: "cleaner", is_active: true },
    { id: 4, name: "Semax", role: "maintenance", is_active: true },
  ],
  listing_config: [{ listing_id: "L1", internal_name: "3207 - Sobha Waves" }],
  maintenance_sla: [{ category: "general", priority: "medium", max_hours: 48 }],
});
async function started(db: any) {
  const r = await startInspection(db, FAIZA, { listingId: "L1", eligibility: "checkout", idem: "idem-start-1" }, NOW);
  return (r.body as any).inspection.id as number;
}
const maint = (id: number, extra: any = {}) =>
  ({ inspectionId: id, zone: "ac", status: "not_ok", note: "AC leaking", outcome: "maintenance", ...extra });

// ---- Regles pures ----

Deno.test("fixLine : date seule, date et creneau, vide", () => {
  assertEquals(fixLine("2026-10-12", "morning"), "Fix date: 12 Oct 2026, morning");
  assertEquals(fixLine("2026-10-12", ""), "Fix date: 12 Oct 2026");
  assertEquals(fixLine(null, "morning"), "");
});

Deno.test("fixOverdue : date passee (jour Dubai) et ticket ouvert seulement", () => {
  assertEquals(fixOverdue("2026-10-05", "open", "2026-10-06"), true);
  assertEquals(fixOverdue("2026-10-06", "open", "2026-10-06"), false); // le jour meme : pas encore en retard
  assertEquals(fixOverdue("2026-10-05", "resolved", "2026-10-06"), false);
  assertEquals(fixOverdue("2026-10-05", "cancelled", "2026-10-06"), false);
  assertEquals(fixOverdue("2026-10-05", null, "2026-10-06"), false);
  assertEquals(fixOverdue(null, "open", "2026-10-06"), false);
});

Deno.test("roles : setFixSchedule ouvert a l'equipe, pas aux sous-traitants", () => {
  assertEquals(inspRoleAllowed("insp.setFixSchedule", "cleaner"), true);
  assertEquals(inspRoleAllowed("insp.setFixSchedule", "manager"), true);
  assertEquals(inspRoleAllowed("insp.setFixSchedule", "maintenance"), true);
  assertEquals(inspRoleAllowed("insp.setFixSchedule", "subcontractor"), false);
});

// ---- saveItem ----

Deno.test("saveItem : maintenance sans date, inspection validable, champs null", async () => {
  const db = seed(); const id = await started(db);
  const r = await saveItem(db, FAIZA, maint(id), NOW);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).item.fixScheduledFor, null);
  assertEquals((r.body as any).item.fixScheduledSlot, null);
  assert(!(db.tables.maintenance_tickets[0].description as string).includes("Fix date"));
});

Deno.test("saveItem : date et creneau stockes et ecrits dans le ticket cree", async () => {
  const db = seed(); const id = await started(db);
  const r = await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2026-10-12", fixScheduledSlot: " morning " }), NOW);
  assertEquals(r.status, 200);
  const it = db.tables.inspection_items[0];
  assertEquals([it.fix_scheduled_for, it.fix_scheduled_slot], ["2026-10-12", "morning"]);
  assertEquals((r.body as any).item.fixScheduledFor, "2026-10-12");
  const t = db.tables.maintenance_tickets[0];
  assertEquals(t.description, "AC leaking\n\nFound during inspection by Faiza.\n\nFix date: 12 Oct 2026, morning");
  // Le filtre anti-bruit des tickets ne doit pas trouver ses mots-cles dans le texte ajoute.
  assert(!/\b(scheduled|booked|planned|done|fixed)\b/i.test(fixLine("2026-10-12", "morning")));
});

Deno.test("saveItem : date invalide ou passee refusee", async () => {
  const db = seed(); const id = await started(db);
  for (const bad of ["2026-13-01", "12/10/2026", "2026-02-30", "2026-10-05"]) {
    const r = await saveItem(db, FAIZA, maint(id, { fixScheduledFor: bad }), NOW);
    assertEquals(r.status, 400, bad);
  }
  const far = await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2027-12-01" }), NOW);
  assertEquals(far.status, 400);
  // Aujourd'hui accepte.
  assertEquals((await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2026-10-06" }), NOW)).status, 200);
});

Deno.test("saveItem : creneau sans date ignore, creneau tronque a 40", async () => {
  const db = seed(); const id = await started(db);
  await saveItem(db, FAIZA, maint(id, { fixScheduledSlot: "morning" }), NOW);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_slot, null);
  await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2026-10-12", fixScheduledSlot: "x".repeat(100) }), NOW);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_slot.length, 40);
});

Deno.test("saveItem : fixed ou ok efface la date", async () => {
  const db = seed(); const id = await started(db);
  await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2026-10-12" }), NOW);
  await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "not_ok", note: "x", outcome: "fixed", fixNote: "ok", fixScheduledFor: "2026-10-12" }, NOW);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_for, null);
  await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2026-10-12" }), NOW);
  await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "ok" }, NOW);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_for, null);
});

Deno.test("saveItem : date changee sur un ticket existant, ligne remplacee (pas de doublon)", async () => {
  const db = seed(); const id = await started(db);
  await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2026-10-12", fixScheduledSlot: "morning" }), NOW);
  await saveItem(db, FAIZA, maint(id, { fixScheduledFor: "2026-10-14" }), NOW);
  assertEquals(db.tables.maintenance_tickets.length, 1);
  assertEquals(db.tables.maintenance_tickets[0].description, "AC leaking\n\nFound during inspection by Faiza.\n\nFix date: 14 Oct 2026");
  await saveItem(db, FAIZA, maint(id), NOW);
  assertEquals(db.tables.maintenance_tickets[0].description, "AC leaking\n\nFound during inspection by Faiza.");
});

Deno.test("saveItem det : ticket a fournir porte la date", async () => {
  const db = seed(); const id = await started(db);
  await saveItem(db, FAIZA, { inspectionId: id, zone: "det", status: "not_ok", missing: ["iron"], outcome: "maintenance", fixScheduledFor: "2026-10-09" }, NOW);
  assert((db.tables.maintenance_tickets[0].description as string).endsWith("\n\nFix date: 9 Oct 2026"));
});

// ---- setFixSchedule ----

async function withTicket(db: any) {
  const id = await started(db);
  await saveItem(db, FAIZA, maint(id), NOW);
  return id;
}

Deno.test("setFixSchedule : l'inspectrice auteure pose la date, item et ticket a jour", async () => {
  const db = seed(); const id = await withTicket(db);
  const r = await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "ac", date: "2026-10-12", slot: "2 pm" }, NOW);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).item.fixScheduledFor, "2026-10-12");
  assertEquals((r.body as any).item.fixScheduledSlot, "2 pm");
  const it = db.tables.inspection_items[0];
  assertEquals([it.fix_scheduled_for, it.fix_scheduled_slot], ["2026-10-12", "2 pm"]);
  const t = db.tables.maintenance_tickets[0];
  assert((t.description as string).endsWith("\n\nFix date: 12 Oct 2026, 2 pm"));
  assertEquals(t.last_update, new Date(NOW).toISOString());
});

Deno.test("setFixSchedule : un manager peut, un autre cleaner non", async () => {
  const db = seed(); const id = await withTicket(db);
  assertEquals((await setFixSchedule(db, WALTER, { inspectionId: id, zone: "ac", date: "2026-10-12" }, NOW)).status, 200);
  assertEquals((await setFixSchedule(db, SEMAX, { inspectionId: id, zone: "ac", date: "2026-10-13" }, NOW)).status, 403);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_for, "2026-10-12");
});

Deno.test("setFixSchedule : effacer la date (null) retire la ligne du ticket", async () => {
  const db = seed(); const id = await withTicket(db);
  await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "ac", date: "2026-10-12", slot: "morning" }, NOW);
  const r = await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "ac", date: null }, NOW);
  assertEquals(r.status, 200);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_for, null);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_slot, null);
  assertEquals(db.tables.maintenance_tickets[0].description, "AC leaking\n\nFound during inspection by Faiza.");
});

Deno.test("setFixSchedule : zone fixed, zone ok, zone absente refusees", async () => {
  const db = seed(); const id = await started(db);
  await saveItem(db, FAIZA, { inspectionId: id, zone: "kitchen", status: "not_ok", note: "x", outcome: "fixed", fixNote: "ok" }, NOW);
  await saveItem(db, FAIZA, { inspectionId: id, zone: "living", status: "ok" }, NOW);
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "kitchen", date: "2026-10-12" }, NOW)).status, 409);
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "living", date: "2026-10-12" }, NOW)).status, 409);
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "ac", date: "2026-10-12" }, NOW)).status, 404);
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "garage", date: "2026-10-12" }, NOW)).status, 400);
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: 999, zone: "ac", date: "2026-10-12" }, NOW)).status, 404);
});

Deno.test("setFixSchedule : ticket clos, refuse et rien n'est ecrit", async () => {
  const db = seed(); const id = await withTicket(db);
  db.tables.maintenance_tickets[0].status = "resolved";
  const before = db.tables.maintenance_tickets[0].description;
  const r = await setFixSchedule(db, WALTER, { inspectionId: id, zone: "ac", date: "2026-10-12" }, NOW);
  assertEquals(r.status, 409);
  assertEquals(db.tables.inspection_items[0].fix_scheduled_for ?? null, null);
  assertEquals(db.tables.maintenance_tickets[0].description, before);
});

Deno.test("setFixSchedule : date invalide ou passee 400 ; inspection terminee acceptee", async () => {
  const db = seed(); const id = await withTicket(db);
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "ac", date: "2026-10-01" }, NOW)).status, 400);
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "ac", date: "nope" }, NOW)).status, 400);
  db.tables.inspections[0].finished_at = "2026-10-06T07:00:00Z";
  assertEquals((await setFixSchedule(db, FAIZA, { inspectionId: id, zone: "ac", date: "2026-10-08" }, NOW + 86400_000)).status, 200);
});

// ---- Lectures : historique et rapports ----

const readDb = () => fakeDb({
  cleaners: [{ id: 3, name: "Faiza", role: "cleaner", is_active: true }],
  listing_config: [{ listing_id: "B", internal_name: "202 - Tower B" }],
  inspections: [{ id: 2, listing_id: "B", inspector_id: 3, inspection_date: "2026-10-03", finished_at: "2026-10-03T10:00:00+04:00", started_at: "2026-10-03T09:30:00+04:00", eligibility: "checkout" }],
  inspection_items: [
    { id: 1, inspection_id: 2, zone: "ac", status: "not_ok", note: "Leak", outcome: "maintenance", ticket_id: 50, fix_scheduled_for: "2026-10-05", fix_scheduled_slot: "morning" },
    { id: 2, inspection_id: 2, zone: "kitchen", status: "not_ok", note: "Oven", outcome: "maintenance", ticket_id: 51, fix_scheduled_for: "2026-10-05" },
    { id: 3, inspection_id: 2, zone: "living", status: "not_ok", note: "Lamp", outcome: "maintenance", ticket_id: 52 },
  ],
  inspection_photos: [],
  maintenance_tickets: [{ id: 50, status: "open", title: "AC" }, { id: 51, status: "resolved", title: "Oven" }, { id: 52, status: "open", title: "Lamp" }],
});

Deno.test("history : date, creneau, retard et auteur renvoyes", async () => {
  const h = await inspHistory(readDb(), "B", "2026-10-06");
  const insp = h.inspections[0];
  assertEquals(insp.inspectorId, 3);
  const by: Record<string, any> = {};
  for (const it of insp.items) by[it.zone] = it;
  assertEquals([by.ac.fixScheduledFor, by.ac.fixScheduledSlot, by.ac.fixOverdue], ["2026-10-05", "morning", true]);
  assertEquals([by.kitchen.fixScheduledFor, by.kitchen.fixOverdue], ["2026-10-05", false]); // ticket clos
  assertEquals([by.living.fixScheduledFor, by.living.fixOverdue], [null, false]);
});

Deno.test("history : pas encore en retard le jour meme", async () => {
  const h = await inspHistory(readDb(), "B", "2026-10-05");
  assertEquals(h.inspections[0].items.find((i: any) => i.zone === "ac").fixOverdue, false);
});

Deno.test("reports : date et retard sur les lignes concernees", async () => {
  const r = await inspReports(readDb(), "2026-10-01", "2026-10-06", "2026-10-06");
  const by: Record<string, any> = {};
  for (const i of r.reports[0].issues) by[i.zone] = i;
  assertEquals([by.ac.fixScheduledFor, by.ac.fixScheduledSlot, by.ac.fixOverdue], ["2026-10-05", "morning", true]);
  assertEquals(by.kitchen.fixOverdue, false);
  assertEquals([by.living.fixScheduledFor, by.living.fixOverdue], [null, false]);
});
