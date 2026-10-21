import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  applyLimits, type Due, evaluate, isQuiet, mergeConfig, REM_DEFAULTS, type RemCleaning, type RemHistoryRow,
  type RemProposal, type RemSnapshot, type RemTicket, validateConfigPatch,
} from "./reminders_rules.ts";

const TODAY = "2026-10-20";
const NOON = Date.parse("2026-10-20T08:00:00Z"); // 12:00 Dubai
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();
const ago = (min: number) => iso(NOON - min * MIN);
const CFG = mergeConfig(null);
const M1 = 1, M2 = 2, TECH = 10, CLEANER = 20, ELITE = 30;

function ticket(o: Partial<RemTicket> = {}): RemTicket {
  return {
    id: 482, listing_id: "305", title: "AC not cooling", priority: "medium", status: "open",
    created_at: ago(10), last_update: null, due_on: null, assigned_technician_id: null, assigned_vendor_id: null,
    assignedAt: null, label: "305 Neva Residence", ...o,
  };
}
function snap(o: Partial<RemSnapshot> = {}): RemSnapshot {
  return {
    today: TODAY, tickets: [], proposals: [], cleanings: [], guestOnSite: new Set(), managers: [M1, M2],
    people: { "10": { name: "Ali", role: "maintenance" }, "20": { name: "Joy", role: "cleaner" } }, history: [], ...o,
  };
}
function sent(rule: string, id: string, who: number | null, min: number, kind = "ticket", status = "sent"): RemHistoryRow {
  return { rule, subject_kind: kind, subject_id: id, cleaner_id: who, status, sent_at: ago(min) };
}
const rules = (d: Due[]) => d.map((x) => x.rule).sort();

Deno.test("r1 : ticket urgent sans responsable apres 30 min, URGENT aux managers", () => {
  assertEquals(evaluate(snap({ tickets: [ticket({ priority: "urgent", created_at: ago(29) })] }), CFG, NOON), []);
  const d = evaluate(snap({ tickets: [ticket({ priority: "urgent", created_at: ago(31) })] }), CFG, NOON);
  assertEquals(d.length, 1);
  assertEquals(d[0].rule, "r1");
  assertEquals(d[0].recipients, [M1, M2]);
  assert(d[0].urgent);
  assertEquals(d[0].title, "URGENT · MNT-482 · 305 NEVA RESIDENCE");
  assertEquals(d[0].url, "/manager/#/maintenance?ref=MNT-482");
  assertEquals(d[0].ref, "MNT-482");
  assert(d[0].body.includes("AC not cooling"));
  // Un vendor suffit a lever l'alerte.
  assertEquals(evaluate(snap({ tickets: [ticket({ priority: "urgent", created_at: ago(31), assigned_vendor_id: 5 })] }), CFG, NOON), []);
});

Deno.test("r2 : sans responsable ni date depuis 24 h, puis une fois par 24 h", () => {
  assertEquals(evaluate(snap({ tickets: [ticket({ created_at: ago(1439) })] }), CFG, NOON), []);
  const d = evaluate(snap({ tickets: [ticket({ created_at: ago(1441) })] }), CFG, NOON);
  assertEquals(rules(d), ["r2"]);
  assertEquals(d[0].title, "MNT-482 · 305 Neva Residence");
  assert(!d[0].urgent);
  assertEquals(evaluate(snap({ tickets: [ticket({ created_at: ago(1441), due_on: "2026-10-25" })] }), CFG, NOON), []);
  const h = [sent("r2", "482", M1, 600)];
  assertEquals(evaluate(snap({ tickets: [ticket({ created_at: ago(3000) })], history: h }), CFG, NOON), []);
});

