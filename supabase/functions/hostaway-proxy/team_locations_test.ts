import { assert, assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { planningAccess } from "./mgr_rules.ts";
import { roleAllowed } from "./v3.ts";
import {
  buildLocations, haversineM, hostawayCoords, inLocationHours, loadLocationsSafe, locationNudge, locListings, mgrLocations,
  nearestListing, nudgePayload, nudgeTargets, parseLocation, readShareLocation, saveLocation, sharesLocation, stopLocation,
} from "./team_locations.ts";
import { APP_URL } from "./push.ts";

// 29/10/2026 10:00 Dubai = 06:00 UTC.
const NOW = Date.parse("2026-10-29T06:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const ME = { cleaner_id: 4, name: "Faiza", role: "cleaner", color: "#111" };
// Marina Gate et Damac Reva (coordonnees approchees), un logement sans position.
const LISTINGS = [
  { listing_id: "L1", internal_name: "1205 - Marina Gate", lat: 25.0866, lng: 55.1474 },
  { listing_id: "L2", internal_name: "103 - Damac Reva", lat: 25.1866, lng: 55.2610 },
  { listing_id: "L3", internal_name: "Villa sans gps", lat: null, lng: null },
];
const body = (o: any = {}) => ({ lat: 25.0866, lng: 55.1474, accuracy: 12, recordedAt: iso(NOW - 60_000), ...o });

Deno.test("haversine : zero, un degre de latitude, symetrie", () => {
  assertEquals(haversineM({ lat: 25, lng: 55 }, { lat: 25, lng: 55 }), 0);
  const d = haversineM({ lat: 25, lng: 55 }, { lat: 26, lng: 55 });
  assert(Math.abs(d - 111_195) < 10, String(d));
  const a = { lat: 25.0866, lng: 55.1474 }, b = { lat: 25.1866, lng: 55.2610 };
  assertEquals(Math.round(haversineM(a, b)), Math.round(haversineM(b, a)));
});

Deno.test("nearestListing : at sous 150 m, near au-dela, null sans logement", () => {
  const ls = locListings(LISTINGS);
  assertEquals(ls.map((l) => [l.listingId, l.label]), [["L1", "1205 · Marina Gate"], ["L2", "103 · Damac Reva"]]);
  // ~100 m au nord de L1.
  const at = nearestListing({ lat: 25.0875, lng: 55.1474 }, ls)!;
  assertEquals([at.kind, at.listingId, at.label], ["at", "L1", "1205 · Marina Gate"]);
  assert(at.distanceM >= 95 && at.distanceM <= 105, String(at.distanceM));
  // ~200 m : near, distance arrondie au metre.
  const near = nearestListing({ lat: 25.0884, lng: 55.1474 }, ls)!;
  assertEquals([near.kind, near.listingId], ["near", "L1"]);
  assertEquals(near.distanceM, Math.round(near.distanceM));
  assert(near.distanceM > 150 && near.distanceM < 210, String(near.distanceM));
  // Pile sur L2.
  assertEquals(nearestListing({ lat: 25.1866, lng: 55.2610 }, ls), { kind: "at", listingId: "L2", label: "103 · Damac Reva", distanceM: 0 });
  assertEquals(nearestListing({ lat: 25, lng: 55 }, []), null);
});

Deno.test("fenetre Dubai : 07:00 inclus, 23:00 exclu", () => {
  const at = (h: string) => Date.parse("2026-10-29T" + h + ":00Z"); // heure UTC
  assertEquals(inLocationHours(at("02:59")), false); // 06:59 Dubai
  assertEquals(inLocationHours(at("03:00")), true); // 07:00
  assertEquals(inLocationHours(at("18:59")), true); // 22:59
  assertEquals(inLocationHours(at("19:00")), false); // 23:00
  assertEquals(inLocationHours(at("22:00")), false); // 02:00
});

Deno.test("parseLocation : bornes, types, recordedAt", () => {
  assertEquals(parseLocation(body(), NOW), { ok: true, value: { lat: 25.0866, lng: 55.1474, accuracy: 12, recordedMs: NOW - 60_000 } });
  assertEquals((parseLocation(body({ accuracy: null }), NOW) as any).value.accuracy, null);
  assertEquals((parseLocation(body({ accuracy: undefined }), NOW) as any).value.accuracy, null);
  assertEquals((parseLocation(body({ accuracy: 0 }), NOW) as any).value.accuracy, 0);
  for (const bad of [
    { lat: 91 }, { lat: -90.1 }, { lng: 180.5 }, { lat: "25.1" }, { lng: null }, { lat: NaN }, { lng: Infinity },
    { accuracy: -1 }, { accuracy: "5" }, { recordedAt: "nope" }, { recordedAt: 12345 }, { recordedAt: undefined },
    { recordedAt: iso(NOW + 2 * 60_000 + 1000) }, { recordedAt: iso(NOW - 30 * 60_000 - 1000) },
  ]) assertEquals(parseLocation(body(bad), NOW).ok, false, JSON.stringify(bad));
  // Bornes exactes acceptees.
  assert(parseLocation(body({ lat: 90, lng: -180 }), NOW).ok);
  assert(parseLocation(body({ recordedAt: iso(NOW + 2 * 60_000) }), NOW).ok);
  assert(parseLocation(body({ recordedAt: iso(NOW - 30 * 60_000) }), NOW).ok);
  assertEquals(parseLocation(null, NOW).ok, false);
});

Deno.test("hostawayCoords : nombres finis seulement, rien sinon", () => {
  assertEquals(hostawayCoords({ lat: 25.08, lng: 55.14 }), { lat: 25.08, lng: 55.14 });
  assertEquals(hostawayCoords({ lat: "25.08", lng: "55.14" }), { lat: 25.08, lng: 55.14 });
  for (const l of [{}, { lat: null, lng: 55 }, { lat: "", lng: "" }, { lat: 0, lng: 0 }, { lat: 95, lng: 55 }, { lat: "x", lng: 1 }, null]) {
    assertEquals(hostawayCoords(l), {}, JSON.stringify(l));
  }
});

Deno.test("saveLocation : upsert sur l'id de session, jamais celui du corps", async () => {
  const db = fakeDb({ team_locations: [{ cleaner_id: 4, lat: 1, lng: 1, accuracy_m: null, recorded_at: iso(NOW - 3600_000) }] });
  const r = await saveLocation(db, ME, body({ cleaner_id: 99, cleanerId: 99 }), NOW);
  assertEquals(r, { status: 200, body: { ok: true, saved: true } });
  assertEquals(db.tables.team_locations.length, 1);
  const row = db.tables.team_locations[0];
  assertEquals([row.cleaner_id, row.lat, row.lng, row.accuracy_m, row.recorded_at, row.received_at],
    [4, 25.0866, 55.1474, 12, iso(NOW - 60_000), iso(NOW)]);
  // Puis la marque « turned off » effacee sur la ligne de la session.
  assertEquals(db.writes.map((w) => [w.table, w.op]), [["team_locations", "upsert"], ["cleaners", "update"]]);
  assertEquals(db.writes[1].values, { location_off_at: null });
});

Deno.test("saveLocation : location_off_at efface sur la personne de la session seulement", async () => {
  const off = iso(NOW - 3600_000);
  const db = fakeDb({ cleaners: [{ id: 4, share_location: true, location_off_at: off }, { id: 5, location_off_at: off }] });
  assertEquals((await saveLocation(db, ME, body(), NOW)).body.saved, true);
  assertEquals(db.tables.cleaners.map((c) => [c.id, c.location_off_at]), [[4, null], [5, off]]);
  // Ecriture ratee : la position reste enregistree (journalise seulement).
  const db2 = fakeDb({ cleaners: [{ id: 4, location_off_at: off }] });
  db2.fail["cleaners.update"] = { message: "column does not exist" };
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await saveLocation(db2, ME, body(), NOW), { status: 200, body: { ok: true, saved: true } });
  } finally {
    console.error = orig;
  }
  assertEquals(db2.tables.team_locations.length, 1);
  // Rien d'ecrit (hors fenetre) : la marque reste.
  const db3 = fakeDb({ cleaners: [{ id: 4, location_off_at: off }] });
  const night = Date.parse("2026-10-29T20:00:00Z");
  await saveLocation(db3, ME, body({ recordedAt: iso(night) }), night);
  assertEquals(db3.tables.cleaners[0].location_off_at, off);
});

