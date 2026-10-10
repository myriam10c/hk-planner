// Fiche d'un probleme et choix Assign / Schedule : HTML pur a partir de la reponse
// mgr.problem.get. Aucun appel reseau ici. Chaque panneau porte data-panel="<REF>"
// pour que problem-panel.js sache quel probleme est affiche.
import { addDays, ddmm, dubaiTime, esc, I, placeLabel } from '/manager/ui/dom.js';

const RO_LINE = 'Reconnect to make changes.';
const STATUS = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In progress', waiting_parts: 'Waiting for parts', to_confirm: 'To confirm',
  resolved: 'Closed', closed: 'Closed', cancelled: 'Cancelled', done: 'Closed',
};
// Statuts ouverts d'une tache d'equipe (MGR_OPEN_TASK_STATUSES cote proxy).
const OPEN_TASK = ['open', 'in_progress'];
const ROLE = { manager: 'Manager', maintenance: 'Maintenance', cleaner: 'Cleaner' };

function initials(n) {
  return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
function head(ref, title, sub) {
  return '<div class="sheet-h" data-panel="' + esc(ref) + '"><div><h2 id="sheetTitle">' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
function when(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return ddmm(new Date(t + 4 * 3600000).toISOString().slice(0, 10)) + ' ' + dubaiTime(iso);
}
export function subLine(p) { return [p.ref, p.source, placeLabel(p)].filter(Boolean).join(' · '); }

export function loadingSheet(ref, row) {
  return head(ref, row ? row.title : ref, row ? subLine(row) : ref)
    + '<div class="sheet-b"><p class="boot" role="status">Loading…</p></div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-close>Close</button></div>';
}
export function errorSheet(ref, row, msg) {
  return head(ref, row ? row.title : ref, row ? subLine(row) : ref)
    + '<div class="sheet-b"><p class="sheet-err" role="alert">' + esc(msg) + '</p></div>'
    + '<div class="sheet-f"><button class="btn primary" type="button" data-pact="retry">Retry</button>'
    + '<button class="btn" type="button" data-close>Close</button></div>';
}

function who(a) { return a ? (a.kind === 'vendor' ? 'Vendor ' + a.name : a.name) : ''; }

export function detailSheet(d, ro) {
  const p = d.problem;
  let b = '<div class="statusbox ' + p.tone + '"><span class="bar ' + p.tone + '"></span><div><span class="st ' + p.tone + '">'
    + esc(p.label) + '</span><p>' + esc(p.why) + '</p></div></div>';
  b += '<dl class="pfacts"><dt>Status</dt><dd>' + esc(STATUS[p.status] || p.status) + '</dd>'
    + '<dt>' + (p.kind === 'MNT' ? 'Technician' : 'Assigned to') + '</dt><dd>'
    + (p.assignee ? esc(who(p.assignee)) : '<span class="st bad">Nobody</span>') + '</dd>'
    + '<dt>Due</dt><dd' + (p.overdue ? ' class="st bad"' : '') + '>' + esc(p.due ? (p.overdue ? 'Overdue since ' : '') + p.due : 'No date') + '</dd>'
    + (d.reportedBy ? '<dt>Reported by</dt><dd>' + esc(d.reportedBy) + '</dd>' : '')
    + (d.category ? '<dt>Category</dt><dd>' + esc(d.category) + '</dd>' : '')
    + (p.listingId ? '<dt>Apartment</dt><dd><a class="aplink" href="#/more/apartment/' + encodeURIComponent(p.listingId) + '">Apartment sheet</a></dd>' : '') + '</dl>';
  if (d.description) b += '<div class="blk"><h3>Description</h3><p class="pdesc">' + esc(d.description) + '</p></div>';
  if (d.photos.length) {
    b += '<div class="blk"><h3>Photos</h3><div class="pphotos">' + d.photos.map((ph) => '<a href="' + esc(ph.url)
      + '" target="_blank" rel="noopener"><img src="' + esc(ph.url) + '" alt="' + esc(ph.label) + '" loading="lazy"><span>'
      + esc(ph.label) + '</span></a>').join('') + '</div></div>';
  } else if (d.photosError) {
    b += '<div class="blk"><h3>Photos</h3><div class="empty">' + esc(d.photosError) + '</div></div>';
  }
  if (d.mirror) {
    b += '<div class="note">Also tracked as team task <span class="mono">' + esc(d.mirror.ref) + '</span>'
      + (d.mirror.assignee ? ' (' + esc(d.mirror.assignee) + ')' : '')
      + (OPEN_TASK.includes(d.mirror.status) ? '. It closes with this ticket.' : ', already closed.') + '</div>';
  }
  b += '<div class="blk"><h3>Comments</h3>' + (d.comments.length ? '<ul class="pcomments">' + d.comments.map((c) =>
    '<li><b>' + esc(c.author) + '</b> <span class="mono t3">' + esc(when(c.at)) + '</span><p>' + esc(c.text) + '</p>'
    + (c.photo ? '<a href="' + esc(c.photo) + '" target="_blank" rel="noopener"><img src="' + esc(c.photo) + '" alt="Comment photo" loading="lazy"></a>' : '')
    + '</li>').join('') + '</ul>' : '<div class="empty">No comment yet.</div>');
  if (!ro) {
    b += '<label class="plabel" for="pComment">Comment, or note for Close</label>'
      + '<textarea id="pComment" class="ptext" rows="3" maxlength="2000"></textarea>'
      + '<div><button class="btn sm" type="button" data-pact="comment">Comment</button></div>';
  }
  b += '</div>';
  b += '<div class="blk"><h3>History</h3><ul class="phist">' + d.history.map((h) =>
    '<li><span class="mono">' + esc(when(h.at)) + '</span><span>' + esc(h.text) + '</span></li>').join('') + '</ul></div>';
  let f;
  if (ro) f = '<p class="ro-note" role="status">' + RO_LINE + '</p><button class="btn" type="button" data-close>Close</button>';
  else if (p.closed) f = '<button class="btn primary" type="button" data-pact="reopen">Reopen</button><button class="btn" type="button" data-close>Close</button>';
  else {
    f = '<button class="btn primary" type="button" data-pact="assign" aria-keyshortcuts="A">Assign</button>'
      + '<button class="btn" type="button" data-pact="schedule" aria-keyshortcuts="S">Schedule</button>'
      + '<button class="btn" type="button" data-pact="close" aria-keyshortcuts="C">Close problem</button>';
  }
  return head(p.ref, p.title, subLine(p)) + '<div class="sheet-b">' + b + '</div><div class="sheet-f">' + f + '</div>';
}

export function assignSheet(d, ro) {
  const p = d.problem;
  const cur = p.assignee;
  const people = d.assignees.filter((a) => p.kind === 'MNT' || a.takesTasks);
  let b;
  if (ro) b = '<p class="ro-note" role="status">' + RO_LINE + '</p>';
  else {
    b = '<div class="pick">' + people.map((a) => {
      const on = cur && cur.kind === 'member' && cur.id === a.id;
      return '<button type="button" data-pact="pick" data-id="' + a.id + '"' + (on ? ' aria-current="true"' : '') + '>'
        + '<span class="av" aria-hidden="true">' + esc(initials(a.name)) + '</span><span><b>' + esc(a.name) + '</b><small>'
        + esc(ROLE[a.role] || a.role) + '</small></span></button>';
    }).join('') + '</div>';
    if (p.kind === 'MNT' && d.vendors.length) {
      b += '<h3 class="psub">Or a vendor</h3><div class="pick">' + d.vendors.map((v) => {
        const on = cur && cur.kind === 'vendor' && cur.id === v.id;
        return '<button type="button" data-pact="vendor" data-id="' + v.id + '"' + (on ? ' aria-current="true"' : '') + '>'
          + '<span class="av" aria-hidden="true">' + esc(initials(v.name)) + '</span><span><b>' + esc(v.name) + '</b><small>'
          + esc(v.specialty || 'Vendor') + '</small></span></button>';
      }).join('') + '</div>';
    }
    if (cur) b += '<div><button class="btn sm" type="button" data-pact="unassign">Unassign</button></div>';
  }
  return head(p.ref, 'Assign ' + p.ref, p.title) + '<div class="sheet-b">' + b + '</div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-pact="back">Back</button></div>';
}

export function scheduleSheet(d, today, ro) {
  const p = d.problem;
  const opts = [['Today', today], ['Tomorrow', addDays(today, 1)], ['In 3 days', addDays(today, 3)], ['Next week', addDays(today, 7)]];
  let b;
  if (ro) b = '<p class="ro-note" role="status">' + RO_LINE + '</p>';
  else {
    b = '<div class="pdates">' + opts.map(([l, day]) => '<button class="btn" type="button" data-pact="date" data-date="' + day + '">'
      + esc(l) + ' <span class="mono">' + ddmm(day) + '</span></button>').join('') + '</div>'
      + '<label class="plabel" for="pDate">Another date</label><div class="pinline"><input id="pDate" type="date" min="' + today
      + '" max="' + addDays(today, 365) + '"><button class="btn" type="button" data-pact="date-input">Set date</button></div>'
      + (p.dueAt ? '<div><button class="btn sm" type="button" data-pact="clear-date">Remove the date</button></div>' : '');
  }
  return head(p.ref, 'Schedule ' + p.ref, p.title + (p.due ? ' · due ' + p.due : '')) + '<div class="sheet-b">' + b + '</div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-pact="back">Back</button></div>';
}
