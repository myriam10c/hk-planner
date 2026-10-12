import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mntList, type MntList, type MntQuery, parseMntQuery } from "./mnt_read.ts";

// 2026-10-12 21:30 UTC = 2026-10-13 01:30 a Dubai : le jour Dubai est le 13.
const NOW = Date.parse("2026-10-12T21:30:00Z");
const ME = { cleaner_id: 7, name: "Semax" };
const Q = (o: Partial<MntQuery> = {}): MntQuery => ({ tab: "proposals", filter: "all", q: "", rejected: false, ...o });

const TK = (id: number, o: any = {}) => ({
  id, listing_id: "L1", title: "Ticket " + id, category: null, priority: "medium", status: "open", source: "whatsapp",
  assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-10-01T08:00:00Z", started_at: null,
  resolved_at: null, resolution_notes: null, actual_cost: null, proposal_id: null, due_on: null, ...o,
});
const PR = (id: number, o: any = {}) => ({
  id, listing_id: "L1", reservation_id: "R" + id, conversation_id: "C" + id, guest_name: "Guest " + id,
  stay_from: "2026-10-10", stay_to: "2026-10-12", title: "Proposal " + id, category: "ac", urgency: "normal",
  quotes: [{ message_id: "m" + id, at: "2026-10-11T10:00:00Z", text: "AC broken" }], status: "pending", ticket_id: null,
  open_ticket_id: null, decided_by: null, decided_at: null, reject_reason: null, reject_note: null, dedup_key: "C" + id + "|ac",
  created_at: "2026-10-11T10:00:00Z", updated_at: "2026-10-11T10:00:00Z", ...o,
});

const db = () => fakeDb({
  maintenance_proposals: [
    PR(1, { urgency: "high", updated_at: "2026-10-12T09:00:00Z" }),
    PR(2, { urgency: "urgent", updated_at: "2026-10-11T09:00:00Z", listing_id: "L2", stay_to: "2026-10-13", open_ticket_id: 10 }),
    PR(3, { urgency: "normal", updated_at: "2026-10-12T10:00:00Z", listing_id: "L9", stay_from: null, stay_to: null }),
    PR(4, { status: "rejected", decided_at: "2026-10-01T10:00:00Z", decided_by: "Walter", reject_reason: "not_maintenance" }),
    PR(5, { status: "merged", decided_at: "2026-10-05T10:00:00Z", decided_by: "Semax" }),
    PR(6, { status: "rejected", decided_at: "2026-08-01T10:00:00Z", decided_by: "Walter" }),
    PR(7, { status: "accepted", decided_at: "2026-10-05T10:00:00Z", ticket_id: 11 }),
    PR(8, { listing_id: null, updated_at: "2026-10-10T10:00:00Z" }),
  ],
  maintenance_tickets: [
    TK(10, { listing_id: "L2", priority: "low", status: "assigned", assigned_technician_id: 7, created_at: "2026-09-01T08:00:00Z", source: "guest_message", category: "ac" }),
    TK(11, { priority: "urgent", status: "open", created_at: "2026-10-05T08:00:00Z", source: "hk_planner_v3", proposal_id: 7, due_on: "2026-10-14" }),
    TK(12, { priority: "urgent", status: "in_progress", assigned_vendor_id: 3, created_at: "2026-10-02T08:00:00Z", source: "inspection", started_at: "2026-10-03T08:00:00Z" }),
    TK(13, { listing_id: "L2", priority: "high", status: "waiting_parts", assigned_technician_id: 9, created_at: "2026-09-20T08:00:00Z" }),
    TK(14, { listing_id: null, priority: "medium", status: "to_confirm", created_at: "2026-09-10T08:00:00Z" }),
    TK(20, { status: "resolved", resolved_at: "2026-10-10T08:00:00Z", resolution_notes: "Fixed", actual_cost: "150.5", assigned_technician_id: 7 }),
    TK(21, { listing_id: "L2", status: "closed", resolved_at: "2026-10-11T08:00:00Z" }),
    TK(22, { status: "cancelled", resolved_at: "2026-10-11T09:00:00Z" }),
    TK(23, { status: "resolved", resolved_at: "2026-08-01T08:00:00Z" }),
  ],
  cleaning_log: [
    { id: 1, reservation_key: "ticket_20", action: "mnt_ticket.done", actor: "Ismael", details: {}, created_at: "2026-10-10T07:00:00Z" },
    { id: 2, reservation_key: "ticket_20", action: "mnt_ticket.done", actor: "Semax", details: {}, created_at: "2026-10-10T08:00:00Z" },
    { id: 3, reservation_key: "ticket_20", action: "mnt_ticket.assign", actor: "Walter", details: {}, created_at: "2026-10-10T09:00:00Z" },
    { id: 4, reservation_key: "ticket_21", action: "mnt_ticket.assign", actor: "Walter", details: {}, created_at: "2026-10-11T09:00:00Z" },
  ],
  listing_config: [
    { listing_id: "L1", internal_name: "103 - Damac Reva" }, { listing_id: "L2", internal_name: "2609 - Nobles by Tiger" },
  ],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 9, name: "Ismael", role: "maintenance", is_active: true }, { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 5, name: "Old Tech", role: "maintenance", is_active: false },
  ],
  vendors: [{ id: 3, name: "CoolFix", specialty: "AC", is_active: true }, { id: 2, name: "Old Co", specialty: "", is_active: false }],
});

