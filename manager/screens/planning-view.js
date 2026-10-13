// Ecran Planning : HTML pur construit a partir de la reponse mgr.planning. Aucun
// appel reseau, aucun calcul de statut : le proxy les rend faits. Chaque panneau
// a la signature (d, j, ro, s) et s'appelle <vue>Sheet (planning.js les trouve
// par leur nom).
import { addDays, ddmm, dubaiTime, esc, I, placeLabel } from '/manager/ui/dom.js';
import {
  dayLong, dayShort, filterJobs, initials, jobsOn, LAUNDRY_ITEMS, laundryLine, namesOf, nextLine, slotOf, weekLabel,
} from '/manager/screens/planning-rules.js';

export const RO_LINE = 'Reconnect to make changes.';
export const CLOSE = '<button class="btn" type="button" data-close>Close</button>';
export function B(pa, label, cls) {
  return '<button class="btn' + (cls ? ' ' + cls : '') + '" type="button" data-pa="' + esc(pa) + '">' + esc(label) + '</button>';
}
export function head(title, sub) {
  return '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
export function roFoot() {
  return '<div class="sheet-f"><p class="ro-note" role="status">' + RO_LINE + '</p>' + CLOSE + '</div>';
}

function header(s) {
  const asof = s.data ? '<div class="asof' + (s.stale ? ' stale' : '') + '">Data as of ' + esc(dubaiTime(s.data.generatedAt)) + '</div>' : '';
  const add = s.data && !s.ro ? '<button class="btn sm primary" type="button" data-add-extra>Add extra</button>' : '';
  // Mode selection (assignation groupee) : jamais en lecture seule.
  // Nom stable : le libelle dit l'etat, sans aria-pressed (lu « Done selecting », jamais « Cancel, pressed »).
  const sel = s.data && !s.ro
    ? '<button class="btn sm" type="button" data-select>' + (s.sel ? 'Done selecting' : 'Select') + '</button>'
    : '';
  return '<header class="top pl-top"><div><h1>Planning</h1><div class="date">' + esc(weekLabel(s.start)) + '</div>' + asof + '</div>'
    + '<div class="pl-tools"><div class="pl-nav" role="group" aria-label="Week">'
    + '<button class="iconbtn" type="button" data-week="-1" aria-label="Previous week" title="Previous week">' + I.prev + '</button>'
    + '<button class="btn sm" type="button" data-week="0">This week</button>'
    + '<button class="iconbtn" type="button" data-week="1" aria-label="Next week" title="Next week">' + I.next + '</button></div>'
    + sel + add
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></div></header>';
}

function legend(s) {
  const d = s.data;
  const count = {};
  let none = 0;
  for (const j of d.jobs) {
    if (j.cancelled) continue;
    if (!j.assigned.length) none++;
    for (const id of j.assigned) count[id] = (count[id] || 0) + 1;
  }
  const cur = s.filter == null ? 'all' : String(s.filter);
  const chip = (val, label, n, slot) => '<button type="button" class="chip pchip" data-filter="' + esc(val) + '" aria-pressed="' + (cur === String(val) ? 'true' : 'false') + '">'
    + (slot ? '<i class="dot pc-' + esc(slot) + '" aria-hidden="true"></i>' : '') + esc(label) + ' <span class="n">' + n + '</span></button>';
  const people = d.people.filter((p) => p.assignable || count[p.id]);
  return '<div class="chiprow pl-legend" role="group" aria-label="Filter by person">'
    + chip('all', 'Everyone', d.counts.total, '')
    + people.map((p) => chip(p.id, p.name, count[p.id] || 0, p.slot)).join('')
    + chip('none', 'Unassigned', none, 'none') + '</div>';
}

// Heure dediee d'un extra (HH:MM ou null) ; absente chez un ancien proxy.
export function extraTime(j) { return j && j.extra && j.extra.cleaningTime ? j.extra.cleaningTime : null; }

function timeText(j) {
  if (j.kind === 'extra') return extraTime(j) ? extraTime(j) + ' · Extra' : 'Extra';
  if (j.postponedFrom) return 'From ' + ddmm(j.postponedFrom);
  return j.checkout || 'Time not set';
}

// Selectionnable pour l'assignation groupee : ni fait ni annule.
export function selectable(j) { return !!j && !j.cancelled && j.state !== 'done'; }

// Etat de selection d'une carte : rien hors mode selection.
function selAttr(j, s) {
  if (!s || !s.sel) return '';
  if (!selectable(j)) return ' aria-disabled="true"';
  return ' aria-pressed="' + (s.picked.has(j.key) ? 'true' : 'false') + '"';
}

function card(d, j, s) {
  const who = j.assigned.length ? namesOf(d, j.assigned) : 'Unassigned';
  const pill = j.tone === 'idle' && j.word === 'Scheduled' ? '' : '<span class="pill sm ' + esc(j.tone) + '">' + esc(j.word) + '</span>';
  const tags = [];
  if (j.next && j.next.sameDay && !j.cancelled) tags.push('Check-in ' + (j.next.time || 'today'));
  if (j.laundry) tags.push('Linen ' + j.laundry.total);
  return '<button type="button" class="pj pc-' + esc(slotOf(d, j)) + (j.kind === 'extra' ? ' extra' : '') + (j.cancelled ? ' cancelled' : '')
    + (s && s.sel ? (selectable(j) ? ' pj-sel' : ' pj-off') : '') + '" data-job="' + esc(j.key) + '"' + selAttr(j, s) + '>'
    + '<span class="pj-top"><span class="mono">' + esc(timeText(j)) + '</span>' + pill + '</span>'
    + '<span class="pj-place">' + esc(placeLabel(j) || 'Apartment') + '</span>'
    + '<span class="pj-who">' + esc(who) + '</span>'
    + (tags.length ? '<span class="pj-tags">' + tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</span>' : '')
    + '</button>';
}

function dayHead(d, day, today) {
  const jobs = jobsOn(d, day.date).filter((j) => !j.cancelled);
  const un = jobs.filter((j) => !j.assigned.length && j.state !== 'done').length;
  return '<div class="pl-dh' + (day.date === today ? ' today' : '') + '"><h2>' + esc(dayShort(day.date)) + '</h2>'
    + '<div class="meta">' + jobs.length + ' cleaning' + (jobs.length === 1 ? '' : 's')
    + (un ? ' · <span class="st bad">' + un + ' unassigned</span>' : '') + '</div>'
    + (day.holiday ? '<div class="pl-hol">' + esc(day.holiday) + '</div>' : '')
    + (day.off.length ? '<div class="pl-off">' + esc(namesOf(d, day.off)) + ' off</div>' : '') + '</div>';
}

function cards(d, list, s) {
  return '<div class="pl-cards">' + (list.length ? list.map((j) => card(d, j, s)).join('') : '<p class="empty">No cleaning</p>') + '</div>';
}

function grid(s) {
  const d = s.data;
  return '<div class="pl-grid">' + d.days.map((day) =>
    '<section class="pl-col" aria-label="' + esc(dayLong(day.date)) + '">' + dayHead(d, day, s.today)
    + cards(d, filterJobs(jobsOn(d, day.date), s.filter), s) + '</section>').join('') + '</div>';
}

function dayView(s) {
  const d = s.data;
  const strip = '<div class="pl-strip" role="group" aria-label="Day">' + d.days.map((day) => {
    const n = jobsOn(d, day.date).filter((j) => !j.cancelled).length;
    return '<button type="button" data-day="' + esc(day.date) + '" aria-pressed="' + (day.date === s.day ? 'true' : 'false') + '"'
      + (day.date === s.today ? ' class="today"' : '') + ' aria-label="' + esc(dayLong(day.date)) + ', ' + n + ' cleanings">'
      + '<span>' + esc(dayShort(day.date).split(' ')[0]) + '</span><b>' + Number(day.date.slice(8)) + '</b><small>' + n + '</small></button>';
  }).join('') + '</div>';
  const day = d.days.find((x) => x.date === s.day) || d.days[0];
  return strip + '<section class="pl-day" aria-label="' + esc(dayLong(day.date)) + '">' + dayHead(d, day, s.today)
    + cards(d, filterJobs(jobsOn(d, day.date), s.filter), s) + '</section>';
}

// Mode selection : lien « Select all unassigned » (le jour sur telephone, la semaine
// sur ordinateur) et barre du bas tant qu'au moins un menage est coche.
function selectRow(s) {
  if (!s.sel || s.ro) return '';
  return '<div class="pl-selrow"><p class="note">Tap cleanings to select them.</p>'
    + '<button class="btn sm" type="button" data-select-all>Select all unassigned</button></div>';
}
function bulkBar(s) {
  if (!s.sel || s.ro || !s.picked.size) return '';
  // Le compte annonce vit dans un noeud aria-live persistant (planning.js), pas ici.
  return '<div class="pl-bulk" role="region" aria-label="Selection"><span class="pl-bulk-n" aria-hidden="true">' + s.picked.size + ' selected</span>'
    + '<button class="btn primary" type="button" data-bulk="assign">Assign</button>'
    + '<button class="btn" type="button" data-bulk="clear">Clear</button></div>';
}

// s : { data, start, today, day, wide, filter, loading, error, banner, stale, ro, sel, picked }
export function screenHtml(s) {
  if (!s.data) {
    if (s.loading) return header(s) + '<p class="boot" role="status">Loading the week…</p>';
    return header(s) + '<div class="err-card" role="alert"><p>' + esc(s.error ? s.error.message : 'Could not load.')
      + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>';
  }
  return header(s) + (s.banner || '') + legend(s) + selectRow(s) + (s.wide ? grid(s) : dayView(s)) + bulkBar(s);
}

// Fiche d'un menage : statut, faits, gestes (branches par planning.js, taches 6 a 9).
export function jobSheet(d, j, ro, s) {
  const rows = [];
  const kv = (k, v) => rows.push('<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>');
  const time = j.kind === 'checkout' && !j.postponedFrom ? (j.checkout ? ', checkout ' + j.checkout : ', checkout time not set')
    : extraTime(j) ? ', at ' + extraTime(j) : '';
  kv('When', esc(dayLong(j.date) + time));
  if (j.postponedFrom) kv('Postponed', 'from ' + esc(dayLong(j.postponedFrom)));
  kv('Assigned', j.assigned.length ? esc(namesOf(d, j.assigned)) : '<span class="st bad">Nobody</span>');
  const day = d.days.find((x) => x.date === j.date);
  const away = day ? j.assigned.filter((id) => day.off.includes(id)) : [];
  if (away.length) kv('Leave', '<span class="st warn">' + esc(namesOf(d, away)) + ' on leave this day</span>');
  if (j.next) kv('Next guest', esc(nextLine(j.next)));
  if (j.guest) kv('Guest leaving', esc(j.guest));
  if (j.cancelled) kv('Cancelled', esc((j.cancelled.reason || 'No reason given') + (j.cancelled.by ? ' · by ' + j.cancelled.by : '')));
  if (j.extra) {
    kv('Extra', esc(j.extra.label || 'Extra cleaning'));
    if (j.extra.guestName) kv('Guest or client', esc(j.extra.guestName));
    if ((!s || s.manager !== false) && j.extra.priceBilled != null) kv('Price billed', esc(j.extra.priceBilled + ' AED'));
    if ((!s || s.manager !== false) && j.extra.cleanerPrice != null) kv('Cleaner rate', esc(j.extra.cleanerPrice + ' AED'));
    if (j.extra.notes) kv('Notes', esc(j.extra.notes));
  }
  kv('Linen', j.laundry ? esc(laundryLine(j.laundry)) : 'Not counted');
  if (j.listingId && (!s || s.manager !== false)) kv('Apartment', '<a class="aplink" href="#/more/apartment/' + encodeURIComponent(j.listingId) + '">Apartment sheet</a>');
  const status = '<div class="statusbox ' + esc(j.tone) + '"><span class="bar ' + esc(j.tone) + '"></span><div><span class="st ' + esc(j.tone) + '">' + esc(j.word) + '</span></div></div>';
  let foot;
  if (ro) foot = roFoot();
  else if (j.cancelled) foot = '<div class="sheet-f">' + B('restore', 'Restore cleaning', 'primary') + CLOSE + '</div>';
  else {
    const done = j.state === 'done';
    foot = '<div class="sheet-f">'
      + (done ? '' : B('assign', j.assigned.length ? 'Reassign' : 'Assign', 'primary'))
      + B(done ? 'undone' : 'done', done ? 'Undo done' : 'Mark done')
      + B('laundry', j.laundry ? 'Edit linen count' : 'Count linen')
      + (done ? '' : B('postpone', 'Postpone'))
      + (j.postponedFrom && !done ? B('restore-date', 'Restore date') : '')
      + (j.extra ? B('edit-extra', 'Edit extra') : '')
      + (done ? '' : B('cancel', 'Cancel cleaning'))
      + CLOSE + '</div>';
  }
  return head(placeLabel(j) || 'Cleaning', (j.kind === 'extra' ? 'Extra cleaning' : 'Checkout cleaning') + ' · ' + dayShort(j.date))
    + '<div class="sheet-b">' + status + '<dl class="kvs">' + rows.join('') + '</dl></div>' + foot;
}

// Choix des personnes (plusieurs possibles) : Save remplace la liste.
// Une personne en conge ce jour-la est grisee, sauf si deja assignee (on peut la retirer).
export function assignSheet(d, j, ro, s) {
  if (ro) return head('Assign', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  const day = d.days.find((x) => x.date === j.date);
  const off = new Set(day ? day.off : []);
  const n = {};
  for (const x of jobsOn(d, j.date)) if (!x.cancelled) for (const id of x.assigned) n[id] = (n[id] || 0) + 1;
  const opts = d.people.filter((p) => p.assignable).map((p) => {
    const on = s.pick.has(p.id);
    const locked = off.has(p.id) && !on;
    const k = n[p.id] || 0;
    const sub = off.has(p.id) ? 'On leave' : k + ' job' + (k === 1 ? '' : 's') + ' that day';
    return '<button type="button" data-pa="toggle" data-id="' + p.id + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
      + (locked ? ' disabled data-off' : '') + '>'
      + '<span class="av pc-' + esc(p.slot) + '" aria-hidden="true">' + esc(initials(p.name)) + '</span>'
      + '<span><b>' + esc(p.name) + '</b><small>' + esc(sub) + '</small></span></button>';
  }).join('');
  return head('Assign', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p class="note">Pick one or more people, then Save.</p><div class="pick">' + opts + '</div></div>'
    + '<div class="sheet-f">' + B('save-assign', 'Save', 'primary') + (j.assigned.length ? B('clear-assign', 'Clear all') : '') + B('back', 'Back') + '</div>';
}

// Assignation groupee : un toucher sur une personne assigne tous les menages coches.
// Une personne en conge l'un des jours coches est grisee avec le premier de ces jours.
// Tous les menages sur un meme jour : compte de ce jour-la ; sinon compte de la semaine.
export function bulkSheet(d, jobs, ro) {
  const n = jobs.length;
  const title = 'Assign ' + n + ' cleaning' + (n === 1 ? '' : 's');
  if (ro) return head(title, weekLabel(d.start)) + '<div class="sheet-b"></div>' + roFoot();
  const dates = [...new Set(jobs.map((j) => j.date))].sort();
  const oneDay = dates.length === 1 ? dates[0] : null;
  const count = {};
  for (const x of d.jobs) {
    if (x.cancelled || (oneDay && x.date !== oneDay)) continue;
    for (const id of x.assigned) count[id] = (count[id] || 0) + 1;
  }
  const opts = d.people.filter((p) => p.assignable).map((p) => {
    const offDay = dates.find((date) => { const day = d.days.find((x) => x.date === date); return !!day && day.off.includes(p.id); });
    const k = count[p.id] || 0;
    const sub = offDay ? 'On leave ' + dayShort(offDay) : k + ' job' + (k === 1 ? '' : 's') + (oneDay ? ' that day' : ' this week');
    return '<button type="button" data-pa="bulk-pick" data-id="' + p.id + '"' + (offDay ? ' disabled data-off' : '') + '>'
      + '<span class="av pc-' + esc(p.slot) + '" aria-hidden="true">' + esc(initials(p.name)) + '</span>'
      + '<span><b>' + esc(p.name) + '</b><small>' + esc(sub) + '</small></span></button>';
  }).join('');
  const days = dates.map((x) => dayShort(x)).join(', ');
  const taken = jobs.filter((j) => j.assigned.length).length;
  const warn = taken ? '<p class="sheet-warn" role="note">Replaces the current cleaner on ' + taken + ' cleaning' + (taken === 1 ? '' : 's') + '.</p>' : '';
  return head(title, days)
    + '<div class="sheet-b"><p class="note">Tap a person to assign all selected cleanings to them.</p>' + warn
    + '<p class="pl-prog" role="status" id="bulkProg"></p><div class="pick">' + opts + '</div></div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-close>Cancel</button></div>';
}

export function cancelSheet(d, j, ro) {
  if (ro) return head('Cancel cleaning', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  return head('Cancel this cleaning?', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p>The cleaning stays on the planning, struck through, and can be restored.</p>'
    + '<label class="fl">Reason (optional)<input id="pReason" type="text" maxlength="200" autocomplete="off"></label></div>'
    + '<div class="sheet-f">' + B('confirm-cancel', 'Confirm cancel', 'primary') + B('back', 'Back') + '</div>';
}

// Report d'un jour (19 reports sur 19 depuis juillet etaient d'un jour).
export function postponeSheet(d, j, ro) {
  if (ro) return head('Postpone', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  const to = addDays(j.date, 1);
  let warn = '';
  if (j.next && j.next.date <= to) {
    const when = dayShort(j.next.date) + (j.next.time ? ' at ' + j.next.time : '');
    warn = '<p class="sheet-warn" role="status">Next guest checks in ' + esc(when)
      + (j.next.date < to ? ', before the new date.' : '. The cleaning must be done before.') + '</p>';
  }
  return head('Postpone this cleaning?', placeLabel(j))
    + '<div class="sheet-b"><p>Move from <b>' + esc(dayShort(j.date)) + '</b> to <b>' + esc(dayShort(to))
    + '</b>. Assignment and linen stay with the cleaning.</p>' + warn + '</div>'
    + '<div class="sheet-f">' + B('confirm-postpone', 'Move to ' + dayShort(to), 'primary') + B('back', 'Back') + '</div>';
}

// Linge ramasse : sept champs, tous obligatoires (0 quand il n'y en a pas).
export function laundrySheet(d, j, ro) {
  const v = j.laundry || {};
  const rows = LAUNDRY_ITEMS.map((it) => {
    const val = v[it.key] != null ? String(v[it.key]) : '';
    return '<div class="lq-row"><label for="lq_' + it.key + '">' + esc(it.label) + '</label>'
      + '<button type="button" class="iconbtn" data-pa="lq-step" data-field="' + it.key + '" data-d="-1" aria-label="Less ' + esc(it.label) + '">&minus;</button>'
      + '<input id="lq_' + it.key + '" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="' + esc(val) + '">'
      + '<button type="button" class="iconbtn" data-pa="lq-step" data-field="' + it.key + '" data-d="1" aria-label="More ' + esc(it.label) + '">+</button></div>';
  }).join('');
  const foot = ro ? roFoot() : '<div class="sheet-f">' + B('save-laundry', j.laundry ? 'Save changes' : 'Save count', 'primary') + B('back', 'Back') + '</div>';
  return head('Linen collected', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p class="note">Every field is needed. Type 0 when there is none.</p><div class="lq">' + rows + '</div></div>' + foot;
}

// Memes types que la fiche de l'ancienne app.
const EXTRA_TYPES = ['Mid-stay', 'Owner turnover', 'Deep clean', 'Post-construction', 'Other'];

// Creation (j null) ou modification d'un menage en plus. L'assignation d'un extra
// existant passe par Assign, comme tout menage.
export function extraSheet(d, j, ro, s) {
  const x = j && j.extra ? j.extra : null;
  // Prix caches selon le ROLE (maintenance), jamais selon les donnees : un manager voit toujours les deux champs.
  const noPrices = !!s && s.manager === false;
  const f = x
    ? { listing: j.listingId, date: x.cleaningDate, time: x.cleaningTime || '', label: x.label || '', guest: x.guestName || '',
      price: x.priceBilled == null ? '' : String(x.priceBilled), rate: x.cleanerPrice == null ? '' : String(x.cleanerPrice), notes: x.notes || '' }
    : { listing: '', date: d.today >= d.start && d.today <= d.end ? d.today : d.start, time: '', label: '', guest: '', price: '', rate: '', notes: '' };
  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>';
  const listings = opt('', 'Choose an apartment', f.listing) + d.listings.map((l) => opt(l.id, placeLabel(l) || l.id, f.listing)).join('');
  const types = opt('', 'Choose a type', f.label) + EXTRA_TYPES.map((t) => opt(t, t, f.label)).join('')
    + (f.label && !EXTRA_TYPES.includes(f.label) ? opt(f.label, f.label, f.label) : '');
  const who = x ? '' : '<label class="fl">Assign to<select id="xWho">' + opt('', 'Nobody yet', '')
    + d.people.filter((p) => p.assignable).map((p) => opt(String(p.id), p.name, '')).join('') + '</select></label>';
  const body = '<div class="sheet-b"><div class="form">'
    + '<label class="fl">Apartment<select id="xListing">' + listings + '</select></label>'
    + '<div class="pl-two"><label class="fl">Date<input id="xDate" type="date" value="' + esc(f.date) + '"></label>'
    + '<label class="fl">Time (optional)<input id="xTime" type="time" value="' + esc(f.time) + '"></label></div>'
    + '<label class="fl">Type<select id="xLabel">' + types + '</select></label>'
    + '<label class="fl">Guest or client<input id="xGuest" type="text" maxlength="120" autocomplete="off" value="' + esc(f.guest) + '"></label>'
    + (noPrices ? '' : '<label class="fl">Price billed (AED)<input id="xPrice" type="number" inputmode="decimal" min="0" step="1" value="' + esc(f.price) + '"></label>'
      + '<label class="fl">Cleaner rate (AED, optional)<input id="xRate" type="number" inputmode="decimal" min="0" step="1" value="' + esc(f.rate) + '"></label>')
    + who
    + '<label class="fl">Notes<textarea id="xNotes" rows="2" maxlength="500">' + esc(f.notes) + '</textarea></label>'
    + '</div></div>';
  let foot;
  if (ro) foot = roFoot();
  else if (x) foot = '<div class="sheet-f">' + B('x-save', 'Save', 'primary') + B('x-delete', 'Delete') + B('back', 'Back') + '</div>';
  else foot = '<div class="sheet-f">' + B('x-save', 'Create extra', 'primary') + '<button class="btn" type="button" data-close>Cancel</button></div>';
  return head(x ? 'Edit extra cleaning' : 'Add an extra cleaning', x ? placeLabel(j) : weekLabel(d.start)) + body + foot;
}

export function deleteSheet(d, j, ro) {
  if (ro) return head('Delete extra', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  return head('Delete this extra cleaning?', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p>The extra cleaning, its assignment and its done state are removed. This cannot be undone.</p></div>'
    + '<div class="sheet-f">' + B('x-delete-confirm', 'Delete extra', 'primary') + B('back', 'Back') + '</div>';
}