Deno.test("stopLocation : efface la position de la session, pose location_off_at, 401 sans session", async () => {
  const db = fakeDb({
    cleaners: [{ id: 4, name: "Faiza" }, { id: 5, name: "Joe" }],
    team_locations: [
      { cleaner_id: 4, lat: 1, lng: 1, accuracy_m: null, recorded_at: iso(NOW - 60_000) },
      { cleaner_id: 5, lat: 1, lng: 1, accuracy_m: null, recorded_at: iso(NOW - 60_000) },
    ],
  });
  assertEquals(await stopLocation(db, ME, NOW), { status: 200, body: { ok: true } });
  assertEquals(db.tables.team_locations.map((l) => l.cleaner_id), [5]);
  assertEquals(db.tables.cleaners.map((c) => [c.id, c.location_off_at ?? null]), [[4, iso(NOW)], [5, null]]);
  // Hors fenetre aussi (minuit Dubai) : couper est toujours permis.
  const night = Date.parse("2026-10-29T20:00:00Z");
  assertEquals((await stopLocation(db, ME, night)).status, 200);
  assertEquals(db.tables.cleaners[0].location_off_at, iso(night));
  const db2 = fakeDb();
  assertEquals(await stopLocation(db2, null, NOW), { status: 401, body: { error: "auth required" } });
  assertEquals(db2.writes.length, 0);
});

