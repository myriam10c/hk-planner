// Feuille de fin de menage et ecran « Cleaning finished ».
// Le linge est compte ici, une fois, avec les memes sept postes que l'app
// actuelle : ces chiffres alimentent le solde d'inventaire oppose a la
// blanchisserie, ils ne peuvent pas etre approximes.
import { closeSheet, esc, fmtDuration, icon, openSheet, toast } from '/v3/ui.js';
import { newIdem, sendOrQueue } from '/v3/offline.js';
import { navigate } from '/v3/app.js';

export const LINEN_FIELDS = [
  { key: 'bed_sheets', label: 'Bed sheets' },
  { key: 'duvet_covers', label: 'Duvet covers' },
  { key: 'pillowcases', label: 'Pillowcases' },
  { key: 'large_towels', label: 'Large towels' },
  { key: 'small_towels', label: 'Small towels' },
  { key: 'face_towels', label: 'Face towels' },
  { key: 'bath_mats', label: 'Bath mats' },
];

function ligneLinge(champ, valeur) {
  return '<div class="linen"><span>' + esc(champ.label) + '</span>' +
    '<span class="stp">' +
      '<button type="button" data-act="linen-minus" data-field="' + champ.key + '" aria-label="One less ' + esc(champ.label) + '">-</button>' +
      '<span class="v" data-linen="' + champ.key + '">' + valeur + '</span>' +
      '<button type="button" data-act="linen-plus" data-field="' + champ.key + '" aria-label="One more ' + esc(champ.label) + '">+</button>' +
    '</span></div>';
}

// Feuille unique : confirmation des lignes non cochees (si besoin), puis linge.
export function openFinishSheet(state, stop) {
  if (!stop) return;
  const total = (stop.checklist || []).length;
  const coches = (stop.checklist || []).filter(function (i) { return state.ticks[i] === true; }).length;
  const manquants = total - coches;
  state.linen = state.linen || {};
  LINEN_FIELDS.forEach(function (f) { if (state.linen[f.key] === undefined) state.linen[f.key] = 0; });

  let h = '<h2>Finish this cleaning</h2>';
  if (manquants > 0) {
    h += '<p class="m">' + manquants + ' item' + (manquants > 1 ? 's' : '') + ' not ticked. ' +
      'You can still finish.</p>';
  }
  if (state.day.linenRequired) {
    h += '<p class="m" style="margin-top:14px"><b>Linen going out</b></p>';
    LINEN_FIELDS.forEach(function (f) { h += ligneLinge(f, state.linen[f.key]); });
  }
  h += '<button class="btn-primary" type="button" data-act="finish-confirm">' +
    (manquants > 0 ? 'Finish anyway' : 'Finish this cleaning') + '</button>';
  h += '<button class="btn-ghost" type="button" data-act="close-sheet">Back to the cleaning</button>';
  openSheet(h);
}

export async function submitFinish(state, stop) {
  if (!stop) return;
  const checklist = {};
  (stop.checklist || []).forEach(function (i) { checklist[i] = state.ticks[i] === true; });
  const corps = {
    jobId: stop.jobId,
    checklist: checklist,
    photos: state.photoIds || [],
    notes: state.jobNote || '',
    idem: newIdem(),
  };
  if (state.day.linenRequired) corps.linen = state.linen;
  const r = await sendOrQueue('v3.finishJob', corps);
  closeSheet();
  stop.state = 'done';
  // Hors ligne, sendOrQueue rend data: null : la duree se recalcule alors sur
  // l'heure de demarrage locale, jamais sur r.data nu.
  state.finished = {
    jobId: stop.jobId,
    listingName: stop.listingName,
    unitType: stop.unitType,
    estimatedMinutes: stop.estimatedMinutes,
    durationMinutes: r.data && r.data.durationMinutes !== null && r.data.durationMinutes !== undefined
      ? r.data.durationMinutes
      : Math.max(1, Math.round((Date.now() - new Date(stop.startedAt || Date.now()).getTime()) / 60000)),
    checked: (stop.checklist || []).filter(function (i) { return state.ticks[i] === true; }).length,
    total: (stop.checklist || []).length,
    photos: (state.photoIds || []).length,
    queued: r.queued,
  };
  if (r.queued) toast('Saved on your phone', 'ok');
  navigate('#/job/' + encodeURIComponent(stop.jobId));
}

export function finishedView(state) {
  const f = state.finished;
  const restants = ((state.day && state.day.stops) || []).filter(function (s) {
    return s.state !== 'done' && s.jobId !== f.jobId;
  });
  const suivant = restants[0] || null;
  let h = '<header class="job-head">' +
    '<button class="btn-back" type="button" data-act="back" aria-label="Back">' + icon('back', 20) + '</button>' +
    '<span class="step">Finished</span></header>';
  h += '<div class="body"><div class="done-hero">' +
    '<div class="tick">' + icon('check', 30) + '</div>' +
    '<h1>Cleaning finished</h1>' +
    '<p>' + esc(f.listingName) + ', ' + fmtDuration(f.durationMinutes) + '. ' +
    'The median for a ' + esc(f.unitType) + ' is ' + f.estimatedMinutes + ' min.</p></div>';
  h += '<div class="reco">' +
    '<div class="rr"><span>Checklist</span><b>' + f.checked + '/' + f.total + '</b></div>' +
    '<div class="rr"><span>Photos</span><b>' + f.photos + '</b></div>' +
    (f.queued ? '<div class="rr"><span>Saved on your phone</span><b>yes</b></div>' : '') +
    '</div>';
  h += '<div class="pad">';
  if (suivant) {
    h += '<button class="btn-primary" type="button" data-act="next-stop" data-job="' + esc(suivant.jobId) + '">' +
      'Next stop: ' + esc(suivant.listingName) + '</button>';
  }
  h += '<button class="btn-ghost" type="button" data-act="back-to-day">Back to my day</button></div></div>';
  return h;
}
