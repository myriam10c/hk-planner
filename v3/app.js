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
// ✓✓ = reponse 2xx recue pour son idem (onSent). Rien en View as ni en Practice.
// Reprise : chaque conversation est gardee dans sessionStorage (persist.js) et
// les octets des photos dans IndexedDB ; un rechargement revient au meme ecran.
// Aucun gestionnaire en ligne (CSP script-src 'self'), interface en anglais.
import { api, ApiError, readSession } from '/v3/api.js';
import {
  flush, getFiles, newIdem, onQueueChange, onRefused, onSent, pendingCount, purgeFiles, putFile, submit,
  unqueue, watchNetwork,
} from '/v3/offline.js';
import { onSessionRenewed } from '/v3/session.js';
import { practiceActive, practiceDay, practiceOff, practiceOn } from '/v3/practice.js';
import { esc, icon, toast } from '/v3/ui.js';
import profile from '/v3/screens/profile.js';
import { dubaiDate, toApartments } from '/v3/conv/day.js';
import { stampText } from '/v3/conv/stamp.js';
import {
  createConversation, currentStep, reply, addPhoto, editProblem, removeProblem, startProblem, chooseKind,
  addFlowPhoto, flowReply, flowBack, currentFlow, reopenProblem, removeArrivalOrEndPhoto, requireLinen,
} from '/v3/conv/conversation.js';
import { syncPlan, finishPlan, ackSync, refreshTicks, PHOTO_OPTIONAL } from '/v3/conv/sync.js';
import { serializeConversation, deserializeConversation, photoIdems } from '/v3/conv/persist.js';
import { reportText, reportFiles } from '/v3/conv/report.js';
import {
  renderList, renderConversation, renderViewfinder, renderToast, renderFlow, renderPhotoView, renderProblemPage,
  escapeHtml,
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
function oublierConversations() {
  closeCamera();
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
      '</p><button class="btn-primary" data-act="reload">Try again</button></div>');
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
  if (!c || S.screen !== 'conv' || routeName() !== 'cv' || S.camera.open || c.flow) return;
  const st = currentStep(c);
  const key = stepKey(c);
  if (st.camera && S.autoOpenedAt !== key) { S.autoOpenedAt = key; await openCamera(); }
}

let camGen = 0; // generation de la demande de flux : une demande depassee arrete son flux

