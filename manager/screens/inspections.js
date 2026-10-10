// Inspections dans la coquille manager (spec section 6, phase 4) : les ecrans de
// /inspections/*.js sont importes tels quels et rendus dans #main. Ils cherchent
// #view par id : on le cree ici, neuf a chaque route, ce qui efface leurs
// gestionnaires view.onclick/oninput/onchange.
import { esc, toast } from '/manager/ui/dom.js';

const SUB = {
  '': ['/inspections/today.js', 'renderToday'],
  inspect: ['/inspections/inspect.js', 'renderInspect'],
  fleet: ['/inspections/fleet.js', 'renderFleet'],
  reports: ['/inspections/reports.js', 'renderReports'],
  history: ['/inspections/history.js', 'renderHistory'],
};
const NEEDS_ID = { inspect: true, history: true };

// '#/inspections/inspect/12?e=vacant' -> { sub: 'inspect', id: '12', entry: 'vacant' }.
// Sous-ecran inconnu ou sans identifiant requis : Today, comme /inspections/.
export function parseInspHash(hash) {
  const rest = String(hash || '').replace(/^#\/?inspections\/?/, '');
  const cut = rest.indexOf('?');
  const path = cut === -1 ? rest : rest.slice(0, cut);
  const q = new URLSearchParams(cut === -1 ? '' : rest.slice(cut + 1));
  const parts = path.split('/').filter(Boolean);
  let sub = parts[0] || '';
  let id = null;
  if (!Object.prototype.hasOwnProperty.call(SUB, sub)) sub = '';
  if (NEEDS_ID[sub]) {
    try { id = parts[1] ? decodeURIComponent(parts[1]) : null; } catch (e) { id = null; }
    if (!id) sub = '';
  }
  return { sub, id: sub && NEEDS_ID[sub] ? id : null, entry: sub === 'inspect' ? (q.get('e') || null) : null };
}

// Hash relatif des modules Inspections ('#/', '#/fleet'...) -> hash de la coquille.
export function toShellHash(h) {
  const s = String(h || '#/').replace(/^#\/?/, '');
  return s ? '#/inspections/' + s : '#/inspections';
}

function go(h) {
  const t = toShellHash(h);
  // Meme hash : pas de hashchange natif, on relance la route a la main.
  if (location.hash === t) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = t;
}

// Rechargement complet : refait aussi cleanerMe (me) et evite un import de module en echec garde en cache.
function retry() { location.reload(); }

function message(ctx, text, withLink) {
  ctx.main.innerHTML = '<header class="top"><div><h1>Inspections</h1></div></header>'
    + '<div class="ph"><p role="alert">' + esc(text) + '</p><button class="btn primary" type="button" data-insp-retry>Retry</button>'
    + (withLink ? ' <a class="btn" href="/inspections/">Open Inspections</a>' : '') + '</div>';
  ctx.main.querySelector('[data-insp-retry]').onclick = retry;
}

export async function renderInspections(ctx) {
  if (!ctx.me) { message(ctx, 'Inspections need a connection. Check your connection and try again.', false); return; }
  const r = parseInspHash(location.hash);
  const [path, fn] = SUB[r.sub];
  let mod = null;
  try { mod = await import(path); } catch (e) { mod = null; }
  if (!ctx.isCurrent()) return;
  if (!mod || typeof mod[fn] !== 'function') { message(ctx, 'Could not load Inspections. Check your connection and try again.', true); return; }
  ctx.main.innerHTML = '<div id="view" class="insp"></div>';
  const host = ctx.main.querySelector('#view');
  // Les modules rendent un <main> : un seul <main> par page, on le change en <section>.
  const render = (html) => { host.innerHTML = String(html).replace(/<(\/?)main\b/g, '<$1section'); };
  // La visionneuse photo de history.js est un <dialog> pose sur <body> : on la ferme en quittant l'ecran.
  if (r.sub === 'history') ctx.onLeave(() => { document.querySelectorAll('body > dialog.photo').forEach((d) => { try { d.close(); } catch (e) { d.remove(); } }); });
  // go garde par isCurrent : une navigation tardive (fin d inspection lente apres changement d onglet) est ignoree.
  await mod[fn]({
    me: { cleaner_id: ctx.me.id, name: ctx.me.name, role: 'manager' },
    go: (h) => { if (ctx.isCurrent()) go(h); }, toast: (m) => toast(m), render, esc,
    isCurrent: ctx.isCurrent, onLeave: ctx.onLeave, embedded: true,
    listingId: r.id, entry: r.entry || 'adhoc',
  });
}
