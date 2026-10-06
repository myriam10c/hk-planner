import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { inspHistory, inspOverview, inspRecap, inspReports, inspToday, parseReportRange } from "./insp_read.ts";
import { inspRoleAllowed } from "./insp_rules.ts";

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
    ["A", 1, "done", "Faiza"], ["B", 2, "in_progress", "Walter"], ["C", 3, "not_done", null],
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

Deno.test("recap : inspection en cours set by a le nom de l'inspecteur", async () => {
  const db = recapDb();
  db.tables.inspections.push(
    { id: 4, listing_id: "B", inspector_id: 2, inspection_date: D, started_at: D + "T11:00:00+04:00", finished_at: null, eligibility: "vacant" },
  );
  const r = await inspRecap(db, D);
  const bProposal = r.proposals.find((p: any) => p.listingId === "B");
  assertEquals(bProposal?.status, "in_progress");
  assertEquals(bProposal?.by, "Walter");
  assertEquals(bProposal?.at, null);
});

// ---- insp.reports ----
const repDb = () => fakeDb({
  cleaners: [{ id: 2, name: "Walter" }, { id: 3, name: "Faiza" }],
  listing_config: [
    { listing_id: "A", internal_name: "101 - Tower A" },
    { listing_id: "B", internal_name: "202 - Tower B" },
    { listing_id: "C", internal_name: "303 - Tower C" },
  ],
  inspections: [
    // 20:00 UTC le 09-30 = 00:00 Dubai le 10-01 : compte le 10-01
    { id: 1, listing_id: "A", inspector_id: 2, finished_at: "2026-09-30T20:00:00Z", eligibility: "vacant" },
    { id: 2, listing_id: "A", inspector_id: 3, finished_at: "2026-10-03T08:00:00Z", eligibility: "checkout" },
    { id: 3, listing_id: "B", inspector_id: 2, finished_at: "2026-10-04T08:00:00Z", eligibility: "vacant" },
    { id: 4, listing_id: "C", inspector_id: 2, finished_at: "2026-10-05T08:00:00Z", eligibility: "vacant" },
    { id: 5, listing_id: "C", inspector_id: 2, finished_at: null, eligibility: "vacant" }, // en cours
    { id: 6, listing_id: "B", inspector_id: 2, finished_at: "2026-09-30T19:59:00Z", eligibility: "vacant" }, // 09-30 Dubai : hors
    { id: 7, listing_id: "B", inspector_id: 2, finished_at: "2026-10-05T20:00:00Z", eligibility: "vacant" }, // 10-06 Dubai : hors si to=10-05
  ],
  inspection_items: [
    { inspection_id: 1, zone: "ac", status: "ok" },
    { inspection_id: 2, zone: "ac", status: "not_ok", outcome: "maintenance", ticket_id: 50 },
    { inspection_id: 2, zone: "living", status: "not_ok", outcome: "fixed", ticket_id: null },
    { inspection_id: 3, zone: "kitchen", status: "not_ok", outcome: "fixed" },
    { inspection_id: 4, zone: "balcony", status: "not_ok", outcome: "maintenance", ticket_id: 51 },
    { inspection_id: 4, zone: "wifi_tv", status: "not_ok", outcome: "maintenance", ticket_id: 50 },
  ],
  maintenance_tickets: [{ id: 50, status: "open" }, { id: 51, status: "resolved" }],
});

Deno.test("reports : bornes Dubai, termine seulement, recent d'abord", async () => {
  const r = await inspReports(repDb(), "2026-10-01", "2026-10-05");
  assertEquals(r.reports.map((x: any) => x.id), [4, 3, 2, 1]);
  assertEquals(r.reports[3].finishedAt, "2026-09-30T20:00:00Z");
  assertEquals(r.reports[0].name, "Apt 303 · Tower C");
  assertEquals(r.reports[0].inspector, "Walter");
  assertEquals(r.from, "2026-10-01");
  assertEquals(r.to, "2026-10-05");
});

Deno.test("reports : result clean / fixed / maintenance et zones", async () => {
  const r = await inspReports(repDb(), "2026-10-01", "2026-10-05");
  const by = (id: number) => r.reports.find((x: any) => x.id === id)!;
  assertEquals(by(1).result, "clean");
  assertEquals(by(1).issues, []);
  assertEquals(by(3).result, "fixed");
  assertEquals(by(2).result, "maintenance");
  assertEquals(by(2).issues, [
    { zone: "living", label: "Living room", outcome: "fixed", ticket: null },
    { zone: "ac", label: "AC", outcome: "maintenance", ticket: { id: 50, status: "open" } },
  ]);
});

Deno.test("reports : totaux, dernier resultat par appartement, tickets distincts ouverts", async () => {
  const r = await inspReports(repDb(), "2026-10-01", "2026-10-05");
  assertEquals(r.totals, {
    inspections: 4, apartments: 3,
    clean: 0, withIssues: 3, // A : derniere = #2 (maintenance), pas #1 propre
    fixedOnSpot: 2, sentToMaintenance: 3,
    openTickets: 1, // 50 compte une fois, 51 resolu
  });
});

Deno.test("reports : propre compte un appartement", async () => {
  const r = await inspReports(repDb(), "2026-09-30", "2026-10-01");
  assertEquals(r.totals.clean, 2); // A (#1, 10-01 Dubai) et B (#6, 09-30 Dubai)
  assertEquals(r.totals.apartments, 2);
  assertEquals(r.totals.withIssues, 0);
  assertEquals(r.totals.inspections, 2);
});