async function list(q: MntQuery, sb = db()): Promise<MntList> {
  const r = await mntList(sb, ME, q, { nowMs: NOW });
  assertEquals(r.status, 200);
  return r.body as MntList;
}

Deno.test("parseMntQuery : defauts, valeurs et refus", () => {
  assertEquals(parseMntQuery(new URLSearchParams("")), Q());
  assertEquals(parseMntQuery(new URLSearchParams("tab=open&filter=mine&q=%20Reva%20&rejected=1")), Q({ tab: "open", filter: "mine", q: "Reva", rejected: true }));
  assertEquals(parseMntQuery(new URLSearchParams("rejected=true")), Q({ rejected: true }));
  assertEquals(parseMntQuery(new URLSearchParams("rejected=0")), Q());
  assertEquals(parseMntQuery(new URLSearchParams("tab=bogus")), { error: "Invalid tab." });
  assertEquals(parseMntQuery(new URLSearchParams("filter=bogus")), { error: "Invalid filter." });
});

Deno.test("propositions en attente : urgent, high, normal puis updated_at decroissant, logement inconnu et nul", async () => {
  const b = await list(Q());
  assertEquals(b.tab, "proposals");
  assertEquals(b.tickets, []);
  assertEquals(b.proposals.map((p) => p.ref), ["PRP-2", "PRP-1", "PRP-3", "PRP-8"]);
  assertEquals(b.proposals[0], {
    id: 2, ref: "PRP-2", listingId: "L2", apt: "2609", bld: "Nobles by Tiger", title: "Proposal 2",
    category: "ac", categoryLabel: "AC", urgency: "urgent", guestName: "Guest 2", stayFrom: "2026-10-10", stayTo: "2026-10-13",
    guestInNow: true, quotes: [{ message_id: "m2", at: "2026-10-11T10:00:00Z", text: "AC broken" }], conversationId: "C2",
    reservationId: "R2", openTicket: { id: 10, ref: "MNT-10", title: "Ticket 10" }, status: "pending", rejectReason: null, rejectNote: null, ticket: null,
    decidedBy: null, decidedAt: null, createdAt: "2026-10-11T10:00:00Z", updatedAt: "2026-10-11T09:00:00Z",
  });
  const p3 = b.proposals[2];
  assertEquals([p3.apt, p3.bld, p3.guestInNow, p3.openTicket], ["", "Listing L9", false, null]);
  const p8 = b.proposals[3];
  assertEquals([p8.listingId, p8.apt, p8.bld], [null, "", ""]);
});

Deno.test("propositions en attente : high passe devant un normal plus recent, egalite par id decroissant", async () => {
  const sb = fakeDb({
    maintenance_proposals: [
      PR(1, { urgency: "normal", updated_at: "2026-10-12T12:00:00Z" }),
      PR(2, { urgency: "high", updated_at: "2026-10-01T08:00:00Z" }),
      PR(3, { urgency: "normal", updated_at: "2026-10-12T12:00:00Z" }),
      PR(4, { urgency: "urgent", updated_at: "2026-09-01T08:00:00Z" }),
    ],
  });
  assertEquals((await list(Q(), sb)).proposals.map((p) => p.id), [4, 2, 3, 1]);
});

