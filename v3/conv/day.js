// Adaptateur v3.myDay -> appartements de la conversation (pur, testable sous Node).
// Un appartement = un stop de la journee reelle. Le contrat des appartements est
// celui du prototype (num, building, area, type, rooms, guest, photo, roomPhotos,
// managerCheck, lead, usualMinutes), plus id, listingId, openTickets, state,
// startedAt pour la liste et les ecritures de la tache 5.

// Dubai : UTC+4 toute l'annee, sans heure d'ete.
const DUBAI_MS = 4 * 3600 * 1000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = n => String(n).padStart(2, "0");

// Date du jour a Dubai, « 2026-10-02 ».
export function dubaiDate(now) {
  return new Date(now.getTime() + DUBAI_MS).toISOString().slice(0, 10);
}

// Heure de Dubai « HH:MM » d'un instant ISO, ou null.
export function dubaiHHMM(iso) {
  const t = Date.parse(String(iso || ""));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + DUBAI_MS);
  return two(d.getUTCHours()) + ":" + two(d.getUTCMinutes());
}

// « 3 PM », « 3:30 PM », « 12 PM ».
function twelve(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (m ? ":" + two(m) : "") + " " + suffix;
}

// Heure dediee d'un extra (stops[].time « HH:MM ») en « 2 PM » ; null sans heure,
// heure invalide ou ancien proxy (champ absent).
export function extraAt(time) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || "")) ? twelve(time) : null;
}

function dayAfter(iso) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function shortDay(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
}

// Jour court d'un signalement : « today » ou « Sat 10 » (jour de Dubai YYYY-MM-DD).
export function dayWord(iso, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  if (iso === dubaiDate(now)) return "today";
  const d = new Date(iso + "T00:00:00Z");
  return DAYS[d.getUTCDay()] + " " + d.getUTCDate();
}

// Prochain voyageur : libelle de la liste, texte du rapport, heures restantes.
// Sans heure connue, l'arrivee compte au debut du jour (avertissement prudent).
export function guestOf(stop, now) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(stop.nextArrivalDate || "")) ? stop.nextArrivalDate : null;
  if (!date) return { label: "No guest yet", next: "none booked yet", hoursAway: null };
  const time = /^\d{2}:\d{2}$/.test(String(stop.nextArrivalTime || "")) ? stop.nextArrivalTime : null;
  const today = dubaiDate(now);
  const when = date === today ? "today" : date === dayAfter(today) ? "tomorrow" : shortDay(date);
  const at = time ? twelve(time) : null;
  let label;
  if (date === today) label = at ? "Guest at " + at : "Guest today";
  else if (when === "tomorrow") label = "Guest tomorrow" + (at ? " " + at : "");
  else label = "Guest on " + when;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time ? time.split(":").map(Number) : [0, 0];
  const arrival = Date.UTC(y, mo - 1, d, h, mi) - DUBAI_MS;
  const hoursAway = Math.round((arrival - now.getTime()) / 360000) / 10;
  return { label, next: when + (at ? " " + at : ""), hoursAway };
}

// « 3207 - Sobha Waves » -> 3207 / Sobha Waves ; « 704 Golf Links » -> 704 / Golf Links.
// Le numero est le premier mot s'il contient un chiffre ; a defaut, numero vide et
// immeuble = le nom entier (jamais d'identifiant de listing).
// Séparateurs vus dans listing_config.internal_name : « - », « | », « : », « , », « · ».
// Un suffixe « -B » colle au numero (« 510-B Cloud by Tiger ») fait partie du numero.
// Bruit retire de l'immeuble : « V2 - ok », « V2 », « (NEW) », « / » final, espaces en trop.
function cleanBuilding(b) {
  let s = String(b || "").replace(/\s+/g, " ").trim();
  let prev;
  do {
    prev = s;
    s = s.replace(/\s*\/+$/, "").replace(/\s*\(\s*new\s*\)$/i, "").replace(/\s+V2(\s*-\s*ok)?$/i, "").trim();
  } while (s !== prev);
  return s;
}

export function splitName(name) {
  const s = String(name || "").replace(/\s+/g, " ").trim();
  const m = s.match(/^([A-Za-z]{0,2}\d\w*(?:-[A-Za-z](?=[\s|]))?)\s*(?:[-\u2013:,·|]\s*)?(\S.*)$/);
  if (m) {
    const building = cleanBuilding(m[2]);
    if (building) return { num: m[1], building };
  }
  return { num: "", building: cleanBuilding(s) || "Apartment" };
}

const PEST = { text: "Pest control was asked. Do you see insects?", ok: "No insects", see: "I see insects", kind: "Insects", reportLabel: "Insects seen" };

