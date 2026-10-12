// Briques d'interface communes de /manager/ : echappement, icones, panneau
// (feuille sur telephone, panneau lateral sur ordinateur), toast, theme.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const I = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  planning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  problems: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/></svg>',
  maintenance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  inspections: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6v3H9z"/><path d="M15 5.5h2.5v15h-11v-15H9"/><path d="m9 13 2 2 4-4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
};

export function aptLabel(o) { return o && o.apt ? 'Apt ' + o.apt : ''; }
export function placeLabel(o) { return [aptLabel(o), o && o.bld].filter(Boolean).join(' · '); }

export function dubaiTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });
  } catch (e) { return ''; }
}

const $ = (id) => document.getElementById(id);
let lastFocus = null;

export function sheetIsOpen() {
  const s = $('sheet');
  return !!s && s.classList.contains('on');
}
export function openSheet(html) {
  const sh = $('sheet');
  if (!sheetIsOpen()) lastFocus = document.activeElement;
  $('sheetInner').innerHTML = html;
  sh.classList.add('on');
  sh.setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('on');
  const x = sh.querySelector('.x');
  if (x) x.focus();
}
export function closeSheet() {
  const sh = $('sheet');
  if (!sh || !sheetIsOpen()) return;
  sh.classList.remove('on');
  sh.setAttribute('aria-hidden', 'true');
  $('scrim').classList.remove('on');
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}
// Une seule fois au demarrage : fermeture (croix, fond, Echap) et focus garde dans le panneau.
export function initSheet() {
  $('scrim').addEventListener('click', closeSheet);
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (!sheetIsOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from($('sheet').querySelectorAll('button:not([disabled]), a[href]'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

let toastTimer = null;
export function toast(msg, undo) {
  const el = $('toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" data-undo>Undo</button>' : '');
  el.classList.add('on');
  if (undo) el.querySelector('[data-undo]').onclick = () => { el.classList.remove('on'); undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), undo ? 6000 : 3000);
}

export function toggleTheme() {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('mgrTheme', next); } catch (e) { /* theme non garde */ }
}

// Jour calendaire de Dubai (AAAA-MM-JJ) d'un instant.
export function dubaiToday(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day;
}
export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function ddmm(day) { return day ? day.slice(8, 10) + '/' + day.slice(5, 7) : ''; }

// Boutons du panneau desactives pendant une ecriture, erreur du serveur en tete du panneau.
export function sheetBusy(on) {
  document.querySelectorAll('#sheet button:not([data-close])').forEach((b) => { b.disabled = on; });
}
export function sheetError(msg) {
  const body = document.querySelector('#sheet .sheet-b');
  if (!body) return;
  let el = body.querySelector('.sheet-err');
  if (!el) {
    el = document.createElement('p');
    el.className = 'sheet-err';
    el.setAttribute('role', 'alert');
    body.prepend(el);
  }
  el.textContent = msg;
}

// Nombre de problemes urgents ouverts (ancien evenement, plus affiche par la coquille).
export function announceBadge(n) {
  document.dispatchEvent(new CustomEvent('mgr:badge', { detail: { problems: Number(n) || 0 } }));
}

// Propositions de maintenance en attente, pour la pastille Maintenance (app.js).
export function announceMntBadge(n) {
  document.dispatchEvent(new CustomEvent('mgr:mntbadge', { detail: { proposals: Number(n) || 0 } }));
}

// Repeint d'un ecran (innerHTML) : le focus clavier revient sur l'element qui porte le
// meme attribut avec la meme valeur (puce de jour, carte, bouton Select...).
const FOCUS_ATTRS = ['data-wday', 'data-wassign', 'data-job', 'data-select', 'data-select-all', 'data-bulk', 'data-day', 'data-filter',
  'data-week', 'data-add-extra', 'data-retry', 'data-wretry'];
export function focusMark(root) {
  const a = document.activeElement;
  if (!a || a === root || !root.contains(a)) return null;
  for (const k of FOCUS_ATTRS) {
    if (a.hasAttribute(k)) return '[' + k + '="' + CSS.escape(a.getAttribute(k)) + '"]';
  }
  return null;
}
export function focusBack(root, mark) {
  if (!mark) return;
  const el = root.querySelector(mark);
  if (el && document.activeElement !== el) el.focus({ preventScroll: true });
}
