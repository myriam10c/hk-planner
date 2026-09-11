// Application cleaner v3 : etat, routeur de hash, delegation des evenements.
// Aucun gestionnaire en ligne (CSP script-src 'self'), aucun emoji, interface en
// anglais. Les ecrans vivent dans /v3/screens/ et exposent view/actions/mount.
import { api, ApiError, readSession } from '/v3/api.js';
import { flush, onQueueChange, pendingCount, watchNetwork } from '/v3/offline.js';
import { closeSheet, esc, icon, sheetIsOpen, toast } from '/v3/ui.js';

export const state = {
  session: null,
  day: null,          // charge de v3.myDay
  jobId: null,        // arret ouvert
  queued: 0,          // gestes en attente de synchronisation
  loading: true,
  error: '',
};

const screens = {};
export function registerScreen(name, screen) { screens[name] = screen; }

function routeName() {
  const h = String(location.hash || '');
  if (h.indexOf('#/job/') === 0) return 'job';
  if (h === '#/profile') return 'profile';
  return 'today';
}

export function navigate(hash) {
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
  if (state.loading) {
    app.innerHTML = '<div class="gate"><h1>HK Planner</h1><p class="muted">Loading your day.</p></div>';
    return;
  }
  if (state.error) {
    app.innerHTML = '<div class="gate"><h1>HK Planner</h1><p class="muted">' + esc(state.error) +
      '</p><button class="btn-primary" data-act="reload">Try again</button></div>';
    return;
  }
  const screen = screens[routeName()] || screens.today;
  if (!screen) {
    app.innerHTML = queueStrip() + vueAttente('Loading your day.');
    return;
  }
  app.innerHTML = screen.view(state);
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

export async function loadDay() {
  state.loading = true;
  state.error = '';
  render();
  try {
    const data = await api.get('v3.myDay', {});
    state.day = data;
    state.loading = false;
    render();
  } catch (err) {
    state.loading = false;
    if (err instanceof ApiError && err.kind === 'auth') {
      state.session = null;
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
  const screen = screens[routeName()] || screens.today;
  const handler = screen && screen.actions && screen.actions[nom];
  if (!handler) return;
  evt.preventDefault();
  Promise.resolve(handler(state, cible, evt)).catch(function (err) {
    if (err instanceof ApiError && err.kind === 'auth') {
      state.session = null;
      render();
      return;
    }
    toast(err && err.message ? err.message : 'Something went wrong', 'err');
  });
});

window.addEventListener('hashchange', render);

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

export async function boot() {
  state.session = readSession();
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
  window.__v3ready = true;
}

boot();
