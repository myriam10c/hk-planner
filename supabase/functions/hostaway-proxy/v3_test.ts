import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import {
  donneesOuLeve, estimatedMinutes, formatHour, managerIds, normalizeUnitType,
  onDutyTechnician, pickSnapshot, plusDays, readLinen, roleAllowed, shortGuest,
  templateItems, todayDubai, v3Log, validIdem, validMyDayDate, V3_CACHE_STALE_MS,
  V3_CATEGORIES, V3_DATE_WINDOW_AHEAD, V3_DATE_WINDOW_BACK, V3_LINEN_FIELDS,
  V3_PHOTO_BUCKET, V3_ROLES, V3_TEMPLATE_NAME, weekKeyFor,
} from "./v3.ts";

Deno.test("normalizeUnitType lit le tag Hostaway puis retombe sur les chambres", () => {
  assertEquals(normalizeUnitType("Studio", 0), "Studio");
  assertEquals(normalizeUnitType("1 BHK", 1), "1 BHK");
  assertEquals(normalizeUnitType("2 BHK", 2), "2 BHK");
  assertEquals(normalizeUnitType("3 BHK", 3), "2 BHK");
  // Tag Hostaway mal saisi, sans espace : meme type que « 1 BHK », donc 118 min
  // et non 165 (revue tache 2, constat 5).
  assertEquals(normalizeUnitType("1BHK", 1), "1 BHK");
  assertEquals(normalizeUnitType(" studio ", 0), "Studio");
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
  assertEquals(formatHour("15"), "15:00");
  // Number(false) valait 0 et inventait « 00:00 » (revue tache 2, constat 6).
  assertEquals(formatHour(false), null);
  assertEquals(formatHour(true), null);
  assertEquals(formatHour([]), null);
  assertEquals(formatHour({}), null);
  assertEquals(formatHour(""), null);
  assertEquals(formatHour(NaN), null);
});

