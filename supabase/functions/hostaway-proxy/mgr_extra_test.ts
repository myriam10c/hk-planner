import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { extraReservationKey, insertExtraOnce } from "./mgr_extra.ts";
import { keyDate } from "./mgr_rules.ts";

Deno.test("cle d'un extra : derivee de la cle d'idempotence, sinon aleatoire", () => {
  const k = extraReservationKey("2026-10-10", "mgr-0123456789abcdef0123456789abcdef", "r4nd0m00");
  assertEquals(k, "extra_2026-10-10_mcdef0123456789abcdef");
  assertEquals(keyDate(k), "2026-10-10");
  assertEquals(extraReservationKey("2026-10-10", "short", "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
  assertEquals(extraReservationKey("2026-10-10", undefined, "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
  assertEquals(extraReservationKey("2026-10-10", "bad key with spaces!!", "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
});

Deno.test("insertExtraOnce : le meme geste rejoue rend la ligne deja creee, sans doublon", async () => {
  const db = fakeDb({ extra_cleanings: [] });
  const row = { reservation_key: "extra_2026-10-10_mabc", listing_id: "L8", cleaning_date: "2026-10-10", status: "pending" };
  const a = await insertExtraOnce(db, row);
  assertEquals(a.replay, false);
  const b = await insertExtraOnce(db, { ...row, notes: "second try" });
  assertEquals(b.replay, true);
  assertEquals(b.row.id, a.row.id);
  assertEquals(db.tables.extra_cleanings.length, 1);
  const c = await insertExtraOnce(db, { ...row, reservation_key: "extra_2026-10-10_other" });
  assertEquals(c.replay, false);
  assertEquals(db.tables.extra_cleanings.length, 2);
});

Deno.test("insertExtraOnce : une autre erreur de la base remonte", async () => {
  const db = fakeDb({ extra_cleanings: [] });
  db.fail["extra_cleanings.insert"] = { code: "23503", message: "listing missing" };
  const e = await assertRejects(() => insertExtraOnce(db, { reservation_key: "extra_2026-10-10_x", listing_id: "L0" }));
  assert(String((e as any).message).includes("listing missing"));
});
