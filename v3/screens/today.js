// Ecran Today : la route de la journee. Les arrets dans l'ordre des heures
// limites (le serveur les rend deja tries), le prochain en carte pleine, les
// suivants en lignes. Aucun compteur d'equipe (specification, section 3).
import { loadDay, openJob, queueStrip } from '/v3/app.js';
import { newIdem, sendOrQueue } from '/v3/offline.js';
import { esc, fmtDuration, icon, toast } from '/v3/ui.js';

function jourLisible(iso) {
  const d = new Date(String(iso) + 'T00:00:00');
  const jours = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mois = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return jours[d.getDay()] + ' ' + d.getDate() + ' ' + mois[d.getMonth()];
}

function sousTitre(stop) {
  const bouts = [stop.unitType];
  if (stop.checkOutTime) bouts.push('checkout was ' + stop.checkOutTime);
  else if (stop.label) bouts.push(stop.label);
  return bouts.join(', ');
}

function ligneEcheance(stop) {
  if (stop.sameDay && stop.nextArrivalTime) return 'Guest arrives ' + stop.nextArrivalTime + ' today';
  if (stop.nextArrivalTime && stop.nextArrivalDate) return 'Guest arrives ' + stop.nextArrivalTime + ' on ' + jourLisible(stop.nextArrivalDate);
  return 'No guest booked yet';
}

function pastille(stop) {
  if (stop.state === 'done') return 'Done';
  if (stop.state === 'running') return 'Running';
  return 'Later';
}

function view(state) {
  const jour = state.day || { stops: [], totalMinutes: 0, me: { name: '' }, date: '' };
  const moi = jour.me || { name: '' };
  const stops = jour.stops || [];
  const restants = stops.filter(function (s) { return s.state !== 'done'; });
  const suivant = restants[0] || null;
  const autres = stops.filter(function (s) { return s !== suivant; });

  let h = '<header class="drench">' +
    '<div class="dr-top"><span>' + esc(moi.name) + '</span>' +
    '<span class="date">' + esc(jourLisible(jour.date)) + '</span></div>' +
    '<div class="dr-count"><b>' + stops.length + '</b>' +
    '<span>stops today, about ' + fmtDuration(jour.totalMinutes) + '</span></div>';

  if (suivant) {
    h += '<div class="nextup">' +
      '<p class="k">Next stop</p>' +
      '<p class="n">' + esc(suivant.listingName) + '</p>' +
      '<p class="m">' + esc(sousTitre(suivant)) + '</p>' +
      '<span class="dl">' + icon('clock', 15) + esc(ligneEcheance(suivant)) + '</span>' +
      '<button class="btn-start" data-act="start" data-job="' + esc(suivant.jobId) + '">' +
      (suivant.state === 'running' ? 'Continue this cleaning' : 'Start this cleaning') + '</button>' +
      '</div>';
  }
  h += '</header>';
  h += queueStrip();
  h += '<div class="body">';
  if (stops.length === 0) {
    h += '<p class="pad muted">Nothing assigned to you today.</p>';
  } else if (autres.length > 0) {
    h += '<p class="sec-lab">Then today</p>';
    autres.forEach(function (s) {
      const tickets = (s.openTickets || []).length;
      const info = tickets > 0
        ? s.unitType + ', ' + tickets + (tickets > 1 ? ' things' : ' thing') + ' to check while you are there'
        : s.unitType + ', ' + ligneEcheance(s).toLowerCase();
      h += '<button class="stop' + (s.state === 'done' ? ' done' : '') + '" data-act="open" data-job="' + esc(s.jobId) + '">' +
        '<span class="h">' + (stops.indexOf(s) + 1) + '</span>' +
        '<span class="tx"><b>' + esc(s.listingName) + '</b><span>' + esc(info) + '</span></span>' +
        '<span class="pill">' + pastille(s) + '</span>' +
        '</button>';
    });
    h += '<p class="pad muted">Ordered by deadline, not by building name.</p>';
  }
  h += '</div>';
  h += '<nav class="cl-bar">' +
    '<a href="#/today" aria-current="page">' + icon('home', 20) + 'Today</a>' +
    '<a href="#/profile">' + icon('user', 20) + 'Profile</a>' +
    '</nav>';
  return h;
}

const actions = {
  async start(state, el) {
    const jobId = el.getAttribute('data-job');
    const stop = (state.day.stops || []).find(function (s) { return s.jobId === jobId; });
    if (!stop) return;
    if (stop.state === 'todo') {
      stop.state = 'running';
      // startedAt vient de la reponse serveur (revue tache 4, constat mineur
      // 6) : hors ligne, sendOrQueue rend { queued: true } sans reponse, on
      // garde alors l'heure locale comme approximation optimiste, corrigee
      // au prochain sync par la vraie valeur si le serveur en renvoie une.
      const r = await sendOrQueue('v3.startJob', { jobId: jobId, idem: newIdem() });
      // sendOrQueue rend { ok, queued, data } : l'heure serveur est dans
      // r.data.startedAt, jamais sur r directement (piege trouve en revue
      // de la tache 8, avant l'ecriture de cet ecran).
      stop.startedAt = (r && r.data && r.data.startedAt) || new Date().toISOString();
      if (r.queued) toast('Saved on your phone', 'ok');
    }
    openJob(state, stop);
  },
  open(state, el) {
    const jobId = el.getAttribute('data-job');
    const stop = (state.day.stops || []).find(function (s) { return s.jobId === jobId; });
    if (stop) openJob(state, stop);
  },
  refresh() { return loadDay(); },
};

export default { view: view, actions: actions };