Deno.test("shortGuest ne rend jamais un nom complet", () => {
  assertEquals(shortGuest("Marie Dupont"), "Marie D.");
  assertEquals(shortGuest("  Jean  Pierre Martin "), "Jean P.");
  assertEquals(shortGuest("Ana"), "Ana");
  assertEquals(shortGuest(""), "Guest");
  assertEquals(shortGuest(null), "Guest");
  // Revue tache 2, constat 2 : la virgule restait collee au jeton, et l'initiale
  // d'un prenom d'un seul caractere est le prenom entier.
  assertEquals(shortGuest("Dupont, Marie"), "Dupont M.");
  assertEquals(shortGuest("\u674e \u660e"), "\u674e");
  assertEquals(shortGuest("Jos\u00e9 Garc\u00eda"), "Jos\u00e9 G.");
  assertEquals(shortGuest("Jean-Pierre Dupont"), "Jean-Pierre D.");
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

Deno.test("onDutyTechnician : la ligne du jour gagne sur la regle par defaut", async () => {
  const sb = fakeDb({
    on_duty: [{ duty_date: "2026-09-12", technician_id: 42 }],
    cleaners: [
      { id: 5, name: "Semax", role: "maintenance", is_active: true },
      { id: 6, name: "Ismael", role: "maintenance", is_active: true },
      { id: 42, name: "Technicien de garde", role: "maintenance", is_active: true },
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

// ---------------------------------------------------------------------------
// Correctifs de la revue de la tache 2. L'idempotence a son propre fichier,
// v3_idem_test.ts, comme le module v3_idem.ts qu'elle couvre.
// ---------------------------------------------------------------------------

Deno.test("onDutyTechnician ignore une ligne du jour qui pointe un compte eteint", async () => {
  const sb = fakeDb({
    on_duty: [{ duty_date: "2026-09-12", technician_id: 99 }],
    cleaners: [
      { id: 99, name: "Parti de l'equipe", role: "maintenance", is_active: false },
      { id: 5, name: "Semax", role: "maintenance", is_active: true },
    ],
  });
  assertEquals(await onDutyTechnician(sb, "2026-09-12"), 5);
});

Deno.test("managerIds ne rend que les managers actifs", async () => {
  const sb = fakeDb({
    cleaners: [
      { id: 1, name: "Walter", role: "manager", is_active: true },
      { id: 2, name: "Ancien manager", role: "manager", is_active: false },
      { id: 3, name: "Harlene", role: "cleaner", is_active: true },
      { id: 4, name: "Hillal", role: "manager", is_active: true },
      { id: 5, name: "Robot", role: "system", is_active: true },
    ],
  });
  assertEquals(await managerIds(sb), [1, 4]);
  assertEquals(await managerIds(fakeDb({ cleaners: [] })), []);
});

Deno.test("v3Log ecrit la ligne et n'explose pas quand l'insert echoue", async () => {
  const sb = fakeDb({ cleaning_log: [] });
  await v3Log(sb, "k1", "v3_start_job", "Harlene", { minutes: 94 });
  assertEquals(sb.tables.cleaning_log.length, 1);
  assertEquals(sb.tables.cleaning_log[0].reservation_key, "k1");
  assertEquals(sb.tables.cleaning_log[0].action, "v3_start_job");
  assertEquals(sb.tables.cleaning_log[0].actor, "Harlene");
  // Acteur absent : null, jamais une chaine vide.
  await v3Log(sb, "k2", "v3_tick", null);
  assertEquals(sb.tables.cleaning_log[1].actor, null);
  assertEquals(sb.tables.cleaning_log[1].details, {});
  // Un log rate ne doit jamais casser l'action qu'il enregistre.
  const casse = fakeDb({ cleaning_log: [] });
  casse.fail["cleaning_log.insert"] = { message: "permission denied" };
  await v3Log(casse, "k3", "v3_finish_job", "Harlene");
  assertEquals(casse.tables.cleaning_log.length, 0);
});

Deno.test("les tables de correspondance exposees aux taches 5 a 7 sont figees", () => {
  assertEquals(V3_PHOTO_BUCKET, "cleaning-photos");
  assertEquals(V3_TEMPLATE_NAME, { "Studio": "Studio", "1 BHK": "1 Bedroom", "2 BHK": "2 Bedrooms" });
  assertEquals(Object.keys(V3_CATEGORIES),
    ["ac", "plumbing", "electrical", "appliance", "pest", "other"]);
  // « other » est la seule categorie dont le nom change en base.
  assertEquals(V3_CATEGORIES.other, { label: "Other", ticketCategory: "general" });
  assertEquals(V3_CATEGORIES.ac, { label: "AC", ticketCategory: "ac" });
  for (const [cle, v] of Object.entries(V3_CATEGORIES)) {
    assertEquals(typeof v.label, "string");
    assertEquals(v.label.length > 0, true);
    assertEquals(typeof v.ticketCategory, "string");
    assertEquals(cle === cle.toLowerCase(), true);
  }
});

Deno.test("V3_LINEN_FIELDS est mot pour mot LAUNDRY_FIELDS d'index.ts", async () => {
  // Les deux listes sont des jumelles volontaires : v3.ts ne peut pas importer
  // index.ts, qui appelle Deno.serve au chargement. On lit donc le fichier comme
  // du texte. Verifie dans la suite et non par une commande a la main, pour qu'une
  // divergence casse les tests au lieu de passer inapercue.
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const bloc = src.match(/const\s+LAUNDRY_FIELDS\s*=\s*\[([\s\S]*?)\]/);
  assertEquals(bloc !== null, true);
  const champs = [...bloc![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assertEquals(champs.length, 7);
  assertEquals(champs, [...V3_LINEN_FIELDS]);
});

// ---------------------------------------------------------------------------
// Correctifs de la revue de la tache 3
// ---------------------------------------------------------------------------

Deno.test("validMyDayDate refuse une date qui n'existe pas", () => {
  // Constat 3 : ces trois-la passaient la regex, atteignaient weekKeyFor et
  // ressortaient en 500 « Internal error » ou en cle de cache illisible.
  assertEquals(validMyDayDate("2026-13-45", "2026-09-12"), "date must be YYYY-MM-DD");
  assertEquals(validMyDayDate("0000-00-00", "2026-09-12"), "date must be YYYY-MM-DD");
  assertEquals(validMyDayDate("2026-02-30", "2026-02-20"), "date must be YYYY-MM-DD");
  // Et la forme reste refusee comme avant.
  assertEquals(validMyDayDate("12/09/2026", "2026-09-12"), "date must be YYYY-MM-DD");
  assertEquals(validMyDayDate("", "2026-09-12"), "date must be YYYY-MM-DD");
  assertEquals(validMyDayDate("2026-9-1", "2026-09-12"), "date must be YYYY-MM-DD");
  // Une vraie date bissextile passe.
  assertEquals(validMyDayDate("2028-02-29", "2028-02-28"), null);
});

Deno.test("validMyDayDate borne la fenetre a sept jours en arriere et quatorze en avant", () => {
  const today = "2026-09-12";
  // Bords inclus : la cleaner peut relire sa semaine passee et preparer la suite.
  assertEquals(validMyDayDate(plusDays(today, -V3_DATE_WINDOW_BACK), today), null);
  assertEquals(validMyDayDate(plusDays(today, V3_DATE_WINDOW_AHEAD), today), null);
  assertEquals(validMyDayDate(today, today), null);
  // Un cran au-dela : refus, et non une pagination Hostaway de plus.
  assertEquals(validMyDayDate(plusDays(today, -V3_DATE_WINDOW_BACK - 1), today), "date out of range");
  assertEquals(validMyDayDate(plusDays(today, V3_DATE_WINDOW_AHEAD + 1), today), "date out of range");
  // 9999-12-31 fabriquait une cle de cache que pickSnapshot ne relit jamais,
  // donc un chemin froid permanent a chaque appel.
  assertEquals(validMyDayDate("9999-12-31", today), "date out of range");
  assertEquals(validMyDayDate("1970-01-01", today), "date out of range");
});

Deno.test("donneesOuLeve leve sur erreur au lieu de rendre une journee tronquee", () => {
  // Constat 2 : quatre lectures sur neuf etaient consommees en « X.data || [] »,
  // donc une panne de listing_config rendait une journee qui s'affiche
  // parfaitement et ne dit ou aller nulle part.
  assertEquals(donneesOuLeve({ data: [1, 2], error: null }, "listing_config"), [1, 2]);
  // Pas de donnees et pas d'erreur : une vraie liste vide, pas une panne.
  assertEquals(donneesOuLeve({ data: null, error: null }, "extra_cleanings"), []);
  let leve: Error | null = null;
  try {
    donneesOuLeve({ data: null, error: { message: "permission denied" } }, "listing_config");
  } catch (e) {
    leve = e as Error;
  }
  assertEquals(leve !== null, true);
  // Le nom de la lecture est dans le message : le catch global d'index.ts ne
  // journalise que l'erreur, et « permission denied » seul ne dit pas quelle table.
  assertEquals(String(leve).includes("listing_config"), true);
  assertEquals(String(leve).includes("permission denied"), true);
});
