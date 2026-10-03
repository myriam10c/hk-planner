// Mode Practice (plan 2026-10-02, tache 2) : un manager prend la vraie journee
// d'une cleaner et fait tous ses gestes, sans que rien ne soit enregistre.
//
// Ce module est le simulateur des ecritures. Il est appele par api.js, au point
// de passage unique : en Practice, toute action autre que v3.myDay et
// cleanerLogout est servie ici et ne touche jamais fetch. Les reponses ont la
// forme exacte de celles du proxy (v3_write.ts, v3_tickets.ts, v3_photos.ts), et
// les refus qui donnent un message a la cleaner sont rendus avec le meme texte et
// le meme code, dans le meme ordre de verification.
//
// L'avancement simule vit en memoire et dans sessionStorage (v3PracticeState),
// pour survivre a la navigation et au rechargement de l'onglet. Il est lie a la
// cible et a la personne qui l'a choisie : une autre cible, un autre manager, un
// Exit, un Sign out le jettent. Il est rejoue sur la journee reelle a chaque
// chargement (practiceDay), comme v3.myDay rendrait l'etat ecrit par le proxy.
//
// Ce module n'importe rien : api.js et app.js l'importent, jamais l'inverse.

export const CLE_PRACTICE = 'v3PracticeState';

// Actions qui partent vraiment au proxy en Practice : la lecture de la journee
// (la meme v3.myDay?as=<id> que « View as ») et la revocation de la session.
export const PASSE_PRACTICE = new Set(['v3.myDay', 'cleanerLogout']);

// Memes valeurs que le proxy (v3.ts, v3_photos.ts, v3_myday.ts).
const CATEGORIES = {
  ac: { label: 'AC', ticketCategory: 'ac' },
  plumbing: { label: 'Plumbing', ticketCategory: 'plumbing' },
  electrical: { label: 'Electrical', ticketCategory: 'electrical' },
  appliance: { label: 'Appliance', ticketCategory: 'appliance' },
  pest: { label: 'Pest', ticketCategory: 'pest' },
  other: { label: 'Other', ticketCategory: 'general' },
};
const LINEN_FIELDS = [
  'pillowcases', 'bed_sheets', 'duvet_covers',
  'small_towels', 'face_towels', 'large_towels', 'bath_mats',
];
const PHOTO_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic',
};
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const TICKETS_A_VERIFIER = new Set(['open', 'assigned', 'in_progress', 'waiting_parts']);
const TICKET_CLOS = ['resolved', 'cancelled'];
// Identifiants simules : loin des sequences reelles, pour qu'aucun ne se
// confonde avec une vraie photo ou un vrai ticket dans un ecran.
const BASE_ID = 900000000;

let cible = null;     // {id, viewerId} : la seance en cours, ou null
let seance = null;    // avancement simule
let jour = null;      // la journee affichee (state.day), deja recouverte
// Numero de seance, change a chaque ouverture et a chaque fermeture. Un geste
// le capture a son debut (practiceMark) : s'il a change quand l'attente du geste
// se termine (redimensionnement d'une photo), la seance d'origine est finie et
// le geste ne doit ni partir au proxy ni entrer en file (revue tache 2, constat 1).
let epoque = 0;

// Marque de la seance en cours, ou 0 hors Practice.
export function practiceMark() {
  return cible ? epoque : 0;
}

// Vrai si `mark` vient d'une seance Practice qui n'est plus celle en cours.
export function practiceEnded(mark) {
  return !!mark && (!cible || mark !== epoque);
}

function neuve(c) {
  return {
    targetId: c.id, viewerId: c.viewerId, seq: 0,
    jobs: {},      // jobId -> {state, startedAt, durationMinutes, progress, linen}
    photos: {},    // photoId -> {idem, jobId, ticketId, itemName}
    tickets: {},   // ticketId -> {listingId, title, category, priority, status}
    idem: {},      // cle d'idempotence -> resultat memorise
  };
}

function lire(c) {
  try {
    const s = JSON.parse(sessionStorage.getItem(CLE_PRACTICE) || 'null');
    if (s && String(s.targetId) === c.id && String(s.viewerId) === c.viewerId && s.jobs) return s;
  } catch (e) { /* illisible : on repart du reel */ }
  return null;
}

function ecrire() {
  try {
    if (seance) sessionStorage.setItem(CLE_PRACTICE, JSON.stringify(seance));
    else sessionStorage.removeItem(CLE_PRACTICE);
  } catch (e) { /* stockage indisponible : la seance vit le temps de la page */ }
}

