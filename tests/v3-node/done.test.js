// Lot 1 des corrections cleaner, tâche 5 : un ménage fini sur le serveur, sans conversation sur
// ce téléphone, s'ouvre en lecture seule (« Cleaning done », heure de fin, ce que la journée
// sait déjà). Seul « Clean again », confirmé en deux temps, relance un ménage ; son démarrage
// porte l'indicateur explicite `again: true`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { toApartments } from "../../v3/conv/day.js";
import {
  conversationToOpen, doneConversation, cleanAgainConversation, createConversation, readOnlyConversation,
  currentStep, reply, isHelper,
} from "../../v3/conv/conversation.js";
import { renderConversation, renderList } from "../../v3/conv/ui.js";
import { syncPlan } from "../../v3/conv/sync.js";
import { serializeConversation, deserializeConversation } from "../../v3/conv/persist.js";
import { DAY, ME, NOW, STOP_BLOOM } from "./fixtures.js";

// Fini à 11:30 (Dubai), démarré à 10:00.
const FINI = { ...STOP_BLOOM, state: "done", startedAt: "2026-10-02T06:00:00Z", finishedAt: "2026-10-02T07:30:00Z", role: "lead" };
// Même ménage, où j'étais l'aide de Pionah.
const FINI_AIDE = {
  ...FINI, role: "helper", leadId: 7, othersOnJob: [{ id: 7, name: "Pionah", startedAt: "2026-10-02T06:00:00Z" }],
};
const apt = stop => toApartments({ ...DAY, stops: [stop] }, ME, { now: NOW })[0];
const fini = apt(FINI);
let n = 0;
const newIdem = () => "idem" + String(++n).padStart(4, "0");

test("journée : l'heure de fin du serveur passe sur l'appartement, null sans elle", () => {
  assert.equal(fini.finishedAt, "2026-10-02T07:30:00Z");
  assert.equal(apt({ ...STOP_BLOOM, state: "done" }).finishedAt, null);
});

test("ouverture : fini sur le serveur, sans conversation locale = lecture seule « Cleaning done »", () => {
  const c = conversationToOpen(fini, null, { me: ME, now: NOW });
  assert.equal(c.readOnly, true);
  assert.equal(c.doneView, true);
  assert.equal(c.viewStatus, "Cleaning done at 11:30");
  assert.deepEqual(currentStep(c).replies, [], "aucune réponse : ni I'm here ni étape");
  const textes = c.messages.map(m => m.text);
  assert.deepEqual(textes.slice(1), ["Started at 10:00.", "Cleaning done at 11:30."]);
  assert.match(textes[0], /^1011C Bloom Towers · /);
  // Rien n'est écrit depuis cet écran.
  assert.deepEqual(syncPlan(c, { newIdem }), []);
});

test("ouverture : fini sans heure connue (manager, ancienne app) = « Cleaning done » sans heure, sans planter", () => {
  const c = conversationToOpen(apt({ ...STOP_BLOOM, state: "done" }), null, { me: ME, now: NOW });
  assert.equal(c.viewStatus, "Cleaning done");
  assert.deepEqual(c.messages.slice(1).map(m => m.text), ["Cleaning done."]);
  assert.doesNotThrow(() => renderConversation(c, { now: NOW }));
});

test("ouverture : une conversation locale garde son comportement, même sur un ménage fini", () => {
  const locale = createConversation(fini, { me: ME, now: NOW });
  reply(locale, "here", { now: NOW });
  assert.equal(conversationToOpen(fini, locale, { me: ME, now: NOW }), locale);
});

test("ouverture : pas fini = conversation neuve sur I'm here ; écran fini périmé reconstruit", () => {
  const encours = conversationToOpen(apt(STOP_BLOOM), null, { me: ME, now: NOW });
  assert.equal(encours.readOnly, undefined);
  assert.deepEqual(currentStep(encours).replies.map(r => r.id), ["here", "cant-get-in"]);
  // Écran fini resté en mémoire, la journée relue dit autre chose : on reconstruit.
  const perime = doneConversation(fini, { me: ME, now: NOW });
  const neuf = conversationToOpen(apt(STOP_BLOOM), perime, { me: ME, now: NOW });
  assert.notEqual(neuf, perime);
  assert.equal(neuf.readOnly, undefined);
  const refait = conversationToOpen(fini, perime, { me: ME, now: NOW });
  assert.notEqual(refait, perime);
  assert.equal(refait.doneView, true);
});

