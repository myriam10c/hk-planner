import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { _resetInflightForTests, loadReservationsCached, normalizeReservations } from "./insp_reservations.ts";

Deno.test("normalise, dedoublonne, ignore l'incomplet", () => {
  _resetInflightForTests();
  const raw = [
    { id: 1, listingMapId: 55, arrivalDate: "2026-10-01", departureDate: "2026-10-06", status: "confirmed", checkInTime: 15, checkOutTime: 0 },
    { id: 1, listingMapId: 55, arrivalDate: "2026-10-01", departureDate: "2026-10-06", status: "confirmed" },
    { id: 2, arrivalDate: "2026-10-01", departureDate: "2026-10-06", status: "confirmed" },
  ];
  assertEquals(normalizeReservations(raw), [
    { listingId: "55", arrival: "2026-10-01", departure: "2026-10-06", status: "confirmed", checkInTime: 15, checkOutTime: null },
  ]);
});

// --- cache au chaud (stale-while-revalidate) ---
const DAY = "2026-10-05";
const NOW = Date.parse("2026-10-05T10:00:00Z");
const minAgo = (m: number) => new Date(NOW - m * 60000).toISOString();
const R = (id: string) => ({ listingId: id, arrival: DAY, departure: "2026-10-07", status: "confirmed", checkInTime: null, checkOutTime: null });
const seed = (m: number | null) => fakeDb({ proxy_cache: m == null ? [] : [{ key: "insp:res:" + DAY, payload: { reservations: [R("old")] }, updated_at: minAgo(m) }] });
const cached = (sb: any) => sb.tables.proxy_cache.find((r: any) => r.key === "insp:res:" + DAY);

Deno.test("cache frais (< 2 min) : servi, aucun fetch", async () => {
  _resetInflightForTests();
  const sb = seed(1); let n = 0;
  const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => { n++; return [R("new")]; }, now: () => NOW, waitUntil: () => { n += 100; } });
  assertEquals(out, { reservations: [R("old")], cachedAt: null });
  assertEquals(n, 0);
});

Deno.test("cache de 5 min : servi tout de suite, revalidation en arriere-plan", async () => {
  _resetInflightForTests();
  const sb = seed(5); let n = 0; const ps: Promise<unknown>[] = [];
  const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => { n++; return [R("new")]; }, now: () => NOW, waitUntil: (p) => { ps.push(p); } });
  assertEquals(out, { reservations: [R("old")], cachedAt: null });
  assertEquals(ps.length, 1);
  await Promise.all(ps);
  assertEquals(n, 1);
  assertEquals(cached(sb).payload, { reservations: [R("new")] });
  assertEquals(cached(sb).updated_at, new Date(NOW).toISOString());
});

Deno.test("deux appels rapproches a 5 min : une seule revalidation en vol", async () => {
  _resetInflightForTests();
  const sb = seed(5); let n = 0; const ps: Promise<unknown>[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const deps = { fetchHostaway: async () => { n++; await gate; return [R("new")]; }, now: () => NOW, waitUntil: (p: Promise<unknown>) => { ps.push(p); } };
  await loadReservationsCached(sb, DAY, deps);
  await loadReservationsCached(sb, DAY, deps);
  release(); await Promise.all(ps);
  assertEquals(n, 1);
  // libere en finally : un nouvel appel (cache encore perime) relance
  const sb2 = seed(5);
  await loadReservationsCached(sb2, DAY, deps); await Promise.all(ps);
  assertEquals(n, 2);
});

Deno.test("cache sain de 2 h : servi, cachedAt null, une seule revalidation lancee", async () => {
  _resetInflightForTests();
  const sb = seed(120); const ps: Promise<unknown>[] = []; let n = 0;
  const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => { n++; return [R("new")]; }, now: () => NOW, waitUntil: (p) => { ps.push(p); } });
  assertEquals(out, { reservations: [R("old")], cachedAt: null });
  assertEquals(ps.length, 1);
  await Promise.all(ps);
  assertEquals(n, 1);
});

