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
const task = (sb: any, id: number) => sb.tables.team_tasks.find((x: any) => x.id === id);

Deno.test("MNT refuse : 409, a ouvrir dans Maintenance, avant toute validation, aucune ecriture", async () => {
  const sb = seed();
  const r409 = { status: 409, body: { error: "Open it in Maintenance." } };
  assertEquals(await act(sb, { ref: "MNT-429", verb: "assign", memberId: 7 }), r409);
  assertEquals(await act(sb, { ref: "mnt-300", verb: "reopen" }), r409);
  assertEquals(await act(sb, { ref: "MNT-429", verb: "explode" }), r409);
  assertEquals(await mgrProblemAct(sb, ME, { ref: "MNT-9999", verb: "close" }, { nowMs: NOW }), r409);
  assertEquals(sb.writes.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("refus avant toute ecriture : personne, role, tache vers prestataire, saisie", async () => {
  const sb = seed();
  const err = async (b: any) => (await act(sb, b)).body.error;
  assertEquals(await err({ ref: "TSK-13", verb: "assign", memberId: 4 }), "This person cannot take team tasks.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", memberId: 9 }), "This person cannot take team tasks.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", vendorId: 3 }), "Team tasks go to a team member, not a vendor.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign" }), "Choose a person or a vendor.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", memberId: 7, vendorId: 3 }), "Choose a person or a vendor, not both.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", memberId: "abc" }), "Invalid person.");
  assertEquals(await err({ ref: "INS-4", verb: "assign", memberId: 7 }), "Unknown problem reference.");
  assertEquals(await err({ ref: "TSK-13", verb: "explode" }), "Unknown action.");
  assertEquals((await mgrProblemAct(sb, ME, { ref: "TSK-13", verb: "assign", memberId: 7, idem: "x" }, { nowMs: NOW })).body.error, "idem required");
  assertEquals(await act(sb, { ref: "TSK-9999", verb: "assign", memberId: 7 }), { status: 404, body: { error: "TSK-9999 not found." } });
  assertEquals(sb.writes.length, 0);
});

Deno.test("assign TSK : manager, journal et cle au nom de la session, notification au nouvel assigne seulement", async () => {
  const sb = seed();
  const sent: number[] = [];
  const deps = { notifyTask: (t: any) => { sent.push(t.id); } };
  const r = await act(sb, { ref: "TSK-13", verb: "assign", memberId: 8, actor: "Manager" }, deps);
  assertEquals(r, { status: 200, body: { status: "success", ref: "TSK-13", verb: "assign", assignee: { kind: "member", id: 8, name: "Walter" } } });
  await act(sb, { ref: "TSK-13", verb: "assign", memberId: 8 }, deps);
  await act(sb, { ref: "TSK-13", verb: "assign", unassign: true }, deps);
  assertEquals(sent, [13]);
  assertEquals(task(sb, 13).assigned_cleaner_id, null);
  assertEquals(sb.tables.cleaning_log[0].reservation_key + " " + sb.tables.cleaning_log[0].actor, "task_13 Walter");
  assertEquals(sb.tables.job_events[0].job_id, "TSK-13");
});

