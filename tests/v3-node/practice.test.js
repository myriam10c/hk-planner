// Simulateur Practice (tâche 6 du branchement) : les actions de l'app conversation, avec les
// mêmes validations et les mêmes textes de refus que le proxy (v3_tickets.ts, v3_problems.ts,
// v3_photos.ts, v3_write.ts). Rien ne sort : le module n'a ni fetch ni import.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.sessionStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};

const P = await import("../../v3/practice.js");

const LEAD = { jobId: "job_aaaaaaaaaaaaaaaaaaaa", listingId: "101", state: "todo", startedAt: null, openTickets: [{ id: 71, title: "Leak · Bathroom", category: "plumbing", priority: "medium" }], role: "lead" };
const HELPER = { jobId: "job_bbbbbbbbbbbbbbbbbbbb", listingId: "102", state: "running", startedAt: "2026-10-05T06:00:00Z", openTickets: [], role: "helper", leadId: 7 };
const day = (role = "cleaner") => ({ date: "2026-10-05", me: { id: 3, name: "Faiza", role }, stops: [{ ...LEAD }, { ...HELPER }] });

let n = 0;
const idem = () => "idem" + String(++n).padStart(8, "0");
const post = async (action, body) => {
  const r = await P.simulate(action, { body });
  return r.status === 200 ? r.body : r.status + " " + r.body.error;
};
const upload = async (fields, file = new File([new Uint8Array([137, 80, 78, 71])], "p.png", { type: "image/png" })) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (file) f.set("file", file);
  const r = await P.simulate("v3.uploadPhoto", { form: f });
  return r.status === 200 ? r.body : r.status + " " + r.body.error;
};
const linen = { pillowcases: 4, bed_sheets: 1, duvet_covers: 1, large_towels: 3, small_towels: 0, face_towels: 0, bath_mats: 1 };

beforeEach(() => {
  store.clear();
  P.practiceOff();
  P.practiceOn({ id: "3", viewerId: "1" }, false);
  P.practiceDay(day());
});

test("reportProblem : contrat par type et urgence, l'ancien `category` refusé", async () => {
  assert.equal(await post("v3.reportProblem", { listingId: "101", category: "plumbing", idem: idem() }), "400 unknown kind");
  assert.equal(await post("v3.reportProblem", { listingId: "101", kind: "constructor", urgency: "soon", idem: idem() }), "400 unknown kind");
  assert.equal(await post("v3.reportProblem", { listingId: "101", kind: "Leak", urgency: "now", idem: idem() }), "400 invalid urgency");
  assert.equal(await post("v3.reportProblem", { kind: "Leak", urgency: "soon", idem: idem() }), "400 listingId required");
  assert.equal(await post("v3.reportProblem", { listingId: "101", kind: "Leak", urgency: "soon" }), "400 idem required");
  assert.equal(await post("v3.reportProblem", { jobId: "job_inconnu", listingId: "101", kind: "Leak", urgency: "soon", idem: idem() }), "404 Job not found.");
});

test("reportProblem : photo obligatoire sauf gaz, porte et les trois « not working »", async () => {
  assert.equal(await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind: "Leak", urgency: "soon", idem: idem() }), "400 photo required");
  assert.equal(await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind: "Broken", urgency: "soon", photoIdem: "inconnue-0001", idem: idem() }), "400 photo required");
  assert.equal(await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind: "Broken", urgency: "soon", photoId: 123456, idem: idem() }), "400 photo not found");
  for (const kind of ["Gas smell", "Can't get in", "AC not working", "Gas not working", "Wi-Fi not working"]) {
    const r = await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind, urgency: "soon", where: "Whole apartment", idem: idem() });
    assert.equal(r.status, "success", kind);
    assert.ok(r.ticketId > 0);
  }
  // Photo facultative mais désignée et introuvable : refusée.
  assert.equal(await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind: "Gas smell", urgency: "urgent", photoIdem: "inconnue-0002", idem: idem() }), "400 photo required");
});

test("photo, signalement par photoIdem, photo de plus et note par ticketIdem, urgence, pièce, annulation", async () => {
  const up1 = idem(), rep = idem(), up2 = idem();
  const ph = await upload({ jobId: LEAD.jobId, itemName: "problem", idem: up1 });
  assert.equal(ph.status, "success");
  const t = await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind: "Leak", urgency: "soon", where: "  Bathroom  ", note: "under  the sink", photoIdem: up1, idem: rep });
  assert.equal(t.priority, "medium");
  // Rejeu de la même clé : le même ticket.
  assert.deepEqual(await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind: "Leak", urgency: "soon", photoIdem: up1, idem: rep }), t);
  await upload({ jobId: LEAD.jobId, itemName: "problem", idem: up2 });
  assert.equal((await post("v3.addProblemPhoto", { ticketIdem: rep, photoIdem: up2, idem: idem() })).ticketId, t.ticketId);
  assert.equal(await post("v3.addProblemPhoto", { ticketIdem: rep, idem: idem() }), "400 photo required");
  assert.equal(await post("v3.addProblemPhoto", { ticketIdem: "inconnue-0003", photoIdem: up2, idem: idem() }), "400 ticket not found");
  assert.equal(await post("v3.setProblemNote", { ticketIdem: rep, idem: idem() }), "400 note required");
  assert.equal((await post("v3.setProblemNote", { ticketIdem: rep, note: "\tdrip ", idem: idem() })).note, "drip");
  assert.equal(await post("v3.updateProblem", { ticketIdem: rep, idem: idem() }), "400 nothing to update");
  assert.equal(await post("v3.updateProblem", { ticketIdem: rep, urgency: "asap", idem: idem() }), "400 invalid urgency");
  const u = await post("v3.updateProblem", { ticketIdem: rep, urgency: "urgent", where: "Kitchen", idem: idem() });
  assert.deepEqual({ priority: u.priority, title: u.title }, { priority: "urgent", title: "Leak · Kitchen" });
  // Une photo d'un problème ne s'efface pas depuis une miniature.
  assert.equal(await post("v3.deletePhoto", { photoIdem: up2, idem: idem() }), "409 This photo belongs to a problem report.");
  assert.equal((await post("v3.deleteProblem", { ticketIdem: rep, idem: idem() })).status_value, "cancelled");
  assert.equal(await post("v3.setProblemNote", { ticketIdem: rep, note: "x", idem: idem() }), "400 ticket is already closed");
  // Annulé : il quitte la liste des tickets du logement.
  const d = P.practiceDay(day());
  assert.deepEqual(d.stops[0].openTickets.map(x => x.id), [71]);
});

