// Ecran Job : un logement a la fois. Heure limite en haut, acces, tickets a
// verifier, checklist du template reel, une seule fin (specification, section 3).
// Aucune pause, aucun stop : le chrono demarre au Start et se clot au Finish.
import { esc, icon, minutesUntil, toast } from '/v3/ui.js';
import { newIdem, sendOrQueue } from '/v3/offline.js';
import { navigate, openJob, queueStrip } from '/v3/app.js';
import { finishedView, openFinishSheet, submitFinish } from '/v3/screens/finish.js';

// Libelles des boutons d'appareil photo. Ils ne reprennent JAMAIS le nom de la
// ligne ni le titre du ticket : le bouton photo est un descendant de la ligne,
// donc son libelle entre dans le nom accessible de la ligne. Un libelle
// « Take a photo of Final Check » rendrait deux boutons repondant au nom
// « Final Check » et l'appui de la cleaner (comme celui des tests) deviendrait
// ambigu.
const CAM_ITEM = 'Take a photo for this step';
const CAM_TICKET = 'Take a photo for this ticket';

export function currentStop(state) {
  const id = decodeURIComponent(String(location.hash).replace('#/job/', ''));
  return ((state.day && state.day.stops) || []).find(function (s) { return s.jobId === id; }) || null;
}

