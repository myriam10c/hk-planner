// Modele de l'ecran Assign (lot 4b, spec-quick-assign section 3) : pur, sans DOM ni
// horloge. Fusionne les semaines mgr.planning, donne la bande des jours, les personnes
// affectables d'un jour, les lignes de menage par groupe et le geste assignCleaner a
// envoyer (add ou remove, avec la liste vue a l'ecran dans expect_ids). Aucun statut
// recalcule : slot et conges (days[].off) viennent du proxy tels quels. Seul import
// permis : countNone, pour que la bande compte comme celle de Today.
import { countNone } from './today-model.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const GROUPS = ['todo', 'assigned', 'elite'];

// Copies locales de dom.js et de planning-rules.js (addDays, dayShort, initials, ddmm,
// placeLabel) : ces fichiers importent un chemin absolu que node ne sait pas charger.
const utc = (day) => new Date(day + 'T00:00:00Z');
function addDays(day, n) { const d = utc(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dayShort(day) { const d = utc(day); return WD[d.getUTCDay()] + ' ' + d.getUTCDate(); }
function initials(n) { return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase(); }
function ddmm(day) { return day ? day.slice(8, 10) + '/' + day.slice(5, 7) : ''; }
function placeLabel(j) { return [j.apt ? 'Apt ' + j.apt : '', j.bld].filter(Boolean).join(' · '); }
const sortIds = (ids) => (ids || []).map(Number).sort((a, b) => a - b);
const stripOf = (today) => Array.from({ length: 7 }, (_, i) => addDays(today, i));
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

// Semaines mgr.planning (null = non chargee) en une seule : menages par cle, jours par
// date, personnes par id, la derniere lecture l'emporte ; today vient de la premiere.
export function mergeWeeks(weeks) {
  const live = (weeks || []).filter(Boolean);
  const days = new Map();
  const jobs = new Map();
  const people = new Map();
  for (const w of live) {
    for (const d of w.days || []) days.set(d.date, d);
    for (const j of w.jobs || []) jobs.set(j.key, j);
    for (const p of w.people || []) people.set(p.id, p);
  }
  return { today: live.length ? live[0].today : null, days: [...days.values()], jobs: [...jobs.values()], people: [...people.values()] };
}

// Bande des 7 jours depuis today ; count (meme compte que Today) null quand la semaine
// de ce jour n'est pas chargee.
export function stripDays(merged, today) {
  const loaded = new Set(merged.days.map((d) => d.date));
  return stripOf(today).map((date) => ({
    date, label: WD[utc(date).getUTCDay()], num: utc(date).getUTCDate(),
    count: loaded.has(date) ? countNone(merged, date) : null,
  }));
}

// Jour d'arrivee : wanted s'il est dans la bande, sauf aujourd'hui quand la bande n'y compte
// rien (le lien de Today porte toujours le jour selectionne) ; sinon le premier jour que la
// bande compte (countNone : un menage attendu chez Elite, « Not logged yet », n'y est pas),
// sinon today.
export function firstDay(merged, today, wanted) {
  const days = stripOf(today);
  const open = (d) => countNone(merged, d) > 0;
  if (wanted && days.includes(wanted) && (wanted !== today || open(today))) return wanted;
  return days.find(open) || today;
}

// Initiales distinctes : celles du nom ; deux personnes affectables ou plus sur les memes (Aisha
// et Annet : A) prennent les deux premieres lettres de leur prenom (Ai, An). Le sous-traitant
// garde les siennes (EC).
function distinctInitials(list) {
  const base = list.map((p) => initials(p.name));
  return list.map((p, i) => {
    if (p.role === 'subcontractor' || base.indexOf(base[i]) === base.lastIndexOf(base[i])) return base[i];
    const first = String(p.name || '').trim().split(/\s+/)[0] || '?';
    return first.charAt(0).toUpperCase() + first.charAt(1).toLowerCase();
  });
}

// Personnes affectables d'un jour : cleaners par nom, puis le sous-traitant. off : conge
// ou repos du jour (days[].off du proxy) ; load : menages non annules du jour sur elle.
export function peopleOn(merged, date) {
  const day = merged.days.find((d) => d.date === date);
  const off = (day && day.off) || [];
  const jobs = merged.jobs.filter((j) => j.date === date && !j.cancelled);
  const team = merged.people.filter((p) => p.assignable);
  const list = team.filter((p) => p.role === 'cleaner').sort(byName)
    .concat(team.filter((p) => p.role === 'subcontractor').sort(byName));
  const ini = distinctInitials(list);
  return list.map((p, i) => ({
    id: p.id, name: p.name, ini: ini[i], slot: p.slot, off: off.includes(p.id),
    load: jobs.filter((j) => (j.assigned || []).includes(p.id)).length,
  }));
}

// Seconde ligne d'un menage : depart (ou report, ou libelle de l'extra, suivi de son heure
// dediee quand il en a une), puis le guest suivant (Guest arrives first : il arrive avant ce
// menage reporte). mgr.planning ne cherche jamais le guest suivant d'un extra : rien a en dire.
export function rowLine(job) {
  const extra = job.kind === 'extra';
  const x = job.extra || {};
  const out = job.checkout ? 'Out ' + job.checkout
    : job.postponedFrom ? 'Postponed from ' + ddmm(job.postponedFrom)
      : extra ? (x.label || 'Extra cleaning') + (x.cleaningTime ? ' at ' + x.cleaningTime : '')
        : 'Out time not set';
  const n = job.next;
  const next = !n ? (extra ? '' : 'No next guest')
    : n.before ? 'Guest arrives first'
      : n.sameDay ? (n.time ? 'Guest arrives ' + n.time : 'Guest arrives the same day')
        : 'Next guest ' + dayShort(n.date);
  return [out, next].filter(Boolean).join(' · ');
}

// Guest arrive avant le menage reporte d'abord, puis arrivee le jour meme, puis heure (depart,
// ou heure dediee d'un extra, comme le tri du proxy ; sans heure en dernier), puis numero
// d'appartement (1602 apres 99), puis cle.
const urgency = (j) => (!j.next ? 2 : j.next.before ? 0 : j.next.sameDay ? 1 : 2);
const timeOf = (j) => j.checkout || (j.extra && j.extra.cleaningTime) || null;
function order(a, b) {
  return urgency(a) - urgency(b)
    || Number(timeOf(a) == null) - Number(timeOf(b) == null)
    || String(timeOf(a) || '').localeCompare(String(timeOf(b) || ''))
    || String(a.apt || '').localeCompare(String(b.apt || ''), 'en', { numeric: true })
    || String(a.key).localeCompare(String(b.key));
}

// Lignes d'un jour, hors annules et faits : assigned si quelqu'un est dessus, sinon elite si
// le logement part d'habitude chez Elite, sinon todo. Une cle de pinned (ligne touchee pendant
// la visite) garde son groupe : rien ne bouge sous le doigt.
export function buildRows(merged, date, pinned) {
  const out = { todo: [], assigned: [], elite: [] };
  const jobs = merged.jobs.filter((j) => j.date === date && !j.cancelled && j.state !== 'done').sort(order);
  for (const j of jobs) {
    const ids = (j.assigned || []).slice();
    const pin = pinned && pinned.get(j.key);
    const group = GROUPS.includes(pin) ? pin : ids.length ? 'assigned' : j.usuallyElite ? 'elite' : 'todo';
    out[group].push({
      key: j.key, place: placeLabel(j), line: rowLine(j), ids,
      serviceType: j.serviceType == null ? null : j.serviceType, group,
    });
  }
  return out;
}

// Geste d'un toucher sur l'initiale de id : remove s'il est sur le menage, sinon add (avec le
// type de service du menage quand il est connu). expect_ids : la liste vue a l'ecran, triee ;
// after : la liste apres l'ecriture ; undo : le geste inverse, attendu sur after.
export function toggleOp(row, id) {
  const n = Number(id);
  const before = sortIds(row.ids);
  const has = before.includes(n);
  const after = has ? before.filter((x) => x !== n) : sortIds(before.concat(n));
  const body = (mode, expect) => {
    const b = { reservation_key: row.key, cleaner_id: n, mode, expect_ids: expect.slice() };
    if (mode === 'add' && row.serviceType != null) b.service_type = row.serviceType;
    return b;
  };
  return has
    ? { body: body('remove', before), after, undo: body('add', after) }
    : { body: body('add', before), after, undo: body('remove', after) };
}
