// Application cleaner v3 : etat, routeur de hash, delegation des evenements.
// Aucun gestionnaire en ligne (CSP script-src 'self'), aucun emoji, interface en
// anglais. Les ecrans vivent dans /v3/screens/ et exposent view/actions/mount.
import { api, ApiError, readSession } from '/v3/api.js';
import { flush, onQueueChange, pendingCount, watchNetwork } from '/v3/offline.js';
import { onSessionRenewed } from '/v3/session.js';
import { closeSheet, esc, icon, sheetIsOpen, toast } from '/v3/ui.js';
import today from '/v3/screens/today.js';
import job from '/v3/screens/job.js';
import profile from '/v3/screens/profile.js';

export const state = {
  session: null,
  day: null,          // charge de v3.myDay
  jobId: null,        // arret ouvert
  queued: 0,          // gestes en attente de synchronisation
  loading: true,
  error: '',
  // Etat de travail d'un menage, remis a zero a chaque ouverture d'un arret
  // (openJob) pour ne jamais heriter du menage precedent.
  ticks: {},            // item -> coche
  itemPhotos: {},       // item -> {photoId, photoIdem}
  ticketPhotos: {},     // ticketId -> {photoId, photoIdem}
  checkedTickets: {},   // ticketId -> true
  photoIds: [],         // identifiants a rattacher au menage a la fin
  linen: {},            // sept postes de linge
  jobNote: '',
  finished: null,       // resume affiche apres la fin
  report: null,         // feuille de signalement ouverte : categorie, photo, envoi
  reportStop: null,     // l'arret que ce signalement concerne
  dead: [],             // actions refusees par le proxy, lues par l'ecran Profile
  prepared: false,      // l'ecran courant a deja charge ce dont il a besoin
  viewAs: null,         // {id, name} : un manager regarde la journee de quelqu'un
};

// Mode « View as » : un manager regarde la journee d'une cleaner, en lecture
// seule. Il vit dans sessionStorage, jamais dans localStorage : il ne survit ni
// a la fermeture de l'onglet ni a Sign out, et ce n'est jamais une identite (le
// proxy relit le role de la session a chaque appel, et refuse `as` a quiconque
// n'est pas manager).
//
// Il est lie a la personne qui l'a choisi (`viewerId`, revue tache 1, constat
// 2) : si une autre personne se connecte dans la meme fenetre, le mode est
// jete avant tout appel quand l'identite est connue sur l'appareil
// (hkSessionCleanerId, pose par les deux connexions de l'app racine), sinon des
// la reponse du proxy, qui dit qui regarde. Un mode relu au demarrage n'affiche
// son bandeau qu'une fois confirme par cette reponse.
export const CLE_VIEW_AS = 'v3ViewAs';
const CLE_IDENTITE = 'hkSessionCleanerId';

function lireViewAs() {
  try {
    const v = JSON.parse(sessionStorage.getItem(CLE_VIEW_AS) || 'null');
    if (!v || !/^\d+$/.test(String(v.id)) || !/^\d+$/.test(String(v.viewerId))) return null;
    return { id: String(v.id), name: String(v.name || ''), viewerId: String(v.viewerId), confirmed: false };
  } catch (e) {
    return null;
  }
}

function ecrireViewAs(v) {
  try {
    if (v) sessionStorage.setItem(CLE_VIEW_AS, JSON.stringify({ id: v.id, name: v.name, viewerId: v.viewerId }));
    else sessionStorage.removeItem(CLE_VIEW_AS);
  } catch (e) { /* stockage indisponible : le mode vit le temps de la page */ }
}

function identiteLocale() {
  try {
    const v = localStorage.getItem(CLE_IDENTITE);
    return v && /^\d+$/.test(v) ? v : null;
  } catch (e) {
    return null;
  }
}

function oublierViewAs() {
  state.viewAs = null;
  ecrireViewAs(null);
}

