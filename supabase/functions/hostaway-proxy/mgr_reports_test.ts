import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrReports, parseReportsMonth, reportsAccess, REPORTS_PROPERTIES_TABLES } from "./mgr_reports.ts";

// Snapshot tel que le job VPS l'ecrit (forme reelle du 11/10/2026, valeurs a virgule flottante
// gardees telles quelles : rien ne doit etre arrondi ni recalcule cote serveur).
const TOTALS = {
  cost_ht: 25705, vat_net: 724.05, cost_ttc: 26990.25, margin_ht: 14485.7, vat_input: 1285.25,
  by_service: { CHC: { count: 139, cost_ht: 25705, margin_ht: 14485.70000000001, revenue_ht: 40190.69999999995 } },
  margin_pct: 36.04241777326596, revenue_ht: 40190.7, vat_output: 2009.3,
  by_bedrooms: { "1BHK": { count: 48, cost_ht: 9360, margin_ht: 6116.08, revenue_ht: 15476.079999999996 } },
  revenue_ttc: 42200, cleanings_count: 139,
};
const ROWS = [
  { guest: "Ahmad Hasan", nights: 13, cost_ht: 155, resa_id: 64971670, vat_net: 4.15, bedrooms: "STUDIO", margin_ht: 83.1, revenue_ttc: 250, cleaning_date: "2026-09-01", revenue_status: "OK", listing_internal: "2201a - Bloom Height" },
  { guest: "X", nights: 2, cost_ht: 236, resa_id: 1, vat_net: null, bedrooms: "2BHK", margin_ht: -3.3333, revenue_ttc: 0, cleaning_date: "2026-09-02", revenue_status: "MISSING_FEE", listing_internal: "x" },
];
const UNMATCHED_RESA = [{ key: "2026-09-01_Kofi Adu", date: "2026-09-01", guest: "Kofi Adu", service: "CHC" }];

const SNAP = {
  month: "2026-09", computed_at: "2026-10-10T23:17:52.962+00:00", synced_at: "2026-10-10T23:17:53+00:00",
  rows_count: 139, unmatched_count: 3, totals_json: TOTALS,
  payload_json: { rows: ROWS, unmatched_resa: UNMATCHED_RESA, unmatched_pricing: [] },
};

const seed = (extra: Record<string, any[]> = {}) => fakeDb({
  cleaning_accounting_cache: [
    { ...SNAP },
    { month: "2026-10", computed_at: "2026-10-11T08:00:00Z", synced_at: null, rows_count: 51, unmatched_count: 0, totals_json: {}, payload_json: { rows: [] } },
    { month: "2026-08", computed_at: "2026-10-11T08:00:00Z", synced_at: null, rows_count: 10, unmatched_count: 0, totals_json: {}, payload_json: {} },
  ],
  listing_config: [
    { listing_id: 11, internal_name: "1203 - Marina Gate", listing_name: "x", apt_number: null },
    { listing_id: 22, internal_name: "623 - Azizi Riviera 20", listing_name: "y", apt_number: null },
    { listing_id: 33, internal_name: "2201a - Bloom Height", listing_name: "z", apt_number: null },
  ],
  maintenance_tickets: [
    // 22 : 2 ouverts dont 1 urgent -> 100 - 10 - 10 = 80
    { id: 1, listing_id: 22, status: "open", priority: "urgent", created_at: "2026-10-01T06:00:00Z", resolved_at: null },
    { id: 2, listing_id: "22", status: "assigned", priority: "normal", created_at: "2026-10-02T06:00:00Z", resolved_at: null },
    // resolus en septembre (Dubai) : 10 h et 20 h
    { id: 3, listing_id: 11, status: "resolved", priority: "normal", created_at: "2026-09-10T00:00:00Z", resolved_at: "2026-09-10T10:00:00Z" },
    { id: 4, listing_id: 11, status: "resolved", priority: "normal", created_at: "2026-09-11T00:00:00Z", resolved_at: "2026-09-11T20:00:00Z" },
    // resolu le 30/09 a 21h UTC = 1er octobre a Dubai : hors septembre
    { id: 5, listing_id: 11, status: "resolved", priority: "low", created_at: "2026-09-30T09:00:00Z", resolved_at: "2026-09-30T21:00:00Z" },
    // sans logement : compte dans les tickets ouverts, pas dans un logement
    { id: 6, listing_id: null, status: "in_progress", priority: "high", created_at: "2026-10-03T06:00:00Z", resolved_at: null },
  ],
  // 33 : un equipement en retard -> 92
  equipment: [{ listing_id: 33, next_service: "2026-10-01" }, { listing_id: 11, next_service: "2026-12-01" }],
  // guest_feedback n'a pas de colonne listing_id en base (verifie le 11/10/2026) : jamais lu.
  guest_feedback: [{ id: "u1", reservation_id: "r", rating: 1 }],
  cleaning_timer: [
    { reservation_key: "a", started_at: "2026-09-05T06:00:00Z", duration_minutes: 40 },
    { reservation_key: "b", started_at: "2026-09-06T06:00:00Z", duration_minutes: 61 },
    { reservation_key: "c", started_at: "2026-09-07T06:00:00Z", duration_minutes: 600 },
    { reservation_key: "d", started_at: "2026-10-02T06:00:00Z", duration_minutes: 30 },
  ],
  menage_done: [
    { reservation_key: "a", done: true, updated_at: "2026-10-11T05:00:00Z" },
    { reservation_key: "b", done: true, updated_at: "2026-10-10T21:00:00Z" }, // 11/10 a Dubai
    { reservation_key: "c", done: false, updated_at: "2026-10-09T05:00:00Z" },
    { reservation_key: "d", done: true, updated_at: "2026-10-05T05:00:00Z" },
    { reservation_key: "e", done: true, updated_at: "2026-10-04T05:00:00Z" }, // hors 7 jours
  ],
  ...extra,
});
const OPTS = { today: "2026-10-11" };

