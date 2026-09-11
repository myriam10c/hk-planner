import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import {
  claimEvent, estimatedMinutes, formatHour, normalizeUnitType, onDutyTechnician,
  pickSnapshot, plusDays, readLinen, recordResult, releaseEvent, roleAllowed,
  shortGuest, templateItems, todayDubai, validIdem, V3_CACHE_STALE_MS,
  V3_LINEN_FIELDS, V3_ROLES, weekKeyFor,
} from "./v3.ts";

Deno.test("normalizeUnitType lit le tag Hostaway puis retombe sur les chambres", () => {
  assertEquals(normalizeUnitType("Studio", 0), "Studio");
  assertEquals(normalizeUnitType("1 BHK", 1), "1 BHK");
  assertEquals(normalizeUnitType("2 BHK", 2), "2 BHK");
  assertEquals(normalizeUnitType("3 BHK", 3), "2 BHK");
  assertEquals(normalizeUnitType(null, 0), "Studio");
  assertEquals(normalizeUnitType(null, 1), "1 BHK");
  assertEquals(normalizeUnitType(null, 4), "2 BHK");
  assertEquals(normalizeUnitType("", null), "Studio");
});

Deno.test("estimatedMinutes applique la mediane reelle et ses ponderations", () => {
  assertEquals(estimatedMinutes("Studio"), 94);
  assertEquals(estimatedMinutes("1 BHK"), 118);
  assertEquals(estimatedMinutes("2 BHK"), 165);
  assertEquals(estimatedMinutes("inconnu"), 94);
});

Deno.test("formatHour rend une heure lisible ou null", () => {
  assertEquals(formatHour(15), "15:00");
  assertEquals(formatHour(9), "09:00");
  assertEquals(formatHour(0), "00:00");
  assertEquals(formatHour(null), null);
  assertEquals(formatHour("abc"), null);
  assertEquals(formatHour(30), null);
});

Deno.test("shortGuest ne rend jamais un nom complet", () => {
  assertEquals(shortGuest("Marie Dupont"), "Marie D.");
  assertEquals(shortGuest("  Jean  Pierre Martin "), "Jean P.");
  assertEquals(shortGuest("Ana"), "Ana");
  assertEquals(shortGuest(""), "Guest");
  assertEquals(shortGuest(null), "Guest");
});

Deno.test("templateItems accepte le JSON en colonne texte et le tableau", () => {
  assertEquals(templateItems({ items: ["A", "B"], photo_required_items: [] }),
    { items: ["A", "B"], photoRequired: [] });
  assertEquals(templateItems({ items: '["A","B"]', photo_required_items: '["B"]' }),
    { items: ["A", "B"], photoRequired: ["B"] });
  assertEquals(templateItems({}), { items: [], photoRequired: [] });
  assertEquals(templateItems({ items: "pas du json" }), { items: [], photoRequired: [] });
});

Deno.test("todayDubai avance de quatre heures sur UTC", () => {
  // 2026-09-11T21:00:00Z = 2026-09-12 01:00 a Dubai
  assertEquals(todayDubai(Date.parse("2026-09-11T21:00:00Z")), "2026-09-12");
  assertEquals(todayDubai(Date.parse("2026-09-11T19:59:00Z")), "2026-09-11");
});

Deno.test("validIdem refuse tout ce qui n'est pas une cle propre", () => {
  assertEquals(validIdem("a1b2c3d4e5f6"), true);
  assertEquals(validIdem("court"), false);
  assertEquals(validIdem("avec espace 12345"), false);
  assertEquals(validIdem(null), false);
  assertEquals(validIdem(12345678), false);
});