Deno.test("r3 : 2 h puis 6 h apres l'assignation, au technicien", () => {
  const t = (min: number) => ticket({ status: "assigned", assigned_technician_id: TECH, assignedAt: ago(min) });
  assertEquals(evaluate(snap({ tickets: [t(119)] }), CFG, NOON), []);
  const d = evaluate(snap({ tickets: [t(121)] }), CFG, NOON);
  assertEquals(d.map((x) => [x.rule, x.key, x.recipients]), [["r3", "r3:ticket:482:first", [TECH]]]);
  // Premier deja envoye : le second 4 h apres l'envoi reel du premier, pas avant.
  const h = [sent("r3", "482", TECH, 200)];
  assertEquals(evaluate(snap({ tickets: [t(300)], history: h }), CFG, NOON), []);
  assertEquals(evaluate(snap({ tickets: [t(361)], history: h }), CFG, NOON), []);
  const h1 = [sent("r3", "482", TECH, 241)];
  assertEquals(evaluate(snap({ tickets: [t(361)], history: h1 }), CFG, NOON).map((x) => x.key), ["r3:ticket:482:second"]);
  // Tres en retard sans aucun envoi : c'est toujours le premier.
  assertEquals(evaluate(snap({ tickets: [t(500)] }), CFG, NOON).map((x) => x.key), ["r3:ticket:482:first"]);
  // Les deux deja envoyes : plus de r3.
  const h2 = [sent("r3", "482", TECH, 300), sent("r3", "482", TECH, 30)];
  assertEquals(evaluate(snap({ tickets: [t(400)], history: h2 }), { ...CFG, rules: { ...CFG.rules, r10: false } }, NOON), []);
  // Rappel d'une ancienne assignation : ne compte pas.
  const old = [sent("r3", "482", TECH, 500)];
  assertEquals(evaluate(snap({ tickets: [t(130)], history: old }), CFG, NOON).map((x) => x.key), ["r3:ticket:482:first"]);
});

Deno.test("r3 : premier retarde par les heures calmes a 07:00, second pas avant 11:00", () => {
  // Assigne a 20:00 la veille (Dubai), premier envoye a 07:00 apres les heures calmes.
  const t = ticket({ status: "assigned", assigned_technician_id: TECH, assignedAt: ago(960) });
  const h = [sent("r3", "482", TECH, 300)];
  const cfg = { ...CFG, rules: { ...CFG.rules, r10: false } };
  const at1059 = Date.parse("2026-10-20T06:59:00Z");
  const at1100 = Date.parse("2026-10-20T07:00:00Z");
  assertEquals(evaluate(snap({ tickets: [t], history: h }), cfg, at1059), []);
  assertEquals(evaluate(snap({ tickets: [t], history: h }), cfg, at1100).map((x) => x.key), ["r3:ticket:482:second"]);
});

Deno.test("r4 : en cours sans mise a jour depuis 24 h", () => {
  const t = (min: number) => ticket({ status: "in_progress", assigned_technician_id: TECH, last_update: ago(min), assignedAt: ago(3000) });
  assertEquals(evaluate(snap({ tickets: [t(1400)] }), CFG, NOON), []);
  const d = evaluate(snap({ tickets: [t(1441)] }), CFG, NOON);
  assertEquals(d.map((x) => [x.rule, x.recipients]), [["r4", [TECH]]]);
  assert(d[0].body.includes("24 h"));
  assertEquals(evaluate(snap({ tickets: [t(1441)], history: [sent("r4", "482", TECH, 100)] }), CFG, NOON), []);
});

