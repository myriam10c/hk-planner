// Notifications push de l'app cleaner (rappels automatiques, plan 2026-10-20
// tache 6). L'abonnement se fait sur le service worker RACINE (/sw.js, portee /),
// qui porte deja les gestionnaires push et notificationclick ; /v3/sw.js n'en a
// volontairement aucun (un second abonnement doublerait chaque notification).
// Memes actions et meme corps que l'app manager (manager/push.js) :
// getVapidPublicKey puis savePushSubscription, par le client v3 (Bearer ou PIN).
//
// Charge par import() dynamique depuis app.js, en ligne seulement : ce module
// n'est pas dans le precache de /v3/sw.js, l'app hors ligne ne doit pas en dependre.
import { api, ApiError } from '/v3/api.js';
import { esc, icon, toast } from '/v3/ui.js';

const LATER_KEY = 'v3PushLater';     // date du jour ou « Not now » a ete touche
const SYNC_KEY = 'v3PushSynced';     // date du dernier renvoi silencieux de l'abonnement
const READY_TIMEOUT_MS = 10000;
const NOT_STARTED = 'Notifications did not start. Try again.';

function supported() {
  try {
    return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
      && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
  } catch (e) { return false; }
}

function permission() {
  try { return typeof Notification !== 'undefined' ? Notification.permission : 'denied'; } catch (e) { return 'denied'; }
}

// base64url -> Uint8Array : Safari refuse la chaine brute pour applicationServerKey.
function keyBytes(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function rootRegistration() {
  try { return (await navigator.serviceWorker.getRegistration('/')) || null; } catch (e) { return null; }
}

// Attend un worker actif, borne : un enregistrement bloque ne doit pas figer l'ecran.
function waitActive(reg) {
  if (reg.active) return Promise.resolve(reg);
  return new Promise(function (resolve, reject) {
    const w = reg.installing || reg.waiting;
    if (!w) { reject(new Error(NOT_STARTED)); return; }
    const timer = setTimeout(function () { reject(new Error(NOT_STARTED)); }, READY_TIMEOUT_MS);
    w.addEventListener('statechange', function () {
      if (w.state === 'activated') { clearTimeout(timer); resolve(reg); }
      else if (w.state === 'redundant') { clearTimeout(timer); reject(new Error(NOT_STARTED)); }
    });
  });
}

async function ensureRootRegistration() {
  const reg = (await rootRegistration()) || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return waitActive(reg);
}

function today() {
  // Telephones a l'heure de Dubai : la date locale suffit pour « jusqu'a demain ».
  try { return new Date().toLocaleDateString('en-CA'); } catch (e) { return new Date().toISOString().slice(0, 10); }
}
function readKey(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } }

export function isIos() {
  try {
    const ua = navigator.userAgent || '';
    // iPadOS se presente en Mac : un Mac tactile est un iPad.
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  } catch (e) { return false; }
}
export function standalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (e) { return false; }
}

// 'unsupported' | 'denied' | 'off' | 'on'
export async function pushState() {
  if (!supported()) return 'unsupported';
  const p = permission();
  if (p === 'denied') return 'denied';
  if (p !== 'granted') return 'off';
  try {
    const reg = await rootRegistration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    return sub ? 'on' : 'off';
  } catch (e) { return 'off'; }
}

async function sendSubscription(sub) {
  const j = sub.toJSON();
  await api.post('savePushSubscription', {
    endpoint: j.endpoint,
    keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
    user_agent: (navigator.userAgent || '').slice(0, 300),
  });
}

function messageFor(err) {
  if (err instanceof ApiError) {
    if (err.kind === 'offline') return 'No network. Try again when you have signal.';
    if (err.kind === 'auth') return 'Please sign in again.';
    if (err.status === 503) return 'Notifications are not ready yet. Tell your manager.';
    return 'Could not turn on notifications. Try again.';
  }
  return (err && err.message) || 'Could not turn on notifications. Try again.';
}

