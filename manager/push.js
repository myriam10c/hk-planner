// Notifications push de l'app manager. Utilise le service worker racine /sw.js
// (portee /, il gere deja les evenements push et notificationclick, et laisse
// passer /manager/ sans cache). Memes corps que l'ancienne app (app.js,
// subscribePush / disablePushNotifications / sendPushTest), sans l'importer.
import { post } from '/manager/api.js';

// Memes cles locales que l'ancienne app : l'interrupteur y reste juste.
const PUSH_SUB_KEY = 'pushSubscribed';
const PUSH_ENDPOINT_KEY = 'pushEndpointSynced';
const READY_TIMEOUT_MS = 10000;

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

async function existingRegistration() {
  try { return (await navigator.serviceWorker.getRegistration('/')) || null; } catch (e) { return null; }
}

// Attend un worker actif, borne : un enregistrement bloque (fenetre privee) ne doit pas figer l'ecran.
function waitActive(reg) {
  if (reg.active) return Promise.resolve(reg);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The notification service did not start. Try again.')), READY_TIMEOUT_MS);
    const w = reg.installing || reg.waiting;
    if (!w) { clearTimeout(timer); reject(new Error('The notification service did not start. Try again.')); return; }
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') { clearTimeout(timer); resolve(reg); }
      else if (w.state === 'redundant') { clearTimeout(timer); reject(new Error('The notification service did not start. Try again.')); }
    });
  });
}

async function registration() {
  const reg = (await existingRegistration()) || await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return waitActive(reg);
}

export async function pushState() {
  if (!supported()) return 'unsupported';
  const p = permission();
  if (p === 'denied') return 'denied';
  if (p !== 'granted') return 'off';
  try {
    const reg = await existingRegistration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    return sub ? 'on' : 'off';
  } catch (e) { return 'off'; }
}

// Appelee depuis un geste utilisateur uniquement (exigence Safari et Chrome).
export async function enablePush(vapidPublicKey) {
  if (!supported()) throw new Error('Notifications are not supported on this device.');
  if (!vapidPublicKey) throw new Error('Push is not configured on the server.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked in the browser settings.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
  const j = sub.toJSON();
  await post('savePushSubscription', {
    endpoint: j.endpoint,
    keys: { p256dh: j.keys.p256dh, auth: j.keys.auth },
    user_agent: (navigator.userAgent || '').slice(0, 300),
  });
  try { localStorage.setItem(PUSH_SUB_KEY, '1'); localStorage.setItem(PUSH_ENDPOINT_KEY, j.endpoint); } catch (e) { /* stockage indisponible */ }
}

export async function disablePush() {
  const reg = await existingRegistration();
  const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await post('deletePushSubscription', { endpoint: sub.toJSON().endpoint });
    try { await sub.unsubscribe(); } catch (e) { /* deja retire */ }
  }
  try { localStorage.removeItem(PUSH_SUB_KEY); localStorage.removeItem(PUSH_ENDPOINT_KEY); } catch (e) { /* stockage indisponible */ }
}

// Envoie un test aux appareils du manager connecte. Rend { sent, skipped } du proxy.
export async function testPush() {
  return post('pushTest', {});
}