// Toute perte de session emporte le mode : il n'appartient qu'a elle.
function perdreSession() {
  state.session = null;
  oublierViewAs();
}

// Vrai des que l'une des deux sources le dit : le choix local (avant meme la
// reponse du proxy) ou le payload. Les deux gardes vont dans le sens ferme.
export function readOnly(st) {
  const s = st || state;
  return !!s.viewAs || !!(s.day && s.day.viewAs);
}

// Gestes d'ecriture des ecrans Job, Today et des feuilles. En « View as », la
// delegation les avale avant meme l'ecran : rien ne part, rien n'entre en file.
const GESTES_ECRITURE = new Set([
  'start', 'tick', 'shoot', 'shoot-ticket', 'checkTicket', 'report', 'finish',
  'finish-confirm', 'report-cat', 'report-shot', 'report-send', 'linen-plus', 'linen-minus',
]);

// Mode d'affichage courant, ou null : une seule source pour le bandeau. Un mode
// futur s'ajoute ici et dans BANDEAUX, sans toucher aux ecrans.
export function currentMode() {
  if (state.viewAs && state.viewAs.confirmed) {
    const jour = state.day && state.day.viewAs ? state.day : null;
    return { kind: 'viewAs', name: (jour && jour.me && jour.me.name) || state.viewAs.name };
  }
  return null;
}

const BANDEAUX = {
  viewAs: function (mode) {
    return { text: 'Viewing ' + mode.name + '\'s day · read only', act: 'viewas-exit', label: 'Exit' };
  },
};

// Bandeau permanent, en tete de chaque ecran. Dans le flux et non en position
// fixe : il ne recouvre jamais la barre du bas ni les actions du Job.
export function modeBar(mode) {
  const m = mode === undefined ? currentMode() : mode;
  const b = m && BANDEAUX[m.kind] ? BANDEAUX[m.kind](m) : null;
  if (!b) return '';
  return '<div class="viewas" role="status" data-mode="' + esc(m.kind) + '"><span>' + esc(b.text) + '</span>' +
    '<button type="button" data-act="' + esc(b.act) + '">' + esc(b.label) + '</button></div>';
}

export function startViewAs(membre) {
  const jour = state.day || {};
  // Le manager qui choisit : lui-meme sur sa journee, ou celui qui regarde deja.
  const viewer = jour.viewAs && jour.viewer ? jour.viewer.id : (jour.me && jour.me.id);
  if (viewer === undefined || viewer === null) return;
  state.viewAs = {
    id: String(membre.id), name: String(membre.name || ''), viewerId: String(viewer),
    // Choisi a l'instant dans cette page : l'identite est celle de la journee
    // affichee, le bandeau peut paraitre des le chargement.
    confirmed: true,
  };
  ecrireViewAs(state.viewAs);
  state.jobId = null;
  state.finished = null;
  if (location.hash !== '#/today') location.hash = '#/today';
  return loadDay();
}

export function exitViewAs() {
  oublierViewAs();
  state.jobId = null;
  state.finished = null;
  if (location.hash !== '#/today') location.hash = '#/today';
  return loadDay();
}

const screens = {};
export function registerScreen(name, screen) { screens[name] = screen; }

// L'enregistrement vient apres la declaration de `screens` et non en tete de
// fichier : l'import de l'ecran est circulaire (today.js importe app.js), donc
// appeler registerScreen avant `const screens = {}` leverait sur la zone morte
// temporelle du const et casserait le boot.
registerScreen('today', today);
registerScreen('job', job);
registerScreen('profile', profile);

function routeName() {
  const h = String(location.hash || '');
  if (h.indexOf('#/job/') === 0) return 'job';
  if (h === '#/profile') return 'profile';
  return 'today';
}

export function navigate(hash) {
  state.prepared = false;
  if (location.hash === hash) render();
  else location.hash = hash;
}

