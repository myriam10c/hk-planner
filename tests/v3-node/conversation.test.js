import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME, REF } from "./fixtures.js";
import { createConversation, currentStep, reply, addPhoto, addProblem, editProblem, removeProblem, attachProblemPhoto, addProblemPhoto, setProblemNote, isHelper, elapsedMinutes, STEP_TITLES,
  startProblem, chooseKind, addFlowPhoto, flowReply, flowBack, currentFlow, reopenProblem, removeArrivalOrEndPhoto } from "../../v3/conv/conversation.js";

const [oxford, creek, bloom] = APARTMENTS;
const at = (h, m, d = 2) => new Date(2026, 9, d, h, m);
const leaveAll = (c, t) => ["gas", "ac", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: t }));
// Une photo puis Next room, pour chaque pièce restante de l'étape photo en cours.
const rooms = (c, n, photo, t = at(10, 1)) => { for (let i = 0; i < n; i++) { addPhoto(c, photo, { now: t }); reply(c, "next-room", { now: t }); } };

function studioToReport(c) {
  reply(c, "here", { now: at(10, 0) });
  for (const room of ["Bed", "Bathroom", "Kitchen"]) { assert.equal(currentStep(c).room, room); addPhoto(c, "a-" + room, { now: at(10, 2) }); reply(c, "next-room", { now: at(10, 2) }); }
  assert.equal(currentStep(c).id, "walls");
  reply(c, "walls-ok", { now: at(10, 5) }); reply(c, "no-damage", { now: at(10, 5) });
  reply(c, "linen-yes", { now: at(10, 6) });
  for (const room of ["Bed", "Bathroom", "Kitchen"]) { assert.equal(currentStep(c).room, room); addPhoto(c, "e-" + room, { now: at(11, 20) }); reply(c, "next-room", { now: at(11, 20) }); }
  assert.equal(currentStep(c).id, "leave");
  leaveAll(c, at(11, 35));
  reply(c, "low-done", { now: at(11, 36) });
}

test("titres et numéros d'étape", () => {
  assert.deepEqual(STEP_TITLES, { 1: "Arrival", 2: "Damage & problems", 3: "Dirty linen", 4: "Room by room", 5: "Leave & send" });
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  assert.equal(currentStep(c).n, 1);
  assert.equal(currentStep(c).title, "Arrival");
});

test("studio sans problème : exactement 25 gestes jusqu'à l'envoi", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  studioToReport(c);
  assert.equal(currentStep(c).id, "report");
  assert.equal(currentStep(c).n, 5);
  reply(c, "send", { now: at(11, 40) });
  assert.equal(c.gestures, 25, "here 1 + 3 × (photo + Next room) + Walls OK + No, all good + linge + 3 × (photo + Next room) + 7 lignes + Nothing + Send");
  assert.equal(c.sent, true);
  assert.equal(elapsedMinutes(c, at(12, 0)), 100);
  assert.deepEqual(Object.keys(c.arrivalPhotos), ["Bed", "Bathroom", "Kitchen"]);
  assert.deepEqual(Object.keys(c.endPhotos), ["Bed", "Bathroom", "Kitchen"]);
});

test("étape 1 : photo de référence = dernière photo de fin du ménage précédent, caméra ouverte", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  const st = currentStep(c);
  assert.equal(st.id, "arrival-photo");
  assert.equal(st.camera, true);
  assert.equal(st.ref, REF("bl-Bed"));
  assert.equal(st.n, 1);
});

test("plusieurs photos dans une pièce, puis Next room", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  assert.deepEqual(currentStep(c).replies.map(r => [r.id, r.label]), [["next-room", "Next room"]]);
  addPhoto(c, "p1", { now: at(10, 1) });
  addPhoto(c, "p2", { now: at(10, 1) });
  addPhoto(c, "p3", { now: at(10, 1) });
  assert.equal(currentStep(c).room, "Bed", "le déclencheur ne change jamais de pièce");
  assert.equal(c.arrivalPhotos.Bed.length, 3);
  assert.equal(c.messages.filter(m => m.type === "photo").length, 3);
  const g = c.gestures;
  reply(c, "next-room", { now: at(10, 2) });
  assert.equal(c.gestures, g + 1);
  assert.equal(currentStep(c).room, "Bathroom");
  assert.equal(c.arrivalPhotos.Bathroom, undefined);
  assert.equal("keepRoom" in c, false);
});

test("Next room désactivé tant que la pièce n'a pas de photo (étapes 1 et 4)", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  assert.equal(currentStep(c).replies[0].enabled, false);
  const g = c.gestures;
  reply(c, "next-room", { now: at(10, 1) });
  assert.equal(currentStep(c).room, "Bed");
  assert.equal(c.gestures, g);
  addPhoto(c, "p", { now: at(10, 1) });
  assert.equal(currentStep(c).replies[0].enabled, true);
  reply(c, "next-room", { now: at(10, 1) });
  assert.equal(currentStep(c).replies[0].enabled, false, "pièce suivante : de nouveau désactivé");
  rooms(c, 2, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  assert.equal(currentStep(c).id, "end-photo");
  assert.equal(currentStep(c).replies[0].enabled, false);
  addPhoto(c, "e1", { now: at(11, 0) }); addPhoto(c, "e2", { now: at(11, 0) });
  assert.equal(currentStep(c).room, "Bed");
  assert.equal(c.endPhotos.Bed.length, 2);
  assert.equal(c.messages.filter(m => m.type === "text" && m.from === "app" && m.text === "Bed: make it look like this.").length, 1, "bulle modèle de l'étape 4 gardée");
});

