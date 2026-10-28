// Traduction des gestes de la conversation en écritures du proxy (tâche 5 du branchement).
// syncPlan est appelé après chaque geste, comme le fait app.js : il rend les actions à mettre en
// file, dans l'ordre, et note dans conv.sync ce qui est déjà parti (rien n'est jamais émis deux fois).
import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME } from "./fixtures.js";
import {
  createConversation, reply, addPhoto, startProblem, chooseKind, addFlowPhoto, flowReply, editProblem,
  removeProblem, removeArrivalOrEndPhoto, reopenProblem, currentStep, requireLinen,
} from "../../v3/conv/conversation.js";
import { syncPlan, finishPlan, ackSync, refreshTicks, finishAcked, PHOTO_OPTIONAL, runActions } from "../../v3/conv/sync.js";

const [oxford, creek, bloom] = APARTMENTS;
const at = (h, m) => new Date(2026, 9, 2, h, m);

function harness(apt) {
  let n = 0;
  const newIdem = () => "idem" + String(++n).padStart(4, "0");
  const c = createConversation(apt, { me: ME, now: at(9, 0) });
  const sent = [];
  const sync = (opts = {}) => { const a = syncPlan(c, { newIdem, ...opts }); sent.push(...a); return a; };
  const finish = (opts = {}) => { const a = finishPlan(c, { newIdem, now: at(11, 40), ...opts }); sent.push(...a); return a; };
  let k = 0;
  const photo = () => ({ url: "blob:" + (++k), file: { name: "p" + k + ".jpg", type: "image/jpeg" } });
  return { c, sent, sync, finish, photo, newIdem };
}

// Forme lisible d'une action : nom court et champs utiles.
const brief = a => {
  const b = a.body;
  const short = a.action.replace("v3.", "");
  if (short === "uploadPhoto") return short + " " + b.itemName + " " + b.idem;
  if (short === "reportProblem") return short + " " + b.kind + " " + (b.photoIdem || "-") + " " + b.idem;
  if (short === "addProblemPhoto") return short + " " + b.ticketIdem + " " + b.photoIdem;
  if (short === "setProblemNote") return short + " " + b.ticketIdem + " " + JSON.stringify(b.note);
  if (short === "updateProblem") return short + " " + b.ticketIdem + " " + JSON.stringify({ urgency: b.urgency, where: b.where });
  if (short === "deleteProblem") return short + " " + b.ticketIdem;
  if (short === "deletePhoto") return short + " " + b.photoIdem;
  return short + " " + b.idem;
};

// Étape de la carte d'accès (22/10), juste après I'm here : une photo puis Next, avec un sync à chaque geste.
function card({ c, sync, photo }) {
  addPhoto(c, photo()); sync(); reply(c, "next-room"); sync();
}

function studio(h) {
  const { c, sync, photo } = h;
  reply(c, "here", { now: at(10, 0) }); sync();
  card(h);
  for (let i = 0; i < 3; i++) { addPhoto(c, photo()); sync(); reply(c, "next-room"); sync(); }
  reply(c, "walls-ok"); sync(); reply(c, "no-damage"); sync(); reply(c, "send-arrival-text"); reply(c, "send-arrival"); sync(); reply(c, "linen-yes"); sync();
  for (let i = 0; i < 3; i++) { addPhoto(c, photo()); sync(); reply(c, "next-room"); sync(); }
  for (const k of ["gas", "ac", "wifi", "lights", "windows", "trash", "door"]) { reply(c, "leave:" + k); sync(); }
  reply(c, "low-done"); sync();
}

