// Acces au proxy. La session vient de /v3/session.js : la session email de
// l'app actuelle (meme client supabase-js, meme stockage, renouvelee quand elle
// expire), sinon le jeton PIN. La v3 ne cree aucune session a elle, se connecter
// une fois sur « / » suffit (specification, phase A : « login reutilisant
// l'ecran email/PIN existant »).
import { API, APP_SECRET } from '/v3/proxy-config.js';
import { getSession, renewSession } from '/v3/session.js';
import { PASSE_PRACTICE, practiceActive, practiceEnded, simulate } from '/v3/practice.js';

const TIMEOUT_MS = 15000;
// Message du proxy quand la session (Bearer ou PIN) n'est pas reconnue :
// currentUser, supabase/functions/hostaway-proxy/index.ts.
const ERREUR_SESSION = 'auth required';

// Bearer d'abord, jeton PIN ensuite, comme le proxy (Bearer > X-Cleaner-Token).
// Lue a chaque requete, jamais gardee depuis le boot : un jeton expire entre
// deux gestes est renouvele avant l'envoi, aucun Bearer perime ne part.
// { kind: 'stale' } : session email a renouveler des que le reseau revient.
export async function readSession() {
  return await getSession();
}

export function authHeaders(session) {
  const h = { 'X-App-Secret': APP_SECRET };
  if (!session) return h;
  if (session.kind === 'bearer') h['Authorization'] = 'Bearer ' + session.token;
  else if (session.kind === 'pin') h['X-Cleaner-Token'] = session.token;
  // 'stale' : aucun en-tete d'identite.
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

// Reponse du simulateur traitee comme celle du proxy : memes erreurs, meme type.
function reponseSimulee(r) {
  const data = r && r.body ? r.body : null;
  if (!r || r.status >= 400 || (data && data.error)) {
    throw new ApiError((data && data.error) || ('HTTP ' + (r ? r.status : 0)), 'server', r ? r.status : 0);
  }
  return data;
}

async function request(action, opts, dejaRenouvele) {
  const o = opts || {};
  // Ecriture nee dans une seance Practice qui est finie depuis (Exit pendant le
  // redimensionnement d'une photo, par exemple) : elle ne part jamais, ni au
  // proxy ni en file. Erreur locale, d'un type que sendOrQueue ne garde pas.
  if (o.practice && practiceEnded(o.practice)) {
    throw new ApiError('Practice ended', 'practice', 0);
  }
  // Mode Practice : point de passage unique. Toute action autre que la lecture
  // de la journee et la deconnexion est servie par le simulateur, avant meme la
  // lecture de session : rien ne part, hors ligne compris.
  if (practiceActive() && !PASSE_PRACTICE.has(action)) {
    return reponseSimulee(await simulate(action, o));
  }
  let url = API + '?action=' + encodeURIComponent(action);
  for (const k of Object.keys(o.params || {})) {
    url += '&' + k + '=' + encodeURIComponent(o.params[k]);
  }
  const session = dejaRenouvele ? dejaRenouvele.session : await readSession();
  // Session email en attente de reseau : le renouvellement vient d'echouer faute
  // de reseau, une requete sans identite ne ferait que revenir en 401. On la
  // traite comme une coupure, avant tout fetch : le geste part dans la file.
  if (session && session.kind === 'stale') throw new ApiError('offline', 'offline', 0);
  // `o.headers` s'ajoute aux en-tetes de session, et gagne en cas de doublon :
  // la deconnexion doit pouvoir poser X-Cleaner-Token meme quand une session
  // email fait passer authHeaders en Bearer, sinon le proxy ne sait pas quelle
  // ligne de cleaner_sessions revoquer (revue tache 12, constat 1).
  const headers = Object.assign(authHeaders(session), o.headers || {});
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
  if (resp.status === 401) {
    // Un Bearer refuse (revoque, horloge du telephone en avance) : un seul
    // renouvellement, un seul nouvel essai de la meme requete, jamais de boucle.
    // Seulement sur l'erreur de session du proxy (« auth required », renvoyee
    // par currentUser) : un 401 « unauthorized » vient du secret applicatif,
    // et renouveler la session n'y changerait rien sinon faire tourner le
    // refresh token pour rien.
    let corps = null;
    try { corps = await resp.json(); } catch (e) { corps = null; }
    const erreurSession = !!corps && corps.error === ERREUR_SESSION;
    if (erreurSession && session && session.kind === 'bearer' && !dejaRenouvele) {
      const neuve = await renewSession();
      if (neuve) return request(action, opts, { session: neuve });
    }
    throw new ApiError('Sign in again', 'auth', 401);
  }
  let data = null;
  try { data = await resp.json(); } catch (e) { data = null; }
  if (!resp.ok || (data && data.error)) {
    throw new ApiError((data && data.error) || ('HTTP ' + resp.status), 'server', resp.status);
  }
  return data;
}

// `practice` (optionnel) : la marque de la seance Practice ou le geste est ne
// (practiceMark), posee par sendOrQueue.
export const api = {
  get: function (action, params) { return request(action, { params: params }); },
  post: function (action, body, headers, practice) {
    return request(action, { body: body, headers: headers, practice: practice });
  },
  upload: function (action, form, practice) { return request(action, { form: form, practice: practice }); },
};