// Vue d'attente : la coquille quand il n'y a rien de plus a montrer. Sert aussi
// de filet tant qu'aucun ecran n'est enregistre (les ecrans arrivent aux taches
// 10 a 12), pour qu'un rendu sans ecran ne casse jamais le boot.
function vueAttente(texte) {
  return '<div class="gate">' + icon('clock', 28) + '<h1>HK Planner</h1>' +
    '<p class="muted">' + esc(texte) + '</p></div>';
}

export function render() {
  const app = document.getElementById('app');
  if (!state.session) {
    app.innerHTML =
      '<div class="gate">' + icon('clock', 28) + '<h1>HK Planner</h1>' +
      '<p class="muted">Sign in on HK Planner to see your day.</p>' +
      '<a href="/#cleaner">Sign in</a></div>';
    return;
  }
  // Le bandeau de file accompagne aussi l'attente et l'erreur : rouvrir l'app
  // hors ligne au milieu d'un menage echoue sur v3.myDay, et la cleaner doit
  // voir la que ses gestes sont gardes, pas seulement une panne de reseau.
  if (state.loading) {
    app.innerHTML = modeBar() + queueStrip() +
      '<div class="gate"><h1>HK Planner</h1><p class="muted">Loading your day.</p></div>';
    return;
  }
  if (state.error) {
    app.innerHTML = modeBar() + queueStrip() +
      '<div class="gate"><h1>HK Planner</h1><p class="muted">' + esc(state.error) +
      '</p><button class="btn-primary" data-act="reload">Try again</button></div>';
    return;
  }
  const screen = screens[routeName()] || screens.today;
  if (!screen) {
    app.innerHTML = queueStrip() + vueAttente('Loading your day.');
    return;
  }
  // Une seule passe : prepare() charge ce dont l'ecran a besoin (le magasin des
  // actions refusees, pour Profile) puis redessine. Le drapeau est pose AVANT
  // l'appel, sinon le redessin relancerait prepare() a l'infini ; il est remis a
  // zero a chaque changement de route, pour qu'un retour sur l'ecran relise.
  if (screen.prepare && !state.prepared) {
    state.prepared = true;
    Promise.resolve(screen.prepare(state)).catch(function () { /* l'ecran gere */ })
      .then(function () { render(); });
  }
  app.innerHTML = modeBar() + screen.view(state);
  if (screen.mount) screen.mount(state);
}

// Bandeau « Saved on device » : une seule formulation, celle de la maquette.
export function queueStrip() {
  if (!state.queued) return '';
  return '<div class="offstrip"><i></i><span>Saved on device, ' + state.queued +
    ' to sync</span></div>';
}

// Ouvrir un arret remet a zero l'etat de travail et repart de la progression
// deja enregistree cote serveur : rouvrir un menage ne perd jamais les cases
// deja cochees, et n'herite jamais de celles du menage precedent.
export function openJob(state, stop) {
  state.jobId = stop.jobId;
  state.finished = null;
  state.ticks = Object.assign({}, stop.progress || {});
  state.itemPhotos = {};
  state.ticketPhotos = {};
  state.checkedTickets = {};
  state.photoIds = [];
  state.linen = {};
  state.jobNote = '';
  state.report = null;
  state.reportStop = null;
  navigate('#/job/' + encodeURIComponent(stop.jobId));
}

// Generation de la demande de journee (revue tache 1, constat 1). Depuis le
// mode « View as », deux appels successifs ne demandent plus la meme journee :
// sans ce numero, la reponse arrivee la DERNIERE gagnait, et un Exit ou un
// changement de cleaner pendant un chargement lent affichait la journee de
// quelqu'un d'autre sans bandeau. Seule la reponse de la demande la plus
// recente est appliquee, succes comme erreur.
let generationJour = 0;

// La reponse colle-t-elle au mode demande ? Seconde garde, en plus du numero.
function reponseConforme(data, vue) {
  if (!data) return false;
  if (!vue) return !data.viewAs;
  return !!data.viewAs && !!data.me && String(data.me.id) === vue.id;
}

