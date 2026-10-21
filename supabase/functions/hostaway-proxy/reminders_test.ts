// IO des relances (reminders.ts) sur la base factice, plus le branchement des routes
// dans index.ts (assertions sur la source : index.ts appelle Deno.serve au chargement).
import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { APP_URL } from "./push.ts";
import {
  guestOnSiteSet, loadGuestReservations, mergeOverrides, parseRemLogQuery, REM_ALERT_ICON, remConfigGet, remConfigSet,
  remLog, remRead, remRun, remTest, type RemDeps,
} from "./reminders.ts";

const NOW = Date.parse("2026-10-20T08:00:00Z"); // 12:00 Dubai
const TODAY = "2026-10-20";
const ME = { cleaner_id: 1, name: "Walter", role: "manager", color: "" };

const PEOPLE = [
  { id: 1, name: "Walter", role: "manager", is_active: true, email: "walter@medini-homes.com" },
  { id: 2, name: "AI Assistant", role: "manager", is_active: true, email: "ai-assistant@medini-homes.com" },
  { id: 3, name: "Old Boss", role: "manager", is_active: false, email: "old@medini-homes.com" },
  { id: 5, name: "Ismael", role: "maintenance", is_active: true, email: "ismael@medini-homes.com" },
  { id: 7, name: "Faiza", role: "cleaner", is_active: true, email: null },
  { id: 9, name: "Elite Cleaning", role: "subcontractor", is_active: true, email: null },
];

function seed(extra: Record<string, any[]> = {}) {
  return fakeDb({
    cleaners: PEOPLE,
    listing_config: [{ listing_id: "L1", internal_name: "305 - Neva Residence" }, { listing_id: "L2", internal_name: "808 - Tower H" }],
    maintenance_tickets: [{
      id: 10, listing_id: "L1", title: "AC not cooling", priority: "urgent", status: "open",
      created_at: "2026-10-20T06:00:00Z", last_update: null, due_on: TODAY, assigned_technician_id: null, assigned_vendor_id: null,
    }],
    proxy_cache: [{ key: "insp:res:" + TODAY, payload: { reservations: [] }, updated_at: "2026-10-20T07:55:00Z" }],
    ...extra,
  });
}

type Call = { cleanerId: number; payload: any; opts: any };
function deps(o: { result?: { sent: number; pruned: number; skipped: string | null }; checkouts?: any[]; nowMs?: number } = {}) {
  const calls: Call[] = [];
  let reloads = 0;
  const d: RemDeps = {
    nowMs: o.nowMs ?? NOW,
    ackUrl: "https://x.supabase.co/functions/v1/hostaway-proxy?action=rem.read",
    appSecret: "app-secret",
    loadCheckouts: async () => ({ reservations: o.checkouts ?? [], cachedAt: null }),
    loadReservations: async () => { reloads++; return []; },
    send: async (_sb: any, cleanerId: number, payload: any, opts: any) => {
      calls.push({ cleanerId, payload, opts });
      return o.result ?? { sent: 1, pruned: 0, skipped: null };
    },
  };
  return { d, calls, reloads: () => reloads };
}

Deno.test("remRun : r1 part aux managers (sans l'assistant IA), journal ecrit avant l'envoi", async () => {
  const db = seed();
  const { d, calls } = deps();
  const s = await remRun(db, d);
  assertEquals(s.ok, true);
  assertEquals(s.disabled, false);
  assertEquals(s.sent, 1);
  assertEquals(calls.length, 1);
  const c = calls[0];
  assertEquals(c.cleanerId, 1);
  assertEquals(c.opts, { priority: "urgent", quietHandled: true, nowMs: NOW });
  assertEquals(c.payload.urgent, true);
  assertEquals(c.payload.icon, REM_ALERT_ICON);
  assertEquals(c.payload.url, APP_URL + "/manager/#/maintenance?ref=MNT-10");
  assertEquals(c.payload.tag, "rem-r1-10");
  assert(c.payload.title.startsWith("URGENT"));
  assert(c.payload.title.includes("305 NEVA RESIDENCE"));
  const rows = db.tables.reminder_log;
  // r1 seul : r6 (echeance aujourd'hui) n'est pas depassee.
  assertEquals(rows.length, 1);
  const row = rows[0];
  assertEquals([row.rule, row.subject_kind, row.subject_id, row.subject_ref, row.cleaner_id, row.urgent, row.status],
    ["r1", "ticket", "10", "MNT-10", 1, true, "sent"]);
  assertEquals(row.read_token.length, 32);
  assertEquals(c.payload.ack, { url: d.ackUrl, id: row.id, token: row.read_token, secret: "app-secret" });
  // Aucune ecriture hors reminder_log, a part le bail du passage, libere a la fin.
  assertEquals(db.writes.every((w) => w.table === "reminder_log" || w.table === "proxy_cache"), true);
  assertEquals(db.tables.proxy_cache.some((r: any) => r.key === "rem:lease"), false);
});