Deno.test("stopLocation : erreurs d'ecriture, 500 lisible", async () => {
  const orig = console.error;
  console.error = () => {};
  try {
    const db = fakeDb({ cleaners: [{ id: 4 }] });
    db.fail["team_locations.delete"] = { message: "boom" };
    assertEquals(await stopLocation(db, ME, NOW), { status: 500, body: { error: "Location could not be turned off." } });
    assertEquals(db.tables.cleaners[0].location_off_at, undefined);
    const db2 = fakeDb({ cleaners: [{ id: 4 }] });
    db2.fail["cleaners.update"] = { message: "column does not exist" };
    assertEquals((await stopLocation(db2, ME, NOW)).status, 500);
  } finally {
    console.error = orig;
  }
});

Deno.test("saveLocation : hors fenetre rien n'est ecrit, 400 sur entree invalide, 401 sans session", async () => {
  const db = fakeDb();
  const night = Date.parse("2026-10-29T20:00:00Z"); // minuit Dubai
  assertEquals(await saveLocation(db, ME, body({ recordedAt: iso(night) }), night),
    { status: 200, body: { ok: true, saved: false, reason: "outside_hours" } });
  assertEquals((await saveLocation(db, ME, body({ lat: 200 }), NOW)).status, 400);
  assertEquals((await saveLocation(db, null, body(), NOW)).status, 401);
  assertEquals(db.writes.length, 0);
});

Deno.test("saveLocation : 0,0 refuse (400), rien n'est ecrit", async () => {
  const db = fakeDb();
  assertEquals(await saveLocation(db, ME, body({ lat: 0, lng: 0 }), NOW), { status: 400, body: { error: "invalid lat/lng" } });
  assertEquals(db.writes.length, 0);
  // Un seul des deux a zero reste une coordonnee valide.
  assertEquals((await saveLocation(fakeDb(), ME, body({ lat: 0, lng: 55.1 }), NOW)).status, 200);
});

