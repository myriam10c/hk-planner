// Position de l'equipe (plan 2026-10-29) : fonctions pures du module commun.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distance, dubaiDay, dubaiMinutes, inWindow, noticeAnswer, shouldSend, MAX_GAP_MS,
} from "../../shared/location-core.js";

// 10:00 a Dubai (UTC+4) = 06:00 UTC.
const DIX_HEURES = Date.parse("2026-10-29T06:00:00Z");

test("distance : haversine en metres", () => {
  assert.equal(distance({ lat: 25.08, lng: 55.14 }, { lat: 25.08, lng: 55.14 }), 0);
  // 0,001 degre de latitude ~ 111 m.
  const d = distance({ lat: 25.08, lng: 55.14 }, { lat: 25.081, lng: 55.14 });
  assert.ok(d > 110 && d < 112, String(d));
});

test("heure et jour de Dubai, quel que soit le fuseau de la machine", () => {
  assert.equal(dubaiMinutes(DIX_HEURES), 600);
  // 22:30 UTC le 28 = 02:30 le 29 a Dubai.
  assert.equal(dubaiDay(Date.parse("2026-10-28T22:30:00Z")), "2026-10-29");
  assert.equal(dubaiMinutes(Date.parse("2026-10-28T22:30:00Z")), 150);
});

test("fenetre 07:00-23:00 Dubai, 23:00 exclu", () => {
  assert.equal(inWindow(Date.parse("2026-10-29T02:59:00Z")), false); // 06:59
  assert.equal(inWindow(Date.parse("2026-10-29T03:00:00Z")), true);  // 07:00
  assert.equal(inWindow(Date.parse("2026-10-29T18:59:00Z")), true);  // 22:59
  assert.equal(inWindow(Date.parse("2026-10-29T19:00:00Z")), false); // 23:00
});

test("shouldSend : premier point, deplacement > 100 m, ou plus de 5 min", () => {
  const ici = { lat: 25.08, lng: 55.14 };
  assert.equal(shouldSend(null, ici, DIX_HEURES), true);
  const last = { ...ici, at: DIX_HEURES };
  assert.equal(shouldSend(last, { lat: 25.0804, lng: 55.14 }, DIX_HEURES + 60000), false); // ~44 m
  assert.equal(shouldSend(last, { lat: 25.0812, lng: 55.14 }, DIX_HEURES + 60000), true);  // ~133 m
  assert.equal(shouldSend(last, ici, DIX_HEURES + MAX_GAP_MS - 1), false);
  assert.equal(shouldSend(last, ici, DIX_HEURES + MAX_GAP_MS), true);
});

test("avertissement : ok garde, later redemande le jour suivant a Dubai", () => {
  assert.equal(noticeAnswer("ok", DIX_HEURES), "ok");
  assert.equal(noticeAnswer(null, DIX_HEURES), "ask");
  assert.equal(noticeAnswer("n'importe quoi", DIX_HEURES), "ask");
  assert.equal(noticeAnswer("later:2026-10-29", DIX_HEURES), "later");
  assert.equal(noticeAnswer("later:2026-10-28", DIX_HEURES), "ask");
  assert.equal(noticeAnswer("later:2999-12-31", DIX_HEURES), "later");
});
