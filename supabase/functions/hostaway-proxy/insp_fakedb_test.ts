import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";

Deno.test("fakeDb filtre gte/lt et is null", async () => {
  const db = fakeDb({ t: [
    { id: 1, d: "2026-10-01", f: null }, { id: 2, d: "2026-10-05", f: "x" }, { id: 3, d: "2026-10-09", f: null },
  ] });
  const { data } = await db.from("t").select("*").gte("d", "2026-10-02").lt("d", "2026-10-10");
  assertEquals(data.map((r: any) => r.id), [2, 3]);
  const { data: n } = await db.from("t").select("*").is("f", null);
  assertEquals(n.map((r: any) => r.id), [1, 3]);
});

Deno.test("fakeDb unicite inspection_items (inspection_id, zone)", async () => {
  const db = fakeDb();
  await db.from("inspection_items").insert({ inspection_id: 1, zone: "ac", status: "ok" });
  const { error } = await db.from("inspection_items").insert({ inspection_id: 1, zone: "ac", status: "ok" });
  assertEquals(error?.code, "23505");
});