// Depuis un geste de la cleaner uniquement. La permission est demandee AVANT tout
// appel reseau : Safari perd le geste apres un fetch et refuse alors la demande.
export async function enablePush() {
  if (!supported()) throw new Error('Notifications are not available on this phone.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    const e = new Error('Tap Allow when your phone asks.');
    e.denied = perm === 'denied';
    throw e;
  }
  const r = await api.get('getVapidPublicKey');
  const key = r && r.publicKey;
  if (!key) throw new Error('Notifications are not ready yet. Tell your manager.');
  const reg = await ensureRootRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await sendSubscription(sub);
  writeKey(SYNC_KEY, today());
}

// Abonnement deja present dans le navigateur (ancienne app, autre session) : on le
// renvoie une fois par jour, sans rien montrer, pour que le serveur le rattache a
// la personne connectee et le reactive (upsert, disabled_at remis a null).
async function resyncQuietly() {
  if (readKey(SYNC_KEY) === today()) return;
  try {
    const reg = await rootRegistration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    await sendSubscription(sub);
    writeKey(SYNC_KEY, today());
  } catch (e) { /* prochaine ouverture */ }
}

// Ecran a montrer pour un etat, ou null. Pur, pour les tests.
export function promptFor(state, ios, installed) {
  if (state === 'off') {
    return {
      kind: 'off',
      title: 'Get your job reminders',
      text: 'Turn on notifications. We will remind you about your cleanings on this phone.',
      button: 'Turn on notifications',
      later: 'Not now',
    };
  }
  if (state === 'denied') {
    return {
      kind: 'denied',
      title: 'Notifications are blocked',
      text: ios
        ? 'Open Settings on your iPhone, tap Notifications, tap HK Planner, then turn on Allow Notifications.'
        : 'Open your phone Settings, find your browser or HK Planner, tap Notifications, then allow them.',
      button: 'OK',
    };
  }
  if (state === 'unsupported' && ios && !installed) {
    return {
      kind: 'install',
      title: 'Add HK Planner to your Home Screen',
      text: 'To get reminders on iPhone: tap the Share button, then tap Add to Home Screen. Then open HK Planner from your Home Screen.',
      button: 'OK',
    };
  }
  return null;
}

function close(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

function paint(el, p, errorText) {
  el.innerHTML = '<div class="pushgate-in">' + icon(p.kind === 'off' ? 'clock' : 'alert', 40) +
    '<h1 id="pushgate-t">' + esc(p.title) + '</h1>' +
    '<p>' + esc(p.text) + '</p>' +
    (errorText ? '<p class="pushgate-err" role="alert">' + esc(errorText) + '</p>' : '') +
    '<button class="btn-primary" type="button" data-push="main">' + esc(p.button) + '</button>' +
    (p.later ? '<button class="pushgate-later" type="button" data-push="later">' + esc(p.later) + '</button>' : '') +
    '</div>';
}

// Ecran plein « Turn on notifications ». Une couche par-dessus l'app, jamais un
// blocage : « Not now » / « OK » la ferme jusqu'au lendemain.
export async function mountPushPrompt() {
  if (document.getElementById('pushgate')) return;
  const st = await pushState().catch(function () { return 'unsupported'; });
  if (st === 'on') { resyncQuietly(); return; }
  if (readKey(LATER_KEY) === today()) return;
  let p = promptFor(st, isIos(), standalone());
  if (!p) return;
  const el = document.createElement('div');
  el.id = 'pushgate';
  el.className = 'pushgate';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'pushgate-t');
  paint(el, p, '');
  document.body.appendChild(el);
  let busy = false;
  el.addEventListener('click', async function (e) {
    const b = e.target && e.target.closest ? e.target.closest('[data-push]') : null;
    if (!b || busy) return;
    const which = b.getAttribute('data-push');
    if (which === 'later' || p.kind !== 'off') {
      writeKey(LATER_KEY, today());
      close(el);
      return;
    }
    busy = true;
    b.disabled = true;
    b.textContent = 'Turning on…';
    try {
      await enablePush();
      close(el);
      toast('Notifications are on.');
    } catch (err) {
      busy = false;
      if (err && err.denied) p = promptFor('denied', isIos(), standalone());
      paint(el, p, err && err.denied ? '' : messageFor(err));
    }
  });
}