test("studio sans problème : startJob, 6 photos dans l'ordre, puis finishJob avec linge et rapport à Send", () => {
  const h = harness(bloom);
  studio(h);
  assert.equal(currentStep(h.c).id, "report");
  // finishJob part au moment de Send, avant le partage (app.js appelle finishPlan puis shareReport).
  h.finish();
  reply(h.c, "send-text", { now: at(11, 40) }); reply(h.c, "send", { now: at(11, 40) });
  assert.equal(h.c.gestures, 30);
  assert.deepEqual(h.sent.map(brief), [
    "startJob idem0001",
    "uploadPhoto arrival:Access card idem0002",
    "uploadPhoto arrival:Bed idem0003", "uploadPhoto arrival:Bathroom idem0004", "uploadPhoto arrival:Kitchen idem0005",
    "uploadPhoto end:Bed idem0006", "uploadPhoto end:Bathroom idem0007", "uploadPhoto end:Kitchen idem0008",
    "finishJob idem0009",
  ]);
  assert.equal(h.sent[1].file, h.c.arrivalPhotos["Access card"][0].file);
  const up = h.sent[2];
  assert.equal(up.body.jobId, bloom.id);
  assert.equal(up.file, h.c.arrivalPhotos.Bed[0].file);
  const fin = h.sent[8].body;
  assert.equal(fin.jobId, bloom.id);
  assert.deepEqual(fin.checklist, {});
  assert.deepEqual(fin.photos, []);
  assert.deepEqual(fin.linen, { pillowcases: 4, bed_sheets: 1, duvet_covers: 1, large_towels: 3, small_towels: 0, face_towels: 0, bath_mats: 1 });
  assert.match(fin.report.text, /READY · 1011C Bloom Towers/);
  assert.deepEqual(fin.report.problems, []);
  // Rien de plus : un second Send, un second appel ne réémettent rien.
  assert.deepEqual(h.finish(), []);
  assert.deepEqual(h.sync(), []);
});

test("un problème avec 2 photos et une note : photo, signalement, photo + rattachement, note", () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  reply(c, "here", { now: at(10, 0) }); sync();
  card(h);
  startProblem(c); sync();
  chooseKind(c, "Leak", { now: at(10, 1) });
  assert.deepEqual(sync(), [], "Leak : photo obligatoire, le signalement attend la première photo");
  addFlowPhoto(c, photo()); sync();
  addFlowPhoto(c, photo()); sync();
  flowReply(c, "photos-done"); sync();
  flowReply(c, "save-text", { text: "under the sink" }); sync();
  assert.deepEqual(h.sent.map(brief), [
    "startJob idem0001",
    "uploadPhoto arrival:Access card idem0002",
    "uploadPhoto problem idem0004",
    "reportProblem Leak idem0004 idem0003",
    "uploadPhoto problem idem0005",
    "addProblemPhoto idem0003 idem0005",
    "setProblemNote idem0003 \"under the sink\"",
  ]);
  const rep = h.sent[3].body;
  assert.deepEqual(rep, { jobId: bloom.id, listingId: bloom.listingId, kind: "Leak", urgency: "soon", where: "Bed", note: null, photoIdem: "idem0004", idem: "idem0003" });
  assert.equal(h.sent[4].body.jobId, bloom.id, "photo de problème rattachée au ménage");
  // Une fois l'id du ticket connu, il part avec ticketIdem.
  ackSync(c, "idem0003", { status: "success", ticketId: 812 });
  editProblem(c, 0, { urgency: "urgent" }); sync();
  assert.deepEqual(h.sent.at(-1).body, { ticketIdem: "idem0003", ticketId: 812, urgency: "urgent", idem: "idem0008" });
});

test("problème sans photo obligatoire : rien ne part ; la note et l'endroit attendent la photo et partent avec le signalement", () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  reply(c, "here", { now: at(10, 0) }); sync();
  startProblem(c); chooseKind(c, "Broken", { now: at(10, 1) });
  flowReply(c, "no-photo"); flowReply(c, "save-text", { text: "sofa leg" });
  editProblem(c, 0, { where: "Kitchen" });
  assert.deepEqual(sync(), []);
  reopenProblem(c, 0, "photos"); addFlowPhoto(c, photo());
  const a = sync();
  assert.deepEqual(a.map(brief), ["uploadPhoto problem idem0003", "reportProblem Broken idem0003 idem0002"]);
  assert.equal(a[1].body.note, "sofa leg");
  assert.equal(a[1].body.where, "Kitchen");
});

