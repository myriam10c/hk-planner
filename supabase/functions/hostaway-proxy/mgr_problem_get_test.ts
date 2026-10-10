import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrProblemGet } from "./mgr_problem_get.ts";

const NOW = Date.parse("2026-10-09T07:00:00Z");
const sb = () => fakeDb({
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "Gas not working", description: "Stove does not light.", category: "gas", priority: "urgent",
      status: "open", source: "whatsapp", source_ref: null, reported_by: "Faiza", assigned_technician_id: null, assigned_vendor_id: null,
      created_at: "2026-07-09T08:00:00Z", sla_deadline: null, photo_path: "v3/p1.jpg", resolution_photo_path: null },
    { id: 501, listing_id: "L1", title: "Bedroom: lamp", description: "Lamp broken", category: "general", priority: "medium",
      status: "open", source: "inspection", source_ref: "inspection:6:bedrooms", reported_by: "Hillal",
      created_at: "2026-10-07T08:00:00Z", photo_path: "inspections/6/bedrooms/a.jpg" },
    { id: 300, listing_id: "L1", title: "Old fixed thing", priority: "urgent", status: "resolved", source: "manual", reported_by: null,
      created_at: "2026-05-01T08:00:00Z", resolved_at: "2026-10-08T09:00:00Z", resolution_notes: "Fixed" },
  ],
  listing_config: [{ listing_id: "L1", internal_name: "308 - Binghatti Lavender" }],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 4, name: "Faiza", role: "cleaner", is_active: true }, { id: 11, name: "Medini CEO Agent", role: "system", is_active: true },
  ],
  vendors: [{ id: 3, name: "CoolFix", specialty: "AC", is_active: true }, { id: 2, name: "Old Co", specialty: "", is_active: false }],
  ticket_comments: [
    { id: 2, ticket_id: 429, author: "Walter", comment: "Called the gas company.", created_at: "2026-10-08T06:00:00Z", photo_path: "c/2.jpg" },
    { id: 1, ticket_id: 429, author: null, comment: "Seen by guest", created_at: "2026-07-09T09:00:00Z", photo_path: null },
    { id: 3, ticket_id: 999, author: "X", comment: "other", created_at: "2026-07-09T09:00:00Z", photo_path: null },
  ],
  cleaning_log: [
    { id: 1, reservation_key: "ticket_429", action: "problem_assigned", actor: "Walter", details: { to: "Semax", kind: "member" }, created_at: "2026-10-08T05:00:00Z" },
    { id: 2, reservation_key: "ticket_429", action: "problem_assigned", actor: "Walter", details: { to: null, kind: null }, created_at: "2026-10-08T05:30:00Z" },
    { id: 3, reservation_key: "ticket_430", action: "problem_closed", actor: "X", details: {}, created_at: "2026-10-08T05:30:00Z" },
  ],
  photos: [
    { id: 1, storage_path: "v3/p1.jpg", ticket_id: 429, kind: "photo" },
    { id: 2, storage_path: "v3/p2.jpg", ticket_id: 429, kind: "photo" },
    { id: 3, storage_path: "v3/voice.m4a", ticket_id: 429, kind: "voice" },
  ],
  inspection_photos: [
    { id: 1, inspection_id: 6, zone: "bedrooms", kind: "issue", storage_path: "inspections/6/bedrooms/a.jpg" },
    { id: 2, inspection_id: 6, zone: "bedrooms", kind: "issue", storage_path: "inspections/6/bedrooms/b.jpg" },
    { id: 3, inspection_id: 6, zone: "kitchen", kind: "issue", storage_path: "inspections/6/kitchen/c.jpg" },
  ],
  team_tasks: [
    { id: 17, title: "Gas not working", status: "open", assigned_cleaner_id: 7, source_ref: "maint:429", priority: "urgent", created_at: "2026-07-10T08:00:00Z" },
    { id: 13, title: "AC not cooling", description: "Check the AC", category: "maintenance", priority: "urgent", status: "open",
      listing_id: null, assigned_cleaner_id: 7, created_by_cleaner_id: 11, due_at: "2026-05-15T08:00:00Z",
      created_at: "2026-05-14T08:00:00Z", source_ref: null },
  ],
  team_task_comments: [{ id: 1, task_id: 13, cleaner_id: 8, body: "On it", created_at: "2026-05-16T08:00:00Z" }],
});

