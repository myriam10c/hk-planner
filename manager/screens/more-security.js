// More > Security : contacts securite de tous les immeubles, en un clic (23/10/2026).
// Meme source que l'onglet Security de l'app actuelle : getSecurityContacts (security_contacts.ts),
// le document entier, identifiants et mots de passe de portail compris (choix de Hillal).
// Recherche par immeuble, numero, email ou telephone. '#/more/security?q=<texte>' pre-remplit
// la recherche (lien depuis la fiche d'un appartement). Lecture seule.
import { get } from '/manager/api.js';
import { esc, I, toast } from '/manager/ui/dom.js';

const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Security</h1></div></header>';
}

function handleAccess(ctx, e) {
  if (e && e.kind === 'auth') { location.replace('/'); return true; }
  if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
  return false;
}

function queryFromHash() {
  const m = String(location.hash || '').match(/[?&]q=([^&]*)/);
  if (!m) return '';
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return ''; }
}

// Chaque mot doit se trouver dans l'immeuble ou dans un de ses groupes (numeros, emails, telephone).
function matches(b, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([b.name].concat((b.groups || []).flatMap((g) => (g.units || []).concat(g.emails || [], [g.phone || '', g.phoneDigits || '']))).join(' '));
  return words.every((w) => hay.includes(w));
}

function credRow(label, value) {
  return '<div class="sc-cred"><span class="sc-lbl">' + label + '</span><span class="sc-val">' + esc(value) + '</span>'
    + '<button class="btn" type="button" data-copy="' + esc(value) + '" aria-label="Copy ' + label.toLowerCase() + '">Copy</button></div>';
}

function groupHtml(g) {
  const digits = String(g.phoneDigits || g.phone || '').replace(/\D/g, '');
  let h = '<div class="ap-group">';
  if ((g.units || []).length) h += '<div class="ap-units">' + g.units.map((u) => '<span class="ap-unit">' + esc(u) + '</span>').join('') + '</div>';
  if (g.phone || digits) {
    h += '<div class="ap-contact"><span>' + esc(g.phone || digits) + '</span>'
      + (digits ? '<a class="btn" href="tel:+' + digits + '" aria-label="Call ' + esc(g.phone || digits) + '">Call</a>'
        + '<a class="btn" href="https://wa.me/' + digits + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>' : '') + '</div>';
  }
  for (const m of g.emails || []) h += '<a class="ap-link" href="mailto:' + esc(m) + '">' + esc(m) + '</a>';
  if (g.portal) h += '<a class="ap-link" href="' + esc(g.portal) + '" target="_blank" rel="noopener noreferrer">Portal</a>';
  if (g.portalId) h += credRow('ID', g.portalId);
  if (g.portalPassword) h += credRow('Password', g.portalPassword);
  if ((g.notes || []).length) h += '<div class="ap-notes">' + g.notes.map((n) => '<span class="pill idle">' + esc(n) + '</span>').join('') + '</div>';
  const docs = (g.unitLinks || []).filter((ul) => ul.dtcm || ul.det);
  if (docs.length) {
    h += '<div class="sc-docs">' + docs.map((ul) => '<span class="ap-unit">' + esc(ul.unit) + '</span>'
      + (ul.dtcm ? '<a class="ap-link" href="' + esc(ul.dtcm) + '" target="_blank" rel="noopener noreferrer">Permit</a>' : '')
      + (ul.det ? '<a class="ap-link" href="' + esc(ul.det) + '" target="_blank" rel="noopener noreferrer">DET</a>' : '')).join('') + '</div>';
  }
  return h + '</div>';
}

function buildingHtml(b) {
  const units = (b.groups || []).reduce((s, g) => s + (g.units || []).length, 0);
  return '<section class="card ap-sec"><div class="sec-head"><h2>' + esc(b.name) + '</h2><span class="meta">' + plural(units, 'unit') + '</span></div>'
    + '<div class="ap-body">' + ((b.groups || []).length ? b.groups.map(groupHtml).join('') : '<p class="empty">No contact details.</p>') + '</div></section>';
}

function listHtml(buildings, q) {
  const rows = buildings.filter((b) => matches(b, q));
  if (!rows.length) return '<p class="empty pad">' + (buildings.length ? 'No building matches.' : 'No security contact yet.') + '</p>';
  return rows.map(buildingHtml).join('');
}

export async function renderSecurity(ctx) {
  const main = ctx.main;
  const st = { buildings: null, q: queryFromHash() };
  async function load() {
    main.innerHTML = header() + '<div class="ph"><p role="status">Loading security contacts...</p></div>';
    try {
      const d = await get('getSecurityContacts');
      if (!ctx.isCurrent()) return;
      st.buildings = Array.isArray(d.buildings) ? d.buildings : [];
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(ctx, e)) return;
      main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(e.message || 'Could not load the security contacts.') + '</p>'
        + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
      return;
    }
    main.innerHTML = header() + '<div class="ap-page">'
      + '<label class="ap-search"><span class="ap-lbl">Search building, unit, email or phone</span>'
      + '<input id="scSearch" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(st.q) + '"></label>'
      + '<div class="ap-list" id="scList">' + listHtml(st.buildings, st.q) + '</div></div>';
    const input = document.getElementById('scSearch');
    input.oninput = () => {
      st.q = input.value;
      document.getElementById('scList').innerHTML = listHtml(st.buildings, st.q);
    };
  }
  async function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('no clipboard');
      toast('Copied');
    } catch (e) { toast('Could not copy. Select the text instead.'); }
  }
  main.onclick = (ev) => {
    if (!ctx.isCurrent() || !ev.target.closest) return;
    const t = ev.target.closest('button');
    if (!t || !main.contains(t)) return;
    if (t.hasAttribute('data-retry')) { load(); return; }
    if (t.hasAttribute('data-copy')) copy(t.getAttribute('data-copy'));
  };
  ctx.onLeave(() => { main.onclick = null; });
  await load();
}