test("types à photo facultative : signalés tout de suite (Gas smell, I can't get in avant startJob)", () => {
  assert.deepEqual(PHOTO_OPTIONAL, ["Gas smell", "Can't get in", "AC not working", "Gas not working", "Wi-Fi not working", "Access card missing"]);
  const h = harness(bloom);
  const { c, sync, photo } = h;
  reply(c, "cant-get-in", { now: at(10, 0) }); sync();
  reply(c, "in-now", { now: at(10, 20) }); sync();
  startProblem(c); chooseKind(c, "Gas smell", { now: at(10, 21) }); sync();
  flowReply(c, "gas-ok"); sync();
  assert.deepEqual(h.sent.map(brief), [
    "reportProblem Can't get in - idem0001", "startJob idem0002", "reportProblem Gas smell - idem0003",
  ]);
  assert.equal(h.sent[0].body.urgency, "urgent");
  assert.equal(h.sent[0].body.where, "Entrance & building");
  assert.equal("photoIdem" in h.sent[0].body, false);
  // Photo prise après coup : rattachée au ticket du gaz.
  reopenProblem(c, 1, "photos"); addFlowPhoto(c, photo()); sync();
  assert.deepEqual(h.sent.slice(3).map(brief), ["uploadPhoto problem idem0004", "addProblemPhoto idem0003 idem0004"]);
});

test("ligne de sortie « AC not working » : signalement Soon ; retour sur « works » : annulation", () => {
  const h2 = harness(oxford);
  const c2 = h2.c;
  reply(c2, "here"); h2.sync();
  // Étape 5 directement : on force l'index pour ne tester que les lignes.
  c2.i = c2.steps.findIndex(s => s.id === "leave");
  reply(c2, "leave:ac-ko"); h2.sync();
  reply(c2, "leave:ac"); h2.sync();
  assert.deepEqual(h2.sent.map(brief), ["startJob idem0001", "reportProblem AC not working - idem0002", "deleteProblem idem0002"]);
  assert.equal(h2.sent[1].body.urgency, "soon");
  assert.equal(c2.problems.length, 0);
});

test("suppression d'une photo de pièce : retrait de la file tant qu'elle n'est pas partie, sinon deletePhoto", () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  reply(c, "here"); sync();
  card(h);
  addPhoto(c, photo()); addPhoto(c, photo()); sync();
  ackSync(c, "idem0003", { status: "success", photoId: 77 });
  removeArrivalOrEndPhoto(c, "arrival-photo", "Bed", 0);
  removeArrivalOrEndPhoto(c, "arrival-photo", "Bed", 0);
  const a = sync();
  assert.deepEqual(a.map(x => [x.action, x.body.photoIdem, x.body.photoId, x.unqueue]), [
    ["v3.deletePhoto", "idem0003", 77, "idem0003"],
    ["v3.deletePhoto", "idem0004", undefined, "idem0004"],
  ]);
});

test("problème supprimé : deleteProblem s'il est signalé, rien sinon", () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  reply(c, "here"); sync();
  startProblem(c); chooseKind(c, "Leak"); addFlowPhoto(c, photo()); flowReply(c, "photos-done"); flowReply(c, "no-note"); sync();
  startProblem(c); chooseKind(c, "Stain"); flowReply(c, "no-photo"); flowReply(c, "no-note"); sync();
  removeProblem(c, 1); removeProblem(c, 0);
  assert.deepEqual(sync().map(brief), ["deleteProblem idem0002"]);
});

test("aide : startJob, ses photos de fin, puis finishJob sans linge ni rapport à « Add to <lead>'s report »", () => {
  const h = harness(creek);
  const { c, sync, photo } = h;
  reply(c, "here"); sync();
  for (let i = 0; i < 7; i++) { addPhoto(c, photo()); sync(); reply(c, "next-room"); sync(); }
  assert.equal(currentStep(c).id, "helper");
  h.finish();
  reply(c, "add-to-lead"); sync();
  assert.equal(h.sent.length, 9);
  assert.deepEqual(h.sent[1].body.itemName, "end:Bedroom 1");
  assert.deepEqual(h.sent[8].body, { jobId: creek.id, idem: "idem0009", checklist: {}, photos: [] });
});

