import { assertEquals, assert } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import {
  assignProposal, claimProposal, finishInspection, saveItem, setExcluded, startInspection,
  unclaimProposal, uploadInspectionPhoto,
} from "./insp_write.ts";
import { INSP_ZONES } from "./insp_rules.ts";

const WALTER = { cleaner_id: 2, name: "Walter", role: "manager", color: "#000" };
const FAIZA = { cleaner_id: 3, name: "Faiza", role: "cleaner", color: "#e94560" };
const NOW = Date.parse("2026-10-06T08:00:00Z"); // 12:00 Dubai
const seed = () => fakeDb({
  cleaners: [
    { id: 2, name: "Walter", role: "manager", is_active: true },
    { id: 3, name: "Faiza", role: "cleaner", is_active: true },
    { id: 12, name: "Elite", role: "subcontractor", is_active: true },
  ],
  listing_config: [{ listing_id: "L1", internal_name: "3207 - Sobha Waves" }],
  maintenance_sla: [{ category: "general", priority: "medium", max_hours: 48 }],
});

async function started(db: any, me = FAIZA) {
  const r = await startInspection(db, me, { listingId: "L1", eligibility: "checkout", idem: "idem-start-1" }, NOW);
  assertEquals(r.status, 200);
  return (r.body as any).inspection.id;
}
function photoForm(inspectionId: number, zone: string, idem: string, kind = "issue") {
  const f = new FormData();
  f.set("inspectionId", String(inspectionId)); f.set("zone", zone); f.set("kind", kind); f.set("idem", idem);
  f.set("file", new File([new Uint8Array(10)], "a.jpg", { type: "image/jpeg" }));
  return f;
}

Deno.test("start puis reprise : meme inspection, zones deja saisies rendues", async () => {
  const db = seed();
  const id = await started(db);
  await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "ok" });
  const again = await startInspection(db, FAIZA, { listingId: "L1", eligibility: "checkout", idem: "idem-start-2" }, NOW);
  assertEquals((again.body as any).inspection.id, id);
  assertEquals((again.body as any).items.map((i: any) => i.zone), ["ac"]);
});

Deno.test("start : le snapshot porte le nom du logement", async () => {
  const db = seed();
  const r = await startInspection(db, FAIZA, { listingId: "L1", eligibility: "checkout", idem: "idem-start-1" }, NOW);
  assertEquals((r.body as any).inspection.name, "Apt 3207 · Sobha Waves");
});

Deno.test("start : rejeu de la meme cle idem rend la meme inspection", async () => {
  const db = seed();
  const id = await started(db);
  const r = await startInspection(db, FAIZA, { listingId: "L1", eligibility: "checkout", idem: "idem-start-1" }, NOW);
  assertEquals((r.body as any).inspection.id, id);
  assertEquals(db.tables.inspections.length, 1);
});

Deno.test("start : logement inconnu 404, eligibility invalide 400, idem invalide 400", async () => {
  const db = seed();
  assertEquals((await startInspection(db, FAIZA, { listingId: "ZZ", eligibility: "adhoc", idem: "idem-xxxx-1" }, NOW)).status, 404);
  assertEquals((await startInspection(db, FAIZA, { listingId: "L1", eligibility: "nope", idem: "idem-xxxx-1" }, NOW)).status, 400);
  assertEquals((await startInspection(db, FAIZA, { listingId: "L1", eligibility: "adhoc", idem: "x" }, NOW)).status, 400);
});

Deno.test("saveItem : not_ok sans note refuse, fixed sans fixNote refuse", async () => {
  const db = seed(); const id = await started(db);
  assertEquals((await saveItem(db, FAIZA, { inspectionId: id, zone: "kitchen", status: "not_ok" })).status, 400);
  assertEquals((await saveItem(db, FAIZA, { inspectionId: id, zone: "kitchen", status: "not_ok", note: "Oven dirty", outcome: "fixed" })).status, 400);
  assertEquals((await saveItem(db, FAIZA, { inspectionId: id, zone: "kitchen", status: "not_ok", note: "Oven dirty", outcome: "fixed", fixNote: "Cleaned" })).status, 200);
});

