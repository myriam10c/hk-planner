// Application cleaner v3 : coquille de l'interface « conversation » portee du
// prototype (hk-cleaner-proto, commit 875ea4e), branchee sur la journee reelle.
//
// Ce qui vient de la v3 : session (email ou PIN partagee avec la racine), lecture
// de v3.myDay, file hors ligne et son bandeau, View as / Practice, Profile.
// Ce qui vient du prototype : la liste, la conversation, le viseur integre, le
// signalement en ecrans pleins, le rapport et le partage, avec leurs gardes
// (busy, generation camera et relance au retour visible, <video> permanent,
// repli appareil photo du telephone, rendus differes pendant la saisie, retour
// Android). Toute la logique metier vit dans les modules purs de /v3/conv/.
//
// Ecritures (tache 5) : apres chaque geste, /v3/conv/sync.js compare la
// conversation a ce qui est deja parti et rend les actions du proxy ; elles
// passent TOUTES par la file de offline.js (submit), dans l'ordre. ✓ = en file,
// ✓✓ = reponse 2xx recue pour son idem (onSent).
// Reprise : chaque conversation est gardee dans sessionStorage (persist.js) et
// les octets des photos dans IndexedDB ; un rechargement revient au meme ecran.
//
// Modes (tache 6) : writeMode (sync.js) dit qui ecrit. View as : la conversation
// de la cleaner en lecture seule (readOnlyConversation), ni camera, ni ecriture,
// ni sauvegarde. Practice : les memes gestes, servis un par un par le simulateur
// (practice.js, via api.js), jamais par la file ; ses conversations sont gardees
// a part (v3PracticeConvs) et effacees avec la seance ; rien n'est partage.
// Aucun gestionnaire en ligne (CSP script-src 'self'), interface en anglais.
import { api, ApiError, readSession } from '/v3/api.js';
import {
  deleteState, flush, getFiles, getState, newIdem, onQueueChange, onRefused, onSent, pendingCount, purgeFiles,
  putFile, putState, sendOrQueue, submit, unqueue, watchNetwork,
} from '/v3/offline.js';
import { onSessionRenewed } from '/v3/session.js';
import {
  practiceActive, practiceDay, practiceLoadConvs, practiceMark, practiceOff, practiceOn, practiceSaveConvs,
} from '/v3/practice.js';
import { esc, icon, toast } from '/v3/ui.js';
import profile from '/v3/screens/profile.js';
import { dubaiDate, toApartments } from '/v3/conv/day.js';
import { stampText } from '/v3/conv/stamp.js';
import {
  createConversation, currentStep, reply, addPhoto, editProblem, removeProblem, startProblem, chooseKind,
  addFlowPhoto, flowReply, flowBack, currentFlow, reopenProblem, removeArrivalOrEndPhoto, requireLinen,
  readOnlyConversation, ticketStill, startTicketFix, addFixPhoto, fixDone, fixCancel,
} from '/v3/conv/conversation.js';
import {
  syncPlan, finishPlan, ackSync, refreshTicks, runActions, finishAcked, PHOTO_OPTIONAL, writeMode,
} from '/v3/conv/sync.js';
import { serializeConversation, deserializeConversation, photoIdems } from '/v3/conv/persist.js';
import { reportText, reportFiles, arrivalText, arrivalFiles } from '/v3/conv/report.js';
import {
  renderList, renderConversation, renderViewfinder, renderToast, renderFlow, renderPhotoView, renderProblemPage,
  renderTicketFix, escapeHtml,
} from '/v3/conv/ui.js';
import { startCameraIfCurrent, stopCamera, streamLive, captureFrame, pickPhoto } from '/v3/conv/camera.js';
import { shareReport } from '/v3/conv/share.js';

export const state = {
  session: null,
  day: null,            // charge de v3.myDay
  apartments: [],       // la journee, adaptee pour la conversation (day.js)
  queued: 0,            // gestes en attente de synchronisation
  loading: true,
  error: '',
  dead: [],             // actions refusees par le proxy, lues par l'ecran Profile
  prepared: false,      // l'ecran courant a deja charge ce dont il a besoin
  jourGarde: false,     // journee reprise de la copie hors ligne, a relire au retour du reseau
  viewAs: null,         // {id, name, viewerId, confirmed, practice}
  // Conversation (prototype). editIndex : page d'un probleme ouverte ; viewPhoto :
  // miniature de piece agrandie ; flowCam : camera ouverte pour l'ecran des photos
  // d'un signalement (refermee en le quittant).
  screen: 'list', activeId: null, convs: {},
  camera: { open: false, stream: null, live: false },
  toastIndex: null, note: null, autoOpenedAt: null,
  editIndex: null, confirmDelete: false, viewPhoto: null, flowCam: false,
};
// Etat lisible par les tests de bout en bout (comme window.__hk du prototype).
window.__hk = state;
const S = state;

// ---------------------------------------------------------------------------
// Mode « View as » / Practice (inchange depuis la tache 2 du plan 2026-10-02).
// Il vit dans sessionStorage, est lie a la personne qui l'a choisi, et n'est
// jamais une identite : le proxy relit le role de la session a chaque appel.
// ---------------------------------------------------------------------------
export const CLE_VIEW_AS = 'v3ViewAs';
const CLE_IDENTITE = 'hkSessionCleanerId';

function lireViewAs() {
  try {
    const v = JSON.parse(sessionStorage.getItem(CLE_VIEW_AS) || 'null');
    if (!v || !/^\d+$/.test(String(v.id)) || !/^\d+$/.test(String(v.viewerId))) return null;
    return {
      id: String(v.id), name: String(v.name || ''), viewerId: String(v.viewerId), confirmed: false,
      practice: v.practice === true,
    };
  } catch (e) {
    return null;
  }
}