// Ouvre la seance pour cette cible. `reprendre` : relire l'avancement garde
// (rechargement de l'onglet) ; sinon on repart de la journee reelle.
export function practiceOn(c, reprendre) {
  const n = { id: String(c.id), viewerId: String(c.viewerId) };
  const memeCible = cible && cible.id === n.id && cible.viewerId === n.viewerId;
  cible = n;
  if (reprendre && memeCible && seance) return;
  epoque += 1;
  seance = (reprendre && lire(n)) || neuve(n);
  jour = null;
  ecrire();
}

// Ferme la seance et efface tout ce qu'elle a simule.
export function practiceOff() {
  epoque += 1;
  cible = null;
  seance = null;
  jour = null;
  try { sessionStorage.removeItem(CLE_PRACTICE); } catch (e) { /* stockage indisponible */ }
}

export function practiceActive() {
  return !!cible;
}

// Recouvre la journee reelle par l'avancement simule, comme v3.myDay rendrait
// l'etat ecrit : etat et chrono des menages, cases, tickets verifies (sortis de
// la liste, ils attendent le technicien) et tickets signales (ajoutes au
// logement). Mute `day` et le garde comme reference du simulateur.
export function practiceDay(day) {
  if (!cible || !seance || !day) return day;
  jour = day;
  const tickets = seance.tickets;
  (day.stops || []).forEach(function (s) {
    const j = seance.jobs[s.jobId];
    if (j) {
      if (j.state) s.state = j.state;
      if (j.startedAt) s.startedAt = j.startedAt;
      s.progress = Object.assign({}, s.progress || {}, j.progress || {});
    }
    const restants = (s.openTickets || []).filter(function (t) {
      const sim = tickets[t.id];
      return !sim || TICKETS_A_VERIFIER.has(sim.status);
    });
    Object.keys(tickets).forEach(function (id) {
      const t = tickets[id];
      if (!t.created || t.listingId !== String(s.listingId) || !TICKETS_A_VERIFIER.has(t.status)) return;
      if (restants.some(function (r) { return String(r.id) === id; })) return;
      restants.push({ id: Number(id), title: t.title, category: t.category, priority: t.priority });
    });
    s.openTickets = restants;
  });
  return day;
}

// ---------------------------------------------------------------------------
// Simulateur. Rend {status, body} comme le proxy ; api.js en fait une reponse
// ou une ApiError exactement comme pour un vrai appel.
// ---------------------------------------------------------------------------

function refus(status, error) {
  return { status: status, body: { error: error } };
}

function ok(body) {
  return { status: 200, body: body };
}

function validIdem(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(v);
}

function stopDe(jobId) {
  return ((jour && jour.stops) || []).find(function (s) { return s.jobId === jobId; }) || null;
}

function job(jobId) {
  return seance.jobs[jobId] || (seance.jobs[jobId] = { progress: {} });
}

// Meme lecture que readPhotoId (v3_write.ts).
function readPhotoId(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return 'invalid';
  if (typeof v !== 'number' && typeof v !== 'string') return 'invalid';
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return 'invalid';
  return n;
}

// Meme lecture que resolvePhotoId (v3_tickets.ts) : l'identifiant, sinon la cle
// du televersement.
function resolvePhotoId(body) {
  if (body && body.photoId) {
    const n = Number(body.photoId);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (!validIdem(body && body.photoIdem)) return null;
  const r = seance.idem[String(body.photoIdem)];
  return r && r.photoId ? Number(r.photoId) : null;
}

// Rejeu d'une meme cle : le resultat memorise, comme replayResponse.
function rejeu(idem) {
  const r = seance.idem[String(idem)];
  return r ? ok(r) : null;
}

function memoriser(idem, result) {
  seance.idem[String(idem)] = result;
  ecrire();
  return ok(result);
}

function corpsJson(o) {
  if (!o.body) return null;
  try { return JSON.parse(JSON.stringify(o.body)); } catch (e) { return null; }
}

function startJob(body) {
  const jobId = String((body && body.jobId) || '');
  if (!jobId) return refus(400, 'jobId required');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  const stop = stopDe(jobId);
  if (!stop) return refus(404, 'Job not found.');
  const r = rejeu(body.idem);
  if (r) return r;
  // Un chrono deja ouvert n'est jamais ecrase, un chrono clos est repris.
  const j = job(jobId);
  const ouvert = j.state ? (j.state === 'running' && j.startedAt) : (stop.state === 'running' && stop.startedAt);
  const startedAt = ouvert ? String(j.startedAt || stop.startedAt) : new Date().toISOString();
  j.state = 'running';
  j.startedAt = startedAt;
  j.durationMinutes = null;
  return memoriser(body.idem, { status: 'success', jobId: jobId, startedAt: startedAt });
}

function tick(body) {
  const jobId = String((body && body.jobId) || '');
  const itemId = String((body && body.itemId) || '');
  if (!jobId || !itemId) return refus(400, 'jobId and itemId required');
  if (typeof body.checked !== 'boolean') return refus(400, 'checked must be a boolean');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  if (readPhotoId(body.photoId) === 'invalid') return refus(400, 'Invalid photo id.');
  const stop = stopDe(jobId);
  if (!stop) return refus(404, 'Job not found.');
  const r = rejeu(body.idem);
  if (r) return r;
  job(jobId).progress[itemId] = body.checked;
  // La journee en memoire suit aussi : rouvrir le menage depuis Today (openJob
  // repart de stop.progress) retrouve les cases de la seance.
  stop.progress = Object.assign({}, stop.progress || {});
  stop.progress[itemId] = body.checked;
  return memoriser(body.idem, { status: 'success', jobId: jobId, itemId: itemId, checked: body.checked });
}

function readTicketId(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') return 'invalid';
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) return 'invalid';
  return n;
}

