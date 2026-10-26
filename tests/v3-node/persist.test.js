// Reprise après rechargement (tâche 5 du branchement) : la conversation passe par JSON et revient
// identique, au même endroit, sans qu'aucun geste déjà parti ne soit réémis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME } from "./fixtures.js";
import {
  createConversation, reply, addPhoto, startProblem, chooseKind, addFlowPhoto, flowReply, currentStep, currentFlow,
} from "../../v3/conv/conversation.js";
import { syncPlan } from "../../v3/conv/sync.js";
import { serializeConversation, deserializeConversation, photoIdems } from "../../v3/conv/persist.js";

const [oxford, , bloom] = APARTMENTS;
const at = (h, m) => new Date(2026, 9, 2, h, m);

function setup(apt) {
  let n = 0;
  const newIdem = () => "idem" + String(++n).padStart(4, "0");
  let k = 0;
  const photo = () => ({ url: "blob:" + (++k), file: { name: "p" + k } });
  const c = createConversation(apt, { me: ME, now: at(9, 0) });
  return { c, newIdem, photo, sync: () => syncPlan(c, { newIdem }) };
}

const roundTrip = (c, files = {}) => {
  const json = JSON.parse(JSON.stringify(serializeConversation(c)));
  return { json, back: deserializeConversation(json, idem => (files[idem] ? { url: "blob:new-" + idem, file: files[idem], idem } : null)) };
};

test("au milieu de l'étape 4 : même étape, mêmes photos, même ordre, rien de réémis", () => {
  const { c, photo, sync } = setup(bloom);
  reply(c, "here", { now: at(10, 0) }); sync();
  addPhoto(c, photo()); sync(); reply(c, "next-room"); // carte d'accès (22/10)
  for (let i = 0; i < 3; i++) { addPhoto(c, photo()); sync(); reply(c, "next-room"); }
  reply(c, "walls-ok"); reply(c, "no-damage"); reply(c, "send-arrival"); reply(c, "linen-yes");
  addPhoto(c, photo()); sync(); reply(c, "next-room"); sync();
  assert.equal(currentStep(c).id, "end-photo");
  assert.equal(currentStep(c).room, "Bathroom");
  const { json, back } = roundTrip(c, { idem0002: { name: "p1" }, idem0003: { name: "p2" } });
  assert.deepEqual(photoIdems(json).sort(), ["idem0002", "idem0003", "idem0004", "idem0005", "idem0006"]);
  assert.equal(currentStep(back).id, "end-photo");
  assert.equal(currentStep(back).room, "Bathroom");
  assert.equal(currentStep(back).n, 4);
  assert.equal(back.gestures, c.gestures);
  assert.equal(back.startedAt.getTime(), at(10, 0).getTime());
  // Une seule photo, partagée entre la bulle et le magasin de la pièce.
  const [carte, bulle] = back.messages.filter(m => m.type === "photo");
  assert.equal(carte.photo, back.arrivalPhotos["Access card"][0]);
  assert.equal(carte.photo.url, "blob:new-idem0002");
  assert.equal(bulle.photo, back.arrivalPhotos.Bed[0]);
  assert.equal(bulle.photo.url, "blob:new-idem0003");
  assert.equal(back.arrivalPhotos.Bathroom[0].url, null, "octets absents : photo sans image, clé gardée");
  assert.deepEqual(syncPlan(back, { newIdem: () => "nouvelle" }), []);
});

test("signalement en cours, ligne de sortie reliée : les liens d'identité sont reconstruits", () => {
  const { c, photo, sync } = setup(oxford);
  reply(c, "here", { now: at(10, 0) }); sync();
  startProblem(c); chooseKind(c, "AC"); addFlowPhoto(c, photo()); sync();
  const { back } = roundTrip(c);
  const f = currentFlow(back);
  assert.equal(f.stage, "photos");
  assert.equal(f.problem, back.problems[0]);
  assert.equal(back.problems[0].photos.length, 1);
  flowReply(back, "photos-done"); flowReply(back, "no-note");
  // Étape 5 : la ligne AC est pré-réglée sur le problème AC repris.
  back.i = back.steps.findIndex(s => s.id === "leave") - 1;
  addPhoto(back, photo()); reply(back, "next-room");
  syncPlan(back, { newIdem: () => "idem0099" });
  assert.equal(currentStep(back).id, "leave");
  assert.equal(back.leave.ac, "ko");
  const { back: again } = roundTrip(back);
  assert.equal(again.leaveProblems.ac, again.problems[0]);
  assert.equal(again.leave.ac, "ko");
  assert.deepEqual(syncPlan(again, { newIdem: () => "nouvelle" }), []);
});

test("version inconnue ou donnée illisible : pas de reprise", () => {
  assert.equal(deserializeConversation(null, () => null), null);
  assert.equal(deserializeConversation({ v: 99 }, () => null), null);
});

test("envoi d'arrivée relu après rechargement : l'heure reste une Date, le rapport s'affiche", async () => {
  const { createConversation: cc, reply: rp, addPhoto: ap } = await import("../../v3/conv/conversation.js");
  const { reportText: rt } = await import("../../v3/conv/report.js");
  const { serializeConversation: ser, deserializeConversation: des } = await import("../../v3/conv/persist.js");
  const { APARTMENTS: A, ME: M } = await import("./fixtures.js");
  const bloom = A[2];
  const t = new Date(2026, 9, 26, 10, 0);
  const c = cc(bloom, { me: M, now: t });
  rp(c, "here", { now: t });
  for (let i = 0; i < 4; i++) { ap(c, { url: "u" + i, file: null, idem: "p" + i }); rp(c, "next-room", { now: t }); }
  rp(c, "walls-ok", { now: t }); rp(c, "no-damage", { now: t }); rp(c, "send-arrival", { now: new Date(2026, 9, 26, 10, 7) });
  const back = des(JSON.parse(JSON.stringify(ser(c))), k => ({ url: "x", file: null, idem: k }));
  assert.ok(back.arrivalSentAt instanceof Date);
  assert.match(rt(back, { now: t }), /\(sent 10:07\)/);
  // Ancienne sauvegarde : l'heure en texte ne casse plus le rapport.
  back.arrivalSentAt = new Date(2026, 9, 26, 10, 7).toISOString();
  assert.match(rt(back, { now: t }), /\(sent 10:07\)/);
});