Deno.test("guest in now : jour de Dubai, pas le jour UTC", async () => {
  const b = await list(Q());
  // Sejour jusqu'au 12 : fini a Dubai (le 13), alors qu'en UTC on est encore le 12.
  assertEquals(b.proposals.find((p) => p.id === 1)!.guestInNow, false);
  assertEquals(b.proposals.find((p) => p.id === 2)!.guestInNow, true);
});

Deno.test("propositions refusees ou fusionnees sur 30 jours, decided_at decroissant", async () => {
  const b = await list(Q({ rejected: true }));
  assertEquals(b.proposals.map((p) => [p.ref, p.status, p.decidedBy]), [["PRP-5", "merged", "Semax"], ["PRP-4", "rejected", "Walter"]]);
  assertEquals(b.proposals[1].rejectReason, "not_maintenance");
  assertEquals(b.counts.proposals, 4);
});

Deno.test("q sur les propositions : numero ou immeuble, sans casse", async () => {
  assertEquals((await list(Q({ q: "nobles" }))).proposals.map((p) => p.id), [2]);
  assertEquals((await list(Q({ q: "103" }))).proposals.map((p) => p.id), [1]);
  assertEquals((await list(Q({ q: "listing l9" }))).proposals.map((p) => p.id), [3]);
});

Deno.test("tickets ouverts : tri priorite puis anciennete, etapes, origines, intervenants", async () => {
  const b = await list(Q({ tab: "open" }));
  assertEquals(b.proposals, []);
  assertEquals(b.tickets.map((t) => t.id), [12, 11, 13, 14, 10]);
  assertEquals(b.tickets.map((t) => t.stage), ["in_progress", "todo", "waiting_parts", "to_confirm", "todo"]);
  assertEquals(b.tickets.map((t) => t.origin), ["inspection", "cleaner_report", "manual", "manual", "guest_message"]);
  assertEquals(b.tickets.map((t) => t.assignee), [
    { kind: "vendor", id: 3, name: "CoolFix" }, null, { kind: "member", id: 9, name: "Ismael" }, null,
    { kind: "member", id: 7, name: "Semax" },
  ]);
  assertEquals(b.tickets[1], {
    id: 11, ref: "MNT-11", listingId: "L1", apt: "103", bld: "Damac Reva", title: "Ticket 11", category: null,
    priority: "urgent", status: "open", stage: "todo", origin: "cleaner_report", assignee: null, dueOn: "2026-10-14",
    createdAt: "2026-10-05T08:00:00Z", startedAt: null, resolvedAt: null, resolvedBy: null, resolutionNotes: null,
    actualCost: null, proposalId: 7,
  });
  assertEquals([b.tickets[3].listingId, b.tickets[3].apt, b.tickets[3].bld], [null, "", ""]);
});

Deno.test("filtres des tickets ouverts : mine, urgent, unassigned, et q", async () => {
  assertEquals((await list(Q({ tab: "open", filter: "mine" }))).tickets.map((t) => t.id), [10]);
  assertEquals((await list(Q({ tab: "open", filter: "urgent" }))).tickets.map((t) => t.id), [12, 11]);
  assertEquals((await list(Q({ tab: "open", filter: "unassigned" }))).tickets.map((t) => t.id), [11, 14]);
  assertEquals((await list(Q({ tab: "open", q: "2609" }))).tickets.map((t) => t.id), [13, 10]);
  assertEquals((await list(Q({ tab: "open", filter: "urgent", q: "REVA" }))).tickets.map((t) => t.id), [12, 11]);
});

Deno.test("compteurs : toujours sur tout l'ouvert et les propositions en attente", async () => {
  const want = { proposals: 4, open: 5, urgent: 2, unassigned: 2, mine: 1 };
  assertEquals((await list(Q())).counts, want);
  assertEquals((await list(Q({ tab: "open", filter: "mine", q: "zzz" }))).counts, want);
  assertEquals((await list(Q({ tab: "done" }))).counts, want);
});

Deno.test("faits : 30 jours, sans annules, resolved_at decroissant, resolu par le dernier mnt_ticket.done", async () => {
  const b = await list(Q({ tab: "done" }));
  assertEquals(b.tickets.map((t) => t.id), [21, 20]);
  assertEquals(b.tickets.map((t) => [t.stage, t.resolvedBy]), [["done", null], ["done", "Semax"]]);
  assertEquals([b.tickets[1].resolutionNotes, b.tickets[1].actualCost, b.tickets[1].resolvedAt], ["Fixed", 150.5, "2026-10-10T08:00:00Z"]);
  assertEquals((await list(Q({ tab: "done", q: "nobles" }))).tickets.map((t) => t.id), [21]);
});