test("une réponse étrangère à l'étape ne compte rien", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  reply(c, "here", { now: at(10, 0) });
  reply(c, "no-damage", { now: at(10, 0) });
  assert.equal(c.gestures, 1);
});

test("problème pendant l'étape 1 : endroit = pièce en cours, l'étape n'avance pas", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Broken", "b", { now: at(10, 1) });
  assert.equal(c.problems[0].where, "Bed");
  assert.equal(currentStep(c).room, "Bed");
});

test("étape 2 : Yes, report it ouvre l'écran des tuiles ; après le problème, Another problem / No more", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) });
  const g = c.gestures;
  reply(c, "some-damage", { now: at(10, 2) });
  assert.equal(c.gestures, g + 1, "Yes, report it : un geste, pas de second pour l'ouverture");
  assert.equal(currentStep(c).camera, false, "plus de viseur à tuiles");
  assert.equal(currentFlow(c).stage, "kind");
  assert.equal(currentFlow(c).from, "damage");
  chooseKind(c, "Stain", { now: at(10, 3) });
  assert.equal(c.problems[0].where, "Whole apartment");
  addFlowPhoto(c, "s");
  flowReply(c, "photos-done");
  flowReply(c, "no-note");
  assert.equal(c.flow, null);
  assert.equal(c.messages.filter(m => m.from === "app").at(-1).text, "Anything else?");
  assert.deepEqual(currentStep(c).replies.map(r => [r.id, r.label]), [["another-problem", "Another problem"], ["damage-done", "No more"]]);
  reply(c, "another-problem", { now: at(10, 4) });
  assert.equal(currentFlow(c).stage, "kind");
  flowReply(c, "cancel");
  assert.equal(c.flow, null);
  assert.deepEqual(currentStep(c).replies.map(r => r.id), ["another-problem", "damage-done"], "annuler le second : la question reste");
  reply(c, "damage-done", { now: at(10, 4) });
  assert.equal(c.damage, "some");
  assert.equal(currentStep(c).id, "linen");
  assert.equal(currentStep(c).n, 3);
});

test("étape 2 : Yes, report it puis Cancel sans problème : la question de départ revient", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) });
  reply(c, "some-damage", { now: at(10, 2) });
  flowReply(c, "cancel");
  assert.deepEqual(currentStep(c).replies.map(r => r.id), ["no-damage", "some-damage"]);
  reply(c, "no-damage", { now: at(10, 3) });
  assert.equal(c.damage, "none");
});

test("vérification du manager : I see insects, type imposé Insects, écran des photos, puis la suite", () => {
  const c = createConversation(oxford, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  assert.equal(currentStep(c).id, "check");
  assert.equal(currentStep(c).n, 2);
  assert.equal(currentStep(c).camera, false);
  reply(c, "check-see", { now: at(10, 2) });
  const f = currentFlow(c);
  assert.equal(f.stage, "photos", "tuiles sautées : type imposé");
  assert.equal(f.title, "Insects · Whole apartment");
  addFlowPhoto(c, "bug");
  flowReply(c, "photos-done");
  flowReply(c, "no-note");
  assert.equal(c.problems[0].kind, "Insects");
  assert.equal(c.problems[0].urgency, "soon", "Insects : Soon par défaut, même avec un voyageur dans 3 h");
  assert.equal(c.problems[0].notified, false);
  assert.equal(currentStep(c).id, "walls", "vérification, puis murs, puis dégâts");
});

test("odeur de gaz : urgent, consigne de sécurité dans le fil", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Gas smell", null, { now: at(10, 1) });
  assert.equal(c.problems[0].urgency, "urgent");
  assert.equal(c.messages.at(-1).from, "app");
  assert.equal(c.messages.at(-1).text, "Open the windows. Do not touch switches. Leave and call Walter.");
});

test("étape 4 : photo de fin, référence = ménage précédent, une photo par pièce", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) });
  reply(c, "linen-yes", { now: at(10, 3) });
  const st = currentStep(c);
  assert.equal(st.id, "end-photo");
  assert.equal(st.n, 4);
  assert.equal(st.room, "Bed");
  assert.equal(st.ref, REF("bl-Bed"));
  assert.equal(c.messages.at(-1).text, "Bed: make it look like this.");
});

test("étape 5 : les sept coches, bascule, avance seule quand tout est coché", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 3, "e", at(11, 0));
  const st = currentStep(c);
  assert.equal(st.id, "leave");
  assert.deepEqual(st.replies.map(r => [r.id, r.label]), [
    ["leave:gas", "Gas works, now off"], ["leave:gas-ko", "Gas not working"], ["leave:ac", "AC on, Auto mode"], ["leave:ac-ko", "AC not working"],
    ["leave:wifi", "Wi-Fi works"], ["leave:wifi-ko", "Wi-Fi not working"], ["leave:lights", "Lights off"],
    ["leave:windows", "Windows & balcony closed"], ["leave:trash", "Trash taken out"], ["leave:door", "Door locked, key back"]]);
  reply(c, "leave:gas", { now: at(11, 1) });
  reply(c, "leave:gas", { now: at(11, 1) });
  assert.equal(c.leave.gas, false);
  leaveAll(c, at(11, 2));
  assert.equal(currentStep(c).id, "low");
});

