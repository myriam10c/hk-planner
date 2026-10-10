import { assertEquals } from "jsr:@std/assert@1";
import {
  apartmentsOf, buildInbox, dueIsoFor, filterRows, inboxCounts, isOverdue, mirrorTicketId, normPriority,
  parseInboxQuery, parseRef, priorityTone, problemRef, rankRows, taskRow, ticketRow, todayFromBoard,
  todayFromReservations, type InboxCtx, type RawTask, type RawTicket,
} from "./mgr_inbox.ts";

const NOW = Date.parse("2026-10-09T07:00:00Z"); // 11:00 Dubai
const CTX: InboxCtx = {
  nowMs: NOW,
  listings: { L1: { apt: "308", bld: "Binghatti Lavender" }, L2: { apt: "103", bld: "Damac Reva" } },
  people: { "7": { name: "Semax" }, "8": { name: "Walter" }, "5": { name: "Ismaël" } },
  vendors: { "3": { name: "CoolFix" } },
  today: { arrivals: { L1: { owner: false, time: "15:00" } }, checkouts: { L2: { time: null } } },
};
const TK = (o: Partial<RawTicket>): RawTicket => ({
  id: 1, listing_id: null, title: "T", priority: "medium", status: "open", source: "manual",
  assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-10-01T08:00:00Z",
  sla_deadline: null, resolved_at: null, ...o,
});
const TS = (o: Partial<RawTask>): RawTask => ({
  id: 1, title: "Task", priority: "normal", status: "open", listing_id: null, assigned_cleaner_id: null,
  due_at: null, created_at: "2026-10-01T08:00:00Z", completed_at: null, source_ref: null, ...o,
});

Deno.test("references : un format, MNT-429 et TSK-13, saisie tolerante", () => {
  assertEquals(problemRef("MNT", 429), "MNT-429");
  assertEquals(parseRef("MNT-429"), { kind: "MNT", id: 429 });
  assertEquals(parseRef(" tsk-13 "), { kind: "TSK", id: 13 });
  for (const bad of ["MNT-0", "INS-4", "RPT-2", "MNT429", "MNT-", "", null, 42, "MNT-1e3"]) {
    assertEquals(parseRef(bad), null);
  }
});

Deno.test("priorites : medium (tickets) et normal (taches) sont le meme niveau, meme ton", () => {
  assertEquals(["urgent", "HIGH", "medium", "normal", "low", "", null, "weird"].map(normPriority),
    ["urgent", "high", "normal", "normal", "low", "normal", "normal", "normal"]);
  assertEquals((["urgent", "high", "normal", "low"] as const).map(priorityTone), ["bad", "warn", "idle", "idle"]);
});

Deno.test("echeance : Date.parse, quel que soit le format Postgres ; fin de journee Dubai", () => {
  assertEquals(isOverdue("2026-10-09T06:59:59+00:00", NOW), true);
  assertEquals(isOverdue("2026-10-09T10:59:59+04:00", NOW), true);
  assertEquals(isOverdue("2026-10-09T07:00:01Z", NOW), false);
  assertEquals(isOverdue("not a date", NOW), false);
  assertEquals(isOverdue(null, NOW), false);
  assertEquals(dueIsoFor("2026-10-12"), "2026-10-12T19:59:59.000Z");
});

