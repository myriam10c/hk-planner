import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadReservationsCached, normalizeReservations } from "./insp_reservations.ts";

Deno.test("normalise, dedoublonne, ignore l'incomplet", () => {
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
  const sb = seed(1); let n = 0;
  const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => { n++; return [R("new")]; }, now: () => NOW, waitUntil: () => { n += 100; } });
  assertEquals(out, { reservations: [R("old")], cachedAt: null });
  assertEquals(n, 0);
});

Deno.test("cache de 5 min : servi tout de suite, revalidation en arriere-plan", async () => {
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

Deno.test("cache de 40 min : servi avec cachedAt = updated_at", async () => {
  const sb = seed(40); const ps: Promise<unknown>[] = [];
  const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => [R("new")], now: () => NOW, waitUntil: (p) => { ps.push(p); } });
  assertEquals(out, { reservations: [R("old")], cachedAt: minAgo(40) });
  await Promise.all(ps);
});

Deno.test("pas de cache : fetch synchrone puis upsert", async () => {
  const sb = seed(null);
  const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => [R("new")], now: () => NOW });
  assertEquals(out, { reservations: [R("new")], cachedAt: null });
  assertEquals(cached(sb).payload, { reservations: [R("new")] });
});

Deno.test("pas de cache + fetch en echec : erreur au message exact", async () => {
  const sb = seed(null);
  const err = console.error; console.error = () => {};
  try {
    await assertRejects(
      () => loadReservationsCached(sb, DAY, { fetchHostaway: async () => { throw new Error("boom"); }, now: () => NOW }),
      Error, "Bookings are unavailable right now. Try again in a few minutes.");
  } finally { console.error = err; }
});

Deno.test("revalidation en echec : pas d'exception, console.error, cache intact", async () => {
  const sb = seed(5); const ps: Promise<unknown>[] = []; const logs: unknown[][] = [];
  const err = console.error; console.error = (...a: unknown[]) => { logs.push(a); };
  try {
    const out = await loadReservationsCached(sb, DAY, { fetchHostaway: async () => { throw new Error("boom"); }, now: () => NOW, waitUntil: (p) => { ps.push(p); } });
    assertEquals(out.reservations, [R("old")]);
    await Promise.all(ps);
  } finally { console.error = err; }
  assertEquals(logs.length, 1);
  assertEquals(cached(sb).payload, { reservations: [R("old")] });
});