function ecrireViewAs(v) {
  try {
    if (v) {
      sessionStorage.setItem(CLE_VIEW_AS, JSON.stringify({
        id: v.id, name: v.name, viewerId: v.viewerId, practice: v.practice === true,
      }));
    } else sessionStorage.removeItem(CLE_VIEW_AS);
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

// Toute sortie du mode emporte la seance Practice : a sa fin, la vraie file
// reprend son rejeu. `sansRejeu` : Sign out, qui vide la file juste apres.
function oublierViewAs(sansRejeu) {
  const enPractice = practiceActive();
  state.viewAs = null;
  ecrireViewAs(null);
  practiceOff();
  if (enPractice && !sansRejeu && navigator.onLine) flush();
}

export function leaveModeForSignOut() {
  oublierViewAs(true);
  render();
}

export function practicing(st) {
  const s = st || state;
  return !!(s.viewAs && s.viewAs.practice);
}

function perdreSession() {
  state.session = null;
  oublierViewAs(true);
}

export function readOnly(st) {
  const s = st || state;
  if (s.viewAs && s.viewAs.practice) return !practiceActive();
  return !!s.viewAs || !!(s.day && s.day.viewAs);
}

export function currentMode() {
  if (state.viewAs && state.viewAs.confirmed) {
    const jour = state.day && state.day.viewAs ? state.day : null;
    return {
      kind: state.viewAs.practice ? 'practice' : 'viewAs',
      name: (jour && jour.me && jour.me.name) || state.viewAs.name,
    };
  }
  return null;
}

const BANDEAUX = {
  viewAs: function (mode) {
    return { cls: 'viewas', text: 'Viewing ' + mode.name + '\'s day · read only', act: 'viewas-exit', label: 'Exit' };
  },
  practice: function (mode) {
    return { cls: 'practicebar', text: 'Practice as ' + mode.name + ' · nothing is saved', act: 'viewas-exit', label: 'Exit' };
  },
};

// Bandeau permanent, en tete de chaque ecran, dans le flux (jamais en position fixe).
export function modeBar(mode) {
  const m = mode === undefined ? currentMode() : mode;
  const b = m && BANDEAUX[m.kind] ? BANDEAUX[m.kind](m) : null;
  if (!b) return '';
  return '<div class="' + esc(b.cls) + '" role="status" data-mode="' + esc(m.kind) + '"><span>' + esc(b.text) + '</span>' +
    '<button type="button" data-act="' + esc(b.act) + '">' + esc(b.label) + '</button></div>';
}

// Une autre journee s'affiche : les conversations locales de la precedente ne
// lui appartiennent pas.
// S.convs est remplace (jamais vide en place) : une sauvegarde deja demandee
// garde sa photo de l'ancienne journee (persist). Les vraies conversations
// gardees seront relues au retour de la propre journee (repris = false).
function oublierConversations() {
  closeCamera();
  repris = false;
  S.screen = 'list'; S.activeId = null; S.convs = {};
  S.editIndex = null; S.viewPhoto = null; S.confirmDelete = false; S.flowCam = false; S.toastIndex = null;
}

export function startViewAs(membre, practice) {
  const jour = state.day || {};
  const viewer = jour.viewAs && jour.viewer ? jour.viewer.id : (jour.me && jour.me.id);
  if (viewer === undefined || viewer === null) return;
  state.viewAs = {
    id: String(membre.id), name: String(membre.name || ''), viewerId: String(viewer),
    confirmed: true,
    practice: practice === true,
  };
  ecrireViewAs(state.viewAs);
  const etaitPractice = practiceActive();
  practiceOff();
  if (state.viewAs.practice) practiceOn(state.viewAs, false);
  else if (etaitPractice && navigator.onLine) flush();
  oublierConversations();
  if (location.hash !== '#/today') location.hash = '#/today';
  return loadDay();
}

export function startPractice(membre) {
  return startViewAs(membre, true);
}

export function exitViewAs() {
  oublierViewAs();
  oublierConversations();
  if (location.hash !== '#/today') location.hash = '#/today';
  return loadDay();
}

// ---------------------------------------------------------------------------
// Routes : « #/profile » ouvre Profile ; tout le reste (« #/today », vide, et les
// anciennes adresses « #/job/... ») ouvre la liste ou la conversation.
// ---------------------------------------------------------------------------
function routeName() {
  return String(location.hash || '') === '#/profile' ? 'profile' : 'cv';
}

export function navigate(hash) {
  state.prepared = false;
  if (location.hash === hash) render();
  else location.hash = hash;
}

const appEl = document.getElementById('app');
const root = document.getElementById('view');   // seul ce conteneur est reecrit a chaque rendu
const vfVideo = document.getElementById('vf');  // permanent : le flux n'est branche qu'une fois
const fallbackInput = document.getElementById('cam-fallback');
const conv = () => S.convs[S.activeId];
const me = () => (state.day && state.day.me) || { id: null, name: '' };
let toastTimer, noteTimer;

function porte(contenu) {
  appEl.className = '';
  vfVideo.hidden = true;
  root.innerHTML = contenu;
}

function vueAttente(texte) {
  return '<div class="gate">' + icon('clock', 28) + '<h1>HK Planner</h1>' +
    '<p class="muted">' + esc(texte) + '</p></div>';
}

// Bandeau « Saved on device » : une seule formulation, celle de la maquette.
export function queueStrip() {
  if (!state.queued || practicing()) return '';
  return '<div class="offstrip"><i></i><span>Saved on device, ' + state.queued + ' to sync</span></div>';
}

export function render() {
  renderDeferred = false;
  if (!state.session) {
    closeCamera();
    porte('<div class="gate">' + icon('clock', 28) + '<h1>HK Planner</h1>' +
      '<p class="muted">Sign in on HK Planner to see your day.</p>' +
      '<a href="/#cleaner">Sign in</a></div>');
    return;
  }
  // Le bandeau de file accompagne aussi l'attente et l'erreur : rouvrir l'app
  // hors ligne au milieu d'un menage echoue sur v3.myDay, et la cleaner doit
  // voir que ses gestes sont gardes, pas seulement une panne de reseau.
  if (state.loading) {
    closeCamera();
    porte(modeBar() + queueStrip() + '<div class="gate"><h1>HK Planner</h1><p class="muted">Loading your day.</p></div>');
    return;
  }
  if (state.error) {
    closeCamera();
    porte(modeBar() + queueStrip() + '<div class="gate"><h1>HK Planner</h1><p class="muted">' + esc(state.error) +
      '</p><button class="btn-primary" data-act="reload">Try again</button>' +
      '<a class="gate-alt" href="/?legacy=1#cleaner">Open the old app</a></div>');
    return;
  }
  if (routeName() === 'profile') {
    closeCamera();
    // Une seule passe : prepare() lit le magasin des actions refusees, puis redessine.
    if (profile.prepare && !state.prepared) {
      state.prepared = true;
      Promise.resolve(profile.prepare(state)).catch(function () { /* l'ecran gere */ })
        .then(function () { render(); });
    }
    porte(modeBar() + profile.view(state));
    return;
  }
  renderConv();
}

// ---------------------------------------------------------------------------
// Conversation (app.js du prototype, a l'identique sauf la journee reelle).
// ---------------------------------------------------------------------------

// La note prend la place du bandeau en bas (jamais l'un sur l'autre).
function note(text) {
  S.note = text; S.toastIndex = null; clearTimeout(toastTimer); clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { S.note = null; renderLater(); }, 6000);
}

function stepKey(c) { const st = currentStep(c); return c.i + ':' + st.id; }

async function maybeAutoOpen() {
  const c = conv();
  if (!c || c.readOnly || S.screen !== 'conv' || routeName() !== 'cv' || S.camera.open || c.flow || c.fix) return;
  const st = currentStep(c);
  const key = stepKey(c);
  if (st.camera && S.autoOpenedAt !== key) { S.autoOpenedAt = key; await openCamera(); }
}

let camGen = 0; // generation de la demande de flux : une demande depassee arrete son flux

async function openCamera() {
  // Le viseur s'affiche tout de suite (video permanente), puis on demande le flux.
  // Refus = viseur garde ouvert en image fixe (live:false) ; declencheur et tuiles passent par le champ fichier.
  // View as : jamais de camera (rien a photographier pour la cleaner regardee).
  if (S.camera.open || viewOnly() || !conv() || conv().readOnly) return;
  const c0 = conv();
  const gen = ++camGen;
  S.camera = { open: true, stream: null, live: true };
  render();
  const { stream, stale } = await startCameraIfCurrent(vfVideo,
    () => gen === camGen && S.camera.open && conv() === c0 && S.screen === 'conv');
  if (stale) {
    // Une demande plus recente a peut-etre deja branche son flux : on le remet.
    if (S.camera.stream && vfVideo.srcObject !== S.camera.stream) { vfVideo.srcObject = S.camera.stream; vfVideo.play().catch(() => {}); }
    return;
  }
  if (!stream) { S.camera = { open: true, stream: null, live: false }; render(); return; }
  S.camera.stream = stream;
  render();
}

function closeCamera() {
  if (!S.camera.open && !S.camera.stream) return;
  camGen++;
  stopCamera(S.camera.stream);
  vfVideo.srcObject = null;
  S.camera = { open: false, stream: null, live: false };
}

// Viseur ouvert sur un flux mort (ecran verrouille pendant le menage d'une piece) : on redemande un flux.
// Seulement en mode camera en direct : en repli sans camera, on ne relance pas la demande d'autorisation.
async function reviveCamera() {
  if (!S.camera.open || !S.camera.live || S.screen !== 'conv') return;
  if (!S.camera.stream || streamLive(S.camera.stream)) return;
  closeCamera();
  await openCamera();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reviveCamera();
});

