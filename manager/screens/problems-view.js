// Ecran Tasks (ex Problems) : HTML pur (en-tete, puces, lignes, choix du logement). Aucun appel reseau.
import { esc, I, placeLabel } from '/manager/ui/dom.js';

export function problemsShell() {
  return '<header class="top"><div><h1>Tasks</h1><div class="asof" id="pAsof" hidden></div></div>'
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></header>'
    + '<div class="psearch"><label class="sr" for="pSearch">Search tasks</label>'
    + '<input id="pSearch" type="search" placeholder="Search ref, apartment, title or person" autocomplete="off" aria-keyshortcuts="/"></div>'
    + '<div id="pBanner"></div><div id="pChips" class="pchips"></div><div id="pList"></div>';
}

export function chipsHtml(data, f) {
  const c = data.counts;
  const chip = (key, label, n) => '<button class="chip" type="button" data-chip="' + key + '" aria-pressed="' + (f[key] ? 'true' : 'false') + '">'
    + esc(label) + ' <span class="tnum">' + n + '</span></button>';
  const apt = f.listingId ? data.apartments.find((a) => a.listingId === f.listingId) : null;
  let h = '<div class="chiprow" role="group" aria-label="Filters">' + chip('urgent', 'Urgent', c.urgent) + chip('mine', 'Mine', c.mine)
    + chip('unassigned', 'Unassigned', c.unassigned)
    + '<button class="chip" type="button" data-apt-open aria-pressed="' + (f.listingId ? 'true' : 'false') + '">'
    + esc(apt ? placeLabel(apt) : 'Apartment') + '</button></div>';
  return h;
}

function sideDue(r) {
  if (r.overdue) return '<span class="pdue bad">Overdue ' + esc(r.due) + '</span>';
  if (r.due) return '<span class="pdue">Due ' + esc(r.due) + '</span>';
  return '<span class="pdue t3">Since ' + esc(r.since) + '</span>';
}
export function rowHtml(r) {
  const who = r.assignee ? (r.assignee.kind === 'vendor' ? 'Vendor ' : '') + r.assignee.name : 'Unassigned';
  return '<button class="prow" type="button" data-row data-ref="' + esc(r.ref) + '" aria-keyshortcuts="Enter A S C">'
    + '<span class="bar ' + r.tone + '"></span>'
    + '<span class="pmain"><span class="pl1"><span class="mono pref">' + esc(r.ref) + '</span><span class="pill ' + r.tone + '">'
    + esc(r.label) + '</span><span class="psrc">' + esc(r.source) + '</span></span>'
    + '<span class="pttl">' + esc(r.title) + '</span>'
    + (r.apt || r.bld ? '<span class="pwhere">' + esc(placeLabel(r)) + '</span>' : '') + '</span>'
    + '<span class="pside"><span class="pwho' + (r.assignee ? '' : ' none') + '">' + esc(who) + '</span>' + sideDue(r) + '</span></button>';
}

export function listHtml(st, filtered) {
  if (!st.data) {
    if (st.error) {
      return '<div class="err-card" role="alert"><p>' + esc(st.error.message) + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>';
    }
    return '<p class="boot" role="status">Loading tasks…</p>';
  }
  if (!st.rows.length) {
    return '<div class="ph"><p>' + (filtered ? 'Nothing matches these filters.' : 'Nothing open.') + '</p>'
      + (filtered ? '<button class="btn" type="button" data-clear>Clear filters</button>' : '') + '</div>';
  }
  // Load more seulement sur une liste fraiche et stable (sinon page d'un autre filtre).
  const more = st.fresh && !st.loading && st.rows.length < st.data.total;
  return '<section class="card plist" aria-label="Tasks">' + st.rows.map(rowHtml).join('') + '</section>'
    + '<div class="pfoot"><span class="t3 tnum">' + st.rows.length + ' of ' + st.data.total + '</span>'
    + (more ? '<button class="btn" type="button" data-more' + (st.more ? ' disabled' : '') + '>' + (st.more ? 'Loading…' : 'Load more') + '</button>' : '')
    + '</div>';
}

export function apartmentSheet(apts, current) {
  return '<div class="sheet-h"><div><h2 id="sheetTitle">Apartment</h2><div class="sub">Apartments with open tasks</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>'
    + '<div class="sheet-b"><div class="pick"><button type="button" data-apt=""' + (!current ? ' aria-current="true"' : '') + '><span><b>All apartments</b></span></button>'
    + apts.map((a) => '<button type="button" data-apt="' + esc(a.listingId) + '"' + (current === a.listingId ? ' aria-current="true"' : '') + '><span><b>'
      + esc(placeLabel(a)) + '</b><small>' + a.n + ' open</small></span></button>').join('')
    + '</div></div><div class="sheet-f"><button class="btn" type="button" data-close>Cancel</button></div>';
}