async function openCamera() {
  // Le viseur s'affiche tout de suite (video permanente), puis on demande le flux.
  // Refus = viseur garde ouvert en image fixe (live:false) ; declencheur et tuiles passent par le champ fichier.
  if (S.camera.open) return;
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

// La conversation n'ecrit que pour la personne connectee, sur sa propre journee.
function writesActive() {
  return !!state.session && !readOnly() && !practicing() && !practiceActive();
}

// Chaine unique : les actions entrent en file dans l'ordre ou sync.js les rend,
// meme quand un televersement doit d'abord garder ses octets.
let chaine = Promise.resolve();
function dispatch(actions) {
  for (const a of actions) {
    chaine = chaine.then(() => runAction(a)).catch(err => {
      console.warn('[v3] geste non garde', a.action, err);
      toast('Could not save on this phone. Try again.', 'err');
    });
  }
  return chaine;
}

async function runAction(a) {
  // Photo effacee avant son envoi : retiree de la file, rien a supprimer au serveur.
  if (a.unqueue && await unqueue(a.unqueue)) return;
  if (a.file) { try { await putFile(a.body.idem, a.file); } catch (e) { /* reprise sans miniature */ } }
  await submit(a.action, a.body, a.file || null, a.fileName);
}

// Apres chaque geste : actions a mettre en file, coches, sauvegarde pour la reprise.
function markSynced(c) {
  if (!c) return c;
  const actions = syncPlan(c, { newIdem, active: writesActive() });
  refreshTicks(c);
  dispatch(actions);
  persist();
  return c;
}

// Fin du menage (Send, Add to <lead>'s report, Send linen count) : apres les gestes
// encore en attente, et jamais attendue (le partage garde l'activation du geste).
function finishNow(c) {
  markSynced(c);
  dispatch(finishPlan(c, { newIdem, active: writesActive(), now: new Date() }));
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
onRefused(function (entry, err) {
  if (!entry || entry.action !== 'v3.finishJob' || !err || err.status !== 400 || !ERREUR_LINGE.test(String(err.message))) return false;
  const c = Object.values(S.convs).find(x => x.sync && x.sync.finish === entry.body.idem);
  if (!c) return false;
  requireLinen(c);
  persist();
  note('Housekeeping needs your linen count.');
  renderLater();
  return true;
});

export const CLE_CONVS = 'v3Convs';
// La sauvegarde passe apres les mises en file en cours : une conversation
// sauvegardee ne dit jamais « parti » pour un geste qui n'est pas encore dans
// IndexedDB (un rechargement le perdrait).
function persist() {
  chaine = chaine.then(ecrireConvs);
}

function ecrireConvs() {
  if (!writesActive() || !state.day || !state.day.me) return;
  try {
    const convs = {};
    for (const [id, c] of Object.entries(S.convs)) convs[id] = serializeConversation(c);
    sessionStorage.setItem(CLE_CONVS, JSON.stringify({
      me: String(state.day.me.id), date: state.day.date, activeId: S.activeId, screen: S.screen, convs,
      // La journee elle-meme : un rechargement sans reseau reprend le menage en cours.
      day: state.day,
    }));
  } catch (e) { /* stockage plein ou indisponible : la conversation vit le temps de la page */ }
}

// Reprise : conversations de la meme personne, du meme jour, sur des menages encore
// dans la journee. Les gestes deja en file ne sont pas recrees (conv.sync les connait).
function lireConvs() {
  try { return JSON.parse(sessionStorage.getItem(CLE_CONVS) || 'null'); } catch (e) { return null; }
}

// Journee gardee avec les conversations, si elle est bien celle d'aujourd'hui a Dubai.
function journeeGardee() {
  const saved = lireConvs();
  const day = saved && saved.day;
  if (!day || !day.me || saved.me !== String(day.me.id) || day.date !== dubaiDate(new Date())) return null;
  return day;
}

async function restoreConvs() {
  const saved = lireConvs();
  const day = state.day;
  if (!saved || !day || !day.me || saved.me !== String(day.me.id) || saved.date !== day.date) return;
  const ids = Object.keys(saved.convs || {}).filter(id => S.apartments.some(a => a.id === id));
  let files = {};
  try { files = await getFiles(ids.flatMap(id => photoIdems(saved.convs[id]))); } catch (e) { files = {}; }
  const convs = {};
  for (const id of ids) {
    const c = deserializeConversation(saved.convs[id], idem => files[idem]
      ? { url: URL.createObjectURL(files[idem]), file: files[idem], idem } : null);
    if (c) convs[id] = c;
  }
  S.convs = convs;
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
    if (f) {
      // Une question par ecran, en plein ecran : pas de conversation dessous.
      html = renderFlow(c, { live: S.camera.live });
      showVideo = f.stage === 'photos';
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
  if (S.viewPhoto !== null) { S.viewPhoto = null; render(); return; }
  if (S.editIndex !== null) { S.editIndex = null; S.confirmDelete = false; render(); return; }
  await toList(c);
});

// Camera de l'ecran des photos d'un signalement : ouverte s'il le faut, refermee en quittant
// cet ecran si c'est lui qui l'a ouverte (depuis le viseur d'une piece, elle reste ouverte).
async function syncFlowCamera(c) {
  const f = currentFlow(c);
  const need = !!f && f.stage === 'photos';
  if (need && !S.camera.open) { S.flowCam = true; await openCamera(); return; }
  if (!need && S.flowCam) { S.flowCam = false; closeCamera(); }
}

async function after(c) {
  markSynced(c);
  await syncFlowCamera(c);
  const st = currentStep(c), f = currentFlow(c);
  if (S.camera.open && !st.camera && !(f && f.stage === 'photos')) closeCamera();
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
  if (id === 'no-photo' && before.problem && !PHOTO_OPTIONAL.includes(before.problem.kind) && writesActive()) {
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

async function convClick(b) {
  const d = b.dataset;
  const c = conv();
  if (d.act === 'open') {
    const apt = S.apartments.find(a => a.id === d.id);
    if (!apt) return;
    S.activeId = d.id;
    if (!S.convs[d.id]) S.convs[d.id] = createConversation(apt, { me: me() });
    S.screen = 'conv'; S.autoOpenedAt = null; render(); await maybeAutoOpen(); return;
  }
  if (!c) return;
  if (d.act === 'back') { await toList(c); return; }
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
  if (d.reply) {
    if (busy) return;
    // Fin du menage : en file AVANT l'ouverture du partage (rien n'est attendu ici).
    if ((d.reply === 'send' || d.reply === 'add-to-lead' || d.reply === 'linen-send') && !c.sent &&
        currentStep(c).replies.some(r => r.id === d.reply)) finishNow(c);
    if (d.reply === 'send' || d.reply === 'share-again') {
      if (d.reply === 'send' && c.sent) return;
      busy = true;
      const textOnly = c.shareTextOnly === true; // le partage avec fichiers a echoue au dernier appui
      let r;
      try { r = await shareReport({ text: reportText(c), files: reportFiles(c), textOnly }); } finally { busy = false; }
      if (r.mode === 'none') { note('This browser cannot share. Open the page in Chrome (Android) or Safari (iPhone).'); render(); return; }
      if (!r.ok) {
        if (r.error && r.mode === 'files') { c.shareTextOnly = true; note('Photos could not be shared. Tap again to share the text only.'); }
        else if (r.error) note('Share failed: ' + r.error);
        render(); return;
      }
      c.shareTextOnly = false;
      if (textOnly) note('Text shared without photos.');
      else if (r.mode === 'text') note('Text shared without photos (this browser cannot share files).');
      else note('Shared. If the text is missing in WhatsApp, long-press and Paste: it is copied.');
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

export async function loadDay() {
  const generation = ++generationJour;
  const vue = state.viewAs;
  state.loading = true;
  state.error = '';
  render();
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
    state.day = data;
    state.apartments = toApartments(data, data.me, { now: new Date() });
    if (!repris && writesActive()) {
      repris = true;
      await restoreConvs();
      if (generation !== generationJour) return;
    }
    state.loading = false;
    render();
    await maybeAutoOpen();
  } catch (err) {
    if (generation !== generationJour) return;
    state.loading = false;
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
    } else if (err instanceof ApiError && err.kind === 'offline' && !vue && !repris && writesActive() && journeeGardee()) {
      // Rechargement sans reseau au milieu d'un menage : la journee gardee suffit
      // pour reprendre la conversation ; la file partira au retour du reseau.
      state.day = journeeGardee();
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
}

boot();
