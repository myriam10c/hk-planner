// Reprise après rechargement (tâche 5 du branchement) : la conversation passe par JSON et revient
// identique, au même endroit, sans qu'aucun geste déjà parti ne soit réémis.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, DAY, ME } from "./fixtures.js";
import {
  createConversation, reply, addPhoto, startProblem, chooseKind, addFlowPhoto, flowReply, currentStep, currentFlow,
} from "../../v3/conv/conversation.js";
import { syncPlan } from "../../v3/conv/sync.js";
import { serializeConversation, deserializeConversation, photoIdems, dayCopy, usableDayCopy } from "../../v3/conv/persist.js";

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
  reply(c, "walls-ok"); reply(c, "no-damage"); reply(c, "send-arrival-text"); reply(c, "send-arrival"); reply(c, "linen-yes");
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
  rp(c, "walls-ok", { now: t }); rp(c, "no-damage", { now: t }); rp(c, "send-arrival-text", { now: new Date(2026, 9, 26, 10, 7) }); rp(c, "send-arrival", { now: new Date(2026, 9, 26, 10, 7) });
  const back = des(JSON.parse(JSON.stringify(ser(c))), k => ({ url: "x", file: null, idem: k }));
  assert.ok(back.arrivalSentAt instanceof Date);
  assert.match(rt(back, { now: t }), /\(sent 10:07\)/);
  // Ancienne sauvegarde : l'heure en texte ne casse plus le rapport.
  back.arrivalSentAt = new Date(2026, 9, 26, 10, 7).toISOString();
  assert.match(rt(back, { now: t }), /\(sent 10:07\)/);
});

// Photos de référence (tâche 4, correction 1) : l'instant d'obtention de chaque URL part avec la conversation.
test("l'instant des photos de référence est gardé et restauré avec la conversation", () => {
  const apt = { ...bloom, roomPhotos: { ...bloom.roomPhotos }, roomPhotosAt: { Bed: 1234, Kitchen: 5678 } };
  const c = createConversation(apt, { me: ME, now: at(9, 0) });
  const { back } = roundTrip(c);
  assert.deepEqual(back.apt.roomPhotosAt, { Bed: 1234, Kitchen: 5678 });
  assert.deepEqual(back.apt.roomPhotos, apt.roomPhotos);
});

// Copie de la journée (tâche 6 du lot 1) : la dernière lecture réussie de v3.myDay est gardée à
// part des conversations, pour la personne et le jour de Dubaï de cette lecture, avec l'instant réel
// de la lecture. Sans réseau au démarrage, la liste du jour s'affiche depuis elle.
const LU = Date.parse("2026-10-02T07:42:00Z"); // 11:42 à Dubaï
const AUJ = "2026-10-02";

test("copie de la journée : personne, jour de Dubaï et instant de la lecture, avec la journée entière", () => {
  const copie = dayCopy(DAY, LU);
  assert.deepEqual(copie, { me: "4", date: AUJ, at: LU, day: DAY });
  // Elle passe par le stockage sans rien perdre.
  assert.deepEqual(usableDayCopy(JSON.parse(JSON.stringify(copie)), { today: AUJ, me: "4" }), { day: DAY, at: LU });
});

test("copie de la journée : jamais d'une journée View as, ni sans personne, ni sans date", () => {
  assert.equal(dayCopy({ ...DAY, viewAs: true, viewer: { id: 9, name: "Hillal" } }, LU), null);
  assert.equal(dayCopy({ ...DAY, me: null }, LU), null);
  assert.equal(dayCopy({ ...DAY, date: undefined }, LU), null);
  assert.equal(dayCopy(null, LU), null);
});

test("copie d'un autre jour de Dubaï : jamais utilisée (à purger)", () => {
  const copie = dayCopy(DAY, LU);
  assert.equal(usableDayCopy(copie, { today: "2026-10-03", me: "4" }), null);
  assert.equal(usableDayCopy(copie, { today: "2026-10-01" }), null);
  // Journée dont la date ne dit pas celle de la copie : incohérente, jamais utilisée.
  assert.equal(usableDayCopy({ ...copie, day: { ...DAY, date: "2026-10-01" } }, { today: AUJ }), null);
});

test("copie d'une autre personne : jamais utilisée (à purger) ; identité du téléphone inconnue : acceptée", () => {
  const copie = dayCopy(DAY, LU);
  assert.equal(usableDayCopy(copie, { today: AUJ, me: "9" }), null);
  assert.deepEqual(usableDayCopy(copie, { today: AUJ, me: null }), { day: DAY, at: LU });
  assert.deepEqual(usableDayCopy(copie, { today: AUJ }), { day: DAY, at: LU });
  // Copie incohérente (la personne gardée n'est pas celle de la journée), ou journée View as.
  assert.equal(usableDayCopy({ ...copie, me: "9" }, { today: AUJ }), null);
  assert.equal(usableDayCopy({ ...copie, day: { ...DAY, viewAs: true } }, { today: AUJ }), null);
});

test("copie sans instant (journée gardée avec les conversations avant ce lot) : instant 0, photos tenues pour périmées", () => {
  const ancienne = { me: "4", date: AUJ, activeId: null, screen: "list", convs: {}, day: DAY };
  assert.deepEqual(usableDayCopy(ancienne, { today: AUJ, me: "4" }), { day: DAY, at: 0 });
  assert.deepEqual(usableDayCopy({ ...dayCopy(DAY, LU), at: "x" }, { today: AUJ }), { day: DAY, at: 0 });
  assert.equal(dayCopy(DAY, undefined).at, 0);
  // Conversations gardées sans journée (forme de ce lot) : rien à afficher.
  assert.equal(usableDayCopy({ me: "4", date: AUJ, convs: {} }, { today: AUJ }), null);
  assert.equal(usableDayCopy(null, { today: AUJ }), null);
  assert.equal(usableDayCopy("x", { today: AUJ }), null);
});