function chrono(startedAt) {
  if (!startedAt) return '00:00';
  const sec = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function ligneChecklist(nom, coche, photoExigee, photoPrise) {
  return '<button class="crow" type="button" aria-pressed="' + (coche ? 'true' : 'false') + '" ' +
    'data-act="tick" data-item="' + esc(nom) + '">' +
    '<span class="bx">' + icon('check', 18) + '</span>' +
    '<span class="nm">' + esc(nom) + '</span>' +
    (photoExigee
      ? '<span class="cam' + (photoPrise ? ' done' : '') + '" data-act="shoot" data-item="' + esc(nom) + '" role="button" tabindex="0" aria-label="' + CAM_ITEM + '">' + icon('camera', 18) + '</span>'
      : '<span class="spacer"></span>') +
    '</button>';
}

function ligneTicket(state, t) {
  const fait = state.checkedTickets[t.id] === true;
  return '<button class="crow check" type="button" aria-pressed="' + (fait ? 'true' : 'false') + '" ' +
    'data-act="checkTicket" data-ticket="' + esc(t.id) + '">' +
    '<span class="bx">' + icon('check', 18) + '</span>' +
    '<span class="nm">' + esc(t.title) + '</span>' +
    '<span class="cam' + (state.ticketPhotos[t.id] ? ' done' : '') + '" data-act="shoot-ticket" ' +
    'data-ticket="' + esc(t.id) + '" role="button" tabindex="0" aria-label="' + CAM_TICKET + '">' +
    icon('camera', 18) + '</span>' +
    '</button>';
}

function view(state) {
  const stop = currentStop(state);
  if (state.finished && stop && state.finished.jobId === stop.jobId) {
    return finishedView(state);
  }
  if (!stop) {
    return '<div class="gate"><h1>HK Planner</h1><p class="muted">This cleaning is not on your day.</p>' +
      '<button class="btn-primary" type="button" data-act="back-to-day">Back to my day</button></div>';
  }
  const stops = state.day.stops || [];
  const rang = stops.indexOf(stop) + 1;
  const coches = (stop.checklist || []).filter(function (i) { return state.ticks[i] === true; }).length;
  const total = (stop.checklist || []).length;

  let h = '<header class="job-head">' +
    '<button class="btn-back" type="button" data-act="back" aria-label="Back">' + icon('back', 20) + '</button>' +
    '<span class="step">Stop ' + rang + ' of ' + stops.length + '</span>' +
    '<span class="tm" id="c-timer">' + chrono(stop.startedAt) + '</span></header>';
  h += queueStrip();
  h += '<div class="body">';
  h += '<div class="job-hero"><h1>' + esc(stop.listingName) + '</h1>' +
    '<p class="apt">' + esc(stop.unitType) + (stop.aptNumber ? ', apartment ' + esc(stop.aptNumber) : '') + '</p>' +
    '<dl class="facts">' +
      '<div class="fact"><dt>Check-out</dt><dd>' + esc(stop.checkOutTime || '--') + '</dd></div>' +
      '<div class="fact"><dt>Guest in</dt><dd>' + esc(stop.nextArrivalTime || '--') + '</dd></div>' +
      '<div class="fact"><dt>Type</dt><dd>' + esc(stop.unitType) + '</dd></div>' +
    '</dl></div>';
  if (stop.nextArrivalTime && stop.sameDay) {
    const reste = minutesUntil(stop.nextArrivalTime);
    h += '<div class="deadline"><span>Guest arrives at ' + esc(stop.nextArrivalTime) + '</span>' +
      '<b>' + (reste !== null && reste > 0 ? Math.floor(reste / 60) + 'h' + ('0' + (reste % 60)).slice(-2) : 'now') + '</b></div>';
  }
  if ((stop.openTickets || []).length > 0) {
    h += '<div class="checkhead"><b>Check while you are here</b></div>';
    stop.openTickets.forEach(function (t) { h += ligneTicket(state, t); });
  }
  h += '<div class="checkhead"><b>Checklist, ' + esc(stop.templateName) + '</b>' +
    '<span class="pr">' + coches + '/' + total + '</span></div>';
  h += '<div id="c-list">';
  (stop.checklist || []).forEach(function (nom) {
    h += ligneChecklist(nom, state.ticks[nom] === true,
      (stop.photoRequired || []).indexOf(nom) !== -1, !!state.itemPhotos[nom]);
  });
  h += '</div>';
  h += '<p class="pad muted">The whole row ticks. The camera opens from the row that needs it.</p>';
  h += '</div>';
  h += '<div class="jobactions">' +
    '<button class="btn-report" type="button" data-act="report">Report a problem</button>' +
    '<button class="btn-finish" type="button" data-act="finish">' +
      (coches === total && total > 0 ? 'Finish' : 'Finish ' + coches + '/' + total) + '</button>' +
    '</div>';
  return h;
}

let tictac = null;
function mount(state) {
  if (tictac) { clearInterval(tictac); tictac = null; }
  const stop = currentStop(state);
  if (!stop || !stop.startedAt || state.finished) return;
  tictac = setInterval(function () {
    const el = document.getElementById('c-timer');
    if (!el) { clearInterval(tictac); tictac = null; return; }
    el.textContent = chrono(stop.startedAt);
  }, 1000);
}

// Redimensionne un Blob photo cote client avant envoi : une photo de camera
// recente pese 4 a 10 Mo, au-dela du plafond 6 Mo du proxy (revue tache 5,
// constat 3), et en data mobile chaque envoi rate coute une photo perdue.
// Cote large a 1600 px, JPEG 0.8. Si le canvas echoue (image corrompue, type
// non decode), on renvoie le fichier original : mieux vaut tenter l'envoi
// (et laisser le proxy refuser en 400) que perdre la photo silencieusement.
function redimensionnerPhoto(fichier) {
  return new Promise(function (resolve) {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload = function () {
      URL.revokeObjectURL(url);
      const cote = 1600;
      const ratio = Math.min(1, cote / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob(function (blob) {
        resolve(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : fichier);
      }, 'image/jpeg', 0.8);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      resolve(fichier);
    };
    img.src = url;
  });
}

// Ouvre l'appareil photo et rend le Blob choisi, redimensionne. Une seule
// entree de fichier pour toute l'application : on la reserve le temps d'une
// prise.
function prendrePhoto() {
  return new Promise(function (resolve) {
    const input = document.getElementById('v3-cam');
    if (!input) { resolve(null); return; }
    input.value = '';
    input.onchange = function () {
      const f = input.files && input.files[0] ? input.files[0] : null;
      input.onchange = null;
      if (!f) { resolve(null); return; }
      redimensionnerPhoto(f).then(resolve);
    };
    input.click();
  });
}

async function televerser(state, stop, extra) {
  const fichier = await prendrePhoto();
  if (!fichier) return null;
  const idem = newIdem();
  const corps = Object.assign({ jobId: stop.jobId, idem: idem }, extra || {});
  const r = await sendOrQueue('v3.uploadPhoto', corps, fichier, fichier.name || 'photo.jpg');
  if (r.queued) {
    toast('Photo saved on your phone', 'ok');
    return { photoIdem: idem, photoId: null };
  }
  return { photoIdem: idem, photoId: r.data ? r.data.photoId : null };
}

function majLinge(state, champ, delta) {
  state.linen[champ] = Math.max(0, Math.min(999, (state.linen[champ] || 0) + delta));
  const el = document.querySelector('[data-linen="' + champ + '"]');
  if (el) el.textContent = state.linen[champ];
}

function majCompteur(state, stop) {
  const n = (stop.checklist || []).filter(function (i) { return state.ticks[i] === true; }).length;
  const total = (stop.checklist || []).length;
  const pr = document.querySelector('.checkhead .pr');
  if (pr) pr.textContent = n + '/' + total;
  const bouton = document.querySelector('.btn-finish');
  if (bouton) bouton.textContent = (n === total && total > 0) ? 'Finish' : 'Finish ' + n + '/' + total;
}

const actions = {
  back(state) {
    state.finished = null;
    navigate('#/today');
  },
  'back-to-day'(state) {
    state.finished = null;
    navigate('#/today');
  },
  'next-stop'(state, el) {
    const id = el.getAttribute('data-job');
    const stop = ((state.day && state.day.stops) || []).find(function (s) { return s.jobId === id; });
    if (stop) openJob(state, stop);
  },
  async tick(state, el) {
    const stop = currentStop(state);
    if (!stop) return;
    const nom = el.getAttribute('data-item');
    const nouveau = state.ticks[nom] !== true;
    state.ticks[nom] = nouveau;
    el.setAttribute('aria-pressed', nouveau ? 'true' : 'false');
    majCompteur(state, stop);
    const corps = { jobId: stop.jobId, itemId: nom, checked: nouveau, idem: newIdem() };
    // Photo deja prise pour cette ligne : on la rattache aussi au cochage. Le
    // televersement l'a deja liee au menage et a la ligne, mais ce second lien
    // rend le rattachement correct meme si l'ordre de la file change.
    const photo = state.itemPhotos[nom];
    if (photo && photo.photoId) corps.photoId = photo.photoId;
    let r;
    try {
      r = await sendOrQueue('v3.tick', corps);
    } catch (err) {
      // sendOrQueue ne met en file que les coupures reseau : un refus dur du
      // proxy remonte ici et rien n'a ete garde. La case revient a son etat
      // d'origine, sinon la cleaner voit une ligne cochee que le serveur
      // ignore (meme regle que le retour arriere du Start, revue tache 10).
      state.ticks[nom] = !nouveau;
      el.setAttribute('aria-pressed', !nouveau ? 'true' : 'false');
      majCompteur(state, stop);
      throw err;   // app.js montre le message
    }
    if (r.queued) toast('Saved on your phone', 'ok');
  },
  async shoot(state, el, evt) {
    evt.stopPropagation();
    const stop = currentStop(state);
    if (!stop) return;
    const nom = el.getAttribute('data-item');
    const p = await televerser(state, stop, { itemName: nom });
    if (!p) return;
    state.itemPhotos[nom] = p;
    if (p.photoId) state.photoIds.push(p.photoId);
    el.classList.add('done');
  },
  async 'shoot-ticket'(state, el, evt) {
    evt.stopPropagation();
    const stop = currentStop(state);
    if (!stop) return;
    const id = Number(el.getAttribute('data-ticket'));
    const p = await televerser(state, stop, { ticketId: String(id) });
    if (!p) return;
    state.ticketPhotos[id] = p;
    el.classList.add('done');
  },
  async checkTicket(state, el) {
    const id = Number(el.getAttribute('data-ticket'));
    const photo = state.ticketPhotos[id];
    // Photo obligatoire (ruling 3) : sans preuve, le technicien ne peut rien
    // confirmer, et le proxy refuserait de toute facon.
    if (!photo) { toast('Take a photo first', 'err'); return; }
    const stop = currentStop(state);
    if (!stop) return;
    const corps = { ticketId: id, jobId: stop.jobId, idem: newIdem() };
    if (photo.photoId) corps.photoId = photo.photoId;
    else corps.photoIdem = photo.photoIdem;
    const r = await sendOrQueue('v3.checkTicket', corps);
    state.checkedTickets[id] = true;
    el.setAttribute('aria-pressed', 'true');
    toast(r.queued ? 'Saved on your phone' : 'Sent for confirmation', 'ok');
  },
  report(state) {
    const stop = currentStop(state);
    // Import differe : l'ecran de signalement arrive a la tache 12. La promesse
    // est rendue, jamais avalee, pour que l'echec parte au filet d'app.js et
    // devienne un toast au lieu d'un rejet non gere.
    return import('/v3/screens/report.js').then(function (m) { m.openReportSheet(state, stop); });
  },
  finish(state) {
    openFinishSheet(state, currentStop(state));
  },
  'finish-confirm'(state) {
    return submitFinish(state, currentStop(state));
  },
  'linen-plus'(state, el) { majLinge(state, el.getAttribute('data-field'), 1); },
  'linen-minus'(state, el) { majLinge(state, el.getAttribute('data-field'), -1); },
};

export default { view: view, mount: mount, actions: actions };