test("consigne AC figée au début du ménage", () => {
  const c = createConversation(bloom, { me: ME, now: new Date(2026, 9, 31, 22, 0) });
  assert.equal(c.acLabel, "AC on, Auto mode");
  const w = createConversation(bloom, { me: ME, now: new Date(2026, 10, 2, 9, 0) });
  assert.equal(w.acLabel, "AC off");
});

test("I can't get in : problème urgent à l'entrée, puis I'm in now", () => {
  const c = createConversation(oxford, { me: ME, now: at(9, 0) });
  reply(c, "cant-get-in", { now: at(10, 0) });
  assert.equal(c.problems[0].where, "Entrance & building");
  reply(c, "in-now", { now: at(10, 20) });
  assert.equal(currentStep(c).id, "arrival-photo");
  assert.deepEqual(c.startedAt, at(10, 20));
});

test("appartement à deux : I'm here, toutes les pièces en étape 4 (pièces faites par Pionah inconnues), puis Add to Pionah's report", () => {
  const c = createConversation(creek, { me: ME, now: at(9, 0) });
  assert.equal(isHelper(c), true);
  reply(c, "here", { now: at(10, 30) });
  const done = [];
  while (currentStep(c).id === "end-photo") { done.push(currentStep(c).room); rooms(c, 1, "r", at(11, 0)); }
  assert.deepEqual(done, ["Bedroom 1", "Bedroom 2", "Living room", "Kitchen", "Bathroom 1", "Bathroom 2", "Balcony"]);
  assert.equal(currentStep(c).id, "helper");
  reply(c, "add-to-lead", { now: at(12, 0) });
  assert.equal(currentStep(c).id, "done");
  assert.equal(c.sent, true);
});

test("linge, fournitures, modification et suppression d'un problème", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) });
  reply(c, "linen-change", { now: at(10, 3) });
  assert.equal(currentStep(c).editor, "linen");
  reply(c, "linen-dec:pillowcases", { now: at(10, 3) });
  reply(c, "linen-ok", { now: at(10, 4) });
  assert.equal(c.linen.pillowcases, 3);
  addProblem(c, "Broken", "b", { now: at(10, 5) });
  assert.equal(c.problems[0].where, "Bed");
  editProblem(c, 0, { detail: "Sofa" });
  assert.equal(c.problems[0].detail, "Sofa");
  removeProblem(c, 0);
  assert.equal(c.problems.length, 0);
  rooms(c, 3, "e", at(11, 0));
  leaveAll(c, at(11, 1));
  reply(c, "low:Toilet paper", { now: at(11, 2) });
  assert.equal(currentStep(c).replies.at(-1).label, "That's it");
  reply(c, "low-done", { now: at(11, 2) });
  assert.equal(currentStep(c).id, "report");
});

test("Share again après l'envoi : ni geste ni bulle", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  studioToReport(c);
  reply(c, "send", { now: at(11, 40) });
  const g = c.gestures, n = c.messages.length;
  assert.deepEqual(currentStep(c).replies.map(r => r.id), ["share-again"]);
  reply(c, "share-again", { now: at(11, 41) });
  assert.equal(c.gestures, g);
  assert.equal(c.messages.length, n);
});

test("étape 5 : encore à l'étape leave à 6 lignes sur 7", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 3, "e", at(11, 0));
  const n = c.messages.length;
  ["gas", "ac", "wifi", "lights", "windows", "trash"].forEach(k => reply(c, "leave:" + k, { now: at(11, 1) }));
  assert.equal(currentStep(c).id, "leave");
  assert.equal(c.messages.length, n, "pas de bulle « All checked » avant la septième");
  reply(c, "leave:door", { now: at(11, 2) });
  assert.equal(currentStep(c).id, "low");
});

test("All checked : libellés joints par « · », la consigne AC reste d'un seul tenant", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 3, "e", at(11, 0));
  leaveAll(c, at(11, 2));
  const said = c.messages.filter(m => m.from === "me" && /^All checked/.test(m.text || ""));
  assert.equal(said.length, 1);
  assert.equal(said[0].text, "All checked: Gas works, now off · AC on, Auto mode · Wi-Fi works · Lights off · Windows & balcony closed · Trash taken out · Door locked, key back");
});

test("étape 4, pièce sans photo d'annonce : « clean it, then take a photo », sans image", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 1, "e", at(11, 0)); // Bed (avec photo) → Bathroom (sans)
  assert.equal(currentStep(c).room, "Bathroom");
  const m = c.messages.at(-1);
  assert.equal(m.text, "Bathroom: clean it, then take a photo.");
  assert.equal(m.photo, undefined);
  // 1506 Creekside (l'aide) : Bathroom 2 et Balcony sans photo, Bathroom 1 avec
  const h = createConversation(creek, { me: ME, now: at(9, 0) });
  reply(h, "here", { now: at(10, 0) });
  const texts = [];
  while (currentStep(h).id === "end-photo") { texts.push(h.messages.filter(m => m.from === "app").at(-1).text); rooms(h, 1, "r", at(11, 0)); }
  assert.deepEqual(texts.slice(4), ["Bathroom 1: make it look like this.", "Bathroom 2: clean it, then take a photo.", "Balcony: clean it, then take a photo."]);
});