Deno.test("saveLocation : precision au-dela de 2000 m ignoree, 2000 m acceptee", async () => {
  const db = fakeDb();
  assertEquals(await saveLocation(db, ME, body({ accuracy: 2000.5 }), NOW),
    { status: 200, body: { ok: true, saved: false, reason: "inaccurate" } });
  assertEquals(db.writes.length, 0);
  assertEquals(await saveLocation(db, ME, body({ accuracy: 2000 }), NOW), { status: 200, body: { ok: true, saved: true } });
  assertEquals(db.writes.map((w) => w.table), ["team_locations", "cleaners"]);
});

Deno.test("saveLocation : une position plus recente en base n'est jamais ecrasee", async () => {
  const newer = iso(NOW - 30_000);
  const db = fakeDb({ team_locations: [{ cleaner_id: 4, lat: 1, lng: 1, accuracy_m: 5, recorded_at: newer }] });
  assertEquals(await saveLocation(db, ME, body({ recordedAt: iso(NOW - 60_000) }), NOW),
    { status: 200, body: { ok: true, saved: false, reason: "older" } });
  assertEquals(db.writes.length, 0);
  assertEquals(db.tables.team_locations[0].recorded_at, newer);
  // Meme instant : ecrit (pas plus ancien).
  assertEquals((await saveLocation(db, ME, body({ recordedAt: newer }), NOW)).body.saved, true);
  // La ligne d'une autre personne ne compte pas.
  const db2 = fakeDb({ team_locations: [{ cleaner_id: 7, lat: 1, lng: 1, accuracy_m: 5, recorded_at: iso(NOW) }] });
  assertEquals((await saveLocation(db2, ME, body(), NOW)).body.saved, true);
  assertEquals(db2.tables.team_locations.length, 2);
});

Deno.test("saveLocation : erreur d'ecriture, 500 lisible", async () => {
  const db = fakeDb();
  db.fail["team_locations.upsert"] = { message: "boom" };
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await saveLocation(db, ME, body(), NOW), { status: 500, body: { error: "Location could not be saved." } });
  } finally {
    console.error = orig;
  }
});

Deno.test("saveLocation : share_location false, 200 not_shared et rien n'est ecrit", async () => {
  const db = fakeDb({
    cleaners: [{ id: 4, name: "Faiza", role: "cleaner", share_location: false }],
    team_locations: [{ cleaner_id: 9, lat: 1, lng: 1, accuracy_m: null, recorded_at: iso(NOW - 3600_000) }],
  });
  assertEquals(await saveLocation(db, ME, body(), NOW), { status: 200, body: { ok: true, saved: false, reason: "not_shared" } });
  // Avant la fenetre aussi : le choix passe en premier, le front s'arrete pour la page.
  const night = Date.parse("2026-10-29T20:00:00Z");
  assertEquals((await saveLocation(db, ME, body({ recordedAt: iso(night) }), night)).body.reason, "not_shared");
  assertEquals(db.writes.length, 0);
  assertEquals(db.tables.team_locations.length, 1);
  // true explicite, ou colonne absente (null) : ecrit.
  const db2 = fakeDb({ cleaners: [{ id: 4, share_location: true }] });
  assertEquals((await saveLocation(db2, ME, body(), NOW)).body.saved, true);
  const db3 = fakeDb({ cleaners: [{ id: 4 }] });
  assertEquals((await saveLocation(db3, ME, body(), NOW)).body.saved, true);
});

Deno.test("saveLocation : lecture du choix ratee, 500 et rien n'est ecrit", async () => {
  const db = fakeDb({ cleaners: [{ id: 4, share_location: true }] });
  db.fail["cleaners.select"] = { message: "column does not exist" };
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await saveLocation(db, ME, body(), NOW), { status: 500, body: { error: "Location could not be saved." } });
  } finally {
    console.error = orig;
  }
  assertEquals(db.writes.length, 0);
});

