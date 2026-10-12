// App manager /manager/ (spec 2026-10-09-hk-manager-app-design.md) : acces,
// navigation par role, routeur par hash. Manager : Today · Planning · Maintenance ·
// Inspections · More (Tasks sous More). Maintenance (Semax) : Maintenance · Planning.
import { getSession } from '/v3/session.js';
import { get } from '/manager/api.js';
import { decideAccess } from '/manager/access.js';
import { closeSheet, I, initSheet, toggleTheme } from '/manager/ui/dom.js';
import { renderPlaceholder } from '/manager/screens/placeholder.js';

const LABELS = { today: 'Today', planning: 'Planning', maintenance: 'Maintenance', inspections: 'Inspections', more: 'More' };
// Par role : entrees de navigation, vues permises (Tasks vit sous More), vue d'arrivee.
const ROLES = {
  manager: { nav: ['today', 'planning', 'maintenance', 'inspections', 'more'], extra: ['tasks'], landing: 'today' },
  maintenance: { nav: ['maintenance', 'planning'], extra: [], landing: 'maintenance' },
};
// Vue cachee de la navigation -> entree marquee courante.
const PARENT = { tasks: 'more' };
// Ecrans livres : module et fonction de rendu. Les autres restent provisoires.
const SCREENS = {
  today: ['/manager/screens/today.js', 'renderToday'],
  planning: ['/manager/screens/planning.js', 'renderPlanning'],
  maintenance: ['/manager/screens/maintenance.js', 'renderMaintenance'],
  tasks: ['/manager/screens/problems.js', 'renderProblems'],
  inspections: ['/manager/screens/inspections.js', 'renderInspections'],
  more: ['/manager/screens/more.js', 'renderMore'],
};
const ROLE_KEY = 'mgrRole';
const main = document.getElementById('main');
let me = null;
// Propositions en attente, annoncees par Maintenance et Today (evenement mgr:mntbadge).
let proposals = 0;
let seq = 0;
let leaving = [];
let listening = false;

// Role confirme par le serveur ; sans reponse (session a renouveler, hors ligne),
// le dernier role confirme sur cet appareil, sinon manager.
function roleOf() {
  let r = me && me.role;
  if (!r) { try { r = localStorage.getItem(ROLE_KEY); } catch (e) { r = null; } }
  return ROLES[r] ? r : 'manager';
}
function rememberRole(r) { try { localStorage.setItem(ROLE_KEY, r); } catch (e) { /* stockage indisponible */ } }

// Anciens liens #/problems : taches -> #/tasks, tickets MNT -> #/maintenance (requete gardee).
function legacyHash(hash) {
  const m = /^#\/?problems(?:\?(.*))?$/.exec(hash || '');
  if (!m) return null;
  const q = m[1] || '';
  const ref = new URLSearchParams(q).get('ref') || '';
  return (/^MNT-/.test(ref) ? '#/maintenance' : '#/tasks') + (q ? '?' + q : '');
}

// Vue demandee par le hash ; hors des vues du role -> vue d'arrivee, hash reecrit
// par replaceState (pas de hashchange, pas d'entree d'historique en plus).
function currentView() {
  const old = legacyHash(location.hash);
  if (old) history.replaceState(history.state, '', old);
  const r = ROLES[roleOf()];
  const v = (location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  if (r.nav.includes(v) || r.extra.includes(v)) return v;
  history.replaceState(history.state, '', '#/' + r.landing);
  return r.landing;
}

function badge(id) {
  if (id !== 'maintenance' || proposals <= 0) return '';
  return '<span class="nbadge" aria-label="' + proposals + ' to review">' + (proposals > 99 ? '99+' : proposals) + '</span>';
}

function renderNav(view) {
  const cur = PARENT[view] || view;
  const views = ROLES[roleOf()].nav;
  const link = (cls, id, inner) => '<a class="' + cls + '" href="#/' + id + '"' + (cur === id ? ' aria-current="page"' : '') + '>' + inner + '</a>';
  document.getElementById('sideNav').innerHTML = views.map((id) => link('navlink', id, I[id] + '<span>' + LABELS[id] + '</span>' + badge(id))).join('');
  document.getElementById('tabbar').innerHTML = views.map((id) => link('tab', id, '<span class="tab-wrap">' + I[id] + badge(id) + '</span>' + LABELS[id])).join('');
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
    document.addEventListener('mgr:mntbadge', (e) => {
      const n = Math.max(0, Number(e.detail && e.detail.proposals) || 0);
      if (n === proposals) return;
      proposals = n;
      renderNav(currentView());
    });
  }
  return route();
}

function emailSessionStored() {
  try {
    const raw = localStorage.getItem('hkAuthSession');
    const sess = raw ? JSON.parse(raw) : null;
    return !!(sess && sess.refresh_token);
  } catch (e) { return false; }
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
  // Renouvellement lent : v3/session.js prefere le PIN a « stale ». Si une session
  // email avec refresh token est encore stockee, c'est ce cas, pas un manager PIN seul.
  if (s.kind === 'pin' && emailSessionStored()) { await startShell(); return; }
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
  me = { id: cleaner.id, name: cleaner.name, role: cleaner.role };
  rememberRole(cleaner.role);
  await startShell();
}

boot().catch((e) => { console.error('[manager] boot failed', e); }).finally(() => { window.__mgrReady = true; });