Deno.test("reports : plus de 200 inspections, items par lots", async () => {
  const insps = [], items = [];
  for (let i = 1; i <= 250; i++) {
    insps.push({ id: i, listing_id: "L" + i, inspector_id: 2, finished_at: "2026-10-03T08:00:00Z" });
    items.push({ inspection_id: i, zone: "ac", status: "not_ok", outcome: "fixed" });
  }
  const r = await inspReports(fakeDb({ cleaners: [], listing_config: [], inspections: insps, inspection_items: items }), "2026-10-03", "2026-10-03");
  assertEquals(r.totals.inspections, 250);
  assertEquals(r.totals.fixedOnSpot, 250);
});

Deno.test("reports : reserve aux managers", () => {
  assertEquals(inspRoleAllowed("insp.reports", "manager"), true);
  assertEquals(inspRoleAllowed("insp.reports", "cleaner"), false);
  assertEquals(inspRoleAllowed("insp.reports", "maintenance"), false);
});

Deno.test("reports : plage invalide", () => {
  assertEquals(parseReportRange("2026-10-05", "2026-10-01", "2026-10-06"), null);
  assertEquals(parseReportRange("2025-01-01", "2026-10-01", "2026-10-06"), null);
  assertEquals(parseReportRange("nope", "2026-10-01", "2026-10-06"), null);
  assertEquals(parseReportRange("2026-02-30", "2026-03-01", "2026-10-06"), null);
  assertEquals(parseReportRange(null, null, "2026-10-06"), { from: "2026-09-06", to: "2026-10-06" });
  assertEquals(parseReportRange("2026-10-01", "2026-10-05", "2026-10-06"), { from: "2026-10-01", to: "2026-10-05" });
});

Deno.test("reports : plafond PostgREST (maxRows) ne perd ni inspections ni zones", async () => {
  const insps = [], items = [];
  for (let i = 1; i <= 1500; i++) insps.push({ id: i, listing_id: "L" + (i % 50), inspector_id: 2, finished_at: "2026-10-03T08:00:00Z" });
  for (let i = 1; i <= 1500; i++) for (const z of ["ac", "living", "kitchen"]) items.push({ inspection_id: i, zone: z, status: "not_ok", outcome: "fixed" });
  for (let i = 1; i <= 1500; i++) items.push({ inspection_id: i, zone: "wifi_tv", status: "ok" });
  const db = fakeDb({ cleaners: [], listing_config: [], inspections: insps, inspection_items: items }, { maxRows: 1000 });
  const r = await inspReports(db, "2026-10-03", "2026-10-03");
  assertEquals(r.totals.inspections, 1500);
  assertEquals(r.totals.fixedOnSpot, 4500); // 600 items par lot de 200 ids, 1000 inspections par page
  assertEquals(r.totals.apartments, 50);
});

Deno.test("reports : un lot d'items au dela du plafond est pagine", async () => {
  const insps = [], items = [];
  for (let i = 1; i <= 100; i++) insps.push({ id: i, listing_id: "L" + i, inspector_id: 2, finished_at: "2026-10-03T08:00:00Z" });
  for (let i = 1; i <= 100; i++) for (let k = 0; k < 15; k++) items.push({ inspection_id: i, zone: "ac", status: "not_ok", outcome: "fixed" });
  const db = fakeDb({ cleaners: [], listing_config: [], inspections: insps, inspection_items: items }, { maxRows: 1000 });
  const r = await inspReports(db, "2026-10-03", "2026-10-03");
  assertEquals(r.totals.fixedOnSpot, 1500); // 1500 lignes dans un seul lot de 100 ids
});

for (const key of ["inspections.select", "inspection_items.select", "maintenance_tickets.select", "cleaners.select", "listing_config.select"]) {
  Deno.test("reports : lecture en erreur leve (" + key + ")", async () => {
    const db = repDb();
    db.fail[key] = { message: "boom" };
    let msg = "";
    try { await inspReports(db, "2026-10-01", "2026-10-05"); } catch (e) { msg = (e as Error).message; }
    assertEquals(msg.includes("boom"), true);
  });
}

Deno.test("reports : lots pagines en ordre de cle, sans doublon ni omission (items hors ordre d'id)", async () => {
  const insps = [], items = [];
  for (let i = 1; i <= 100; i++) insps.push({ id: i, listing_id: "L" + i, inspector_id: 2, finished_at: "2026-10-03T08:00:00Z" });
  let id = 1;
  for (let i = 1; i <= 100; i++) for (let k = 0; k < 15; k++) items.push({ id: id++, inspection_id: i, zone: k % 2 ? "ac" : "living", status: "not_ok", outcome: k % 3 ? "fixed" : "maintenance" });
  items.reverse(); // stockage hors ordre d'id : seule la lecture triee pagine correctement
  const db = fakeDb({ cleaners: [], listing_config: [], inspections: insps, inspection_items: items }, { maxRows: 1000, honorOrder: true });
  const r = await inspReports(db, "2026-10-03", "2026-10-03");
  assertEquals(r.totals.fixedOnSpot + r.totals.sentToMaintenance, 1500);
  assertEquals(r.totals.sentToMaintenance, 500);
  assertEquals(r.reports.every((x: any) => x.issues.length === 15), true);
});