let busy = false;
let flashUntil = 0; // l'eclair survit au rendu qui suit la photo (le viseur est reecrit)

function flash() {
  flashUntil = Date.now() + 150;
  applyFlash();
  if (navigator.vibrate) navigator.vibrate(30);
}

function applyFlash() {
  const fl = root.querySelector('.flash');
  const left = flashUntil - Date.now();
  if (!fl || left <= 0) return;
  fl.classList.add('on');
  setTimeout(() => fl.classList.remove('on'), left);
}

// Toute photo porte l'horodatage incruste (appartement, date, heure, prenom) : la preuve survit a WhatsApp.
async function takePhoto(c) {
  if (S.camera.live) {
    flash();
    return captureFrame(vfVideo, { stamp: stampText(c.apt, me(), new Date()) });
  }
  // Repli : l'heure est celle du retour de la photo, pas celle de l'ouverture du selecteur.
  return pickPhoto(fallbackInput, { stamp: () => stampText(c.apt, me(), new Date()) });
}

// Attend que le navigateur ait peint le dernier rendu (nouvelle piece affichee) avant de relacher `busy`.
const painted = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// Prise de photo gardee : pas de double capture, rien tant que le flux n'est pas pret.
// `busy` n'est relache qu'apres le rendu (et la peinture) de la piece suivante.
// Repli champ fichier : on n'occupe `busy` qu'une fois la photo recue (l'annulation du selecteur ne resout jamais).
async function capture(c, handle) {
  if (busy) return;
  let p;
  if (S.camera.live) {
    if (!S.camera.stream || !vfVideo.videoWidth) return;
    if (!streamLive(S.camera.stream)) { reviveCamera(); return; }
    busy = true;
    try {
      p = await takePhoto(c);
      if (!p || c !== conv()) return;
      await handle(p);
      await painted();
    } finally { busy = false; }
    return;
  }
  p = await takePhoto(c);
  if (!p || busy || c !== conv()) return;
  busy = true;
  try { await handle(p); await painted(); } finally { busy = false; }
}

// ---------------------------------------------------------------------------
// Ecritures, coches et reprise (tache 5 du branchement)
// ---------------------------------------------------------------------------

// Qui ecrit (sync.js, writeMode) : « real » pour la personne connectee sur sa
// propre journee, « practice » pour le simulateur, « none » en View as.
function mode() {
  return writeMode({
    session: !!state.session, viewAs: state.viewAs, dayViewAs: !!(state.day && state.day.viewAs),
    practiceActive: practiceActive(),
  });
}

function writesActive() {
  return mode() === 'real';
}

// View as (ou mode Practice dont la seance est fermee) : rien ne se touche.
function viewOnly() {
  return mode() === 'none' && !!state.session && (!!state.viewAs || !!(state.day && state.day.viewAs));
}

// Chaine unique : les actions entrent en file dans l'ordre ou sync.js les rend,
// meme quand un televersement doit d'abord garder ses octets. Une action qui
// n'entre pas en file (stockage plein) est defaite avec celles qui en dependent
// (runActions) : le geste suivant la reemet, rien ne part vers une cle inconnue.
let chaine = Promise.resolve();
const defaites = new Set();
function dispatch(c, actions, m) {
  if (!actions.length || m === 'none') return chaine;
  // Practice : la marque de la seance est prise au geste ; une seance finie
  // avant le tour de l'action (Exit) la fait refuser par api.js, sans reseau.
  const run = m === 'practice' ? practiceRunner(c, practiceMark()) : runAction;
  chaine = chaine.then(() => runActions(c, actions, run, defaites)).then(function (n) {
    if (!n) return;
    console.warn('[v3] gestes non gardes', n);
    refreshTicks(c);
    toast('Could not save on this phone. Try again.', 'err');
  }).catch(function (err) { console.warn('[v3] file', err); });
  return chaine;
}

async function runAction(a) {
  // Photo effacee avant son envoi : retiree de la file, rien a supprimer au serveur.
  if (a.unqueue && await unqueue(a.unqueue)) return;
  if (a.file) { try { await putFile(a.body.idem, a.file); } catch (e) { /* reprise sans miniature */ } }
  await submit(a.action, a.body, a.file || null, a.fileName);
}