Deno.test("fiche MNT : photos signees en un lot sans doublon ni vocal, commentaires dans l'ordre, historique, copie TSK", async () => {
  const db = sb();
  const r = await mgrProblemGet(db, { ref: "mnt-429", nowMs: NOW });
  assertEquals(r.status, 200);
  const d: any = r.body;
  assertEquals([d.problem.ref, d.problem.apt, d.description, d.category, d.reportedBy],
    ["MNT-429", "308", "Stove does not light.", "gas", "Faiza"]);
  assertEquals(d.photos, [
    { url: "https://signed.test/v3/p1.jpg?exp=3600", label: "Reported" },
    { url: "https://signed.test/v3/p2.jpg?exp=3600", label: "Cleaner photo" },
  ]);
  assertEquals(db.storage.signBatches.length, 1);
  assertEquals(db.storage.signBatches[0].bucket, "cleaning-photos");
  assertEquals(d.comments, [
    { author: "Unknown", text: "Seen by guest", at: "2026-07-09T09:00:00Z", photo: null },
    { author: "Walter", text: "Called the gas company.", at: "2026-10-08T06:00:00Z", photo: "https://signed.test/c/2.jpg?exp=3600" },
  ]);
  assertEquals(d.history, [
    { at: "2026-07-09T08:00:00Z", text: "Reported by Faiza" },
    { at: "2026-10-08T05:00:00Z", text: "Assigned to Semax by Walter" },
    { at: "2026-10-08T05:30:00Z", text: "Unassigned by Walter" },
  ]);
  assertEquals(d.mirror, { ref: "TSK-17", status: "open", assignee: "Semax" });
  assertEquals(d.assignees.map((a: any) => a.name), ["Semax", "Walter", "Faiza"]);
  assertEquals(d.vendors, [{ id: 3, name: "CoolFix", specialty: "AC" }]);
  assertEquals(d.photosError, null);
});

Deno.test("fiche MNT d'inspection : photos de la zone, sans doublon avec la photo du ticket", async () => {
  const d: any = (await mgrProblemGet(sb(), { ref: "MNT-501", nowMs: NOW })).body;
  assertEquals(d.problem.source, "Inspection");
  assertEquals(d.photos.map((p: any) => p.label + " " + p.url), [
    "Reported https://signed.test/inspections/6/bedrooms/a.jpg?exp=3600",
    "Inspection https://signed.test/inspections/6/bedrooms/b.jpg?exp=3600",
  ]);
  assertEquals(d.mirror, null);
});

Deno.test("fiche d'un ticket clos ailleurs : closed, Closed dans l'historique faute de journal", async () => {
  const d: any = (await mgrProblemGet(sb(), { ref: "MNT-300", nowMs: NOW })).body;
  assertEquals([d.problem.closed, d.problem.why], [true, "Closed on 08/10."]);
  assertEquals(d.history, [{ at: "2026-05-01T08:00:00Z", text: "Reported" }, { at: "2026-10-08T09:00:00Z", text: "Closed" }]);
});

Deno.test("fiche TSK : commentaires au nom du membre, cree par, pas de prestataires", async () => {
  const d: any = (await mgrProblemGet(sb(), { ref: "TSK-13", nowMs: NOW })).body;
  assertEquals([d.problem.ref, d.problem.overdue, d.description, d.category, d.reportedBy],
    ["TSK-13", true, "Check the AC", "maintenance", "Medini CEO Agent"]);
  assertEquals(d.comments, [{ author: "Walter", text: "On it", at: "2026-05-16T08:00:00Z", photo: null }]);
  assertEquals(d.history, [{ at: "2026-05-14T08:00:00Z", text: "Created by Medini CEO Agent" }]);
  assertEquals([d.vendors, d.mirror, d.photos], [[], null, []]);
});

Deno.test("fiche : reference inconnue 400, absente 404, photos non signees signalees", async () => {
  assertEquals(await mgrProblemGet(sb(), { ref: "INS-4", nowMs: NOW }), { status: 400, body: { error: "Unknown problem reference." } });
  assertEquals(await mgrProblemGet(sb(), { ref: "MNT-9999", nowMs: NOW }), { status: 404, body: { error: "MNT-9999 not found." } });
  const db = sb();
  db.fail["storage.sign"] = { message: "down" };
  const d: any = (await mgrProblemGet(db, { ref: "MNT-429", nowMs: NOW })).body;
  assertEquals([d.photos, d.photosError, d.comments[1].photo], [[], "Photos could not be loaded.", null]);
});

Deno.test("copie Hermes : une copie ouverte passe avant une copie terminee ; toutes terminees, la premiere avec son statut", async () => {
  const db = sb();
  db.tables.team_tasks.unshift({ id: 15, title: "Gas not working", status: "done", assigned_cleaner_id: 8, source_ref: "maint:429" });
  assertEquals(((await mgrProblemGet(db, { ref: "MNT-429", nowMs: NOW })).body as any).mirror,
    { ref: "TSK-17", status: "open", assignee: "Semax" });
  db.tables.team_tasks.find((x: any) => x.id === 17).status = "done";
  assertEquals(((await mgrProblemGet(db, { ref: "MNT-429", nowMs: NOW })).body as any).mirror,
    { ref: "TSK-15", status: "done", assignee: "Walter" });
});
