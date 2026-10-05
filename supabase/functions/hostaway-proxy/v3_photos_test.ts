// Tests de v3.deletePhoto (branchement 2026-10-05, tache 3) : la cleaner retire
// une photo depuis sa miniature. Proprietaire uniquement, idempotent.
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { deletePhoto } from "./v3_photos.ts";
import { roleAllowed } from "./v3.ts";

const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const JOY = { cleaner_id: 8, name: "Joy", role: "cleaner", color: "#000000" };
const CHEMIN = "v3/2026-09-12/abc.jpg";

function base() {
  const sb = fakeDb({
    job_events: [],
    photos: [{ id: 55, storage_path: CHEMIN, job_id: "job_1a2b3c4d5e6f70819a2b",
      item_name: "end:Kitchen", cleaner_id: 3, kind: "photo" }],
  });
  sb.storage.uploads.push({ bucket: "cleaning-photos", path: CHEMIN, bytes: 10, contentType: "image/jpeg" });
  return sb;
}

Deno.test("deletePhoto retire l'objet du bucket et la ligne", async () => {
  const sb = base();
  const r = await deletePhoto(sb, FAIZA as any, { photoId: 55, idem: "idem-del-0001" });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).photoId, 55);
  assertEquals(sb.tables.photos.length, 0);
  assertEquals(sb.storage.removals, [{ bucket: "cleaning-photos", paths: [CHEMIN] }]);
  assertEquals(sb.tables.job_events[0].event_type, "delete_photo");
});

Deno.test("deletePhoto refuse la photo d'une autre personne (403), sans rien toucher", async () => {
  const sb = base();
  const r = await deletePhoto(sb, JOY as any, { photoId: 55, idem: "idem-del-0002" });
  assertEquals(r.status, 403);
  assertEquals(sb.tables.photos.length, 1);
  assertEquals(sb.storage.removals.length, 0);
  // La cle n'est pas brulee.
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("deletePhoto est idempotent : le rejeu rend le meme succes", async () => {
  const sb = base();
  const un = await deletePhoto(sb, FAIZA as any, { photoId: 55, idem: "idem-del-0003" });
  const deux = await deletePhoto(sb, FAIZA as any, { photoId: 55, idem: "idem-del-0003" });
  assertEquals(deux.status, 200);
  assertEquals(deux.body, un.body);
  assertEquals(sb.storage.removals.length, 1);
});

Deno.test("deletePhoto rend 404 sur une photo inconnue et 400 sur un corps invalide", async () => {
  const sb = base();
  assertEquals((await deletePhoto(sb, FAIZA as any, { photoId: 999, idem: "idem-del-0004" })).status, 404);
  assertEquals((await deletePhoto(sb, FAIZA as any, { photoId: "abc", idem: "idem-del-0005" })).status, 400);
  assertEquals((await deletePhoto(sb, FAIZA as any, { photoId: 55 })).status, 400);
  assertEquals((await deletePhoto(sb, FAIZA as any, { photoId: true, idem: "idem-del-0006" })).status, 400);
});

Deno.test("deletePhoto garde une photo deja preuve d'un probleme (409)", async () => {
  const sb = base();
  sb.tables.photos[0].ticket_id = 71;
  const r = await deletePhoto(sb, FAIZA as any, { photoId: 55, idem: "idem-del-0007" });
  assertEquals(r.status, 409);
  assertEquals(sb.tables.photos.length, 1);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("deletePhoto libere la cle quand le retrait du bucket echoue", async () => {
  const sb = base();
  sb.fail["storage.remove"] = { message: "boom" };
  let leve = false;
  try {
    await deletePhoto(sb, FAIZA as any, { photoId: 55, idem: "idem-del-0008" });
  } catch (_e) {
    leve = true;
  }
  assertEquals(leve, true);
  assertEquals(sb.tables.photos.length, 1);
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("v3.deletePhoto est ouverte a ceux qui televersent, jamais a un manager", () => {
  assertEquals(roleAllowed("v3.deletePhoto", "cleaner"), true);
  assertEquals(roleAllowed("v3.deletePhoto", "subcontractor"), true);
  assertEquals(roleAllowed("v3.deletePhoto", "maintenance"), true);
  assertEquals(roleAllowed("v3.deletePhoto", "manager"), false);
});

Deno.test("index.ts route v3.deletePhoto en POST, derriere session et role", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assertEquals(src.includes('["v3.deletePhoto", "POST"]'), true);
  const bloc = src.slice(src.indexOf('if (action === "v3.deletePhoto"'));
  const fin = bloc.indexOf("deletePhoto(sb, me, body)");
  assertEquals(fin > 0, true);
  assertEquals(bloc.slice(0, fin).includes("currentUser(sb, req)"), true);
  assertEquals(bloc.slice(0, fin).includes("roleAllowed(action, me.role)"), true);
});