Deno.test("remRun dryRun : liste ce qui partirait, rien n'est envoye ni journalise", async () => {
  const db = seed();
  const { d, calls } = deps();
  const s = await remRun(db, { ...d, dryRun: true });
  assertEquals(s.dryRun, true);
  assertEquals(s.sent, 0);
  assertEquals(calls.length, 0);
  assertEquals(s.preview?.map((p) => [p.rule, p.ref, p.urgent, p.recipients]), [["r1", "MNT-10", true, [1]]]);
  assertEquals((db.tables.reminder_log ?? []).length, 0);
  assertEquals(db.writes.every((w) => w.table === "proxy_cache"), true);
});

Deno.test("remRun : plus de digestOver relances pour une personne = une seule notification recapitulative", async () => {
  const tickets = [10, 11, 12, 13, 14].map((id) => ({
    id, listing_id: "L2", title: "Leak " + id, priority: "low", status: "open",
    created_at: "2026-10-18T06:00:00Z", last_update: null, due_on: null, assigned_technician_id: null, assigned_vendor_id: null,
  }));
  const db = seed({ maintenance_tickets: tickets });
  const { d, calls } = deps();
  const s = await remRun(db, d);
  // 5 relances r2 pour Walter (seul manager) : un recapitulatif, 5 lignes de journal.
  assertEquals(calls.length, 1);
  assertEquals(s.sent, 5);
  assertEquals(s.digests, 1);
  const c = calls[0];
  assertEquals(c.payload.title, "5 reminders");
  assertEquals(c.payload.body, "MNT-10, MNT-11, MNT-12, MNT-13 and 1 more. Open the app to act.");
  assertEquals(c.payload.url, APP_URL + "/manager/#/maintenance");
  const rows = db.tables.reminder_log;
  assertEquals(rows.length, 5);
  assertEquals(new Set(rows.map((r: any) => r.read_token)).size, 1);
  assertEquals(c.payload.ack.id, rows[0].id);
  // Un clic sur le recapitulatif marque les 5 lignes lues.
  await remRead(db, { id: rows[0].id, token: rows[0].read_token });
  assertEquals(db.tables.reminder_log.every((r: any) => r.read_at), true);
  // Seuil releve : 5 notifications separees.
  const db2 = seed({ maintenance_tickets: tickets, app_config: [{ key: "reminders", value: { digestOver: 5 } }] });
  const t2 = deps();
  await remRun(db2, t2.d);
  assertEquals(t2.calls.length, 5);
});

Deno.test("remRun : un autre passage tient le bail, rien n'est evalue ni envoye", async () => {
  const db = seed();
  db.tables.proxy_cache.push({ key: "rem:lease", payload: { run: "other" }, updated_at: new Date(NOW - 60_000).toISOString() });
  const { d, calls } = deps();
  const s = await remRun(db, d);
  assertEquals(s.skipped_run, "busy");
  assertEquals(s.sent, 0);
  assertEquals(calls.length, 0);
  assertEquals(db.tables.reminder_log ?? [], []);
  // Le bail de l'autre passage n'est pas touche.
  const lease = db.tables.proxy_cache.find((r: any) => r.key === "rem:lease");
  assertEquals(lease.payload, { run: "other" });
});

