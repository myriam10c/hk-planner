import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAVE_CHECKS, acInstruction, SUMMER_MONTHS } from "../../v3/conv/rules.js";

test("vérifications de sortie dans l'ordre, gaz en premier", () => {
  assert.deepEqual(LEAVE_CHECKS.map(c => c.key), ["gas", "ac", "wifi", "lights", "windows", "trash", "door"]);
  assert.deepEqual(LEAVE_CHECKS.map(c => c.label), ["Gas works, now off", null, "Wi-Fi works", "Lights off", "Windows & balcony closed", "Trash taken out", "Door locked, keys & card left inside"]);
  assert.deepEqual(LEAVE_CHECKS.filter(c => c.ko).map(c => [c.key, c.ko]), [["gas", "Gas not working"], ["ac", "AC not working"], ["wifi", "Wi-Fi not working"]]);
  // types déjà signalés qui pré-règlent la ligne (spec §11)
  assert.deepEqual(LEAVE_CHECKS.filter(c => c.reported).map(c => [c.key, c.reported]), [["gas", ["Gas smell", "Gas not working"]], ["ac", ["AC", "AC not working"]]]);
});

test("consigne AC selon le mois (avril à octobre : auto)", () => {
  assert.deepEqual(SUMMER_MONTHS, [3, 4, 5, 6, 7, 8, 9]);
  assert.equal(acInstruction(new Date(2026, 9, 31)), "AC on, Auto mode");
  assert.equal(acInstruction(new Date(2026, 10, 1)), "AC off");
  assert.equal(acInstruction(new Date(2027, 2, 31)), "AC off");
  assert.equal(acInstruction(new Date(2027, 3, 1)), "AC on, Auto mode");
});