export async function loadDay() {
  const generation = ++generationJour;
  const vue = state.viewAs;
  state.loading = true;
  state.error = '';
  render();
  try {
    const data = await api.get('v3.myDay', vue ? { as: vue.id } : {});
    if (generation !== generationJour) return;   // demande depassee
    if (state.viewAs !== vue || !reponseConforme(data, vue)) {
      // Mode change sans nouvelle demande, ou reponse d'un autre mode : on ne
      // l'affiche jamais. En « View as », on repart de sa propre journee ; sur
      // sa propre journee, une reponse non conforme est une erreur (pas de
      // boucle de rechargement).
      if (vue) {
        oublierViewAs();
        return loadDay();
      }
      throw new Error('Could not load your day.');
    }
    if (vue) {
      // Le mode appartient a qui l'a choisi : un autre manager connecte dans
      // la meme fenetre n'en herite pas, meme en silence.
      if (!data.viewer || String(data.viewer.id) !== vue.viewerId) {
        oublierViewAs();
        return loadDay();
      }
      vue.confirmed = true;
    }
    state.day = data;
    // Au premier chargement, l'arret ouvert vient du fragment d'URL et non d'un
    // clic : state.jobId est encore vide, on le lit dans l'adresse. Repartir de
    // la progression enregistree fait qu'un rechargement au milieu d'un menage
    // retrouve les cases deja cochees.
    const ouvert = state.jobId ||
      (String(location.hash).indexOf('#/job/') === 0
        ? decodeURIComponent(String(location.hash).replace('#/job/', ''))
        : null);
    const stop = (data.stops || []).find(function (s) { return s.jobId === ouvert; });
    if (stop) {
      state.jobId = stop.jobId;
      state.ticks = Object.assign({}, stop.progress || {});
    }
    state.loading = false;
    render();
  } catch (err) {
    if (generation !== generationJour) return;   // erreur d'une demande depassee
    state.loading = false;
    // La cible n'est plus dans l'equipe (400), ou la session n'est plus celle
    // d'un manager (403) : on sort du mode et on recharge sa propre journee,
    // une seule fois puisque state.viewAs est alors vide. Le message n'est dit
    // qu'a la personne qui avait choisi le mode dans cette page : un mode relu
    // au demarrage et jamais confirme sort en silence.
    if (vue && state.viewAs === vue && err instanceof ApiError && err.kind === 'server' &&
        (err.status === 400 || err.status === 403)) {
      oublierViewAs();
      state.jobId = null;
      if (vue.confirmed) toast('This view is no longer available', 'err');
      if (location.hash !== '#/today') location.hash = '#/today';
      return loadDay();
    }
    if (err instanceof ApiError && err.kind === 'auth') {
      perdreSession();
    } else if (err instanceof ApiError && err.kind === 'offline') {
      state.error = 'No network. Your saved actions will sync on their own.';
    } else {
      state.error = err.message || 'Could not load your day.';
    }
    render();
  }
}

// Delegation : un seul ecouteur pour toute l'application. Chaque bouton porte
// data-act, l'ecran courant dit quoi en faire.
document.addEventListener('click', function (evt) {
  const cible = evt.target.closest('[data-act]');
  if (!cible) {
    // Toucher le fond d'une feuille la ferme.
    if (sheetIsOpen() && evt.target.hasAttribute('data-sheet')) closeSheet();
    return;
  }
  const nom = cible.getAttribute('data-act');
  if (nom === 'reload') { loadDay(); return; }
  if (nom === 'close-sheet') { closeSheet(); return; }
  if (nom === 'viewas-exit') { evt.preventDefault(); exitViewAs(); return; }
  if (readOnly(state) && GESTES_ECRITURE.has(nom)) {
    evt.preventDefault();
    toast('Read only', 'err');
    return;
  }
  const screen = screens[routeName()] || screens.today;
  const handler = screen && screen.actions && screen.actions[nom];
  if (!handler) return;
  evt.preventDefault();
  Promise.resolve(handler(state, cible, evt)).catch(function (err) {
    if (err instanceof ApiError && err.kind === 'auth') {
      perdreSession();
      render();
      return;
    }
    toast(err && err.message ? err.message : 'Something went wrong', 'err');
  });
});

