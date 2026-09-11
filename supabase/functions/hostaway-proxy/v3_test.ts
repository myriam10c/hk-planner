import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import {
  estimatedMinutes, formatHour, managerIds, normalizeUnitType, onDutyTechnician,
  pickSnapshot, plusDays, readLinen, roleAllowed, shortGuest, templateItems,
  todayDubai, v3Log, validIdem, V3_CACHE_STALE_MS, V3_CATEGORIES,
  V3_LINEN_FIELDS, V3_PHOTO_BUCKET, V3_ROLES, V3_TEMPLATE_NAME, weekKeyFor,
} from "./v3.ts";
import { buildMyDay, orderStops } from "./v3_myday.ts";

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

// ===========================================================================
// v3.myDay
// ===========================================================================

// Jeu d'essai calque sur la vraie semaine du 11 au 17 septembre 2026 (notes UX,
// section 2) : un same-day a 15:00, un arret a arrivee plus tardive, un arret
// sans guest a venir.
function jeuDEssai() {
  return {
    date: "2026-09-12",
    me: { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" },
    reservations: [
      {
        listingId: "101", listing: "704 Golf Links", guest: "Sofia Marchetti",
        checkOut: "2026-09-12", checkOutTime: 11, nextGuest: null,
      },
      {
        listingId: "102", listing: "623 Samana Park View", guest: "Marc Lefevre",
        checkOut: "2026-09-12", checkOutTime: 12,
        nextGuest: { guest: "Anna Weber", date: "2026-09-12", checkInTime: 15, sameDay: true },
      },
      {
        listingId: "103", listing: "122 Oxford Boulevard", guest: "Yuki Tanaka",
        checkOut: "2026-09-12", checkOutTime: 10,
        nextGuest: { guest: "Omar Said", date: "2026-09-13", checkInTime: 14, sameDay: false },
      },
      {
        listingId: "104", listing: "506 Act One", guest: "Pas A Moi",
        checkOut: "2026-09-12", checkOutTime: 12, nextGuest: null,
      },
    ],
    extras: [],
    listings: {
      "101": { listing_id: "101", listing_name: "704 Golf Links", bedrooms: 0, unit_type: "Studio", apt_number: "704" },
      "102": { listing_id: "102", listing_name: "623 Samana Park View", bedrooms: 1, unit_type: "1 BHK", apt_number: "623" },
      "103": { listing_id: "103", listing_name: "122 Oxford Boulevard", bedrooms: 0, unit_type: "Studio", apt_number: "122" },
      "104": { listing_id: "104", listing_name: "506 Act One", bedrooms: 2, unit_type: "2 BHK", apt_number: "506" },
    },
    templates: [
      { name: "Studio", items: ["Living Room", "Bathroom"], photo_required_items: [] },
      { name: "1 Bedroom", items: ["Master Bed & Linens", "Bathroom", "Final Check"], photo_required_items: [] },
      { name: "2 Bedrooms", items: ["Master Bed & Linens", "Second Bedroom"], photo_required_items: [] },
    ],
    assignedKeys: [
      "2026-09-12_Sofia Marchetti",
      "2026-09-12_Marc Lefevre",
      "2026-09-12_Yuki Tanaka",
    ],
    postponed: {},
    cancelled: [],
    done: [],
    timers: {},
    tickets: [
      { id: 71, listing_id: "102", title: "Photo of the DEWA bill", category: "general", priority: "urgent", status: "open" },
      { id: 72, listing_id: "102", title: "AC turning off", category: "ac", priority: "high", status: "to_confirm" },
      { id: 73, listing_id: "999", title: "Ailleurs", category: "ac", priority: "high", status: "open" },
    ],
    progress: {},
  };
}

Deno.test("buildMyDay ne rend que les menages assignes a la personne connectee", () => {
  const out = buildMyDay(jeuDEssai() as any);
  assertEquals(out.stops.length, 3);
  assertEquals(out.stops.some((s) => s.listingName === "506 Act One"), false);
});

Deno.test("buildMyDay ordonne same-day, puis arrivee, puis checkout", () => {
  const out = buildMyDay(jeuDEssai() as any);
  assertEquals(out.stops.map((s) => s.listingName), [
    "623 Samana Park View", // same-day 15:00
    "122 Oxford Boulevard", // prochaine arrivee le 13 a 14:00
    "704 Golf Links",       // aucune arrivee connue, checkout 11:00
  ]);
});

Deno.test("buildMyDay calcule le volume sur la mediane par type", () => {
  const out = buildMyDay(jeuDEssai() as any);
  // 1 BHK 118 + Studio 94 + Studio 94
  assertEquals(out.totalMinutes, 306);
  assertEquals(out.stops[0].estimatedMinutes, 118);
  assertEquals(out.stops[0].unitType, "1 BHK");
  assertEquals(out.stops[0].templateName, "1 Bedroom");
  assertEquals(out.stops[0].checklist.length, 3);
});

Deno.test("buildMyDay n'expose jamais un nom de guest complet", () => {
  const out = buildMyDay(jeuDEssai() as any);
  const rendu = JSON.stringify(out.stops.map((s) => ({ ...s, jobId: "" })));
  assertEquals(rendu.includes("Marc Lefevre"), false);
  assertEquals(rendu.includes("Anna Weber"), false);
  assertEquals(out.stops[0].guest, "Marc L.");
  assertEquals(out.stops[0].nextGuest, "Anna W.");
});

Deno.test("buildMyDay attache les tickets ouverts du logement, sans les to_confirm", () => {
  const out = buildMyDay(jeuDEssai() as any);
  assertEquals(out.stops[0].openTickets.map((t) => t.id), [71]);
  assertEquals(out.stops[1].openTickets.length, 0);
});

Deno.test("buildMyDay respecte les reports, les annulations et l'etat du chrono", () => {
  const base = jeuDEssai() as any;
  base.postponed = { "2026-09-12_Yuki Tanaka": "2026-09-14" };
  base.cancelled = ["2026-09-12_Sofia Marchetti"];
  base.timers = { "2026-09-12_Marc Lefevre": { started_at: "2026-09-12T08:00:00Z", finished_at: null } };
  const out = buildMyDay(base);
  assertEquals(out.stops.length, 1);
  assertEquals(out.stops[0].listingName, "623 Samana Park View");
  assertEquals(out.stops[0].state, "running");
  assertEquals(out.stops[0].startedAt, "2026-09-12T08:00:00Z");
});

Deno.test("buildMyDay prend les menages hors Hostaway du jour", () => {
  const base = jeuDEssai() as any;
  base.assignedKeys = ["extra_2026-09-12_ab12cd34"];
  base.extras = [{
    reservation_key: "extra_2026-09-12_ab12cd34", listing_id: "104",
    cleaning_date: "2026-09-12", label: "Deep clean", guest_name: null,
  }];
  const out = buildMyDay(base);
  assertEquals(out.stops.length, 1);
  assertEquals(out.stops[0].listingName, "506 Act One");
  assertEquals(out.stops[0].unitType, "2 BHK");
  assertEquals(out.stops[0].estimatedMinutes, 165);
  assertEquals(out.stops[0].sameDay, false);
});

Deno.test("buildMyDay dit si le linge est demande (jamais pour un sous-traitant)", () => {
  const interne = buildMyDay(jeuDEssai() as any);
  assertEquals(interne.linenRequired, true);
  const elite = jeuDEssai() as any;
  elite.me = { cleaner_id: 9, name: "Elite Cleaning", role: "subcontractor", color: "#000000" };
  assertEquals(buildMyDay(elite).linenRequired, false);
});

Deno.test("orderStops range un arret sans heure apres ceux qui en ont une", () => {
  const s = (o: any) => ({ sameDay: false, nextArrivalTime: null, checkOutTime: null, listingName: "z", ...o });
  const out = orderStops([
    s({ listingName: "sans heure" }),
    s({ listingName: "arrivee 14", nextArrivalTime: "14:00" }),
    s({ listingName: "same-day", sameDay: true, nextArrivalTime: "17:00" }),
    s({ listingName: "checkout 10", checkOutTime: "10:00" }),
  ] as any);
  assertEquals(out.map((x: any) => x.listingName),
    ["same-day", "arrivee 14", "checkout 10", "sans heure"]);
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