test("un vrai ticket du logement n'est pas « à moi » ; idem et ticket requis", async () => {
  assert.equal(await post("v3.setProblemNote", { ticketId: 71, note: "x", idem: idem() }), "403 not your problem");
  assert.equal(await post("v3.deleteProblem", { ticketId: 999, idem: idem() }), "400 ticket not found");
  assert.equal(await post("v3.deleteProblem", { idem: idem() }), "400 ticketId required");
  assert.equal(await post("v3.deleteProblem", { ticketId: 71 }), "400 idem required");
});

test("deletePhoto : par clé de téléversement, inconnue = rien à effacer, puis 404", async () => {
  const up = idem();
  const ph = await upload({ jobId: LEAD.jobId, itemName: "arrival:Bed", idem: up });
  assert.deepEqual(await post("v3.deletePhoto", { photoIdem: "jamais-partie1", idem: idem() }), { status: "success", photoId: null });
  const del = idem();
  assert.deepEqual(await post("v3.deletePhoto", { photoIdem: up, idem: del }), { status: "success", photoId: ph.photoId });
  assert.deepEqual(await post("v3.deletePhoto", { photoIdem: up, idem: del }), { status: "success", photoId: ph.photoId });
  assert.equal(await post("v3.deletePhoto", { photoId: ph.photoId, idem: idem() }), "404 Photo not found.");
  assert.equal(await post("v3.deletePhoto", { photoId: "abc", idem: idem() }), "400 Invalid photo id.");
  // Photo effacée : elle ne sert plus de preuve.
  assert.equal(await post("v3.reportProblem", { jobId: LEAD.jobId, listingId: "101", kind: "Leak", urgency: "soon", photoId: ph.photoId, idem: idem() }), "400 photo not found");
});

test("finishJob : linge exigé du lead, jamais de l'aide ni d'une sous-traitante ; rapport lu comme au proxy", async () => {
  assert.equal(await post("v3.finishJob", { jobId: LEAD.jobId, idem: idem() }), "400 pillowcases must be an integer");
  assert.equal(await post("v3.finishJob", { jobId: LEAD.jobId, idem: idem(), linen, report: "text" }), "400 report must be an object");
  assert.equal(await post("v3.finishJob", { jobId: LEAD.jobId, idem: idem(), linen, report: { text: "x".repeat(21 * 1024) } }), "400 report is too large");
  const aide = await post("v3.finishJob", { jobId: HELPER.jobId, idem: idem() });
  assert.deepEqual({ role: aide.role, d: aide.durationMinutes }, { role: "helper", d: null });
  // L'aide ne clôt pas le ménage de sa collègue.
  assert.equal(P.practiceDay(day()).stops[1].state, "running");
  const fin = await post("v3.finishJob", { jobId: LEAD.jobId, idem: idem(), linen, report: { text: "READY" } });
  assert.equal(fin.role, "lead");
  assert.equal(P.practiceDay(day()).stops[0].state, "done");
  // Sous-traitante : pas de linge.
  P.practiceOff();
  P.practiceOn({ id: "3", viewerId: "1" }, false);
  P.practiceDay(day("subcontractor"));
  assert.equal((await post("v3.finishJob", { jobId: LEAD.jobId, idem: idem() })).role, "lead");
});

test("action inconnue ou héritée d'Object.prototype : refus, rien d'autre", async () => {
  assert.equal(await post("constructor", {}), "400 Not available in practice");
  assert.equal(await post("deletePushSubscription", {}), "400 Not available in practice");
});

test("conversations de la séance : gardées à part, liées à la cible, effacées avec elle", () => {
  P.practiceSaveConvs({ date: "2026-10-05", convs: { a: 1 } });
  assert.equal(P.practiceLoadConvs().convs.a, 1);
  assert.equal(store.has("v3Convs"), false);
  // Reprise (rechargement) : gardées ; nouvelle séance sur une autre cible : rien.
  P.practiceOn({ id: "3", viewerId: "1" }, true);
  assert.equal(P.practiceLoadConvs().convs.a, 1);
  P.practiceOn({ id: "4", viewerId: "1" }, false);
  assert.equal(P.practiceLoadConvs(), null);
  P.practiceSaveConvs({ convs: { b: 1 } });
  P.practiceOff();
  assert.equal(store.has(P.CLE_PRACTICE_CONVS), false);
  assert.equal(store.has(P.CLE_PRACTICE), false);
  assert.equal(P.practiceLoadConvs(), null);
});

test("Practice : l'heure d'un extra (stops[].time) traverse practiceDay", () => {
  const d = day();
  d.stops[0].time = "14:00";
  assert.equal(P.practiceDay(d).stops[0].time, "14:00");
});