Deno.test("sharesLocation / readShareLocation : seul un false explicite coupe", async () => {
  assertEquals(sharesLocation(null), true);
  assertEquals(sharesLocation({}), true);
  assertEquals(sharesLocation({ share_location: true }), true);
  assertEquals(sharesLocation({ share_location: null }), true);
  assertEquals(sharesLocation({ share_location: false }), false);
  const db = fakeDb({ cleaners: [{ id: 4, share_location: false }, { id: 5, share_location: true }] });
  assertEquals(await readShareLocation(db, 4), false);
  assertEquals(await readShareLocation(db, 5), true);
  assertEquals(await readShareLocation(db, 77), true);
  db.fail["cleaners.select"] = { message: "boom" };
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await readShareLocation(db, 4), true);
  } finally {
    console.error = orig;
  }
});

const PEOPLE = [
  { id: 4, name: "Faiza", role: "cleaner", color: "#111", is_active: true },
  { id: 5, name: "Joe", role: "maintenance", color: "#222", is_active: true },
  { id: 8, name: "Walter", role: "manager", color: "#333", is_active: true },
  { id: 12, name: "Elite Cleaning", role: "subcontractor", color: "#444", is_active: true },
  { id: 6, name: "Medini CEO Agent", role: "system", color: "#555", is_active: true },
  { id: 99, name: "Gone", role: "cleaner", color: "#666", is_active: false },
  { id: 3, name: "Amir", role: "cleaner", color: "#777", is_active: true },
];
const LOCS = [
  { cleaner_id: 4, lat: 25.0875, lng: 55.1474, accuracy_m: 15, recorded_at: iso(NOW - 4 * 60_000 - 30_000) },
  { cleaner_id: 5, lat: 25.1700, lng: 55.2610, accuracy_m: null, recorded_at: iso(NOW - 45 * 60_000) },
  { cleaner_id: 12, lat: 25.1, lng: 55.2, accuracy_m: 5, recorded_at: iso(NOW) },
  { cleaner_id: 99, lat: 25.1, lng: 55.2, accuracy_m: 5, recorded_at: iso(NOW) },
];

Deno.test("buildLocations : actifs hors system et sous-traitants, plus recents d'abord, forme", () => {
  const out = buildLocations(PEOPLE, LOCS, locListings(LISTINGS), NOW);
  assertEquals(out.map((p) => p.id), [4, 5, 3, 8]);
  const faiza = out[0];
  assertEquals(Object.keys(faiza).sort(), ["color", "id", "location", "name", "offAt", "role"]);
  assertEquals(faiza.offAt, null);
  assertEquals([faiza.name, faiza.role, faiza.color], ["Faiza", "cleaner", "#111"]);
  const l = faiza.location!;
  assertEquals(Object.keys(l).sort(), ["accuracy", "ageMin", "lat", "lng", "place", "recordedAt"]);
  assertEquals([l.lat, l.lng, l.accuracy, l.ageMin, l.recordedAt], [25.0875, 55.1474, 15, 4, iso(NOW - 270_000)]);
  assertEquals([l.place!.kind, l.place!.listingId, l.place!.label], ["at", "L1", "1205 · Marina Gate"]);
  const joe = out[1].location!;
  assertEquals([joe.accuracy, joe.ageMin, joe.place!.kind, joe.place!.label], [null, 45, "near", "103 · Damac Reva"]);
  assert(joe.place!.distanceM > 1500 && joe.place!.distanceM < 2000, String(joe.place!.distanceM));
  // Sans position : null, tries par nom.
  assertEquals(out.slice(2).map((p) => [p.name, p.location]), [["Amir", null], ["Walter", null]]);
});

Deno.test("buildLocations : aucun logement geolocalise, place null ; age jamais negatif", () => {
  const out = buildLocations(PEOPLE, [{ ...LOCS[0], recorded_at: iso(NOW + 60_000) }], [], NOW);
  assertEquals(out[0].location!.place, null);
  assertEquals(out[0].location!.ageMin, 0);
});

