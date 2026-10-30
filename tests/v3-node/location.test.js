// Position de l'equipe (plan 2026-10-29) : fonctions pures du module commun.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distance, dubaiDay, dubaiMinutes, inWindow, noticeAnswer, shouldSend, MAX_GAP_MS,
  readNotice, refreshLocationSharing, setLocationPerson, setNotice, startLocationSharing, stopLocationSharing,
  pillView, turnLocationOff, turnLocationOn,
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

// ---------------------------------------------------------------------------
// Partage : faux navigateur (stockage, geolocalisation, page visible) et
// minuterie capturee, l'heure est donnee par cfg.now.
// ---------------------------------------------------------------------------

function fauxNavigateur() {
  const store = new Map();
  const geo = {
    watchCb: null, watches: 0, cleared: 0, current: [],
    watchPosition(cb) { this.watchCb = cb; this.watches += 1; return this.watches; },
    clearWatch() { this.cleared += 1; this.watchCb = null; },
    getCurrentPosition(cb, err, opts) { this.current.push({ cb, opts }); },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { geolocation: geo } });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  });
  return { store, geo };
}

const pos = (lat, lng, t, accuracy = 10) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: t });
const attendre = () => new Promise((r) => setImmediate(r));

// Demarre le partage pour la personne 3 (choix OK), rend l'horloge, les envois et la minuterie.
function demarrer({ echec = null, onTick } = {}) {
  const env = fauxNavigateur();
  const h = { t: DIX_HEURES };
  const envois = [];
  const ctl = { echec };
  env.store.set("hkLocNotice2:3", "ok");
  let tick = null;
  const vrai = globalThis.setInterval;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  try {
    startLocationSharing({
      post: async (b) => {
        envois.push(b);
        if (ctl.echec) throw Object.assign(new Error("HTTP " + ctl.echec), { status: ctl.echec });
        return ctl.reponse || { ok: true };
      },
      personId: 3, isAllowed: () => true, now: () => h.t, onTick,
    });
  } finally {
    globalThis.setInterval = vrai;
  }
  return { ...env, h, envois, ctl, tick: () => tick() };
}

test("avertissement garde par personne : hkLocNotice2:<id>, rien sans personne", () => {
  const { store } = fauxNavigateur();
  setLocationPerson(null);
  setNotice("ok", DIX_HEURES);
  assert.equal(store.size, 0);
  assert.equal(readNotice(DIX_HEURES), "ask");
  setLocationPerson(3);
  setNotice("ok", DIX_HEURES);
  assert.equal(store.get("hkLocNotice2:3"), "ok");
  assert.equal(readNotice(DIX_HEURES), "ok");
  // Deuxieme personne sur le meme telephone : rien d'herite.
  setLocationPerson("4");
  assert.equal(readNotice(DIX_HEURES), "ask");
  setNotice("later", DIX_HEURES);
  assert.equal(store.get("hkLocNotice2:4"), "later:2026-10-29");
  assert.equal(store.get("hkLocNotice2:3"), "ok");
  // L'ancienne cle commune et les anciennes cles par personne ne sont plus lues.
  store.set("hkLocNotice", "ok");
  store.set("hkLocNotice:5", "ok");
  setLocationPerson(5);
  assert.equal(readNotice(DIX_HEURES), "ask");
});

test("« Not now » d'un cleaner : later pour la page, ask a la prochaine ouverture", () => {
  const { store } = fauxNavigateur();
  stopLocationSharing();
  setLocationPerson(3);
  store.set("hkLocNotice2:3", "ok");
  setNotice("later", DIX_HEURES, true);
  assert.equal(store.get("hkLocNotice2:3"), "later:page");
  assert.equal(readNotice(DIX_HEURES), "later");
  // Une autre personne sur la meme page n'herite pas du « Not now ».
  setLocationPerson(4);
  assert.equal(readNotice(DIX_HEURES), "ask");
  setLocationPerson(3);
  assert.equal(readNotice(DIX_HEURES), "later");
  // Valeur stockee seule (nouvelle page) : redemande.
  assert.equal(noticeAnswer("later:page", DIX_HEURES), "ask");
  // OK ensuite : garde.
  setNotice("ok", DIX_HEURES, true);
  assert.equal(readNotice(DIX_HEURES), "ok");
  stopLocationSharing();
});