Deno.test("r5 : guest sur place, delais divises par 2 et urgence si priorite haute", () => {
  const g = new Set(["305"]);
  const d1 = evaluate(snap({ tickets: [ticket({ priority: "urgent", created_at: ago(16) })], guestOnSite: g }), CFG, NOON);
  assertEquals(rules(d1), ["r1"]);
  assert(d1[0].guestOnSite);
  assertEquals(rules(evaluate(snap({ tickets: [ticket({ created_at: ago(721) })], guestOnSite: { "305": true } }), CFG, NOON)), ["r2"]);
  const t3 = ticket({ status: "assigned", assigned_technician_id: TECH, assignedAt: ago(61), priority: "high" });
  const d3 = evaluate(snap({ tickets: [t3], guestOnSite: g }), CFG, NOON);
  assertEquals(rules(d3), ["r3"]);
  assert(d3[0].urgent);
  assert(d3[0].title.startsWith("URGENT"));
  assert(d3[0].body.endsWith("Guest on site."));
  // Priorite normale : plus tot mais pas urgent.
  const d3n = evaluate(snap({ tickets: [{ ...t3, priority: "medium" }], guestOnSite: g }), CFG, NOON);
  assert(!d3n[0].urgent);
  const t4 = ticket({ status: "in_progress", assigned_technician_id: TECH, last_update: ago(721) });
  assertEquals(rules(evaluate(snap({ tickets: [t4], guestOnSite: g }), CFG, NOON)), ["r4"]);
  const p: RemProposal = { id: 7, listing_id: 305, title: "Leak", urgency: "high", created_at: ago(721), label: "305 Neva Residence" };
  assertEquals(rules(evaluate(snap({ proposals: [p], guestOnSite: g }), CFG, NOON)), ["r9"]);
  // r5 coupee : delais normaux.
  const off = { ...CFG, rules: { ...CFG.rules, r5: false } };
  assertEquals(evaluate(snap({ tickets: [t4], guestOnSite: g }), off, NOON), []);
});

Deno.test("r6 : echeance depassee, technicien et managers dans une relance, une fois par jour", () => {
  const t = ticket({ status: "assigned", assigned_technician_id: TECH, assignedAt: ago(30), due_on: "2026-10-19" });
  const d = evaluate(snap({ tickets: [t] }), CFG, NOON);
  assertEquals(d.map((x) => [x.rule, x.recipients]), [["r6", [TECH, M1, M2]]]);
  assert(d[0].body.includes("2026-10-19") && d[0].body.includes("Ali"));
  assertEquals(evaluate(snap({ tickets: [{ ...t, due_on: TODAY }] }), CFG, NOON), []);
  assertEquals(evaluate(snap({ tickets: [t], history: [sent("r6", "482", M1, 600)] }), CFG, NOON), []);
  assertEquals(rules(evaluate(snap({ tickets: [t], history: [sent("r6", "482", M1, 1441)] }), CFG, NOON)), ["r6"]);
});

function cleaning(o: Partial<RemCleaning> = {}): RemCleaning {
  return {
    key: "305|2026-10-20", date: TODAY, listingId: "305", label: "305 Neva Residence", assigned: [{ id: CLEANER, role: "cleaner" }],
    state: "not_started", cancelled: false, time: null, ...o,
  };
}

Deno.test("r7 : menages de demain non assignes, une alerte a partir de 09:15", () => {
  const tom = "2026-10-21";
  const list = [
    cleaning({ key: "a", date: tom, label: "305 Neva Residence", assigned: [] }),
    cleaning({ key: "b", date: tom, label: "1201 Marina Gate", assigned: [] }),
    cleaning({ key: "c", date: tom, assigned: [], cancelled: true }),
    cleaning({ key: "d", date: tom }),
  ];
  const at0914 = Date.parse("2026-10-20T05:14:00Z");
  assertEquals(evaluate(snap({ cleanings: list }), CFG, at0914), []);
  const d = evaluate(snap({ cleanings: list }), CFG, NOON);
  assertEquals(d.length, 1);
  assertEquals(d[0].rule, "r7");
  assertEquals(d[0].recipients, [M1, M2]);
  assertEquals(d[0].url, "/manager/#/planning");
  assertEquals(d[0].title, "Tomorrow · 2 cleanings not assigned");
  assert(d[0].body.includes("305 Neva Residence, 1201 Marina Gate"));
  assertEquals(evaluate(snap({ cleanings: list, history: [sent("r7", "unassigned:2026-10-21", M1, 60, "cleaning")] }), CFG, NOON), []);
});