test("photo jointe après coup à un problème (Gas smell) ; problème supprimé entre-temps : ignorée", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Gas smell", null, { now: at(10, 1) });
  const p = c.problems[0], g = c.gestures;
  assert.equal(p.photos.length, 0);
  attachProblemPhoto(c, p, "gas.jpg");
  assert.deepEqual(p.photos, ["gas.jpg"]);
  assert.equal(c.gestures, g, "la photo jointe n'est pas un geste de plus");
  attachProblemPhoto(c, p, null);
  assert.equal(p.photos.length, 1);
  removeProblem(c, 0);
  attachProblemPhoto(c, p, "late.jpg");
  assert.equal(p.photos.length, 1);
});

test("plusieurs photos et une note par problème", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Broken", "b1", { now: at(10, 1) });
  const g = c.gestures;
  addProblemPhoto(c, 0, "b2");
  addProblemPhoto(c, 0, "b3");
  assert.deepEqual(c.problems[0].photos, ["b1", "b2", "b3"]);
  assert.equal(c.gestures, g + 2, "une photo ajoutée = un geste");
  addProblemPhoto(c, 5, "x"); addProblemPhoto(c, 0, null);
  assert.equal(c.problems[0].photos.length, 3);
  assert.equal(c.gestures, g + 2, "index absent ou photo vide : rien");
  assert.equal(c.problems[0].note, null);
  setProblemNote(c, 0, "  tear on the\n left   cushion ");
  assert.equal(c.problems[0].note, "tear on the left cushion");
  assert.equal(c.gestures, g + 2, "la note n'est pas un geste");
  setProblemNote(c, 0, "   ");
  assert.equal(c.problems[0].note, null);
  setProblemNote(c, 0, "x".repeat(400));
  assert.equal(c.problems[0].note.length, 300);
  setProblemNote(c, 9, "rien");
  assert.equal(c.problems.length, 1);
});

const toLeaveStep = c => {
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 3, "e", at(11, 0));
  assert.equal(currentStep(c).id, "leave");
};

test("gaz not working : problème Soon créé, ligne traitée ; works ensuite : problème supprimé", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  toLeaveStep(c);
  const g = c.gestures;
  reply(c, "leave:gas-ko", { now: at(11, 1) });
  assert.equal(c.gestures, g + 1);
  assert.equal(c.leave.gas, "ko");
  assert.deepEqual(c.problems.map(p => [p.kind, p.urgency, p.where, p.notified]), [["Gas not working", "soon", "Whole apartment", false]]);
  assert.equal(c.messages.filter(m => m.type === "problem").length, 1);
  reply(c, "leave:gas", { now: at(11, 2) });
  assert.equal(c.leave.gas, true);
  assert.equal(c.problems.length, 0, "le problème créé par « not working » est supprimé");
  assert.equal(c.messages.filter(m => m.type === "problem").length, 0);
  // not working deux fois : la ligne revient à « non traitée », sans doublon
  reply(c, "leave:gas-ko", { now: at(11, 3) });
  reply(c, "leave:gas-ko", { now: at(11, 3) });
  assert.equal(c.leave.gas, false);
  assert.equal(c.problems.length, 0);
  // un problème ajouté entre-temps n'est jamais supprimé par erreur
  reply(c, "leave:gas-ko", { now: at(11, 4) });
  addProblem(c, "Broken", null, { now: at(11, 4) });
  reply(c, "leave:gas", { now: at(11, 5) });
  assert.deepEqual(c.problems.map(p => p.kind), ["Broken"]);
});

test("Wi-Fi not working, puis l'étape avance à 7 lignes traitées (true ou ko) ; All checked suit", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  toLeaveStep(c);
  reply(c, "leave:wifi-ko", { now: at(11, 1) });
  assert.equal(c.leave.wifi, "ko");
  assert.deepEqual(c.problems.map(p => [p.kind, p.urgency, p.where]), [["Wi-Fi not working", "soon", "Whole apartment"]]);
  reply(c, "leave:gas-ko", { now: at(11, 1) });
  ["ac", "lights", "windows", "trash"].forEach(k => reply(c, "leave:" + k, { now: at(11, 2) }));
  assert.equal(currentStep(c).id, "leave", "6 lignes sur 7");
  reply(c, "leave:door", { now: at(11, 3) });
  assert.equal(currentStep(c).id, "low");
  const said = c.messages.filter(m => m.from === "me" && /^All checked/.test(m.text || ""));
  assert.equal(said[0].text, "All checked: Gas not working · AC on, Auto mode · Wi-Fi not working · Lights off · Windows & balcony closed · Trash taken out · Door locked, key back");
  assert.equal(c.problems.length, 2);
});