const seed = () => fakeDb({ cleaners: PEOPLE, team_locations: LOCS, listing_config: LISTINGS });

Deno.test("mgrLocations : 200 avec generatedAt et people", async () => {
  const r = await mgrLocations(seed(), NOW);
  assertEquals(r.status, 200);
  assertEquals(r.body.generatedAt, iso(NOW));
  assertEquals(r.body.people.map((p: any) => p.id), [4, 5, 3, 8]);
  assertEquals(r.body.people[0].location.place.label, "1205 · Marina Gate");
});

Deno.test("mgrLocations et mgr.today : share_location false exclu, meme avec une position en base", async () => {
  const people = PEOPLE.map((p) => p.id === 8 || p.id === 4 ? { ...p, share_location: false } : p);
  const locs = [...LOCS, { cleaner_id: 8, lat: 25.1, lng: 55.2, accuracy_m: 5, recorded_at: iso(NOW) }];
  const db = fakeDb({ cleaners: people, team_locations: locs, listing_config: LISTINGS });
  const r = await mgrLocations(db, NOW);
  assertEquals(r.status, 200);
  assertEquals(r.body.people.map((p: any) => p.id), [5, 3]);
  // Bloc locations de mgr.today : meme liste.
  assertEquals((await loadLocationsSafe(db, NOW))!.map((p) => p.id), [5, 3]);
  // Pur : un true explicite reste montre.
  assertEquals(buildLocations([{ ...PEOPLE[0], share_location: true }], [], [], NOW).map((p) => p.id), [4]);
});

Deno.test("mgrLocations : lecture ratee, 503 ; loadLocationsSafe rend null", async () => {
  const db = seed();
  db.fail["team_locations.select"] = { message: "relation does not exist" };
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await mgrLocations(db, NOW), { status: 503, body: { error: "Locations are unavailable right now. Try again." } });
    assertEquals(await loadLocationsSafe(db, NOW), null);
  } finally {
    console.error = orig;
  }
});

