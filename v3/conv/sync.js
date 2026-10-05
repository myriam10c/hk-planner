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
// Un problème dont la photo est obligatoire attend sa première photo (sa note et son endroit
// partent alors avec le signalement) : sans photo, il reste dans le rapport partagé seulement.
import { isHelper } from "./conversation.js";
import { reportText } from "./report.js";
import { LINEN_USUAL } from "./rules.js";

// Types que le proxy accepte sans photo (V3_PHOTO_OPTIONAL_KINDS côté serveur).
export const PHOTO_OPTIONAL = ["Gas smell", "Can't get in", "AC not working", "Gas not working", "Wi-Fi not working"];

function ensureSync(conv) {
  if (!conv.sync) conv.sync = { started: null, photos: {}, problems: {}, finish: null, idems: {}, acked: {} };
  return conv.sync;
}

const isObj = x => !!x && typeof x === "object";

// ticketId connu (réponse du signalement reçue) : il part avec ticketIdem, le proxy le préfère.
function ticketRef(s, idem) {
  const d = s.acked[idem];
  return d && d.ticketId ? { ticketIdem: idem, ticketId: d.ticketId } : { ticketIdem: idem };
}

export function syncPlan(conv, { newIdem, active = true } = {}) {
  if (!active || !conv) return [];
  const s = ensureSync(conv);
  const out = [];
  const jobId = conv.apt.id;
  const emit = (action, body, extra = {}) => { s.idems[body.idem] = action; out.push({ action, body, ...extra }); };
  const upload = (photo, itemName) => {
    photo.idem = photo.idem || newIdem();
    s.photos[photo.idem] = { itemName, deleted: false };
    emit("v3.uploadPhoto", { jobId, itemName, idem: photo.idem }, { file: photo.file || null, fileName: photo.file && photo.file.name ? photo.file.name : "photo.jpg" });
    return photo.idem;
  };

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
    if (rec.itemName === "problem" || rec.deleted || present.has(idem)) continue;
    rec.deleted = true;
    const d = s.acked[idem];
    const body = { photoIdem: idem, idem: newIdem() };
    if (d && d.photoId) body.photoId = d.photoId;
    // unqueue : app.js retire d'abord le téléversement de la file s'il n'est pas encore parti.
    emit("v3.deletePhoto", body, { unqueue: idem });
  }
  for (const [step, store] of stores) {
    for (const room of conv.apt.rooms) for (const p of store[room] || []) if (isObj(p) && !p.idem) upload(p, step + ":" + room);
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
      const body = { jobId, listingId: conv.apt.listingId, kind: p.kind, urgency: p.urgency, where: p.where, note: p.note || null };
      if (photos[0]) { body.photoIdem = upload(photos[0], "problem"); rec.photos.push(photos[0].idem); }
      body.idem = p.idem;
      emit("v3.reportProblem", body);
      Object.assign(rec, { reported: true, note: p.note || null, urgency: p.urgency, where: p.where });
    }
    for (const ph of photos) {
      if (ph.idem && rec.photos.includes(ph.idem)) continue;
      const photoIdem = upload(ph, "problem");
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
  return out;
}

// Fin du ménage. Lead : au moment de « Send to Housekeeping », avant l'ouverture du partage, avec
// le linge et le rapport. Aide : à « Add to <lead>'s report », sans linge ni rapport. Après un
// refus « linge » (requireLinen) : le linge seul. Une seule fin par conversation.
export function finishPlan(conv, { newIdem, active = true, now = new Date() } = {}) {
  if (!active || !conv) return [];
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
    if (m.from !== "me") continue;
    const idem = idemOf(conv, m);
    const status = idem && conv.sync.acked[idem] ? "synced" : "saved";
    if (m.status !== status) { m.status = status; changed = true; }
  }
  return changed;
}
