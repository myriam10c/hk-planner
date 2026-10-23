// More > Apartment : recherche d'un logement (mgr.apartments) et sa fiche (mgr.apartment).
// Lecture seule. La fiche reprend menages, linge, tickets, inspections, contacts securite
// et le score de sante calcules par le proxy (mgr_apartment.ts) ; rien n'est recalcule ici.
// Les mots de passe de portail ne sortent pas de mgr.apartment : lien vers More > Security.
// Les references de tickets ouvrent Maintenance sur la fiche du ticket (#/maintenance?ref=).
import { get } from '/manager/api.js';
import { ddmm, esc, I, placeLabel } from '/manager/ui/dom.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRIO = { urgent: ['bad', 'Urgent'], high: ['warn', 'High'], normal: ['idle', 'Normal'], low: ['idle', 'Low'] };
const RESULT = { clean: ['ok', 'Clean'], fixed: ['idle', 'Fixed on the spot'], maintenance: ['bad', 'Maintenance'] };
const GAP = { cleanings: 'cleanings', tickets: 'tickets', inspections: 'inspections', security: 'security contacts' };

const fold = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const dayOf = (day) => DAYS[new Date(day + 'T00:00:00Z').getUTCDay()] + ' ' + ddmm(day);
// Jour de Dubai (UTC+4) d'un horodatage ISO.
function isoDay(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t + 4 * 3600000).toISOString().slice(0, 10) : '';
}
const pill = (tone, label) => '<span class="pill ' + tone + '">' + esc(label) + '</span>';

function header(title) {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>' + esc(title) + '</h1></div></header>';
}

function handleAccess(ctx, e) {
  if (e && e.kind === 'auth') { location.replace('/'); return true; }
  if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
  return false;
}

function errorHtml(title, msg) {
  return header(title) + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
    + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
}

// ---- liste ----
function matches(l, q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(['apt ' + l.apt, l.bld].join(' '));
  return words.every((w) => hay.includes(w));
}

function listRows(listings, q) {
  const rows = listings.filter((l) => matches(l, q));
  if (!rows.length) return '<p class="empty pad">' + (listings.length ? 'No apartment matches.' : 'No apartment yet.') + '</p>';
  return rows.map((l) => '<a class="ap-row" href="#/more/apartment/' + encodeURIComponent(l.id) + '">'
    + '<span class="ap-name">' + esc(placeLabel(l) || 'Listing ' + l.id) + '</span>'
    + (l.excluded ? pill('idle', 'Excluded') : '') + '<span class="more-chev">' + I.next + '</span></a>').join('');
}

async function renderList(ctx) {
  const main = ctx.main;
  const st = { listings: null, q: '' };
  async function load() {
    main.innerHTML = header('Apartment') + '<div class="ph"><p role="status">Loading apartments...</p></div>';
    try {
      const d = await get('mgr.apartments');
      if (!ctx.isCurrent()) return;
      st.listings = Array.isArray(d.listings) ? d.listings : [];
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(ctx, e)) return;
      main.innerHTML = errorHtml('Apartment', e.message || 'Could not load the apartments.');
      return;
    }
    main.innerHTML = header('Apartment') + '<div class="ap-page">'
      + '<label class="ap-search"><span class="ap-lbl">Search apartment or building</span>'
      + '<input id="apSearch" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + esc(st.q) + '"></label>'
      + '<div class="ap-list" id="apList">' + listRows(st.listings, st.q) + '</div></div>';
    const input = document.getElementById('apSearch');
    input.oninput = () => {
      st.q = input.value;
      document.getElementById('apList').innerHTML = listRows(st.listings, st.q);
    };
  }
  main.onclick = (ev) => {
    const t = ev.target.closest && ev.target.closest('[data-retry]');
    if (t && main.contains(t) && ctx.isCurrent()) load();
  };
  ctx.onLeave(() => { main.onclick = null; });
  await load();
}

// ---- fiche ----
function section(key, title, meta, body) {
  return '<section class="card ap-sec" data-sec="' + key + '"><div class="sec-head"><h2>' + esc(title) + '</h2>'
    + (meta ? '<span class="meta">' + esc(meta) + '</span>' : '') + '</div><div class="ap-body">' + body + '</div></section>';
}
const emptyOr = (d, key, list, empty, item) => {
  if (list.length) return '<ul class="ap-items">' + list.map((x) => '<li class="ap-item">' + item(x) + '</li>').join('') + '</ul>';
  if ((d.unavailable || []).includes(key)) return '<p class="ap-gap" role="status">Could not load ' + GAP[key] + ' right now.</p>';
  return '<p class="empty">' + empty + '</p>';
};

