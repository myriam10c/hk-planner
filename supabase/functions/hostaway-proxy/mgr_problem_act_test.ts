import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrProblemAct } from "./mgr_problem_act.ts";

export const NOW = Date.parse("2026-10-09T07:00:00Z"); // 11:00 Dubai
export const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "#000" };
export const seed = () => fakeDb({
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent", status: "open", source: "whatsapp",
      assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-07-09T08:00:00Z", sla_deadline: null, resolution_notes: null },
    { id: 430, listing_id: "L1", title: "Leak", priority: "high", status: "in_progress", source: "whatsapp",
      assigned_technician_id: 7, assigned_vendor_id: null, created_at: "2026-08-01T08:00:00Z", resolution_notes: null },
    { id: 501, listing_id: "L1", title: "Bedroom: lamp", priority: "medium", status: "open", source: "inspection",
      source_ref: "inspection:6:bedrooms", description: "Lamp broken", assigned_technician_id: null, assigned_vendor_id: null },
    { id: 300, listing_id: "L1", title: "Old", priority: "urgent", status: "resolved", source: "manual",
      assigned_technician_id: null, assigned_vendor_id: null, resolved_at: "2026-10-01T08:00:00Z", resolution_notes: "Fixed" },
  ],
  team_tasks: [
    { id: 13, title: "AC", status: "open", assigned_cleaner_id: 7, due_at: null, source_ref: null },
    { id: 17, title: "Gas not working", status: "open", assigned_cleaner_id: 7, source_ref: "maint:429" },
    { id: 19, title: "Done one", status: "done", completed_at: "2026-10-01T08:00:00Z", completed_by_cleaner_id: 8, source_ref: null },
  ],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 4, name: "Faiza", role: "cleaner", is_active: true }, { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 9, name: "Gone", role: "maintenance", is_active: false },
  ],
  vendors: [{ id: 3, name: "CoolFix", is_active: true }, { id: 2, name: "Old Co", is_active: false }],
  inspections: [{ id: 6, listing_id: "L1", inspector_id: 5, inspection_date: "2026-10-07", finished_at: "2026-10-07T09:00:00Z" }],
  inspection_items: [{ id: 1, inspection_id: 6, zone: "bedrooms", status: "not_ok", outcome: "maintenance", ticket_id: 501,
    fix_scheduled_for: null, fix_scheduled_slot: null }],
  job_events: [], cleaning_log: [], ticket_comments: [], team_task_comments: [],
});
let n = 0;
export const act = (sb: any, body: any, deps: any = {}) =>
  mgrProblemAct(sb, ME, { idem: "idem-test-" + (++n), ...body }, { nowMs: NOW, ...deps });
const ticket = (sb: any, id: number) => sb.tables.maintenance_tickets.find((x: any) => x.id === id);
const task = (sb: any, id: number) => sb.tables.team_tasks.find((x: any) => x.id === id);

Deno.test("assign MNT : membre de l'equipe, statut assigned, journal et cle au nom de la session", async () => {
  const sb = seed();
  const r = await act(sb, { ref: "MNT-429", verb: "assign", memberId: 7, actor: "Manager" });
  assertEquals(r, { status: 200, body: { status: "success", ref: "MNT-429", verb: "assign", assignee: { kind: "member", id: 7, name: "Semax" } } });
  const t = ticket(sb, 429);
  assertEquals([t.assigned_technician_id, t.assigned_vendor_id, t.status, t.last_update], [7, null, "assigned", "2026-10-09T07:00:00.000Z"]);
  assertEquals(sb.tables.cleaning_log.map((l: any) => [l.reservation_key, l.action, l.actor, l.details]),
    [["ticket_429", "problem_assigned", "Walter", { to: "Semax", kind: "member" }]]);
  assertEquals(sb.tables.job_events.map((e: any) => [e.event_type, e.job_id, e.cleaner_id]), [["mgr_problem_act", "MNT-429", 8]]);
});

Deno.test("assign MNT : prestataire, puis retrait ; un ticket en cours garde son statut", async () => {
  const sb = seed();
  assertEquals((await act(sb, { ref: "MNT-429", verb: "assign", vendorId: 3 })).body.assignee, { kind: "vendor", id: 3, name: "CoolFix" });
  const t = ticket(sb, 429);
  assertEquals([t.assigned_technician_id, t.assigned_vendor_id, t.status], [null, 3, "assigned"]);
  assertEquals((await act(sb, { ref: "MNT-429", verb: "assign", unassign: true })).body.assignee, null);
  assertEquals([t.assigned_vendor_id, t.status], [null, "open"]);
  await act(sb, { ref: "MNT-430", verb: "assign", memberId: 4 });
  assertEquals([ticket(sb, 430).assigned_technician_id, ticket(sb, 430).status], [4, "in_progress"]);
});

Deno.test("refus avant toute ecriture : personne, role, prestataire, tache vers prestataire, saisie", async () => {
  const sb = seed();
  const err = async (b: any) => (await act(sb, b)).body.error;
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: 9 }), "This person cannot take tickets.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: 12 }), "This person cannot take tickets.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", vendorId: 2 }), "This vendor is not active.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", memberId: 4 }), "This person cannot take team tasks.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", vendorId: 3 }), "Team tasks go to a team member, not a vendor.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign" }), "Choose a person or a vendor.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: 7, vendorId: 3 }), "Choose a person or a vendor, not both.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: "abc" }), "Invalid person.");
  assertEquals(await err({ ref: "INS-4", verb: "assign", memberId: 7 }), "Unknown problem reference.");
  assertEquals(await err({ ref: "MNT-429", verb: "explode" }), "Unknown action.");
  assertEquals((await mgrProblemAct(sb, ME, { ref: "MNT-429", verb: "assign", memberId: 7, idem: "x" }, { nowMs: NOW })).body.error, "idem required");
  assertEquals(await act(sb, { ref: "MNT-9999", verb: "assign", memberId: 7 }), { status: 404, body: { error: "MNT-9999 not found." } });
  assertEquals(sb.writes.length, 0);
});

