import { test } from "node:test";
import assert from "node:assert/strict";
import { canSaveCopy, copyName } from "../../v3/conv/camera.js";

test("copie dans le téléphone : Android seulement", () => {
  assert.equal(canSaveCopy({ userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 SamsungBrowser/30.0" }), true);
  assert.equal(canSaveCopy({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), false);
  assert.equal(canSaveCopy(null), false);
});

test("nom de la copie : appartement, pièce, date et heure", () => {
  const d = new Date(2026, 9, 26, 10, 12, 5);
  assert.equal(copyName(["1011C Bloom Towers", "Bed clean"], d), "HK_1011C-Bloom-Towers_Bed-clean_2026-10-26_10-12-05.jpg");
  assert.equal(copyName(["Résidence Été", ""], d), "HK_Residence-Ete_2026-10-26_10-12-05.jpg");
});
