import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { uploadPhoto, V3_MAX_PHOTO_BYTES } from "./v3_tickets.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const JOB = "2026-09-12_Marc Lefevre";

function formulaire(champs: Record<string, string>, octets = 64, type = "image/jpeg") {
  const form = new FormData();
  for (const [k, v] of Object.entries(champs)) form.set(k, v);
  form.set("file", new Blob([new Uint8Array(octets)], { type }), "photo.jpg");
  return form;
}

Deno.test("uploadPhoto depose dans le bucket prive et insere la ligne photos", async () => {
  const sb = fakeDb({ job_events: [], photos: [] });
  const r = await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0001", jobId: JOB }));
  assertEquals(r.status, 200);
  const corps = r.body as any;
  assertEquals(typeof corps.photoId, "number");
  assertEquals(sb.storage.uploads.length, 1);
  assertEquals(sb.storage.uploads[0].bucket, "cleaning-photos");
  assertEquals(sb.storage.uploads[0].contentType, "image/jpeg");
  assertEquals(sb.tables.photos.length, 1);
  assertEquals(sb.tables.photos[0].job_id, JOB);
  assertEquals(sb.tables.photos[0].cleaner_id, 3);
});

Deno.test("le chemin de stockage ne contient jamais le nom du guest", async () => {
  const sb = fakeDb({ job_events: [], photos: [] });
  const r = await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0002", jobId: JOB }));
  const chemin = (r.body as any).path as string;
  assertEquals(chemin.startsWith("v3/"), true);
  assertEquals(chemin.includes("Marc"), false);
  assertEquals(chemin.includes("Lefevre"), false);
  assertEquals(chemin.endsWith(".jpg"), true);
});

Deno.test("uploadPhoto est idempotent : meme cle, meme photoId, un seul depot", async () => {
  const sb = fakeDb({ job_events: [], photos: [] });
  const form1 = formulaire({ idem: "idem-photo-0003", jobId: JOB });
  const form2 = formulaire({ idem: "idem-photo-0003", jobId: JOB });
  const un = await uploadPhoto(sb, FAIZA as any, form1);
  const deux = await uploadPhoto(sb, FAIZA as any, form2);
  assertEquals((deux.body as any).photoId, (un.body as any).photoId);
  assertEquals(sb.storage.uploads.length, 1);
  assertEquals(sb.tables.photos.length, 1);
});

// Ruling du controleur (revue de la tache 2, applique par la tache 4) : un rejeu
// dont l'ecriture metier n'a jamais abouti ne rend JAMAIS un succes fabrique.
// Sans ce 409 le telephone effacerait de sa file une photo jamais deposee.
Deno.test("uploadPhoto rend 409 quand la cle est posee sans resultat", async () => {
  const sb = fakeDb({
    job_events: [{
      id: 1, idem_key: "idem-photo-0009", event_type: "upload_photo", job_id: JOB,
      cleaner_id: 3, payload: {}, result: null, created_at: "2026-09-12T06:00:00Z",
    }],
    photos: [],
  });
  const r = await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0009", jobId: JOB }));
  assertEquals(r.status, 409);
  assertEquals((r.body as any).error, "Still processing. Retry.");
  assertEquals(sb.storage.uploads.length, 0);
  assertEquals(sb.tables.photos.length, 0);
  assertEquals(sb.tables.job_events.length, 1);
});

Deno.test("uploadPhoto refuse un type non image et un fichier trop gros", async () => {
  const sb = fakeDb({ job_events: [], photos: [] });
  const pdf = await uploadPhoto(sb, FAIZA as any,
    formulaire({ idem: "idem-photo-0004", jobId: JOB }, 64, "application/pdf"));
  assertEquals(pdf.status, 400);
  const gros = await uploadPhoto(sb, FAIZA as any,
    formulaire({ idem: "idem-photo-0005", jobId: JOB }, V3_MAX_PHOTO_BYTES + 1));
  assertEquals(gros.status, 413);
  assertEquals(sb.storage.uploads.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("uploadPhoto exige une cle d'idempotence et une cible", async () => {
  const sb = fakeDb({ job_events: [], photos: [] });
  assertEquals((await uploadPhoto(sb, FAIZA as any, formulaire({ jobId: JOB }))).status, 400);
  assertEquals((await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0006" }))).status, 400);
});

Deno.test("uploadPhoto libere la cle si le depot echoue, et n'insere rien", async () => {
  const sb = fakeDb({ job_events: [], photos: [] });
  sb.fail["storage.upload"] = { message: "bucket down" };
  let leve = false;
  try {
    await uploadPhoto(sb, FAIZA as any, formulaire({ idem: "idem-photo-0007", jobId: JOB }));
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.photos.length, 0);
  assertEquals(sb.tables.job_events.length, 0);
});