Deno.test("assign TSK : manager, notification au nouvel assigne seulement", async () => {
  const sb = seed();
  const sent: number[] = [];
  const deps = { notifyTask: (t: any) => { sent.push(t.id); } };
  await act(sb, { ref: "TSK-13", verb: "assign", memberId: 8 }, deps);
  await act(sb, { ref: "TSK-13", verb: "assign", memberId: 8 }, deps);
  await act(sb, { ref: "TSK-13", verb: "assign", unassign: true }, deps);
  assertEquals(sent, [13]);
  assertEquals(task(sb, 13).assigned_cleaner_id, null);
});

Deno.test("idempotence : meme cle, meme reponse, une seule ecriture ; cle posee sans resultat = 409", async () => {
  const sb = seed();
  const body = { ref: "MNT-429", verb: "assign", memberId: 7, idem: "idem-replay-1" };
  const a = await mgrProblemAct(sb, ME, body, { nowMs: NOW });
  const b = await mgrProblemAct(sb, ME, body, { nowMs: NOW });
  assertEquals(b, a);
  assertEquals(sb.tables.cleaning_log.length, 1);
  sb.tables.job_events.push({ id: 77, idem_key: "idem-pending-1", event_type: "mgr_problem_act", result: null });
  assertEquals(await mgrProblemAct(sb, ME, { ...body, idem: "idem-pending-1" }, { nowMs: NOW }),
    { status: 409, body: { error: "Still processing. Retry." } });
});

Deno.test("ecriture ratee : la cle est liberee, l'erreur remonte", async () => {
  const sb = seed();
  sb.fail["maintenance_tickets.update"] = { message: "db down" };
  let msg = "";
  try { await act(sb, { ref: "MNT-429", verb: "assign", memberId: 7 }); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("schedule : fin de journee Dubai, TSK due_at, retrait, passe et trop loin refuses", async () => {
  const sb = seed();
  assertEquals((await act(sb, { ref: "MNT-429", verb: "schedule", date: "2026-10-12" })).body,
    { status: "success", ref: "MNT-429", verb: "schedule", dueAt: "2026-10-12T19:59:59.000Z" });
  assertEquals(ticket(sb, 429).sla_deadline, "2026-10-12T19:59:59.000Z");
  await act(sb, { ref: "TSK-13", verb: "schedule", date: "2026-10-09" });
  assertEquals(task(sb, 13).due_at, "2026-10-09T19:59:59.000Z");
  await act(sb, { ref: "TSK-13", verb: "schedule", date: null });
  assertEquals(task(sb, 13).due_at, null);
  const err = async (date: unknown) => (await act(sb, { ref: "MNT-429", verb: "schedule", date })).body.error;
  assertEquals(await err("2026-10-08"), "The date cannot be in the past.");
  assertEquals(await err("2027-10-10"), "The date is too far ahead.");
  assertEquals(await err("2026-02-30"), "Invalid date.");
  assertEquals(sb.tables.cleaning_log.map((l: any) => [l.reservation_key, l.action, l.details]), [
    ["ticket_429", "problem_scheduled", { date: "2026-10-12" }],
    ["task_13", "problem_scheduled", { date: "2026-10-09" }],
    ["task_13", "problem_scheduled", { date: null }],
  ]);
});

Deno.test("schedule d'un ticket d'inspection : la date de rectification de la zone suit", async () => {
  const sb = seed();
  await act(sb, { ref: "MNT-501", verb: "schedule", date: "2026-10-14" });
  const it = sb.tables.inspection_items[0];
  assertEquals([it.fix_scheduled_for, it.fix_scheduled_slot], ["2026-10-14", null]);
  assertEquals(ticket(sb, 501).description, "Lamp broken\n\nFix date: 14 Oct 2026");
});

Deno.test("assign et schedule refuses sur un probleme clos, la cle est liberee ; comment accepte", async () => {
  const sb = seed();
  assertEquals(await act(sb, { ref: "MNT-300", verb: "assign", memberId: 7 }), { status: 409, body: { error: "MNT-300 is closed. Reopen it first." } });
  assertEquals((await act(sb, { ref: "TSK-19", verb: "schedule", date: "2026-10-10" })).body.error, "TSK-19 is closed. Reopen it first.");
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals((await act(sb, { ref: "MNT-300", verb: "comment", text: "Checked again" })).status, 200);
});

Deno.test("comment : auteur de la session, texte borne, vide refuse", async () => {
  const sb = seed();
  const r = await act(sb, { ref: "MNT-429", verb: "comment", text: "  Called the gas company.  ", author: "Hillal" });
  assertEquals(r.body.comment, { author: "Walter", text: "Called the gas company.", at: "2026-10-09T07:00:00.000Z" });
  assertEquals(sb.tables.ticket_comments.map((c: any) => [c.ticket_id, c.author, c.comment]), [[429, "Walter", "Called the gas company."]]);
  await act(sb, { ref: "TSK-13", verb: "comment", text: "x".repeat(2500) });
  assertEquals(sb.tables.team_task_comments.map((c: any) => [c.task_id, c.cleaner_id, c.body.length]), [[13, 8, 2000]]);
  assertEquals((await act(sb, { ref: "MNT-429", verb: "comment", text: "   " })).body.error, "Write a comment first.");
});
