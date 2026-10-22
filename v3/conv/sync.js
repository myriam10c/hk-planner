// Gestes de la conversation -> écritures du proxy (tâche 5 du branchement). Pur, sans DOM ni
// réseau : testable sous Node. app.js appelle syncPlan après chaque geste, met chaque action
// rendue en file (offline.js, dans l'ordre), et rapporte chaque réponse 2xx par ackSync.
//
// Principe : l'état de la conversation est comparé à ce qui est déjà parti (conv.sync). Chaque
// photo et chaque problème reçoit une clé d'idempotence la première fois qu'il est vu, gardée
// sur l'objet lui-même (photo.idem, problem.idem) : elle survit au rechargement (persist.js), et
// rien n'est jamais émis deux fois.
//
// Ordre d'un ménage : startJob ; uploadPhoto par photo de pièce (arrival:<pièce>, end:<pièce>) ;
// problème : uploadPhoto de la première photo (problem) puis reportProblem { photoIdem } ;
// photos suivantes : uploadPhoto + addProblemPhoto { ticketIdem } ; note : setProblemNote ;
// urgence / endroit : updateProblem ; suppression : deleteProblem ; fin : finishJob (finishPlan).
// Tickets ouverts du logement (maintenance phase 3) : « Still there » : ticketStill ;
// « Fixed now » : uploadPhoto (ticketId) de chaque photo puis checkTicket { photoIdem }.
// Note : celle déjà saisie au moment du signalement part dans reportProblem (champ note), toute
// note saisie ou modifiée ensuite part par setProblemNote. Un problème dont la photo est
// obligatoire attend sa première photo : sans photo, il reste dans le rapport partagé seulement.
// Un type à photo facultative choisi sur une tuile (sauf Gas smell, immédiat) attend que la
// cleaner quitte son écran de photos : une tuile touchée puis Back n'envoie rien.
import { isHelper } from "./conversation.js";
import { reportText } from "./report.js";
import { LINEN_USUAL, CARD_ROOM } from "./rules.js";

// Types que le proxy accepte sans photo (V3_PHOTO_OPTIONAL_KINDS côté serveur).
export const PHOTO_OPTIONAL = ["Gas smell", "Can't get in", "AC not working", "Gas not working", "Wi-Fi not working", "Access card missing"];

// Qui écrit (tâche 6 du branchement), seule garde de app.js : « real » = la personne connectée,
// sur sa propre journée, par la file hors ligne ; « practice » = le simulateur local de
// practice.js, rien ne sort ; « none » = View as (lecture seule), pas de session, ou un mode
// Practice dont la séance est fermée. Une journée rendue pour une autre personne (dayViewAs)
// n'écrit jamais, même si le téléphone a perdu la trace du mode.
export function writeMode({ session, viewAs, dayViewAs, practiceActive }) {
  if (!session) return "none";
  if (viewAs && viewAs.practice) return practiceActive ? "practice" : "none";
  if (viewAs || dayViewAs || practiceActive) return "none";
  return "real";
}

function ensureSync(conv) {
  if (!conv.sync) conv.sync = { started: null, photos: {}, problems: {}, tickets: {}, finish: null, idems: {}, acked: {} };
  if (!conv.sync.tickets) conv.sync.tickets = {};
  return conv.sync;
}

const isObj = x => !!x && typeof x === "object";

// ticketId connu (réponse du signalement reçue) : il part avec ticketIdem, le proxy le préfère.
function ticketRef(s, idem) {
  const d = s.acked[idem];
  return d && d.ticketId ? { ticketIdem: idem, ticketId: d.ticketId } : { ticketIdem: idem };
}