test("partage : apres un echec, aucun envoi pendant 5 min, puis reprise", async () => {
  const f = demarrer({ echec: 500 });
  try {
    assert.equal(f.geo.watches, 1);
    f.geo.watchCb(pos(25.08, 55.14, f.h.t));
    await attendre();
    assert.equal(f.envois.length, 1);
    // Points suivants, meme loin : rien pendant la pause.
    for (let i = 1; i <= 30; i++) f.geo.watchCb(pos(25.08 + i * 0.01, 55.14, f.h.t));
    await attendre();
    assert.equal(f.envois.length, 1);
    f.h.t += 4 * 60_000;
    f.geo.watchCb(pos(25.5, 55.14, f.h.t));
    await attendre();
    assert.equal(f.envois.length, 1);
    // Le battement respecte aussi la pause.
    f.tick();
    assert.equal(f.geo.current.length, 0);
    f.h.t += 60_000 + 1;
    f.ctl.echec = null;
    f.geo.watchCb(pos(25.5, 55.14, f.h.t));
    await attendre();
    assert.equal(f.envois.length, 2);
    // Envoi reussi : retour a la regle normale (100 m ou 5 min).
    f.geo.watchCb(pos(25.5, 55.14, f.h.t + 1000));
    await attendre();
    assert.equal(f.envois.length, 2);
  } finally {
    stopLocationSharing();
  }
});

for (const status of [401, 403]) {
  test("partage : " + status + " arrete tout pour la page, sans nouvel essai", async () => {
    const f = demarrer({ echec: status });
    try {
      f.geo.watchCb(pos(25.08, 55.14, f.h.t));
      await attendre();
      assert.equal(f.envois.length, 1);
      assert.equal(f.geo.cleared, 1);
      f.h.t += 60 * 60_000;
      f.tick();
      refreshLocationSharing();
      assert.equal(f.geo.watches, 1);
      assert.equal(f.geo.current.length, 0);
      assert.equal(f.envois.length, 1);
    } finally {
      stopLocationSharing();
    }
  });
}

test("partage : reponse not_shared, arret pour la page sans nouvel essai", async () => {
  const f = demarrer();
  f.ctl.reponse = { ok: true, saved: false, reason: "not_shared" };
  try {
    f.geo.watchCb(pos(25.08, 55.14, f.h.t));
    await attendre();
    assert.equal(f.envois.length, 1);
    assert.equal(f.geo.cleared, 1);
    // Ni watch, ni battement, ni envoi ensuite, meme apres refresh.
    f.geo.watchCb && f.geo.watchCb(pos(26, 55.14, f.h.t));
    f.h.t += 60 * 60_000;
    f.tick();
    refreshLocationSharing();
    await attendre();
    assert.equal(f.geo.watches, 1);
    assert.equal(f.geo.current.length, 0);
    assert.equal(f.envois.length, 1);
  } finally {
    stopLocationSharing();
  }
});

test("partage : saved false pour une autre raison (outside_hours), le partage continue", async () => {
  const f = demarrer();
  f.ctl.reponse = { ok: true, saved: false, reason: "outside_hours" };
  try {
    f.geo.watchCb(pos(25.08, 55.14, f.h.t));
    await attendre();
    assert.equal(f.geo.cleared, 0);
    f.geo.watchCb(pos(25.10, 55.14, f.h.t + 1000));
    await attendre();
    assert.equal(f.envois.length, 2);
  } finally {
    stopLocationSharing();
  }
});

test("battement : telephone immobile, un point demande apres 5 min sans envoi", async () => {
  let ticks = 0;
  const f = demarrer({ onTick: () => { ticks += 1; } });
  try {
    f.geo.watchCb(pos(25.08, 55.14, f.h.t));
    await attendre();
    assert.equal(f.envois.length, 1);
    f.h.t += 4 * 60_000;
    f.tick();
    assert.equal(f.geo.current.length, 0);
    f.h.t += 60_000 + 1;
    f.tick();
    assert.equal(ticks, 2);
    assert.equal(f.geo.current.length, 1);
    assert.deepEqual([f.geo.current[0].opts.maximumAge, f.geo.current[0].opts.timeout], [60000, 20000]);
    // Un seul point demande a la fois.
    f.tick();
    assert.equal(f.geo.current.length, 1);
    f.geo.current[0].cb(pos(25.08, 55.14, f.h.t));
    await attendre();
    assert.equal(f.envois.length, 2);
    // Page cachee ou hors fenetre : rien.
    f.h.t += 6 * 60_000;
    globalThis.document.visibilityState = "hidden";
    f.tick();
    assert.equal(f.geo.current.length, 1);
    globalThis.document.visibilityState = "visible";
    f.h.t = Date.parse("2026-10-29T19:30:00Z"); // 23:30 Dubai
    f.tick();
    assert.equal(f.geo.current.length, 1);
  } finally {
    stopLocationSharing();
  }
});