test("étape 2 : question des murs avant celle des dégâts ; Walls OK", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  const st = currentStep(c);
  assert.equal(st.id, "walls");
  assert.equal(st.n, 2);
  assert.equal(st.camera, false);
  assert.equal(c.messages.filter(m => m.from === "app").at(-1).text, "Walls: any marks, holes or damage?");
  assert.deepEqual(st.replies.map(r => [r.id, r.label]), [["walls-ok", "Walls OK"], ["walls-ko", "Marks or damage"]]);
  reply(c, "walls-ok", { now: at(10, 2) });
  assert.equal(c.walls, "ok");
  assert.equal(currentStep(c).id, "damage");
});

test("murs abîmés : Wall damage imposé, écran des photos (2 photos), note, puis la question des dégâts", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  const g = c.gestures;
  reply(c, "walls-ko", { now: at(10, 2) });
  assert.equal(currentStep(c).id, "walls");
  assert.equal(currentStep(c).camera, false);
  let f = currentFlow(c);
  assert.equal(f.stage, "photos");
  assert.equal(f.title, "Wall damage · Whole apartment");
  assert.deepEqual(f.replies.map(r => [r.id, r.enabled]), [["photos-done", false], ["no-photo", true]]);
  flowReply(c, "photos-done");
  assert.equal(currentFlow(c).stage, "photos", "Done inactif sans photo");
  addFlowPhoto(c, "w1");
  addFlowPhoto(c, "w2");
  assert.deepEqual(c.problems.map(p => [p.kind, p.where, p.urgency, p.photos.length]), [["Wall damage", "Whole apartment", "soon", 2]]);
  assert.equal(c.messages.filter(m => m.type === "problem").length, 1, "une seule bulle de problème");
  assert.equal(c.arrivalPhotos.Kitchen.length, 1, "les photos des murs ne vont pas dans les pièces");
  flowReply(c, "photos-done");
  assert.equal(currentFlow(c).stage, "note");
  flowReply(c, "save-text", { text: "hole behind the door" });
  assert.equal(c.flow, null);
  assert.equal(c.walls, "some");
  assert.equal(currentStep(c).id, "damage");
  assert.equal(c.gestures, g + 5, "Marks or damage + 2 photos + Done + Save");
  assert.equal(c.problems[0].note, "hole behind the door");
});

test("Marks or damage touché par erreur : retour sans photo = problème retiré, la question des murs revient", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ko", { now: at(10, 2) });
  assert.equal(currentFlow(c).back, true);
  flowReply(c, "back");
  assert.equal(c.flow, null);
  assert.equal(c.problems.length, 0);
  assert.equal(c.walls, null);
  assert.equal(c.messages.some(m => m.text === "Marks or damage"), false, "bulle « Marks or damage » retirée : le fil reste cohérent");
  assert.deepEqual(currentStep(c).replies.map(r => r.id), ["walls-ok", "walls-ko"]);
  reply(c, "walls-ok", { now: at(10, 3) });
  assert.equal(c.walls, "ok");
  assert.equal(currentStep(c).id, "damage");
  // une photo prise : plus de retour arrière, seulement Done ou No photo
  const d = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(d, "here", { now: at(10, 0) });
  rooms(d, 3, "a");
  reply(d, "walls-ko", { now: at(10, 2) });
  addFlowPhoto(d, "w1");
  assert.equal(currentFlow(d).back, false);
  flowReply(d, "back");
  assert.equal(d.problems.length, 1);
  assert.equal(currentFlow(d).stage, "photos");
  // pas de murs pour l'aide
  const h = createConversation(creek, { me: ME, now: at(9, 0) });
  assert.equal(h.steps.some(s => s.id === "walls"), false);
});

test("double appui rapide sur Gas smell : pas de doublon à moins de 2 s", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  const t0 = new Date(2026, 9, 2, 10, 1, 0, 0);
  const plus = ms => new Date(t0.getTime() + ms);
  addProblem(c, "Gas smell", null, { now: t0 });
  const g = c.gestures, n = c.messages.length;
  addProblem(c, "Gas smell", null, { now: plus(1999) });
  assert.equal(c.problems.length, 1);
  assert.equal(c.gestures, g, "second appui ignoré : ni geste");
  assert.equal(c.messages.length, n, "ni bulle, ni seconde consigne");
  addProblem(c, "Gas smell", null, { now: plus(2000) });
  assert.equal(c.problems.length, 2, "à 2 s : un vrai second signalement");
  addProblem(c, "Leak", null, { now: plus(2100) }); addProblem(c, "Leak", null, { now: plus(2200) });
  assert.equal(c.problems.length, 4, "les autres types ne sont pas filtrés");
});

test("un problème non gaz depuis le viseur : Problem + tuile + photo + Done + No note = 5 gestes", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  const g = c.gestures;
  startProblem(c);
  let f = currentFlow(c);
  assert.equal(f.stage, "kind");
  assert.deepEqual(f.replies.map(r => r.id), ["cancel"]);
  chooseKind(c, "Leak", { now: at(10, 1) });
  f = currentFlow(c);
  assert.equal(f.stage, "photos");
  assert.equal(f.title, "Leak · Bed");
  assert.equal(c.problems[0].urgency, "soon");
  addFlowPhoto(c, "l1");
  flowReply(c, "photos-done");
  assert.equal(currentFlow(c).stage, "note");
  flowReply(c, "no-note");
  assert.equal(c.flow, null);
  assert.equal(c.gestures, g + 5);
  assert.deepEqual(c.problems.map(p => [p.kind, p.where, p.photos.length, p.note]), [["Leak", "Bed", 1, null]]);
  assert.equal("voice" in c.problems[0], false, "plus de note vocale");
  assert.equal(currentStep(c).room, "Bed", "retour à la même pièce");
});

