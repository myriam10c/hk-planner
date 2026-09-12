// Acces au proxy. Session prise dans le stockage ecrit par l'app actuelle : la
// v3 ne cree aucune session a elle, se connecter une fois sur « / » suffit
// (specification, phase A : « login reutilisant l'ecran email/PIN existant »).
import { API, APP_SECRET } from '/v3/proxy-config.js';

const TIMEOUT_MS = 15000;

// Bearer d'abord, jeton PIN ensuite, comme le proxy (Bearer > X-Cleaner-Token).
// Une session email expiree est ignoree : la v3 ne sait pas la rafraichir, elle
// laisse la main au jeton PIN, sinon elle enverrait un 401 a chaque geste.
export function readSession(store) {
  const s = store || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return null;
  let raw = null;
  try { raw = s.getItem('hkAuthSession'); } catch (e) { raw = null; }
  if (raw) {
    try {
      const sess = JSON.parse(raw);
      const token = sess && sess.access_token;
      const exp = sess && Number(sess.expires_at);
      if (token && (!Number.isFinite(exp) || exp * 1000 > Date.now() + 30000)) {
        return { kind: 'bearer', token: token };
      }
    } catch (e) { /* session illisible : on tente le PIN */ }
  }
  let pin = null;
  try { pin = s.getItem('cleanerToken'); } catch (e) { pin = null; }
  return pin ? { kind: 'pin', token: pin } : null;
}

export function authHeaders(session) {
  const h = { 'X-App-Secret': APP_SECRET };
  if (!session) return h;
  if (session.kind === 'bearer') h['Authorization'] = 'Bearer ' + session.token;
  else h['X-Cleaner-Token'] = session.token;
  return h;
}

// kind : 'offline' (reseau coupe ou delai depasse, l'action part dans la file),
// 'auth' (401, il faut se reconnecter), 'server' (le proxy a refuse).
export class ApiError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

async function request(action, opts) {
  const o = opts || {};
  let url = API + '?action=' + encodeURIComponent(action);
  for (const k of Object.keys(o.params || {})) {
    url += '&' + k + '=' + encodeURIComponent(o.params[k]);
  }
  // `o.headers` s'ajoute aux en-tetes de session, et gagne en cas de doublon :
  // la deconnexion doit pouvoir poser X-Cleaner-Token meme quand une session
  // email fait passer authHeaders en Bearer, sinon le proxy ne sait pas quelle
  // ligne de cleaner_sessions revoquer (revue tache 12, constat 1).
  const headers = Object.assign(authHeaders(readSession()), o.headers || {});
  const init = { headers: headers };
  if (o.form) {
    init.method = 'POST';
    init.body = o.form;
  } else if (o.body) {
    init.method = 'POST';
    init.headers = Object.assign({}, headers, { 'Content-Type': 'application/json' });
    init.body = JSON.stringify(o.body);
  }
  // Les reseaux mobiles tombent en silence : sans delai maximum, un fetch peut
  // pendre indefiniment et le geste est perdu sans que rien ne le dise.
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
  init.signal = ctrl.signal;
  let resp;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    // Un delai depasse se comporte comme une coupure : l'action part dans la file.
    throw new ApiError('offline', 'offline', 0);
  } finally {
    clearTimeout(timer);
  }
  if (resp.status === 401) throw new ApiError('Sign in again', 'auth', 401);
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  if (!resp.ok || (data && data.error)) {
    throw new ApiError((data && data.error) || ('HTTP ' + resp.status), 'server', resp.status);
  }
  return data;
}

export const api = {
  get: function (action, params) { return request(action, { params: params }); },
  post: function (action, body, headers) { return request(action, { body: body, headers: headers }); },
  upload: function (action, form) { return request(action, { form: form }); },
};
