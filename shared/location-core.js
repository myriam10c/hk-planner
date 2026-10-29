// Position de l'equipe (« qui est ou », plan 2026-10-29). Logique commune a
// l'app cleaner (/v3/) et a l'app manager (/manager/) : fenetre 07:00-23:00 de
// Dubai, choix garde de l'avertissement, watchPosition borne a la page visible,
// envoi limite (deplacement > 100 m ou dernier envoi > 5 min), battement de
// coeur a la minute pour un telephone immobile, pause de 5 min apres un echec,
// arret pour la page apres un 401/403.
// Module ES sans dependance. Jamais d'exception vers l'appelant : pas de
// geolocalisation, permission refusee ou stockage indisponible, on se tait.
// Aucun ecran ici : l'avertissement est dessine par chaque app.

// Choix garde par personne (telephone partage) : cle 'hkLocNotice:<cleanerId>',
// valeur 'ok' | 'later:<YYYY-MM-DD>' (jour de Dubai).
export const NOTICE_KEY = 'hkLocNotice';
export const WINDOW_START_MIN = 7 * 60;       // 07:00 Dubai
export const WINDOW_END_MIN = 23 * 60;        // 23:00 Dubai, exclu
export const MIN_MOVE_M = 100;
export const MAX_GAP_MS = 5 * 60 * 1000;
export const RETRY_MS = 5 * 60 * 1000;        // pause apres un envoi rate
export const MAX_ACCURACY_M = 2000;           // au-dela, le proxy ignore le point : on ne l'envoie pas
const WATCH_OPTS = { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 };
const BEAT_OPTS = { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 };
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

let personne = null;     // id de la personne connectee (cle du choix)

// Pose la personne dont on lit et ecrit le choix. Sans personne connue : 'ask'
// a la lecture et rien n'est ecrit, donc jamais de partage.
export function setLocationPerson(id) {
  personne = id === undefined || id === null || String(id) === '' ? null : String(id);
}

export function noticeKey(id) { return NOTICE_KEY + ':' + id; }

export function readNotice(nowMs) {
  if (personne === null) return 'ask';
  return noticeAnswer(readKey(noticeKey(personne)), nowMs === undefined ? Date.now() : nowMs);
}

// 'ok' ou 'later' (redemande le jour suivant a Dubai).
export function setNotice(answer, nowMs) {
  if (personne === null) return;
  writeKey(noticeKey(personne), answer === 'ok' ? 'ok' : 'later:' + dubaiDay(nowMs === undefined ? Date.now() : nowMs));
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

let cfg = null;          // { post, isAllowed, onState, onTick, now }
let watchId = null;
let tick = null;
let last = null;         // dernier envoi reussi
let enCours = false;     // un envoi a la fois
let refusVu = false;
let pauseJusqua = 0;     // apres un echec, aucun envoi avant cette heure
let coupe = false;       // 401/403 : plus aucun envoi jusqu'au rechargement
let battementEnCours = false;
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
  if (enCours || !cfg || coupe) return;
  const t = now();
  if (t < pauseJusqua) return;
  if (!inWindow(t) || !allowed()) return;
  const c = pos && pos.coords;
  if (!c || !isFinite(c.latitude) || !isFinite(c.longitude)) return;
  if (isFinite(c.accuracy) && c.accuracy > MAX_ACCURACY_M) return;
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
    pauseJusqua = 0;
  } catch (e) {
    const st = e && typeof e.status === 'number' ? e.status : 0;
    if (st === 401 || st === 403) {
      // Session morte ou role refuse : rien ne sert de reessayer sur cette page.
      coupe = true;
      stopWatch();
    } else {
      // Hors ligne ou serveur en panne : pas de nouvel essai avant 5 min.
      pauseJusqua = now() + RETRY_MS;
    }
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

// Partage souhaite maintenant : choix OK, fenetre ouverte, page visible, ni refus ni coupure.
function partageVoulu() {
  return !!cfg && !coupe && geoSupported() && !refusVu && visible() && allowed() &&
    readNotice(now()) === 'ok' && inWindow(now());
}

// Demarre ou arrete le watch selon l'etat courant. Seul endroit qui appelle
// watchPosition (avec battement, qui ne tourne qu'une fois le choix OK et le
// watch deja lance), donc seul endroit qui peut faire apparaitre la demande du navigateur.
function evaluer() {
  if (!cfg) return;
  if (!partageVoulu()) { stopWatch(); return; }
  if (watchId !== null) return;
  try {
    watchId = navigator.geolocation.watchPosition(envoyer, surErreur, WATCH_OPTS);
  } catch (e) {
    watchId = null;
  }
}

// Battement de coeur : un telephone immobile peut ne plus rien recevoir du watch.
// Plus de 5 min sans envoi reussi : un point demande explicitement, envoye par le
// meme chemin (pause apres echec et arret apres 401/403 compris).
function battement() {
  if (battementEnCours || !partageVoulu()) return;
  const t = now();
  if (t < pauseJusqua) return;
  if (last && t - last.at <= MAX_GAP_MS) return;
  battementEnCours = true;
  const fin = function () { battementEnCours = false; };
  try {
    navigator.geolocation.getCurrentPosition(
      function (pos) { fin(); envoyer(pos); },
      function (err) { fin(); surErreur(err); },
      BEAT_OPTS);
  } catch (e) {
    fin();
  }
}

function surTick() {
  evaluer();
  battement();
  try { if (cfg && cfg.onTick) cfg.onTick(); } catch (e) { /* l'ecran ne casse jamais le partage */ }
}

function surVisibilite() { evaluer(); }

// post(body) -> Promise (l'erreur porte `status` si le serveur a repondu) ;
// personId : la personne connectee (cle du choix) ; isAllowed() -> bool (ni
// Practice ni View as, par ex.) ; onState(st), onTick() (chaque minute) et now()
// (tests) facultatifs. Idempotent.
export function startLocationSharing(opts) {
  const o = opts || {};
  if (typeof o.post !== 'function') return;
  if (o.personId !== undefined) setLocationPerson(o.personId);
  cfg = { post: o.post, isAllowed: o.isAllowed, onState: o.onState, onTick: o.onTick, now: o.now };
  if (!ecouteVisibilite) {
    try { document.addEventListener('visibilitychange', surVisibilite); ecouteVisibilite = true; } catch (e) { /* pas de document */ }
  }
  // Fenetre qui s'ouvre ou se ferme pendant que l'app reste ouverte.
  if (tick === null) {
    try { tick = setInterval(surTick, TICK_MS); } catch (e) { tick = null; }
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
  pauseJusqua = 0;
  coupe = false;
}