// Personne qui a demarre le menage avant moi. Regle du serveur (jobRole) : v3.myDay
// rend role / leadId / myStartedAt calcules par la meme fonction que v3.finishJob
// (roleFromStarts), le telephone suit donc le serveur apres un rechargement.
// Role absent (lecture ratee cote serveur) : repli sur othersOnJob, la premiere des
// autres si elle a demarre et que je n'ai pas demarre avant elle.
function leadOf(stop, meId) {
  const others = (stop.othersOnJob || []).filter(x => String(x.id) !== meId);
  // roomsDone : la journee ne dit pas encore quelles pieces la premiere a faites.
  const asLead = o => ({ id: o.id, name: String(o.name || "Teammate"), startedAt: dubaiHHMM(o.startedAt) || "--:--", roomsDone: [] });
  if (stop.role === "lead") return null;
  if (stop.role === "helper") {
    const o = others.find(x => String(x.id) === String(stop.leadId));
    return asLead(o || { id: stop.leadId, name: "Teammate", startedAt: null });
  }
  const o = others[0];
  if (!o || !o.startedAt) return null;
  if (stop.myStartedAt && Date.parse(stop.myStartedAt) <= Date.parse(o.startedAt)) return null;
  return asLead(o);
}

// Une URL de reference connue est gardee 8 h au plus. La signature du proxy dure 16 h
// (V3_REFERENCE_URL_SECONDS) : a 8 h, il en reste 8 devant soi, et on en prend une neuve.
export const REFERENCE_KEEP_MS = 8 * 3600e3;

// Meme fichier = meme origine et meme chemin, la query (jeton de signature) ignoree.
function memeFichier(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch (e) { return false; }
}

// Rafraichit les photos de reference d'un appartement depuis le meme appartement de la journee
// relue. Chaque signature produit un jeton neuf : remplacer une URL qui designe le meme fichier
// ferait retelecharger l'image (le cache est indexe sur l'URL complete). Par piece : meme fichier et
// URL connue obtenue il y a moins de REFERENCE_KEEP_MS : on garde l'URL connue et son instant ;
// sinon (autre fichier, connue trop vieille ou sans instant) on prend la nouvelle, instant present.
// Une piece que la journee relue ne rend plus est retiree. Journee relue sans cet appartement, ou
// references inconnues (le serveur n'a pas pu lire ou signer) : rien ne change. Rend true si la
// liste a ete recalculee.
export function refreshRoomPhotos(apt, fresh, { now = Date.now() } = {}) {
  if (!apt || !fresh || fresh.roomPhotosUnknown || !fresh.roomPhotos || typeof fresh.roomPhotos !== "object") return false;
  const known = apt.roomPhotos || {}, knownAt = apt.roomPhotosAt || {};
  const photos = {}, at = {};
  for (const [room, url] of Object.entries(fresh.roomPhotos)) {
    const t = knownAt[room];
    if (known[room] && Number.isFinite(t) && now - t < REFERENCE_KEEP_MS && memeFichier(known[room], url)) {
      photos[room] = known[room]; at[room] = t;
    } else {
      photos[room] = url; at[room] = now;
    }
  }
  apt.roomPhotos = photos;
  apt.roomPhotosAt = at;
  return true;
}

export function toApartments(payload, me, { now = new Date() } = {}) {
  const stops = (payload && Array.isArray(payload.stops)) ? payload.stops : [];
  const meId = me && me.id !== undefined ? String(me.id) : null;
  return stops.map(s => {
    const { num, building } = splitName(s.listingName);
    const tickets = Array.isArray(s.openTickets) ? s.openTickets : [];
    // Un ticket pest deja verifie (to_confirm) attend le technicien : plus de question.
    const pest = tickets.find(t => t.category === "pest" && t.status !== "to_confirm");
    return {
      id: s.jobId,
      listingId: s.listingId,
      num, building, area: "",
      type: s.unitType || "Studio",
      rooms: Array.isArray(s.rooms) && s.rooms.length ? s.rooms.slice() : ["Bed", "Bathroom", "Kitchen"],
      usualMinutes: Number(s.estimatedMinutes) || 0,
      guest: guestOf(s, now),
      extraAt: extraAt(s.time),
      photo: s.heroPhotoUrl || null,
      roomPhotos: s.references && typeof s.references === "object" ? { ...s.references } : {},
      // Instant d'obtention de chaque URL (refreshRoomPhotos) ; null = le serveur n'a pas pu lire ou
      // signer les photos : une relecture garde alors la liste connue.
      roomPhotosAt: Object.fromEntries(Object.keys(s.references && typeof s.references === "object" ? s.references : {}).map(r => [r, now.getTime()])),
      roomPhotosUnknown: s.references === null,
      managerCheck: pest ? { ...PEST, ticketId: pest.id } : null,
      openTickets: tickets,
      lead: leadOf(s, meId),
      role: s.role === "lead" || s.role === "helper" ? s.role : null,
      state: s.state || "todo",
      startedAt: s.startedAt || null,
    };
  });
}