Deno.test("r8 : menage pas termine 2 h apres l'heure prevue, sans Elite", () => {
  // 11:00 par defaut -> rappel a partir de 13:00.
  assertEquals(evaluate(snap({ cleanings: [cleaning()] }), CFG, NOON), []);
  const at1301 = NOON + 61 * MIN;
  const d = evaluate(snap({ cleanings: [cleaning()] }), CFG, at1301);
  assertEquals(d.map((x) => [x.rule, x.recipients, x.url]), [["r8", [CLEANER], "/v3/"]]);
  // Heure de l'extra 10:00 -> 12:00.
  assertEquals(rules(evaluate(snap({ cleanings: [cleaning({ time: "10:00" })] }), CFG, NOON)), ["r8"]);
  assertEquals(evaluate(snap({ cleanings: [cleaning({ state: "done" })] }), CFG, at1301), []);
  assertEquals(evaluate(snap({ cleanings: [cleaning({ cancelled: true })] }), CFG, at1301), []);
  assertEquals(evaluate(snap({ cleanings: [cleaning({ assigned: [{ id: ELITE, role: "subcontractor" }] })] }), CFG, at1301), []);
  // Manager assigne : lien Planning ; Elite ignore.
  const mixed = cleaning({ assigned: [{ id: M1, role: "manager" }, { id: CLEANER, role: "cleaner" }, { id: ELITE, role: "subcontractor" }] });
  const dm = evaluate(snap({ cleanings: [mixed] }), CFG, at1301);
  assertEquals(dm.map((x) => [x.recipients, x.url]), [[[M1], "/manager/#/planning"], [[CLEANER], "/v3/"]]);
  assertEquals(evaluate(snap({ cleanings: [cleaning()], history: [sent("r8", "305|2026-10-20", CLEANER, 30, "cleaning")] }), CFG, at1301), []);
  // Menage de demain : jamais en retard aujourd'hui.
  assertEquals(evaluate(snap({ cleanings: [cleaning({ date: "2026-10-21", time: "00:00" })] }), { ...CFG, rules: { ...CFG.rules, r7: false } }, at1301), []);
});

Deno.test("r9 : proposition en attente depuis 24 h", () => {
  const p: RemProposal = { id: 7, listing_id: 305, title: "Leak", urgency: "normal", created_at: ago(1441), label: "305 Neva Residence" };
  const d = evaluate(snap({ proposals: [p] }), CFG, NOON);
  assertEquals(d.map((x) => [x.rule, x.ref, x.url, x.title]), [["r9", "PRP-7", "/manager/#/maintenance?ref=PRP-7", "PRP-7 · 305 Neva Residence"]]);
  assertEquals(evaluate(snap({ proposals: [{ ...p, created_at: ago(1000) }] }), CFG, NOON), []);
  assertEquals(evaluate(snap({ proposals: [p], history: [sent("r9", "7", M1, 60, "proposal")] }), CFG, NOON), []);
});

Deno.test("r10 : escalade URGENT apres 2 rappels sans action, une fois par jour", () => {
  const t = ticket({ status: "assigned", assigned_technician_id: TECH, assignedAt: ago(400), lastChangeAt: ago(400) });
  const h = [sent("r3", "482", TECH, 330), sent("r3", "482", TECH, 70)];
  const d = evaluate(snap({ tickets: [t], history: h }), CFG, NOON);
  assertEquals(rules(d), ["r10"]);
  assertEquals(d[0].recipients, [M1, M2]);
  assert(d[0].urgent);
  assert(d[0].title.startsWith("URGENT · MNT-482"));
  assert(d[0].body.includes("Ali") && d[0].body.includes("MNT-482"));
  // Ticket modifie apres le premier rappel : pas d'escalade.
  assertEquals(rules(evaluate(snap({ tickets: [{ ...t, lastChangeAt: ago(100) }], history: h }), CFG, NOON)), []);
  // Deja escalade aujourd'hui.
  assertEquals(evaluate(snap({ tickets: [t], history: [...h, sent("r10", "482", M1, 20)] }), CFG, NOON), []);
  // Seuil configurable.
  assertEquals(evaluate(snap({ tickets: [t], history: h }), { ...CFG, escalateAfter: 3 }, NOON), []);
});

