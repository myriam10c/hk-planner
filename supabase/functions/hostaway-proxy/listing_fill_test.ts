import { assertEquals } from "jsr:@std/assert@1";
import { fillMissingListings } from "./listing_fill.ts";

function fakeSb(existing: string[]) {
  const rows = new Map<string, any>(existing.map((id) => [id, { listing_id: id, price: 999 }]));
  const writes: any[] = [];
  return {
    rows, writes,
    from: (_t: string) => ({
      select: (_c: string) => ({
        in: (_k: string, ids: string[]) => Promise.resolve({ data: ids.filter((i) => rows.has(i)).map((i) => ({ listing_id: i })), error: null }),
      }),
      upsert: (row: any, opts: any) => {
        writes.push({ row, opts });
        if (!rows.has(row.listing_id) || !opts.ignoreDuplicates) rows.set(row.listing_id, row);
        return Promise.resolve({ error: null });
      },
    }),
  };
}

Deno.test("fillMissingListings : ajoute seulement les logements absents, sans toucher aux fiches", async () => {
  const sb = fakeSb(["100"]);
  const fetched: string[] = [];
  const added = await fillMissingListings(sb, ["100", "200", "200", "", "abc"], async (id) => {
    fetched.push(id);
    return { id: Number(id), internalListingName: "1509 Westwood" };
  }, (l) => ({ listing_id: String(l.id), internal_name: l.internalListingName }));
  assertEquals(fetched, ["200"]);
  assertEquals(added, ["200"]);
  assertEquals(sb.rows.get("100").price, 999);
  assertEquals(sb.rows.get("200").internal_name, "1509 Westwood");
  assertEquals(sb.writes[0].opts, { onConflict: "listing_id", ignoreDuplicates: true });
});

Deno.test("fillMissingListings : rien a faire, aucun appel Hostaway", async () => {
  const sb = fakeSb(["100"]);
  let calls = 0;
  const added = await fillMissingListings(sb, ["100"], async () => { calls++; return null; }, (l) => l);
  assertEquals([added, calls], [[], 0]);
});

Deno.test("fillMissingListings : un logement introuvable sur Hostaway est ignore", async () => {
  const sb = fakeSb([]);
  const added = await fillMissingListings(sb, ["300"], async () => null, (l) => l);
  assertEquals([added, sb.writes.length], [[], 0]);
});