Deno.test("pas de cache : fetch synchrone puis upsert", async () => {
  _resetInflightForTests();
  const sb = seed(null);
  const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => [R("new")], now: () => NOW });
  assertEquals(out, { reservations: [R("new")], cachedAt: null });
  assertEquals(cached(sb).payload, { reservations: [R("new")] });
});

Deno.test("pas de cache + fetch en echec : erreur au message exact", async () => {
  _resetInflightForTests();
  const sb = seed(null);
  const err = console.error; console.error = () => {};
  try {
    await assertRejects(
      () => loadReservationsCached(sb, DAY, { fetchHostaway: async () => { throw new Error("boom"); }, now: () => NOW }),
      Error, "Bookings are unavailable right now. Try again in a few minutes.");
  } finally { console.error = err; }
});

Deno.test("revalidation en echec : marque failedAt sans toucher updated_at, bandeau puis effacement au succes", async () => {
  _resetInflightForTests();
  const sb = seed(5); const ps: Promise<unknown>[] = []; const logs: unknown[][] = [];
  const err = console.error; console.error = (...a: unknown[]) => { logs.push(a); };
  let fail = true;
  const deps = { fetchHostaway: async () => { if (fail) throw new Error("boom"); return [R("new")]; }, now: () => NOW, waitUntil: (p: Promise<unknown>) => { ps.push(p); } };
  try {
    const out = await loadReservationsCached(sb, DAY, deps);
    assertEquals(out, { reservations: [R("old")], cachedAt: null });
    await Promise.all(ps);
    assertEquals(logs.length, 1);
    assertEquals(cached(sb).updated_at, minAgo(5));
    assertEquals(cached(sb).payload.reservations, [R("old")]);
    assertEquals(typeof cached(sb).payload.failedAt, "string");
    // appel suivant : toujours servi, bandeau avec l'updated_at d'origine
    ps.length = 0;
    const out2 = await loadReservationsCached(sb, DAY, deps);
    assertEquals(out2, { reservations: [R("old")], cachedAt: minAgo(5) });
    // Hostaway revient : la revalidation reussit, le bandeau disparait
    fail = false;
    await Promise.all(ps); ps.length = 0;
    await loadReservationsCached(sb, DAY, deps);
    await Promise.all(ps);
    assertEquals(cached(sb).payload, { reservations: [R("new")] });
    const out3 = await loadReservationsCached(sb, DAY, deps);
    assertEquals(out3, { reservations: [R("new")], cachedAt: null });
  } finally { console.error = err; }
});

Deno.test("upsert en erreur dans la revalidation : console.error, pas d'exception", async () => {
  _resetInflightForTests();
  const sb = seed(5); const ps: Promise<unknown>[] = []; const logs: unknown[][] = [];
  sb.fail["proxy_cache.upsert"] = { message: "db down" };
  const err = console.error; console.error = (...a: unknown[]) => { logs.push(a); };
  try {
    await loadReservationsCached(sb, DAY, { fetchHostaway: async () => [R("new")], now: () => NOW, waitUntil: (p) => { ps.push(p); } });
    await Promise.all(ps);
  } finally { console.error = err; }
  assertEquals(logs.length, 1);
});

Deno.test("cacheKey : instantane separe, celui d'Inspections intact", async () => {
  _resetInflightForTests();
  const sb = seed(1);
  const out = await loadReservationsCached(sb, DAY, { cacheKey: "mgr:res:" + DAY, fetchHostaway: async () => [R("mgr")], now: () => NOW });
  assertEquals(out, { reservations: [R("mgr")], cachedAt: null });
  assertEquals(cached(sb).payload, { reservations: [R("old")] });
  assertEquals(sb.tables.proxy_cache.find((r: any) => r.key === "mgr:res:" + DAY).payload, { reservations: [R("mgr")] });
});
