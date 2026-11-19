import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRefresh, updatedLabel, REFRESH_AFTER_MS } from "../../v3/conv/refresh.js";

// 2026-11-19 12:04 a Dubai = 08:04 UTC.
const T = Date.parse("2026-11-19T08:04:00Z");
const lu = (ms, date) => ({ at: ms, date: date || "2026-11-19" });

test("jamais lue : on relit", () => {
  assert.equal(needsRefresh({ now: T, last: null, online: true }), true);
});

test("hors ligne : jamais, meme si le jour a change", () => {
  assert.equal(needsRefresh({ now: T, last: null, online: false }), false);
  assert.equal(needsRefresh({ now: T, last: lu(T - 3600e3, "2026-11-18"), online: false }), false);
});

test("lecture de moins de 60 s : on ne relit pas ; au dela : on relit", () => {
  assert.equal(REFRESH_AFTER_MS, 60000);
  assert.equal(needsRefresh({ now: T, last: lu(T - 30e3), online: true }), false);
  assert.equal(needsRefresh({ now: T, last: lu(T - 60e3), online: true }), false, "pile 60 s : pas encore");
  assert.equal(needsRefresh({ now: T, last: lu(T - 61e3), online: true }), true);
});

test("le jour de Dubai a change : on relit meme une lecture de 5 secondes", () => {
  // 23:59:58 puis 00:00:03 a Dubai (19:59:58 UTC puis 20:00:03 UTC).
  const avant = Date.parse("2026-11-19T19:59:58Z"), apres = Date.parse("2026-11-19T20:00:03Z");
  assert.equal(needsRefresh({ now: apres, last: lu(avant, "2026-11-19"), online: true }), true);
  assert.equal(needsRefresh({ now: avant + 1e3, last: lu(avant, "2026-11-19"), online: true }), false);
});

test("un horloge qui recule ne bloque pas la relecture", () => {
  assert.equal(needsRefresh({ now: T, last: lu(T + 10 * 60e3), online: true }), true);
});

test("libelle : « Updated HH:MM » a l'heure de Dubai, vide sans lecture", () => {
  assert.equal(updatedLabel(T), "Updated 12:04");
  assert.equal(updatedLabel(Date.parse("2026-11-19T20:05:00Z")), "Updated 00:05");
  assert.equal(updatedLabel(null), "");
});