// Practice : chaque action est servie tout de suite par le simulateur (api.js),
// jamais mise en file. Reponse = ✓✓ ; refus = le meme bandeau que le magasin
// mort de la vraie file (l'action n'est pas defaite : la cleaner verrait la meme
// chose), sauf le refus « linge » que la conversation prend en charge.
function practiceRunner(c, marque) {
  return async function (a) {
    if (!marque) return;
    try {
      const data = await sendOrQueue(a.action, a.body, a.file || null, a.fileName, marque);
      if (ackSync(c, a.body.idem, data && data.data) && refreshTicks(c)) renderLater();
    } catch (err) {
      if (err instanceof ApiError && err.kind === 'practice') return;   // seance finie
      if (refusLinge({ action: a.action, body: a.body }, err)) return;
      toast('Not sent: ' + (err && err.message ? err.message : 'refused') + '. Tell your manager.', 'err');
    }
  };
}

// Apres chaque geste : actions a mettre en file, coches, sauvegarde pour la reprise.
function markSynced(c) {
  if (!c) return c;
  const m = mode();
  const actions = syncPlan(c, { newIdem, active: m !== 'none' });
  refreshTicks(c);
  dispatch(c, actions, m);
  persist();
  return c;
}

// Fin du menage (Send, Add to <lead>'s report, Send linen count) : apres les gestes
// encore en attente, et jamais attendue (le partage garde l'activation du geste).
function finishNow(c) {
  markSynced(c);
  const m = mode();
  dispatch(c, finishPlan(c, { newIdem, active: m !== 'none', now: new Date() }), m);
  persist();
}

onSent(function (entry, data) {
  const idem = entry && entry.body ? entry.body.idem : null;
  for (const c of Object.values(S.convs)) {
    if (!ackSync(c, idem, data)) continue;
    const change = refreshTicks(c);
    persist();
    if (change || (S.screen === 'list')) renderLater();
    return;
  }
});

// finishJob refuse faute de linge : le serveur voit un lead (le telephone croyait
// aider). La conversation demande le comptage au lieu de laisser le geste au
// magasin mort.
const ERREUR_LINGE = /must be an integer|must be >= 0|is out of range/;
onRefused(refusLinge);
// « Fixed now » sur un ticket que le technicien a clos entre-temps : rien a verifier, le geste
// est tenu pour abouti (✓✓), jamais mis au magasin mort.
onRefused(refusTicketClos);
function refusTicketClos(entry, err) {
  if (!entry || entry.action !== 'v3.checkTicket' || !err || err.status !== 400 || !/already closed/.test(String(err.message))) return false;
  for (const c of Object.values(S.convs)) {
    if (!ackSync(c, entry.body.idem, { alreadyClosed: true })) continue;
    refreshTicks(c);
    persist();
    renderLater();
    return true;
  }
  return false;
}
function refusLinge(entry, err) {
  if (!entry || entry.action !== 'v3.finishJob' || !err || err.status !== 400 || !ERREUR_LINGE.test(String(err.message))) return false;
  const c = Object.values(S.convs).find(x => x.sync && x.sync.finish === entry.body.idem);
  if (!c) return false;
  requireLinen(c);
  persist();
  note('Housekeeping needs your linen count.');
  renderLater();
  return true;
}

export const CLE_CONVS = 'v3Convs';
// La sauvegarde passe apres les mises en file en cours : une conversation
// sauvegardee ne dit jamais « parti » pour un geste qui n'est pas encore dans
// IndexedDB (un rechargement le perdrait).
// Le mode, la journee et les conversations sont pris a l'appel : une
// sauvegarde demandee juste avant d'entrer en Practice ou en View as ecrit la
// vraie conversation, jamais l'ecran vide qui la remplace (ni l'inverse).
function persist() {
  const snap = {
    mode: mode(), mark: practiceMark(), day: state.day, convs: S.convs, activeId: S.activeId, screen: S.screen,
  };
  chaine = chaine.then(function () {
    if (snap.mode === 'practice') return ecrirePractice(snap);
    if (snap.mode === 'real') return ecrireConvs(snap);
  });
}

// Practice : la seance garde ses conversations a part (practice.js), sans les
// octets des photos ; jamais dans v3Convs ni dans IndexedDB.
function ecrirePractice(snap) {
  // Seance finie (ou une autre ouverte) depuis l'appel : rien a garder.
  if (!snap.day || !snap.day.me || !snap.mark || snap.mark !== practiceMark()) return;
  const convs = {};
  try {
    for (const [id, c] of Object.entries(snap.convs)) convs[id] = serializeConversation(c);
  } catch (e) { return; }
  practiceSaveConvs({ me: String(snap.day.me.id), date: snap.day.date, activeId: snap.activeId, screen: snap.screen, convs });
}

// Reprise d'une seance Practice apres un rechargement : une fois par seance.
let reprisPractice = 0;
function restorePractice() {
  const marque = practiceMark();
  if (!marque || reprisPractice === marque) return;
  reprisPractice = marque;
  const saved = practiceLoadConvs();
  const day = state.day;
  if (!saved || !day || !day.me || saved.me !== String(day.me.id) || saved.date !== day.date) return;
  const convs = {};
  for (const id of Object.keys(saved.convs || {})) {
    if (!state.apartments.some(a => a.id === id)) continue;
    const c = deserializeConversation(saved.convs[id], () => null);
    if (c) convs[id] = c;
  }
  S.convs = convs;
  rafraichirRoles();
  if (saved.activeId && convs[saved.activeId]) { S.activeId = saved.activeId; S.screen = saved.screen === 'conv' ? 'conv' : 'list'; }
}

// Gardee dans sessionStorage ET dans IndexedDB : iOS vide sessionStorage quand il
// ferme l'app installee, la reprise lit alors IndexedDB. Une conversation dont la
// fin est confirmee par le proxy n'est plus gardee : le serveur fait foi pour
// elle. Plus rien a reprendre : les deux copies sont effacees.
async function ecrireConvs(snap) {
  const day = snap.day;
  if (!day || !day.me || day.viewAs) return;
  const convs = {};
  try {
    for (const [id, c] of Object.entries(snap.convs)) if (!finishAcked(c)) convs[id] = serializeConversation(c);
  } catch (e) { return; }
  if (!Object.keys(convs).length) { await oublierConvsGardees(); return; }
  const blob = {
    me: String(day.me.id), date: day.date, activeId: snap.activeId, screen: snap.screen, convs,
    // La journee elle-meme : un rechargement sans reseau reprend le menage en cours.
    day: day,
  };
  try { sessionStorage.setItem(CLE_CONVS, JSON.stringify(blob)); } catch (e) { /* stockage plein ou indisponible */ }
  try { await putState(CLE_CONVS, blob); } catch (e) { /* idem */ }
}

async function oublierConvsGardees() {
  try { sessionStorage.removeItem(CLE_CONVS); } catch (e) { /* stockage indisponible */ }
  try { await deleteState(CLE_CONVS); } catch (e) { /* idem */ }
}

