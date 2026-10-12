import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { MNT_ACT_EVENT, mntAct } from "./mnt_act.ts";

const NOW = Date.parse("2026-10-12T07:00:00Z"); // 11:00 Dubai
const NOW_ISO = "2026-10-12T07:00:00.000Z";
const ME = { cleaner_id: 7, name: "Semax", role: "maintenance", color: "#000" };
const Q1 = { message_id: "m1", at: "2026-10-11T08:00:00Z", text: "The AC is blowing hot air" };
const Q2 = { message_id: "m2", at: "2026-10-11T20:00:00Z", text: "Still hot, please help" };

const seed = () => fakeDb({
  maintenance_proposals: [
    { id: 11, listing_id: "L1", conversation_id: "c1", title: "AC blowing hot air", category: "ac", urgency: "urgent",
      quotes: [Q1, Q2], status: "pending", dedup_key: "c1|ac" },
    { id: 12, listing_id: "L2", conversation_id: "c2", title: "Wifi down", category: "wifi_tv", urgency: "normal",
      quotes: [Q1], status: "pending", dedup_key: "c2|wifi_tv" },
    { id: 13, listing_id: "L1", conversation_id: "c3", title: "Old", category: "other", urgency: "normal",
      quotes: [], status: "rejected", dedup_key: "c3|other" },
  ],
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "AC leak", category: "ac", priority: "urgent", status: "open",
      assigned_technician_id: null, assigned_vendor_id: null, resolved_at: null },
    { id: 430, listing_id: "L1", title: "Boiler", category: "hot_water", priority: "high", status: "assigned",
      assigned_technician_id: 7, assigned_vendor_id: null },
    { id: 431, listing_id: "L2", title: "Fridge", category: "appliance", priority: "medium", status: "in_progress",
      assigned_technician_id: null, assigned_vendor_id: 3, started_at: "2026-10-10T08:00:00Z" },
    { id: 432, listing_id: "L2", title: "Tap", category: "plumbing", priority: "medium", status: "waiting_parts",
      assigned_technician_id: 4, assigned_vendor_id: null },
    { id: 433, listing_id: "L2", title: "Confirm", category: "other", priority: "medium", status: "to_confirm",
      assigned_technician_id: null, assigned_vendor_id: null },
    { id: 300, listing_id: "L1", title: "Closed one", category: "ac", priority: "urgent", status: "resolved",
      assigned_technician_id: 7, assigned_vendor_id: null, resolved_at: "2026-10-01T08:00:00Z" },
    { id: 301, listing_id: "L1", title: "Closed alone", category: "ac", priority: "medium", status: "closed",
      assigned_technician_id: null, assigned_vendor_id: null, resolved_at: "2026-10-01T08:00:00Z" },
  ],
  cleaners: [
    { id: 7, name: "Semax", role: "maintenance", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 4, name: "Faiza", role: "cleaner", is_active: true }, { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 9, name: "Gone", role: "maintenance", is_active: false },
  ],
  vendors: [{ id: 3, name: "CoolFix", is_active: true }, { id: 2, name: "Old Co", is_active: false }],
  job_events: [], cleaning_log: [], ticket_comments: [], maintenance_costs: [],
  photos: [{ id: 1, storage_path: "tickets/431/a.jpg", ticket_id: 431, cleaner_id: 7, kind: "photo" },
    { id: 2, storage_path: "v3/2026-10-12/other.jpg", ticket_id: 429, cleaner_id: 7, kind: "photo" }],
  team_tasks: [],
});
let n = 0;
const act = (sb: any, body: any, deps: any = {}) => mntAct(sb, ME, { idem: "idem-mnt-" + (++n), ...body }, { nowMs: NOW, ...deps });
const ticket = (sb: any, id: number) => sb.tables.maintenance_tickets.find((x: any) => x.id === id);
const proposal = (sb: any, id: number) => sb.tables.maintenance_proposals.find((x: any) => x.id === id);
const logs = (sb: any) => sb.tables.cleaning_log.map((l: any) => [l.reservation_key, l.action, l.actor]);
const err = async (sb: any, body: any) => (await act(sb, body)).body.error;
const ACCEPT = { op: "proposal.accept", proposalId: 11, title: "AC blowing hot air", listingId: "L1", category: "ac", urgency: "urgent" };

Deno.test("proposal.accept : ticket cree, citations en commentaires Guest dans l'ordre, proposition acceptee, journal", async () => {
  const sb = seed();
  const sent: any[] = [];
  const r = await act(sb, { ...ACCEPT, memberId: 4, note: "Check the filter", author: "Hillal" },
    { notifyAssignee: (t: any) => { sent.push(t); } });
  const id = Number(r.body.ticketId);
  assertEquals(r, { status: 200, body: { ok: true, ticketId: id, ref: "MNT-" + id } });
  const t = ticket(sb, id);
  assertEquals([t.listing_id, t.title, t.description, t.category, t.priority, t.status, t.source, t.source_ref, t.proposal_id,
    t.reported_by, t.assigned_technician_id, t.assigned_vendor_id, t.last_update],
    ["L1", "AC blowing hot air", "Check the filter", "ac", "urgent", "assigned", "guest_message", "proposal:11", 11,
      "Semax", 4, null, NOW_ISO]);
  assertEquals(sb.tables.ticket_comments.map((c: any) => [c.ticket_id, c.author, c.comment]),
    [[id, "Guest", Q1.text], [id, "Guest", Q2.text]]);
  const p = proposal(sb, 11);
  assertEquals([p.status, p.ticket_id, p.decided_by, p.decided_at], ["accepted", id, "Semax", NOW_ISO]);
  assertEquals(logs(sb), [["ticket_" + id, "mnt_proposal.accept", "Semax"]]);
  assertEquals(sb.tables.job_events.map((e: any) => [e.event_type, e.job_id, e.cleaner_id]), [[MNT_ACT_EVENT, "PRP-11", 7]]);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(sent, [{ ticketId: id, memberId: 4, title: "AC blowing hot air", urgent: true }]);
});