Deno.test("idempotence : meme cle, meme reponse, une seule ecriture ; cle posee sans resultat = 409", async () => {
  const sb = seed();
  const body = { ref: "TSK-13", verb: "assign", memberId: 8, idem: "idem-replay-1" };
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
  sb.fail["team_tasks.update"] = { message: "db down" };
  let msg = "";
  try { await act(sb, { ref: "TSK-13", verb: "assign", memberId: 8 }); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("schedule TSK : fin de journee Dubai, retrait, passe et trop loin refuses", async () => {
  const sb = seed();
  assertEquals((await act(sb, { ref: "TSK-13", verb: "schedule", date: "2026-10-12" })).body,
    { status: "success", ref: "TSK-13", verb: "schedule", dueAt: "2026-10-12T19:59:59.000Z" });
  assertEquals(task(sb, 13).due_at, "2026-10-12T19:59:59.000Z");
  await act(sb, { ref: "TSK-13", verb: "schedule", date: null });
  assertEquals(task(sb, 13).due_at, null);
  const err = async (date: unknown) => (await act(sb, { ref: "TSK-13", verb: "schedule", date })).body.error;
  assertEquals(await err("2026-10-08"), "The date cannot be in the past.");
  assertEquals(await err("2027-10-10"), "The date is too far ahead.");
  assertEquals(await err("2026-02-30"), "Invalid date.");
  assertEquals(sb.tables.cleaning_log.map((l: any) => [l.reservation_key, l.action, l.details]), [
    ["task_13", "problem_scheduled", { date: "2026-10-12" }],
    ["task_13", "problem_scheduled", { date: null }],
  ]);
});

Deno.test("assign et schedule refuses sur une tache close, la cle est liberee ; comment accepte", async () => {
  const sb = seed();
  assertEquals(await act(sb, { ref: "TSK-19", verb: "assign", memberId: 7 }), { status: 409, body: { error: "TSK-19 is closed. Reopen it first." } });
  assertEquals((await act(sb, { ref: "TSK-19", verb: "schedule", date: "2026-10-10" })).body.error, "TSK-19 is closed. Reopen it first.");
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals((await act(sb, { ref: "TSK-19", verb: "comment", text: "Checked again" })).status, 200);
});

Deno.test("comment : auteur de la session, texte borne, vide refuse", async () => {
  const sb = seed();
  const r = await act(sb, { ref: "TSK-13", verb: "comment", text: "  Called the gas company.  ", author: "Hillal" });
  const cm = r.body.comment as { author: string; text: string };
  assertEquals([cm.author, cm.text], ["Walter", "Called the gas company."]);
  await act(sb, { ref: "TSK-13", verb: "comment", text: "x".repeat(2500) });
  assertEquals(sb.tables.team_task_comments.map((c: any) => [c.task_id, c.cleaner_id, c.body.length]), [[13, 8, 23], [13, 8, 2000]]);
  assertEquals((await act(sb, { ref: "TSK-13", verb: "comment", text: "   " })).body.error, "Write a comment first.");
});

Deno.test("close et reopen TSK : done par la session, note en commentaire, retour a in_progress ; deux fois = 409", async () => {
  const sb = seed();
  task(sb, 13).status = "in_progress";
  assertEquals((await act(sb, { ref: "TSK-13", verb: "close", note: "Done by phone" })).body,
    { status: "success", ref: "TSK-13", verb: "close", closed: true });
  const t = task(sb, 13);
  assertEquals([t.status, t.completed_at, t.completed_by_cleaner_id], ["done", "2026-10-09T07:00:00.000Z", 8]);
  assertEquals(sb.tables.team_task_comments.map((c: any) => [c.task_id, c.cleaner_id, c.body]), [[13, 8, "Done by phone"]]);
  assertEquals(await act(sb, { ref: "TSK-13", verb: "close" }), { status: 409, body: { error: "TSK-13 is already closed." } });
  assertEquals((await act(sb, { ref: "TSK-13", verb: "reopen" })).body, { status: "success", ref: "TSK-13", verb: "reopen", state: "in_progress" });
  assertEquals([t.status, t.completed_at, t.completed_by_cleaner_id], ["in_progress", null, null]);
  assertEquals((await act(sb, { ref: "TSK-13", verb: "reopen" })).body.error, "TSK-13 is not closed.");
});

Deno.test("reopen TSK : horodatages Postgres avec decalage, un close plus recent que le reopen reste pris", async () => {
  const sb = seed();
  sb.tables.team_tasks.push({ id: 21, title: "x", status: "done", assigned_cleaner_id: 7, source_ref: null });
  sb.tables.cleaning_log.push(
    { id: 1, reservation_key: "task_21", action: "problem_closed", created_at: "2026-10-09T10:00:00+04:00", details: { from: "open" } },
    { id: 2, reservation_key: "task_21", action: "problem_reopened", created_at: "2026-10-09T06:30:00+00:00", details: { to: "open" } },
    { id: 3, reservation_key: "task_21", action: "problem_closed", created_at: "2026-10-09T10:45:00+04:00", details: { from: "in_progress" } },
  );
  await act(sb, { ref: "TSK-21", verb: "reopen" });
  assertEquals(task(sb, 21).status, "in_progress");
  sb.tables.cleaning_log.push({ id: 4, reservation_key: "task_21", action: "problem_reopened", created_at: "2026-10-09T06:50:00Z", details: {} });
  task(sb, 21).status = "done";
  await act(sb, { ref: "TSK-21", verb: "reopen" });
  assertEquals(task(sb, 21).status, "open");
});