Deno.test("saveItem : zone inconnue 400, autre inspecteur 403", async () => {
  const db = seed(); const id = await started(db);
  assertEquals((await saveItem(db, FAIZA, { inspectionId: id, zone: "garage", status: "ok" })).status, 400);
  assertEquals((await saveItem(db, WALTER, { inspectionId: id, zone: "ac", status: "ok" })).status, 403);
});

Deno.test("maintenance : un seul ticket meme sur double envoi", async () => {
  const db = seed(); const id = await started(db);
  const body = { inspectionId: id, zone: "ac", status: "not_ok", note: "AC leaking", outcome: "maintenance" };
  const a = await saveItem(db, FAIZA, body);
  const b = await saveItem(db, FAIZA, body);
  assertEquals(db.tables.maintenance_tickets.length, 1);
  const t = db.tables.maintenance_tickets[0];
  assertEquals(t.source, "inspection");
  assertEquals(t.source_ref, "inspection:" + id + ":ac");
  assertEquals(t.listing_id, "L1");
  assertEquals((a.body as any).item.ticketId, t.id);
  assertEquals((b.body as any).item.ticketId, t.id);
});

// Fait echouer le premier insert de `table` en 23505 apres avoir pose `row`
// (simule une requete concurrente qui gagne la course).
function racing(db: any, table: string, row: any) {
  const orig = db.from;
  let done = false;
  db.from = (t: string) => {
    const q = orig(t);
    if (t !== table) return q;
    const ins = q.insert;
    q.insert = (v: any) => {
      if (done) return ins(v);
      done = true;
      db.tables[table].push({ id: 5000, ...row });
      return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) };
    };
    return q;
  };
}

Deno.test("maintenance : insert en 23505 (course), ticket relu par source_ref et rattache", async () => {
  const db = seed(); const id = await started(db);
  // Pre-lookup vide ; racing() pose le ticket concurrent a l'insert qui echoue en 23505.
  racing(db, "maintenance_tickets", { source: "inspection", source_ref: "inspection:" + id + ":ac" });
  const r = await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "not_ok", note: "Leak", outcome: "maintenance" });
  assertEquals(r.status, 200);
  assertEquals((r.body as any).item.ticketId, 5000);
  assertEquals(db.tables.maintenance_tickets.length, 1);
});

Deno.test("ticket : titre = libelle + note tronquee a 80", async () => {
  const db = seed(); const id = await started(db);
  await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "not_ok", note: "x".repeat(200), outcome: "maintenance" });
  const t = db.tables.maintenance_tickets[0].title as string;
  assertEquals(t, "AC: " + "x".repeat(80));
});

Deno.test("start : cle idem differente, index partiel (23505), rend l'inspection ouverte", async () => {
  const db = seed();
  const id = await started(db);
  // Le lookup d'ouverture rate la premiere fois, l'insert viole l'index partiel.
  const orig = db.from; let missed = false;
  db.from = (t: string) => {
    const q = orig(t);
    if (t !== "inspections") return q;
    const maybe = q.maybeSingle; const ins = q.insert;
    const filters: string[] = [];
    const is = q.is; q.is = (c: string, v: any) => { filters.push(c); return is(c, v); };
    q.maybeSingle = async () => {
      if (!missed && filters.includes("finished_at")) { missed = true; return { data: null, error: null }; }
      return maybe();
    };
    q.insert = (v: any) => {
      ins(v);
      return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "uq_inspections_open" } }) }) };
    };
    return q;
  };
  const r = await startInspection(db, FAIZA, { listingId: "L1", eligibility: "checkout", idem: "idem-start-other" }, NOW);
  assertEquals(r.status, 200);
  assertEquals((r.body as any).inspection.id, id);
});