Deno.test("acces : ecriture cleaner, maintenance, manager ; lecture managers et maintenance", () => {
  for (const r of ["cleaner", "maintenance", "manager"]) assertEquals(roleAllowed("v3.saveLocation", r), true, r);
  for (const r of ["subcontractor", "system", ""]) assertEquals(roleAllowed("v3.saveLocation", r), false, r);
  for (const r of ["cleaner", "maintenance", "manager"]) assertEquals(roleAllowed("v3.stopLocation", r), true, r);
  for (const r of ["subcontractor", "system", ""]) assertEquals(roleAllowed("v3.stopLocation", r), false, r);
  assertEquals(planningAccess(true, { role: "manager" }), { ok: true });
  assertEquals(planningAccess(true, { role: "maintenance" }), { ok: true });
  assertEquals(planningAccess(true, { role: "cleaner" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(planningAccess(false, { role: "manager" }), { ok: false, status: 403, error: "email sign-in required" });
});

Deno.test("buildLocations et mgrLocations : offAt en ISO (ou null), meme sans position", async () => {
  const off = "2026-10-29T10:02:00+00:00";
  const people = PEOPLE.map((p) => p.id === 3 ? { ...p, location_off_at: off } : p.id === 8 ? { ...p, location_off_at: "nope" } : p);
  const out = buildLocations(people, LOCS, [], NOW);
  assertEquals(out.map((p) => [p.id, p.offAt]), [[4, null], [5, null], [3, "2026-10-29T10:02:00.000Z"], [8, null]]);
  assertEquals(out.find((p) => p.id === 3)!.location, null);
  const db = fakeDb({ cleaners: people, team_locations: LOCS, listing_config: LISTINGS });
  const r = await mgrLocations(db, NOW);
  assertEquals(r.body.people.find((p: any) => p.id === 3).offAt, "2026-10-29T10:02:00.000Z");
  // Bloc locations de mgr.today : meme champ.
  assertEquals((await loadLocationsSafe(db, NOW))!.find((p) => p.id === 3)!.offAt, "2026-10-29T10:02:00.000Z");
});

// Relance : 10:00 Dubai (hors heures de silence). Faiza a une position de 30 min, Joe de 3 h.
const NUDGE_PEOPLE = [
  ...PEOPLE,
  { id: 13, name: "Annet", role: "cleaner", color: "#888", is_active: true, location_off_at: iso(NOW - 3600_000) },
  { id: 14, name: "Rahma", role: "cleaner", color: "#999", is_active: true, share_location: false },
];
const NUDGE_LOCS = [
  { cleaner_id: 4, recorded_at: iso(NOW - 30 * 60_000) },
  { cleaner_id: 5, recorded_at: iso(NOW - 3 * 3600_000) },
  { cleaner_id: 12, recorded_at: iso(NOW) },
];

Deno.test("nudgeTargets : actifs, partage permis, roles cleaner/maintenance/manager, sans position de moins de 2 h", () => {
  const { targets, skipped } = nudgeTargets(NUDGE_PEOPLE, NUDGE_LOCS, NOW);
  // Sous-traitant, system, inactif et share_location false exclus ; Annet (coupe elle-meme) relancee.
  assertEquals(targets.map((p) => p.name), ["Amir", "Annet", "Joe", "Walter"]);
  assertEquals(skipped.map((p) => p.name), ["Faiza"]);
  // Pile 2 h : plus fraiche, relancee.
  const t2 = nudgeTargets([PEOPLE[0]], [{ cleaner_id: 4, recorded_at: iso(NOW - 2 * 3600_000) }], NOW);
  assertEquals(t2.targets.map((p) => p.id), [4]);
});

Deno.test("nudgePayload : texte, url de l'app racine (cleaner) ou /manager/", () => {
  assertEquals(nudgePayload("cleaner"), {
    title: "Turn on your location",
    body: "Open HK Planner and tap Location ON so your manager can organise the day.",
    url: APP_URL + "/", tag: "loc-nudge",
  });
  assertEquals(nudgePayload("manager").url, APP_URL + "/manager/");
  assertEquals(nudgePayload("maintenance").url, APP_URL + "/manager/");
  assert(!/\u2014/.test(JSON.stringify(nudgePayload("cleaner"))));
});

Deno.test("locationNudge : envoie a chaque cible, sent / noPush / skipped par nom", async () => {
  const db = fakeDb({ cleaners: NUDGE_PEOPLE, team_locations: NUDGE_LOCS });
  const calls: any[] = [];
  const send = async (id: number, payload: any) => {
    calls.push([id, payload.url]);
    // Joe : aucun abonnement ; Walter : seul abonnement disparu (desactive par sendPush).
    if (id === 5) return { sent: 0, pruned: 0, skipped: "no_subscription" };
    if (id === 8) return { sent: 0, pruned: 1, skipped: null };
    return { sent: 1, pruned: 0, skipped: null };
  };
  const r = await locationNudge(db, NOW, send);
  assertEquals(r, { status: 200, body: { ok: true, sent: ["Amir", "Annet"], noPush: ["Joe", "Walter"], skipped: ["Faiza"] } });
  assertEquals(calls, [[3, APP_URL + "/"], [13, APP_URL + "/"], [5, APP_URL + "/manager/"], [8, APP_URL + "/manager/"]]);
  // Lecture seule cote base : la relance n'ecrit rien elle-meme.
  assertEquals(db.writes.length, 0);
});

Deno.test("locationNudge : heures de silence, rien ne part, 200 quiet_hours", async () => {
  let n = 0;
  const send = async () => { n++; return { sent: 1, pruned: 0, skipped: null }; };
  const db = fakeDb({ cleaners: NUDGE_PEOPLE, team_locations: [] });
  for (const h of ["18:00", "23:59", "04:29"]) { // 22:00, 03:59, 08:29 Dubai
    assertEquals(await locationNudge(db, Date.parse("2026-10-29T" + h + ":00Z"), send), { status: 200, body: { ok: false, reason: "quiet_hours" } });
  }
  assertEquals(n, 0);
  // 08:30 Dubai : envoye.
  assertEquals((await locationNudge(db, Date.parse("2026-10-29T04:30:00Z"), send)).body.ok, true);
  assert(n > 0);
});

Deno.test("locationNudge : lecture ratee, 503 et rien n'est envoye", async () => {
  const db = fakeDb({ cleaners: NUDGE_PEOPLE });
  db.fail["team_locations.select"] = { message: "boom" };
  let n = 0;
  const orig = console.error;
  console.error = () => {};
  try {
    const r = await locationNudge(db, NOW, async () => { n++; return { sent: 1, pruned: 0, skipped: null }; });
    assertEquals(r, { status: 503, body: { error: "Could not send the reminder right now. Try again." } });
  } finally {
    console.error = orig;
  }
  assertEquals(n, 0);
});

// index.ts n'est pas importable en test (Deno.serve) : assertions sur la source, comme mnt_routes_test.ts.
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
function bloc(action: string): string {
  const debut = src.indexOf(`if (action === "${action}"`);
  assert(debut >= 0, "handler absent pour " + action);
  const fin = src.indexOf("if (action ===", debut + 10);
  return src.slice(debut, fin < 0 ? undefined : fin);
}

Deno.test("routes : declarees, session, garde de role, identite de la session", () => {
  assert(src.includes('["v3.saveLocation", "POST"]'));
  assert(src.includes('["mgr.locations", "GET"]'));
  const w = bloc("v3.saveLocation");
  assert(w.indexOf("await currentUser(sb, req)") >= 0);
  assert(w.indexOf("roleAllowed(action, me.role)") > w.indexOf("await currentUser(sb, req)"));
  assert(w.includes("saveLocation(sb, me, body, Date.now())"));
  const r = bloc("mgr.locations");
  assert(r.indexOf("planningAccess(bearerToken(req) !== null, me)") > r.indexOf("await currentUser(sb, req)"));
  assert(r.includes("mgrLocations(sb, Date.now())"));
  // Bouton Location OFF : memes gardes que v3.saveLocation, identite de la session.
  assert(src.includes('["v3.stopLocation", "POST"]'));
  const off = bloc("v3.stopLocation");
  assert(off.indexOf("roleAllowed(action, me.role)") > off.indexOf("await currentUser(sb, req)"));
  assert(off.includes("stopLocation(sb, me, Date.now())"));
  // Relance : manager en session email ou secret serveur, envoi par sendPush.
  assert(src.includes('["mgr.locationNudge", "POST"]'));
  const n = bloc("mgr.locationNudge");
  assert(n.includes('req.headers.get("x-server-secret")'));
  assert(n.includes('SERVER_SHARED_SECRET !== "" && serverSecret === SERVER_SHARED_SECRET'));
  assert(n.indexOf("mgrAccess(bearerToken(req) !== null, me)") > n.indexOf("if (!isServer)"));
  assert(n.includes("locationNudge(sb, Date.now(), (id, payload) => sendPush(sb, id, payload))"));
  // shareLocation expose dans v3.myDay (hors View as) et cleanerMe.
  const d = bloc("v3.myDay");
  assert(d.includes("shareLocation: await readShareLocation(sb, me.cleaner_id)"));
  assert(d.indexOf("if (!vue.viewer)") >= 0);
  const c = bloc("cleanerMe");
  assert(c.includes('.select("email, share_location, is_owner")'));
  assert(c.includes("me.shareLocation = sharesLocation(emailRow)"));
  // syncListings ecrit lat/lng sur les deux branches.
  const s = bloc("syncListings");
  assertEquals(s.split("...coords").length - 1, 2);
});