Deno.test("equipe et prestataires actifs", async () => {
  const b = await list(Q());
  assertEquals(b.team, [{ id: 7, name: "Semax", role: "manager" }, { id: 8, name: "Walter", role: "manager" }, { id: 9, name: "Ismael", role: "maintenance" }]);
  assertEquals(b.vendors, [{ id: 3, name: "CoolFix" }]);
});

Deno.test("lecture paginee : plus d'une page de tickets et de propositions", async () => {
  const many = fakeDb({
    maintenance_tickets: Array.from({ length: 1205 }, (_, i) => TK(i + 1)),
    maintenance_proposals: Array.from({ length: 1003 }, (_, i) => PR(i + 1, { dedup_key: "k" + i })),
  }, { honorOrder: true });
  const b = await list(Q({ tab: "open" }), many);
  assertEquals([b.tickets.length, b.counts.open, b.counts.proposals], [1205, 1205, 1003]);
});

Deno.test("erreur de lecture : 503", async () => {
  const errs: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errs.push(a); };
  try {
    for (const t of ["maintenance_tickets", "maintenance_proposals", "cleaners", "vendors", "listing_config", "cleaning_log"]) {
      const sb = db();
      sb.fail[t + ".select"] = { message: "boom" };
      const r = await mntList(sb, ME, Q({ tab: "done" }), { nowMs: NOW });
      assertEquals([t, r.status, r.body], [t, 503, { error: "Maintenance is unavailable right now. Try again." }]);
    }
  } finally {
    console.error = orig;
  }
  assertEquals(errs.length, 6);
});

Deno.test("F2 : motif de rejet et ticket d'une proposition fusionnee lus", async () => {
  const sb = db();
  const p4 = sb.tables.maintenance_proposals.find((p: any) => p.id === 4);
  p4.reject_reason = "other";
  p4.reject_note = "Guest asked about towels";
  sb.tables.maintenance_proposals.find((p: any) => p.id === 5).ticket_id = 11;
  const b = await list(Q({ rejected: true }), sb);
  assertEquals(b.proposals.map((p) => [p.id, p.rejectReason, p.rejectNote, p.ticket]), [
    [5, null, null, { id: 11, ref: "MNT-11" }], [4, "other", "Guest asked about towels", null],
  ]);
  assertEquals((await list(Q())).proposals.map((p) => [p.rejectNote, p.ticket]), [[null, null], [null, null], [null, null], [null, null]]);
});

Deno.test("F3 : clos par l'ancien chemin (closed_at seul) dans les faits, date = resolved_at ?? closed_at", async () => {
  const sb = db();
  sb.tables.maintenance_tickets.push(
    TK(24, { status: "closed", resolved_at: null, closed_at: "2026-10-12T08:00:00Z" }),
    TK(25, { status: "closed", resolved_at: null, closed_at: "2026-08-01T08:00:00Z" }),
    TK(26, { status: "resolved", resolved_at: "2026-10-09T08:00:00Z", closed_at: "2026-10-12T09:00:00Z" }),
  );
  const b = await list(Q({ tab: "done" }), sb);
  assertEquals(b.tickets.map((t) => [t.id, t.resolvedAt]), [
    [24, "2026-10-12T08:00:00Z"], [21, "2026-10-11T08:00:00Z"], [20, "2026-10-10T08:00:00Z"], [26, "2026-10-09T08:00:00Z"],
  ]);
});

Deno.test("phase 2 : listings = tout listing_config, tries par immeuble puis appartement", async () => {
  const sb = db();
  sb.tables.listing_config.push(
    { listing_id: "L3", internal_name: "1205 - Damac Reva" }, { listing_id: "L4", internal_name: "905 - Damac Reva" },
    { listing_id: "L5", internal_name: "Azure Villa" },
  );
  const b = await list(Q({ tab: "open" }), sb);
  assertEquals(b.listings, [
    { id: "L5", apt: "", bld: "Azure Villa" },
    { id: "L1", apt: "103", bld: "Damac Reva" }, { id: "L4", apt: "905", bld: "Damac Reva" }, { id: "L3", apt: "1205", bld: "Damac Reva" },
    { id: "L2", apt: "2609", bld: "Nobles by Tiger" },
  ]);
});