Deno.test("claim : deja pris par un autre, 409 par le chemin conditionnel", async () => {
  const db = seed();
  await claimProposal(db, FAIZA, { listingId: "L1" }, NOW);
  const r = await claimProposal(db, WALTER, { listingId: "L1" }, NOW);
  assertEquals(r.status, 409);
  assertEquals(db.tables.inspection_proposals[0].claimed_by, 3);
  // Reprise par le meme cleaner : ok.
  assertEquals((await claimProposal(db, FAIZA, { listingId: "L1" }, NOW)).status, 200);
});

Deno.test("claim / unclaim / assign / setExcluded : entrees invalides", async () => {
  const db = seed();
  assertEquals((await unclaimProposal(db, WALTER, { listingId: "" }, NOW)).status, 400);
  assertEquals((await claimProposal(db, FAIZA, { listingId: "ZZ" }, NOW)).status, 404);
  assertEquals((await assignProposal(db, WALTER, { listingId: "ZZ", cleanerId: 3 }, NOW)).status, 404);
  assertEquals((await setExcluded(db, WALTER, { listingId: "ZZ", excluded: true })).status, 404);
});

Deno.test("photo : course 23505 sans relecture, erreur (pas de photo null)", async () => {
  const db = seed(); const id = await started(db);
  db.fail["inspection_photos.insert"] = { code: "23505", message: "duplicate" };
  let threw = false;
  try { await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-9")); } catch { threw = true; }
  assert(threw);
});

Deno.test("finish : mise a jour gardee a 0 ligne, rend le finished_at stocke", async () => {
  const db = seed(); const id = await started(db);
  for (const z of INSP_ZONES) await saveItem(db, FAIZA, { inspectionId: id, zone: z.key, status: "ok" });
  const orig = db.from;
  db.from = (t: string) => {
    const q = orig(t);
    if (t !== "inspections") return q;
    const upd = q.update;
    q.update = (v: any) => { db.tables.inspections[0].finished_at = "2026-10-06T07:00:00.000Z"; return upd(v); };
    return q;
  };
  const r = await finishInspection(db, FAIZA, { inspectionId: id }, NOW);
  assertEquals((r.body as any).inspection.finishedAt, "2026-10-06T07:00:00.000Z");
});

Deno.test("photo : stockee sous inspections/, rejeu idem sans doublon", async () => {
  const db = seed(); const id = await started(db);
  const a = await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-1"));
  const b = await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-1"));
  assertEquals(a.status, 200); assertEquals(b.status, 200);
  assertEquals(db.tables.inspection_photos.length, 1);
  assert(db.tables.inspection_photos[0].storage_path.startsWith("inspections/" + id + "/ac/"));
});

Deno.test("finish : zones manquantes, photo manquante, outcome manquant, puis succes et rejeu", async () => {
  const db = seed(); const id = await started(db);
  for (const z of INSP_ZONES) if (z.key !== "ac") await saveItem(db, FAIZA, { inspectionId: id, zone: z.key, status: "ok" });
  let r = await finishInspection(db, FAIZA, { inspectionId: id }, NOW);
  assertEquals(r.status, 400); assertEquals((r.body as any).error, "Missing: AC");
  await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "not_ok", note: "Noisy" });
  r = await finishInspection(db, FAIZA, { inspectionId: id }, NOW);
  assertEquals((r.body as any).error, "Add a photo for: AC");
  await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-2"));
  r = await finishInspection(db, FAIZA, { inspectionId: id }, NOW);
  assertEquals((r.body as any).error, "Choose fixed or maintenance for: AC");
  await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "not_ok", note: "Noisy", outcome: "fixed", fixNote: "Filter cleaned" });
  r = await finishInspection(db, FAIZA, { inspectionId: id, generalNote: "Good overall" }, NOW);
  assertEquals(r.status, 200);
  const again = await finishInspection(db, FAIZA, { inspectionId: id }, NOW + 60_000);
  assertEquals((again.body as any).inspection.finishedAt, (r.body as any).inspection.finishedAt);
  assertEquals((await saveItem(db, FAIZA, { inspectionId: id, zone: "ac", status: "ok" })).status, 409);
});