Deno.test("remRun : un bail perime (plus de 4 min) est repris, puis libere", async () => {
  const db = seed();
  db.tables.proxy_cache.push({ key: "rem:lease", payload: { run: "dead" }, updated_at: new Date(NOW - 5 * 60_000).toISOString() });
  const { d, calls } = deps();
  let seen: any = null;
  const send = d.send!;
  d.send = async (...a: Parameters<typeof send>) => {
    seen = db.tables.proxy_cache.find((r: any) => r.key === "rem:lease");
    return await send(...a);
  };
  d.runId = "mine";
  const s = await remRun(db, d);
  assertEquals(s.skipped_run, undefined);
  assertEquals(s.sent, 1);
  assertEquals(calls.length, 1);
  assertEquals(seen.payload, { run: "mine" });
  assertEquals(db.tables.proxy_cache.some((r: any) => r.key === "rem:lease"), false);
});

Deno.test("remRun : deux passages qui se chevauchent, un seul envoie", async () => {
  const db = seed();
  const a = deps();
  const b = deps();
  // b demarre pendant l'envoi de a.
  let inner: Promise<any> | null = null;
  const send = a.d.send!;
  a.d.send = async (...args: Parameters<typeof send>) => {
    inner = remRun(db, b.d);
    await inner;
    return await send(...args);
  };
  const s = await remRun(db, a.d);
  const sb = await inner!;
  assertEquals(s.sent, 1);
  assertEquals(sb.skipped_run, "busy");
  assertEquals(b.calls.length, 0);
});

Deno.test("remRun : deuxieme passage dans l'heure = doublon, rien ne part ni ne s'ecrit", async () => {
  const db = seed();
  await remRun(db, deps().d);
  const { d, calls } = deps({ nowMs: NOW + 5 * 60_000 });
  const s = await remRun(db, d);
  assertEquals(calls.length, 0);
  assertEquals(s.sent, 0);
  assertEquals(s.skipped, { duplicate: 1 });
  assertEquals(db.tables.reminder_log.length, 1);
});

Deno.test("remRun : sans abonnement, la ligne passe en no_subscription et compte comme tentative", async () => {
  const db = seed();
  const s = await remRun(db, deps({ result: { sent: 0, pruned: 0, skipped: "no_subscription" } }).d);
  assertEquals(s.sent, 0);
  assertEquals(s.skipped, { no_subscription: 1 });
  assertEquals(db.tables.reminder_log[0].status, "no_subscription");
  // Pas de nouvelle ligne 5 min plus tard : la tentative bloque comme un envoi.
  const again = deps({ nowMs: NOW + 5 * 60_000 });
  await remRun(db, again.d);
  assertEquals(again.calls.length, 0);
  assertEquals(db.tables.reminder_log.length, 1);
});

Deno.test("remRun : une erreur d'envoi est journalisee 'error' sans lever", async () => {
  const db = seed();
  const s = await remRun(db, deps({ result: { sent: 0, pruned: 0, skipped: "error" } }).d);
  assertEquals(s.ok, true);
  assertEquals(s.skipped, { error: 1 });
  assertEquals(db.tables.reminder_log[0].status, "error");
});

Deno.test("remRun : journal impossible = pas d'envoi", async () => {
  const db = seed();
  db.fail["reminder_log.insert"] = { message: "boom" };
  const { d, calls } = deps();
  const s = await remRun(db, d);
  assertEquals(calls.length, 0);
  assertEquals(s.skipped, { log_error: 1 });
});

Deno.test("remRun : interrupteur global coupe tout avant la lecture du snapshot", async () => {
  const db = seed({ app_config: [{ key: "reminders", value: JSON.stringify({ enabled: false }) }] });
  const { d, calls } = deps();
  const s = await remRun(db, d);
  assertEquals(s.disabled, true);
  assertEquals(s.evaluated, 0);
  assertEquals(calls.length, 0);
  assertEquals(db.tables.reminder_log ?? [], []);
});

