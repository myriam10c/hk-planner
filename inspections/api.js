// Acces au proxy pour le module Inspections. Memes conventions que /v3/api.js :
// action en query (?action=...), X-App-Secret, puis Bearer ou X-Cleaner-Token.
import { API, APP_SECRET } from '/v3/proxy-config.js';
import { getSession } from '/v3/session.js';

export class ApiError extends Error {
  constructor(message, kind, status) { super(message); this.name = 'ApiError'; this.kind = kind; this.status = status; }
}
async function headers() {
  const s = await getSession();
  const h = { 'X-App-Secret': APP_SECRET };
  if (s && s.kind === 'bearer') h['Authorization'] = 'Bearer ' + s.token;
  else if (s && s.kind === 'pin') h['X-Cleaner-Token'] = s.token;
  return h;
}
async function send(url, init) {
  let res;
  try { res = await fetch(url, init); } catch (e) { throw new ApiError('No connection. Try again.', 'offline', 0); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new ApiError('Please sign in again.', 'auth', 401);
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
export async function upload(action, form) {
  return send(API + '?action=' + encodeURIComponent(action), { method: 'POST', headers: await headers(), body: form });
}
export function newIdem(prefix) {
  return (prefix + '-' + crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}