// Le fichier n'est lu que pour son type et sa taille : aucun octet ne sort.
function uploadPhoto(form) {
  if (!form || typeof form.get !== 'function') return refus(400, 'multipart body required');
  const idem = form.get('idem');
  if (!validIdem(idem)) return refus(400, 'idem required');
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return refus(400, 'file required');
  const mime = String(file.type || '').toLowerCase();
  const ext = PHOTO_MIME[mime];
  if (!ext) return refus(400, 'unsupported image type');
  const size = Number(file.size || 0);
  if (!(size > 0)) return refus(400, 'empty file');
  if (size > MAX_PHOTO_BYTES) return refus(413, 'photo is too large');
  const jobRaw = form.get('jobId');
  if (jobRaw !== null && typeof jobRaw !== 'string') return refus(400, 'jobId must be text');
  const jobId = jobRaw ? String(jobRaw) : null;
  const ticketId = readTicketId(form.get('ticketId'));
  if (ticketId === 'invalid') return refus(400, 'ticketId must be a number');
  const itemName = form.get('itemName') ? String(form.get('itemName')) : null;
  if (!jobId && !ticketId) return refus(400, 'jobId or ticketId required');
  if (jobId && !stopDe(jobId)) return refus(404, 'Job not found.');
  const r = rejeu(idem);
  if (r) return r;
  seance.seq += 1;
  const photoId = BASE_ID + seance.seq;
  seance.photos[photoId] = { idem: String(idem), jobId: jobId, ticketId: ticketId, itemName: itemName };
  return memoriser(idem, {
    status: 'success', photoId: photoId,
    path: 'practice/' + String((jour && jour.date) || '') + '/' + photoId + '.' + ext,
  });
}

function reportProblem(body) {
  const jobId = body && body.jobId ? String(body.jobId) : null;
  const listingId = body && body.listingId ? String(body.listingId) : '';
  const category = String((body && body.category) || '').toLowerCase();
  if (!listingId) return refus(400, 'listingId required');
  const meta = Object.prototype.hasOwnProperty.call(CATEGORIES, category) ? CATEGORIES[category] : null;
  if (!meta) return refus(400, 'unknown category');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  if (jobId && !stopDe(jobId)) return refus(404, 'Job not found.');
  const photoId = resolvePhotoId(body);
  if (!photoId) return refus(400, 'photoId required');
  const r = rejeu(body.idem);
  if (r) return r;
  if (!seance.photos[photoId]) return refus(400, 'photo not found');
  seance.seq += 1;
  const ticketId = BASE_ID + seance.seq;
  // Aucun technicien de permanence connu ici : le ticket reel naitrait
  // « assigned » ou « open », les deux restent a verifier pendant un menage.
  seance.tickets[ticketId] = {
    created: true, listingId: listingId, title: meta.label + ' problem reported during a cleaning',
    category: meta.ticketCategory, priority: 'medium', status: 'open',
  };
  return memoriser(body.idem, { status: 'success', ticketId: ticketId, technicianId: null });
}

function ticketConnu(id) {
  if (seance.tickets[id]) return seance.tickets[id];
  const vrai = ((jour && jour.stops) || []).some(function (s) {
    return (s.openTickets || []).some(function (t) { return Number(t.id) === id; });
  });
  if (!vrai) return null;
  seance.tickets[id] = { created: false, status: 'open' };
  return seance.tickets[id];
}