Deno.test("proposal.accept : sans intervenant = open, note vide = null, titre coupe a 120, priorite medium pour normal", async () => {
  const sb = seed();
  const r = await act(sb, { ...ACCEPT, proposalId: 12, title: "x".repeat(200), listingId: "L2", category: "wifi_tv", urgency: "normal",
    memberId: null, vendorId: null, note: "  " });
  const t = ticket(sb, Number(r.body.ticketId));
  assertEquals([t.title.length, t.status, t.priority, t.description, t.assigned_technician_id, t.assigned_vendor_id],
    [120, "open", "medium", null, null, null]);
  const r2 = await act(sb, { ...ACCEPT, vendorId: 3, urgency: "high" });
  const t2 = ticket(sb, Number(r2.body.ticketId));
  assertEquals([t2.status, t2.priority, t2.assigned_vendor_id], ["assigned", "high", 3]);
});

Deno.test("Review Focus 2 : proposition deja traitee (deux telephones) = 409, pas de second ticket", async () => {
  const sb = seed();
  assertEquals((await act(sb, ACCEPT)).status, 200);
  const before = sb.tables.maintenance_tickets.length;
  assertEquals(await act(sb, ACCEPT), { status: 409, body: { error: "This proposal was already handled." } });
  assertEquals(await err(sb, { op: "proposal.reject", proposalId: 11, reason: "duplicate" }), "This proposal was already handled.");
  assertEquals(await err(sb, { op: "proposal.merge", proposalId: 13, ticketId: 429 }), "This proposal was already handled.");
  assertEquals(sb.tables.maintenance_tickets.length, before);
  assertEquals(sb.tables.ticket_comments.length, 2);
  // Les cles refusees sont liberees : seule la premiere reste.
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("Review Focus 2 : course entre la lecture et l'ecriture, la proposition change sous nos pieds", async () => {
  const sb = seed();
  // L'autre telephone decide juste apres notre lecture : on simule en passant la ligne a rejected avant l'update.
  const orig = sb.from;
  let reads = 0;
  (sb as any).from = (table: string) => {
    const q = orig(table);
    if (table === "maintenance_proposals") {
      const sel = q.select;
      q.select = (...a: any[]) => {
        reads++;
        if (reads === 2) proposal(sb, 11).status = "rejected";
        return sel(...a);
      };
    }
    return q;
  };
  const r = await act(sb, ACCEPT);
  assertEquals(r, { status: 409, body: { error: "This proposal was already handled." } });
  assertEquals(sb.tables.maintenance_tickets.length, 7);
  assertEquals(sb.tables.ticket_comments.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("proposal.accept : refus de saisie avant toute ecriture", async () => {
  const sb = seed();
  assertEquals(await err(sb, { ...ACCEPT, title: "  " }), "Write a title first.");
  assertEquals(await err(sb, { ...ACCEPT, memberId: 9 }), "Invalid person.");
  assertEquals(await err(sb, { ...ACCEPT, memberId: 12 }), "Invalid person.");
  assertEquals(await err(sb, { ...ACCEPT, memberId: "abc" }), "Invalid person.");
  assertEquals(await err(sb, { ...ACCEPT, memberId: 999 }), "Invalid person.");
  assertEquals(await err(sb, { ...ACCEPT, vendorId: 2 }), "Invalid vendor.");
  assertEquals(await err(sb, { ...ACCEPT, vendorId: "x" }), "Invalid vendor.");
  assertEquals(await err(sb, { ...ACCEPT, memberId: 4, vendorId: 3 }), "Choose a person or a vendor, not both.");
  assertEquals(await err(sb, { ...ACCEPT, category: "magic" }), "Choose a category.");
  assertEquals(await err(sb, { ...ACCEPT, urgency: "asap" }), "Choose an urgency.");
  assertEquals(await act(sb, { ...ACCEPT, proposalId: 999 }), { status: 404, body: { error: "Not found." } });
  assertEquals(await err(sb, { op: "explode" }), "Unknown action.");
  assertEquals((await mntAct(sb, ME, { ...ACCEPT, idem: "x" }, { nowMs: NOW })).body.error, "idem required");
  assertEquals(sb.writes.length, 0);
});

Deno.test("proposal.reject : raison obligatoire, other exige une note", async () => {
  const sb = seed();
  assertEquals(await err(sb, { op: "proposal.reject", proposalId: 11 }), "Choose a reason.");
  assertEquals(await err(sb, { op: "proposal.reject", proposalId: 11, reason: "boring" }), "Choose a reason.");
  assertEquals(await err(sb, { op: "proposal.reject", proposalId: 11, reason: "other", note: " " }), "Write why.");
  assertEquals(sb.writes.length, 0);
  const r = await act(sb, { op: "proposal.reject", proposalId: 11, reason: "other", note: "Guest joking" });
  assertEquals(r, { status: 200, body: { ok: true, proposalId: 11 } });
  const p = proposal(sb, 11);
  assertEquals([p.status, p.reject_reason, p.reject_note, p.decided_by, p.decided_at, p.ticket_id ?? null],
    ["rejected", "other", "Guest joking", "Semax", NOW_ISO, null]);
  await act(sb, { op: "proposal.reject", proposalId: 12, reason: "not_maintenance" });
  assertEquals([proposal(sb, 12).reject_reason, proposal(sb, 12).reject_note], ["not_maintenance", null]);
  assertEquals(logs(sb), [["proposal_11", "mnt_proposal.reject", "Semax"], ["proposal_12", "mnt_proposal.reject", "Semax"]]);
  assertEquals(sb.tables.maintenance_tickets.length, 7);
});

Deno.test("proposal.merge : citations ajoutees au ticket ouvert, proposition merged ; ticket clos = 409", async () => {
  const sb = seed();
  assertEquals(await act(sb, { op: "proposal.merge", proposalId: 11, ticketId: 300 }),
    { status: 409, body: { error: "This ticket is closed. Reopen it first." } });
  assertEquals(await act(sb, { op: "proposal.merge", proposalId: 11, ticketId: 9999 }), { status: 404, body: { error: "Not found." } });
  assertEquals(proposal(sb, 11).status, "pending");
  const r = await act(sb, { op: "proposal.merge", proposalId: 11, ticketId: 429 });
  assertEquals(r, { status: 200, body: { ok: true, ticketId: 429, ref: "MNT-429" } });
  assertEquals(sb.tables.ticket_comments.map((c: any) => [c.ticket_id, c.author, c.comment]), [[429, "Guest", Q1.text], [429, "Guest", Q2.text]]);
  const p = proposal(sb, 11);
  assertEquals([p.status, p.ticket_id, p.decided_by], ["merged", 429, "Semax"]);
  assertEquals(ticket(sb, 429).last_update, NOW_ISO);
  assertEquals(logs(sb), [["ticket_429", "mnt_proposal.merge", "Semax"]]);
});

Deno.test("ticket.create : meme insertion que accept, source manual, sans proposition", async () => {
  const sb = seed();
  const sent: any[] = [];
  const r = await act(sb, { op: "ticket.create", title: "Broken chair", listingId: "L2", category: "furniture", urgency: "normal",
    memberId: 7, note: "Leg loose" }, { notifyAssignee: (t: any) => { sent.push(t); } });
  const id = Number(r.body.ticketId);
  assertEquals(r.body, { ok: true, ticketId: id, ref: "MNT-" + id });
  const t = ticket(sb, id);
  assertEquals([t.source, t.source_ref ?? null, t.proposal_id ?? null, t.status, t.priority, t.reported_by, t.description],
    ["manual", null, null, "assigned", "medium", "Semax", "Leg loose"]);
  assertEquals(sb.tables.ticket_comments.length, 0);
  assertEquals(logs(sb), [["ticket_" + id, "mnt_ticket.create", "Semax"]]);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(sent, [{ ticketId: id, memberId: 7, title: "Broken chair", urgent: false }]);
  assertEquals(await err(sb, { op: "ticket.create", title: "", listingId: "L2", category: "ac", urgency: "normal" }), "Write a title first.");
  assertEquals(await err(sb, { op: "ticket.create", title: "x", category: "ac", urgency: "normal" }), "Choose an apartment.");
});

Deno.test("ticket.start : todo et waiting_parts seulement ; clos = 409", async () => {
  const sb = seed();
  assertEquals(await act(sb, { op: "ticket.start", ticketId: 429 }), { status: 200, body: { ok: true, ticketId: 429, status: "in_progress" } });
  assertEquals([ticket(sb, 429).status, ticket(sb, 429).started_at, ticket(sb, 429).last_update], ["in_progress", NOW_ISO, NOW_ISO]);
  assertEquals((await act(sb, { op: "ticket.start", ticketId: 432 })).status, 200);
  assertEquals((await act(sb, { op: "ticket.start", ticketId: 430 })).status, 200);
  assertEquals(await act(sb, { op: "ticket.start", ticketId: 300 }), { status: 409, body: { error: "This ticket is closed. Reopen it first." } });
  assertEquals(await err(sb, { op: "ticket.start", ticketId: 431 }), "This ticket is already in progress.");
  assertEquals(await act(sb, { op: "ticket.start", ticketId: 9999 }), { status: 404, body: { error: "Not found." } });
  assertEquals(logs(sb), [["ticket_429", "mnt_ticket.start", "Semax"], ["ticket_432", "mnt_ticket.start", "Semax"], ["ticket_430", "mnt_ticket.start", "Semax"]]);
  assertEquals(sb.tables.job_events.length, 3);
});

Deno.test("S4 ruling F : ticket.start accepte to_confirm (Reopen as still broken)", async () => {
  const sb = seed();
  assertEquals(await act(sb, { op: "ticket.start", ticketId: 433 }), { status: 200, body: { ok: true, ticketId: 433, status: "in_progress" } });
  assertEquals(ticket(sb, 433).status, "in_progress");
});

Deno.test("ticket.waiting_parts : note en commentaire si donnee", async () => {
  const sb = seed();
  await act(sb, { op: "ticket.waiting_parts", ticketId: 431, note: "Compressor ordered", author: "Hillal" });
  assertEquals([ticket(sb, 431).status, ticket(sb, 431).last_update], ["waiting_parts", NOW_ISO]);
  assertEquals(sb.tables.ticket_comments.map((c: any) => [c.ticket_id, c.author, c.comment]), [[431, "Semax", "Compressor ordered"]]);
  await act(sb, { op: "ticket.waiting_parts", ticketId: 429 });
  assertEquals([ticket(sb, 429).status, sb.tables.ticket_comments.length], ["waiting_parts", 1]);
  assertEquals(await err(sb, { op: "ticket.waiting_parts", ticketId: 300 }), "This ticket is closed. Reopen it first.");
  assertEquals(logs(sb), [["ticket_431", "mnt_ticket.waiting_parts", "Semax"], ["ticket_429", "mnt_ticket.waiting_parts", "Semax"]]);
});

Deno.test("ticket.done : resolved, note, photo, cout et ligne de cout ; journal mnt_ticket.done lu par mnt_read", async () => {
  const sb = seed();
  const r = await act(sb, { op: "ticket.done", ticketId: 431, note: "Replaced compressor", photoPath: "tickets/431/a.jpg", cost: 450.5 });
  assertEquals(r, { status: 200, body: { ok: true, ticketId: 431, status: "resolved" } });
  const t = ticket(sb, 431);
  assertEquals([t.status, t.resolved_at, t.resolution_notes, t.resolution_photo_path, t.actual_cost, t.last_update],
    ["resolved", NOW_ISO, "Replaced compressor", "tickets/431/a.jpg", 450.5, NOW_ISO]);
  assertEquals(sb.tables.maintenance_costs.map((c: any) => [c.ticket_id, c.listing_id, c.category, c.description, c.amount, c.vendor_id, c.date]),
    [[431, "L2", "appliance", "Fridge", 450.5, 3, "2026-10-12"]]);
  assertEquals(sb.tables.cleaning_log.map((l: any) => [l.reservation_key, l.action, l.actor]), [["ticket_431", "mnt_ticket.done", "Semax"]]);
  assertEquals(await err(sb, { op: "ticket.done", ticketId: 431 }), "This ticket is closed. Reopen it first.");
});

Deno.test("Review Focus 3 : cout vide = null sans ligne ; 0 est un vrai cout ; non numerique = 400 ; photo invalide ignoree", async () => {
  const sb = seed();
  for (const cost of [undefined, null, "", "  "]) {
    const s = seed();
    const r = await mntAct(s, ME, { idem: "idem-cost-" + (++n), op: "ticket.done", ticketId: 429, cost, photoPath: "" }, { nowMs: NOW });
    assertEquals(r.status, 200);
    assertEquals([ticket(s, 429).status, ticket(s, 429).actual_cost ?? null, ticket(s, 429).resolution_photo_path, ticket(s, 429).resolution_notes],
      ["resolved", null, null, null]);
    assertEquals(s.tables.maintenance_costs.length, 0);
  }
  await act(sb, { op: "ticket.done", ticketId: 429, cost: 0, photoPath: "x".repeat(300) });
  assertEquals([ticket(sb, 429).actual_cost, ticket(sb, 429).resolution_photo_path], [0, null]);
  assertEquals(sb.tables.maintenance_costs.map((c: any) => [c.ticket_id, c.amount, c.vendor_id]), [[429, 0, null]]);
  await act(sb, { op: "ticket.done", ticketId: 430, cost: "120" });
  assertEquals(ticket(sb, 430).actual_cost, 120);
  assertEquals(await err(sb, { op: "ticket.done", ticketId: 432, cost: "abc" }), "Cost must be a number.");
  assertEquals(await err(sb, { op: "ticket.done", ticketId: 432, cost: "Infinity" }), "Cost must be a number.");
  for (const cost of [-5, "-5", "0x10", "1e3", "12.345", "1,5", Infinity, NaN, true, {}]) {
    assertEquals(await err(sb, { op: "ticket.done", ticketId: 432, cost }), "Cost must be a number.");
  }
  assertEquals(ticket(sb, 432).status, "waiting_parts");
  assertEquals(sb.tables.maintenance_costs.map((c: any) => c.ticket_id), [429, 430]);
  await act(sb, { op: "ticket.done", ticketId: 432, cost: " 12.5 " });
  assertEquals(ticket(sb, 432).actual_cost, 12.5);
  await act(sb, { op: "ticket.done", ticketId: 433, cost: 99.999 });
  assertEquals(ticket(sb, 433).actual_cost, 99.999);
});

Deno.test("ticket.done : ecriture du ticket ratee = cle liberee, aucune ligne de cout, erreur remontee", async () => {
  const sb = seed();
  sb.fail["maintenance_tickets.update"] = { message: "db down" };
  let msg = "";
  try { await act(sb, { op: "ticket.done", ticketId: 429, cost: 10 }); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.maintenance_costs.length, 0);
});

Deno.test("ticket.done : deux telephones en meme temps = une seule cloture, une seule ligne de cout", async () => {
  const sb = seed();
  const [a, b] = await Promise.all([
    act(sb, { op: "ticket.done", ticketId: 429, cost: 50 }),
    act(sb, { op: "ticket.done", ticketId: 429, cost: 70 }),
  ]);
  assertEquals([a.status, b.status].sort(), [200, 409]);
  assertEquals((a.status === 409 ? a : b).body, { error: "This ticket is closed. Reopen it first." });
  assertEquals(sb.tables.maintenance_costs.length, 1);
  assertEquals(sb.tables.cleaning_log.filter((l: any) => l.action === "mnt_ticket.done").length, 1);
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("ticket.done : ticket clos entre la lecture et l'ecriture = 409, cle liberee, aucune ligne de cout", async () => {
  const sb = seed();
  const orig = sb.from;
  (sb as any).from = (table: string) => {
    const q = orig(table);
    if (table === "maintenance_tickets") {
      const upd = q.update;
      q.update = (v: any) => { ticket(sb, 429).status = "resolved"; return upd(v); };
    }
    return q;
  };
  assertEquals(await act(sb, { op: "ticket.done", ticketId: 429, cost: 50 }), { status: 409, body: { error: "This ticket is closed. Reopen it first." } });
  assertEquals(sb.tables.maintenance_costs.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals(sb.tables.cleaning_log.length, 0);
});

Deno.test("ticket.done : ligne de cout ratee = ticket remis dans son etat, cle liberee, erreur remontee", async () => {
  const sb = seed();
  sb.fail["maintenance_costs.insert"] = { message: "db down" };
  let msg = "";
  try { await act(sb, { op: "ticket.done", ticketId: 431, cost: 10, note: "x" }); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  const t = ticket(sb, 431);
  assertEquals([t.status, t.resolved_at ?? null, t.actual_cost ?? null, t.resolution_notes ?? null], ["in_progress", null, null, null]);
  assertEquals(sb.tables.job_events.length, 0);
  delete sb.fail["maintenance_costs.insert"];
  assertEquals((await act(sb, { op: "ticket.done", ticketId: 431, cost: 10 })).status, 200);
});

Deno.test("ticket.reopen : clos seulement ; assigned si quelqu'un est assigne, sinon open", async () => {
  const sb = seed();
  assertEquals(await act(sb, { op: "ticket.reopen", ticketId: 300 }), { status: 200, body: { ok: true, ticketId: 300, status: "assigned" } });
  assertEquals([ticket(sb, 300).status, ticket(sb, 300).resolved_at, ticket(sb, 300).last_update], ["assigned", null, NOW_ISO]);
  assertEquals((await act(sb, { op: "ticket.reopen", ticketId: 301 })).body.status, "open");
  assertEquals(await act(sb, { op: "ticket.reopen", ticketId: 429 }), { status: 409, body: { error: "This ticket is not closed." } });
  assertEquals(logs(sb), [["ticket_300", "mnt_ticket.reopen", "Semax"], ["ticket_301", "mnt_ticket.reopen", "Semax"]]);
});

Deno.test("ticket.assign : membre, prestataire, retrait ; statut suit en todo seulement ; notification au nouveau membre seulement", async () => {
  const sb = seed();
  const sent: any[] = [];
  const deps = { notifyAssignee: (t: any) => { sent.push(t); } };
  const r = await act(sb, { op: "ticket.assign", ticketId: 429, memberId: 4 }, deps);
  assertEquals(r, { status: 200, body: { ok: true, ticketId: 429, assignee: { kind: "member", id: 4, name: "Faiza" } } });
  assertEquals([ticket(sb, 429).assigned_technician_id, ticket(sb, 429).status, ticket(sb, 429).last_update], [4, "assigned", NOW_ISO]);
  await act(sb, { op: "ticket.assign", ticketId: 429, memberId: 4 }, deps);
  await act(sb, { op: "ticket.assign", ticketId: 429, vendorId: 3 }, deps);
  assertEquals([ticket(sb, 429).assigned_technician_id, ticket(sb, 429).assigned_vendor_id, ticket(sb, 429).status], [null, 3, "assigned"]);
  assertEquals((await act(sb, { op: "ticket.assign", ticketId: 429, unassign: true }, deps)).body.assignee, null);
  assertEquals([ticket(sb, 429).assigned_vendor_id, ticket(sb, 429).status], [null, "open"]);
  await act(sb, { op: "ticket.assign", ticketId: 431, memberId: 7 }, deps);
  assertEquals(ticket(sb, 431).status, "in_progress");
  await act(sb, { op: "ticket.assign", ticketId: 431, unassign: true }, deps);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(sent, [
    { ticketId: 429, memberId: 4, title: "AC leak", urgent: true },
    { ticketId: 431, memberId: 7, title: "Fridge", urgent: false },
  ]);
  assertEquals(await err(sb, { op: "ticket.assign", ticketId: 300, memberId: 4 }), "This ticket is closed. Reopen it first.");
  assertEquals(await err(sb, { op: "ticket.assign", ticketId: 429 }), "Choose a person or a vendor.");
  assertEquals(await err(sb, { op: "ticket.assign", ticketId: 429, memberId: 12 }), "Invalid person.");
  assertEquals(await err(sb, { op: "ticket.assign", ticketId: 429, vendorId: 2 }), "Invalid vendor.");
  assertEquals(logs(sb).filter((l: any) => l[0] === "ticket_429").length, 4);
  assertEquals(logs(sb)[0], ["ticket_429", "mnt_ticket.assign", "Semax"]);
});

Deno.test("notifyAssignee qui leve ou rejette ne fait jamais echouer le geste", async () => {
  const sb = seed();
  const r1 = await act(sb, { op: "ticket.assign", ticketId: 429, memberId: 4 }, { notifyAssignee: () => { throw new Error("push down"); } });
  assertEquals(r1.status, 200);
  const r2 = await act(sb, { ...ACCEPT, memberId: 4 }, { notifyAssignee: () => Promise.reject(new Error("push down")) });
  assertEquals(r2.status, 200);
  await new Promise((r) => setTimeout(r, 0));
});

Deno.test("ticket.due : aujourd'hui a +60 jours (Dubai), retrait, erreurs", async () => {
  const sb = seed();
  assertEquals(await act(sb, { op: "ticket.due", ticketId: 429, date: "2026-10-12" }), { status: 200, body: { ok: true, ticketId: 429, dueOn: "2026-10-12" } });
  assertEquals([ticket(sb, 429).due_on, ticket(sb, 429).last_update], ["2026-10-12", NOW_ISO]);
  assertEquals((await act(sb, { op: "ticket.due", ticketId: 429, date: "2026-12-11" })).status, 200);
  await act(sb, { op: "ticket.due", ticketId: 429, date: null });
  assertEquals(ticket(sb, 429).due_on, null);
  assertEquals(await err(sb, { op: "ticket.due", ticketId: 429, date: "2026-10-11" }), "The date cannot be in the past.");
  assertEquals(await err(sb, { op: "ticket.due", ticketId: 429, date: "2026-12-12" }), "The date is too far ahead.");
  assertEquals(await err(sb, { op: "ticket.due", ticketId: 429, date: "2026-02-30" }), "Invalid date.");
  assertEquals(await err(sb, { op: "ticket.due", ticketId: 429, date: "tomorrow" }), "Invalid date.");
  assertEquals(logs(sb), [["ticket_429", "mnt_ticket.due", "Semax"], ["ticket_429", "mnt_ticket.due", "Semax"], ["ticket_429", "mnt_ticket.due", "Semax"]]);
});

Deno.test("ticket.comment : auteur de la session meme si le corps en donne un, vide refuse, accepte sur un ticket clos", async () => {
  const sb = seed();
  const r = await act(sb, { op: "ticket.comment", ticketId: 300, text: "  Checked again  ", author: "Hillal" });
  assertEquals(r.status, 200);
  assertEquals(r.body.comment, { author: "Semax", text: "Checked again", at: NOW_ISO });
  assertEquals(sb.tables.ticket_comments.map((c: any) => [c.ticket_id, c.author, c.comment]), [[300, "Semax", "Checked again"]]);
  assertEquals(ticket(sb, 300).last_update, NOW_ISO);
  assertEquals(await err(sb, { op: "ticket.comment", ticketId: 429, text: "  " }), "Write a comment first.");
  assertEquals(logs(sb), [["ticket_300", "mnt_ticket.comment", "Semax"]]);
});

Deno.test("idempotence : meme cle = meme reponse sans seconde ecriture ; cle posee sans resultat = 409", async () => {
  const sb = seed();
  const sent: any[] = [];
  const body = { ...ACCEPT, memberId: 4, idem: "idem-replay-mnt-1" };
  const deps = { nowMs: NOW, notifyAssignee: (t: any) => { sent.push(t); } };
  const a = await mntAct(sb, ME, body, deps);
  const writes = sb.writes.length;
  const b = await mntAct(sb, ME, body, deps);
  assertEquals(b, a);
  assertEquals(sb.tables.maintenance_tickets.length, 8);
  assertEquals(sb.tables.ticket_comments.length, 2);
  assertEquals(sb.writes.length, writes);
  await new Promise((r) => setTimeout(r, 0));
  assertEquals(sent.length, 1);
  const c1 = { op: "ticket.comment", ticketId: 429, text: "Hello", idem: "idem-replay-mnt-2" };
  const x = await mntAct(sb, ME, c1, deps);
  assertEquals(await mntAct(sb, ME, c1, deps), x);
  assertEquals(sb.tables.ticket_comments.length, 3);
  sb.tables.job_events.push({ id: 77, idem_key: "idem-pending-mnt", event_type: "mnt_act", result: null });
  assertEquals(await mntAct(sb, ME, { ...c1, idem: "idem-pending-mnt" }, deps), { status: 409, body: { error: "Still processing. Retry." } });
});

Deno.test("accept : insertion du ticket ratee = proposition remise en attente, cle liberee", async () => {
  const sb = seed();
  sb.fail["maintenance_tickets.insert"] = { message: "db down" };
  let msg = "";
  try { await act(sb, ACCEPT); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  assertEquals(proposal(sb, 11).status, "pending");
  assertEquals(sb.tables.job_events.length, 0);
  delete sb.fail["maintenance_tickets.insert"];
  assertEquals((await act(sb, ACCEPT)).status, 200);
});

Deno.test("F1 : done 50, reopen, done 80 = une seule ligne de 80 et actual_cost 80", async () => {
  const sb = seed();
  assertEquals((await act(sb, { op: "ticket.done", ticketId: 429, cost: 50 })).status, 200);
  assertEquals((await act(sb, { op: "ticket.reopen", ticketId: 429 })).status, 200);
  assertEquals((await act(sb, { op: "ticket.done", ticketId: 429, cost: 80 })).status, 200);
  assertEquals(sb.tables.maintenance_costs.map((c: any) => [c.ticket_id, c.amount]), [[429, 80]]);
  assertEquals([ticket(sb, 429).status, ticket(sb, 429).actual_cost], ["resolved", 80]);
});

Deno.test("F1 : done 50, reopen, done sans cout = la ligne de 50 reste et actual_cost 50", async () => {
  const sb = seed();
  await act(sb, { op: "ticket.done", ticketId: 429, cost: 50 });
  await act(sb, { op: "ticket.reopen", ticketId: 429 });
  for (const cost of [undefined, ""]) {
    assertEquals((await act(sb, { op: "ticket.done", ticketId: 429, cost })).status, 200);
    assertEquals(sb.tables.maintenance_costs.map((c: any) => [c.ticket_id, c.amount]), [[429, 50]]);
    assertEquals([ticket(sb, 429).status, ticket(sb, 429).actual_cost], ["resolved", 50]);
    await act(sb, { op: "ticket.reopen", ticketId: 429 });
  }
});

Deno.test("F1 : remplacement du cout rate = ancienne ligne et ancien actual_cost gardes, ticket remis", async () => {
  const sb = seed();
  await act(sb, { op: "ticket.done", ticketId: 429, cost: 50 });
  await act(sb, { op: "ticket.reopen", ticketId: 429 });
  sb.fail["maintenance_costs.insert"] = { message: "db down" };
  let msg = "";
  try { await act(sb, { op: "ticket.done", ticketId: 429, cost: 80 }); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  assertEquals(sb.tables.maintenance_costs.map((c: any) => [c.ticket_id, c.amount]), [[429, 50]]);
  assertEquals([ticket(sb, 429).status, ticket(sb, 429).actual_cost], ["open", 50]);
  delete sb.fail["maintenance_costs.insert"];
  // Le retrait des anciennes lignes rate une fois (le retrait de la nouvelle ligne, ensuite, passe).
  let once = true;
  const orig = sb.from;
  (sb as any).from = (table: string) => {
    const q = orig(table);
    if (table !== "maintenance_costs") return q;
    const del = q.delete;
    q.delete = () => {
      const r = del();
      if (once) { once = false; r.then = (res: any) => Promise.resolve({ data: null, error: { message: "db down" } }).then(res); }
      return r;
    };
    return q;
  };
  msg = "";
  try { await act(sb, { op: "ticket.done", ticketId: 429, cost: 80 }); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  assertEquals(sb.tables.maintenance_costs.map((c: any) => [c.ticket_id, c.amount]), [[429, 50]]);
  assertEquals([ticket(sb, 429).status, ticket(sb, 429).actual_cost], ["open", 50]);
});

Deno.test("F4 : accept sans appartement ni dans le corps ni sur la proposition = 400, rien d'ecrit", async () => {
  const sb = seed();
  proposal(sb, 12).listing_id = null;
  const body = { ...ACCEPT, proposalId: 12, listingId: undefined, category: "wifi_tv", urgency: "normal" };
  assertEquals(await act(sb, body), { status: 400, body: { error: "Choose an apartment." } });
  assertEquals(await act(sb, { ...body, listingId: "  " }), { status: 400, body: { error: "Choose an apartment." } });
  assertEquals(sb.writes.length, 0);
  const r = await act(sb, { ...body, listingId: "L2" });
  assertEquals(ticket(sb, Number(r.body.ticketId)).listing_id, "L2");
  // la proposition porte deja un appartement : le corps peut s'en passer
  const r2 = await act(sb, { ...ACCEPT, listingId: undefined });
  assertEquals(ticket(sb, Number(r2.body.ticketId)).listing_id, "L1");
});

Deno.test("F7 : statut nul ou hors liste = pas clos, done passe ; clos = 409", async () => {
  const sb = seed();
  ticket(sb, 429).status = null;
  ticket(sb, 430).status = "on_hold";
  assertEquals((await act(sb, { op: "ticket.done", ticketId: 429 })).status, 200);
  assertEquals((await act(sb, { op: "ticket.done", ticketId: 430 })).status, 200);
  assertEquals([ticket(sb, 429).status, ticket(sb, 430).status], ["resolved", "resolved"]);
  assertEquals(await err(sb, { op: "ticket.done", ticketId: 300 }), "This ticket is closed. Reopen it first.");
});

Deno.test("S1 ruling A : done ferme les copies Hermes ouvertes maint:<id>, reopen ne les recree pas, echec sans effet", async () => {
  const sb = seed();
  sb.tables.team_tasks.push(
    { id: 1, source_ref: "maint:429", status: "open", completed_at: null },
    { id: 2, source_ref: "maint:429", status: "in_progress", completed_at: null },
    { id: 3, source_ref: "maint:429", status: "cancelled", completed_at: null },
    { id: 4, source_ref: "maint:430", status: "open", completed_at: null },
  );
  assertEquals((await act(sb, { op: "ticket.done", ticketId: 429 })).status, 200);
  assertEquals(sb.tables.team_tasks.map((t: any) => [t.id, t.status, t.completed_at, t.completed_by_cleaner_id ?? null]), [
    [1, "done", NOW_ISO, 7], [2, "done", NOW_ISO, 7], [3, "cancelled", null, null], [4, "open", null, null],
  ]);
  assertEquals((await act(sb, { op: "ticket.reopen", ticketId: 429 })).status, 200);
  assertEquals(sb.tables.team_tasks.length, 4);
  assertEquals(sb.tables.team_tasks.filter((t: any) => t.status === "done").length, 2);
  const s2 = seed();
  s2.tables.team_tasks.push({ id: 5, source_ref: "maint:430", status: "open", completed_at: null });
  s2.fail["team_tasks.update"] = { message: "db down" };
  assertEquals(await act(s2, { op: "ticket.done", ticketId: 430 }), { status: 200, body: { ok: true, ticketId: 430, status: "resolved" } });
  assertEquals([ticket(s2, 430).status, s2.tables.team_tasks[0].status], ["resolved", "open"]);
});

const inspSeed = () => {
  const sb = seed();
  sb.tables.maintenance_tickets.push({ id: 501, listing_id: "L1", title: "Bedroom: lamp", category: "other", priority: "medium",
    status: "open", source: "inspection", source_ref: "inspection:6:bedrooms", description: "Lamp broken",
    assigned_technician_id: null, assigned_vendor_id: null });
  sb.tables.inspections = [{ id: 6, listing_id: "L1", inspector_id: 5, inspection_date: "2026-10-07", finished_at: "2026-10-07T09:00:00Z" }];
  sb.tables.inspection_items = [
    { id: 1, inspection_id: 6, zone: "bedrooms", status: "not_ok", outcome: "maintenance", ticket_id: 501,
      fix_scheduled_for: null, fix_scheduled_slot: null },
    { id: 2, inspection_id: 6, zone: "kitchen", status: "not_ok", outcome: "fixed", ticket_id: 501,
      fix_scheduled_for: null, fix_scheduled_slot: null },
  ];
  return sb;
};
const WALTER = { cleaner_id: 8, name: "Walter", role: "manager", color: "#000" };

Deno.test("S2 ruling B : due sur un ticket d'inspection = date de rectification de la zone (maintenance seulement)", async () => {
  const sb = inspSeed();
  const r = await mntAct(sb, WALTER, { idem: "idem-insp-due-0001", op: "ticket.due", ticketId: 501, date: "2026-10-14" }, { nowMs: NOW });
  assertEquals(r, { status: 200, body: { ok: true, ticketId: 501, dueOn: "2026-10-14" } });
  assertEquals(ticket(sb, 501).due_on, "2026-10-14");
  assertEquals(sb.tables.inspection_items.map((i: any) => [i.zone, i.fix_scheduled_for, i.fix_scheduled_slot]),
    [["bedrooms", "2026-10-14", null], ["kitchen", null, null]]);
  await mntAct(sb, WALTER, { idem: "idem-insp-due-0002", op: "ticket.due", ticketId: 501, date: null }, { nowMs: NOW });
  assertEquals(sb.tables.inspection_items[0].fix_scheduled_for, null);
  // Ticket hors inspection : aucune zone touchee.
  await mntAct(sb, WALTER, { idem: "idem-insp-due-0003", op: "ticket.due", ticketId: 429, date: "2026-10-15" }, { nowMs: NOW });
  assertEquals(sb.tables.inspection_items.map((i: any) => i.fix_scheduled_for), [null, null]);
});

Deno.test("S2 ruling B : refus ou echec de la date de rectification = geste quand meme reussi (meme semantique qu'avant)", async () => {
  const sb = inspSeed();
  // Semax n'est ni manager ni l'inspecteur : setFixSchedule refuse (403), le ticket garde sa date.
  const r = await act(sb, { op: "ticket.due", ticketId: 501, date: "2026-10-14" });
  assertEquals(r.status, 200);
  assertEquals([ticket(sb, 501).due_on, sb.tables.inspection_items[0].fix_scheduled_for], ["2026-10-14", null]);
  const s2 = inspSeed();
  s2.fail["inspection_items.select"] = { message: "db down" };
  const r2 = await mntAct(s2, WALTER, { idem: "idem-insp-due-0004", op: "ticket.due", ticketId: 501, date: "2026-10-14" }, { nowMs: NOW });
  assertEquals([r2.status, ticket(s2, 501).due_on], [200, "2026-10-14"]);
});

Deno.test("S7 : done n'accepte qu'une photo deposee sur ce ticket, sinon 400 sans rien ecrire", async () => {
  const sb = seed();
  const PHOTO_GONE = "Photo not found. Add it again.";
  for (const photoPath of ["v3/2026-10-12/other.jpg", "nowhere/x.jpg", "https://evil.test/x.jpg"]) {
    assertEquals(await act(sb, { op: "ticket.done", ticketId: 431, photoPath }), { status: 400, body: { error: PHOTO_GONE } });
  }
  assertEquals([ticket(sb, 431).status, sb.tables.job_events.length], ["in_progress", 0]);
  assertEquals((await act(sb, { op: "ticket.done", ticketId: 431, photoPath: "tickets/431/a.jpg" })).status, 200);
  assertEquals(ticket(sb, 431).resolution_photo_path, "tickets/431/a.jpg");
  const s2 = seed();
  s2.fail["photos.select"] = { message: "db down" };
  let msg = "";
  try {
    await act(s2, { op: "ticket.done", ticketId: 431, photoPath: "tickets/431/a.jpg" });
  } catch (e) {
    msg = String((e as any)?.message ?? e);
  }
  assertEquals([msg, ticket(s2, 431).status], ["db down", "in_progress"]);
});