function healthHtml(d) {
  const h = d.health;
  const score = Math.round(Number(h.score) || 0);
  const tone = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'bad';
  const parts = [];
  if (h.openTickets) parts.push(plural(h.openTickets, 'open ticket') + ' (-' + h.openTickets * 5 + ')');
  if (h.urgentOpen) parts.push(h.urgentOpen + ' urgent or high (-' + h.urgentOpen * 10 + ')');
  if (h.overdueService) parts.push(plural(h.overdueService, 'overdue service') + ' (-' + h.overdueService * 8 + ')');
  if (h.ratingPenalty) parts.push('Rating -' + Math.round(h.ratingPenalty * 10) / 10);
  const body = '<div class="ap-health"><span class="ap-score st ' + tone + '">' + score + '</span><span class="ap-of">/ 100</span></div>'
    + (parts.length ? '<ul class="ap-parts">' + parts.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>'
      : '<p class="empty">Nothing lowers the score.</p>')
    + ((d.unavailable || []).includes('health') ? '<p class="ap-gap" role="status">Some data could not be loaded, the score may be off.</p>' : '');
  return section('health', 'Health', '', body);
}

// Menages : second appel (?part=cleanings), la fiche s'affiche sans attendre Hostaway.
// state = { loading } | { error } | { data: reponse du second appel }.
function cleaningsHtml(d, state) {
  const meta = 'Last 30 days and next 7';
  if (!state || state.loading) return section('cleanings', 'Cleanings', meta, '<p class="ap-gap" role="status">Loading cleanings...</p>');
  if (state.error) {
    return section('cleanings', 'Cleanings', meta, '<p class="ap-gap" role="alert">' + esc(state.error) + '</p>'
      + '<button class="btn" type="button" data-retry-cleanings>Retry</button>');
  }
  const c = state.data;
  return section('cleanings', 'Cleanings', meta, emptyOr(c, 'cleanings', c.cleanings || [], 'No cleaning in the last 30 days.', (c) => {
    const st = c.cancelled ? pill('idle', 'Cancelled') : c.done ? pill('ok', 'Done') : '';
    const what = [c.extra, c.guest].filter(Boolean).join(' · ') || 'Checkout cleaning';
    // Un menage annule n'a plus de personne a afficher : pas de « Unassigned ».
    const who = c.cancelled ? '' : (c.by.length ? c.by.join(', ') : 'Unassigned');
    const meta = [who, c.linen ? 'Linen ' + c.linen.total : ''].filter(Boolean).join(' · ');
    return '<div class="ap-line"><span class="ap-date mono">' + esc(dayOf(c.date)) + '</span>' + st + '</div>'
      + '<div class="ap-main">' + esc(what) + '</div>' + (meta ? '<div class="ap-sub">' + esc(meta) + '</div>' : '');
  }));
}

function refLink(ref) {
  return '<a class="ap-ref ap-link mono" href="#/maintenance?ref=' + encodeURIComponent(ref) + '">' + esc(ref) + '</a>';
}

function ticketsHtml(d) {
  const open = emptyOr(d, 'tickets', d.tickets.open, 'No open ticket.', (t) => {
    const p = PRIO[t.priority] || PRIO.normal;
    return '<div class="ap-line">' + refLink(t.ref) + pill(p[0], p[1]) + '</div>'
      + '<div class="ap-main">' + esc(t.title) + '</div>'
      + '<div class="ap-sub">' + esc(['Since ' + ddmm(isoDay(t.createdAt)), t.assignee || 'Unassigned'].join(' · ')) + '</div>';
  });
  const recent = emptyOr(d, 'tickets', d.tickets.recent, 'No ticket closed in the last 90 days.', (t) =>
    '<div class="ap-line">' + refLink(t.ref) + '<span class="ap-sub">Closed ' + esc(ddmm(isoDay(t.resolvedAt))) + '</span></div>'
    + '<div class="ap-main">' + esc(t.title) + '</div>');
  return section('open', 'Open tickets', d.tickets.open.length ? String(d.tickets.open.length) : '', open)
    + section('recent', 'Recent tickets', 'Closed in the last 90 days', recent);
}

