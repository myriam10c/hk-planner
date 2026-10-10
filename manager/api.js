// Acces au proxy pour /manager/. Memes conventions que /inspections/api.js
// (action en query, X-App-Secret, puis Bearer ou X-Cleaner-Token), plus un delai
// client de 15 s (spec section 7, cas du proxy lent du 07/10) : au-dela, on
// n'attend plus et l'ecran propose Retry.
import { API, APP_SECRET } from '/v3/proxy-config.js';
import { getSession } from '/v3/session.js';

export const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(message, kind, status) { super(message); this.name = 'ApiError'; this.kind = kind; this.status = status; }
}

// Crochet de test : window.__MGR_TIMEOUT_MS raccourcit le delai.
function timeoutMs() {
  const t = Number(typeof window !== 'undefined' ? window.__MGR_TIMEOUT_MS : 0);
  return t > 0 ? t : TIMEOUT_MS;
}

async function headers() {
  const s = await getSession();
  const h = { 'X-App-Secret': APP_SECRET };
  if (s && s.kind === 'bearer') h['Authorization'] = 'Bearer ' + s.token;
  else if (s && s.kind === 'pin') h['X-Cleaner-Token'] = s.token;
  return h;
}

async function send(url, init) {
  const ctrl = new AbortController();
  let timer = null;
  // Course plutot que la seule annulation : un fetch qui ignore le signal ne
  // doit pas tenir l'ecran.
  const late = new Promise((_res, rej) => {
    timer = setTimeout(() => {
      try { ctrl.abort(); } catch (e) { /* deja fini */ }
      rej(new ApiError('HK Planner is taking too long to answer. Try again.', 'timeout', 0));
    }, timeoutMs());
  });
  let res;
  try {
    res = await Promise.race([fetch(url, { ...init, signal: ctrl.signal }), late]);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('No connection. Try again.', 'offline', 0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new ApiError('Please sign in again.', 'auth', 401);
  if (res.status === 403) throw new ApiError(data.error || 'Not allowed.', 'forbidden', 403);
  if (!res.ok || data.error) throw new ApiError(data.error || ('Error ' + res.status), 'server', res.status);
  return data;
}

export async function get(action, params) {
  let url = API + '?action=' + encodeURIComponent(action);
  for (const k of Object.keys(params || {})) url += '&' + k + '=' + encodeURIComponent(params[k]);
  return send(url, { headers: await headers() });
}

export async function post(action, body) {
  return send(API + '?action=' + encodeURIComponent(action), {
    method: 'POST', headers: { ...(await headers()), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

// Cle d'idempotence d'un geste (meme format que v3 et inspections, validIdem
// cote proxy : [A-Za-z0-9_-]{8,80}). Une cle neuve par geste de l'utilisateur.
export function newIdem() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') return 'mgr-' + c.randomUUID().replace(/-/g, '');
  return 'mgr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
