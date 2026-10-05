// View as et Practice (tâche 6 du branchement) : qui écrit, et la conversation en lecture seule
// d'une cleaner, reconstruite depuis v3.myDay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME, NOW } from "./fixtures.js";
import { readOnlyConversation, currentStep } from "../../v3/conv/conversation.js";
import { syncPlan, finishPlan, writeMode } from "../../v3/conv/sync.js";
import { renderConversation, renderList } from "../../v3/conv/ui.js";

const [oxford, creek, bloom] = APARTMENTS;

test("writeMode : la vraie file pour sa propre journée, le simulateur en Practice, rien en View as", () => {
  assert.equal(writeMode({ session: true, viewAs: null, dayViewAs: false, practiceActive: false }), "real");
  assert.equal(writeMode({ session: false, viewAs: null, dayViewAs: false, practiceActive: false }), "none");
  assert.equal(writeMode({ session: true, viewAs: { practice: false }, dayViewAs: true, practiceActive: false }), "none");
  // Journée d'une autre personne sans mode connu du téléphone : jamais d'écriture.
  assert.equal(writeMode({ session: true, viewAs: null, dayViewAs: true, practiceActive: false }), "none");
  assert.equal(writeMode({ session: true, viewAs: { practice: true }, dayViewAs: true, practiceActive: true }), "practice");
  // Practice choisi mais séance fermée (Sign out en cours) : rien, ni simulé ni réel.
  assert.equal(writeMode({ session: true, viewAs: { practice: true }, dayViewAs: true, practiceActive: false }), "none");
  // Séance orpheline sans mode : rien non plus.
  assert.equal(writeMode({ session: true, viewAs: null, dayViewAs: false, practiceActive: true }), "none");
});

test("lecture seule : syncPlan et finishPlan ne rendent rien, quoi qu'il arrive à la conversation", () => {
  const c = readOnlyConversation(creek, { me: ME, now: NOW });
  let n = 0;
  const newIdem = () => "idem" + ++n;
  assert.deepEqual(syncPlan(c, { newIdem, active: true }), []);
  assert.deepEqual(finishPlan(c, { newIdem, active: true }), []);
  assert.equal(n, 0);
});

test("ménage pas commencé : la conversation dit seulement qu'il n'a pas démarré", () => {
  const c = readOnlyConversation(bloom, { me: ME, now: NOW });
  assert.equal(c.readOnly, true);
  assert.equal(c.startedAt, null);
  const html = renderConversation(c, { now: NOW });
  assert.match(html, /Not started yet/);
  assert.match(html, /Read only/);
  // Aucun bouton de réponse, de caméra ni de problème.
  assert.doesNotMatch(html, /data-reply=|data-act="camera"|data-act="problem"/);
  assert.match(html, /data-act="back"/);
  assert.doesNotMatch(html, /\u2014/);
});

test("ménage en cours : démarré à l'heure du serveur (Dubaï), tickets ouverts rappelés, binôme", () => {
  const c = readOnlyConversation(creek, { me: ME, now: NOW });
  assert.ok(c.startedAt instanceof Date);
  const html = renderConversation(c, { now: NOW });
  assert.match(html, /Started at 10:05/);
  assert.match(html, /Pionah started at 10:05/);
  assert.doesNotMatch(html, /data-reply=|data-act="problem"/);
  // Le chrono suit l'heure du serveur.
  assert.match(html, /Read only · Started 10:05/);
});

test("ménage fini et tickets du logement : visibles, et la liste garde l'état du serveur", () => {
  const done = { ...oxford, state: "done", startedAt: "2026-10-02T05:00:00Z" };
  const c = readOnlyConversation(done, { me: ME, now: NOW });
  const html = renderConversation(c, { now: NOW });
  assert.match(html, /Cleaning done/);
  assert.match(html, /Open problems here: Cockroaches · Kitchen, Leak · Bathroom\./);
  assert.equal(currentStep(c).replies.length >= 0, true);
  const list = renderList({ me: ME, apartments: [done, creek], convs: { [done.id]: c, [creek.id]: readOnlyConversation(creek, { me: ME, now: NOW }) }, activeId: creek.id, now: NOW });
  assert.match(list, /Cleaning done/);
  assert.match(list, /Started · /);
  // Une conversation en lecture seule ne verrouille jamais les autres lignes.
  assert.doesNotMatch(list, /disabled/);
});