test("ouverture en View as : la vue du manager, jamais l'écran « Clean again »", () => {
  const c = conversationToOpen(fini, null, { me: ME, now: NOW, viewOnly: true });
  assert.equal(c.readOnly, true);
  assert.equal(c.doneView, undefined);
  assert.deepEqual(c, readOnlyConversation(fini, { me: ME, now: NOW }));
});

test("écran fini : en-tête, fil, bouton Clean again ; puis confirmation en deux temps", () => {
  const c = doneConversation(fini, { me: ME, now: NOW });
  const html = renderConversation(c, { now: NOW, before: '<div class="viewas">V</div>' });
  assert.match(html, /^<div class="viewas">V<\/div><header class="top">/);
  assert.match(html, /<div class="title"><b>1011C Bloom Towers<\/b><span>Cleaning done at 11:30<\/span><\/div>/);
  assert.match(html, /<p>Started at 10:00\.<\/p>/);
  assert.match(html, /<p>Cleaning done at 11:30\.<\/p>/);
  assert.match(html, /<button class="reply" data-act="again-ask">Clean again<\/button>/);
  assert.doesNotMatch(html, /again-yes|Only Faiza can answer|data-reply/);
  c.confirmAgain = true;
  const confirm = renderConversation(c, { now: NOW });
  assert.match(confirm, /<div class="confirm"><b>Start a new cleaning\?<\/b><button class="reply danger" data-act="again-yes">Yes, clean again<\/button><button class="reply" data-act="again-no">No<\/button><\/div>/);
  assert.doesNotMatch(confirm, /again-ask/);
  for (const h of [html, confirm]) assert.doesNotMatch(h, /\u2014/);
});

test("liste : la ligne d'un ménage fini reste « Cleaning done » pendant que son écran est ouvert", () => {
  const c = doneConversation(fini, { me: ME, now: NOW });
  const html = renderList({ me: ME, apartments: [fini], convs: { [fini.id]: c }, activeId: fini.id, now: NOW });
  assert.match(html, /<button class="row done"/);
  assert.match(html, /Cleaning done/);
});

test("Clean again : parcours neuf de lead (même pour l'aide du premier ménage), indicateur au démarrage", () => {
  const aide = apt(FINI_AIDE);
  assert.equal(aide.lead.name, "Pionah");
  const c = cleanAgainConversation(aide, { me: ME, now: NOW });
  assert.equal(c.again, true);
  assert.equal(c.readOnly, undefined);
  assert.equal(isHelper(c), false);
  assert.deepEqual(currentStep(c).replies.map(r => r.id), ["here", "cant-get-in"]);
  assert.deepEqual(syncPlan(c, { newIdem }), [], "rien ne part avant I'm here");
  reply(c, "here", { now: NOW });
  const a = syncPlan(c, { newIdem });
  assert.equal(a[0].action, "v3.startJob");
  assert.deepEqual(a[0].body, { jobId: fini.id, idem: a[0].body.idem, again: true });
  // L'appartement de la journée n'est pas modifié (lead et rôle copiés).
  assert.equal(aide.lead.name, "Pionah");
});

test("démarrage ordinaire : corps inchangé, sans indicateur", () => {
  const c = createConversation(apt(STOP_BLOOM), { me: ME, now: NOW });
  reply(c, "here", { now: NOW });
  const a = syncPlan(c, { newIdem });
  assert.deepEqual(Object.keys(a[0].body).sort(), ["idem", "jobId"]);
});

test("Clean again : l'indicateur survit au rechargement (reprise de la conversation)", () => {
  const c = cleanAgainConversation(fini, { me: ME, now: NOW });
  const back = deserializeConversation(JSON.parse(JSON.stringify(serializeConversation(c))), () => null);
  assert.equal(back.again, true);
  reply(back, "here", { now: NOW });
  assert.equal(syncPlan(back, { newIdem })[0].body.again, true);
});