test("partage : point a plus de 2000 m de precision jamais envoye", async () => {
  const f = demarrer();
  try {
    f.geo.watchCb(pos(25.08, 55.14, f.h.t, 2500));
    await attendre();
    assert.equal(f.envois.length, 0);
    f.geo.watchCb(pos(25.08, 55.14, f.h.t, 2000));
    await attendre();
    assert.equal(f.envois.length, 1);
  } finally {
    stopLocationSharing();
  }
});

// ---------------------------------------------------------------------------
// Bouton « Location ON / OFF » (30/10).
// ---------------------------------------------------------------------------

test("choix 'off' : lu 'off', jamais 'ask' (aucun avertissement)", () => {
  assert.equal(noticeAnswer("off", DIX_HEURES), "off");
  const { store } = fauxNavigateur();
  stopLocationSharing();
  setLocationPerson(3);
  setNotice("off", DIX_HEURES);
  assert.equal(store.get("hkLocNotice2:3"), "off");
  assert.equal(readNotice(DIX_HEURES), "off");
});

test("pillView : ON, OFF, bloque, sleeps hors fenetre (choix garde), rien sinon", () => {
  assert.deepEqual(pillView("on", DIX_HEURES), { state: "on", on: true, title: "\u{1F4CD} Location ON", sub: "Your manager sees where you are" });
  assert.deepEqual(pillView("off", DIX_HEURES), { state: "off", on: false, title: "\u{1F4CD} Location OFF", sub: "Tap to turn on" });
  assert.deepEqual(pillView("blocked", DIX_HEURES), { state: "blocked", on: false, title: "\u{1F4CD} Location blocked", sub: "Tap for help" });
  const nuit = Date.parse("2026-10-29T19:30:00Z"); // 23:30 Dubai
  assert.equal(pillView("on", nuit).state, "sleeps");
  assert.equal(pillView("on", nuit).on, true);
  assert.equal(pillView("on", nuit).title, "\u{1F4CD} Location sleeps (7 AM to 11 PM)");
  assert.equal(pillView("off", nuit).on, false);
  // Bloque l'emporte sur la nuit (l'aide sert a toute heure).
  assert.equal(pillView("blocked", nuit).state, "blocked");
  for (const st of ["unsupported", null, undefined, "x"]) assert.equal(pillView(st, DIX_HEURES), null);
  for (const v of ["on", "off", "blocked"]) assert.ok(!/\u2014/.test(JSON.stringify(pillView(v, DIX_HEURES))));
});

test("turnLocationOff arrete le watch et plus rien ne part ; turnLocationOn renvoie tout de suite", async () => {
  const s = demarrer();
  assert.equal(s.geo.watches, 1);
  s.geo.watchCb(pos(25.08, 55.14, s.h.t));
  await attendre();
  assert.equal(s.envois.length, 1);
  const cb = s.geo.watchCb;
  turnLocationOff();
  assert.equal(s.store.get("hkLocNotice2:3"), "off");
  assert.equal(s.geo.watchCb, null);
  // Point arrive en retard apres le OFF : rien ne part.
  cb(pos(25.09, 55.14, s.h.t));
  s.tick();
  await attendre();
  assert.equal(s.envois.length, 1);
  assert.equal(s.geo.current.length, 0);
  turnLocationOn();
  assert.equal(s.store.get("hkLocNotice2:3"), "ok");
  assert.equal(s.geo.watches, 2);
  // Meme endroit, meme minute : envoye quand meme (dernier envoi oublie au OFF).
  s.geo.watchCb(pos(25.08, 55.14, s.h.t));
  await attendre();
  assert.equal(s.envois.length, 2);
  stopLocationSharing();
});
