import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { inspHistory, inspOverview, inspRecap, inspToday } from "./insp_read.ts";

const D = "2026-10-06";
const base = () => fakeDb({
  app_config: [{ key: "inspections_daily_target", value: "2" }],
  cleaners: [{ id: 2, name: "Walter", role: "manager", is_active: true }, { id: 3, name: "Faiza", role: "cleaner", is_active: true }],
  listing_config: [
    { listing_id: "A", internal_name: "101 - Tower A" },
    { listing_id: "B", internal_name: "202 - Tower B" },
    { listing_id: "C", internal_name: "303 - Tower C" },
    { listing_id: "X", internal_name: "999 - Gone", inspection_excluded: true },
  ],
  inspections: [
    { id: 1, listing_id: "A", inspector_id: 2, inspection_date: "2026-08-01", finished_at: "2026-08-01T10:00:00+04:00", started_at: "2026-08-01T09:30:00+04:00", eligibility: "vacant" },
    { id: 2, listing_id: "B", inspector_id: 3, inspection_date: "2026-09-25", finished_at: "2026-09-25T10:00:00+04:00", started_at: "2026-09-25T09:30:00+04:00", eligibility: "checkout" },
  ],
  inspection_items: [{ inspection_id: 2, zone: "ac", status: "not_ok", note: "Leak", outcome: "maintenance", ticket_id: 50 }],
  inspection_photos: [{ id: 9, inspection_id: 2, zone: "ac", kind: "issue", storage_path: "inspections/2/ac/x.jpg", idem_key: "k1" }],
  maintenance_tickets: [{ id: 50, status: "open", title: "AC: Leak" }],
  inspection_proposals: [
    { proposal_date: "2026-10-01", listing_id: "C", rank: 1 },
    { proposal_date: "2026-10-03", listing_id: "C", rank: 1, claimed_by: 3 },
    { proposal_date: "2026-07-20", listing_id: "A", rank: 1 }, // avant la derniere inspection : ne compte pas
  ],
});

Deno.test("today : quota lu en config, ordre par retard, propositions journalisees", async () => {
  const db = base();
  const r = await inspToday(db, D, [], null);
  assertEquals(r.target, 2);
  assertEquals(r.today.map((c) => c.listingId), ["C", "A"]); // C jamais, A 66 j
  assertEquals(r.also.map((c) => c.listingId), ["B"]); // B 11 j
  assertEquals(r.today[0].missed, 2);
  assertEquals(r.today[1].missed, 0);
  const jour = db.tables.inspection_proposals.filter((p: any) => p.proposal_date === D);
  assertEquals(jour.map((p: any) => [p.listing_id, p.rank]), [["C", 1], ["A", 2]]);
});

Deno.test("today : deuxieme appel ne change pas les rangs ni les prises en charge", async () => {
  const db = base();
  await inspToday(db, D, [], null);
  db.tables.inspection_proposals.find((p: any) => p.proposal_date === D && p.listing_id === "C").claimed_by = 3;
  const r = await inspToday(db, D, [], null);
  assertEquals(r.today[0].claimedBy, 3);
  assertEquals(r.today[0].claimedByName, "Faiza");
});

Deno.test("today : inProgressById present pour l'auteur", async () => {
  const db = base();
  db.tables.inspections.push({ id: 3, listing_id: "C", inspector_id: 3, inspection_date: D, finished_at: null, started_at: D + "T09:00:00+04:00", eligibility: "checkout" });
  const r = await inspToday(db, D, [], null);
  assertEquals(r.today.find((c) => c.listingId === "C")!.inProgressById, 3);
  assertEquals(r.today.find((c) => c.listingId === "A")!.inProgressById, null);
});

