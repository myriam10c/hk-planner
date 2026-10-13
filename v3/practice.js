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
// Tache 6 du branchement 2026-10-05 : les gestes de l'app conversation
// (reportProblem par type et urgence, photos de plus, note, urgence et piece,
// annulation, suppression d'une photo, fin avec rapport et role lead / aide) sont
// simules avec les memes validations que v3_tickets.ts, v3_problems.ts,
// v3_photos.ts et v3_write.ts. Les conversations de la seance sont gardees a part
// (v3PracticeConvs), jamais avec celles de la vraie journee.
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

// Memes valeurs que le proxy (v3.ts V3_PROBLEM_KINDS, V3_PHOTO_OPTIONAL_KINDS,
// V3_URGENCY_PRIORITY ; v3_photos.ts ; v3_problems.ts ; v3_finish_context.ts).
const KINDS = {
  'Gas smell': 'appliance', 'Leak': 'plumbing', 'AC': 'ac', 'AC not working': 'ac',
  'Power': 'electrical', 'Insects': 'pest', 'Missing': 'general', 'Broken': 'general',
  'Stain': 'general', 'Very dirty': 'general', 'Guest forgot': 'general',
  'Wall damage': 'general', "Can't get in": 'general', 'Gas not working': 'appliance',
  'Wi-Fi not working': 'general',
};
const PHOTO_OPTIONAL = ['Gas smell', "Can't get in", 'AC not working', 'Gas not working', 'Wi-Fi not working'];
const URGENCY_PRIORITY = { urgent: 'urgent', soon: 'medium', later: 'low' };
const NOTE_MAX = 300;
const WHERE_MAX = 60;
const WHOLE_APARTMENT = 'Whole apartment';
const REPORT_MAX_BYTES = 20 * 1024;
const LINEN_FIELDS = [
  'pillowcases', 'bed_sheets', 'duvet_covers',
  'small_towels', 'face_towels', 'large_towels', 'bath_mats',
];
const PHOTO_MIME = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic',
};
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
// Comme v3.myDay depuis la phase 3 : un ticket verifie (to_confirm) reste montre, sans bouton.
const TICKETS_A_VERIFIER = new Set(['open', 'assigned', 'in_progress', 'waiting_parts', 'to_confirm']);
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
    reports: {},   // cle d'un signalement -> ticketId (ticketIdem)
  };
}

