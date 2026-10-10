import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrAccess } from "./mgr_rules.ts";
import { dubaiMonthBounds, mgrPeople, parsePeopleMonth } from "./mgr_people.ts";

const details = (n: number) => Array.from({ length: n }, (_, i) => ({
  cleaning_date: `2026-09-${String(i + 1).padStart(2, "0")}`, listing_id: i % 2 ? 22 : 11, guest: `G${i}`, cleanliness: 9,
}));
const seed = () => fakeDb({
  cleaner_ratings_cache: [{
    id: 1, computed_at: "2026-10-10T20:00:00Z", synced_at: "2026-10-10T20:05:00Z", unmatched_count: 3,
    payload_json: { cleaners: {
      "1": { enough_data: true, avg_cleanliness_all_time: 9.2, avg_cleanliness_90d: 9.5, count_all_time: 12, details: details(12) },
      "2": { enough_data: false, avg_cleanliness_all_time: 7, avg_cleanliness_90d: 7, count_all_time: 2, details: details(2) },
      "7": { enough_data: true, avg_cleanliness_all_time: 8.1, avg_cleanliness_90d: null, count_all_time: 6, details: [] },
      "3": { enough_data: true, avg_cleanliness_all_time: 10, avg_cleanliness_90d: 10, count_all_time: 9, details: [] },
      "99": { enough_data: true, avg_cleanliness_all_time: 5, avg_cleanliness_90d: 5, count_all_time: 8, details: [] },
    } },
  }],
  cleaners: [
    { id: 1, name: "Zara", color: "#111", role: "cleaner", is_active: true },
    { id: 2, name: "Amir", color: "#222", role: "cleaner", is_active: true },
    { id: 3, name: "Walter", color: "#333", role: "manager", is_active: true },
    { id: 7, name: "Old Bob", color: "#444", role: "cleaner", is_active: false },
  ],
  listing_config: [{ listing_id: 11, internal_name: "Studio Alpha", listing_name: "x" }, { listing_id: 22, internal_name: null, listing_name: "Beta Tower" }],
  cleaning_timer: [
    { reservation_key: "r1", cleaner_id: 1, started_at: "2026-10-05T06:00:00Z", duration_minutes: 40 },
    { reservation_key: "r2", cleaner_id: 1, started_at: "2026-10-06T06:00:00Z", duration_minutes: 60 },
  ],
  cleaning_assignments: [{ reservation_key: "r1", cleaner_id: 1 }, { reservation_key: "r2", cleaner_id: 1 }, { reservation_key: "r5", cleaner_id: 2 }],
  menage_done: [
    { reservation_key: "r1", done: true, updated_at: "2026-10-05T10:00:00Z" },
    { reservation_key: "r2", done: true, updated_at: "2026-10-06T10:00:00Z" },
    { reservation_key: "r5", done: true, updated_at: "2026-10-07T10:00:00Z" },
  ],
});

Deno.test("mgr.people: forme, tri, managers exclus, inactifs nommes", async () => {
  const r = await mgrPeople(seed(), "2026-10");
  assertEquals(r.month, "2026-10");
  assertEquals([r.ratings.computedAt, r.ratings.syncedAt, r.ratings.unmatched],
    ["2026-10-10T20:00:00Z", "2026-10-10T20:05:00Z", 3]);
  // Walter (manager) absent ; tri par moyenne desc, sans assez de donnees en dernier.
  assertEquals(r.ratings.people.map((p) => p.id), [1, 7, 99, 2]);
  const bob = r.ratings.people.find((p) => p.id === 7)!;
  assertEquals([bob.name, bob.role, bob.avg90, bob.avgAll], ["Old Bob", "cleaner", null, 8.1]);
  assertEquals(r.ratings.people.find((p) => p.id === 99)!.name, "Cleaner #99");
  const z = r.ratings.people[0];
  assertEquals(Object.keys(z).sort(), ["avg90", "avgAll", "count", "enoughData", "id", "name", "recent", "role"]);
  assertEquals([z.avgAll, z.avg90, z.count, z.enoughData], [9.2, 9.5, 12, true]);
});

Deno.test("mgr.people: pas assez de donnees = moyennes null, recent 10 trie desc avec nom de logement", async () => {
  const r = await mgrPeople(seed(), "2026-10");
  const amir = r.ratings.people.find((p) => p.id === 2)!;
  assertEquals([amir.enoughData, amir.avgAll, amir.avg90, amir.count], [false, null, null, 2]);
  const z = r.ratings.people.find((p) => p.id === 1)!;
  assertEquals(z.recent.length, 10);
  assertEquals(z.recent[0], { date: "2026-09-12", listingName: "Beta Tower", guest: "G11", score: 9 });
  assertEquals(z.recent[1].listingName, "Studio Alpha");
});