test("écran des tuiles : Cancel ne crée rien ; retour depuis les photos = autre type", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  startProblem(c);
  flowReply(c, "cancel");
  assert.equal(c.flow, null);
  assert.equal(c.problems.length, 0);
  startProblem(c);
  chooseKind(c, "Broken", { now: at(10, 1) });
  flowReply(c, "back");
  assert.equal(currentFlow(c).stage, "kind");
  assert.equal(c.problems.length, 0, "type touché par erreur : retiré");
  assert.equal(c.messages.filter(m => m.type === "problem").length, 0);
  chooseKind(c, "Power", { now: at(10, 1) });
  flowReply(c, "no-photo");
  assert.equal(currentFlow(c).stage, "note");
  flowReply(c, "no-note");
  assert.deepEqual(c.problems.map(p => [p.kind, p.photos.length]), [["Power", 0]]);
  // une réponse de l'étape est ignorée pendant un signalement
  startProblem(c);
  const g = c.gestures;
  reply(c, "next-room", { now: at(10, 2) });
  assert.equal(c.gestures, g);
});

test("Gas smell depuis les tuiles : enregistré tout de suite (urgent), écran rouge, OK = fin ; double appui ignoré", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  const t0 = new Date(2026, 9, 2, 10, 1, 0, 0);
  startProblem(c);
  chooseKind(c, "Gas smell", { now: t0 });
  assert.deepEqual(c.problems.map(p => [p.kind, p.urgency, p.notified]), [["Gas smell", "urgent", true]]);
  assert.equal(currentFlow(c).stage, "gas");
  assert.deepEqual(currentFlow(c).replies.map(r => r.id), ["gas-ok"]);
  assert.equal(c.messages.at(-1).text, "Open the windows. Do not touch switches. Leave and call Walter.");
  chooseKind(c, "Gas smell", { now: new Date(t0.getTime() + 300) });
  assert.equal(c.problems.length, 1, "second appui : ignoré");
  const g = c.gestures;
  flowReply(c, "gas-ok");
  assert.equal(c.flow, null);
  assert.equal(c.gestures, g + 1);
  // second signalement 1 s après : refusé par la garde des 2 s, même depuis un nouvel écran des tuiles
  startProblem(c);
  chooseKind(c, "Gas smell", { now: new Date(t0.getTime() + 1000) });
  assert.equal(c.problems.length, 1);
  assert.equal(currentFlow(c).stage, "kind");
});

test("écran de note : texte seulement, Save (un geste) ou No note ; aucune API vocale", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  startProblem(c);
  chooseKind(c, "Broken", { now: at(10, 1) });
  addFlowPhoto(c, "b1");
  flowReply(c, "photos-done");
  const f = currentFlow(c);
  assert.equal(f.stage, "note");
  assert.deepEqual(f.replies.map(r => [r.id, r.label, r.enabled]), [["save-text", "Save", true], ["no-note", "No note", true]]);
  for (const gone of ["voice-done", "record-again", "type", "back-note"]) {
    const g = c.gestures;
    flowReply(c, gone);
    assert.equal(currentFlow(c).stage, "note", gone + " n'existe plus");
    assert.equal(c.gestures, g);
  }
  const g = c.gestures;
  flowReply(c, "save-text", { text: "  leg  broken " });
  assert.equal(c.flow, null);
  assert.equal(c.gestures, g + 1);
  assert.equal(c.problems[0].note, "leg broken");
});

test("le module conversation n'exporte plus de fonction vocale", async () => {
  const mod = await import("../../v3/conv/conversation.js");
  assert.equal(mod.addVoice, undefined);
  assert.equal(mod.setProblemVoice, undefined);
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  assert.equal("voices" in c, false);
});

test("page d'édition : ajouter une photo, modifier la note (Edit note), retour sans rien perdre", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Broken", "b1", { now: at(10, 1) });
  setProblemNote(c, 0, "small crack");
  reopenProblem(c, 0, "photos");
  let f = currentFlow(c);
  assert.equal(f.from, "edit");
  assert.equal(f.back, true, "depuis la page : retour toujours possible");
  assert.deepEqual(f.replies.map(r => r.id), ["photos-done"]);
  addFlowPhoto(c, "b2");
  flowReply(c, "photos-done");
  assert.equal(c.flow, null, "Done : retour à la page");
  assert.deepEqual(c.problems[0].photos, ["b1", "b2"]);
  reopenProblem(c, 0, "note");
  f = currentFlow(c);
  assert.equal(f.stage, "note");
  assert.deepEqual(f.replies.map(r => [r.id, r.label]), [["save-text", "Save"], ["no-note", "Back"]]);
  flowReply(c, "no-note");
  assert.equal(c.flow, null);
  assert.equal(c.problems[0].note, "small crack", "Back : la note reste");
  reopenProblem(c, 0, "note");
  flowReply(c, "save-text", { text: " big   crack " });
  assert.equal(c.problems[0].note, "big crack");
  assert.equal(c.flow, null);
  reopenProblem(c, 9, "photos");
  assert.equal(c.flow, null);
  // problème supprimé pendant un signalement : plus d'écran
  reopenProblem(c, 0, "photos");
  removeProblem(c, 0);
  assert.equal(currentFlow(c), null);
});