export function syncPlan(conv, { newIdem, active = true } = {}) {
  // Conversation en lecture seule (View as) : jamais d'écriture, quel que soit l'appelant.
  if (!active || !conv || conv.readOnly) return [];
  const s = ensureSync(conv);
  const out = [];
  const jobId = conv.apt.id;
  const emit = (action, body, extra = {}) => { s.idems[body.idem] = action; out.push({ action, body, ...extra }); };
  const upload = (photo, itemName, extra = {}) => {
    photo.idem = photo.idem || newIdem();
    s.photos[photo.idem] = { itemName, deleted: false };
    emit("v3.uploadPhoto", { jobId, ...extra, itemName, idem: photo.idem }, { file: photo.file || null, fileName: photo.file && photo.file.name ? photo.file.name : "photo.jpg" });
    return photo.idem;
  };

  // Photo déjà en file (son rattachement, lui, a été défait) : on ne la renvoie pas.
  const queued = ph => (ph.idem && s.photos[ph.idem] ? ph.idem : null);

  // 1. Démarrage (I'm here / I'm in now). La bulle de la cleaner porte la clé, pour ✓ / ✓✓.
  if (conv.startedAt && !s.started) {
    const idem = newIdem();
    s.started = idem;
    const m = conv.messages.slice().reverse().find(x => x.from === "me" && x.type === "text");
    if (m) m.idem = idem;
    emit("v3.startJob", { jobId, idem });
  }

  // 2. Photos de pièce : retirées d'abord (miniature supprimée), puis les nouvelles.
  const present = new Set();
  const stores = [["arrival", conv.arrivalPhotos], ["end", conv.endPhotos]];
  for (const [, store] of stores) for (const list of Object.values(store)) for (const p of list) if (isObj(p) && p.idem) present.add(p.idem);
  for (const [idem, rec] of Object.entries(s.photos)) {
    if (rec.itemName === "problem" || rec.itemName === "ticket" || rec.deleted || present.has(idem)) continue;
    rec.deleted = true;
    const d = s.acked[idem];
    const body = { photoIdem: idem, idem: newIdem() };
    if (d && d.photoId) body.photoId = d.photoId;
    // unqueue : app.js retire d'abord le téléversement de la file s'il n'est pas encore parti.
    emit("v3.deletePhoto", body, { unqueue: idem });
  }
  for (const [step, store] of stores) {
    const rooms = step === "arrival" ? [CARD_ROOM].concat(conv.apt.rooms) : conv.apt.rooms;
    for (const room of rooms) for (const p of store[room] || []) if (isObj(p) && !p.idem) upload(p, step + ":" + room);
  }

  // 3. Problèmes.
  const live = new Set();
  for (const p of conv.problems) {
    p.idem = p.idem || newIdem();
    live.add(p.idem);
    const rec = s.problems[p.idem] = s.problems[p.idem] || { reported: false, photos: [], note: null, urgency: null, where: null, deleted: false };
    const photos = p.photos.filter(isObj);
    if (!rec.reported) {
      if (!PHOTO_OPTIONAL.includes(p.kind) && photos.length === 0) continue;
      if (PHOTO_OPTIONAL.includes(p.kind) && p.kind !== "Gas smell" && conv.flow && conv.flow.problem === p && conv.flow.stage === "photos") continue;
      const body = { jobId, listingId: conv.apt.listingId, kind: p.kind, urgency: p.urgency, where: p.where, note: p.note || null };
      if (photos[0]) { body.photoIdem = queued(photos[0]) || upload(photos[0], "problem"); rec.photos.push(photos[0].idem); }
      body.idem = p.idem;
      emit("v3.reportProblem", body);
      Object.assign(rec, { reported: true, note: p.note || null, urgency: p.urgency, where: p.where });
    }
    for (const ph of photos) {
      if (ph.idem && rec.photos.includes(ph.idem)) continue;
      const photoIdem = queued(ph) || upload(ph, "problem");
      rec.photos.push(photoIdem);
      emit("v3.addProblemPhoto", { ...ticketRef(s, p.idem), photoIdem, idem: newIdem() });
    }
    if ((p.note || null) !== rec.note) {
      rec.note = p.note || null;
      emit("v3.setProblemNote", { ...ticketRef(s, p.idem), note: rec.note, idem: newIdem() });
    }
    const patch = {};
    if (p.urgency !== rec.urgency) patch.urgency = p.urgency;
    if (p.where !== rec.where) patch.where = p.where;
    if (Object.keys(patch).length) {
      Object.assign(rec, patch);
      emit("v3.updateProblem", { ...ticketRef(s, p.idem), ...patch, idem: newIdem() });
    }
  }
  for (const [idem, rec] of Object.entries(s.problems)) {
    if (live.has(idem) || rec.deleted) continue;
    rec.deleted = true;
    if (rec.reported) emit("v3.deleteProblem", { ...ticketRef(s, idem), idem: newIdem() });
  }

  // 4. Tickets ouverts du logement : une reponse par ticket, une seule cle, jamais reemise.
  for (const [id, t] of Object.entries(conv.tickets || {})) {
    const rec = s.tickets[id] = s.tickets[id] || { sent: false };
    if (!isObj(t)) continue;
    const ticketId = Number(id);
    // Reponse deja partie : une photo « Fixed now » suivante qui n'est pas entree en file
    // (rollbackSync) repart seule au prochain passage, rattachee au ticket.
    if (rec.sent) {
      if (t.answer === "fixed") for (const ph of (t.photos || []).filter(isObj)) if (!queued(ph)) upload(ph, "ticket", { ticketId });
      continue;
    }
    if (t.answer === "still") {
      t.idem = t.idem || newIdem();
      emit("v3.ticketStill", { jobId, ticketId, idem: t.idem });
      rec.sent = true;
    } else if (t.answer === "fixed") {
      const photos = (t.photos || []).filter(isObj);
      if (!photos.length) continue;
      for (const ph of photos) if (!queued(ph)) upload(ph, "ticket", { ticketId });
      t.idem = t.idem || newIdem();
      emit("v3.checkTicket", { jobId, ticketId, photoIdem: photos[0].idem, idem: t.idem });
      rec.sent = true;
    }
  }
  return out;
}