async function lireConvs() {
  try {
    const s = JSON.parse(sessionStorage.getItem(CLE_CONVS) || 'null');
    if (s) return s;
  } catch (e) { /* illisible : on tente IndexedDB */ }
  try { return await getState(CLE_CONVS); } catch (e) { return null; }
}

// Journee gardee avec les conversations, si elle est bien celle d'aujourd'hui a Dubai.
async function journeeGardee() {
  const saved = await lireConvs();
  const day = saved && saved.day;
  if (!day || !day.me || saved.me !== String(day.me.id) || day.date !== dubaiDate(new Date())) return null;
  return day;
}

// Le role (lead ou aide) vient du serveur : une conversation reprise suit la
// journee fraiche (v3.myDay), pas la valeur gardee.
function rafraichirRoles() {
  for (const [id, c] of Object.entries(S.convs)) {
    const frais = state.apartments.find(a => a.id === id);
    if (frais && c.apt) { c.apt.lead = frais.lead; c.apt.role = frais.role; }
  }
}

// Reprise : conversations de la meme personne, du meme jour, sur des menages encore
// dans la journee. Les gestes deja en file ne sont pas recrees (conv.sync les connait).
async function restoreConvs() {
  // Les sauvegardes deja demandees passent d'abord (retour de Practice / View as).
  await chaine;
  const saved = await lireConvs();
  const day = state.day;
  if (!saved || !day || !day.me) return;
  if (saved.me !== String(day.me.id) || saved.date !== day.date) { await oublierConvsGardees(); return; }
  const ids = Object.keys(saved.convs || {}).filter(id => state.apartments.some(a => a.id === id));
  let files = {};
  try { files = await getFiles(ids.flatMap(id => photoIdems(saved.convs[id]))); } catch (e) { files = {}; }
  const convs = {};
  for (const id of ids) {
    const c = deserializeConversation(saved.convs[id], idem => files[idem]
      ? { url: URL.createObjectURL(files[idem]), file: files[idem], idem } : null);
    if (c) convs[id] = c;
  }
  S.convs = convs;
  rafraichirRoles();
  if (saved.activeId && convs[saved.activeId]) { S.activeId = saved.activeId; S.screen = saved.screen === 'conv' ? 'conv' : 'list'; }
}

// Bandeau « Saved: <Type> · <endroit> » (sans bouton), 4 s.
function showToast(index) {
  S.toastIndex = index; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { S.toastIndex = null; renderLater(); }, 4000);
}

// Texte en cours de frappe (ecran « What happened? ») : survit aux rendus des minuteurs.
function noteDraft() {
  const ta = root.querySelector('#problem-note');
  return ta ? { index: Number(ta.dataset.index), value: ta.value } : null;
}

// Note en cours de frappe ou de dictee : un rendu remplacerait la zone de texte (focus perdu,
// clavier ferme, dictee coupee). Les rendus des minuteurs attendent donc la sortie du champ.
const typingNote = () => !!document.activeElement && document.activeElement.id === 'problem-note';
let renderDeferred = false;
function renderLater() {
  if (typingNote()) { renderDeferred = true; return; }
  render();
}

function journeeVide() {
  return readOnly() && state.day && state.day.me
    ? 'Nothing assigned to ' + state.day.me.name + ' today.'
    : 'Nothing assigned to you today.';
}

function renderConv() {
  appEl.className = 'cv';
  if (S.screen === 'conv' && !conv()) S.screen = 'list';
  const c = S.screen === 'conv' ? conv() : null;
  const draft = noteDraft();
  const focus = typingNote() ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
  let html = '';
  let showVideo = false;
  if (!c) {
    closeCamera();
    html = renderList({
      me: me(), apartments: S.apartments, convs: S.convs, activeId: S.activeId, now: new Date(),
      before: modeBar(), after: queueStrip(), empty: journeeVide(),
    });
  } else {
    const f = currentFlow(c);
    if (c.flow && !f) c.flow = null; // probleme supprime pendant le signalement
    const photoView = !f && S.viewPhoto !== null ? renderPhotoView(c, S.viewPhoto) : '';
    if (!photoView) S.viewPhoto = null;
    if (c.fix && !f) {
      // Viseur « Fixed now » d'un ticket ouvert (C4) : plein ecran, comme les photos d'un signalement.
      html = modeBar() + renderTicketFix(c, { live: S.camera.live });
      showVideo = true;
    } else if (f) {
      // Une question par ecran, en plein ecran : pas de conversation dessous.
      html = renderFlow(c, { live: S.camera.live });
      showVideo = f.stage === 'photos';
      // Ecran des photos d'un signalement : le bandeau du mode reste au-dessus du viseur.
      if (showVideo) html = modeBar() + html;
    } else if (photoView) html = photoView;
    else if (S.editIndex !== null && c.problems[S.editIndex]) html = renderProblemPage(c, S.editIndex, { confirmDelete: S.confirmDelete });
    else {
      S.editIndex = null;
      html = renderConversation(c, { now: new Date(), before: modeBar() });
      const vf = S.camera.open ? renderViewfinder(c, { live: S.camera.live }) : '';
      html += vf;
      showVideo = !!vf;
      if (S.toastIndex !== null && c.problems[S.toastIndex]) {
        const t = renderToast(c.problems[S.toastIndex]);
        html += vf ? t.replace('class="toast', 'class="toast top') : t; // sous la barre du viseur, jamais sur le declencheur
      }
    }
  }
  if (S.note) html += '<div class="note">' + escapeHtml(S.note) + '</div>';
  root.innerHTML = html;
  const ta = root.querySelector('#problem-note');
  if (ta && draft && draft.index === Number(ta.dataset.index)) {
    ta.value = draft.value;
    // Filet de securite : rendu pendant la frappe, le focus et le curseur reviennent.
    if (focus) { ta.focus(); try { ta.setSelectionRange(focus.start, focus.end); } catch (e) { /* champ sans selection */ } }
  }
  vfVideo.hidden = !(c && S.camera.open && S.camera.live && showVideo);
  // Practice / View as : le viseur commence sous le bandeau du mode, Exit reste atteignable.
  const mb = root.querySelector('.viewas, .practicebar'), vfEl = root.querySelector('.vf');
  const off = mb && vfEl ? mb.offsetTop + mb.offsetHeight : 0;
  if (vfEl && off) vfEl.style.top = off + 'px';
  vfVideo.style.top = off ? off + 'px' : '';
  vfVideo.style.height = off ? 'calc(100% - var(--cv-tb) - ' + off + 'px)' : '';
  const t = root.querySelector('.toast:not(.top)'), bar = root.querySelector('.bar');
  // Bandeau du viseur : sous la barre du haut reelle (libelle sur une ou deux lignes).
  const tt = root.querySelector('.toast.top'), vfTop = root.querySelector('.vf-top');
  if (tt && vfTop) tt.style.top = (vfTop.offsetTop + vfTop.offsetHeight + 8) + 'px';
  // Note (partage) : en bas, juste au-dessus de la barre, jamais sur Send / Share again.
  const nt = root.querySelector('.note');
  const pageTitle = root.querySelector('.page h1');
  if (nt && pageTitle) { nt.style.bottom = 'auto'; nt.style.top = (pageTitle.getBoundingClientRect().bottom - appEl.getBoundingClientRect().top + 8) + 'px'; }
  else if (nt && bar) nt.style.bottom = (appEl.clientHeight - bar.offsetTop + 8) + 'px';
  // Bandeau « Saved » de la conversation : sous l'en-tete, jamais sur la question qui suit.
  const head = root.querySelector('.top');
  if (t && head) { t.style.bottom = 'auto'; t.style.top = (head.offsetTop + head.offsetHeight + 8) + 'px'; }
  const th = document.getElementById('thread');
  if (th) th.scrollTop = th.scrollHeight;
  applyFlash();
  syncHistory();
}

