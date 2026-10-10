// More : page d accueil et sous-routes (#/more, #/more/<section>[/<id>]).
// Chaque section vit dans /manager/screens/more-<section>.js et exporte render<Section>(ctx, id).
import { esc, I } from '/manager/ui/dom.js';

const SECTIONS = {
  settings: ['/manager/screens/more-settings.js', 'renderSettings'],
  team: ['/manager/screens/more-team.js', 'renderTeam'],
  reviews: ['/manager/screens/more-reviews.js', 'renderReviews'],
  apartment: ['/manager/screens/more-apartment.js', 'renderApartment'],
};

const LEGACY = 'In the current app for now';
const ROWS = [
  { title: 'Team', desc: 'Accounts, roles and invitations', href: '#/more/team' },
  { title: 'Apartment', desc: 'One sheet per apartment: cleanings, linen, tickets, inspections, security contacts', href: '#/more/apartment' },
  { title: 'Reviews', desc: 'Review disputes', href: '#/more/reviews' },
  { title: 'Settings', desc: 'Autopilot, notifications, inspection target, checklists', href: '#/more/settings' },
  { title: 'HR and leave', desc: LEGACY, href: '/?legacy=1', legacy: true },
  { title: 'Ratings and stats', desc: LEGACY, href: '/?legacy=1', legacy: true },
  { title: 'Maintenance setup', desc: LEGACY, href: '/?legacy=1', legacy: true },
  { title: 'Reports', desc: LEGACY, href: '/?legacy=1', legacy: true },
];

// '#/more/apartment/123' -> { section: 'apartment', id: '123' }. Section inconnue : hub ('').
// L'identifiant n'existe que pour apartment, decode ; encodage invalide -> null.
export function parseMoreHash(hash) {
  const rest = String(hash || '').replace(/^#\/?more\/?/, '');
  const cut = rest.search(/[?]/);
  const path = cut === -1 ? rest : rest.slice(0, cut);
  const parts = path.split('/').filter(Boolean);
  let section = parts[0] || '';
  if (!Object.prototype.hasOwnProperty.call(SECTIONS, section)) section = '';
  let id = null;
  if (section === 'apartment' && parts[1]) {
    try { id = decodeURIComponent(parts[1]); } catch (e) { id = null; }
  }
  return { section, id };
}

function hub(ctx) {
  const rows = ROWS.map((r) => '<a class="more-row" href="' + esc(r.href) + '">'
    + '<span class="more-txt"><span class="more-title">' + esc(r.title)
    + (r.legacy ? ' <span class="pill idle">Current app</span>' : '') + '</span>'
    + '<span class="more-desc">' + esc(r.desc) + '</span></span>'
    + '<span class="more-chev">' + I.next + '</span></a>').join('');
  const name = ctx.me && ctx.me.name ? ctx.me.name : '';
  ctx.main.innerHTML = '<header class="top"><div><h1>More</h1></div></header>'
    + '<div class="more">' + rows + '</div>'
    + '<footer class="more-foot"><span>' + (name ? 'Signed in as ' + esc(name) : '') + '</span>'
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></footer>';
}

function failure(ctx) {
  ctx.main.innerHTML = '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a></div></header>'
    + '<div class="ph"><p role="alert">Could not load this section.</p>'
    + '<button class="btn primary" type="button" data-more-retry>Retry</button> '
    + '<a class="btn" href="/?legacy=1">Open the current app</a></div>';
  // Rechargement complet : evite aussi un import en echec garde en cache.
  ctx.main.querySelector('[data-more-retry]').onclick = () => location.reload();
}

export async function renderMore(ctx) {
  const r = parseMoreHash(location.hash);
  if (!r.section) { hub(ctx); return; }
  const [path, fn] = SECTIONS[r.section];
  let mod = null;
  try { mod = await import(path); } catch (e) { mod = null; }
  if (!ctx.isCurrent()) return;
  if (!mod || typeof mod[fn] !== 'function') { failure(ctx); return; }
  await mod[fn](ctx, r.id);
}
