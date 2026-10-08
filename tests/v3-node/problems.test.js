import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, autoUrgency, makeProblem, URGENCY, SAFETY_GAS } from "../../v3/conv/problems.js";

test("les dix types, gaz en tête", () => {
  assert.deepEqual(KINDS.map(k => k.key), ["Gas smell", "Leak", "AC", "Power", "Insects", "Missing", "Broken", "Stain", "Very dirty", "Guest forgot"]);
});

test("odeur de gaz toujours urgente, avec consigne de sécurité", () => {
  assert.equal(autoUrgency("Gas smell", null), "urgent");
  assert.equal(autoUrgency("Gas smell", 500), "urgent");
  assert.equal(KINDS[0].safety, "Open the windows. Do not touch switches. Leave and call your manager on duty.");
  assert.equal(SAFETY_GAS, KINDS[0].safety);
});

test("urgence par défaut Soon, sauf Gas smell et Can't get in (le prochain voyageur n'entre plus en compte)", () => {
  for (const k of ["Leak", "AC", "Power", "Insects", "Missing", "Broken", "Stain", "Very dirty", "Guest forgot", "Wall damage", "Gas not working", "Wi-Fi not working", "AC not working"]) {
    for (const h of [null, 1, 3, 24, 500]) assert.equal(autoUrgency(k, h), "soon", k + " à " + h + " h");
  }
  assert.equal(autoUrgency("Gas smell", 3), "urgent");
  assert.equal(autoUrgency("Can't get in", null), "urgent");
  assert.equal(autoUrgency("Can't get in", 500), "urgent");
});

test("un problème urgent est marqué notifié", () => {
  const p = makeProblem({ kind: "Can't get in", where: "Entrance & building", photos: [], hoursAway: 3, at: "11:23", ref: 461 });
  assert.equal(p.urgency, "urgent");
  assert.equal(p.notified, true);
  const q = makeProblem({ kind: "Leak", where: "Bathroom", photos: [], hoursAway: 3, at: "11:30", ref: 462 });
  assert.equal(q.urgency, "soon");
  assert.equal(q.notified, false);
  assert.equal(q.note, null, "note vide à la création");
  assert.equal("voice" in q, false, "plus de note vocale");
});

test("libellés d'urgence", () => {
  assert.deepEqual(URGENCY.urgent, { dot: "🔴", label: "Urgent" });
  assert.deepEqual(URGENCY.soon, { dot: "🟠", label: "Soon" });
  assert.deepEqual(URGENCY.later, { dot: "⚪", label: "Not urgent" });
});