test("suppression d'une photo de pièce (arrivée ou fin) : sans geste, Next room se désactive", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addPhoto(c, "p1", { now: at(10, 1) });
  addPhoto(c, "p2", { now: at(10, 1) });
  const g = c.gestures;
  removeArrivalOrEndPhoto(c, "arrival", "Bed", 0);
  assert.deepEqual(c.arrivalPhotos.Bed, ["p2"]);
  assert.equal(c.gestures, g);
  assert.deepEqual(c.messages.filter(m => m.type === "photo").map(m => m.photo), ["p2"], "bulle retirée du fil");
  removeArrivalOrEndPhoto(c, "arrival", "Bed", 0);
  assert.equal(c.arrivalPhotos.Bed, undefined);
  assert.equal(currentStep(c).replies[0].enabled, false, "plus de photo : Next room inactif");
  removeArrivalOrEndPhoto(c, "arrival", "Bed", 0);
  removeArrivalOrEndPhoto(c, "end", "Kitchen", 3);
  addPhoto(c, "p3", { now: at(10, 2) });
  reply(c, "next-room", { now: at(10, 2) });
  rooms(c, 2, "a");
  reply(c, "walls-ok", { now: at(10, 3) }); reply(c, "no-damage", { now: at(10, 3) }); reply(c, "linen-yes", { now: at(10, 3) });
  addPhoto(c, "e1", { now: at(11, 0) });
  removeArrivalOrEndPhoto(c, "end", "Bed", 0);
  assert.equal(c.endPhotos.Bed, undefined);
  assert.deepEqual(c.arrivalPhotos.Bed, ["p3"]);
});

test("écran de note : Save enregistre directement le texte", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  startProblem(c); chooseKind(c, "Leak", { now: at(10, 1) }); flowReply(c, "no-photo");
  const g = c.gestures;
  flowReply(c, "save-text", { text: "under the sink" });
  assert.equal(c.flow, null);
  assert.equal(c.problems[0].note, "under the sink");
  assert.equal(c.gestures, g + 1);
});

test("I see insects annulé (retour sans photo) : bulle retirée, la question revient", () => {
  const c = createConversation(oxford, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "check-see", { now: at(10, 2) });
  flowReply(c, "back");
  assert.equal(c.messages.some(m => m.text === "I see insects"), false);
  assert.equal(c.checkAnswer, null);
  assert.deepEqual(currentStep(c).replies.map(r => r.id), ["check-ok", "check-see"]);
});

test("retour système (flowBack) : tuiles → annuler, photos → type retiré, note → photos, gaz → OK", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  startProblem(c);
  const g = c.gestures;
  flowBack(c);
  assert.equal(c.flow, null);
  assert.equal(c.gestures, g);
  startProblem(c); chooseKind(c, "Leak", { now: at(10, 1) });
  flowBack(c);
  assert.equal(currentFlow(c).stage, "kind");
  assert.equal(c.problems.length, 0);
  chooseKind(c, "Leak", { now: at(10, 1) }); addFlowPhoto(c, "l1");
  const g2 = c.gestures;
  flowBack(c);
  assert.equal(currentFlow(c).stage, "note", "une photo prise : le retour fait comme Done");
  assert.equal(c.problems[0].photos.length, 1, "photo gardée");
  assert.equal(c.gestures, g2, "sans geste");
  flowBack(c);
  assert.equal(currentFlow(c).stage, "photos", "note → photos");
  flowReply(c, "photos-done");
  assert.equal(currentFlow(c).stage, "note");
  flowReply(c, "no-note");
  startProblem(c); chooseKind(c, "Gas smell", { now: at(10, 5) });
  flowBack(c);
  assert.equal(c.flow, null);
  assert.equal(c.problems.at(-1).kind, "Gas smell");
});

test("depuis la page du problème : retour de l'écran de note = la page directement", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  addProblem(c, "Broken", "b1", { now: at(10, 1) });
  reopenProblem(c, 0, "note");
  flowReply(c, "no-note");
  assert.equal(c.flow, null);
  reopenProblem(c, 0, "note");
  flowBack(c);
  assert.equal(c.flow, null);
  reopenProblem(c, 0, "photos"); addFlowPhoto(c, "b2");
  flowBack(c);
  assert.equal(c.flow, null, "photos depuis la page, photo prise : retour à la page");
  assert.deepEqual(c.problems[0].photos, ["b1", "b2"]);
});

// ---- Étape 5 : ligne AC à deux boutons, lignes pré-réglées par un problème déjà signalé (05/10, §11). ----