function checkTicket(body) {
  const ticketId = body && body.ticketId ? Number(body.ticketId) : 0;
  if (!ticketId) return refus(400, 'ticketId required');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  const photoId = resolvePhotoId(body);
  if (!photoId) return refus(400, 'photoId required');
  const r = rejeu(body.idem);
  if (r) return r;
  const ticket = ticketConnu(ticketId);
  if (!ticket) return refus(400, 'ticket not found');
  if (TICKET_CLOS.indexOf(String(ticket.status || '')) !== -1) return refus(400, 'ticket is already closed');
  if (!seance.photos[photoId]) return refus(400, 'photo not found');
  ticket.status = 'to_confirm';
  return memoriser(body.idem, { status: 'success', ticketId: ticketId, status_value: 'to_confirm' });
}

// Meme lecture que readLinen (v3.ts).
function readLinen(body) {
  const values = {};
  for (const f of LINEN_FIELDS) {
    if (f === 'face_towels' && body[f] === undefined) { values[f] = 0; continue; }
    if (body[f] === null || body[f] === undefined) return { error: f + ' must be an integer' };
    const n = Number(body[f]);
    if (!Number.isInteger(n)) return { error: f + ' must be an integer' };
    if (n < 0) return { error: f + ' must be >= 0' };
    if (n > 999) return { error: f + ' is out of range' };
    values[f] = n;
  }
  return { values: values };
}

function finishJob(body) {
  const jobId = String((body && body.jobId) || '');
  if (!jobId) return refus(400, 'jobId required');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  const stop = stopDe(jobId);
  if (!stop) return refus(404, 'Job not found.');
  const checklist = body.checklist && typeof body.checklist === 'object' ? body.checklist : {};
  const unchecked = Object.keys(checklist).filter(function (k) { return checklist[k] !== true; }).length;
  for (const brut of Array.isArray(body.photos) ? body.photos : []) {
    if (readPhotoId(brut) === 'invalid') return refus(400, 'Invalid photo id.');
  }
  // Le proxy compte le linge pour toute personne qui n'est pas sous-traitante.
  const role = jour && jour.me ? String(jour.me.role || '') : '';
  let linen = null;
  if (role !== 'subcontractor') {
    const lu = readLinen(body.linen && typeof body.linen === 'object' ? body.linen : {});
    if (lu.error) return refus(400, lu.error);
    linen = lu.values;
  }
  const r = rejeu(body.idem);
  if (r) return r;
  const j = job(jobId);
  stop.progress = Object.assign({}, stop.progress || {});
  Object.keys(checklist).forEach(function (k) {
    j.progress[k] = checklist[k] === true;
    stop.progress[k] = checklist[k] === true;
  });
  if (linen) j.linen = linen;
  // Chrono : duree enregistree s'il est deja clos, calculee s'il est ouvert,
  // nulle s'il n'a jamais demarre (le proxy ne refuse pas une fin sans Start).
  // Un menage deja fini dans la journee reelle a un chrono clos dont v3.myDay
  // ne rend pas la duree : null, le front affiche son approximation.
  let durationMinutes = null;
  if (j.state === 'done' || (!j.state && stop.state === 'done')) {
    durationMinutes = j.durationMinutes === undefined ? null : j.durationMinutes;
  } else {
    const depart = j.startedAt || stop.startedAt;
    if (depart) durationMinutes = Math.max(0, Math.round((Date.now() - new Date(depart).getTime()) / 60000));
  }
  j.state = 'done';
  j.durationMinutes = durationMinutes;
  return memoriser(body.idem, { status: 'success', jobId: jobId, durationMinutes: durationMinutes, unchecked: unchecked });
}

// Point d'entree, appele par api.js. `opts` est celui de request() : `body`
// (objet JSON), ou `form` (multipart d'une photo).
export async function simulate(action, opts) {
  const o = opts || {};
  if (!cible || !seance) return refus(400, 'Not available in practice');
  if (action === 'v3.uploadPhoto') return uploadPhoto(o.form);
  const SIMULEES = {
    'v3.startJob': startJob, 'v3.tick': tick, 'v3.reportProblem': reportProblem,
    'v3.checkTicket': checkTicket, 'v3.finishJob': finishJob,
  };
  const fn = SIMULEES[action];
  if (!fn) return refus(400, 'Not available in practice');
  const body = corpsJson(o);
  if (!body || typeof body !== 'object') return refus(400, 'invalid json body');
  return fn(body);
}