Deno.test("r10 : delai de grace apres le dernier rappel compte", () => {
  const t = ticket({ status: "assigned", assigned_technician_id: TECH, assignedAt: ago(400), lastChangeAt: ago(400) });
  const recent = [sent("r3", "482", TECH, 280), sent("r3", "482", TECH, 30)];
  // Dernier rappel il y a 30 min : pas encore d'escalade (grace 60 par defaut).
  assertEquals(rules(evaluate(snap({ tickets: [t], history: recent }), CFG, NOON)), []);
  assertEquals(rules(evaluate(snap({ tickets: [t], history: recent }), CFG, NOON + 30 * MIN)), ["r10"]);
  // Grace configurable, 0 = immediat.
  assertEquals(rules(evaluate(snap({ tickets: [t], history: recent }), { ...CFG, escalateGraceMin: 0 }, NOON)), ["r10"]);
  assertEquals(mergeConfig({ escalateGraceMin: 15 }).escalateGraceMin, 15);
  assertEquals(mergeConfig({ escalateGraceMin: 2000 }).escalateGraceMin, 60);
  assertEquals((validateConfigPatch({ escalateGraceMin: 0 }) as { ok: boolean }).ok, true);
  assertEquals((validateConfigPatch({ escalateGraceMin: 1441 }) as { ok: boolean }).ok, false);
});

Deno.test("destinataires : managerIds de la config prioritaire", () => {
  const d = evaluate(snap({ tickets: [ticket({ priority: "urgent", created_at: ago(31) })] }), { ...CFG, managerIds: [9] }, NOON);
  assertEquals(d[0].recipients, [9]);
});

Deno.test("interrupteurs : global et par regle", () => {
  const s = snap({ tickets: [ticket({ priority: "urgent", created_at: ago(2000) })] });
  assertEquals(rules(evaluate(s, CFG, NOON)), ["r1", "r2"]);
  assertEquals(evaluate(s, { ...CFG, enabled: false }, NOON), []);
  assertEquals(rules(evaluate(s, { ...CFG, rules: { ...CFG.rules, r1: false } }, NOON)), ["r2"]);
  const due = evaluate(s, CFG, NOON);
  const r = applyLimits(due, [], NOON, { ...CFG, enabled: false });
  assertEquals(r.send, []);
  assertEquals(r.skipped.map((x) => x.reason), ["disabled", "disabled"]);
});

Deno.test("silence 21:00-07:00 Dubai, qui passe minuit", () => {
  const at = (h: string) => Date.parse("2026-10-20T" + h + ":00Z") - 4 * 3_600_000;
  assert(isQuiet(at("21:00"), CFG));
  assert(isQuiet(at("23:59"), CFG));
  assert(isQuiet(at("03:00"), CFG));
  assert(!isQuiet(at("07:00"), CFG));
  assert(!isQuiet(at("20:59"), CFG));
  const day = { ...CFG, quiet: { start: "13:00", end: "15:00" } };
  assert(isQuiet(at("14:00"), day));
  assert(!isQuiet(at("15:00"), day));
  assert(!isQuiet(at("12:00"), { ...CFG, quiet: { start: "10:00", end: "10:00" } }));
});

function due(o: Partial<Due> = {}): Due {
  return {
    rule: "r2", subjectKind: "ticket", subjectId: "482", ref: "MNT-482", recipients: [M1, M2], urgent: false, guestOnSite: false,
    title: "t", body: "b", url: "/manager/#/maintenance?ref=MNT-482", key: "r2:ticket:482", ...o,
  };
}

Deno.test("silence : seule l'urgence avec guest sur place passe", () => {
  const night = Date.parse("2026-10-20T19:00:00Z"); // 23:00 Dubai
  const r = applyLimits([
    due(), due({ rule: "r1", key: "r1:ticket:482", urgent: true }),
    due({ rule: "r1", subjectId: "9", key: "r1:ticket:9", urgent: true, guestOnSite: true }),
  ], [], night, CFG);
  assertEquals(r.send.map((x) => x.subjectId), ["9"]);
  assertEquals(r.skipped.map((x) => x.reason), ["quiet", "quiet"]);
});

