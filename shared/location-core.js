// Position de l'equipe (« qui est ou », plan 2026-10-29). Logique commune a
// l'app cleaner (/v3/) et a l'app manager (/manager/) : fenetre 07:00-23:00 de
// Dubai, choix garde de l'avertissement, watchPosition borne a la page visible,
// envoi limite (deplacement > 100 m ou dernier envoi > 5 min).
// Module ES sans dependance. Jamais d'exception vers l'appelant : pas de
// geolocalisation, permission refusee ou stockage indisponible, on se tait.
// Aucun ecran ici : l'avertissement est dessine par chaque app.

export const NOTICE_KEY = 'hkLocNotice';      // 'ok' | 'later:<YYYY-MM-DD>' (jour de Dubai)
export const WINDOW_START_MIN = 7 * 60;       // 07:00 Dubai
export const WINDOW_END_MIN = 23 * 60;        // 23:00 Dubai, exclu
export const MIN_MOVE_M = 100;
export const MAX_GAP_MS = 5 * 60 * 1000;
const WATCH_OPTS = { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 };
const TICK_MS = 60000;

// ---------------------------------------------------------------------------
// Fonctions pures (tests/v3-node/location.test.js)
// ---------------------------------------------------------------------------

// Distance en metres entre deux points {lat, lng} (haversine).
export function distance(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// Heure de Dubai par Intl, jamais le fuseau du telephone.
function dubaiParts(nowMs) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const o = {};
  parts.forEach(function (p) { o[p.type] = p.value; });
  return o;
}

// Minutes depuis minuit a Dubai.
export function dubaiMinutes(nowMs) {
  const p = dubaiParts(nowMs);
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}

// Jour de Dubai, 'YYYY-MM-DD'.
export function dubaiDay(nowMs) {
  const p = dubaiParts(nowMs);
  return p.year + '-' + p.month + '-' + p.day;
}

export function inWindow(nowMs) {
  const m = dubaiMinutes(nowMs);
  return m >= WINDOW_START_MIN && m < WINDOW_END_MIN;
}

// last : {lat, lng, at} du dernier envoi reussi, ou null.
export function shouldSend(last, pos, nowMs) {
  if (!last) return true;
  if (nowMs - last.at >= MAX_GAP_MS) return true;
  return distance(last, pos) > MIN_MOVE_M;
}

// Valeur stockee -> 'ok' | 'later' (deja repondu aujourd'hui) | 'ask'.
export function noticeAnswer(raw, nowMs) {
  if (raw === 'ok') return 'ok';
  const m = /^later:(\d{4}-\d{2}-\d{2})$/.exec(String(raw || ''));
  if (m && dubaiDay(nowMs) <= m[1]) return 'later';
  return 'ask';
}

// ---------------------------------------------------------------------------
// Stockage et navigateur
// ---------------------------------------------------------------------------

function readKey(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }

export function readNotice(nowMs) {
  return noticeAnswer(readKey(NOTICE_KEY), nowMs === undefined ? Date.now() : nowMs);
}

// 'ok' ou 'later' (redemande le jour suivant a Dubai).
export function setNotice(answer, nowMs) {
  writeKey(NOTICE_KEY, answer === 'ok' ? 'ok' : 'later:' + dubaiDay(nowMs === undefined ? Date.now() : nowMs));
}

export function geoSupported() {
  try { return typeof navigator !== 'undefined' && !!navigator.geolocation && typeof navigator.geolocation.watchPosition === 'function'; } catch (e) { return false; }
}

// 'granted' | 'denied' | 'prompt' | 'unsupported'. Sans API Permissions (Safari
// ancien) : 'prompt', sauf un refus deja vu par le watch.
export async function permissionState() {
  if (!geoSupported()) return 'unsupported';
  if (refusVu) return 'denied';
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const r = await navigator.permissions.query({ name: 'geolocation' });
      if (r && r.state) return r.state;
    }
  } catch (e) { /* API absente ou nom refuse */ }
  return 'prompt';
}

// ---------------------------------------------------------------------------
// Partage
// ---------------------------------------------------------------------------

let cfg = null;          // { post, isAllowed, onState, now }
let watchId = null;
let tick = null;
let last = null;         // dernier envoi reussi
let enCours = false;     // un envoi a la fois
let refusVu = false;
let ecouteVisibilite = false;