// Fin du ménage. Lead : au moment de « Send to Housekeeping », avant l'ouverture du partage, avec
// le linge et le rapport. Aide : à « Add to <lead>'s report », sans linge ni rapport. Après un
// refus « linge » (requireLinen) : le linge seul. Une seule fin par conversation.
export function finishPlan(conv, { newIdem, active = true, now = new Date() } = {}) {
  if (!active || !conv || conv.readOnly) return [];
  const s = ensureSync(conv);
  if (s.finish) return [];
  const idem = newIdem();
  s.finish = idem;
  const body = { jobId: conv.apt.id, idem, checklist: {}, photos: [] };
  if (!isHelper(conv) || conv.linenNeeded) {
    body.linen = Object.fromEntries(LINEN_USUAL.map(l => [l.key, Number(conv.linen[l.key]) || 0]));
  }
  if (!isHelper(conv)) {
    body.report = {
      text: reportText(conv, { now }),
      low: conv.low.slice(),
      leave: { ...conv.leave },
      problems: conv.problems.map(p => ({ kind: p.kind, where: p.where, urgency: p.urgency, ref: p.ref, ticketIdem: p.idem || null })),
    };
  }
  s.idems[idem] = "v3.finishJob";
  return [{ action: "v3.finishJob", body }];
}

// Une action n'a pas pu entrer en file (stockage plein, IndexedDB refusé) : ce que syncPlan ou
// finishPlan avait noté comme parti est défait, pour que le prochain syncPlan la réémette.
export function rollbackSync(conv, a) {
  const s = conv && conv.sync;
  if (!s || !a || !a.body) return;
  const b = a.body;
  delete s.idems[b.idem];
  const recOf = idem => s.problems[idem] || null;
  switch (a.action) {
    case "v3.startJob": if (s.started === b.idem) s.started = null; break;
    case "v3.finishJob": if (s.finish === b.idem) s.finish = null; break;
    case "v3.uploadPhoto": {
      delete s.photos[b.idem];
      const all = [...Object.values(conv.arrivalPhotos), ...Object.values(conv.endPhotos), ...conv.problems.map(p => p.photos),
        ...Object.values(conv.tickets || {}).map(t => (t && t.photos) || [])];
      for (const list of all) for (const ph of list) if (isObj(ph) && ph.idem === b.idem) delete ph.idem;
      for (const rec of Object.values(s.problems)) rec.photos = rec.photos.filter(x => x !== b.idem);
      break;
    }
    case "v3.reportProblem": { const rec = recOf(b.idem); if (rec) rec.reported = false; break; }
    case "v3.setProblemNote": { const rec = recOf(b.ticketIdem); if (rec) rec.note = undefined; break; }
    case "v3.updateProblem": {
      const rec = recOf(b.ticketIdem);
      if (rec) { if ("urgency" in b) rec.urgency = undefined; if ("where" in b) rec.where = undefined; }
      break;
    }
    case "v3.addProblemPhoto": {
      const rec = recOf(b.ticketIdem);
      if (rec) rec.photos = rec.photos.filter(x => x !== b.photoIdem);
      break;
    }
    case "v3.deleteProblem": { const rec = recOf(b.ticketIdem); if (rec) rec.deleted = false; break; }
    case "v3.deletePhoto": { const rec = s.photos[b.photoIdem]; if (rec) rec.deleted = false; break; }
    case "v3.ticketStill": case "v3.checkTicket": {
      const rec = s.tickets && s.tickets[String(b.ticketId)];
      if (rec) rec.sent = false;
      break;
    }
  }
}

