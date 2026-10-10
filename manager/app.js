// App manager /manager/ (spec 2026-10-09-hk-manager-app-design.md) : acces,
// navigation Today · Planning · Problems · Inspections · More, routeur par hash.
import { getSession } from '/v3/session.js';
import { get } from '/manager/api.js';
import { decideAccess } from '/manager/access.js';
import { closeSheet, I, initSheet, toggleTheme } from '/manager/ui/dom.js';
import { renderPlaceholder } from '/manager/screens/placeholder.js';

const VIEWS = [
  { id: 'today', label: 'Today' }, { id: 'planning', label: 'Planning' }, { id: 'problems', label: 'Problems' },
  { id: 'inspections', label: 'Inspections' }, { id: 'more', label: 'More' },
];
// Ecrans livres : module et fonction de rendu. Les autres restent provisoires.
const SCREENS = {
  today: ['/manager/screens/today.js', 'renderToday'],
  planning: ['/manager/screens/planning.js', 'renderPlanning'],
  problems: ['/manager/screens/problems.js', 'renderProblems'],
};
const main = document.getElementById('main');
let me = null;
// Problemes urgents ouverts, annonces par Today et Problems (evenement mgr:badge).
let urgent = 0;
let seq = 0;
let leaving = [];
let listening = false;

function currentView() {
  const v = (location.hash || '#/today').replace(/^#\/?/, '').split(/[/?]/)[0];
  return VIEWS.some((x) => x.id === v) ? v : 'today';
}

function badge(id) {
  if (id !== 'problems' || urgent <= 0) return '';
  return '<span class="nbadge" aria-label="' + urgent + ' urgent">' + (urgent > 99 ? '99+' : urgent) + '</span>';
}

function renderNav(view) {
  const link = (cls, v, inner) => '<a class="' + cls + '" href="#/' + v.id + '"' + (view === v.id ? ' aria-current="page"' : '') + '>' + inner + '</a>';
  document.getElementById('sideNav').innerHTML = VIEWS.map((v) => link('navlink', v, I[v.id] + '<span>' + v.label + '</span>' + badge(v.id))).join('');
  document.getElementById('tabbar').innerHTML = VIEWS.map((v) => link('tab', v, '<span class="tab-wrap">' + I[v.id] + badge(v.id) + '</span>' + v.label)).join('');
  document.getElementById('sideFoot').textContent = me ? 'Signed in as ' + me.name : 'Offline';
}

function emailRequired() {
  document.body.classList.add('bare');
  document.getElementById('sideNav').innerHTML = '';
  document.getElementById('tabbar').innerHTML = '';
  main.innerHTML = '<div class="ph" style="margin-top:32px"><h2>Sign in with your email</h2>'
    + '<p>The manager app needs your email account. This device is signed in with a PIN.</p>'
    + '<p>Open HK Planner, sign out, then sign in with your email and password.</p>'
    + '<a class="btn primary" href="/?legacy=1">Open HK Planner</a></div>';
}

async function route() {
  const mine = ++seq;
  const old = leaving;
  leaving = [];
  for (const fn of old) { try { fn(); } catch (e) { /* nettoyage best effort */ } }
  closeSheet();
  const view = currentView();
  renderNav(view);
  const ctx = { me, main, isCurrent: () => mine === seq, onLeave: (fn) => { leaving.push(fn); }, emailRequired };
  const screen = SCREENS[view];
  if (screen) {
    let mod = null;
    try { mod = await import(screen[0]); } catch (e) { mod = null; }
    if (mine !== seq) return;
    if (mod && typeof mod[screen[1]] === 'function') { await mod[screen[1]](ctx); return; }
  }
  renderPlaceholder(ctx, view);
}

function startShell() {
  if (!listening) {
    listening = true;
    window.addEventListener('hashchange', route);
    document.addEventListener('mgr:badge', (e) => {
      const n = Math.max(0, Number(e.detail && e.detail.problems) || 0);
      if (n === urgent) return;
      urgent = n;
      renderNav(currentView());
    });
  }
  return route();
}

async function boot() {
  initSheet();
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-theme-toggle]')) toggleTheme();
  });
  let s = null;
  try { s = await getSession(); } catch (e) { s = null; }
  if (!s) { location.replace('/'); return; }
  // Session email a renouveler sans reseau : la coquille s'ouvre, Today montre son cache.
  if (s.kind === 'stale') { await startShell(); return; }
  let cleaner = null;
  try {
    const r = await get('cleanerMe');
    cleaner = r && r.cleaner;
  } catch (e) {
    if (e.kind === 'auth') { location.replace('/'); return; }
    await startShell();
    return;
  }
  const d = decideAccess(s, cleaner);
  if (d.go) { location.replace(d.go); return; }
  if (d.screen === 'email') { emailRequired(); return; }
  me = { id: cleaner.id, name: cleaner.name };
  await startShell();
}

boot().catch((e) => { console.error('[manager] boot failed', e); }).finally(() => { window.__mgrReady = true; });