Deno.test("remRun : silence configure, rien ne part (sauf urgence avec guest)", async () => {
  const db = seed({ app_config: [{ key: "reminders", value: { quiet: { start: "11:00", end: "13:00" } } }] });
  const { d, calls } = deps();
  const s = await remRun(db, d);
  assertEquals(calls.length, 0);
  assertEquals(s.skipped, { quiet: 1 });
  assertEquals(db.tables.reminder_log ?? [], []);
});

Deno.test("remRun : menage du jour pas fini 2 h apres le checkout -> cleaner sur /v3/, Elite ignore", async () => {
  const at14 = Date.parse("2026-10-20T10:05:00Z"); // 14:05 Dubai
  const db = seed({
    maintenance_tickets: [],
    cleaning_assignments: [
      { reservation_key: TODAY + "_Ann Lee", cleaner_id: 7, service_type: "CHC" },
      { reservation_key: TODAY + "_Bo Ray", cleaner_id: 9, service_type: "CHC" },
    ],
  });
  const { d, calls } = deps({
    nowMs: at14,
    checkouts: [
      { listingId: "L1", guest: "Ann Lee", checkOut: TODAY, checkOutTime: 11, status: "confirmed", nextGuest: null },
      { listingId: "L2", guest: "Bo Ray", checkOut: TODAY, checkOutTime: 11, status: "confirmed", nextGuest: null },
    ],
  });
  const s = await remRun(db, d);
  assertEquals(s.sent, 1);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].cleanerId, 7);
  assertEquals(calls[0].payload.url, APP_URL + "/v3/");
  assertEquals(calls[0].opts.priority, "normal");
  assertEquals(calls[0].payload.icon, undefined);
  assertEquals(db.tables.reminder_log[0].subject_kind, "cleaning");
  assertEquals(db.tables.reminder_log[0].subject_id, TODAY + "_Ann Lee");
});

Deno.test("remRun : guest sur place divise le delai r1 (20 min suffisent)", async () => {
  const t0 = "2026-10-20T07:40:00Z"; // 20 min avant NOW
  const db = seed({
    maintenance_tickets: [{
      id: 11, listing_id: "L1", title: "Leak", priority: "urgent", status: "open", created_at: t0, last_update: null,
      due_on: null, assigned_technician_id: null, assigned_vendor_id: null,
    }],
    proxy_cache: [{
      key: "insp:res:" + TODAY, updated_at: "2026-10-20T07:55:00Z",
      payload: { reservations: [{ listingId: "L1", arrival: "2026-10-18", departure: "2026-10-23", status: "new", checkInTime: 15, checkOutTime: 11 }] },
    }],
  });
  const { d, calls } = deps();
  await remRun(db, d);
  assertEquals(calls.length, 1);
  assert(calls[0].payload.body.includes("Guest on site."));
});

Deno.test("guestOnSiteSet : nuit en cours, depart avant l'heure de checkout, statuts invalides", () => {
  const r = (listingId: string, arrival: string, departure: string, status = "confirmed", checkOutTime: number | null = 11) =>
    ({ listingId, arrival, departure, status, checkInTime: 15, checkOutTime });
  const res = [
    r("A", "2026-10-18", "2026-10-22"),
    r("B", "2026-10-17", TODAY), // part a 11:00, il est 12:00
    r("C", "2026-10-17", TODAY, "confirmed", 13), // checkout tardif 13:00
    r("D", "2026-10-18", "2026-10-22", "cancelled"),
    r("E", "2026-10-21", "2026-10-25"),
  ];
  assertEquals([...guestOnSiteSet(res, TODAY, NOW)].sort(), ["A", "C"]);
});

Deno.test("loadGuestReservations : cache frais lu tel quel, cache vieux ou absent = rechargement", async () => {
  const fresh = fakeDb({ proxy_cache: [{ key: "insp:res:" + TODAY, payload: { reservations: [{ listingId: "A" }] }, updated_at: "2026-10-20T07:50:00Z" }] });
  let n = 0;
  const reload = async () => { n++; return []; };
  assertEquals((await loadGuestReservations(fresh, TODAY, NOW, reload as any)).length, 1);
  assertEquals(n, 0);
  const old = fakeDb({ proxy_cache: [{ key: "insp:res:" + TODAY, payload: { reservations: [] }, updated_at: "2026-10-20T06:00:00Z" }] });
  await loadGuestReservations(old, TODAY, NOW, reload as any);
  await loadGuestReservations(fakeDb(), TODAY, NOW, reload as any);
  assertEquals(n, 2);
});