Deno.test("ligne ticket : source, lieu, raison, technicien ou prestataire, statut a confirmer, clos", () => {
  const a = ticketRow(TK({ id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent", created_at: "2026-07-09T08:00:00Z" }), CTX);
  assertEquals(a, {
    ref: "MNT-429", kind: "MNT", id: 429, source: "Maintenance", priority: "urgent", label: "Urgent", tone: "bad",
    title: "Gas not working", status: "open", closed: false, listingId: "L1", apt: "308", bld: "Binghatti Lavender",
    assignee: null, createdAt: "2026-07-09T08:00:00Z", since: "09/07", dueAt: null, due: null, overdue: false, todayBoost: 0,
    why: "A guest arrives today at 15:00. Open since 09/07, no technician assigned.",
  });
  const b = ticketRow(TK({ id: 501, listing_id: "L2", source: "inspection", status: "to_confirm", assigned_vendor_id: 3, sla_deadline: "2026-10-08T19:59:59+00:00" }), CTX);
  assertEquals([b.source, b.assignee, b.due, b.overdue, b.todayBoost, b.why], [
    "Inspection", { kind: "vendor", id: 3, name: "CoolFix" }, "08/10", true, 1,
    "Checkout today, checkout time not set. Open since 01/10, sent to vendor CoolFix. Checked by a cleaner, to confirm and close.",
  ]);
  const c = ticketRow(TK({ id: 500, source: "hk_planner_v3", assigned_technician_id: 99, title: "  " }), CTX);
  assertEquals([c.source, c.title, c.assignee, c.apt, c.bld, c.todayBoost],
    ["Cleaner report", "Ticket", { kind: "member", id: 99, name: "Member 99" }, "", "", 2]);
  const d = ticketRow(TK({ id: 300, status: "resolved", resolved_at: "2026-10-08T09:00:00Z", sla_deadline: "2026-01-01T00:00:00Z" }), CTX);
  assertEquals([d.closed, d.overdue, d.why], [true, false, "Closed on 08/10."]);
});

Deno.test("ligne tache : assignee, retard, echeance, ouverte depuis, close", () => {
  const a = taskRow(TS({ id: 13, title: "AC not cooling", priority: "urgent", assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00+00:00" }), CTX);
  assertEquals([a.ref, a.source, a.tone, a.overdue, a.due, a.why],
    ["TSK-13", "Team task", "bad", true, "15/05", "Assigned to Semax, overdue since 15/05."]);
  const b = taskRow(TS({ id: 14, listing_id: "L1", due_at: "2026-12-01T08:00:00Z" }), CTX);
  assertEquals(b.why, "A guest arrives today at 15:00. Unassigned, due 01/12.");
  const c = taskRow(TS({ id: 15 }), CTX);
  assertEquals([c.why, c.tone, c.label], ["Unassigned, open since 01/10.", "idle", "Normal"]);
  const d = taskRow(TS({ id: 16, status: "done", completed_at: "2026-10-08T06:00:00Z" }), CTX);
  assertEquals([d.closed, d.why], [true, "Closed on 08/10."]);
});

Deno.test("boite : ouverts seulement, copies maint:<id> des tickets jamais en double", () => {
  assertEquals([mirrorTicketId("maint:429"), mirrorTicketId("review:3"), mirrorTicketId(null), mirrorTicketId("maint:x")],
    [429, null, null, null]);
  const rows = buildInbox(
    [TK({ id: 429, priority: "urgent" }), TK({ id: 430, status: "waiting_parts" }), TK({ id: 300, status: "resolved" }), TK({ id: 301, status: "cancelled" })],
    [TS({ id: 17, source_ref: "maint:429" }), TS({ id: 18, status: "in_progress" }), TS({ id: 19, status: "done" })],
    CTX,
  );
  assertEquals(rows.map((r) => r.ref), ["MNT-429", "MNT-430", "TSK-18"]);
});

Deno.test("tri stable : urgence, ce qui touche aujourd'hui, le plus ancien, MNT avant TSK, id", () => {
  const rows = [
    ticketRow(TK({ id: 2, priority: "high", created_at: "2026-06-01T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 3, priority: "high", listing_id: "L2", created_at: "2026-10-05T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 4, priority: "urgent", created_at: "2026-10-08T08:00:00Z" }), CTX),
    taskRow(TS({ id: 4, priority: "high", due_at: "2026-06-01T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 1, priority: "high", created_at: "2026-06-01T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 5, priority: "low", created_at: "garbage" }), CTX),
    ticketRow(TK({ id: 6, priority: "low", created_at: "2026-01-01T08:00:00Z" }), CTX),
  ];
  const once = rankRows(rows).map((r) => r.ref);
  assertEquals(once, ["MNT-4", "MNT-3", "MNT-1", "MNT-2", "TSK-4", "MNT-6", "MNT-5"]);
  assertEquals(rankRows(rows.slice().reverse()).map((r) => r.ref), once);
});

const ROWS = rankRows([
  ticketRow(TK({ id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent" }), CTX),
  ticketRow(TK({ id: 501, listing_id: "L2", title: "Lamp broken", source: "inspection", assigned_technician_id: 8 }), CTX),
  ticketRow(TK({ id: 500, title: "Shower leaking", source: "hk_planner_v3", assigned_vendor_id: 3 }), CTX),
  taskRow(TS({ id: 13, title: "AC not cooling", priority: "urgent", assigned_cleaner_id: 5, listing_id: "L1", due_at: "2026-05-15T08:00:00Z" }), CTX),
  taskRow(TS({ id: 14, title: "Buy light bulbs" }), CTX),
]);
const Q = (o: Record<string, unknown> = {}) =>
  ({ urgent: false, mine: false, unassigned: false, listingId: null, source: null, q: "", offset: 0, limit: 50, ...o }) as any;

Deno.test("filtres Urgent, Mine, Unassigned, Apartment, Source, combinables", () => {
  const refs = (o: any, me = 8) => filterRows(ROWS, Q(o), me).map((r) => r.ref);
  assertEquals(ROWS.map((r) => r.ref), ["TSK-13", "MNT-429", "MNT-501", "MNT-500", "TSK-14"]);
  assertEquals(refs({ urgent: true }), ["TSK-13", "MNT-429"]);
  assertEquals(refs({ mine: true }), ["MNT-501"]);
  assertEquals(refs({ mine: true }, 5), ["TSK-13"]);
  assertEquals(refs({ unassigned: true }), ["MNT-429", "TSK-14"]);
  assertEquals(refs({ listingId: "L1" }), ["TSK-13", "MNT-429"]);
  assertEquals(refs({ source: "Cleaner report" }), ["MNT-500"]);
  assertEquals(refs({ urgent: true, unassigned: true }), ["MNT-429"]);
});

Deno.test("recherche : ref, titre, logement (apt 308), personne, sans accents ni casse", () => {
  const s = (q: string) => filterRows(ROWS, Q({ q }), 8).map((r) => r.ref);
  assertEquals(s("mnt-429"), ["MNT-429"]);
  assertEquals(s("apt 308"), ["TSK-13", "MNT-429"]);
  assertEquals(s("BINGHATTI gas"), ["MNT-429"]);
  assertEquals(s("ismael"), ["TSK-13"]);
  assertEquals(s("coolfix"), ["MNT-500"]);
  assertEquals(s("unassigned"), ["MNT-429", "TSK-14"]);
  assertEquals(s("zzz"), []);
});

Deno.test("compteurs sur toute la boite, logements tries par nombre", () => {
  assertEquals(inboxCounts(ROWS, 8), {
    open: 5, urgent: 2, mine: 1, unassigned: 2, overdue: 1,
    bySource: { Maintenance: 1, Inspection: 1, "Cleaner report": 1, "Team task": 2 },
  });
  assertEquals(apartmentsOf(ROWS), [
    { listingId: "L1", apt: "308", bld: "Binghatti Lavender", n: 2 },
    { listingId: "L2", apt: "103", bld: "Damac Reva", n: 1 },
  ]);
});

Deno.test("parametres de mgr.problems : defauts, bornes, source inconnue refusee", () => {
  const p = (s: string) => parseInboxQuery(new URLSearchParams(s));
  assertEquals(p(""), { ok: true, q: Q() });
  assertEquals(p("urgent=1&mine=1&unassigned=0&listingId=L1&source=task&q=%20gas%20&offset=50&limit=0"),
    { ok: true, q: Q({ urgent: true, mine: true, listingId: "L1", source: "Team task", q: "gas", offset: 50, limit: 0 }) });
  assertEquals(p("source=rpt"), { ok: false, error: "Unknown source." });
  assertEquals(p("offset=-1"), { ok: false, error: "Invalid offset." });
  assertEquals(p("limit=201"), { ok: false, error: "Invalid limit." });
  assertEquals(p("limit=abc"), { ok: false, error: "Invalid limit." });
});

Deno.test("aujourd'hui depuis Hostaway : arrivees (proprietaire compris), departs, inquiry ignoree", () => {
  const R = (o: any) => ({
    id: "1", listingId: "L1", guest: "G", arrival: "2026-10-01", departure: "2026-10-05", status: "confirmed",
    checkInTime: 16, checkOutTime: 11, ...o,
  });
  const t = todayFromReservations([
    R({ id: "1", listingId: "L1", arrival: "2026-10-09" }),
    R({ id: "2", listingId: "L2", departure: "2026-10-09", checkOutTime: null }),
    R({ id: "3", listingId: "L3", arrival: "2026-10-09", status: "ownerStay", checkInTime: null }),
    R({ id: "4", listingId: "L4", arrival: "2026-10-09", status: "inquiry" }),
  ], "2026-10-09");
  assertEquals(t, {
    arrivals: { L1: { owner: false, time: "16:00" }, L3: { owner: true, time: "15:00" } },
    checkouts: { L2: { time: null } },
  });
  assertEquals(todayFromBoard([
    { kind: "checkout", listingId: "L5", postponedFrom: "2026-10-07", checkout: null },
    { kind: "extra", listingId: "L6", postponedFrom: null, checkout: null },
  ], []), { arrivals: {}, checkouts: {} });
});