test("refus « linge » de finishJob (le serveur voit un lead) : la conversation demande le linge, puis un nouveau finishJob avec linge", () => {
  const h = harness(creek);
  const { c, sync } = h;
  reply(c, "here"); sync();
  c.i = c.steps.findIndex(s => s.id === "helper");
  h.finish(); reply(c, "add-to-lead");
  requireLinen(c);
  assert.equal(c.sent, false);
  assert.equal(currentStep(c).id, "linen");
  reply(c, "linen-yes");
  assert.equal(currentStep(c).id, "linen-send");
  assert.deepEqual(currentStep(c).replies.map(r => r.label), ["Send linen count"]);
  h.finish();
  reply(c, "linen-send");
  assert.equal(c.sent, true);
  const fins = h.sent.filter(a => a.action === "v3.finishJob");
  assert.equal(fins.length, 2);
  assert.notEqual(fins[0].body.idem, fins[1].body.idem);
  assert.equal(fins[1].body.linen.pillowcases, 4);
  assert.equal("report" in fins[1].body, false);
});

test("View as et Practice : aucune action, rien n'est noté", () => {
  const h = harness(bloom);
  const { c, photo } = h;
  reply(c, "here"); addPhoto(c, photo());
  startProblem(c); chooseKind(c, "Gas smell");
  assert.deepEqual(syncPlan(c, { newIdem: h.newIdem, active: false }), []);
  assert.deepEqual(finishPlan(c, { newIdem: h.newIdem, active: false }), []);
  assert.equal(c.sync, undefined);
});

test("✓ puis ✓✓ : une bulle passe à ✓✓ quand la réponse 2xx de son idem arrive ; les bulles sans écriture suivent finishJob", () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  reply(c, "here"); sync();
  addPhoto(c, photo()); sync();
  reply(c, "next-room"); sync();
  refreshTicks(c);
  const mine = () => c.messages.filter(m => m.from === "me").map(m => m.status);
  assert.deepEqual(mine(), ["saved", "saved", "saved"]);
  assert.equal(ackSync(c, "idem0001", { status: "success" }), true);
  assert.equal(ackSync(c, "idem-autre", {}), false, "idem d'une autre conversation");
  assert.equal(refreshTicks(c), true);
  assert.deepEqual(mine(), ["synced", "saved", "saved"]);
  ackSync(c, "idem0002", { status: "success", photoId: 5 }); refreshTicks(c);
  assert.deepEqual(mine(), ["synced", "synced", "saved"]);
  c.i = c.steps.findIndex(s => s.id === "report");
  h.finish(); reply(c, "send-text"); reply(c, "send");
  assert.equal(finishAcked(c), false);
  ackSync(c, "idem0003", { status: "success" }); refreshTicks(c);
  assert.equal(finishAcked(c), true);
  assert.ok(c.messages.filter(m => m.from === "me").every(m => m.status === "synced"));
});

test("un problème en attente de photo garde ✓ même après finishJob", () => {
  const h = harness(bloom);
  const { c, sync } = h;
  reply(c, "here"); sync();
  startProblem(c); chooseKind(c, "Stain"); flowReply(c, "no-photo"); flowReply(c, "no-note"); sync();
  c.i = c.steps.findIndex(s => s.id === "report");
  h.finish(); reply(c, "send-text"); reply(c, "send");
  ackSync(c, "idem0001", {}); ackSync(c, h.sent.at(-1).body.idem, {}); refreshTicks(c);
  const prob = c.messages.find(m => m.type === "problem");
  assert.equal(prob.status, "saved");
});

test("mise en file ratée une fois (stockage plein) : l'action et ses dépendantes sont défaites, puis réémises au geste suivant", async () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  const queued = [];
  let fails = 1;
  const run = async a => { if (fails > 0) { fails -= 1; throw new Error("QuotaExceededError"); } queued.push(a); };
  const failed = new Set();
  reply(c, "here", { now: at(10, 0) }); await runActions(c, sync(), run, failed);
  assert.deepEqual(queued, []);
  assert.equal(c.sync.started, null, "startJob défait");
  startProblem(c); chooseKind(c, "Leak", { now: at(10, 1) });
  addFlowPhoto(c, photo());
  // startJob réémis, puis la photo et son signalement.
  assert.equal(await runActions(c, sync(), run, failed), 0);
  assert.deepEqual(queued.map(brief), ["startJob idem0002", "uploadPhoto problem idem0004", "reportProblem Leak idem0004 idem0003"]);
  // Échec du téléversement de la 2e photo : son rattachement ne part pas.
  fails = 1;
  addFlowPhoto(c, photo());
  assert.equal(await runActions(c, sync(), run, failed), 2);
  assert.equal(queued.length, 3);
  // Geste suivant : la photo repart avec une nouvelle clé, puis son rattachement.
  flowReply(c, "photos-done");
  await runActions(c, sync(), run, failed);
  assert.deepEqual(queued.slice(3).map(brief), ["uploadPhoto problem idem0007", "addProblemPhoto idem0003 idem0007"]);
});

