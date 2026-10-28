import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { v3PhotoLabel, v3PhotosForKey, v3PhotoType, v3PhotoUrl } from "./legacy_photos.ts";

const K = "2026-10-27_Hayden Murray";
const base = () => fakeDb({
  cleaners: [{ id: 10, name: "Pionah" }],
  v3_job_keys: [{ job_id: "job_a", reservation_key: K }, { job_id: "job_b", reservation_key: "2026-10-27_Other" }],
  photos: [
    { id: 1, job_id: "job_a", item_name: "arrival:Bed", storage_path: "v3/2026-10-27/1.jpg", kind: "photo", cleaner_id: 10, created_at: "2026-10-27T10:00:00Z" },
    { id: 2, job_id: "job_a", item_name: "end:Kitchen", storage_path: "v3/2026-10-27/2.jpg", kind: "photo", cleaner_id: 10, created_at: "2026-10-27T11:00:00Z" },
    { id: 3, job_id: "job_a", item_name: "problem:Stain", storage_path: "v3/2026-10-27/3.jpg", kind: "photo", cleaner_id: 10, created_at: "2026-10-27T10:05:00Z" },
    { id: 4, job_id: "job_b", item_name: "end:Bed", storage_path: "v3/2026-10-27/4.jpg", kind: "photo", cleaner_id: 10, created_at: "2026-10-27T12:00:00Z" },
  ],
});

Deno.test("type et libelle des photos v3", () => {
  assertEquals(v3PhotoType("arrival:Bed"), "before");
  assertEquals(v3PhotoType("end:Kitchen"), "after");
  assertEquals(v3PhotoType("problem:Stain"), "before");
  assertEquals(v3PhotoLabel("arrival:Bed"), "Arrival · Bed");
  assertEquals(v3PhotoLabel("end:Kitchen"), "Kitchen");
  assertEquals(v3PhotoLabel("problem:Stain"), "Problem · Stain");
});

Deno.test("v3PhotosForKey rend les photos du menage avec URL signee et auteur", async () => {
  const db = base();
  const out = await v3PhotosForKey(db, K);
  assertEquals(out.map((p) => p.id).sort(), ["v3-1", "v3-2", "v3-3"]);
  const end = out.find((p) => p.id === "v3-2");
  assertEquals(end.photo_type, "after");
  assertEquals(end.author, "Pionah");
  assertEquals(end.url, "https://signed.test/v3/2026-10-27/2.jpg?exp=3600");
  assertEquals(db.storage.signBatches.length, 1);
});

Deno.test("v3PhotosForKey : cle sans menage v3 -> vide, sans signature", async () => {
  const db = base();
  assertEquals(await v3PhotosForKey(db, "2026-10-20_Nobody"), []);
  assertEquals(db.storage.signBatches.length, 0);
});

Deno.test("v3PhotosForKey : signature en panne -> photos sans url", async () => {
  const db = base();
  db.fail["storage.sign"] = { message: "down" };
  const out = await v3PhotosForKey(db, K);
  assertEquals(out.length, 3);
  assertEquals(out.every((p) => p.url === null), true);
});

Deno.test("v3PhotoUrl signe une photo, null si inconnue", async () => {
  const db = base();
  assertEquals(await v3PhotoUrl(db, 2), "https://signed.test/v3/2026-10-27/2.jpg?exp=3600");
  assertEquals(await v3PhotoUrl(db, 99), null);
});