Deno.test("mgr.people: performance du mois (minutes, null sans chrono)", async () => {
  const r = await mgrPeople(seed(), "2026-10");
  assertEquals(r.performance.map((p) => p.id), [1, 2]);
  assertEquals(r.performance[0], { id: 1, name: "Zara", role: "cleaner", cleanings: 2, avgMinutes: 50, fastest: 40, slowest: 60, timed: 2 });
  assertEquals(r.performance[1], { id: 2, name: "Amir", role: "cleaner", cleanings: 1, avgMinutes: null, fastest: null, slowest: null, timed: 0 });
  const sep = await mgrPeople(seed(), "2026-09");
  assertEquals(sep.performance.map((p) => p.cleanings), [0, 0]);
});

Deno.test("mgr.people: sans snapshot de notes", async () => {
  const db = fakeDb({ cleaners: [{ id: 1, name: "Zara", color: "", role: "cleaner", is_active: true }] });
  const r = await mgrPeople(db, "2026-10");
  assertEquals(r.ratings, { computedAt: null, syncedAt: null, unmatched: 0, people: [] });
});

Deno.test("mgr.people: erreur de lecture remontee", async () => {
  const db = seed();
  db.fail["cleaner_ratings_cache.select"] = { message: "boom" };
  await assertRejects(() => mgrPeople(db, "2026-10"));
});

Deno.test("mgr.people: validation du mois", () => {
  assertEquals(parsePeopleMonth(null, "2026-10-11"), { ok: true, month: "2026-10" });
  assertEquals(parsePeopleMonth("2026-03", "2026-10-11"), { ok: true, month: "2026-03" });
  for (const bad of ["2026-13", "2026-1", "abc", "2026-00", "2026-10-01"]) {
    assertEquals(parsePeopleMonth(bad, "2026-10-11"), { ok: false, error: "month must be YYYY-MM" });
  }
});

Deno.test("mgr.people: acces manager seulement", () => {
  assert(!mgrAccess(false, null).ok);
  assert(!mgrAccess(true, { role: "cleaner" } as any).ok);
});

Deno.test("mgr.people: bornes UTC d'un mois de Dubai", () => {
  assertEquals(dubaiMonthBounds("2026-10"), { from: "2026-09-30T20:00:00.000Z", to: "2026-10-31T20:00:00.000Z" });
  assertEquals(dubaiMonthBounds("2026-12").to, "2026-12-31T20:00:00.000Z");
});

Deno.test("mgr.people: un mois de plus d'une page est lu en entier", async () => {
  const timers: any[] = [];
  const assignments: any[] = [];
  const dones: any[] = [];
  for (let i = 0; i < 2300; i++) {
    const k = "k" + String(i).padStart(5, "0");
    timers.push({ reservation_key: k, cleaner_id: 1, started_at: "2026-08-10T06:00:00Z", duration_minutes: 30 });
    dones.push({ reservation_key: k, done: true, updated_at: "2026-08-10T07:00:00Z" });
    assignments.push({ reservation_key: k, cleaner_id: 1 });
  }
  // Hors mois : ne doit pas compter.
  timers.push({ reservation_key: "out", cleaner_id: 1, started_at: "2026-09-02T06:00:00Z", duration_minutes: 99 });
  assignments.push({ reservation_key: "out", cleaner_id: 1 });
  const db = fakeDb({
    cleaners: [{ id: 1, name: "Zara", role: "cleaner", is_active: true }],
    cleaning_timer: timers, menage_done: dones, cleaning_assignments: assignments,
  }, { maxRows: 1000, honorOrder: true });
  const r = await mgrPeople(db, "2026-08");
  assertEquals(r.performance[0].cleanings, 2300);
  assertEquals([r.performance[0].timed, r.performance[0].avgMinutes], [2300, 30]);
});

Deno.test("mgr.people: erreur de lecture des stats = exception, jamais des zeros", async () => {
  for (const t of ["cleaning_timer.select", "menage_done.select", "cleaning_assignments.select"]) {
    const db = seed();
    db.fail[t] = { message: "boom" };
    await assertRejects(() => mgrPeople(db, "2026-10"));
  }
});

Deno.test("mgr.people: un cleaner inactif aujourd'hui garde ses chiffres du mois", async () => {
  const db = seed();
  // Bob (7, inactif) a travaille en octobre.
  db.writes.length = 0;
  await db.from("cleaning_assignments").insert({ reservation_key: "rb", cleaner_id: 7 });
  await db.from("cleaning_timer").insert({ reservation_key: "rb", cleaner_id: 7, started_at: "2026-10-08T06:00:00Z", duration_minutes: 20 });
  const r = await mgrPeople(db, "2026-10");
  const bob = r.performance.find((p) => p.id === 7)!;
  assertEquals([bob.name, bob.timed, bob.avgMinutes], ["Old Bob", 1, 20]);
  // Sans activite ce mois-la, un inactif n'apparait pas.
  const sep = await mgrPeople(seed(), "2026-09");
  assert(!sep.performance.some((p) => p.id === 7));
});
