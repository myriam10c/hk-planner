// Regles d'affichage du Planning : pures, sans DOM ni reseau. Les statuts et les
// couleurs viennent du proxy (mgr.planning) ; ici seulement dates, noms, filtres
// et lecture du formulaire de linge.
import { addDays } from '/manager/ui/dom.js';

// Memes libelles que la fiche linge de l'ancienne app (colonnes de laundry_counts).
export const LAUNDRY_ITEMS = [
  { key: 'pillowcases', label: 'Pillowcases' },
  { key: 'bed_sheets', label: 'Bed sheets (queen and twin)' },
  { key: 'duvet_covers', label: 'Duvet covers (queen and twin)' },
  { key: 'small_towels', label: 'Hand towels' },
  { key: 'face_towels', label: 'Face towels (square)' },
  { key: 'large_towels', label: 'Bath towels' },
  { key: 'bath_mats', label: 'Bath mats' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const utc = (day) => new Date(day + 'T00:00:00Z');

export function weekStartOf(day) { return addDays(day, -((utc(day).getUTCDay() + 6) % 7)); }
export function dayShort(day) { const d = utc(day); return DAY_NAMES[d.getUTCDay()] + ' ' + d.getUTCDate(); }
export function dayLong(day) { const d = utc(day); return DAY_LONG[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS_LONG[d.getUTCMonth()]; }
// « 5 to 11 Oct 2026 », « 28 Sep to 4 Oct 2026 ».
export function weekLabel(start) {
  const a = utc(start), b = utc(addDays(start, 6));
  const left = a.getUTCMonth() === b.getUTCMonth() ? String(a.getUTCDate()) : a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()];
  return left + ' to ' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
}
export function defaultDay(start, today) { return today >= start && today <= addDays(start, 6) ? today : start; }

export function jobsOn(data, day) { return data.jobs.filter((j) => j.date === day); }
export function personOf(data, id) { return data.people.find((p) => p.id === Number(id)) || null; }
export function nameOf(data, id) { const p = personOf(data, id); return p ? p.name : 'Member ' + id; }
export function namesOf(data, ids) {
  const n = (ids || []).map((id) => nameOf(data, id));
  return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
// Couleur d'une carte : celle de la premiere personne assignee ; rouge si personne.
export function slotOf(data, job) {
  if (!job.assigned.length) return 'none';
  const p = personOf(data, job.assigned[0]);
  return p ? p.slot : 'other';
}
// filtre : null ou 'all' = tout ; 'none' = sans personne (hors annules) ; sinon l'id d'une personne.
export function filterJobs(jobs, filter) {
  if (filter == null || filter === 'all') return jobs;
  if (filter === 'none') return jobs.filter((j) => !j.cancelled && !j.assigned.length);
  return jobs.filter((j) => j.assigned.includes(Number(filter)));
}
export function initials(n) {
  return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// Sept champs obligatoires : un champ vide n'est pas un zero (meme regle que l'ancienne fiche).
export function laundryParse(values) {
  const out = {};
  for (const it of LAUNDRY_ITEMS) {
    const raw = values ? values[it.key] : undefined;
    if (raw === null || raw === undefined || String(raw).trim() === '') return { ok: false, field: it.key, label: it.label };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 999) return { ok: false, field: it.key, label: it.label };
    out[it.key] = n;
  }
  return { ok: true, values: out };
}

export function nextLine(n) {
  const at = n.time ? ' at ' + n.time : ', time not set';
  if (n.before) return 'Checks in ' + dayShort(n.date) + at + ', before this cleaning';
  if (n.sameDay) return 'Same-day check-in' + at;
  return 'Checks in ' + dayShort(n.date) + at;
}
export function laundryLine(l) {
  const parts = LAUNDRY_ITEMS.filter((it) => Number(l[it.key]) > 0).map((it) => it.label + ' ' + l[it.key]);
  return parts.length ? parts.join(', ') + '. Total ' + l.total + '.' : 'Counted, nothing collected.';
}