Deno.test("plafond : 3 passages par sujet et par jour Dubai, un envoi a 2 managers compte 1", () => {
  const h: RemHistoryRow[] = [
    sent("r1", "482", M1, 300), sent("r1", "482", M2, 300),
    sent("r1", "482", M1, 200), sent("r1", "482", M2, 200),
    sent("r2", "482", M1, 120),
  ];
  const r = applyLimits([due({ rule: "r1", key: "r1:ticket:482" })], h, NOON, CFG);
  assertEquals(r.skipped.map((x) => x.reason), ["capped"]);
  // Deux passages seulement : le troisieme part.
  const r2 = applyLimits([due({ rule: "r1", key: "r1:ticket:482" })], h.slice(0, 4), NOON, CFG);
  assertEquals(r2.send.length, 1);
  // Hier (Dubai) ne compte pas : 04:00 Dubai, envois avant minuit Dubai.
  const early = Date.parse("2026-10-20T00:00:00Z");
  const old = [0, 1, 2].map((i) => ({ ...sent("r1", "482", M1, 0), sent_at: iso(early - (250 + i * 70) * MIN) }));
  assertEquals(applyLimits([due({ rule: "r1", key: "r1:ticket:482", urgent: true, guestOnSite: true })], old, early, CFG).send.length, 1);
  // Statuts autres que sent ignores.
  const fails = [sent("r1", "482", M1, 300, "ticket", "no_subscription"), sent("r1", "482", M1, 200, "ticket", "error"), sent("r2", "482", M1, 100, "ticket", "quiet")];
  assertEquals(applyLimits([due()], fails, NOON, CFG).send.length, 1);
  // Dans un meme passage : plafond atteint au 4e, urgent servi en premier.
  const many = [due({ rule: "r2" }), due({ rule: "r4", key: "r4:ticket:482" }), due({ rule: "r6", key: "r6:ticket:482" }), due({ rule: "r10", key: "r10:ticket:482", urgent: true })];
  const r3 = applyLimits(many, [], NOON, CFG);
  assertEquals(r3.send.map((x) => x.rule), ["r10", "r2", "r4"]);
  assertEquals(r3.skipped.map((x) => [x.due.rule, x.reason]), [["r6", "capped"]]);
  // Deux relances de meme cle (r8 cleaners et managers) comptent 1.
  const r8 = [due({ rule: "r8", subjectKind: "cleaning", subjectId: "c", key: "r8:cleaning:c", recipients: [M1] }), due({ rule: "r8", subjectKind: "cleaning", subjectId: "c", key: "r8:cleaning:c", recipients: [CLEANER] })];
  assertEquals(applyLimits(r8, [], NOON, { ...CFG, maxPerSubjectPerDay: 1 }).send.length, 2);
});

Deno.test("ecart : jamais deux relances identiques au meme destinataire a moins d'1 h", () => {
  const r = applyLimits([due()], [sent("r2", "482", M1, 59), sent("r2", "482", M2, 59)], NOON, CFG);
  assertEquals(r.skipped.map((x) => x.reason), ["duplicate"]);
  const r2 = applyLimits([due()], [sent("r2", "482", M1, 61), sent("r2", "482", M2, 61)], NOON, CFG);
  assertEquals(r2.send.length, 1);
  // Un seul manager deja servi : l'autre recoit quand meme.
  const r3 = applyLimits([due()], [sent("r2", "482", M1, 10)], NOON, CFG);
  assertEquals(r3.send[0].recipients, [M2]);
  // Autre regle ou autre etape (cle) : pas identique.
  assertEquals(applyLimits([due({ rule: "r1", key: "r1:ticket:482" })], [sent("r2", "482", M1, 10)], NOON, CFG).send[0].recipients, [M1, M2]);
  const keyed: RemHistoryRow = { ...sent("r3", "482", TECH, 10), key: "r3:ticket:482:first" };
  assertEquals(applyLimits([due({ rule: "r3", key: "r3:ticket:482:second", recipients: [TECH] })], [keyed], NOON, CFG).send.length, 1);
  assertEquals(applyLimits([due({ rule: "r3", key: "r3:ticket:482:first", recipients: [TECH] })], [keyed], NOON, CFG).skipped[0].reason, "duplicate");
  assertEquals(applyLimits([due()], [sent("r2", "482", M1, 10), sent("r2", "482", M2, 10)], NOON, { ...CFG, minGapMin: 0 }).send.length, 1);
});