Deno.test("today : liste stable, journalisee une fois, doneToday, also exclut les journalises", async () => {
  const db = base();
  const r1 = await inspToday(db, D, [], null);
  assertEquals(r1.today.map((c) => c.listingId), ["C", "A"]);
  const avant = db.tables.inspection_proposals.filter((p: any) => p.proposal_date === D).length;
  db.tables.inspections.push({ id: 8, listing_id: "C", inspector_id: 2, inspection_date: D, finished_at: D + "T10:42:00+04:00", started_at: D + "T10:00:00+04:00", eligibility: "vacant" });
  const r2 = await inspToday(db, D, [], null);
  assertEquals(r2.today.map((c) => c.listingId), ["C", "A"]);
  assertEquals(r2.today[0].doneToday, { by: "Walter", at: D + "T10:42:00+04:00" });
  assertEquals(r2.today[1].doneToday, null);
  assertEquals(db.tables.inspection_proposals.filter((p: any) => p.proposal_date === D && Number(p.rank) >= 1).length, avant);
  assertEquals(r2.also.map((c) => c.listingId), ["B"]);
  assertEquals(r2.also.some((c) => ["C", "A"].includes(c.listingId)), false);
});

Deno.test("today : config absente = 4", async () => {
  const db = base(); db.tables.app_config = [];
  assertEquals((await inspToday(db, D, [], null)).target, 4);
});

Deno.test("today : inspection en cours visible sur la carte", async () => {
  const db = base();
  db.tables.inspections.push({ id: 3, listing_id: "C", inspector_id: 3, inspection_date: D, finished_at: null, started_at: D + "T09:00:00+04:00", eligibility: "checkout" });
  const r = await inspToday(db, D, [], null);
  assertEquals(r.today.find((c) => c.listingId === "C")!.inProgressBy, "Faiza");
});

Deno.test("today : quota invalide en config = 4", async () => {
  for (const v of ["abc", "-1", "2.5", "99"]) {
    const db = base(); db.tables.app_config = [{ key: "inspections_daily_target", value: v }];
    assertEquals((await inspToday(db, D, [], null)).target, 4);
  }
});

Deno.test("overview : couverture, couleurs, problemes ouverts, exclus a la fin", async () => {
  const r = await inspOverview(base(), D);
  assertEquals(r.coveragePct, 33); // B seul sur A, B, C
  assertEquals(r.rows.map((x) => [x.listingId, x.color]), [["C", "red"], ["A", "red"], ["B", "green"], ["X", "red"]]);
  assertEquals(r.rows.find((x) => x.listingId === "B")!.openIssues, 1);
  assertEquals(r.rows.find((x) => x.listingId === "X")!.excluded, true);
});

Deno.test("today : carte journalisee devenue occupee = unavailable, sauf si faite aujourd'hui", async () => {
  const db = base();
  await inspToday(db, D, [], null); // journalise C et A
  db.tables.inspections.push({ id: 8, listing_id: "C", inspector_id: 2, inspection_date: D, finished_at: D + "T10:42:00+04:00", started_at: D + "T10:00:00+04:00", eligibility: "vacant" });
  const occ = (id: string) => ({ listingId: id, arrival: "2026-10-04", departure: "2026-10-09", status: "confirmed", checkInTime: 15, checkOutTime: 11 });
  const r = await inspToday(db, D, [occ("A"), occ("C")] as any, null);
  assertEquals(r.today.find((c) => c.listingId === "A")!.eligibility, { kind: "unavailable" });
  const c = r.today.find((c) => c.listingId === "C")!;
  assertEquals(c.eligibility, { kind: "vacant", nextArrival: null });
  assertEquals(c.doneToday !== null, true);
});

Deno.test("history : zones not_ok, ticket et photos signees", async () => {
  const db = base();
  const h = await inspHistory(db, "B");
  assertEquals(h.name, "Apt 202 · Tower B");
  assertEquals(h.inspections.length, 1);
  const it = h.inspections[0].items[0];
  assertEquals([it.zone, it.label, it.ticket?.status], ["ac", "AC", "open"]);
  assertEquals(it.photos[0].url.startsWith("https://signed.test/inspections/2/ac/"), true);
  assertEquals(db.storage.signBatches.length, 1);
});

Deno.test("missed : propose le jour D et inspecte le jour D = 0 le lendemain", async () => {
  const db = base();
  db.tables.inspection_proposals = [{ proposal_date: "2026-10-05", listing_id: "C", rank: 1 }];
  db.tables.inspections.push({ id: 7, listing_id: "C", inspector_id: 3, inspection_date: "2026-10-05", finished_at: "2026-10-05T07:00:00+00:00", started_at: "2026-10-05T06:00:00+00:00", eligibility: "vacant" });
  const r = await inspOverview(db, D);
  assertEquals(r.rows.find((x) => x.listingId === "C")!.missed, 0);
});

