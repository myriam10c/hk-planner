import { getSession } from '/v3/session.js';
import { get } from '/inspections/api.js';
import { renderToday } from '/inspections/today.js';

const view = document.getElementById('view');
let me = null;
let seq = 0;
let leaving = []; // nettoyages de l'ecran courant, lances au changement de route

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function render(html) { view.innerHTML = html; }
function toast(msg) {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function signIn() {
  render('<main class="wrap"><h1>Please sign in</h1><p class="mute">Sign in to HK Planner first, then come back here.</p>'
    + '<a class="btn primary" href="/">Go to sign in</a></main>');
}
function placeholder(title, extra) {
  render('<main class="wrap"><button class="btn ghost" data-act="home">Back</button><h1>' + esc(title) + '</h1><p class="mute">Coming soon.</p>'
    + (extra ? '<p class="mute">' + esc(extra) + '</p>' : '') + '</main>');
  view.querySelector('[data-act="home"]').onclick = () => go('#/');
}

async function route() {
  const mine = ++seq;
  const old = leaving; leaving = [];
  for (const fn of old) { try { fn(); } catch (e) { /* nettoyage best effort */ } }
  const hash = location.hash || '#/';
  const ctx = { me, go, toast, render, esc, isCurrent: () => mine === seq, onLeave: (fn) => { leaving.push(fn); } };
  view.onclick = null; view.oninput = null;
  const [path, query] = hash.slice(2).split('?');
  const parts = path.split('/');
  const q = new URLSearchParams(query || '');
  let mod = null;
  if (parts[0] === 'inspect' && parts[1]) {
    mod = await load('/inspections/inspect.js');
    if (!mod) return placeholder('Inspection', 'Apartment ' + decodeURIComponent(parts[1]));
    if (mine === seq) await mod.renderInspect({ ...ctx, listingId: decodeURIComponent(parts[1]), entry: q.get('e') || 'adhoc' });
  } else if (parts[0] === 'fleet') {
    mod = await load('/inspections/fleet.js');
    if (!mod) return placeholder('Fleet');
    if (mine === seq) await mod.renderFleet(ctx);
  } else if (parts[0] === 'reports') {
    mod = await load('/inspections/reports.js');
    if (!mod) return placeholder('Reports');
    if (mine === seq) await mod.renderReports(ctx);
  } else if (parts[0] === 'history' && parts[1]) {
    mod = await load('/inspections/history.js');
    if (!mod) return placeholder('History');
    if (mine === seq) await mod.renderHistory({ ...ctx, listingId: decodeURIComponent(parts[1]) });
  } else {
    await renderToday(ctx);
  }
}

// Ecrans livres aux taches 7 et 8 : module absent = ecran provisoire.
async function load(path) {
  try { return await import(path); } catch (e) { return null; }
}

let listening = false;
function loadError() {
  render('<main class="wrap"><h1>HK Planner</h1><p class="notice bad" role="alert">Could not load. Check your connection and try again.</p>'
    + '<button class="btn primary" data-act="retry">Retry</button></main>');
  view.querySelector('[data-act="retry"]').onclick = () => { boot(); };
}
async function boot() {
  let s = null;
  try { s = await getSession(); } catch (e) { s = null; }
  if (!s) { signIn(); return; }
  if (s.kind === 'stale') { loadError(); return; }
  try {
    const r = await get('cleanerMe');
    const c = r && r.cleaner;
    if (!c) { signIn(); return; }
    me = { cleaner_id: c.id, name: c.name, role: c.role };
  } catch (e) {
    if (e.kind === 'auth') signIn(); else loadError();
    return;
  }
  if (!listening) { listening = true; window.addEventListener('hashchange', route); }
  await route();
}
boot().finally(() => { window.__inspReady = true; });