Deno.test("config : fusion profonde tolerante", () => {
  assertEquals(mergeConfig(undefined), REM_DEFAULTS);
  assertEquals(mergeConfig("x"), REM_DEFAULTS);
  const c = mergeConfig({
    enabled: false, urgentUnassignedMin: 15, guestFactor: 5, quiet: { start: "22:00", end: "bad" },
    rules: { r8: false, r99: true }, texts: { r1: "Hi {apt}", r2: "", r5: "x" }, unknown: 1, managerIds: [3, 3, 4],
    maxPerSubjectPerDay: 0,
  });
  assertEquals(c.enabled, false);
  assertEquals(c.urgentUnassignedMin, 15);
  assertEquals(c.guestFactor, 0.5);
  assertEquals(c.quiet, { start: "22:00", end: "07:00" });
  assertEquals(c.rules.r8, false);
  assertEquals(c.rules.r1, true);
  assertEquals(c.texts.r1, "Hi {apt}");
  assertEquals(c.texts.r2, REM_DEFAULTS.texts.r2);
  assertEquals(c.managerIds, [3, 4]);
  assertEquals(c.maxPerSubjectPerDay, 3);
  assertEquals("unknown" in c, false);
  // Les defauts ne sont jamais modifies par une fusion.
  assertEquals(REM_DEFAULTS.quiet.start, "21:00");
  assertEquals(REM_DEFAULTS.rules.r8, true);
  // Textes sans tiret cadratin.
  assert(Object.values(REM_DEFAULTS.texts).every((t) => !t.includes("\u2014")));
});

Deno.test("config : validation stricte d'un patch", () => {
  assertEquals(validateConfigPatch({ urgentUnassignedMin: 45, quiet: { start: "22:00" }, rules: { r3: false }, texts: { r8: " Go " }, managerIds: null }), {
    ok: true, patch: { urgentUnassignedMin: 45, quiet: { start: "22:00" }, rules: { r3: false }, texts: { r8: "Go" }, managerIds: null },
  });
  const bad = (b: unknown) => (validateConfigPatch(b) as { ok: boolean }).ok;
  assertEquals(bad(null), false);
  assertEquals(bad([]), false);
  assertEquals(bad({ foo: 1 }), false);
  assertEquals(bad({ urgentUnassignedMin: 0 }), false);
  assertEquals(bad({ urgentUnassignedMin: 10081 }), false);
  assertEquals(bad({ urgentUnassignedMin: 10080 }), true);
  assertEquals(bad({ assignedFirstMin: 1.5 }), false);
  assertEquals(bad({ guestFactor: 0.05 }), false);
  assertEquals(bad({ guestFactor: 1 }), true);
  assertEquals(bad({ tomorrowCheckAt: "9:15" }), false);
  assertEquals(bad({ tomorrowCheckAt: "24:00" }), false);
  assertEquals(bad({ maxPerSubjectPerDay: 11 }), false);
  assertEquals(bad({ minGapMin: 0 }), true);
  assertEquals(bad({ minGapMin: 1441 }), false);
  assertEquals(bad({ escalateAfter: 0 }), false);
  assertEquals(bad({ managerIds: [1, -2] }), false);
  assertEquals(bad({ managerIds: ["1"] }), false);
  assertEquals(bad({ managerIds: [] }), true);
  assertEquals(bad({ texts: { r1: "x".repeat(201) } }), false);
  assertEquals(bad({ texts: { r5: "x" } }), false);
  assertEquals(bad({ rules: { r1: "yes" } }), false);
  assertEquals(bad({ quiet: { middle: "10:00" } }), false);
  assertEquals(bad({ enabled: "true" }), false);
  assertEquals(validateConfigPatch({ minGapMin: 5000 }), { ok: false, error: "minGapMin must be 0 to 1440." });
  // Un patch valide relu par mergeConfig donne la config attendue.
  const p = validateConfigPatch({ guestFactor: 0.25, rules: { r7: false } });
  assert(p.ok);
  const merged = mergeConfig({ ...p.patch });
  assertEquals(merged.guestFactor, 0.25);
  assertEquals(merged.rules.r7, false);
});