Deno.test("missed : deux propositions apres la derniere inspection = 2, rang 0 ignore", async () => {
  const db = base();
  db.tables.inspection_proposals = [
    { proposal_date: "2026-10-03", listing_id: "C", rank: 1 },
    { proposal_date: "2026-10-04", listing_id: "C", rank: 2 },
    { proposal_date: "2026-10-04", listing_id: "A", rank: 0 },
  ];
  db.tables.inspections.push({ id: 7, listing_id: "C", inspector_id: 3, inspection_date: "2026-10-02", finished_at: "2026-10-02T07:00:00+00:00", started_at: "2026-10-02T06:00:00+00:00", eligibility: "vacant" });
  const r = await inspOverview(db, D);
  assertEquals(r.rows.find((x) => x.listingId === "C")!.missed, 2);
  assertEquals(r.rows.find((x) => x.listingId === "A")!.missed, 0);
});

Deno.test("overview : inspection terminee 21:00 UTC le 30/09 compte en octobre", async () => {
  const db = base();
  db.tables.inspections = [{ id: 8, listing_id: "A", inspector_id: 2, inspection_date: "2026-10-01", finished_at: "2026-09-30T21:00:00+00:00", started_at: "2026-09-30T20:00:00+00:00", eligibility: "vacant" }];
  assertEquals((await inspOverview(db, D)).inspectedThisMonth, 1);
});

Deno.test("overview : plus de 1000 inspections terminees sont toutes lues", async () => {
  const db = base();
  db.tables.inspections = [];
  for (let i = 1; i <= 1001; i++) {
    db.tables.inspections.push({ id: i, listing_id: i === 1 ? "A" : "B", inspector_id: 2, inspection_date: "2026-10-01", finished_at: "2026-10-01T08:00:00+00:00", started_at: "2026-10-01T07:00:00+00:00", eligibility: "vacant" });
  }
  assertEquals((await inspOverview(db, D)).inspectedThisMonth, 1001);
});

Deno.test("issues : item avec ticket mais outcome fixed n'est pas un probleme ouvert", async () => {
  const db = base();
  db.tables.inspection_items = [{ inspection_id: 2, zone: "ac", status: "ok", note: null, outcome: "fixed", ticket_id: 50 }];
  assertEquals((await inspOverview(db, D)).rows.find((x) => x.listingId === "B")!.openIssues, 0);
  db.tables.inspection_items = [{ inspection_id: 2, zone: "ac", status: "not_ok", outcome: "fixed", ticket_id: 50 }];
  assertEquals((await inspOverview(db, D)).rows.find((x) => x.listingId === "B")!.openIssues, 0);
});

Deno.test("today : cleaners lu exactement une fois par appel", async () => {
  const db = base();
  const calls: string[] = [];
  const wrapped = { ...db, from: (t: string) => { calls.push(t); return db.from(t); } };
  await inspToday(wrapped, D, [], null);
  assertEquals(calls.filter((t) => t === "cleaners").length, 1);
});

// ---- recap ----
const recapDb = () => {
  const db = base();
  db.tables.maintenance_tickets = [
    { id: 50, status: "open", title: "AC: Leak", source: "inspection" },
    { id: 51, status: "resolved", title: "old", source: "inspection" },
    { id: 52, status: "cancelled", title: "old", source: "inspection" },
    { id: 53, status: "in_progress", title: "Paint", source: "inspection" },
    { id: 60, status: "open", title: "other", source: "hk_planner_v3" },
  ];
  db.tables.inspection_proposals = [
    { proposal_date: D, listing_id: "A", rank: 1 },
    { proposal_date: D, listing_id: "B", rank: 2 },
    { proposal_date: D, listing_id: "C", rank: 3 },
    { proposal_date: D, listing_id: "X", rank: 0 },
  ];
  return db;
};