function lire(c) {
  try {
    const s = JSON.parse(sessionStorage.getItem(CLE_PRACTICE) || 'null');
    if (s && String(s.targetId) === c.id && String(s.viewerId) === c.viewerId && s.jobs) {
      if (!s.reports) s.reports = {};
      return s;
    }
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
  const lue = reprendre ? lire(n) : null;
  seance = lue || neuve(n);
  // Seance repartie du reel : les conversations simulees gardees ne lui
  // correspondent plus (elles citeraient des tickets que le simulateur a oublies).
  if (!lue) oublierConvs();
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
  oublierConvs();
}

// ---------------------------------------------------------------------------
// Conversations de la seance (tache 6 du branchement 2026-10-05). Gardees a
// part de celles de la vraie journee (v3Convs, IndexedDB) : jamais melangees,
// effacees avec la seance. Seulement dans sessionStorage, sans les octets des
// photos (un rechargement garde l'avancement, pas les miniatures).
// ---------------------------------------------------------------------------
export const CLE_PRACTICE_CONVS = 'v3PracticeConvs';

function oublierConvs() {
  try { sessionStorage.removeItem(CLE_PRACTICE_CONVS); } catch (e) { /* stockage indisponible */ }
}

export function practiceSaveConvs(blob) {
  if (!cible || !blob) return;
  try {
    sessionStorage.setItem(CLE_PRACTICE_CONVS, JSON.stringify(Object.assign({}, blob, {
      targetId: cible.id, viewerId: cible.viewerId,
    })));
  } catch (e) { /* stockage plein ou indisponible : la seance vit le temps de la page */ }
}

export function practiceLoadConvs() {
  if (!cible) return null;
  try {
    const s = JSON.parse(sessionStorage.getItem(CLE_PRACTICE_CONVS) || 'null');
    if (s && String(s.targetId) === cible.id && String(s.viewerId) === cible.viewerId) return s;
  } catch (e) { /* illisible : on repart sans conversation */ }
  return null;
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
    }).map(function (t) {
      const sim = tickets[t.id];
      return sim && sim.status !== t.status ? Object.assign({}, t, { status: sim.status }) : t;
    });
    Object.keys(tickets).forEach(function (id) {
      const t = tickets[id];
      if (!t.created || t.listingId !== String(s.listingId) || !TICKETS_A_VERIFIER.has(t.status)) return;
      if (restants.some(function (r) { return String(r.id) === id; })) return;
      restants.push({
        id: Number(id), title: t.title, category: t.category, priority: t.priority,
        status: t.status, assigneeName: null, reportedOn: t.reportedOn || null,
      });
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

// Lecture sure d'une table, comme ownKey (v3.ts) : un « constructor » herite
// d'Object.prototype n'est jamais une cle valide.
function ownKey(table, key) {
  const k = typeof key === 'string' ? key : '';
  return Object.prototype.hasOwnProperty.call(table, k) ? table[k] : null;
}

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

// Meme nettoyage que cleanNote (v3_problems.ts).
function cleanNote(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROLES, '')
    .replace(/[ ]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const coupe = Array.from(s).slice(0, NOTE_MAX).join('').trim();
  return coupe === '' ? null : coupe;
}

// Meme nettoyage que cleanWhere (v3_problems.ts).
function cleanWhere(v) {
  const s = typeof v === 'string' ? v.replace(CONTROLES, ' ').replace(/\s+/g, ' ').trim() : '';
  const coupe = Array.from(s).slice(0, WHERE_MAX).join('').trim();
  return coupe === '' ? WHOLE_APARTMENT : coupe;
}

// Corps de l'app conversation (v3_tickets.ts) : { jobId?, listingId, kind,
// urgency, where, note?, photoId? | photoIdem?, idem }. L'ancien `category` n'est
// plus lu : sans `kind`, le refus est « unknown kind », comme au proxy.
function reportProblem(body) {
  const jobId = body && body.jobId ? String(body.jobId) : null;
  const listingId = body && body.listingId ? String(body.listingId) : '';
  if (!listingId) return refus(400, 'listingId required');
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const cat = ownKey(KINDS, kind);
  if (!cat) return refus(400, 'unknown kind');
  const priority = ownKey(URGENCY_PRIORITY, body.urgency);
  if (!priority) return refus(400, 'invalid urgency');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  const where = cleanWhere(body.where);
  const note = cleanNote(body.note);
  if (jobId && !stopDe(jobId)) return refus(404, 'Job not found.');
  // Photo obligatoire sauf pour les types a photo facultative ; designee mais
  // introuvable, elle est refusee meme pour eux.
  const designee = (body.photoId !== undefined && body.photoId !== null) ||
    (body.photoIdem !== undefined && body.photoIdem !== null);
  const photoId = resolvePhotoId(body);
  if (!photoId && (designee || PHOTO_OPTIONAL.indexOf(kind) === -1)) return refus(400, 'photo required');
  const r = rejeu(body.idem);
  if (r) return r;
  if (photoId && !photoVivante(photoId)) return refus(400, 'photo not found');
  seance.seq += 1;
  const ticketId = BASE_ID + seance.seq;
  // Aucun technicien de permanence connu ici : le ticket reel naitrait
  // « assigned » ou « open », les deux restent a verifier pendant un menage.
  seance.tickets[ticketId] = {
    created: true, listingId: listingId, title: kind + ' · ' + where, kind: kind,
    category: cat, priority: priority, status: 'open', note: note,
    reportedOn: String((jour && jour.date) || ''), at: Date.now(),
  };
  if (photoId) seance.photos[photoId].ticketId = ticketId;
  seance.reports[String(body.idem)] = ticketId;
  // sentTo : aucun technicien de permanence simule, l'app dit « sent to the team ».
  return memoriser(body.idem, { status: 'success', ticketId: ticketId, technicianId: null, priority: priority, sentTo: null });
}

function photoVivante(id) {
  const p = seance.photos[id];
  return p && !p.deleted ? p : null;
}

// Ticket designe par son id ou par la cle du signalement (ticketIdem), comme
// entree() de v3_problems.ts : la cle n'est lue que sur un signalement de cette
// seance.
function entree(body) {
  let ticketId = readTicketId(body.ticketId);
  if (ticketId === 'invalid') ticketId = null;
  if (!ticketId && validIdem(body.ticketIdem)) {
    const tid = seance.reports[String(body.ticketIdem)];
    if (!tid) return refus(400, 'ticket not found');
    ticketId = tid;
  }
  if (!ticketId) return refus(400, 'ticketId required');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  return { ticketId: ticketId };
}

// monTicket : un ticket signale dans cette seance, sinon refus. Un vrai ticket
// du logement n'est pas « a moi » (403), un inconnu n'existe pas (400).
function monTicket(ticketId) {
  const t = seance.tickets[ticketId];
  if (t && t.created) return { ticket: t };
  if (ticketConnu(ticketId)) return refus(403, 'not your problem');
  return refus(400, 'ticket not found');
}

const estFerme = t => TICKET_CLOS.indexOf(String(t.status || '')) !== -1;

function surMonTicket(ticketId, idem, ecrire) {
  const r = rejeu(idem);
  if (r) return r;
  const mt = monTicket(ticketId);
  if (!mt.ticket) return mt;
  const w = ecrire(mt.ticket);
  if (w.body) return w;   // refus : {status, body}
  return memoriser(idem, w);
}

function addProblemPhoto(body) {
  const e = entree(body);
  if (e.body) return e;
  const photoId = resolvePhotoId(body);
  if (!photoId) return refus(400, 'photo required');
  return surMonTicket(e.ticketId, body.idem, function (t) {
    if (estFerme(t)) return refus(400, 'ticket is already closed');
    const p = photoVivante(photoId);
    if (!p) return refus(400, 'photo not found');
    p.ticketId = e.ticketId;
    return { status: 'success', ticketId: e.ticketId, photoId: photoId };
  });
}

function setProblemNote(body) {
  const e = entree(body);
  if (e.body) return e;
  if (body.note === undefined || (body.note !== null && typeof body.note !== 'string')) {
    return refus(400, 'note required');
  }
  const note = cleanNote(body.note);
  return surMonTicket(e.ticketId, body.idem, function (t) {
    if (estFerme(t)) return refus(400, 'ticket is already closed');
    t.note = note;
    return { status: 'success', ticketId: e.ticketId, note: note };
  });
}

function updateProblem(body) {
  const e = entree(body);
  if (e.body) return e;
  const aUrgence = body.urgency !== undefined;
  const priority = aUrgence ? ownKey(URGENCY_PRIORITY, body.urgency) : null;
  if (aUrgence && !priority) return refus(400, 'invalid urgency');
  const aPiece = body.where !== undefined;
  if (!aUrgence && !aPiece) return refus(400, 'nothing to update');
  const where = aPiece ? cleanWhere(body.where) : null;
  return surMonTicket(e.ticketId, body.idem, function (t) {
    if (estFerme(t)) return refus(400, 'ticket is already closed');
    if (priority) t.priority = priority;
    if (where !== null) t.title = String(t.title || '').split(' · ')[0] + ' · ' + where;
    return { status: 'success', ticketId: e.ticketId, priority: t.priority, title: t.title };
  });
}

function deleteProblem(body) {
  const e = entree(body);
  if (e.body) return e;
  return surMonTicket(e.ticketId, body.idem, function (t) {
    const fait = { status: 'success', ticketId: e.ticketId, status_value: 'cancelled' };
    if (String(t.status) === 'cancelled') return fait;
    if (estFerme(t)) return refus(400, 'ticket is already closed');
    t.status = 'cancelled';
    return fait;
  });
}

// Meme ordre que deletePhoto (v3_photos.ts) : la photo par son id ou par la cle
// de son televersement ; un televersement inconnu n'a rien a effacer.
function deletePhoto(body) {
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  let brut = body.photoId;
  if ((brut === undefined || brut === null || brut === '') && validIdem(body.photoIdem)) {
    const up = seance.idem[String(body.photoIdem)];
    if (!up || !up.photoId) return ok({ status: 'success', photoId: null });
    brut = up.photoId;
  }
  const n = typeof brut === 'number' || (typeof brut === 'string' && brut !== '') ? Number(brut) : NaN;
  if (!Number.isInteger(n) || n <= 0) return refus(400, 'Invalid photo id.');
  const p = photoVivante(n);
  if (!p) {
    const r = rejeu(body.idem);
    return r || refus(404, 'Photo not found.');
  }
  if (p.ticketId !== null && p.ticketId !== undefined) return refus(409, 'This photo belongs to a problem report.');
  const r = rejeu(body.idem);
  if (r) return r;
  p.deleted = true;
  return memoriser(body.idem, { status: 'success', photoId: n });
}

function ticketConnu(id) {
  if (seance.tickets[id]) return seance.tickets[id];
  const vrai = ((jour && jour.stops) || []).some(function (s) {
    return (s.openTickets || []).some(function (t) { return Number(t.id) === id; });
  });
  if (!vrai) return null;
  // Le statut reel du ticket (assigned, to_confirm...) est garde : la journee recouverte le montre tel quel.
  let reel = null;
  ((jour && jour.stops) || []).forEach(function (s) {
    (s.openTickets || []).forEach(function (t) { if (Number(t.id) === id && t.status) reel = String(t.status); });
  });
  seance.tickets[id] = { created: false, status: reel || 'open' };
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
  if (!photoVivante(photoId)) return refus(400, 'photo not found');
  ticket.status = 'to_confirm';
  return memoriser(body.idem, { status: 'success', ticketId: ticketId, status_value: 'to_confirm' });
}

// Comme ticketStill (v3_tickets.ts) : un commentaire, aucun changement de statut ; un
// ticket deja clos repond 200 { ok, alreadyClosed } sans rien ecrire.
function ticketStill(body) {
  const ticketId = readTicketId(body.ticketId);
  if (!ticketId || ticketId === 'invalid') return refus(400, 'ticketId required');
  if (!validIdem(body.idem)) return refus(400, 'idem required');
  const r = rejeu(body.idem);
  if (r) return r;
  const ticket = ticketConnu(ticketId);
  if (!ticket) return refus(400, 'ticket not found');
  if (TICKET_CLOS.indexOf(String(ticket.status || '')) !== -1) return memoriser(body.idem, { ok: true, alreadyClosed: true });
  return memoriser(body.idem, { ok: true });
}

// Comme myReports (v3_reports.ts) : les signalements de cette seance, du plus recent au plus ancien.
const STATUT_REPORT = {
  assigned: 'with_tech', open: 'open', in_progress: 'in_progress', waiting_parts: 'waiting_parts',
  to_confirm: 'to_confirm', resolved: 'fixed', closed: 'fixed',
};
function myReports() {
  const reports = Object.keys(seance.tickets)
    .map(function (id) { return { id: Number(id), t: seance.tickets[id] }; })
    .filter(function (x) { return x.t.created && STATUT_REPORT[x.t.status]; })
    .sort(function (a, b) { return (b.t.at || 0) - (a.t.at || 0) || b.id - a.id; })
    .map(function (x) {
      const title = String(x.t.title || 'Ticket');
      const i = title.lastIndexOf(' · ');
      const stop = ((jour && jour.stops) || []).find(function (s) { return String(s.listingId) === x.t.listingId; });
      return {
        id: x.id, title: title, place: i < 0 ? '' : title.slice(i + 3).trim(),
        listingLabel: stop && stop.listingName ? String(stop.listingName) : 'Apartment',
        reportedOn: x.t.reportedOn || String((jour && jour.date) || ''),
        status: STATUT_REPORT[x.t.status], techName: null,
      };
    });
  return ok({ reports: reports });
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
  const rapport = readReport(body.report);
  if (rapport.error) return refus(400, rapport.error);
  // Role sur ce menage comme jobRole (v3_finish_context.ts) : le lead compte le
  // linge, sauf une sous-traitante ; l'aide ne compte rien et ne clot rien.
  const role = roleDe(stop, jobId);
  const lead = role === 'lead';
  const metier = jour && jour.me ? String(jour.me.role || '') : '';
  let linen = null;
  if (lead && metier !== 'subcontractor') {
    const lu = readLinen(body.linen && typeof body.linen === 'object' ? body.linen : {});
    if (lu.error) return refus(400, lu.error);
    linen = lu.values;
  }
  const r = rejeu(body.idem);
  if (r) return r;
  const j = job(jobId);
  if (!lead) {
    j.helperFinished = true;
    return memoriser(body.idem, { status: 'success', jobId: jobId, durationMinutes: null, unchecked: unchecked, role: role });
  }
  if (rapport.report) j.report = true;
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
  return memoriser(body.idem, {
    status: 'success', jobId: jobId, durationMinutes: durationMinutes, unchecked: unchecked, role: role,
  });
}

// Meme lecture que readReport (v3_finish_context.ts).
function readReport(v) {
  if (v === undefined || v === null) return { report: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'report must be an object' };
  let taille;
  try {
    taille = new TextEncoder().encode(JSON.stringify(v)).length;
  } catch (e) {
    return { error: 'report must be an object' };
  }
  if (taille > REPORT_MAX_BYTES) return { error: 'report is too large' };
  return { report: v };
}

// Role de la cible sur ce menage, comme v3.myDay le rend (meme regle que
// jobRole). Sans role connu : aide si une autre personne a demarre avant elle.
function roleDe(stop, jobId) {
  if (stop.role === 'lead' || stop.role === 'helper') return stop.role;
  const autres = (stop.othersOnJob || []).filter(function (o) { return o && o.startedAt; });
  if (!autres.length) return 'lead';
  const j = seance.jobs[jobId];
  const mien = stop.myStartedAt || (j && j.startedAt) || null;
  const premier = autres.map(function (o) { return Date.parse(o.startedAt); }).sort()[0];
  return mien && Date.parse(mien) <= premier ? 'lead' : 'helper';
}

// Point d'entree, appele par api.js. `opts` est celui de request() : `body`
// (objet JSON), ou `form` (multipart d'une photo).
export async function simulate(action, opts) {
  const o = opts || {};
  if (!cible || !seance) return refus(400, 'Not available in practice');
  if (action === 'v3.uploadPhoto') return uploadPhoto(o.form);
  if (action === 'v3.myReports') return myReports();
  const SIMULEES = {
    'v3.startJob': startJob, 'v3.tick': tick, 'v3.reportProblem': reportProblem,
    'v3.checkTicket': checkTicket, 'v3.finishJob': finishJob,
    'v3.addProblemPhoto': addProblemPhoto, 'v3.setProblemNote': setProblemNote,
    'v3.updateProblem': updateProblem, 'v3.deleteProblem': deleteProblem,
    'v3.deletePhoto': deletePhoto, 'v3.ticketStill': ticketStill,
  };
  const fn = ownKey(SIMULEES, action);
  if (!fn) return refus(400, 'Not available in practice');
  const body = corpsJson(o);
  if (!body || typeof body !== 'object') return refus(400, 'invalid json body');
  return fn(body);
}
