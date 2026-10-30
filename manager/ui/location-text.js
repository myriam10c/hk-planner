// Textes de position (« qui est ou », plan 2026-10-29) communs a Today et a
// More > Where is everyone. Fonctions pures : la reponse du proxy (place, recordedAt)
// et l'heure courante entrent, du texte sort. Age recalcule ici depuis recordedAt,
// jamais ageMin : Today peut afficher une reponse en cache.
import { addDays, ddmm, dubaiTime, dubaiToday } from '/manager/ui/dom.js';

export const STALE_MIN = 30;          // au-dela : ligne grisee
export const FRESH_MAP_MIN = 12 * 60; // au-dela : hors du cadrage de la carte

// « At 1205 · Marina Gate » ou « 1.2 km from 1205 · Marina Gate » ; '' sans logement.
export function placeText(place) {
  if (!place || !place.label) return '';
  if (place.kind === 'at') return 'At ' + place.label;
  const m = Math.max(0, Number(place.distanceM) || 0);
  const d = m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
  return d + ' from ' + place.label;
}

// Minutes depuis la position (0 si dans le futur ou illisible).
export function ageMin(loc, nowMs) {
  const t = Date.parse(loc && loc.recordedAt);
  if (!isFinite(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 60000));
}

// « just now », « 4 min ago », « 2 h ago » (meme jour a Dubai), « yesterday 18:40 », « 27/10 18:40 ».
export function ageText(loc, nowMs) {
  const t = Date.parse(loc && loc.recordedAt);
  if (!isFinite(t)) return '';
  const min = ageMin(loc, nowMs);
  if (min < 1) return 'just now';
  if (min < 60) return min + ' min ago';
  const day = dubaiToday(t);
  const today = dubaiToday(nowMs);
  if (day === today) return Math.floor(min / 60) + ' h ago';
  const hm = dubaiTime(loc.recordedAt);
  if (day === addDays(today, -1)) return 'yesterday ' + hm;
  return ddmm(day) + ' ' + hm;
}

export function isStale(loc, nowMs) { return ageMin(loc, nowMs) > STALE_MIN; }

// Ligne courte : lieu et age, ou l'age seul sans logement connu.
export function locLine(loc, nowMs) {
  if (!loc) return '';
  return [placeText(loc.place), ageText(loc, nowMs)].filter(Boolean).join(' · ');
}

// Initiales (2 lettres au plus), meme regle que les pastilles de Today.
export function initialsOf(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

// Moment d'un evenement passe, heure de Dubai : « at 14:02 » (aujourd'hui),
// « yesterday 18:40 », « 27/10 18:40 ». '' si illisible.
export function whenText(iso, nowMs) {
  const t = Date.parse(iso);
  if (!isFinite(t)) return '';
  const hm = dubaiTime(iso);
  const day = dubaiToday(t);
  const today = dubaiToday(nowMs);
  if (day === today) return 'at ' + hm;
  if (day === addDays(today, -1)) return 'yesterday ' + hm;
  return ddmm(day) + ' ' + hm;
}

// Partage coupe par la personne (bouton Location OFF, offAt du proxy).
export function offText(offAt, nowMs) {
  const w = whenText(offAt, nowMs);
  return w ? 'Location turned off ' + w : '';
}

// Ligne de resultat du bouton « Ask them to turn it on » (mgr.locationNudge).
export function nudgeText(r) {
  if (!r) return '';
  if (r.ok === false && r.reason === 'quiet_hours') return 'Quiet hours (10 PM to 8:30 AM): try later.';
  const sent = Array.isArray(r.sent) ? r.sent : [];
  const off = Array.isArray(r.noPush) ? r.noPush : [];
  const parts = [];
  if (sent.length) parts.push('Sent to ' + sent.join(', ') + '.');
  if (off.length) parts.push('Notifications off: ' + off.join(', ') + '.');
  if (parts.length) return parts.join(' ');
  return Array.isArray(r.skipped) && r.skipped.length ? 'Everyone is already sharing.' : 'Nobody to ask.';
}
