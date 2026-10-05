import { test } from "node:test";
import assert from "node:assert/strict";
import { APARTMENTS, ME } from "./fixtures.js";
import { stampText } from "../../v3/conv/stamp.js";

test("texte d'horodatage exact", () => {
  assert.equal(stampText(APARTMENTS[0], ME, new Date(2026, 9, 5, 10, 42)), "122 Oxford Boulevard · Mon 5 Oct 2026 · 10:42 · Faiza");
  assert.equal(stampText(APARTMENTS[2], ME, new Date(2026, 0, 3, 7, 5)), "1011C Bloom Towers · Sat 3 Jan 2026 · 07:05 · Faiza");
});

test("pas de tiret cadratin", () => {
  assert.equal(stampText(APARTMENTS[1], ME, new Date()).includes("—"), false);
});