// Changer de route remet le drapeau de preparation a zero : les liens de la
// barre du bas passent par le hash et non par navigate(), et sans cette remise a
// zero un retour sur Profile reafficherait la liste telle qu'elle etait a la
// premiere visite.
window.addEventListener('hashchange', function () {
  // Une feuille vit dans #sheet-host, hors de #app : un redessin ne la retire
  // pas. Apres un geste Back elle restait donc ouverte au-dessus d'un autre
  // ecran, et la delegation, qui lit les actions de l'ecran de la NOUVELLE
  // route, n'y trouvait plus « Send » ni « Finish » : l'appui etait avale sans
  // un mot et le signalement perdu (revue tache 12, constat 2). On ferme la
  // feuille avant de redessiner, et on rend son etat de travail avec elle.
  if (sheetIsOpen()) {
    closeSheet();
    state.report = null;
    state.reportStop = null;
  }
  state.prepared = false;
  render();
});

onQueueChange(function (n) {
  if (state.queued === n) return;
  state.queued = n;
  const strip = document.querySelector('.offstrip span');
  // Tant qu'il reste des gestes et que le bandeau est la, on ne redessine pas
  // tout l'ecran pour un compteur. Des que la file se vide, il faut le retirer.
  if (n > 0 && strip) {
    strip.textContent = 'Saved on device, ' + n + ' to sync';
    return;
  }
  render();
});

// Un renouvellement de la session email (minuteur de supabase-js, retour du
// reseau, ou onglet de l'app racine) relance le rejeu : des gestes mis en file
// pendant une session « stale » repartent avec le nouveau Bearer.
// Si la journee n'a pas pu se charger (demarrage en « stale » sur un reseau
// lent), elle se recharge aussi : sinon « No network » resterait affiche alors
// que la session et le reseau marchent.
onSessionRenewed(function () {
  if (!state.session) return;
  flush();
  if (state.error && !state.loading) loadDay();
});

export async function boot() {
  // La lecture de session peut attendre un renouvellement (quelques secondes au
  // pire) : on montre l'attente plutot qu'un ecran vide ou « Sign in ».
  const app = document.getElementById('app');
  if (app) app.innerHTML = vueAttente('Loading your day.');
  // { kind: 'stale' } compte comme connecte : la cleaner reste dans l'app, les
  // appels partent dans la file comme pour toute coupure.
  state.session = await readSession();
  // Le mode relu n'est garde que pour une session, et pour la personne qui l'a
  // choisi quand l'appareil sait deja qui est connecte : aucun `as` ne part
  // alors pour quelqu'un d'autre.
  state.viewAs = state.session ? lireViewAs() : null;
  const qui = identiteLocale();
  if (state.viewAs && qui && qui !== state.viewAs.viewerId) state.viewAs = null;
  if (!state.viewAs) ecrireViewAs(null);
  if (!state.session) {
    state.loading = false;
    render();
    window.__v3ready = true;
    return;
  }
  watchNetwork();
  state.queued = await pendingCount();
  await loadDay();
  // Un rejeu au demarrage : l'application a pu etre fermee hors ligne.
  if (navigator.onLine) flush();
  // Enregistrement apres le premier rendu : l'installation ne doit jamais
  // retarder l'affichage de la journee. Aucun abonnement push ici : la cleaner
  // recoit deja ses notifications par l'app actuelle, un second abonnement lui
  // en ferait deux pour chaque affectation.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/v3/sw.js', { scope: '/v3/' })
      .catch(function (e) { console.warn('[v3] service worker non enregistre', e); });
  }
  window.__v3ready = true;
}

boot();