// ---- Retour systeme (Android, geste iPhone) : une entree d'historique « garde » tant qu'on est
// dans un appartement. Le retour systeme fait le retour de l'ecran en cours, puis la garde est
// reposee ; depuis la conversation, il ramene a la liste au lieu de quitter l'app.
let guard = false, ignorePop = 0;
function syncHistory() {
  const inside = S.screen === 'conv' && !!conv() && routeName() === 'cv';
  if (inside && !guard) { history.pushState({ hk: 1 }, ''); guard = true; }
  else if (!inside && guard) { guard = false; ignorePop++; history.back(); }
}

window.addEventListener('popstate', async () => {
  if (ignorePop) { ignorePop--; return; }
  guard = false;
  const c = conv();
  if (S.screen !== 'conv' || !c || routeName() !== 'cv') { render(); return; }
  if (c.flow) { await flowStep(c, 'system-back'); return; }
  if (c.fix) { fixCancel(c); await syncFlowCamera(c); render(); return; }
  if (S.viewPhoto !== null) { S.viewPhoto = null; render(); return; }
  if (S.editIndex !== null) { S.editIndex = null; S.confirmDelete = false; render(); return; }
  await toList(c);
});

// Camera de l'ecran des photos d'un signalement : ouverte s'il le faut, refermee en quittant
// cet ecran si c'est lui qui l'a ouverte (depuis le viseur d'une piece, elle reste ouverte).
async function syncFlowCamera(c) {
  const f = currentFlow(c);
  const need = (!!f && f.stage === 'photos') || !!c.fix;
  if (need && !S.camera.open) { S.flowCam = true; await openCamera(); return; }
  if (!need && S.flowCam) { S.flowCam = false; closeCamera(); }
}

async function after(c) {
  markSynced(c);
  await syncFlowCamera(c);
  const st = currentStep(c), f = currentFlow(c);
  if (S.camera.open && !st.camera && !(f && f.stage === 'photos') && !c.fix) closeCamera();
  render();
  await maybeAutoOpen();
}

// Retour a la liste (bouton ‹ de l'en-tete ou retour systeme depuis la conversation).
async function toList() {
  closeCamera(); S.flowCam = false;
  S.editIndex = null; S.viewPhoto = null; S.confirmDelete = false;
  S.screen = 'list'; render();
}

let gasAt = 0; // ecran rouge du gaz affiche : un double appui sur la tuile ne doit pas valider OK aussitot

// Fin d'un signalement : bandeau « Saved », retour a l'ecran d'origine.
async function flowStep(c, id) {
  const before = currentFlow(c);
  if (!before) { c.flow = null; render(); return; }
  // Ecran du gaz : OK et retour systeme passent par la meme garde (ignores pendant 500 ms, puis valent OK).
  if ((id === 'gas-ok' || (id === 'system-back' && before.stage === 'gas')) && Date.now() - gasAt < 500) { render(); return; }
  const ta = root.querySelector('#problem-note');
  if (id === 'system-back') flowBack(c);
  else flowReply(c, id, { text: ta ? ta.value : '' });
  // Sans photo, un probleme dont la photo est obligatoire ne devient pas un ticket.
  if (id === 'no-photo' && before.problem && !PHOTO_OPTIONAL.includes(before.problem.kind) && mode() !== 'none') {
    note('No photo: this problem stays in your report. Add a photo to send it to maintenance.');
  }
  if (!c.flow) {
    const i = c.problems.indexOf(before.problem);
    if (i >= 0 && before.from !== 'edit') showToast(i);
    await after(c);
    return;
  }
  // Ecran de note : pas de focus automatique, le clavier couvrirait No note.
  await syncFlowCamera(c);
  render();
}

// Partage natif vers le groupe WhatsApp (rapport final ou envoi d'arrivee). Rend true si parti.
// Echec du partage avec photos : le prochain appui partage le texte seul (c.shareTextOnly).
async function shareToGroup(c, text, files) {
  busy = true;
  const textOnly = c.shareTextOnly === true;
  let r;
  try { r = await shareReport({ text, files, textOnly }); } finally { busy = false; }
  if (r.mode === 'none') { note('This browser cannot share. Open the page in Chrome (Android) or Safari (iPhone).'); render(); return false; }
  if (!r.ok) {
    if (r.error && r.mode === 'files') { c.shareTextOnly = true; note('Photos could not be shared. Tap again to share the text only.'); }
    else if (r.error) note('Share failed: ' + r.error);
    render(); return false;
  }
  c.shareTextOnly = false;
  if (textOnly) note('Text shared without photos.');
  else if (r.mode === 'text') note('Text shared without photos (this browser cannot share files).');
  else note('Shared. If the text is missing in WhatsApp, long-press and Paste: it is copied.');
  return true;
}