Deno.test("mgr.reports: forme de la reponse", async () => {
  const r = await mgrReports(seed(), "2026-09", OPTS);
  assertEquals(Object.keys(r).sort(), ["accounting", "months", "ops", "properties"].concat(["month"]).sort());
  assertEquals(r.month, "2026-09");
  assertEquals(Object.keys(r.accounting!).sort(),
    ["computedAt", "rows", "rowsCount", "syncedAt", "totals", "unmatchedCount", "unmatchedPricing", "unmatchedResa"]);
});

Deno.test("mgr.reports: compta passee telle quelle (totaux, lignes, non rapproches)", async () => {
  const r = await mgrReports(seed(), "2026-09", OPTS);
  const a = r.accounting!;
  assertEquals(a.totals, TOTALS);
  assertEquals(a.rows, ROWS);
  // L'ordre des cles de chaque ligne est garde (colonnes du CSV cote ecran).
  assertEquals(Object.keys((a.rows as any[])[0]), Object.keys(ROWS[0]));
  assertEquals(a.unmatchedResa, UNMATCHED_RESA);
  assertEquals(a.unmatchedPricing, []);
  assertEquals([a.computedAt, a.syncedAt, a.rowsCount, a.unmatchedCount],
    [SNAP.computed_at, SNAP.synced_at, 139, 3]);
});

Deno.test("mgr.reports: valeurs absentes du snapshot = null, jamais un zero", async () => {
  const r = await mgrReports(seed(), "2026-08", OPTS);
  const a = r.accounting!;
  assertEquals([a.rows, a.unmatchedResa, a.unmatchedPricing, a.syncedAt], [null, null, null, null]);
  assertEquals(a.totals, {});
});

Deno.test("mgr.reports: sans snapshot -> accounting null", async () => {
  const r = await mgrReports(seed(), "2026-07", OPTS);
  assertEquals(r.accounting, null);
  assertEquals(r.month, "2026-07");
});

Deno.test("mgr.reports: mois avec snapshot, le plus recent en premier", async () => {
  const r = await mgrReports(seed(), "2026-09", OPTS);
  assertEquals(r.months, ["2026-10", "2026-09", "2026-08"]);
});

