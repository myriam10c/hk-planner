// Ecran Maintenance : HTML pur (en-tete, onglets, cartes de propositions, lignes de
// tickets, feuilles de proposition). Aucun appel reseau ici. Chaque feuille porte
// data-mref="<REF>" pour que maintenance.js sache ce qui est affiche.
import { addDays, ddmm, dubaiTime, dubaiToday, esc, I, placeLabel } from '/manager/ui/dom.js';

export const RO_LINE = 'Reconnect to make changes.';
// Memes libelles et meme ordre que MNT_CATEGORY_LABEL (mnt_rules.ts).
export const CATEGORY = {
  ac: 'AC', plumbing: 'Plumbing', electrical: 'Electrical', appliance: 'Appliance', lock_door: 'Lock or door',
  wifi_tv: 'Wi-Fi or TV', hot_water: 'Hot water', pest: 'Pests', furniture: 'Furniture', other: 'Other',
};
export const REASON = { not_maintenance: 'Not maintenance', already_fixed: 'Already fixed', duplicate: 'Duplicate', other: 'Other' };
const URGENCY = [['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal']];
const PRIORITY = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low' };
const ORIGIN = { guest_message: 'Guest message', cleaner_report: 'Cleaner report', inspection: 'Inspection', manual: 'Manual' };
const STAGES = [['todo', 'To do'], ['in_progress', 'In progress'], ['waiting_parts', 'Waiting parts'], ['to_confirm', 'To confirm']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Jour de Dubai d'un instant ISO, '' si illisible.
function dayOf(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? dubaiToday(t) : '';
}
// Heure d'une proposition : HH:MM aujourd'hui, Yesterday, sinon jj/mm.
export function whenShort(iso, nowMs) {
  const d = dayOf(iso);
  if (!d) return '';
  const today = dubaiToday(nowMs);
  if (d === today) return dubaiTime(iso);
  if (d === addDays(today, -1)) return 'Yesterday';
  return ddmm(d);
}
function dayMon(day) { return Number(day.slice(8, 10)) + ' ' + MONTHS[Number(day.slice(5, 7)) - 1]; }
// Sejour : « 11 to 15 Oct », ou « 28 Sep to 3 Oct ».
export function stayLine(from, to) {
  if (!from || !to) return '';
  const a = from.slice(5, 7) === to.slice(5, 7) ? String(Number(from.slice(8, 10))) : dayMon(from);
  return a + ' to ' + dayMon(to);
}
// Age d'un ticket : « 40 min ago », « 3 h ago », « 2 d ago ».
export function ageOf(iso, nowMs) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.floor((nowMs - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  if (m < 1440) return Math.floor(m / 60) + ' h ago';
  return Math.floor(m / 1440) + ' d ago';
}
function weekdayDay(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  try {
    const p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric' })
      .formatToParts(new Date(t)).forEach((x) => { p[x.type] = x.value; });
    return p.weekday + ' ' + p.day;
  } catch (e) { return ddmm(dayOf(iso)); }
}
// Cout reel seulement : null reste vide, 0 est un vrai cout.
export function costText(n) {
  if (n === null || n === undefined || (typeof n === 'string' && !n.trim()) || typeof n === 'boolean') return '';
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return 'AED ' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}
const quoteText = (t) => '“' + esc(t) + '”';
// Citation traduite en anglais par la detection : on le dit, l'original reste en base.
const trTag = (q) => (q && q.original ? ' <span class="mt-tr">Translated</span>' : '');
function hostawayUrl(id) { return 'https://dashboard.hostaway.com/v3/messages/inbox/' + encodeURIComponent(id); }
// Android : lien d'intention vers l'app Hostaway (paquet com.fi.hostaway), le site
// en secours si l'app n'est pas installee. iPhone et ordinateur : le site (l'app iOS
// ne declare aucun lien de conversation).
export function hostawayHref(id, ua) {
  const web = hostawayUrl(id);
  if (!/Android/i.test(ua || '')) return web;
  return 'intent://dashboard.hostaway.com/v3/messages/inbox/' + encodeURIComponent(id)
    + '#Intent;scheme=https;package=com.fi.hostaway;S.browser_fallback_url=' + encodeURIComponent(web) + ';end';
}
const UA = typeof navigator !== 'undefined' ? navigator.userAgent : '';
function placeCat(p) { return [placeLabel(p), p.categoryLabel || CATEGORY[p.category] || ''].filter(Boolean).join(' · '); }

// Liens de sortie du role maintenance (Semax), en bas de l'ecran : ses autres apps.
const LINKS = [['/inspections/', 'Inspections'], ['/v3/', 'Field app'], ['/?legacy=1', 'Old app (until 10 Nov)']];
export function linksHtml() {
  return '<nav class="mt-links" aria-labelledby="mtLinksH"><h2 class="mt-label" id="mtLinksH">Links</h2><div class="mt-linkrow">'
    + LINKS.map(([href, label]) => '<a class="mt-outlink" href="' + esc(href) + '">' + esc(label) + '</a>').join('') + '</div></nav>';
}

export function shellHtml(withLinks) {
  return '<header class="top mt-top"><div><h1>Maintenance</h1><div class="asof" id="mtAsof" hidden></div></div>'
    + '<div class="mt-topbtns"><button class="btn mt-btn" type="button" data-new>+ New ticket</button>'
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></div></header>'
    + '<nav class="mt-tabs" id="mtTabs" aria-label="Maintenance views"></nav>'
    + '<div id="mtBanner"></div>'
    + '<div class="mt-tools" id="mtTools" hidden><div class="mt-chips" id="mtChips" role="group" aria-label="Filters"></div>'
    + '<label class="sr" for="mtSearch">Search apartment</label>'
    + '<input id="mtSearch" class="mt-search" type="search" placeholder="Search apartment" autocomplete="off"></div>'
    + '<div id="mtList"></div>' + (withLinks ? linksHtml() : '');
}

export function tabsHtml(tab, counts) {
  const c = counts || null;
  const btn = (k, inner) => '<button type="button" class="mt-tab" data-tab="' + k + '" aria-pressed="' + (tab === k ? 'true' : 'false') + '">' + inner + '</button>';
  const n = c ? Number(c.proposals) || 0 : 0;
  return btn('proposals', 'Proposals' + (n > 0 ? ' <span class="mt-count" aria-label="' + n + ' to review">' + n + '</span>' : ''))
    + btn('open', 'Open' + (c ? ' · <span class="tnum">' + (Number(c.open) || 0) + '</span>' : ''))
    + btn('done', 'Done');
}

export function chipsHtml(filter, counts) {
  const c = counts || {};
  const chip = (k, label) => '<button class="mt-chip" type="button" data-filter="' + k + '" aria-pressed="' + (filter === k ? 'true' : 'false') + '">'
    + esc(label) + ' · <span class="tnum">' + (Number(c[k]) || 0) + '</span></button>';
  return chip('mine', 'Mine') + chip('urgent', 'Urgent') + chip('unassigned', 'Unassigned');
}

export function bannerHtml(entry, error, loading) {
  if (!entry || entry.fresh) return '';
  const when = dubaiTime(new Date(entry.savedAt).toISOString());
  if (error) {
    return '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(error.message)
      + '</span><button class="btn mt-btn" type="button" data-retry>Retry</button></div>';
  }
  if (loading) return '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.</span></div>';
  return '';
}

function loadingOrError(error, what) {
  if (error) return '<div class="err-card" role="alert"><p>' + esc(error.message) + '</p><button class="btn primary mt-btn" type="button" data-retry>Retry</button></div>';
  return '<p class="boot" role="status">Loading ' + what + '…</p>';
}

// --- Propositions ---------------------------------------------------------

function pills(p) {
  let h = '';
  if (p.urgency === 'urgent') h += '<span class="pill bad">Urgent</span>';
  else if (p.urgency === 'high') h += '<span class="pill warn">High</span>';
  if (p.guestInNow) h += '<span class="pill ok">Guest in now</span>';
  if (p.openTicket) h += '<span class="pill warn">Already open: ' + esc(p.openTicket.ref) + '</span>';
  return h;
}
function guestLine(p) {
  const stay = stayLine(p.stayFrom, p.stayTo);
  const link = p.conversationId
    ? (/Android/i.test(UA)
      ? '<a href="' + esc(hostawayHref(p.conversationId, UA)) + '" data-hostaway>Open in Hostaway</a>'
      : '<a href="' + esc(hostawayUrl(p.conversationId)) + '" target="_blank" rel="noopener" data-hostaway>Open in Hostaway</a>') : '';
  // Prenom du guest s'il est connu, sinon « Guest ».
  const first = String(p.guestName || '').trim().split(/\s+/)[0] || 'Guest';
  return [esc(first) + (stay ? ', ' + esc(stay) : ''), link].filter(Boolean).join(' · ');
}
function lastQuote(p) { return p.quotes && p.quotes.length ? p.quotes[p.quotes.length - 1] : null; }
function quoteAt(p) { const q = lastQuote(p); return (q && q.at) || p.createdAt; }

export function proposalCard(p, nowMs) {
  const q = lastQuote(p);
  const ref = esc(p.ref);
  let h = '<article class="mt-card" data-prp="' + ref + '">'
    + '<div class="mt-pills">' + pills(p) + '<span class="mt-time">' + esc(whenShort(quoteAt(p), nowMs)) + '</span></div>'
    + '<div><div class="mt-ttl">' + esc(p.title) + '</div><div class="mt-where">' + esc(placeCat(p)) + '</div></div>';
  h += '<blockquote class="mt-quote">' + (q ? '<span class="mt-qtext">' + quoteText(q.text) + '</span>' + trTag(q) : '')
    + '<span class="mt-qmeta">' + guestLine(p) + '</span></blockquote>';
  if (p.openTicket) {
    h += '<div class="mt-actions"><button class="btn primary mt-btn mt-grow" type="button" data-merge data-ref="' + ref + '" data-tid="'
      + esc(p.openTicket.id) + '" data-tref="' + esc(p.openTicket.ref) + '">Add to ' + esc(p.openTicket.ref) + '</button>'
      + '<button class="btn mt-btn" type="button" data-more-prp data-ref="' + ref + '">More</button></div>';
  } else {
    h += '<div class="mt-actions"><button class="btn primary mt-btn mt-grow" type="button" data-create data-ref="' + ref + '">Create ticket</button>'
      + '<button class="btn mt-btn" type="button" data-reject data-ref="' + ref + '">Reject</button></div>';
  }
  return h + '</article>';
}

export function proposalsHtml(entry, error, nowMs) {
  if (!entry) return loadingOrError(error, 'proposals');
  const rows = entry.data.proposals;
  let h = '<p class="mt-help">Found by Claude in Hostaway guest messages. Check, then create a ticket or reject.</p>';
  h += rows.length ? '<div class="mt-cards">' + rows.map((p) => proposalCard(p, nowMs)).join('') + '</div>'
    : '<div class="ph"><p>No proposal to check.</p></div>';
  return h + '<p class="mt-foot"><button class="link mt-link" type="button" data-see-rejected>See rejected</button></p>';
}

function decidedLine(p) {
  const by = p.decidedBy ? ' by ' + esc(p.decidedBy) : '';
  const day = p.decidedAt ? ', ' + esc(ddmm(dayOf(p.decidedAt))) : '';
  if (p.status === 'merged') return 'Added to ' + esc(p.ticket ? p.ticket.ref : 'a ticket') + by + day;
  if (p.status === 'accepted') return 'Ticket ' + esc(p.ticket ? p.ticket.ref : '') + ' created' + by + day;
  return 'Rejected' + by + day + (p.rejectReason ? ' · ' + esc(REASON[p.rejectReason] || p.rejectReason) : '');
}

export function rejectedHtml(entry, error) {
  let h = '<div class="mt-subhead"><button class="link mt-link" type="button" data-back-proposals>Back to proposals</button>'
    + '<span class="t3">Rejected and merged, last 30 days</span></div>';
  if (!entry) return h + loadingOrError(error, 'rejected proposals');
  const rows = entry.data.proposals;
  if (!rows.length) return h + '<div class="ph"><p>Nothing rejected in the last 30 days.</p></div>';
  return h + '<div class="mt-cards">' + rows.map((p) => '<article class="mt-card mt-ro" data-prp="' + esc(p.ref) + '">'
    + '<div><div class="mt-ttl">' + esc(p.title) + '</div><div class="mt-where">' + esc(placeCat(p)) + '</div></div>'
    + '<div class="mt-line">' + decidedLine(p) + '</div>'
    + (p.rejectNote ? '<div class="mt-note">' + quoteText(p.rejectNote) + '</div>' : '') + '</article>').join('') + '</div>';
}

// --- Tickets ouverts et faits -----------------------------------------------

function dueOrAge(t, nowMs) {
  if (t.dueOn) {
    const today = dubaiToday(nowMs);
    if (t.dueOn < today) return '<span class="mt-bad">Overdue ' + esc(ddmm(t.dueOn)) + '</span>';
    if (t.dueOn === today) return 'Due today';
    return 'Due ' + esc(ddmm(t.dueOn));
  }
  return esc(ageOf(t.createdAt, nowMs));
}
export function ticketRow(t, nowMs) {
  const prio = PRIORITY[t.priority] ? t.priority : 'medium';
  return '<button class="mt-row" type="button" data-ticket="' + esc(t.ref) + '">'
    + '<span class="mt-bar mt-p-' + prio + '" aria-hidden="true"></span><span class="mt-rmain">'
    + '<span class="mt-rl1"><b class="mt-rttl">' + esc(t.title) + '</b><span class="mono mt-ref">' + esc(t.ref) + '</span></span>'
    + (t.apt || t.bld ? '<span class="mt-where">' + esc(placeLabel(t)) + '</span>' : '')
    + '<span class="mt-meta"><span' + (prio === 'urgent' ? ' class="mt-bad"' : '') + '>' + esc(PRIORITY[prio]) + '</span> · ' + dueOrAge(t, nowMs)
    + ' · <span class="mt-origin">' + esc(ORIGIN[t.origin] || 'Manual') + '</span></span></span></button>';
}

export function openHtml(entry, error, filtered, nowMs) {
  if (!entry) return loadingOrError(error, 'tickets');
  const rows = entry.data.tickets;
  if (!rows.length) {
    return '<div class="ph"><p>' + (filtered ? 'Nothing matches these filters.' : 'Nothing open.') + '</p>'
      + (filtered ? '<button class="btn mt-btn" type="button" data-clear>Clear filters</button>' : '') + '</div>';
  }
  return STAGES.map(([k, label]) => {
    const g = rows.filter((t) => t.stage === k);
    if (!g.length) return '';
    return '<section class="mt-group" aria-label="' + esc(label) + '"><h2 class="mt-gh">' + esc(label) + ' <span class="tnum">' + g.length + '</span></h2>'
      + '<div class="mt-rows">' + g.map((t) => ticketRow(t, nowMs)).join('') + '</div></section>';
  }).join('');
}

function doneLine(t) {
  const who = t.resolvedBy || (t.assignee ? t.assignee.name : '');
  const day = weekdayDay(t.resolvedAt);
  let s = 'Done' + (who ? ' by ' + esc(who) : '') + (day ? (who ? ', ' : ' ') + esc(day) : '');
  const cost = costText(t.actualCost);
  if (cost) s += ' · ' + esc(cost);
  return s;
}
export function doneRow(t) {
  return '<article class="mt-done" data-done="' + esc(t.ref) + '">'
    + '<button class="mt-dmain" type="button" data-ticket="' + esc(t.ref) + '">'
    + '<span class="mt-rl1"><b class="mt-rttl">' + esc(t.title) + '</b><span class="mono mt-ref">' + esc(t.ref) + '</span></span>'
    + (t.apt || t.bld ? '<span class="mt-where">' + esc(placeLabel(t)) + '</span>' : '')
    + '<span class="mt-meta">' + doneLine(t) + '</span>'
    + (t.resolutionNotes ? '<span class="mt-note">' + quoteText(t.resolutionNotes) + '</span>' : '') + '</button>'
    + '<div class="mt-dfoot"><button class="btn mt-btn" type="button" data-reopen data-ref="' + esc(t.ref) + '" data-id="' + esc(t.id) + '">Reopen</button></div>'
    + '</article>';
}
export function doneHtml(entry, error) {
  if (!entry) return loadingOrError(error, 'done tickets');
  const rows = entry.data.tickets;
  const n = rows.length;
  let h = '<p class="mt-help">Last 30 days · <span class="tnum">' + n + '</span> ' + (n === 1 ? 'ticket' : 'tickets') + '</p>';
  if (!n) return h + '<div class="ph"><p>Nothing done in the last 30 days.</p></div>';
  return h + '<div class="mt-cards">' + rows.map(doneRow).join('') + '</div>';
}

// --- Feuilles -----------------------------------------------------------------

function head(ref, title, sub) {
  return '<div class="sheet-h"' + (ref ? ' data-mref="' + esc(ref) + '"' : '') + '><div><h2 id="sheetTitle">' + esc(title) + '</h2>'
    + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '') + '</div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
function quotesHtml(p) {
  if (!p.quotes || !p.quotes.length) return '';
  return '<div class="mt-quotes">' + p.quotes.map((q) => '<blockquote class="mt-quote"><span class="mt-qtext">' + quoteText(q.text) + '</span>' + trTag(q) + '</blockquote>').join('') + '</div>';
}
const roFoot = (label) => '<div class="sheet-f"><p class="ro-note" role="status">' + RO_LINE + '</p><button class="btn mt-btn" type="button" data-close>' + label + '</button></div>';

// Feuille d'une proposition (bouton More, lien PRP) : citations, contexte, gestes.
export function proposalSheet(p, ro, others) {
  let b = '<div class="mt-pills">' + pills(p) + '</div>' + quotesHtml(p)
    + '<p class="mt-qmeta">' + guestLine(p) + '</p>';
  const pending = p.status === 'pending';
  if (!pending) b += '<p class="mt-line">' + decidedLine(p) + '</p>' + (p.rejectNote ? '<p class="mt-note">' + quoteText(p.rejectNote) + '</p>' : '');
  const merges = [];
  if (p.openTicket) merges.push(p.openTicket);
  for (const t of others || []) if (!merges.some((m) => m.id === t.id)) merges.push(t);
  if (pending && merges.length && !ro) {
    b += '<div class="mt-merges"><h3 class="mt-label">Open tickets in this apartment</h3>' + merges.map((t) =>
      '<button class="btn mt-btn mt-mergebtn" type="button" data-mact="merge" data-tid="' + esc(t.id) + '" data-tref="' + esc(t.ref) + '">'
      + 'Add to ' + esc(t.ref) + '<span class="t3"> · ' + esc(t.title) + '</span></button>').join('') + '</div>';
  }
  let f;
  if (!pending) f = '<div class="sheet-f"><button class="btn mt-btn" type="button" data-close>Close</button></div>';
  else if (ro) f = roFoot('Close');
  else {
    f = '<div class="sheet-f"><button class="btn primary mt-btn" type="button" data-mact="create">Create ticket</button>'
      + '<button class="btn mt-btn" type="button" data-mact="reject">Reject</button>'
      + '<button class="btn mt-btn" type="button" data-close>Close</button></div>';
  }
  return head(p.ref, p.title, [p.ref, placeCat(p)].filter(Boolean).join(' · ')) + '<div class="sheet-b">' + b + '</div>' + f;
}

function sortListings(ls) {
  return ls.slice().sort((a, b) => String(a.bld).localeCompare(String(b.bld))
    || String(a.apt).localeCompare(String(b.apt), undefined, { numeric: true }) || String(a.id).localeCompare(String(b.id)));
}

// Choix par defaut de « Who follows it » : le membre maintenance actif, sinon le premier.
export function defaultWho(team) {
  const m = (team || []).find((x) => x.role === 'maintenance') || (team || [])[0];
  return m ? 'm:' + m.id : 'none';
}

// Champs d'un ticket (Create ticket et + New ticket) : titre, appartement, categorie,
// urgence, intervenant, note. pre : valeurs de depart (proposition ou ticket neuf).
function ticketFields(pre, meta) {
  const ls = sortListings(meta.listings || []);
  if (pre.listingId && !ls.some((l) => l.id === pre.listingId)) ls.unshift({ id: pre.listingId, apt: pre.apt, bld: pre.bld });
  const apt = '<select id="mtApt" class="mt-input">' + (pre.listingId ? '' : '<option value="">Choose an apartment</option>')
    + ls.map((l) => '<option value="' + esc(l.id) + '"' + (l.id === pre.listingId ? ' selected' : '') + '>' + esc(placeLabel(l) || 'Listing ' + l.id) + '</option>').join('') + '</select>';
  const cat = '<select id="mtCat" class="mt-input">' + Object.keys(CATEGORY).map((k) =>
    '<option value="' + k + '"' + (k === pre.category ? ' selected' : '') + '>' + esc(CATEGORY[k]) + '</option>').join('') + '</select>';
  const urg = URGENCY.some(([k]) => k === pre.urgency) ? pre.urgency : 'normal';
  const seg = '<div class="mt-seg" role="group" aria-label="Urgency">' + URGENCY.map(([k, l]) =>
    '<button type="button" class="mt-segbtn mt-u-' + k + '" data-mact="urg" data-urg="' + k + '" aria-pressed="' + (k === urg ? 'true' : 'false') + '">' + l + '</button>').join('') + '</div>';
  const who = defaultWho(meta.team);
  const chip = (v, label) => '<button type="button" class="mt-chip" data-mact="who" data-who="' + esc(v) + '" aria-pressed="' + (v === who ? 'true' : 'false') + '">' + label + '</button>';
  const chips = '<div class="mt-whos" role="group" aria-label="Who follows it">'
    + (meta.team || []).map((m) => chip('m:' + m.id, esc(m.name))).join('')
    + ((meta.vendors || []).length ? chip('vendor', 'Vendor') : '') + chip('none', 'Nobody yet') + '</div>'
    + '<div id="mtVendorBox" hidden><label class="mt-label" for="mtVendor">Vendor</label><select id="mtVendor" class="mt-input"><option value="">Choose a vendor</option>'
    + (meta.vendors || []).map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>').join('') + '</select></div>';
  return '<div class="mt-field"><label class="mt-label" for="mtTitle">Title</label><input id="mtTitle" class="mt-input" type="text" maxlength="120" value="' + esc(pre.title || '') + '"></div>'
    + '<div class="mt-field"><label class="mt-label" for="mtApt">Apartment</label>' + apt + '</div>'
    + '<div class="mt-two"><div class="mt-field"><label class="mt-label" for="mtCat">Category</label>' + cat + '</div>'
    + '<div class="mt-field"><span class="mt-label">Urgency</span>' + seg + '</div></div>'
    + '<div class="mt-field"><span class="mt-label">Who follows it</span>' + chips + '</div>'
    + '<div class="mt-field"><label class="mt-label" for="mtNote">Note (optional)</label><textarea id="mtNote" class="mt-input mt-text" rows="2" maxlength="2000"></textarea></div>';
}

// Feuille Create ticket (maquette 2) : champs pre-remplis depuis la proposition.
export function createSheet(p, meta, ro, from) {
  const sub = 'From a guest message, ' + whenShort(quoteAt(p), Date.now());
  if (ro) return head(p.ref, 'Create ticket', sub) + '<div class="sheet-b">' + quotesHtml(p) + '</div>' + roFoot('Close');
  return head(p.ref, 'Create ticket', sub) + '<div class="sheet-b">' + quotesHtml(p) + ticketFields(p, meta) + '</div>'
    + '<div class="sheet-f"><button class="btn primary mt-btn mt-grow" type="button" data-mact="accept-send">Create ticket</button>'
    + '<button class="btn mt-btn" type="button" data-mact="back">Back</button></div>';
}

// Feuille + New ticket : memes champs, vides ; marquee data-mnew (aucune reference dans le hash).
export function newTicketSheet(meta) {
  return '<div class="sheet-h" data-mnew><div><h2 id="sheetTitle">New ticket</h2></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>'
    + '<div class="sheet-b">' + ticketFields({ title: '', listingId: null, category: 'other', urgency: 'normal' }, meta) + '</div>'
    + '<div class="sheet-f"><button class="btn primary mt-btn mt-grow" type="button" data-mact="new-send">Create ticket</button>'
    + '<button class="btn mt-btn" type="button" data-close>Cancel</button></div>';
}

// Feuille Reject : raison obligatoire, texte obligatoire pour Other.
export function rejectSheet(p, ro) {
  if (ro) return head(p.ref, 'Reject proposal', p.title) + '<div class="sheet-b"></div>' + roFoot('Close');
  const b = '<div class="mt-field"><span class="mt-label">Why</span><div class="mt-whos" role="group" aria-label="Reason">'
    + Object.keys(REASON).map((k) => '<button type="button" class="mt-chip" data-mact="reason" data-reason="' + k + '" aria-pressed="false">' + esc(REASON[k]) + '</button>').join('')
    + '</div></div><div class="mt-field" id="mtWhyBox" hidden><label class="mt-label" for="mtWhy">What happened</label>'
    + '<textarea id="mtWhy" class="mt-input mt-text" rows="2" maxlength="2000"></textarea></div>';
  return head(p.ref, 'Reject proposal', p.title) + '<div class="sheet-b">' + b + '</div>'
    + '<div class="sheet-f"><button class="btn primary mt-btn mt-grow" type="button" data-mact="reject-send">Reject</button>'
    + '<button class="btn mt-btn" type="button" data-mact="back">Back</button></div>';
}


// --- Fiche ticket (maquette 4) ---------------------------------------------------

const ORIGIN_LINE = {
  guest_message: 'from a guest message', cleaner_report: 'from a cleaner report', inspection: 'from an inspection', manual: 'created by hand',
};
const STEPS = ['Created', 'Assigned', 'In progress', 'Done'];
const STAGE_PILL = { waiting_parts: 'Waiting parts', to_confirm: 'To confirm' };

// Prenom du guest de la proposition liee, sinon « Guest ».
export function guestLabel(prop) {
  const first = String((prop && prop.guestName) || '').trim().split(/\s+/)[0];
  return first || 'Guest';
}
function stepIndex(t) {
  if (t.stage === 'done') return 3;
  if (t.stage === 'todo') return t.assignee ? 1 : 0;
  return 2;
}
function stepsHtml(t) {
  const cur = stepIndex(t);
  return '<ol class="mt-steps" aria-label="Status">' + STEPS.map((l, i) => '<li class="'
    + (i < cur ? 'mt-step-past' : i === cur ? 'mt-step-cur' : '') + '"' + (i === cur ? ' aria-current="step"' : '') + '>' + l + '</li>').join('') + '</ol>';
}
function dayLabel(day) { return weekdayDay(day + 'T08:00:00Z'); }
function guestFact(prop) {
  if (!prop) return '';
  if (prop.guestInNow && prop.stayTo) return 'In now, until ' + dayLabel(prop.stayTo);
  return stayLine(prop.stayFrom, prop.stayTo);
}
function dueFact(dueOn, nowMs) {
  if (!dueOn) return 'Not set';
  const today = dubaiToday(nowMs);
  if (dueOn < today) return '<span class="mt-bad">Overdue ' + esc(ddmm(dueOn)) + '</span>';
  if (dueOn === today) return 'Today';
  return esc(dayLabel(dueOn));
}
function factsHtml(t, nowMs) {
  const prio = PRIORITY[t.priority] ? t.priority : 'medium';
  const row = (k, v) => '<dt>' + k + '</dt><dd>' + v + '</dd>';
  let h = row('Urgency', '<span' + (prio === 'urgent' ? ' class="mt-bad"' : '') + '>' + esc(PRIORITY[prio]) + '</span>')
    + row('Who follows it', t.assignee ? esc(t.assignee.name) : 'Nobody yet');
  const g = guestFact(t.proposal);
  if (g) h += row('Guest', esc(g));
  if (t.stage !== 'done') h += row('Due', dueFact(t.dueOn, nowMs));
  return '<dl class="mt-facts">' + h + '</dl>';
}
const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : '');
function thumb(url) {
  const u = safeUrl(url);
  if (!u) return '';
  return '<a class="mt-thumb" href="' + esc(u) + '" target="_blank" rel="noopener" aria-label="Open photo full size">'
    + '<img class="mt-thumbimg" src="' + esc(u) + '" alt="" loading="lazy" width="64" height="64"></a>';
}
// Historique : heure, qui, texte. Les citations du guest viennent d'ici seulement.
function historyHtml(t, nowMs) {
  const items = t.history || [];
  if (!items.length) return '<p class="t3 mt-hempty">No history yet.</p>';
  const guest = guestLabel(t.proposal);
  const conv = t.proposal && t.proposal.conversationId;
  return '<ol class="mt-hist">' + items.map((x) => {
    let body;
    if (x.kind === 'guest') {
      body = '<b>' + esc(guest) + '</b> <span class="mt-hq">' + quoteText(x.text) + '</span>'
        + (conv ? ' <a class="mt-hlink" href="' + esc(hostawayUrl(conv)) + '" target="_blank" rel="noopener">Hostaway</a>' : '');
    } else {
      body = '<b>' + esc(x.who || 'Unknown') + '</b> <span class="mt-htext">' + esc(x.text) + '</span>';
    }
    return '<li><time class="mono">' + esc(whenShort(x.at, nowMs)) + '</time><div class="mt-hbody">' + body
      + (x.photoUrl ? thumb(x.photoUrl) : '') + '</div></li>';
  }).join('') + '</ol>';
}
// Photos hors historique (photo du signalement) et photo de cloture.
function extraPhotos(t) {
  const seen = new Set((t.history || []).map((x) => x.photoUrl).filter(Boolean));
  const urls = (t.photos || []).map((p) => p.url).filter((u) => u && !seen.has(u) && u !== t.resolutionPhotoUrl);
  // Photo de cloture une seule fois : pas en plus si l'historique la montre deja.
  if (t.resolutionPhotoUrl && !seen.has(t.resolutionPhotoUrl)) urls.push(t.resolutionPhotoUrl);
  const h = urls.map(thumb).join('');
  return h ? '<div class="mt-photos" aria-label="Photos">' + h + '</div>' : '';
}
function tkBtn(k, label, primary) {
  return '<button class="btn mt-btn' + (primary ? ' primary mt-grow' : '') + '" type="button" data-mact="' + k + '">' + label + '</button>';
}
function stageButtons(t) {
  const s = t.stage;
  if (s === 'done') return '<div class="mt-tkmain">' + tkBtn('tk-reopen', 'Reopen', false) + '</div>';
  let main;
  if (s === 'in_progress') main = tkBtn('tk-done', 'Done', true) + tkBtn('tk-waiting', 'Waiting parts');
  else if (s === 'waiting_parts') main = tkBtn('tk-start', 'Start', true) + tkBtn('tk-done', 'Done');
  else if (s === 'to_confirm') main = tkBtn('tk-done', 'Confirm fixed', true) + tkBtn('tk-broken', 'Reopen as still broken');
  else main = tkBtn('tk-start', 'Start', true) + tkBtn('tk-waiting', 'Waiting parts');
  return '<div class="mt-tkmain">' + main + '</div><div class="mt-tkmore">'
    + tkBtn('tk-comment', 'Comment') + tkBtn('tk-assign', 'Reassign') + tkBtn('tk-due', 'Due date') + '</div>';
}
function tkHead(t) {
  const where = [placeLabel(t), CATEGORY[t.category] || ''].filter(Boolean).join(' · ');
  return '<div class="sheet-h" data-mref="' + esc(t.ref) + '"><div class="mt-tkh">'
    + '<div class="mono mt-tkref">' + esc(t.ref) + ' · ' + esc(ORIGIN_LINE[t.origin] || ORIGIN_LINE.manual) + '</div>'
    + '<h2 id="sheetTitle">' + esc(t.title) + '</h2>' + (where ? '<div class="sub mt-tkwhere">' + esc(where) + '</div>' : '') + '</div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}

export function ticketLoadingSheet(ref) {
  return head(ref, ref, '') + '<div class="sheet-b"><p class="boot" role="status">Loading ' + esc(ref) + '…</p></div>';
}
export function ticketErrorSheet(ref, msg) {
  return head(ref, ref, '') + '<div class="sheet-b"><div class="err-card" role="alert"><p>' + esc(msg) + '</p></div></div>'
    + '<div class="sheet-f"><button class="btn primary mt-btn mt-grow" type="button" data-mact="tk-retry">Retry</button>'
    + '<button class="btn mt-btn" type="button" data-close>Close</button></div>';
}

// Fiche ticket : en-tete, etapes, faits, historique, gestes selon l'etape.
export function ticketSheet(t, ro, nowMs) {
  let b = (STAGE_PILL[t.stage] ? '<div class="mt-pills"><span class="pill warn mt-stage">' + STAGE_PILL[t.stage] + '</span></div>' : '')
    + stepsHtml(t) + factsHtml(t, nowMs);
  if (t.stage === 'done') {
    b += '<p class="mt-line mt-tkdone">' + doneLine(t) + '</p>' + (t.resolutionNotes ? '<p class="mt-note">' + quoteText(t.resolutionNotes) + '</p>' : '');
  }
  if (t.description) b += '<p class="mt-note mt-desc">' + esc(t.description) + '</p>';
  b += '<section class="mt-histbox" aria-label="History"><h3 class="mt-label">History</h3>' + historyHtml(t, nowMs) + extraPhotos(t) + '</section>';
  const f = ro ? roFoot('Close') : '<div class="sheet-f mt-tkf">' + stageButtons(t) + '</div>';
  return tkHead(t) + '<div class="sheet-b">' + b + '</div>' + f;
}

function subHead(t, title) { return head(t.ref, title, t.ref + ' · ' + t.title); }
const subFoot = (send, label) => '<div class="sheet-f"><button class="btn primary mt-btn mt-grow" type="button" data-mact="' + send + '">' + label + '</button>'
  + '<button class="btn mt-btn" type="button" data-mact="tk-back">Back</button></div>';

// Cloture : note, photo (envoyee avant le geste), cout reel facultatif.
export function doneSheet(t) {
  const b = '<div class="mt-field"><label class="mt-label" for="mtDoneNote">What was done (optional)</label>'
    + '<textarea id="mtDoneNote" class="mt-input mt-text" rows="3" maxlength="2000"></textarea></div>'
    + '<div class="mt-field"><span class="mt-label">Photo (optional)</span><div class="mt-photorow">'
    + '<label class="btn mt-btn mt-filebtn" for="mtPhoto">Add photo</label>'
    + '<input id="mtPhoto" class="mt-file" type="file" accept="image/*" capture="environment">'
    + '<span id="mtPhotoName" class="t3 mt-photoname"></span></div></div>'
    + '<div class="mt-field"><label class="mt-label" for="mtCost">Cost (AED), optional</label>'
    + '<input id="mtCost" class="mt-input" type="text" inputmode="decimal" autocomplete="off" maxlength="12"></div>';
  return subHead(t, 'Mark done') + '<div class="sheet-b">' + b + '</div>' + subFoot('tk-done-send', 'Mark done');
}
export function waitingSheet(t) {
  return subHead(t, 'Waiting parts') + '<div class="sheet-b"><div class="mt-field"><label class="mt-label" for="mtWaitNote">What is missing (optional)</label>'
    + '<textarea id="mtWaitNote" class="mt-input mt-text" rows="2" maxlength="2000"></textarea></div></div>' + subFoot('tk-wait-send', 'Save');
}
export function commentSheet(t) {
  return subHead(t, 'Comment') + '<div class="sheet-b"><div class="mt-field"><label class="mt-label" for="mtComment">Comment</label>'
    + '<textarea id="mtComment" class="mt-input mt-text" rows="3" maxlength="2000"></textarea></div></div>' + subFoot('tk-comment-send', 'Send');
}
// Reassign : membres de l'equipe, prestataires, personne. L'intervenant actuel est choisi.
export function assignSheet(t, meta) {
  const cur = t.assignee ? (t.assignee.kind === 'vendor' ? 'v:' : 'm:') + t.assignee.id : 'none';
  const chip = (v, label) => '<button type="button" class="mt-chip" data-mact="asg" data-asg="' + esc(v) + '" aria-pressed="' + (v === cur ? 'true' : 'false') + '">' + esc(label) + '</button>';
  const team = (meta.team || []).map((m) => chip('m:' + m.id, m.name)).join('');
  const vendors = (meta.vendors || []).map((v) => chip('v:' + v.id, v.name)).join('');
  const b = '<div class="mt-field"><span class="mt-label">Team</span><div class="mt-whos" role="group" aria-label="Team">' + team + '</div></div>'
    + (vendors ? '<div class="mt-field"><span class="mt-label">Vendors</span><div class="mt-whos" role="group" aria-label="Vendors">' + vendors + '</div></div>' : '')
    + '<div class="mt-field"><div class="mt-whos">' + chip('none', 'Nobody') + '</div></div>';
  return subHead(t, 'Reassign') + '<div class="sheet-b">' + b + '</div>' + subFoot('tk-assign-send', 'Save');
}
export function dueSheet(t, nowMs, maxDays) {
  const today = dubaiToday(nowMs);
  // Une date passee n'est pas pre-remplie (le champ refuserait de l'enregistrer).
  const cur = t.dueOn && t.dueOn >= today ? t.dueOn : '';
  const b = '<div class="mt-field"><label class="mt-label" for="mtDue">Due date</label>'
    + '<input id="mtDue" class="mt-input" type="date" min="' + today + '" max="' + addDays(today, maxDays) + '" value="' + esc(cur) + '"></div>';
  return subHead(t, 'Due date') + '<div class="sheet-b">' + b + '</div>'
    + '<div class="sheet-f"><button class="btn primary mt-btn mt-grow" type="button" data-mact="tk-due-send">Save</button>'
    + (t.dueOn ? '<button class="btn mt-btn" type="button" data-mact="tk-due-clear">Clear date</button>' : '')
    + '<button class="btn mt-btn" type="button" data-mact="tk-back">Back</button></div>';
}
export function photoChosenHtml(name) {
  return '<span class="mt-photofile">' + esc(name) + '</span> <button class="link mt-link" type="button" data-mact="tk-photo-clear">Remove</button>';
}