function inspectionsHtml(d) {
  const list = emptyOr(d, 'inspections', d.inspections, 'No inspection yet.', (i) => {
    const r = RESULT[i.result] || RESULT.clean;
    return '<div class="ap-line"><span class="ap-date mono">' + esc(dayOf(isoDay(i.finishedAt))) + '</span>' + pill(r[0], r[1]) + '</div>'
      + '<div class="ap-sub">' + esc(i.inspector + ' · ' + (i.issues ? plural(i.issues, 'issue') : 'No issue')) + '</div>';
  });
  return section('inspections', 'Inspections', 'Last 5', list
    + '<a class="ap-link" href="#/inspections/history/' + encodeURIComponent(d.listing.id) + '">Inspection history</a>');
}

function securityHtml(d) {
  const s = d.security;
  let body;
  if (!s) {
    body = (d.unavailable || []).includes('security')
      ? '<p class="ap-gap" role="status">Could not load security contacts right now.</p>'
      : '<p class="empty">No security contact for this building.</p>';
  } else {
    body = '<p class="ap-main">' + esc(s.building) + '</p>' + s.groups.map((g) => {
      const digits = String(g.phone || '').replace(/\D/g, '');
      let h = '<div class="ap-group">';
      if (g.units.length) {
        h += '<div class="ap-units">' + g.units.map((u) => '<span class="ap-unit' + (String(u) === String(d.listing.apt) ? ' on' : '') + '">' + esc(u) + '</span>').join('') + '</div>';
      }
      if (g.phone) {
        h += '<div class="ap-contact"><span>' + esc(g.phone) + '</span>'
          + (digits ? '<a class="btn" href="tel:+' + digits + '" aria-label="Call ' + esc(g.phone) + '">Call</a>'
            + '<a class="btn" href="https://wa.me/' + digits + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>' : '') + '</div>';
      }
      for (const m of g.emails) h += '<a class="ap-link" href="mailto:' + esc(m) + '">' + esc(m) + '</a>';
      if (g.portal) h += '<a class="ap-link" href="' + esc(g.portal) + '" target="_blank" rel="noopener noreferrer">Portal</a>';
      if (g.notes.length) h += '<div class="ap-notes">' + g.notes.map((n) => pill('idle', n)).join('') + '</div>';
      if (!g.phone && !g.emails.length && !g.portal && !g.notes.length) h += '<p class="empty">No contact details.</p>';
      return h + '</div>';
    }).join('');
  }
  return section('security', 'Security contacts', '', body
    + '<a class="ap-link" href="#/more/security' + (s ? '?q=' + encodeURIComponent(s.building) : '') + '">Portal passwords and all buildings</a>');
}

async function renderSheet(ctx, id) {
  const main = ctx.main;
  let cl = { loading: true };
  let sheet = null;
  function paintSheet() {
    main.innerHTML = header(placeLabel(sheet.listing) || 'Apartment')
      + '<div class="ap-page">' + healthHtml(sheet) + cleaningsHtml(sheet, cl) + ticketsHtml(sheet) + inspectionsHtml(sheet) + securityHtml(sheet) + '</div>';
  }
  async function loadCleanings() {
    cl = { loading: true };
    const el = main.querySelector('[data-sec="cleanings"]');
    if (el && sheet) paintSheet();
    try {
      const c = await get('mgr.apartment', { listingId: id, part: 'cleanings' });
      if (!ctx.isCurrent()) return;
      cl = { data: c };
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(ctx, e)) return;
      cl = { error: e.message || 'Could not load the cleanings.' };
    }
    if (sheet) paintSheet();
  }
  async function load() {
    main.innerHTML = header('Apartment') + '<div class="ph"><p role="status">Loading apartment...</p></div>';
    let d;
    try {
      d = await get('mgr.apartment', { listingId: id });
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(ctx, e)) return;
      main.innerHTML = errorHtml('Apartment', e.message || 'Could not load this apartment.');
      return;
    }
    if (!ctx.isCurrent()) return;
    sheet = d;
    cl = { loading: true };
    paintSheet();
    loadCleanings();
  }
  main.onclick = (ev) => {
    if (!ctx.isCurrent() || !ev.target.closest) return;
    const t = ev.target.closest('[data-retry]');
    if (t && main.contains(t)) { load(); return; }
    const c = ev.target.closest('[data-retry-cleanings]');
    if (c && main.contains(c)) loadCleanings();
  };
  ctx.onLeave(() => { main.onclick = null; });
  await load();
}

export async function renderApartment(ctx, id) {
  if (id) await renderSheet(ctx, id); else await renderList(ctx);
}