test("signalement dont la photo n'a pas pu entrer en file : le signalement ne part pas, la photo et lui repartent ensemble", async () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  const queued = [];
  let fails = 0;
  const run = async a => { if (a.action === "v3.uploadPhoto" && fails > 0) { fails -= 1; throw new Error("full"); } queued.push(a); };
  const failed = new Set();
  reply(c, "here", { now: at(10, 0) }); await runActions(c, sync(), run, failed);
  startProblem(c); chooseKind(c, "Leak", { now: at(10, 1) });
  fails = 1;
  addFlowPhoto(c, photo());
  assert.equal(await runActions(c, sync(), run, failed), 2);
  assert.deepEqual(queued.map(brief), ["startJob idem0001"]);
  flowReply(c, "photos-done");
  await runActions(c, sync(), run, failed);
  assert.deepEqual(queued.slice(1).map(brief), ["uploadPhoto problem idem0004", "reportProblem Leak idem0004 idem0002"]);
});

test("type à photo facultative choisi sur une tuile (hors Gas smell) : rien tant que l'écran de photos est ouvert ; Back n'envoie rien", () => {
  const h = harness(bloom);
  const { c, sync } = h;
  reply(c, "here", { now: at(10, 0) }); sync();
  // Aucune tuile de ce type aujourd'hui : on simule une tuile « Wi-Fi not working ».
  startProblem(c); chooseKind(c, "Leak", { now: at(10, 1) }); c.problems[0].kind = "Wi-Fi not working";
  assert.deepEqual(sync(), []);
  flowReply(c, "back"); sync();
  assert.equal(c.problems.length, 0);
  assert.deepEqual(h.sent.map(brief), ["startJob idem0001"]);
  // Même tuile, puis « No photo » : le signalement part en quittant l'écran de photos.
  chooseKind(c, "Leak", { now: at(10, 2) }); c.problems[0].kind = "Wi-Fi not working";
  assert.deepEqual(sync(), []);
  flowReply(c, "no-photo");
  assert.deepEqual(sync().map(brief), ["reportProblem Wi-Fi not working - idem0003"]);
});

// ---- Carte d'accès (22/10) ----

test("carte d'accès : téléversée en arrival:Access card avant les pièces ; Card is missing signalé tout de suite, sans photo", () => {
  const h = harness(bloom);
  const { c, sync, photo } = h;
  reply(c, "here", { now: at(10, 0) });
  addPhoto(c, photo()); reply(c, "next-room");
  addPhoto(c, photo());
  // Un seul passage : la carte part avant la photo de la pièce, quel que soit l'ordre des magasins.
  assert.deepEqual(sync().map(brief), ["startJob idem0001", "uploadPhoto arrival:Access card idem0002", "uploadPhoto arrival:Bed idem0003"]);
  assert.equal(h.sent[1].body.jobId, bloom.id);
  assert.equal(h.sent[1].file, c.arrivalPhotos["Access card"][0].file);
  const m = harness(bloom);
  reply(m.c, "here", { now: at(10, 0) }); m.sync();
  reply(m.c, "card-missing", { now: at(10, 1) });
  const a = m.sync();
  assert.deepEqual(a.map(brief), ["reportProblem Access card missing - idem0002"]);
  assert.equal(a[0].body.where, "Entrance & building");
  assert.equal(a[0].body.urgency, "soon");
  assert.equal("photoIdem" in a[0].body, false);
});