Deno.test("claim / conflit / unclaim / assign", async () => {
  const db = seed();
  assertEquals((await claimProposal(db, FAIZA, { listingId: "L1" }, NOW)).status, 200);
  const c = await claimProposal(db, WALTER, { listingId: "L1" }, NOW);
  assertEquals(c.status, 409); assertEquals((c.body as any).error, "Already taken by Faiza.");
  assertEquals((await unclaimProposal(db, WALTER, { listingId: "L1" }, NOW)).status, 200); // manager
  assertEquals((await assignProposal(db, WALTER, { listingId: "L1", cleanerId: 12 }, NOW)).status, 400); // sous-traitant
  assertEquals((await assignProposal(db, WALTER, { listingId: "L1", cleanerId: 3 }, NOW)).status, 200);
  const p = db.tables.inspection_proposals[0];
  assertEquals([p.proposal_date, p.claimed_by, p.assigned_by], ["2026-10-06", 3, 2]);
});

Deno.test("unclaim par un autre cleaner refuse", async () => {
  const db = seed();
  await claimProposal(db, WALTER, { listingId: "L1" }, NOW);
  assertEquals((await unclaimProposal(db, FAIZA, { listingId: "L1" }, NOW)).status, 403);
});

Deno.test("setExcluded", async () => {
  const db = seed();
  const r = await setExcluded(db, WALTER, { listingId: "L1", excluded: true });
  assertEquals(r.status, 200);
  assertEquals(db.tables.listing_config[0].inspection_excluded, true);
});

async function maintItem(db: any, id: number, zone = "ac") {
  const r = await saveItem(db, FAIZA, { inspectionId: id, zone, status: "not_ok", note: "Leaking", outcome: "maintenance" }, NOW);
  assertEquals(r.status, 200);
}

Deno.test("ticket photo : photo puis saveItem maintenance, photo_path = chemin de la photo", async () => {
  const db = seed(); const id = await started(db);
  await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-t1"));
  await maintItem(db, id);
  assertEquals(db.tables.maintenance_tickets[0].photo_path, db.tables.inspection_photos[0].storage_path);
});

Deno.test("ticket photo : saveItem maintenance puis photo, ticket mis a jour", async () => {
  const db = seed(); const id = await started(db);
  await maintItem(db, id);
  assertEquals(db.tables.maintenance_tickets[0].photo_path ?? null, null);
  await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-t2"));
  assertEquals(db.tables.maintenance_tickets[0].photo_path, db.tables.inspection_photos[0].storage_path);
});

Deno.test("ticket photo : photo_path deja renseignee, jamais ecrasee", async () => {
  const db = seed(); const id = await started(db);
  await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-t3"));
  await maintItem(db, id);
  const first = db.tables.maintenance_tickets[0].photo_path;
  await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-t4"));
  assertEquals(db.tables.inspection_photos.length, 2);
  assertEquals(db.tables.maintenance_tickets[0].photo_path, first);
});

Deno.test("ticket photo : une photo after n'alimente jamais le ticket", async () => {
  const db = seed(); const id = await started(db);
  await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-t5", "after"));
  await maintItem(db, id);
  assertEquals(db.tables.maintenance_tickets[0].photo_path ?? null, null);
  await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-t6", "after"));
  assertEquals(db.tables.maintenance_tickets[0].photo_path ?? null, null);
});

Deno.test("ticket photo : erreur de mise a jour du ticket n'echoue pas l'upload", async () => {
  const db = seed(); const id = await started(db);
  await maintItem(db, id);
  db.fail["maintenance_tickets.update"] = { code: "XX", message: "boom" };
  const r = await uploadInspectionPhoto(db, FAIZA, photoForm(id, "ac", "idem-photo-t7"));
  assertEquals(r.status, 200);
});