Deno.test("mgr.reports: operations du mois (bornes de Dubai)", async () => {
  const r = await mgrReports(seed(), "2026-09", OPTS);
  // 600 min ecarte (>= 480), comme l'ancien KPI ; octobre hors du mois.
  assertEquals(r.ops.avgCleaningTime, 51);
  assertEquals(r.ops.totalTimerSessions, 2);
  // Ouverts maintenant (tous logements, sans logement compris).
  assertEquals(r.ops.openMaintenanceTickets, 3);
  assertEquals(r.ops.resolvedThisMonth, 2);
  assertEquals(r.ops.avgResolutionHours, 15);
  assertEquals(r.ops.last7DaysCompletions, [
    { date: "2026-10-05", completions: 1 }, { date: "2026-10-06", completions: 0 }, { date: "2026-10-07", completions: 0 },
    { date: "2026-10-08", completions: 0 }, { date: "2026-10-09", completions: 0 }, { date: "2026-10-10", completions: 0 },
    { date: "2026-10-11", completions: 2 },
  ]);
});

Deno.test("mgr.reports: mois sans chrono ni resolution = null (Not available), pas zero", async () => {
  const r = await mgrReports(seed(), "2026-06", OPTS);
  assertEquals([r.ops.avgCleaningTime, r.ops.totalTimerSessions, r.ops.resolvedThisMonth, r.ops.avgResolutionHours],
    [null, 0, 0, null]);
});

Deno.test("mgr.reports: un mois de plus d'une page est lu en entier", async () => {
  const timers = Array.from({ length: 2300 }, (_, i) => ({
    reservation_key: "k" + String(i).padStart(5, "0"), started_at: "2026-08-10T06:00:00Z", duration_minutes: 30,
  }));
  const db = fakeDb({ cleaning_timer: timers }, { maxRows: 1000, honorOrder: true });
  const r = await mgrReports(db, "2026-08", OPTS);
  assertEquals(r.ops.totalTimerSessions, 2300);
});

Deno.test("mgr.reports: sante de tous les logements, pire en premier", async () => {
  const r = await mgrReports(seed(), "2026-09", OPTS);
  assertEquals(r.properties, [
    { listingId: "22", apt: "623", bld: "Azizi Riviera 20", score: 80, openTickets: 2, urgentOpen: 1 },
    { listingId: "33", apt: "2201a", bld: "Bloom Height", score: 92, openTickets: 0, urgentOpen: 0 },
    { listingId: "11", apt: "1203", bld: "Marina Gate", score: 100, openTickets: 0, urgentOpen: 0 },
  ]);
});

Deno.test("mgr.reports: entrees de sante lues par lot (une lecture par table, pas une par logement)", async () => {
  const db = seed();
  const calls: Record<string, number> = {};
  const from = db.from;
  (db as any).from = (t: string) => { calls[t] = (calls[t] ?? 0) + 1; return from(t); };
  await mgrReports(db, "2026-09", OPTS);
  for (const t of REPORTS_PROPERTIES_TABLES) assertEquals(calls[t], 1, t);
  assertEquals(calls["guest_feedback"], undefined);
});

Deno.test("mgr.reports: erreur de lecture remontee, jamais un rapport partiel", async () => {
  for (const t of ["cleaning_accounting_cache", "maintenance_tickets", "equipment", "listing_config", "cleaning_timer", "menage_done"]) {
    const db = seed();
    db.fail[t + ".select"] = { message: "boom" };
    await assertRejects(() => mgrReports(db, "2026-09", OPTS), Error, undefined, t);
  }
});

Deno.test("reportsAccess: 401 sans session, 403 non manager, PIN ou email manager accepte", () => {
  assertEquals(reportsAccess(null), { status: 401, error: "auth required" });
  assertEquals(reportsAccess({ role: "cleaner" }), { status: 403, error: "Only managers can do this." });
  assertEquals(reportsAccess({ role: "maintenance" })?.status, 403);
  assertEquals(reportsAccess({ role: "manager" }), null);
  assert(reportsAccess({ role: "manager" }) === null);
});

Deno.test("mgr.reports: validation du mois", () => {
  assertEquals(parseReportsMonth(null, "2026-10-11"), { ok: true, month: "2026-10" });
  assertEquals(parseReportsMonth("2026-09", "2026-10-11"), { ok: true, month: "2026-09" });
  for (const bad of ["2026-13", "2026-9", "x", "2026-09-01"]) {
    assertEquals(parseReportsMonth(bad, "2026-10-11"), { ok: false, error: "month must be YYYY-MM" });
  }
});