Deno.test("readLinen valide les sept champs de linge", () => {
  const ok: Record<string, number> = {};
  for (const f of V3_LINEN_FIELDS) ok[f] = 2;
  assertEquals("values" in readLinen(ok), true);
  assertEquals((readLinen(ok) as any).values.bath_mats, 2);
  assertEquals((readLinen({ ...ok, bed_sheets: -1 }) as any).error, "bed_sheets must be >= 0");
  assertEquals((readLinen({ ...ok, bed_sheets: 1.5 }) as any).error, "bed_sheets must be an integer");
  assertEquals((readLinen({ ...ok, bed_sheets: 1000 }) as any).error, "bed_sheets is out of range");
  // face_towels absent = 0, comme dans l'app actuelle (vieux bundles en cache).
  const sansFace = { ...ok };
  delete (sansFace as any).face_towels;
  assertEquals((readLinen(sansFace) as any).values.face_towels, 0);
});

Deno.test("claimEvent laisse passer la premiere cle et rejoue les suivantes", async () => {
  const sb = fakeDb({ job_events: [] });
  const first = await claimEvent(sb, "cle-idempotente-1", "start_job", "k1", 7, { jobId: "k1" });
  assertEquals(first.fresh, true);
  await recordResult(sb, "cle-idempotente-1", { status: "success", jobId: "k1" });
  const second = await claimEvent(sb, "cle-idempotente-1", "start_job", "k1", 7, { jobId: "k1" });
  assertEquals(second.fresh, false);
  assertEquals(second.result, { status: "success", jobId: "k1" });
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("releaseEvent rend la cle reutilisable quand l'ecriture metier a echoue", async () => {
  const sb = fakeDb({ job_events: [] });
  assertEquals((await claimEvent(sb, "cle-idempotente-2", "tick", "k1", 7, {})).fresh, true);
  await releaseEvent(sb, "cle-idempotente-2");
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals((await claimEvent(sb, "cle-idempotente-2", "tick", "k1", 7, {})).fresh, true);
});

Deno.test("onDutyTechnician : la ligne du jour gagne sur la regle par defaut", async () => {
  const sb = fakeDb({
    on_duty: [{ duty_date: "2026-09-12", technician_id: 42 }],
    cleaners: [
      { id: 5, name: "Semax", role: "maintenance", is_active: true },
      { id: 6, name: "Ismael", role: "maintenance", is_active: true },
    ],
  });
  assertEquals(await onDutyTechnician(sb, "2026-09-12"), 42);
});

Deno.test("onDutyTechnician : sans ligne, Semax par defaut", async () => {
  const sb = fakeDb({
    on_duty: [],
    cleaners: [
      { id: 6, name: "Ismael", role: "maintenance", is_active: true },
      { id: 5, name: "Semax", role: "maintenance", is_active: true },
    ],
  });
  assertEquals(await onDutyTechnician(sb, "2026-09-12"), 5);
});

Deno.test("onDutyTechnician : sans Semax, Ismael en secours, puis n'importe qui", async () => {
  const sansSemax = fakeDb({
    on_duty: [],
    cleaners: [
      { id: 9, name: "Nouveau technicien", role: "maintenance", is_active: true },
      { id: 6, name: "Ismael", role: "maintenance", is_active: true },
    ],
  });
  assertEquals(await onDutyTechnician(sansSemax, "2026-09-12"), 6);
  const aucun = fakeDb({ on_duty: [], cleaners: [{ id: 9, name: "Zed", role: "maintenance", is_active: true }] });
  assertEquals(await onDutyTechnician(aucun, "2026-09-12"), 9);
  const vide = fakeDb({ on_duty: [], cleaners: [] });
  assertEquals(await onDutyTechnician(vide, "2026-09-12"), null);
});

Deno.test("onDutyTechnician ignore un technicien desactive", async () => {
  const sb = fakeDb({
    on_duty: [],
    cleaners: [
      { id: 5, name: "Semax", role: "maintenance", is_active: false },
      { id: 6, name: "Ismael", role: "maintenance", is_active: true },
    ],
  });
  assertEquals(await onDutyTechnician(sb, "2026-09-12"), 6);
});

// ---------------------------------------------------------------------------
// Roles : le tableau des actions de la specification (section 4) attribue un role
// a chaque action. Un test de refus par action, pour qu'aucune ne soit oubliee.
// ---------------------------------------------------------------------------
Deno.test("roleAllowed accepte les roles prevus par la specification", () => {
  assertEquals(roleAllowed("v3.myDay", "cleaner"), true);
  assertEquals(roleAllowed("v3.myDay", "manager"), true);
  assertEquals(roleAllowed("v3.startJob", "cleaner"), true);
  assertEquals(roleAllowed("v3.startJob", "subcontractor"), true);
  assertEquals(roleAllowed("v3.uploadPhoto", "maintenance"), true);
  assertEquals(roleAllowed("v3.reportProblem", "subcontractor"), true);
  assertEquals(roleAllowed("inconnue", "cleaner"), false);
  assertEquals(Object.keys(V3_ROLES).length, 7);
});

for (const [action, refuse] of [
  ["v3.myDay", "system"],
  ["v3.startJob", "manager"],
  ["v3.tick", "manager"],
  ["v3.uploadPhoto", "manager"],
  ["v3.finishJob", "maintenance"],
  ["v3.reportProblem", "manager"],
  ["v3.checkTicket", "maintenance"],
] as Array<[string, string]>) {
  Deno.test("roleAllowed refuse le role " + refuse + " sur " + action, () => {
    assertEquals(roleAllowed(action, refuse), false);
  });
}

// ---------------------------------------------------------------------------
// Instantanes de checkouts : la v3 lit le meme cache que l'app actuelle, qui
// demande des plages de sept jours a partir du jour ou elle est ouverte.
// ---------------------------------------------------------------------------
Deno.test("plusDays et weekKeyFor construisent la plage de l'app actuelle", () => {
  assertEquals(plusDays("2026-09-12", 6), "2026-09-18");
  assertEquals(plusDays("2026-12-30", 6), "2027-01-05");
  assertEquals(weekKeyFor("2026-09-12"), "checkouts:2026-09-12_2026-09-18");
});

Deno.test("pickSnapshot prend l'instantane le plus frais qui couvre la date", () => {
  const now = Date.parse("2026-09-12T06:00:00Z");
  const rows = [
    { key: "checkouts:2026-09-07_2026-09-13", payload: { reservations: ["vieux"] }, updated_at: new Date(now - 9 * 60_000).toISOString() },
    { key: "checkouts:2026-09-12_2026-09-18", payload: { reservations: ["frais"] }, updated_at: new Date(now - 60_000).toISOString() },
    { key: "checkouts:2026-09-20_2026-09-26", payload: { reservations: ["ailleurs"] }, updated_at: new Date(now).toISOString() },
  ];
  const hit = pickSnapshot(rows, "2026-09-12", now);
  assertEquals(hit?.payload.reservations, ["frais"]);
  assertEquals(hit!.ageMs < 2 * 60_000, true);
});

Deno.test("pickSnapshot ignore une plage qui ne couvre pas la date et une cle illisible", () => {
  const now = Date.parse("2026-09-12T06:00:00Z");
  assertEquals(pickSnapshot([
    { key: "checkouts:2026-09-20_2026-09-26", payload: { reservations: [] }, updated_at: new Date(now).toISOString() },
    { key: "autre:chose", payload: { reservations: [] }, updated_at: new Date(now).toISOString() },
    { key: "checkouts:pas-une-date", payload: {}, updated_at: new Date(now).toISOString() },
  ], "2026-09-12", now), null);
  // Un instantane perime est rendu quand meme : c'est a l'appelant de decider
  // s'il le sert et revalide, ou s'il repaie la pagination.
  const vieux = pickSnapshot([
    { key: "checkouts:2026-09-12_2026-09-18", payload: { reservations: [] }, updated_at: new Date(now - 60 * 60_000).toISOString() },
  ], "2026-09-12", now);
  assertEquals(vieux !== null && vieux.ageMs > V3_CACHE_STALE_MS, true);
});