Deno.test("recap : statuts done, in_progress, not_done ordonnes par rang", async () => {
  const db = recapDb();
  db.tables.inspections.push(
    { id: 3, listing_id: "A", inspector_id: 3, inspection_date: D, started_at: D + "T09:00:00+04:00", finished_at: D + "T10:00:00+04:00", eligibility: "vacant" },
    { id: 4, listing_id: "B", inspector_id: 2, inspection_date: D, started_at: D + "T11:00:00+04:00", finished_at: null, eligibility: "vacant" },
  );
  const r = await inspRecap(db, D);
  assertEquals(r.proposals.map((p: any) => [p.listingId, p.rank, p.status, p.by]), [
    ["A", 1, "done", "Faiza"], ["B", 2, "in_progress", null], ["C", 3, "not_done", null],
  ]);
  assertEquals(r.proposals[0].at, D + "T10:00:00+04:00");
  assertEquals(r.proposals[0].name, "Apt 101 · Tower A");
  assertEquals(r.target, 2);
});

Deno.test("recap : inspection hors propositions = adhoc, avec problemes et tickets", async () => {
  const db = recapDb();
  db.tables.inspection_proposals = [{ proposal_date: D, listing_id: "A", rank: 1 }];
  db.tables.inspections.push(
    { id: 3, listing_id: "C", inspector_id: 3, inspection_date: D, started_at: D + "T09:00:00+04:00", finished_at: D + "T10:00:00+04:00", eligibility: "vacant" },
    { id: 5, listing_id: "A", inspector_id: 2, inspection_date: D, started_at: D + "T08:00:00+04:00", finished_at: D + "T08:30:00+04:00", eligibility: "vacant" },
  );
  db.tables.inspection_items.push(
    { inspection_id: 3, zone: "ac", status: "not_ok", note: "x", outcome: "maintenance", ticket_id: 53 },
    { inspection_id: 3, zone: "lights", status: "not_ok", note: "y", outcome: "fixed", ticket_id: null },
    { inspection_id: 3, zone: "kitchen", status: "ok", note: null, outcome: null, ticket_id: null },
  );
  const r = await inspRecap(db, D);
  assertEquals(r.doneToday.map((d) => [d.listingId, d.adhoc]), [["A", false], ["C", true]]); // plus ancien d'abord
  const c = r.doneToday[1];
  assertEquals(c.issues.length, 2);
  assertEquals(c.issues.map((i: any) => [i.outcome, i.ticketId]).sort(), [["fixed", null], ["maintenance", 53]]);
  assertEquals(r.doneToday[0].issues, []);
});

Deno.test("recap : openTickets ne compte que source inspection non resolus", async () => {
  const r = await inspRecap(recapDb(), D);
  assertEquals(r.openTickets, 2); // 50 open + 53 in_progress
});

Deno.test("recap : 21:00 UTC la veille = aujourd'hui a Dubai", async () => {
  const db = recapDb();
  db.tables.inspections.push({ id: 3, listing_id: "C", inspector_id: 3, inspection_date: D, started_at: "2026-10-05T20:00:00+00:00", finished_at: "2026-10-05T21:00:00+00:00", eligibility: "vacant" });
  const r = await inspRecap(db, D);
  assertEquals(r.doneToday.map((d) => d.listingId), ["C"]);
  assertEquals(r.proposals.find((p: any) => p.listingId === "C")!.status, "done");
  assertEquals(r.inspectedThisMonth, 1);
});

Deno.test("recap : aucune proposition journalisee = proposals []", async () => {
  const db = recapDb();
  db.tables.inspection_proposals = [];
  const r = await inspRecap(db, D);
  assertEquals(r.proposals, []);
  assertEquals(r.doneToday, []);
});

Deno.test("recap : couverture identique a overview, jamais inspectes et en retard", async () => {
  const db = recapDb();
  const [r, o] = [await inspRecap(db, D), await inspOverview(db, D)];
  assertEquals(r.coveragePct, o.coveragePct);
  assertEquals(r.inspectedThisMonth, o.inspectedThisMonth);
  assertEquals(r.neverInspected, 1); // C ; X exclu
  assertEquals(r.overdue, 2); // A (66 j) + C (jamais) ; B 11 j
});
