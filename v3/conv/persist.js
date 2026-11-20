// Reprise d'une conversation après un rechargement (tâche 5 du branchement). Pur : testable
// sous Node. L'état part en JSON dans sessionStorage ; les photos n'y gardent que leur clé
// (photo.idem), leurs octets vivent dans IndexedDB (offline.js, magasin « files »).
//
// Les liens d'identité de la conversation sont rendus explicites, puis reconstruits :
// une même photo dans un magasin de pièce et dans une bulle, le problème d'un signalement
// en cours (flow.problem), la bulle à retirer s'il se ravise (flow.said), et les problèmes
// reliés aux lignes de sortie (leaveProblems).
export const PERSIST_VERSION = 1;

const isObj = x => !!x && typeof x === "object";
const ref = p => (isObj(p) ? { $photo: p.idem || null } : p);
const iso = d => (d instanceof Date ? d.toISOString() : d || null);

export function serializeConversation(conv) {
  const mapStore = st => Object.fromEntries(Object.entries(st).map(([room, list]) => [room, list.map(ref)]));
  const idx = p => conv.problems.indexOf(p);
  const flow = conv.flow ? {
    ...conv.flow,
    problem: conv.flow.problem ? idx(conv.flow.problem) : null,
    said: conv.flow.said ? conv.messages.indexOf(conv.flow.said) : null,
  } : null;
  return {
    v: PERSIST_VERSION,
    ...conv,
    startedAt: iso(conv.startedAt),
    endedAt: iso(conv.endedAt),
    arrivalSentAt: iso(conv.arrivalSentAt),
    messages: conv.messages.map(m => (m.type === "photo" ? { ...m, photo: ref(m.photo) } : { ...m })),
    arrivalPhotos: mapStore(conv.arrivalPhotos),
    endPhotos: mapStore(conv.endPhotos),
    problems: conv.problems.map(p => ({ ...p, photos: p.photos.map(ref) })),
    // Reponses aux tickets ouverts : leurs photos par cle ; un viseur « Fixed now » ouvert ne se reprend pas.
    tickets: Object.fromEntries(Object.entries(conv.tickets || {}).map(([id, t]) => [id, { ...t, photos: (t.photos || []).map(ref) }])),
    fix: null,
    leaveProblems: Object.fromEntries(Object.entries(conv.leaveProblems).map(([k, p]) => [k, idx(p)])),
    flow,
  };
}

// `photoOf(idem)` rend l'objet photo reconstruit ({ url, file, idem }) ; la même clé rend
// toujours le même objet, pour que la bulle et le magasin de la pièce restent une seule photo.
// Bulle « make it look like this » gardee avant que le message ne porte la piece (refRoom) : elle
// avait copie l'URL signee, qui peut etre perimee. On la rattache a la piece pour la relire sur l'appartement.
function legacyRef(m) {
  if (m.type !== "text" || m.refRoom || !m.photo) return m;
  const r = /^(.+): make it look like this\.$/.exec(m.text || "");
  if (!r) return m;
  delete m.photo;
  m.refRoom = r[1];
  return m;
}

export function deserializeConversation(data, photoOf) {
  if (!isObj(data) || data.v !== PERSIST_VERSION) return null;
  const cache = new Map();
  const photo = r => {
    if (!isObj(r) || !("$photo" in r)) return r;
    const k = r.$photo;
    if (!cache.has(k)) cache.set(k, photoOf(k) || { url: null, file: null, idem: k });
    return cache.get(k);
  };
  const mapStore = st => Object.fromEntries(Object.entries(st || {}).map(([room, list]) => [room, (list || []).map(photo)]));
  const { v, ...rest } = data;
  const conv = {
    ...rest,
    startedAt: data.startedAt ? new Date(data.startedAt) : null,
    endedAt: data.endedAt ? new Date(data.endedAt) : null,
    arrivalSentAt: data.arrivalSentAt ? new Date(data.arrivalSentAt) : null,
    messages: (data.messages || []).map(m => (m.type === "photo" ? { ...m, photo: photo(m.photo) } : legacyRef({ ...m }))),
    arrivalPhotos: mapStore(data.arrivalPhotos),
    endPhotos: mapStore(data.endPhotos),
    problems: (data.problems || []).map(p => ({ ...p, photos: (p.photos || []).map(photo) })),
    tickets: Object.fromEntries(Object.entries(data.tickets || {}).map(([id, t]) => [id, { ...t, photos: ((t && t.photos) || []).map(photo) }])),
    fix: null,
  };
  conv.leaveProblems = {};
  for (const [k, i] of Object.entries(data.leaveProblems || {})) if (conv.problems[i]) conv.leaveProblems[k] = conv.problems[i];
  if (data.flow) {
    conv.flow = {
      ...data.flow,
      problem: data.flow.problem !== null && data.flow.problem !== undefined ? conv.problems[data.flow.problem] || null : null,
      said: data.flow.said !== null && data.flow.said !== undefined ? conv.messages[data.flow.said] || null : null,
    };
  }
  return conv;
}

// Toutes les clés de photos d'une conversation (pour relire leurs octets dans IndexedDB).
export function photoIdems(data) {
  const out = new Set();
  const walk = x => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (isObj(x)) { if ("$photo" in x && x.$photo) out.add(x.$photo); else Object.values(x).forEach(walk); }
  };
  walk([data && data.messages, data && data.arrivalPhotos, data && data.endPhotos, data && data.problems, data && data.tickets]);
  return [...out];
}

// Copie de la journée (tâche 6 du lot 1) : la dernière lecture réussie de v3.myDay est gardée à
// part des conversations, pour la personne et le jour de Dubaï de cette lecture, avec l'instant
// réel de la lecture (`at`, ms). Sans réseau au démarrage, la liste du jour s'affiche depuis elle.
// Jamais d'une journée View as (ni de Practice, qui en est une). Rend null si rien n'est à garder.
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
export function dayCopy(day, at) {
  if (!isObj(day) || day.viewAs || !isObj(day.me) || day.me.id === undefined || day.me.id === null) return null;
  if (!JOUR.test(String(day.date || ""))) return null;
  return { me: String(day.me.id), date: day.date, at: Number.isFinite(at) ? at : 0, day };
}

// Copie utilisable : celle d'aujourd'hui à Dubaï (`today`), de la personne du téléphone quand elle
// est connue (`me`), cohérente avec sa journée. Rend { day, at } ou null : une copie refusée est à
// purger. Une copie sans instant (journée gardée avec les conversations avant ce lot) vaut 0 : ses
// photos de référence sont tenues pour périmées.
export function usableDayCopy(saved, { today, me = null } = {}) {
  const day = isObj(saved) ? saved.day : null;
  if (!isObj(day) || day.viewAs || !isObj(day.me) || saved.me !== String(day.me.id)) return null;
  if (saved.date !== today || day.date !== today) return null;
  if (me !== null && me !== undefined && String(me) !== saved.me) return null;
  return { day, at: Number.isFinite(saved.at) ? saved.at : 0 };
}