// Met en file les actions dans l'ordre. `run(a)` rend une promesse (mise en file) ; un échec
// défait l'action (rollbackSync) et toutes celles qui en dépendent dans la suite (un signalement
// dont la photo n'est pas en file, une photo ou une note d'un signalement pas en file) : rien
// ne part en référence à une clé que le proxy ne recevra jamais. `failed` garde les clés
// défaites d'un appel à l'autre. Rend le nombre d'actions défaites.
export async function runActions(conv, actions, run, failed = new Set()) {
  let undone = 0;
  for (const a of actions) {
    const b = a.body || {};
    const dependsOnFailed = [b.photoIdem, b.ticketIdem].some(x => x && failed.has(x));
    let ok = !dependsOnFailed;
    if (ok) {
      try { await run(a); } catch (e) { ok = false; }
    }
    if (ok && b.idem) failed.delete(b.idem);
    if (!ok) {
      if (b.idem) failed.add(b.idem);
      rollbackSync(conv, a);
      undone += 1;
    }
  }
  return undone;
}

// Réponse 2xx reçue pour une clé : rend true si la clé appartient à cette conversation.
export function ackSync(conv, idem, data) {
  const s = conv && conv.sync;
  if (!s || !s.idems[idem]) return false;
  s.acked[idem] = isObj(data) ? data : {};
  return true;
}

export function finishAcked(conv) {
  const s = conv && conv.sync;
  return !!(s && s.finish && s.acked[s.finish]);
}

// Clé dont dépend la coche d'une bulle de la cleaner : la sienne (démarrage, photo, problème
// signalé) ; une bulle sans écriture propre (Walls OK, linge, sortie) dépend de la fin.
function idemOf(conv, m) {
  const s = conv.sync;
  if (m.idem) return m.idem;
  if (m.type === "photo") return isObj(m.photo) ? m.photo.idem || null : null;
  if (m.type === "problem") {
    const p = conv.problems[m.problemIndex];
    const rec = p && p.idem && s.problems[p.idem];
    return rec && rec.reported ? p.idem : null;
  }
  return s.finish;
}

// ✓ (saved) = geste gardé sur le téléphone ; ✓✓ (synced) = réponse 2xx reçue pour son idem.
export function refreshTicks(conv) {
  if (!conv || !conv.sync) return false;
  let changed = false;
  for (const m of conv.messages) {
    // Carte d'un ticket : la coche suit la reponse de la cleaner (ticketStill, checkTicket).
    if (m.type === "ticket") {
      const t = conv.tickets && conv.tickets[m.ticket.id];
      const idem = t && t.idem;
      const status = idem ? (conv.sync.acked[idem] ? "synced" : "saved") : undefined;
      if (m.status !== status) { m.status = status; changed = true; }
      continue;
    }
    if (m.from !== "me") continue;
    const idem = idemOf(conv, m);
    const status = idem && conv.sync.acked[idem] ? "synced" : "saved";
    if (m.status !== status) { m.status = status; changed = true; }
  }
  return changed;
}