function now() { return cfg && cfg.now ? cfg.now() : Date.now(); }

function signal(st) {
  try { if (cfg && cfg.onState) cfg.onState(st); } catch (e) { /* l'ecran ne casse jamais le partage */ }
}

function allowed() {
  try { return !!cfg && (!cfg.isAllowed || cfg.isAllowed() === true); } catch (e) { return false; }
}

function visible() {
  try { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; } catch (e) { return true; }
}

// Etat pour l'ecran : 'on' | 'off' | 'blocked' | 'unsupported'.
export async function sharingState() {
  const p = await permissionState();
  if (p === 'unsupported') return 'unsupported';
  if (p === 'denied') return 'blocked';
  return readNotice(now()) === 'ok' ? 'on' : 'off';
}

function stopWatch() {
  if (watchId !== null) {
    try { navigator.geolocation.clearWatch(watchId); } catch (e) { /* deja arrete */ }
  }
  watchId = null;
}

async function envoyer(pos) {
  if (enCours || !cfg) return;
  const t = now();
  if (!inWindow(t) || !allowed()) return;
  const c = pos && pos.coords;
  if (!c || !isFinite(c.latitude) || !isFinite(c.longitude)) return;
  const point = { lat: c.latitude, lng: c.longitude };
  if (!shouldSend(last, point, t)) return;
  enCours = true;
  try {
    const recorded = isFinite(pos.timestamp) && pos.timestamp > 0 ? pos.timestamp : t;
    await cfg.post({
      lat: point.lat,
      lng: point.lng,
      accuracy: isFinite(c.accuracy) ? Math.max(0, c.accuracy) : null,
      recordedAt: new Date(recorded).toISOString(),
    });
    last = { lat: point.lat, lng: point.lng, at: t };
  } catch (e) {
    /* hors ligne ou refus : le prochain point retentera */
  } finally {
    enCours = false;
  }
}

function surErreur(err) {
  // 1 = PERMISSION_DENIED : on s'arrete et l'ecran Profile dit comment autoriser.
  if (err && err.code === 1) {
    refusVu = true;
    stopWatch();
    signal('blocked');
  }
}

// Demarre ou arrete le watch selon l'etat courant. Seul endroit qui appelle
// watchPosition, donc seul endroit qui peut faire apparaitre la demande du navigateur.
function evaluer() {
  if (!cfg) return;
  const doit = geoSupported() && !refusVu && visible() && allowed() &&
    readNotice(now()) === 'ok' && inWindow(now());
  if (!doit) { stopWatch(); return; }
  if (watchId !== null) return;
  try {
    watchId = navigator.geolocation.watchPosition(envoyer, surErreur, WATCH_OPTS);
  } catch (e) {
    watchId = null;
  }
}

function surVisibilite() { evaluer(); }

// post(body) -> Promise ; isAllowed() -> bool (ni Practice ni View as, par ex.) ;
// onState(st) facultatif ; now() facultatif (tests). Idempotent.
export function startLocationSharing(opts) {
  const o = opts || {};
  if (typeof o.post !== 'function') return;
  cfg = { post: o.post, isAllowed: o.isAllowed, onState: o.onState, now: o.now };
  if (!ecouteVisibilite) {
    try { document.addEventListener('visibilitychange', surVisibilite); ecouteVisibilite = true; } catch (e) { /* pas de document */ }
  }
  // Fenetre qui s'ouvre ou se ferme pendant que l'app reste ouverte.
  if (tick === null) {
    try { tick = setInterval(evaluer, TICK_MS); } catch (e) { tick = null; }
  }
  evaluer();
}

// Relance apres un changement de choix (OK de l'avertissement, par ex.). Un refus
// deja vu est oublie : la personne a pu autoriser entre-temps dans Chrome.
export function refreshLocationSharing() {
  refusVu = false;
  evaluer();
}

export function stopLocationSharing() {
  stopWatch();
  if (tick !== null) { clearInterval(tick); tick = null; }
  if (ecouteVisibilite) {
    try { document.removeEventListener('visibilitychange', surVisibilite); } catch (e) { /* rien */ }
    ecouteVisibilite = false;
  }
  cfg = null;
  last = null;
}
