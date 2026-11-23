// Ecran Today (lot 4a, direction Tiimo validee le 20/11/2026) : HTML pur. La journee du
// jour des donnees vient du modele (today-model.js), rangee par heure d'arrivee des guests ;
// un autre jour de la bande, du meme modele (buildAhead, donnees mgr.planning).
// Aucun appel reseau ici, aucun statut recalcule : tone, word et cause viennent du proxy.
import { addDays, dubaiTime, dubaiToday, esc, I, placeLabel } from '/manager/ui/dom.js';
import { photosBlk } from '/manager/ui/job-photos.js';
import { isStale, locLine } from '/manager/ui/location-text.js';
import { emptyLine, momentLabel, sentence } from '/manager/screens/today-model.js';
import { dayShort } from '/manager/screens/planning-rules.js';

export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : '') : r + ' min';
}
export function arrivalMs(day, time) { return Date.parse(day + 'T' + time + ':00+04:00'); }
function ddmm(day) { return day ? day.slice(8, 10) + '/' + day.slice(5, 7) : ''; }
function fmtDay(day, o) { return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' }); }
function initials(n) {
  return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
function nameOf(data, id) {
  const p = data.assignable.find((x) => x.id === id) || data.who.people.find((x) => x.id === id);
  return p ? p.name : 'Member ' + id;
}
function listNames(n) { return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]; }
function namesOf(data, ids) { return listNames(ids.map((id) => nameOf(data, id))); }
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

// Actions reelles (assignCleaner, setDone) : branchees dans today.js.
const RO_LINE = 'Reconnect to make changes.';
function actionsFoot(key, assigned, done, ro) {
  if (ro) return '<div class="sheet-f"><p class="ro-note" role="status">' + RO_LINE + '</p><button class="btn" type="button" data-close>Close</button></div>';
  return '<div class="sheet-f"><button class="btn primary" type="button" data-assign="' + esc(key) + '">' + (assigned.length ? 'Reassign' : 'Assign cleaner') + '</button>'
    + '<button class="btn" type="button" data-done="' + esc(key) + '" data-val="' + (done ? '0' : '1') + '">' + (done ? 'Undo done' : 'Mark done') + '</button>'
    + '<button class="btn" type="button" data-close>Close</button></div>';
}

// ---------- Pictogrammes (classes td- seulement : la liste n'emprunte rien aux autres ecrans) ----------
const DONE = '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-fl-ok" cx="14" cy="14" r="13"/><path class="td-ln-onok" d="M8.6 14.6l3.5 3.5 7.3-7.9"/></svg>';
const BAD = '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-fl-bad" cx="14" cy="14" r="13"/><path class="td-ln-onbad" d="M14 7.6v7.6"/><circle class="td-fl-onbad" cx="14" cy="19.8" r="1.7"/></svg>';
const SVG = {
  // first : menage d'un autre jour qui passe apres l'arrivee du guest (meme pictogramme que bloque).
  blocked: BAD, first: BAD,
  risk: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-rg-warn" cx="14" cy="14" r="11.5"/><path class="td-ln-warn" d="M14 8.4v6.6"/><circle class="td-fl-warn" cx="14" cy="19.4" r="1.6"/></svg>',
  none: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-rg-dash" cx="14" cy="14" r="11.5" stroke-dasharray="3.6 3.6"/></svg>',
  elite: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-rg-wdash" cx="14" cy="14" r="11.5" stroke-dasharray="3.6 3.6"/></svg>',
  prog: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-rg-ink" cx="14" cy="14" r="11.5"/><circle class="td-fl-ink" cx="14" cy="14" r="4.6"/></svg>',
  todo: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-rg-ring" cx="14" cy="14" r="11.5"/></svg>',
  planned: '<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="td-fl-ring" cx="14" cy="14" r="12"/></svg>',
  ready: DONE, done: DONE,
};
const PLUS = '<svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" stroke-dasharray="4.2 4.2"/><path class="td-plus" d="M22 15.5v13M15.5 22h13"/></svg>';
const BANG = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="td-bf" cx="10" cy="10" r="9"/><path class="td-bk" d="M10 5.2v5.6"/><circle class="td-bd" cx="10" cy="14.2" r="1.3"/></svg>';
const CHEV = '<svg class="td-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';

const ELITE_NOTE = 'Usually done by Elite Cleaning, who log their jobs the next day around 14:00.';
// Mot d'etat d'un logement : celui du proxy, sauf les deux cas « sans personne » de la spec.
function wordOf(u) { return u.k === 'none' ? 'No cleaner yet' : u.k === 'elite' ? 'Not logged yet' : u.word; }

// ---------- Tete, bande des jours ----------
const THEME = '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button>';
// Sous-ligne : « 9 October · today, as of 11:00 », jamais « today » pour des donnees d'un
// autre jour que celui de l'horloge. Classe stale gardee sur l'heure.
function header(data, isToday, stale) {
  return '<header class="top td-head"><div><h1>' + esc(fmtDay(data.day, { weekday: 'long' })) + '</h1>'
    + '<p class="date td-date"><span class="asof td-asof' + (stale ? ' stale' : '') + '">'
    + esc(fmtDay(data.day, { day: 'numeric', month: 'long' }) + ' · ' + (isToday ? 'today, ' : '') + 'as of ' + dubaiTime(data.generatedAt)) + '</span></p></div>'
    + THEME + '</header>';
}
// Un autre jour : « 21 November · tomorrow » (le lendemain du jour de l'horloge) ou « 21 November ».
function aheadHeader(sel, clock) {
  return '<header class="top td-head"><div><h1>' + esc(fmtDay(sel, { weekday: 'long' })) + '</h1>'
    + '<p class="date td-date">' + esc(fmtDay(sel, { day: 'numeric', month: 'long' }) + (sel === addDays(clock, 1) ? ' · tomorrow' : '')) + '</p></div>'
    + THEME + '</header>';
}
// strip : { date, label, num, n, total, selected }[] ; n = menages sans cleaner, total = menages
// du jour, null tant que le jour n'est pas lu (point median, aria-label sans compte).
function wdayParts(s) {
  const known = s.n != null && s.total != null;
  return { aria: s.label + ' ' + s.num + (known ? ', ' + plural(s.total, 'cleaning') + ', ' + s.n + ' with no cleaner' : ''),
    count: known ? String(s.n) : '·', zero: !(known && s.n) };
}
// Sous la bande, « Assign quickly » ouvre l'ecran Assign (lot 4b) sur le jour choisi.
function weekHtml(strip) {
  const sel = strip.find((s) => s.selected);
  return '<nav class="td-week" aria-label="Next seven days">' + strip.map((s) => {
    const p = wdayParts(s);
    return '<button class="td-wd" type="button" data-wday="' + esc(s.date) + '" aria-pressed="' + (s.selected ? 'true' : 'false') + '" aria-label="'
      + esc(p.aria) + '"><span class="td-wl">' + esc(s.label) + '</span><span class="td-wn">' + s.num
      + '</span><span class="td-wc' + (p.zero ? ' td-zero' : '') + '">' + p.count + '</span></button>';
  }).join('') + '</nav><p class="td-weeknote">Under each day: cleanings with no cleaner yet.</p>'
    + (sel ? '<a class="td-qa" href="#/assign?d=' + esc(sel.date) + '">Assign quickly</a>' : '');
}
// Comptes d'une puce deja affichee, mis a jour sur place (reponse d'une semaine qui ne touche
// pas la journee affichee) : rien d'autre n'est rendu, un toucher en cours n'est jamais perdu.
export function patchWday(b, s) {
  const p = wdayParts(s);
  b.setAttribute('aria-label', p.aria);
  const c = b.querySelector('.td-wc');
  if (!c) return;
  c.textContent = p.count;
  c.classList.toggle('td-zero', p.zero);
}

// ---------- Personnes ----------
// hidden : disque decoratif (le nom est ecrit a cote, tuile du choix).
function disc(p, hidden) { return '<span class="td-disc td-' + esc(p.slot) + '"' + (hidden ? ' aria-hidden="true"' : '') + '>' + esc(p.ini) + '</span>'; }
function discs(people, ids, max) {
  return '<span class="td-discs">' + ids.slice(0, max || ids.length).map((id) => disc(people[id] || { slot: 'other', ini: '?' })).join('') + '</span>';
}
// Position de la personne (data.locations, plan 2026-10-29) : petite ligne, rien si la
// position est absente ou si le proxy n'a pas pu la lire (null).
function locHtml(data, id, nowMs) {
  const p = Array.isArray(data.locations) ? data.locations.find((x) => Number(x.id) === Number(id)) : null;
  const line = p && p.location ? locLine(p.location, nowMs) : '';
  if (!line) return '';
  return '<div class="loc-ln' + (isStale(p.location, nowMs) ? ' stale' : '') + '">' + esc(line) + '</div>';
}
const MAP = '<a class="td-map" href="#/more/locations">Map</a>';
const pressed = (ui, v) => (ui.filter != null && String(ui.filter) === String(v) ? 'true' : 'false');
// Rangee des personnes (telephone ; toute largeur sur un autre jour) : une puce par personne
// affectable, puis « sans cleaner », puis Map ; la ligne de position de la personne filtree
// dessous (jour des donnees seulement : c'est la position de maintenant).
function peopleHtml(day, ui, data, nowMs) {
  let h = '<div class="td-people"><div class="td-fchips" role="group" aria-label="Show one person">';
  for (const p of day.people) {
    if (!p.assignable) continue;
    h += '<button class="td-fchip" type="button" data-td-filter="' + esc(p.id) + '" aria-pressed="' + pressed(ui, p.id) + '" aria-label="'
      + esc(p.name + ', ' + plural(p.count, 'cleaning')) + '">' + disc(p) + '<span class="td-nm">' + esc(p.name) + '</span><span class="td-n">' + p.count + '</span></button>';
  }
  const n = day.counts.none;
  if (n || ui.filter === 'none') {
    h += '<button class="td-fchip" type="button" data-td-filter="none" aria-pressed="' + pressed(ui, 'none') + '" aria-label="No cleaner yet, ' + plural(n, 'cleaning')
      + '"><span class="td-nd">' + SVG.none + '</span><span class="td-nm">No cleaner</span><span class="td-n">' + n + '</span></button>';
  }
  h += MAP + '</div>';
  if (ui.filter != null && ui.filter !== 'none' && day.source === 'today') h += locHtml(data, ui.filter, nowMs);
  return h + '</div>';
}

// ---------- Moments et cartes ----------
function title(u) {
  if (!u.apt) return esc(u.bld || 'Apartment');
  return 'Apt ' + esc(u.apt) + (u.bld ? ' <span class="td-b">· ' + esc(u.bld) + '</span>' : '');
}
function namesIn(u, c) {
  return listNames(u.assigned.map((id) => (c.people[id] ? c.people[id].name : 'Member ' + id)));
}
// Choix ouvert sur ce logement (c.pick : { id, state }, jamais en lecture seule).
function picking(u, c) { return !!(c.pick && c.pick.id === u.id && u.key); }
function cardHtml(u, c) {
  if (u.shape === 'blocked') return blockedHtml(u, c);
  const names = u.assigned.length ? namesIn(u, c) : '';
  const line = u.shape === 'line';
  const open = picking(u, c);
  const tk = u.tickets.length ? plural(u.tickets.length, 'open ticket') : '';
  let left;
  if (u.canAssign && !c.ro) {
    left = '<button class="td-who' + (u.assigned.length ? '' : ' td-who-empty') + '" type="button" data-td-who="' + esc(u.id) + '" aria-expanded="' + open + '" aria-label="'
      + esc((u.assigned.length ? 'Change the cleaner of ' : 'Assign a cleaner to ') + placeLabel(u)) + '">' + (u.assigned.length ? discs(c.people, u.assigned, 3) : PLUS) + '</button>';
  } else {
    left = '<span class="td-whostatic" aria-hidden="true">' + (u.assigned.length ? discs(c.people, u.assigned, 3) : '<span class="td-dash"></span>') + '</span>';
  }
  const inner = '<span class="td-t">' + title(u) + '</span>'
    + '<span class="td-st td-k-' + u.k + '">' + esc(wordOf(u)) + (names ? '<span class="td-names"> · ' + esc(names) + '</span>' : '')
    + (line && tk ? '<span class="td-names"> · ' + tk + '</span>' : '') + '</span>'
    + (!line && u.arrival && u.cause ? '<span class="td-cause">' + esc(u.cause) + '</span>' : '')
    + (!line && u.timesLine ? '<span class="td-ti">' + esc(u.timesLine) + '</span>' : '')
    + (u.k === 'elite' ? '<span class="td-cause">' + ELITE_NOTE + '</span>' : '')
    + (!line && tk ? '<span class="td-tk">' + tk + '</span>' : '');
  // Autre jour (donnees mgr.planning) : aucune fiche a ouvrir, le corps n'est pas un bouton.
  const body = c.ahead ? '<div class="td-body td-still">' + inner + '</div>'
    : '<button class="td-body" type="button" data-td-open="' + esc(u.id) + '">' + inner + '</button>';
  const g = { ready: 1, done: 1, prog: 1, todo: 1 }[u.k] ? SVG[u.k] : '';
  return '<article class="td-card' + (line ? ' td-line' : '') + '">' + left + body + '<span class="td-glyph" aria-hidden="true">' + g + '</span>'
    + (open ? pickHtml(c.day, u, c.pick.state) : '') + '</article>';
}
// Carte Blocked (spec section 4) : une ligne par raison, chacune avec son bouton. Le menage qui a
// deja une personne ajoute la ligne « Cleaner: … » de la page de test, avec Change.
function blockedHtml(u, c) {
  const open = picking(u, c);
  const canPick = u.canAssign && !c.ro;
  const why = u.reasons.map((r) => {
    if (r.type === 'ticket') {
      return '<li><div class="td-w"><strong>Urgent ticket open since ' + esc(r.since) + (r.tech ? ', with ' + esc(r.tech) : ', nobody on it') + '</strong><span>'
        + esc(r.title) + ' (' + esc(r.ref) + ')</span></div><a class="td-btn td-ghost" href="#/maintenance?ref=' + encodeURIComponent(r.ref) + '">See ticket</a></li>';
    }
    if (r.type === 'cleaning') {
      const sub = r.elite ? ELITE_NOTE : u.timesLine;
      return '<li><div class="td-w"><strong>' + (r.elite ? 'Cleaning not logged yet' : 'No cleaner assigned') + '</strong>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>'
        + (canPick ? '<button class="td-btn" type="button" data-td-who="' + esc(u.id) + '" aria-expanded="' + open + '">Assign someone</button>' : '') + '</li>';
    }
    if (r.type === 'cleaner') {
      return '<li><div class="td-w"><strong>Cleaner: ' + esc(namesIn(u, c)) + '</strong><span>' + esc(r.word + '.' + (u.timesLine ? ' ' + u.timesLine : '')) + '</span></div>'
        + (canPick ? '<button class="td-btn td-ghost" type="button" data-td-who="' + esc(u.id) + '" aria-expanded="' + open + '">Change</button>' : '') + '</li>';
    }
    // Cause du proxy ; menage d'avant d'un autre jour sans personne (r.assign) : Assign someone.
    return '<li><div class="td-w"><span>' + esc(r.text) + '</span></div>'
      + (r.assign && canPick ? '<button class="td-btn" type="button" data-td-who="' + esc(u.id) + '" aria-expanded="' + open + '">Assign someone</button>' : '') + '</li>';
  }).join('');
  const who = u.arrival.owner ? 'Owner' : 'Guest';
  // Heure par defaut du proxy (timeSet false) : jamais donnee pour reelle.
  const due = who + ' due' + (c.isToday ? ' today' : '') + (u.arrival.timeSet ? ' at ' + u.arrival.time : ', time not set');
  return '<article class="td-card td-blocked"><div class="td-bhead"><span class="td-tag">' + BANG + 'Blocked</span><span class="td-due">'
    + esc(due) + '</span></div>'
    + '<h3 class="td-bt"><button class="td-btitle" type="button" data-td-open="' + esc(u.id) + '">' + esc(placeLabel(u) || 'Apartment') + '</button></h3>'
    + '<ul class="td-why">' + why + '</ul>' + (open ? pickHtml(c.day, u, c.pick.state) : '') + '</article>';
}

// Choix dans la carte (spec section 5, page de test : picker) : « Who cleans it? », une tuile
// par personne affectable (disque, nom, menages du jour) ; la tuile de la personne deja seule
// sur le menage porte aria-current. state : { busy, error, ro } ; busy : tuiles desactivees
// pendant une ecriture ; error : refus du serveur, tel quel ; ro : aucune tuile.
// Autre jour (day.source 'ahead') : tuiles data-td-wpick ; une personne en conge ce jour-la
// (Person.off) a sa tuile desactivee, avec « On leave ».
export function pickHtml(day, u, state) {
  const s = state || {};
  const cancel = '<button class="td-btn td-ghost" type="button" data-td-cancel>Cancel</button>';
  const h = '<div class="td-pick" role="group" aria-label="' + esc('Who cleans ' + (placeLabel(u) || 'it') + '?') + '"><span class="td-pl">Who cleans it?</span>';
  if (s.ro) return h + '<p class="ro-note" role="status">' + RO_LINE + '</p>' + cancel + '</div>';
  const attr = day.source === 'ahead' ? 'data-td-wpick' : 'data-td-pick';
  const tiles = day.people.filter((p) => p.assignable).map((p) => {
    const current = u.assigned.length === 1 && u.assigned[0] === p.id;
    return '<button class="td-tile" type="button" ' + attr + '="' + esc(p.id) + '" data-key="' + esc(u.key) + '"' + (current ? ' aria-current="true"' : '')
      + (p.off ? ' disabled' : s.busy ? ' aria-disabled="true"' : '') + '>' + disc(p, true) + '<span class="td-pn">' + esc(p.name)
      + '<small>' + (p.off ? 'On leave' : plural(p.count, 'job')) + '</small></span></button>';
  }).join('');
  return h + (s.error ? '<p class="td-perr" role="alert">' + esc(s.error) + '</p>' : '') + '<div class="td-tiles">' + tiles + '</div>' + cancel + '</div>';
}
function tallyHtml(m) {
  return m.tally.map((t) => '<span class="td-mc">' + SVG[t.k] + t.n + '</span>').join('');
}
function momentHtml(m, c) {
  const open = !c.ui.collapsed[m.id];
  const label = momentLabel(m, { today: c.isToday });
  let h = '<section class="td-moment"><button class="td-mh td-t-' + esc(m.tint) + '" type="button" data-td-moment="' + esc(m.id) + '" aria-expanded="' + open
    + '" aria-label="' + esc(label + ': ' + m.tally.map((t) => t.n + ' ' + t.w).join(', ')) + '"><span class="td-dot"></span><span class="td-ml">' + esc(label)
    + '</span><span class="td-mm" aria-hidden="true">' + tallyHtml(m) + '</span>' + CHEV + '</button>';
  if (!open) return h + '</section>';
  h += '<div class="td-mbody">';
  let run = '';
  for (const id of m.unitIds) {
    const u = c.byId[id];
    if (!u) continue;
    // Une ligne fine dont le choix est ouvert sort du groupe : elle devient une carte.
    if (u.shape === 'line' && !picking(u, c)) { run += cardHtml(u, c); continue; }
    if (run) { h += '<div class="td-rows">' + run + '</div>'; run = ''; }
    h += cardHtml(u, c);
  }
  if (run) h += '<div class="td-rows">' + run + '</div>';
  return h + '</div></section>';
}

// ---------- Not for today : Maintenance, techniciens, Team control (contenu inchange) ----------
function elseHtml(data, ui, nowMs) {
  const open = !ui.collapsed.more;
  const m = data.maintenance;
  const sum = m ? plural(Number(m.counts.urgent) || 0, 'urgent ticket') : '';
  // div et pas section : les blocs Maintenance et Team control restent les seules sections de leur titre.
  return '<div class="td-moment td-elsewhere"><button class="td-mh td-t-any" type="button" data-td-more aria-expanded="' + open + '" aria-label="Not for today'
    + (sum ? ': ' + sum : '') + '"><span class="td-dot"></span><span class="td-ml">Not for today</span><span class="td-mm" aria-hidden="true">' + sum + '</span>' + CHEV + '</button>'
    + (open ? '<div class="td-else">' + maintenanceHtml(data) + techsHtml(data, nowMs) + controlHtml(data) + '</div>' : '') + '</div>';
}
function techsHtml(data, nowMs) {
  const list = (data.who && data.who.technicians) || [];
  if (!list.length) return '';
  let h = '<section class="card" aria-labelledby="h-tech"><div class="sec-head"><h2 id="h-tech">Technicians</h2></div>';
  for (const t of list) {
    h += '<div class="person"><div class="person-h"><span class="av" aria-hidden="true">' + esc(initials(t.name)) + '</span><div><div class="nm">' + esc(t.name)
      + '</div><div class="rl">Maintenance tickets</div>' + locHtml(data, t.id, nowMs) + '</div><span class="cnt">' + t.open + '</span></div>'
      + (t.oldest ? '<div class="empty">Oldest: <span class="mono">MNT-' + t.oldest.id + '</span> ' + esc(t.oldest.title) + ', since ' + esc(t.oldest.since) + '.</div>' : '')
      + '</div>';
  }
  return h + '</section>';
}

// ---------- Panneau des personnes (1200 px et plus) ----------
// Ligne d'une personne dans le panneau : un logement bloque montre l'etat de son menage en
// neutre (page de test), le blocage est deja dit par sa grande carte.
const JOB_WORD = { done: 'Done', in_progress: 'In progress' };
function sideRow(u) {
  const blocked = u.k === 'blocked';
  const k = blocked ? 'todo' : u.k;
  const w = blocked ? (JOB_WORD[u.job.state] || 'Not started') : wordOf(u);
  return '<li><span>' + esc(placeLabel(u)) + '</span><span class="td-st td-k-' + k + '">' + esc(w) + '</span></li>';
}
function sideHtml(day, c, data, nowMs) {
  const elite = day.units.filter((u) => u.k === 'elite');
  const expected = elite.length ? '<p class="td-exp">Expected, not logged yet: ' + esc(elite.map((u) => placeLabel(u)).join(', ')) + '.</p>' : '';
  const sub = day.people.find((p) => p.role === 'subcontractor' && (p.assignable || p.count));
  let h = '<aside class="td-side" aria-label="Team"><div class="td-team"><div class="td-teamh"><h2>' + (c.isToday ? 'Who is where today' : 'Who has what that day')
    + '</h2>' + MAP + '</div>';
  for (const p of day.people) {
    if (!p.assignable && !p.count) continue;
    const mine = day.units.filter((u) => u.job && u.assigned.indexOf(p.id) >= 0);
    h += '<section class="td-tp"><button class="td-tph" type="button" data-td-filter="' + esc(p.id) + '" aria-pressed="' + pressed(c.ui, p.id) + '">' + disc(p)
      + '<span class="td-tn">' + esc(p.name) + '</span><span class="td-tk2">' + plural(p.count, 'cleaning') + '</span></button>' + locHtml(data, p.id, nowMs)
      + (mine.length ? '<ul>' + mine.map(sideRow).join('') + '</ul>' : '')
      + (sub && p.id === sub.id ? expected : '') + '</section>';
  }
  if (!sub && expected) h += '<section class="td-tp">' + expected + '</section>';
  if (day.counts.none) {
    h += '<section class="td-tp"><button class="td-tph" type="button" data-td-filter="none" aria-pressed="' + pressed(c.ui, 'none') + '"><span class="td-nd">' + SVG.none
      + '</span><span class="td-tn">No cleaner yet</span><span class="td-tk2">' + plural(day.counts.none, 'cleaning') + '</span></button></section>';
  }
  return h + '</div></aside>';
}

// Bloc Maintenance : compteurs, 5 premiers tickets ouverts (liens vers l'ecran Maintenance).
const MNT_TONE = { urgent: 'bad', high: 'warn' };
const MNT_STAGE = { todo: 'To do', in_progress: 'In progress', waiting_parts: 'Waiting parts', to_confirm: 'To confirm' };
function maintenanceHtml(data) {
  let h = '<section class="card" aria-labelledby="h-prob"><div class="sec-head"><h2 id="h-prob">Maintenance</h2><span class="meta">Top 5 by urgency</span></div>';
  const m = data.maintenance;
  if (!m) return h + '<div class="empty pad">Maintenance is unavailable right now.</div></section>';
  const c = m.counts;
  // Le nombre une seule fois (en gras), le libelle au singulier pour 1.
  const n = (v) => Number(v) || 0;
  const count = (v, one, many) => '<b class="tnum">' + n(v) + '</b> <span>' + (n(v) === 1 ? one : many) + '</span>';
  h += '<div class="counts"><a class="count" href="#/maintenance">' + count(c.proposals, 'proposal to check', 'proposals to check') + '</a>'
    + '<div class="count">' + count(c.urgent, 'urgent ticket', 'urgent tickets') + '</div>'
    + '<div class="count">' + count(c.unassigned, 'with nobody', 'with nobody') + '</div></div>';
  if (!m.top.length) h += '<div class="empty pad">Nothing open.</div>';
  h += m.top.map((t) => '<a class="prob" href="#/maintenance?ref=' + encodeURIComponent(t.ref) + '" data-nav-row>'
    + '<span class="bar ' + (MNT_TONE[t.priority] || 'ok') + '"></span><span class="body"><span class="src"><span>' + esc(MNT_STAGE[t.stage] || '')
    + '</span><span class="mono">' + esc(t.ref) + '</span></span><span class="ttl">' + esc(t.title) + '</span>'
    + (t.apt || t.bld ? '<span class="where">' + esc(placeLabel(t)) + '</span>' : '') + '</span></a>').join('');
  h += '<div class="sec-foot mt-foot"><a class="link" href="#/maintenance">Open maintenance</a></div>';
  return h + '</section>';
}

function controlHtml(data) {
  const c = data.control, ins = c.inspections;
  let h = '<section class="card" aria-labelledby="h-ctl"><div class="sec-head"><h2 id="h-ctl">Team control</h2><span class="meta">Yesterday and today</span></div>';
  h += '<div class="ctl"><h3>Inspections today</h3><div class="kv"><span class="k">Proposed</span><span class="v">' + ins.proposed
    + '</span><span class="k">Claimed</span><span class="v">' + ins.claimed + '</span><span class="k">Done</span><span class="v">' + ins.done + '</span></div>';
  if (ins.unfinished.length) {
    h += '<div class="mini"><div class="it"><span>Started, never finished<br><span class="sub">'
      + esc(ins.unfinished.map((u) => placeLabel(u) + ' (' + u.inspector + ', ' + u.date + ')').join(', '))
      + '</span></span><b class="tnum">' + ins.unfinished.length + '</b></div></div>';
  }
  h += '<a class="link" href="#/inspections">Open inspections</a></div>';
  h += '<div class="ctl"><h3>Missing linen counts, ' + esc(c.linen.window) + '</h3>' + (c.linen.rows.length
    ? '<div class="kv">' + c.linen.rows.map((r) => '<span class="k">' + esc(r.name) + '</span><span class="v"><span class="'
      + (r.total && r.missing / r.total > 0.5 ? 'num-bad' : '') + '">' + r.missing + '</span><span class="of"> of ' + r.total + ' cleanings</span></span>').join('') + '</div>'
    : '<div class="empty">No cleaning marked done in this window.</div>') + '</div>';
  h += '<div class="ctl"><h3>Overdue team tasks</h3>' + (c.overdue.total
    ? '<div class="kv">' + c.overdue.rows.map((r) => '<span class="k">' + esc(r.name) + '</span><span class="v">' + r.n + '</span>').join('')
      + '<span class="k total">Total</span><span class="v">' + c.overdue.total + '</span></div>'
    : '<div class="empty">Nothing overdue.</div>') + '</div>';
  h += '<div class="ctl"><h3>What each person did yesterday, ' + esc(c.yesterday.date) + '</h3><div class="yday">'
    + c.yesterday.rows.map((y) => '<div class="p"><b>' + esc(y.name) + '</b><span>' + esc(y.text) + '</span></div>').join('') + '</div></div>';
  return h + '</section>';
}

// Le <details> actuel, garde tel quel en bas de la liste.
function rulesHtml(data) {
  return '<details class="rules td-rules"><summary>How status is computed</summary><ul>'
    + '<li><b>Ready</b>: a cleaning was marked done in HK Planner after the previous checkout, and no urgent ticket is open on the apartment.</li>'
    + '<li><b>At risk</b>: a cleaner is assigned but the cleaning is not marked done, and the guest arrives within ' + data.riskHours + ' hours. Also an unassigned cleaning that Elite may have done but not logged yet (Elite logs the next day around 14:00).</li>'
    + '<li><b>Blocked</b>: no cleaner is assigned, or an urgent maintenance ticket is open on the apartment.</li>'
    + '<li><b>Scheduled</b>: a cleaner is assigned and the guest arrives in more than ' + data.riskHours + ' hours.</li>'
    + '<li>Owner stays count as arrivals. Without a checkout in the last 14 days, there is no cleaning to check.</li></ul></details>';
}

// Ce que les cartes d'une journee partagent : personnes et logements par id, choix ouvert.
// ahead : un autre jour de la bande (corps des cartes sans fiche).
function cardsCtx(day, ui, ro, isToday, pick, ahead) {
  const people = {};
  for (const p of day.people) people[p.id] = p;
  const byId = {};
  for (const u of day.units) byId[u.id] = u;
  return { ui, ro, isToday, people, byId, day, pick, ahead };
}
function listHtml(day, moments, c) {
  if (moments.length) return moments.map((m) => momentHtml(m, c)).join('');
  return '<p class="td-empty">' + esc(c.ui.filter == null ? emptyLine(day, { today: c.isToday }) : 'Nothing for this choice on that day.') + '</p>';
}

// view : { data, day, moments, ui, banner, stale, ro, strip, nowMs, ahead, busy, pickError }.
// ui : { filter, collapsed, pick } ; busy : une ecriture est en cours ; pickError : refus du
// serveur dans le choix ouvert ; strip : bande des jours (weekHtml).
// Jour des donnees (ahead null) : day = buildToday(data), moments = visible(day, ui.filter).
// Autre jour de la bande : ahead = { sel, week } (week : { data, fresh, loading, error } ou
// null), day = buildAhead(week.data, sel) ou null tant que la semaine n'est pas lue, ro = semaine
// pas fraiche ; banner et stale ne servent pas (ils parlent de mgr.today).
export function boardHtml(view) {
  const { data, day, moments, ui, banner, stale, ro, strip, nowMs, ahead, busy, pickError } = view;
  const clock = dubaiToday(nowMs);
  // Lecture seule : aucun choix.
  const pick = day && ui.pick != null && !ro ? { id: ui.pick, state: { busy: !!busy, error: pickError || null, ro: false } } : null;
  if (ahead) return aheadBoard(view, clock, pick);
  const isToday = clock === data.day;
  const head = header(data, isToday, stale) + (banner || '') + '<p class="td-sum">' + esc(sentence(day, { today: isToday })) + '</p>' + weekHtml(strip);
  const c = cardsCtx(day, ui, ro, isToday, pick, false);
  return head + '<div class="td-cols"><div class="td-main">' + peopleHtml(day, ui, data, nowMs)
    + '<div class="td-moments">' + listHtml(day, moments, c) + '</div>' + elseHtml(data, ui, nowMs) + rulesHtml(data) + '</div>'
    + sideHtml(day, c, data, nowMs) + '</div>';
}
// Un autre jour de la bande (spec section 5) : meme gabarit que Today, sans Not for today, sans
// regles ni panneau (les puces de personnes restent a toute largeur). Semaine en echec avec
// d'anciennes donnees : bandeau, lecture seule et Retry ; sans donnees : Loading ou Retry.
function aheadBoard(view, clock, pick) {
  const { data, day, moments, ui, ro, strip, nowMs, ahead } = view;
  const w = ahead.week;
  let h = aheadHeader(ahead.sel, clock);
  if (day && w && w.error) {
    h += '<div class="banner warn" role="status"><span>' + esc(w.error.message) + ' ' + RO_LINE
      + '</span><button class="btn sm" type="button" data-wretry>Retry</button></div>';
  }
  h += (day ? '<p class="td-sum">' + esc(sentence(day)) + '</p>' : '') + weekHtml(strip);
  let body;
  if (!day) {
    body = !w || !w.error ? '<p class="td-empty" role="status">Loading ' + esc(dayShort(ahead.sel)) + '…</p>'
      : '<div class="err-card" role="alert"><p>' + esc(w.error.message) + '</p><button class="btn primary" type="button" data-wretry>Retry</button></div>';
  } else {
    body = peopleHtml(day, ui, data, nowMs) + '<div class="td-moments">' + listHtml(day, moments, cardsCtx(day, ui, ro, false, pick, true)) + '</div>';
  }
  return h + '<div class="td-cols td-solo"><div class="td-main">' + body + '</div></div>';
}

// Fiche d'un menage du jour (donnees mgr.today).
function xTime(j) { return j.kind === 'extra' ? (j.extraTime || (j.extra && j.extra.cleaningTime) || null) : null; }
function nextLine(j) {
  if (!j.next) return 'No guest in the next 14 days';
  const who = j.next.owner ? 'Owner' : 'Guest';
  if (j.next.sameDay) return who + ' arrives ' + (j.next.time || 'today');
  return 'Next ' + who.toLowerCase() + ' ' + ddmm(j.next.date);
}

function sheetHead(title, sub) {
  return '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
function statusBox(tone, word, text) {
  return '<div class="statusbox ' + tone + '"><span class="bar ' + tone + '"></span><div><span class="st ' + tone + '">' + esc(word) + '</span><p>' + esc(text) + '</p></div></div>';
}
function tlItem(t, tone, title, sub) {
  return '<li><span class="tt">' + esc(t) + '</span><span class="dot ' + (tone || '') + '"></span><span class="tx"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span></li>';
}
function ticketsBlk(list) {
  const tk = list || [];
  if (!tk.length) return '<div class="blk"><h3>Open tickets</h3><div class="empty">None on this apartment.</div></div>';
  return '<div class="blk"><h3>Open tickets</h3><ul>' + tk.map((t) => '<li><b>' + esc(t.title) + '</b><small><span class="mono">MNT-' + t.id + '</span> · '
    + esc(t.priority) + ' · since ' + esc(t.since) + ' · ' + (t.tech ? 'assigned to ' + esc(t.tech) : 'no technician') + '</small></li>').join('') + '</ul></div>';
}

export function jobSheet(data, job, nowMs, ro) {
  const arr = data.arrivals.rows.find((a) => a.prevKey === job.key) || null;
  const names = namesOf(data, job.assigned);
  const box = arr ? statusBox(arr.tone, arr.word, arr.cause)
    : statusBox(job.tone, job.word, (job.assigned.length ? 'Assigned to ' + names + '.' : 'No cleaner in HK Planner for this cleaning.') + ' ' + nextLine(job) + '.');
  const nextT = job.next && job.next.sameDay ? (job.next.time || '15:00') : '';
  const tl = '<ul class="tl">'
    + (job.kind === 'extra' ? '' : tlItem(job.checkout || '--:--', 'ok', job.postponedFrom ? 'Checkout ' + ddmm(job.postponedFrom) : 'Checkout',
      job.postponedFrom ? 'Cleaning postponed to today' : job.checkout ? 'Guest leaves' : 'Checkout time not set in Hostaway'))
    + tlItem(dubaiTime(new Date(nowMs).toISOString()), 'now', 'Now',
      job.state === 'done' ? 'Cleaning done' : job.assigned.length ? names + (job.state === 'in_progress' ? ', in progress' : ', not started') : 'Nobody assigned')
    + (nextT ? tlItem(nextT, arr ? arr.tone : job.tone, (job.next.owner ? 'Owner' : 'Guest') + ' arrives', fmtDur(arrivalMs(data.day, nextT) - nowMs) + ' from now')
      : tlItem('', '', 'Next guest', job.next ? ddmm(job.next.date) : 'None in the next 14 days'))
    + '</ul>';
  const xsub = 'Extra cleaning, today' + (xTime(job) ? ' at ' + xTime(job) : '');
  return sheetHead(placeLabel(job), job.kind === 'extra' ? xsub : 'Checkout cleaning, today')
    + '<div class="sheet-b">' + box + tl
    + '<div class="blk"><h3>Cleaner</h3><div>' + (job.assigned.length ? esc(names) : '<span class="st bad">Nobody</span>') + '</div></div>'
    + photosBlk(job.key)
    + ticketsBlk(data.ticketsByListing[job.listingId]) + '</div>'
    + actionsFoot(job.key, job.assigned, job.state === 'done', ro);
}

export function arrivalSheet(data, a, nowMs, ro) {
  const left = arrivalMs(data.day, a.time) - nowMs;
  const pc = a.prevCheckout;
  const prevItem = pc ? tlItem(pc.date === data.day ? (pc.time || '--:--') : ddmm(pc.date), 'ok', 'Previous checkout',
    pc.date === data.day ? (pc.time ? 'Today' : 'Today, checkout time not set') : 'Apartment empty since') : '';
  const tl = '<ul class="tl">' + prevItem
    + tlItem(dubaiTime(new Date(nowMs).toISOString()), 'now', 'Now',
      a.done ? 'Cleaning done' : a.cleaners.length ? a.cleaners.join(' and ') + ', not done yet' : 'Nobody assigned')
    + tlItem(a.time, a.tone, a.kind + ' arrives', left > 0 ? fmtDur(left) + ' from now' : 'Due now') + '</ul>';
  return sheetHead(placeLabel(a), a.kind + ' arriving today at ' + a.time + (a.timeSet ? '' : ' (time not set)'))
    + '<div class="sheet-b">' + statusBox(a.tone, a.word, a.cause) + tl
    + '<div class="blk"><h3>Cleaner</h3><div>' + (a.cleaners.length ? esc(a.cleaners.join(' and ')) : '<span class="st bad">Nobody</span>') + '</div></div>'
    + (a.prevKey ? photosBlk(a.prevKey) : '')
    + ticketsBlk(data.ticketsByListing[a.listingId]) + '</div>'
    + (a.prevKey ? actionsFoot(a.prevKey, a.assigned, a.done, ro) : '<div class="sheet-f"><button class="btn" type="button" data-close>Close</button></div>');
}