Deno.test("remRead : jeton faux ignore, bon jeton pose read_at une fois, toujours {ok:true}", async () => {
  const tok = "t".repeat(32);
  const db = fakeDb({ reminder_log: [{ id: 5, read_token: tok, read_at: null }] });
  assertEquals(await remRead(db, { id: 5, token: "x".repeat(32) }, NOW), { status: 200, body: { ok: true } });
  assertEquals(db.tables.reminder_log[0].read_at, null);
  assertEquals(await remRead(db, { id: 99, token: tok }, NOW), { status: 200, body: { ok: true } });
  assertEquals(await remRead(db, null, NOW), { status: 200, body: { ok: true } });
  assertEquals(await remRead(db, { id: 5, token: tok }, NOW), { status: 200, body: { ok: true } });
  assertEquals(db.tables.reminder_log[0].read_at, new Date(NOW).toISOString());
  await remRead(db, { id: 5, token: tok }, NOW + 60_000);
  assertEquals(db.tables.reminder_log[0].read_at, new Date(NOW).toISOString());
});

Deno.test("remConfigSet : fusion profonde des surcharges, journal, validation, reset", async () => {
  const db = fakeDb({ cleaners: PEOPLE });
  let r: any = await remConfigSet(db, { patch: { minGapMin: 30, quiet: { start: "22:00" } } }, ME);
  assertEquals(r.status, 200);
  r = await remConfigSet(db, { patch: { quiet: { end: "06:00" }, rules: { r7: false } } }, ME);
  assertEquals(r.body.config.minGapMin, 30);
  assertEquals(r.body.config.quiet, { start: "22:00", end: "06:00" });
  assertEquals(r.body.config.rules.r7, false);
  assertEquals(r.body.config.rules.r1, true);
  const stored = JSON.parse(db.tables.app_config.find((x: any) => x.key === "reminders").value);
  assertEquals(stored, { minGapMin: 30, quiet: { start: "22:00", end: "06:00" }, rules: { r7: false } });
  const logs = db.tables.cleaning_log;
  assertEquals(logs.length, 2);
  assertEquals([logs[1].reservation_key, logs[1].action, logs[1].actor], ["reminders_config", "reminders_config", "Walter"]);
  assertEquals(logs[1].details, { quiet: { end: "06:00" }, rules: { r7: false } });

  const bad: any = await remConfigSet(db, { patch: { minGapMin: -1 } }, ME);
  assertEquals(bad.status, 400);
  assertEquals((await remConfigSet(db, { patch: { nope: 1 } }, ME)).status, 400);

  const g: any = await remConfigGet(db);
  assertEquals(g.body.config.minGapMin, 30);
  assertEquals(g.body.defaults.minGapMin, 60);
  assertEquals(g.body.managers, [{ id: 1, name: "Walter" }]);
  assertEquals(g.body.people.map((p: any) => p.id), [1, 2, 5, 7, 9]);

  const reset: any = await remConfigSet(db, { patch: { reset: true } }, ME);
  assertEquals(reset.body.config.minGapMin, 60);
  assertEquals(db.tables.app_config.filter((x: any) => x.key === "reminders").length, 0);
});

Deno.test("mergeOverrides : objets fusionnes, scalaires et listes remplaces", () => {
  assertEquals(
    mergeOverrides({ quiet: { start: "21:00" }, managerIds: [1, 2], texts: { r1: "a" } }, { quiet: { end: "06:00" }, managerIds: [3], texts: { r2: "b" } }),
    { quiet: { start: "21:00", end: "06:00" }, managerIds: [3], texts: { r1: "a", r2: "b" } },
  );
});