test("AC not working : problème Soon « AC not working », Whole apartment, sans photo ; works ensuite le retire", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  toLeaveStep(c);
  const g = c.gestures;
  reply(c, "leave:ac-ko", { now: at(11, 1) });
  assert.equal(c.gestures, g + 1);
  assert.equal(c.leave.ac, "ko");
  assert.equal(c.flow, null, "aucun écran de photos");
  assert.deepEqual(c.problems.map(p => [p.kind, p.urgency, p.where, p.photos.length, p.notified]), [["AC not working", "soon", "Whole apartment", 0, false]]);
  reply(c, "leave:ac", { now: at(11, 2) });
  assert.equal(c.leave.ac, true);
  assert.equal(c.problems.length, 0, "le problème créé par AC not working est supprimé");
  reply(c, "leave:ac-ko", { now: at(11, 3) });
  ["gas", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: at(11, 4) }));
  assert.equal(currentStep(c).id, "low");
  const said = c.messages.filter(m => m.from === "me" && /^All checked/.test(m.text || ""));
  assert.equal(said[0].text, "All checked: Gas works, now off · AC not working · Wi-Fi works · Lights off · Windows & balcony closed · Trash taken out · Door locked, key back");
});

test("ligne AC l'hiver : AC off / AC not working", () => {
  const c = createConversation(bloom, { me: ME, now: new Date(2026, 11, 2, 9, 0) });
  toLeaveStep(c);
  const ac = currentStep(c).replies.filter(r => r.id.startsWith("leave:ac"));
  assert.deepEqual(ac.map(r => [r.id, r.label]), [["leave:ac", "AC off"], ["leave:ac-ko", "AC not working"]]);
});

test("gaz pré-réglé : Gas smell signalé pendant le ménage, ligne du gaz sur « ko » et reliée, sans second problème", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  startProblem(c); chooseKind(c, "Gas smell", { now: at(10, 1) }); flowReply(c, "gas-ok");
  const gas = c.problems[0];
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 3, "e", at(11, 0));
  assert.equal(currentStep(c).id, "leave");
  assert.equal(c.leave.gas, "ko", "pré-réglé");
  assert.equal(c.leaveProblems.gas, gas, "relié au Gas smell signalé");
  assert.equal(c.leave.ac, false);
  assert.equal(c.problems.length, 1, "pas de second problème");
  const g = c.gestures;
  ["ac", "wifi", "lights", "windows", "trash", "door"].forEach(k => reply(c, "leave:" + k, { now: at(11, 4) }));
  assert.equal(c.gestures, g + 6, "six lignes à toucher, le gaz est déjà traité");
  assert.equal(currentStep(c).id, "low");
  assert.equal(c.problems.length, 1);
});

test("gaz pré-réglé : works ne fait que délier (le Gas smell signalé reste), not working le relie sans doublon", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) });
  addProblem(c, "Gas not working", null, { now: at(10, 2) });
  reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 3, "e", at(11, 0));
  const gas = c.problems[0];
  assert.equal(c.leave.gas, "ko");
  reply(c, "leave:gas", { now: at(11, 1) });
  assert.equal(c.leave.gas, true);
  assert.deepEqual(c.problems, [gas], "le problème de la cleaner n'est jamais supprimé");
  assert.equal(c.leaveProblems.gas, undefined);
  reply(c, "leave:gas-ko", { now: at(11, 2) });
  assert.equal(c.leave.gas, "ko");
  assert.deepEqual(c.problems, [gas], "relié de nouveau, pas de doublon");
  reply(c, "leave:gas-ko", { now: at(11, 3) });
  assert.equal(c.leave.gas, false);
  assert.deepEqual(c.problems, [gas], "second appui : délié seulement");
});

test("AC pré-réglée : tuile AC signalée pendant le ménage, ligne « ko », rapport AC not working ✗", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  reply(c, "here", { now: at(10, 0) });
  startProblem(c); chooseKind(c, "AC", { now: at(10, 1) }); addFlowPhoto(c, "ac1"); flowReply(c, "photos-done"); flowReply(c, "no-note");
  const ac = c.problems[0];
  rooms(c, 3, "a");
  reply(c, "walls-ok", { now: at(10, 2) }); reply(c, "no-damage", { now: at(10, 2) }); reply(c, "linen-yes", { now: at(10, 3) });
  rooms(c, 3, "e", at(11, 0));
  assert.equal(c.leave.ac, "ko");
  assert.equal(c.leaveProblems.ac, ac);
  assert.equal(c.leave.gas, false);
  reply(c, "leave:ac", { now: at(11, 1) });
  assert.deepEqual(c.problems, [ac], "works : délié, la tuile AC reste");
  reply(c, "leave:ac-ko", { now: at(11, 1) });
  assert.deepEqual(c.problems, [ac]);
  assert.equal(c.leave.ac, "ko");
});

test("problème relié supprimé depuis sa page : la ligne revient à « non traitée »", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  toLeaveStep(c);
  reply(c, "leave:wifi-ko", { now: at(11, 1) });
  removeProblem(c, 0);
  assert.equal(c.leave.wifi, false);
  assert.equal(c.leaveProblems.wifi, undefined);
});

test("problème d'AC signalé seulement pendant l'étape 5 : not working le relie au lieu d'en créer un second", () => {
  const c = createConversation(bloom, { me: ME, now: at(9, 0) });
  toLeaveStep(c);
  addProblem(c, "AC", null, { now: at(11, 1) });
  assert.equal(c.leave.ac, false, "pas de pré-réglage au milieu de l'étape");
  reply(c, "leave:ac-ko", { now: at(11, 2) });
  assert.equal(c.leave.ac, "ko");
  assert.deepEqual(c.problems.map(p => p.kind), ["AC"]);
});
