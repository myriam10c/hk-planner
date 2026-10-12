// Branchement des routes Maintenance dans index.ts (phase 1, tache 6).
// Assertions sur la source, comme v3_day_extras_test.ts : index.ts n'est pas
// importable en test (Deno.serve au chargement).
import { assert, assertEquals } from "jsr:@std/assert@1";

const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

// Bloc d'une action : de son `if (action === "...")` au prochain `if (action ===`.
function bloc(action: string): string {
  const debut = src.indexOf(`if (action === "${action}")`);
  assert(debut >= 0, "handler absent pour " + action);
  const fin = src.indexOf("if (action ===", debut + 10);
  return src.slice(debut, fin < 0 ? undefined : fin);
}

Deno.test("ROUTES declare les trois actions mnt avec la bonne methode", () => {
  assert(src.includes('["mnt.list", "GET"]'));
  assert(src.includes('["mnt.act", "POST"]'));
  assert(src.includes('["mnt.proposals.ingest", "POST"]'));
});

Deno.test("mnt.proposals.ingest est server-only, les deux autres non", () => {
  const debut = src.indexOf("const SERVER_ONLY_ACTIONS = new Set([");
  const set = src.slice(debut, src.indexOf("]);", debut));
  assert(set.includes('"mnt.proposals.ingest"'));
  assertEquals(set.includes('"mnt.list"'), false);
  assertEquals(set.includes('"mnt.act"'), false);
});

Deno.test("mnt.list : session, mntAccess, requete parsee (400), mntList", () => {
  const b = bloc("mnt.list");
  const acces = b.indexOf("mntAccess(bearerToken(req) !== null, me)");
  assert(b.indexOf("await currentUser(sb, req)") >= 0);
  assert(acces > b.indexOf("await currentUser(sb, req)"));
  const parse = b.indexOf("parseMntQuery(url.searchParams)");
  assert(parse > acces);
  assert(b.includes(", 400)"));
  assert(b.indexOf("mntList(sb, me!, ") > parse);
});

Deno.test("mnt.act : mntAccess avant le corps, corps invalide en 400, notification gardee", () => {
  const b = bloc("mnt.act");
  const acces = b.indexOf("mntAccess(bearerToken(req) !== null, me)");
  assert(acces >= 0);
  const corps = b.indexOf("req.json()");
  assert(corps > acces);
  assert(b.includes('jsonResp({ error: "invalid json body" }, 400)'));
  assert(b.includes("mntAct(sb, me!, body, {"));
  assert(b.includes("notifyAssignee:"));
  assert(b.includes("keepAlive(Promise.resolve().then(() =>"));
  assert(b.includes('.catch((e) => console.warn("[mnt] '));
});

Deno.test("mnt.proposals.ingest : sans session, mntIngest avec notifyUrgent garde", () => {
  const b = bloc("mnt.proposals.ingest");
  assertEquals(b.includes("currentUser("), false);
  assert(b.includes("mntIngest(sb, body, {"));
  assert(b.includes("notifyUrgent:"));
  assert(b.includes("keepAlive(Promise.resolve().then(() =>"));
  assert(b.includes('.catch((e) => console.warn("[mnt] '));
});

Deno.test("textes des pushes maintenance, anglais, urgent hors heures de silence", () => {
  assert(src.includes('"Urgent from a guest: "'));
  assert(src.includes('" · Open HK Planner to review it."'));
  assert(src.includes('"Unknown apartment"'));
  assert(src.includes('"New ticket: "'));
  assert(src.includes('"Assigned to you. Open HK Planner to see the details."'));
  const urg = src.slice(src.indexOf("async function notifyMntUrgent("));
  const fn = urg.slice(0, urg.indexOf("\n}\n"));
  assert(fn.includes('.in("role", ["maintenance", "manager"])'));
  assert(fn.includes('.eq("is_active", true)'));
  assert(fn.includes('priority: "urgent"'));
  assert(fn.includes("splitListing("));
  // Pas de tiret cadratin dans le code ajoute (le reste d'index.ts n'est pas concerne).
  const pushes = src.slice(src.indexOf("// ========== Maintenance : pushes"), src.indexOf("// ========== Phase 3 : photos"));
  const routes = src.slice(src.indexOf("// ==================== MAINTENANCE"), src.indexOf('if (action === "mgr.planning")'));
  assert(pushes.length > 0 && routes.length > 0);
  assertEquals((pushes + routes).includes("\u2014"), false);
});

Deno.test("phase 2 : routes mnt.get (GET) et mnt.photo (POST), session et mntAccess", () => {
  assert(src.includes('["mnt.get", "GET"]'));
  assert(src.includes('["mnt.photo", "POST"]'));
  const debut = src.indexOf("const SERVER_ONLY_ACTIONS = new Set([");
  const set = src.slice(debut, src.indexOf("]);", debut));
  assertEquals(set.includes('"mnt.get"'), false);
  assertEquals(set.includes('"mnt.photo"'), false);
  const g = bloc("mnt.get");
  const ga = g.indexOf("mntAccess(bearerToken(req) !== null, me)");
  assert(ga > g.indexOf("await currentUser(sb, req)") && g.indexOf("await currentUser(sb, req)") >= 0);
  assert(g.indexOf('mntGet(sb, url.searchParams.get("ref") ?? "", {') > ga);
  assert(g.includes('createSignedUrl(path, 3600)'));
  const p = bloc("mnt.photo");
  const pa = p.indexOf("mntAccess(bearerToken(req) !== null, me)");
  assert(pa >= 0);
  // Meme garde de taille que v3.uploadPhoto, avant la lecture du corps.
  const garde = p.indexOf("V3_MAX_UPLOAD_BODY_BYTES");
  assert(garde > pa && garde < p.indexOf("req.formData()"));
  assert(p.includes('jsonResp({ error: "multipart body required" }, 400)'));
  assert(p.includes("mntPhoto(sb, me!, form)"));
  const pushes = src.slice(src.indexOf("// ========== Maintenance : pushes"), src.indexOf("// ========== Phase 3 : photos"));
  assertEquals((g + p).includes("\u2014"), false);
  assert(pushes.includes('url: APP_URL + "/?mnt=" + String(t.ticketId)'));
  assert(pushes.includes('url: APP_URL + "/?prp=" + String(p.id)'));
  assertEquals(pushes.includes("MNT_PUSH_URL"), false);
});