async function convClick(b) {
  const d = b.dataset;
  const c = conv();
  if (d.act === 'open') {
    const apt = S.apartments.find(a => a.id === d.id);
    if (!apt) return;
    S.activeId = d.id;
    // View as : la conversation est reconstruite de la journee a chaque ouverture,
    // jamais gardee ni ecrite.
    if (viewOnly()) S.convs[d.id] = readOnlyConversation(apt, { me: me(), now: new Date() });
    else if (!S.convs[d.id]) S.convs[d.id] = createConversation(apt, { me: me() });
    S.screen = 'conv'; S.autoOpenedAt = null; render(); await maybeAutoOpen(); return;
  }
  if (!c) return;
  if (d.act === 'back') { await toList(c); return; }
  // Lecture seule : seul le retour a la liste repond.
  if (c.readOnly || viewOnly()) return;
  if (d.act === 'close-camera') { closeCamera(); render(); return; }
  if (d.act === 'camera') { await openCamera(); return; }
  if (d.act === 'problem') {
    if (busy) return;
    startProblem(c);
    S.toastIndex = null; clearTimeout(toastTimer);
    render(); return;
  }
  if (d.kind) {
    chooseKind(c, d.kind);
    const f = currentFlow(c);
    if (f && f.stage === 'gas') { gasAt = Date.now(); markSynced(c); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
    await syncFlowCamera(c);
    render(); return;
  }
  if (d.flow) { await flowStep(c, d.flow); return; }
  // Tickets ouverts du logement (C4) : Still there, Fixed now (viseur, photo, Done).
  if (d.act === 'ticket-still') { if (busy) return; ticketStill(c, Number(d.ticket)); await after(c); return; }
  if (d.act === 'ticket-fixed') {
    if (busy) return;
    startTicketFix(c, Number(d.ticket));
    S.toastIndex = null; clearTimeout(toastTimer);
    await syncFlowCamera(c);
    render(); return;
  }
  if (d.act === 'fix-shutter') {
    await capture(c, async p => {
      if (!c.fix) return;
      addFixPhoto(c, p);
      render();
      await painted();
    });
    return;
  }
  if (d.act === 'fix-done') { fixDone(c); await after(c); return; }
  if (d.act === 'fix-cancel') { fixCancel(c); await syncFlowCamera(c); render(); return; }
  if (d.act === 'flow-shutter') {
    await capture(c, async p => {
      if (!currentFlow(c)) return;
      addFlowPhoto(c, p);
      markSynced(c);
      render();
      await painted();
    });
    return;
  }
  if (d.act === 'shutter') {
    // addPhoto enregistre la photo sans changer de piece (Next room la termine).
    await capture(c, async p => { addPhoto(c, p); await after(c); });
    return;
  }
  if (d.act === 'thumb') { S.viewPhoto = Number(d.i); render(); return; }
  if (d.act === 'photo-back') { S.viewPhoto = null; render(); return; }
  if (d.act === 'photo-delete') {
    const st = currentStep(c);
    removeArrivalOrEndPhoto(c, st.id, st.room, Number(d.i));
    S.viewPhoto = null; render(); return;
  }
  if (d.act === 'edit') { S.editIndex = Number(d.index); S.confirmDelete = false; S.toastIndex = null; clearTimeout(toastTimer); render(); return; }
  if (d.act === 'edit-back') { S.editIndex = null; S.confirmDelete = false; render(); return; }
  if (d.act === 'edit-photos' || d.act === 'edit-note') {
    if (busy) return;
    reopenProblem(c, S.editIndex, d.act === 'edit-photos' ? 'photos' : 'note');
    S.confirmDelete = false;
    await syncFlowCamera(c);
    render();
    // Edit note : la cleaner vient pour ecrire, le clavier s'ouvre.
    if (d.act === 'edit-note') { const ta = root.querySelector('#problem-note'); if (ta) ta.focus(); }
    return;
  }
  if (d.act === 'delete-ask') { S.confirmDelete = true; render(); return; }
  if (d.act === 'delete-no') { S.confirmDelete = false; render(); return; }
  if (d.act === 'delete') { removeProblem(c, Number(d.index)); S.editIndex = null; S.confirmDelete = false; S.toastIndex = null; render(); return; }
  if (d.where && S.editIndex !== null) { editProblem(c, S.editIndex, { where: d.where }); render(); return; }
  if (d.urgency && S.editIndex !== null) { editProblem(c, S.editIndex, { urgency: d.urgency }); render(); return; }
  if (d.reply === 'send-arrival') {
    if (busy || !currentStep(c).replies.some(r => r.id === 'send-arrival')) return;
    // Premier envoi (etat a l'arrivee) : partage au groupe, puis le menage continue. Le texte
    // envoye est fige dans sa bulle (les problemes signales ensuite vont au rapport final).
    const frozen = arrivalText(c);
    if (mode() === 'practice') note('Practice: nothing is shared. The cleaner shares this arrival check to WhatsApp.');
    else if (!(await shareToGroup(c, frozen, arrivalFiles(c)))) return;
    const m = c.messages.slice().reverse().find(x => x.type === 'arrival');
    if (m) m.text = frozen;
    reply(c, 'send-arrival');
    await after(c);
    return;
  }
  if (d.reply) {
    if (busy) return;
    // Fin du menage : en file AVANT l'ouverture du partage (rien n'est attendu ici).
    if ((d.reply === 'send' || d.reply === 'add-to-lead' || d.reply === 'linen-send') && !c.sent &&
        currentStep(c).replies.some(r => r.id === d.reply)) finishNow(c);
    if (d.reply === 'send' || d.reply === 'share-again') {
      if (d.reply === 'send' && c.sent) return;
      // Practice : aucun partage, le groupe WhatsApp de l'equipe ne recoit rien.
      if (mode() === 'practice') {
        note('Practice: nothing is shared. The cleaner shares this report to WhatsApp.');
        if (d.reply === 'share-again') { render(); return; }
        const prev0 = c.problems.length;
        reply(c, d.reply);
        if (c.problems.length > prev0 && !c.flow) showToast(c.problems.length - 1);
        await after(c);
        return;
      }
      if (!(await shareToGroup(c, reportText(c), reportFiles(c)))) return;
      if (d.reply === 'share-again') { render(); return; } // ni geste ni bulle
    }
    const prev = c.problems.length;
    reply(c, d.reply);
    if (c.problems.length > prev && !c.flow) showToast(c.problems.length - 1); // Can't get in, « not working »
    else if (c.problems.length < prev) S.toastIndex = null; // « works » apres « not working » : probleme retire
    await after(c);
  }
}

// Delegation : un seul ecouteur pour toute l'application.
document.addEventListener('click', function (evt) {
  const b = evt.target.closest('button,[data-act]');
  if (!b || b.disabled) return;
  const nom = b.getAttribute('data-act');
  if (nom === 'reload') { loadDay(); return; }
  if (nom === 'viewas-exit') { evt.preventDefault(); exitViewAs(); return; }
  if (routeName() === 'profile') {
    const handler = nom && profile.actions && profile.actions[nom];
    if (!handler) return;
    evt.preventDefault();
    Promise.resolve(handler(state, b, evt)).catch(function (err) {
      if (err instanceof ApiError && err.kind === 'auth') { perdreSession(); render(); return; }
      if (err instanceof ApiError && err.kind === 'practice') return;
      toast(err && err.message ? err.message : 'Something went wrong', 'err');
    });
    return;
  }
  if (!state.session || state.loading || state.error) return;
  convClick(b).then(function () { markSynced(conv()); }).catch(function (err) {
    toast(err && err.message ? err.message : 'Something went wrong', 'err');
  });
});

// Sortie du champ de note : le rendu differe passe un peu plus tard, jamais entre l'appui et le
// relache d'un bouton (un rendu a ce moment-la remplacerait le bouton et perdrait le clic).
appEl.addEventListener('focusout', e => {
  if (e.target.id !== 'problem-note' || !renderDeferred) return;
  setTimeout(() => { if (renderDeferred && !typingNote()) render(); }, 600);
});

window.addEventListener('hashchange', function () {
  state.prepared = false;
  render();
});

// ---------------------------------------------------------------------------
// Journee : v3.myDay, adaptee en appartements pour la conversation.
// ---------------------------------------------------------------------------

// Seule la reponse de la demande la plus recente est appliquee, succes comme erreur.
let generationJour = 0;
// Reprise des conversations : une fois, au premier chargement de la journee.
let repris = false;

function reponseConforme(data, vue) {
  if (!data) return false;
  if (!vue) return !data.viewAs;
  return !!data.viewAs && !!data.me && String(data.me.id) === vue.id;
}

// `silent` : rafraichissement au retour du reseau d'une journee reprise hors
// ligne ; ni ecran de chargement (le viseur resterait ferme), ni erreur affichee.
export async function loadDay({ silent = false } = {}) {
  const generation = ++generationJour;
  const vue = state.viewAs;
  if (!silent) {
    state.loading = true;
    state.error = '';
    render();
  }
  try {
    const data = await api.get('v3.myDay', vue ? { as: vue.id } : {});
    if (generation !== generationJour) return;
    if (state.viewAs !== vue || !reponseConforme(data, vue)) {
      if (vue) {
        oublierViewAs();
        oublierConversations();
        return loadDay();
      }
      throw new Error('Could not load your day.');
    }
    if (vue) {
      if (!data.viewer || String(data.viewer.id) !== vue.viewerId) {
        oublierViewAs();
        oublierConversations();
        return loadDay();
      }
      vue.confirmed = true;
      if (vue.practice && practiceActive()) practiceDay(data);
    }
    // Fin du PIN (07/10) : le proxy pose accountSetupRequired sur une session
    // PIN dont la ligne n'a aucune adresse. La creation du compte, obligatoire,
    // vit sur « / » (app racine) : pas de second ecran ici. Hors ligne, rien
    // n'arrive et rien ne bloque.
    if (!vue && !silent && data.accountSetupRequired === true && state.session && state.session.kind === 'pin') {
      location.replace('/');
      return;
    }
    state.day = data;
    state.apartments = toApartments(data, data.me, { now: new Date() });
    state.jourGarde = false;
    if (mode() === 'practice') restorePractice();
    else if (!repris && writesActive()) {
      repris = true;
      await restoreConvs();
      if (generation !== generationJour) return;
    } else rafraichirRoles();
    state.loading = false;
    if (silent) { persist(); renderLater(); return; }
    render();
    await maybeAutoOpen();
  } catch (err) {
    if (generation !== generationJour) return;
    if (silent) return;
    state.loading = false;
    const garde = err instanceof ApiError && err.kind === 'offline' && !vue && !repris && writesActive()
      ? await journeeGardee() : null;
    if (generation !== generationJour) return;
    if (vue && state.viewAs === vue && err instanceof ApiError && err.kind === 'server' &&
        (err.status === 400 || err.status === 403)) {
      oublierViewAs();
      oublierConversations();
      if (vue.confirmed) toast('This view is no longer available', 'err');
      if (location.hash !== '#/today') location.hash = '#/today';
      return loadDay();
    }
    if (err instanceof ApiError && err.kind === 'auth') {
      perdreSession();
    } else if (garde) {
      // Rechargement sans reseau au milieu d'un menage : la journee gardee suffit
      // pour reprendre la conversation ; la file partira au retour du reseau, et
      // la journee sera relue a ce moment-la (evenement online).
      state.day = garde;
      state.jourGarde = true;
      state.apartments = toApartments(state.day, state.day.me, { now: new Date() });
      repris = true;
      await restoreConvs();
      if (generation !== generationJour) return;
      render();
      await maybeAutoOpen();
      return;
    } else if (err instanceof ApiError && err.kind === 'offline') {
      state.error = 'No network. Your saved actions will sync on their own.';
    } else {
      state.error = err.message || 'Could not load your day.';
    }
    render();
  }
}

// Journee reprise de la copie hors ligne : relue des que le reseau revient.
window.addEventListener('online', function () {
  if (state.jourGarde && state.session && !state.loading) loadDay({ silent: true });
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
  // Le bandeau n'existe que sur la liste : dans une conversation, rien a redessiner.
  if (S.screen === 'conv' && conv()) return;
  renderLater();
});

// Un renouvellement de la session email relance le rejeu, et la journee si elle
// n'a pas pu se charger.
onSessionRenewed(function () {
  if (!state.session) return;
  flush();
  if (state.error && !state.loading) loadDay();
});

export async function boot() {
  porte(vueAttente('Loading your day.'));
  state.session = await readSession();
  state.viewAs = state.session ? lireViewAs() : null;
  const qui = identiteLocale();
  if (state.viewAs && qui && qui !== state.viewAs.viewerId) state.viewAs = null;
  if (!state.viewAs) oublierViewAs();
  else if (state.viewAs.practice) practiceOn(state.viewAs, true);
  if (!state.session) {
    state.loading = false;
    render();
    window.__v3ready = true;
    return;
  }
  watchNetwork();
  // Photos de plus de deux jours : la journee est finie, elles ne servent plus.
  purgeFiles(2 * 24 * 3600 * 1000).catch(function () { /* stockage indisponible */ });
  state.queued = await pendingCount();
  await loadDay();
  if (navigator.onLine) flush();
  // Enregistrement apres le premier rendu : l'installation ne doit jamais
  // retarder l'affichage de la journee. Aucun abonnement push ici.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/v3/sw.js', { scope: '/v3/' })
      .catch(function (e) { console.warn('[v3] service worker non enregistre', e); });
  }
  window.__v3ready = true;
  proposerNotifications();
}

// Ecran « Turn on notifications » (rappels automatiques) : apres une journee
// chargee du reseau, pour la personne elle-meme (ni View as, ni Practice, dont
// les appels partiraient au simulateur). Import dynamique : /v3/push.js n'est
// pas dans le precache, et un echec (hors ligne) ne touche jamais l'app.
function proposerNotifications() {
  if (!state.session || state.session.kind === 'stale') return;
  if (state.viewAs || practiceActive() || state.error || !state.day || state.jourGarde) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  import('/v3/push.js')
    .then(function (m) { return m.mountPushPrompt(); })
    .catch(function (e) { console.warn('[v3] ecran notifications indisponible', e); });
}

boot();