Deno.test("remLog : plus recent d'abord, noms, filtres et bornes", async () => {
  const db = fakeDb({
    cleaners: PEOPLE,
    reminder_log: [
      { id: 1, rule: "r1", subject_kind: "ticket", subject_id: "10", subject_ref: "MNT-10", cleaner_id: 1, title: "A", body: "a", urgent: true, status: "sent", sent_at: "2026-10-20T07:00:00Z", read_at: null },
      { id: 2, rule: "r8", subject_kind: "cleaning", subject_id: "k", subject_ref: "k", cleaner_id: 7, title: "B", body: "b", urgent: false, status: "no_subscription", sent_at: "2026-10-20T08:00:00Z", read_at: "2026-10-20T08:01:00Z" },
    ],
  });
  const r: any = await remLog(db, { limit: 200, status: null, rule: null });
  assertEquals(r.body.rows.map((x: any) => x.id), [2, 1]);
  assertEquals(r.body.rows[0].recipientName, "Faiza");
  assertEquals(r.body.rows[0].readAt, "2026-10-20T08:01:00Z");
  assertEquals(r.body.rows[1].subjectRef, "MNT-10");
  const f: any = await remLog(db, { limit: 200, status: "sent", rule: null });
  assertEquals(f.body.rows.map((x: any) => x.id), [1]);
  assertEquals(parseRemLogQuery(new URLSearchParams("limit=9999")), { limit: 500, status: null, rule: null });
  assertEquals(parseRemLogQuery(new URLSearchParams("")), { limit: 200, status: null, rule: null });
  assert("error" in parseRemLogQuery(new URLSearchParams("status=bogus")));
  assert("error" in parseRemLogQuery(new URLSearchParams("rule=r99")));
});

Deno.test("remTest : urgent a soi-meme, hors silence, journalise regle test", async () => {
  const db = fakeDb({ cleaners: PEOPLE });
  const { d, calls } = deps({ result: { sent: 0, pruned: 0, skipped: "no_subscription" } });
  const r: any = await remTest(db, ME, d);
  assertEquals(r.body, { sent: 0, skipped: "no_subscription" });
  assertEquals(calls[0].opts.priority, "urgent");
  assertEquals(calls[0].opts.quietHandled, true);
  assertEquals(calls[0].payload.urgent, true);
  const row = db.tables.reminder_log[0];
  assertEquals([row.rule, row.subject_kind, row.subject_id, row.cleaner_id, row.status], ["test", "ticket", "test", 1, "no_subscription"]);
});

// --- Branchement dans index.ts ---------------------------------------------------------

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
function bloc(action: string): string {
  const debut = src.indexOf(`if (action === "${action}")`);
  assert(debut >= 0, "handler absent pour " + action);
  const fin = src.indexOf("if (action ===", debut + 10);
  return src.slice(debut, fin < 0 ? undefined : fin);
}

Deno.test("ROUTES et SERVER_ONLY_ACTIONS : rem.run serveur seul, methodes declarees", () => {
  for (const [a, m] of [["rem.run", "POST"], ["rem.read", "POST"], ["rem.config", "GET"], ["rem.config.set", "POST"], ["rem.log", "GET"], ["rem.test", "POST"]]) {
    assert(src.includes(`["${a}", "${m}"]`), a);
  }
  const debut = src.indexOf("const SERVER_ONLY_ACTIONS = new Set([");
  const set = src.slice(debut, src.indexOf("]);", debut));
  assert(set.includes('"rem.run"'));
  for (const a of ["rem.read", "rem.config", "rem.log", "rem.test"]) assertEquals(set.includes(`"${a}"`), false, a);
});

Deno.test("routes rem : gardes de session", () => {
  assertEquals(bloc("rem.run").includes("currentUser("), false);
  assertEquals(bloc("rem.read").includes("currentUser("), false);
  const cfg = src.slice(src.indexOf('if (action === "rem.config" ||'), src.indexOf('if (action === "rem.test")'));
  assert(cfg.includes("mgrAccess(bearerToken(req) !== null, me)"));
  assert(bloc("rem.test").includes("mntAccess(bearerToken(req) !== null, me)"));
  assert(bloc("rem.run").includes("loadCheckoutsCached(sb, s, e, false)"));
});
