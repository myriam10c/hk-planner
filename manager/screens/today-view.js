// Ecran Today : HTML pur construit a partir de la reponse mgr.today. Aucun appel
// reseau ici, aucun calcul de statut : le proxy les rend deja faits.
import { aptLabel, dubaiTime, esc, I, placeLabel } from '/manager/ui/dom.js';

const ROLE = { cleaner: 'Cleaner', subcontractor: 'Subcontractor', manager: 'Manager', maintenance: 'Maintenance' };

export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : '') : r + ' min';
}
export function arrivalMs(day, time) { return Date.parse(day + 'T' + time + ':00+04:00'); }
function ddmm(day) { return day ? day.slice(8, 10) + '/' + day.slice(5, 7) : ''; }
function longDate(day) {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
function initials(n) {
  return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
function nameOf(data, id) {
  const p = data.assignable.find((x) => x.id === id) || data.who.people.find((x) => x.id === id);
  return p ? p.name : 'Member ' + id;
}
function namesOf(data, ids) {
  const n = ids.map((id) => nameOf(data, id));
  return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
function jobsByKey(data) {
  const m = {};
  for (const j of data.who.jobs) m[j.key] = j;
  return m;
}

// Actions reelles (assignCleaner, setDone) : branchees dans today.js.
const RO_LINE = 'Reconnect to make changes.';
function actionsFoot(key, assigned, done, ro) {
  if (ro) return '<div class="sheet-f"><p class="ro-note" role="status">' + RO_LINE + '</p><button class="btn" type="button" data-close>Close</button></div>';
  return '<div class="sheet-f"><button class="btn primary" type="button" data-assign="' + esc(key) + '">' + (assigned.length ? 'Reassign' : 'Assign cleaner') + '</button>'
    + '<button class="btn" type="button" data-done="' + esc(key) + '" data-val="' + (done ? '0' : '1') + '">' + (done ? 'Undo done' : 'Mark done') + '</button>'
    + '<button class="btn" type="button" data-close>Close</button></div>';
}
function assignBtn(j, ro) {
  return ro || j.state === 'done' ? '' : '<button class="btn sm primary" type="button" data-assign="' + esc(j.key) + '">Assign</button>';
}

function header(data, banner, stale) {
  return '<header class="top"><div><h1>Today</h1><div class="date">' + esc(longDate(data.day)) + '</div>'
    + '<div class="asof' + (stale ? ' stale' : '') + '">Data as of ' + esc(dubaiTime(data.generatedAt)) + '</div></div>'
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></header>'
    + (banner || '');
}

function alertHtml(data, nowMs) {
  const blocked = data.arrivals.rows.filter((a) => a.tone === 'bad');
  if (!blocked.length) return '';
  const first = blocked[0].time;
  const left = arrivalMs(data.day, first) - nowMs;
  return '<div class="alert" role="alert"><div class="clock">' + esc(first) + '</div><p><b>' + blocked.length + ' arrival'
    + (blocked.length > 1 ? 's' : '') + ' blocked</b>, first guest due at ' + esc(first) + (left > 0 ? ', in ' + fmtDur(left) : '') + '. '
    + esc(blocked.map((a) => placeLabel(a)).join(', ')) + '.</p></div>';
}

function tile(n, label, bad) {
  return '<div class="s' + (bad ? ' bad' : '') + '"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
}
function stripHtml(data) {
  const s = data.strip;
  return '<div class="strip" aria-label="Today in numbers">' + tile(s.cleanings, 'cleanings today', false)
    + tile(s.unassigned, 'without a cleaner', s.unassigned > 0) + tile(s.arrivals, 'arrivals today', false)
    + tile(s.notReady, 'arrivals not ready yet', s.notReady > 0) + '</div>';
}

function coTime(j) { return j.kind === 'extra' ? 'Extra' : (j.checkout || '--:--'); }
function coSmall(j) { return j.kind === 'extra' ? 'clean' : 'out'; }
function nextLine(j) {
  if (!j.next) return 'No guest in the next 14 days';
  const who = j.next.owner ? 'Owner' : 'Guest';
  if (j.next.sameDay) return who + ' arrives ' + (j.next.time || 'today');
  return 'Next ' + who.toLowerCase() + ' ' + ddmm(j.next.date);
}
function jobNotes(j) {
  if (j.postponedFrom) return ' · postponed from ' + ddmm(j.postponedFrom);
  if (j.kind === 'checkout' && !j.checkout) return ' · checkout time not set';
  return '';
}
function jobBtn(j) {
  return '<button class="job" type="button" data-open="job" data-key="' + esc(j.key) + '"><span class="tm">' + esc(coTime(j)) + '<small>' + coSmall(j) + '</small></span>'
    + '<span class="ap"><b>' + esc(placeLabel(j)) + '</b><span><span class="st ' + (j.tone === 'idle' ? '' : j.tone) + '">' + esc(j.word) + '</span> · '
    + esc(nextLine(j) + jobNotes(j)) + '</span></span></button>';
}

function whoHtml(data, ro) {
  const byKey = jobsByKey(data);
  const w = data.who;
  let h = '<section class="card o1" aria-labelledby="h-who"><div class="sec-head"><h2 id="h-who">Who does what today</h2><span class="meta tnum">'
    + w.jobs.length + ' cleaning' + (w.jobs.length === 1 ? '' : 's') + '</span></div>';
  const list = w.unassigned.map((k) => byKey[k]).filter(Boolean);
  if (list.length) {
    h += '<div class="person unassigned"><div class="person-h"><span class="av" aria-hidden="true">!</span><div><div class="nm">Not assigned</div>'
      + '<div class="rl">Same-day arrivals first</div></div><span class="cnt">' + list.length + '</span></div><div class="jobs">';
    for (const j of list) {
      const lead = j.tone === 'warn' ? '<span class="st warn">' + esc(j.word) + '</span> · '
        : j.state === 'done' ? '<span class="st ok">Done</span> · ' : '';
      h += '<div class="job static"><span class="tm">' + esc(coTime(j)) + '<small>' + coSmall(j) + '</small></span>'
        + '<button class="ap linklike" type="button" data-open="job" data-key="' + esc(j.key) + '"><b>' + esc(placeLabel(j)) + '</b><span>'
        + lead + esc(nextLine(j) + jobNotes(j)) + '</span></button>' + assignBtn(j, ro) + '</div>';
    }
    h += '</div>';
    if (list.some((j) => j.tone === 'warn')) {
      h += '<div class="note">Elite Cleaning logs its jobs the next day around 14:00. Lines marked "Not logged yet" may already be done by Elite: confirm with Elite before reassigning.</div>';
    }
    h += '</div>';
  }
  for (const p of w.people) {
    const jobs = p.keys.map((k) => byKey[k]).filter(Boolean);
    h += '<div class="person"><div class="person-h"><span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span><div><div class="nm">' + esc(p.name)
      + '</div><div class="rl">' + esc(ROLE[p.role] || p.role) + '</div></div><span class="cnt">' + jobs.length + '</span></div><div class="jobs">'
      + (jobs.length ? jobs.map(jobBtn).join('') : '<div class="empty">Nothing recorded for today in HK Planner.</div>') + '</div></div>';
  }
  for (const t of w.technicians) {
    h += '<div class="person"><div class="person-h"><span class="av" aria-hidden="true">' + esc(initials(t.name)) + '</span><div><div class="nm">' + esc(t.name)
      + '</div><div class="rl">Maintenance tickets</div></div><span class="cnt">' + t.open + '</span></div>'
      + (t.oldest ? '<div class="empty">Oldest: <span class="mono">MNT-' + t.oldest.id + '</span> ' + esc(t.oldest.title) + ', since ' + esc(t.oldest.since) + '.</div>' : '')
      + '</div>';
  }
  return h + '</section>';
}

function problemsHtml(data) {
  const c = data.problems.counts;
  let h = '<section class="card o2" aria-labelledby="h-prob"><div class="sec-head"><h2 id="h-prob">Open problems</h2><span class="meta">Top 5 by urgency</span></div>'
    + '<div class="counts"><div class="count"><b class="tnum">' + c.ticketsOpen + '</b><span>maintenance tickets, ' + c.ticketsUrgent + ' urgent</span></div>'
    + '<div class="count"><b class="tnum">' + c.ticketsNoTech + '</b><span>tickets with no technician</span></div>'
    + '<div class="count"><b class="tnum">' + c.teamTasksOverdue + '</b><span>team tasks overdue, of ' + c.teamTasksOpen + ' open</span></div></div>';
  if (!data.problems.top.length) h += '<div class="empty pad">Nothing open.</div>';
  h += data.problems.top.map((p) => '<button class="prob" type="button" data-open="prob" data-ref="' + esc(p.ref) + '" data-nav-row>'
    + '<span class="bar ' + p.tone + '"></span><span class="body"><span class="src"><span class="pill ' + p.tone + '">' + esc(p.label) + '</span><span>'
    + esc(p.source) + ' <span class="mono">' + esc(p.ref) + '</span></span></span><span class="ttl">' + esc(p.title) + '</span>'
    + (p.apt || p.bld ? '<span class="where">' + esc(placeLabel(p)) + '</span>' : '') + '<span class="why">' + esc(p.why) + '</span></span></button>').join('');
  h += '<div class="sec-foot"><span class="t3">Including ' + c.inspectionTicketsOpen + ' from inspections and '
    + c.cleanerReportsOpen + ' cleaner reports.</span><a class="link" href="#/problems">All problems</a></div>';
  return h + '</section>';
}

function controlHtml(data) {
  const c = data.control, ins = c.inspections;
  let h = '<section class="card o3" aria-labelledby="h-ctl"><div class="sec-head"><h2 id="h-ctl">Team control</h2><span class="meta">Yesterday and today</span></div>';
  h += '<div class="ctl"><h3>Inspections today</h3><div class="kv"><span class="k">Proposed</span><span class="v">' + ins.proposed
    + '</span><span class="k">Claimed</span><span class="v">' + ins.claimed + '</span><span class="k">Done</span><span class="v">' + ins.done + '</span></div>';
  if (ins.unfinished.length) {
    h += '<div class="mini"><div class="it"><span>Started, never finished<br><span class="sub">'
      + esc(ins.unfinished.map((u) => placeLabel(u) + ' (' + u.inspector + ', ' + u.date + ')').join(', '))
      + '</span></span><b class="tnum">' + ins.unfinished.length + '</b></div></div>';
  }
  h += '<a class="link" href="#/inspections">Open inspections</a></div>';
  h += '<div class="ctl"><h3>Missing linen counts, ' + esc(c.linen.window) + '</h3>' + (c.linen.rows.length
    ? '<div class="kv">' + c.linen.rows.map((r) => '<span class="k">' + esc(r.name) + '</span><span class="v"><span class="'
      + (r.total && r.missing / r.total > 0.5 ? 'num-bad' : '') + '">' + r.missing + '</span><span class="of"> of ' + r.total + ' cleanings</span></span>').join('') + '</div>'
    : '<div class="empty">No cleaning marked done in this window.</div>') + '</div>';
  h += '<div class="ctl"><h3>Overdue team tasks</h3>' + (c.overdue.total
    ? '<div class="kv">' + c.overdue.rows.map((r) => '<span class="k">' + esc(r.name) + '</span><span class="v">' + r.n + '</span>').join('')
      + '<span class="k total">Total</span><span class="v">' + c.overdue.total + '</span></div>'
    : '<div class="empty">Nothing overdue.</div>') + '</div>';
  h += '<div class="ctl"><h3>What each person did yesterday, ' + esc(c.yesterday.date) + '</h3><div class="yday">'
    + c.yesterday.rows.map((y) => '<div class="p"><b>' + esc(y.name) + '</b><span>' + esc(y.text) + '</span></div>').join('') + '</div></div>';
  return h + '</section>';
}

function arrivalsHtml(data) {
  const a = data.arrivals, n = a.counts;
  let h = '<section class="card o4" aria-labelledby="h-arr"><div class="sec-head"><h2 id="h-arr">Ready for today’s arrivals</h2><span class="meta tnum">'
    + a.rows.length + ' arrival' + (a.rows.length === 1 ? '' : 's') + '</span></div>'
    + '<div class="legend"><span><i class="ok"></i>' + n.ok + ' ready</span><span><i class="warn"></i>' + n.warn + ' at risk</span><span><i class="bad"></i>'
    + n.bad + ' blocked</span>' + (n.idle ? '<span><i class="idle"></i>' + n.idle + ' scheduled</span>' : '') + '</div>';
  if (!a.rows.length) h += '<div class="empty pad">No arrival today.</div>';
  h += a.rows.map((r) => '<button class="arr" type="button" data-open="arr" data-id="' + esc(r.id) + '" data-nav-row><span class="bar ' + r.tone + '"></span>'
    + '<span class="when"><b>' + esc(r.time) + '</b><span>' + esc(r.kind + (r.timeSet ? '' : ', time not set')) + '</span></span>'
    + '<span class="body"><span class="apt">' + esc(aptLabel(r) || r.bld) + '</span><span class="bld">' + esc(r.apt ? r.bld : '') + '</span>'
    + '<span class="stline"><span class="st ' + r.tone + '">' + esc(r.word) + '</span> <span class="cause">' + esc(r.cause) + '</span></span></span></button>').join('');
  h += '<details class="rules"><summary>How status is computed</summary><ul>'
    + '<li><b>Ready</b>: a cleaning was marked done in HK Planner after the previous checkout, and no urgent ticket is open on the apartment.</li>'
    + '<li><b>At risk</b>: a cleaner is assigned but the cleaning is not marked done, and the guest arrives within ' + data.riskHours + ' hours. Also an unassigned cleaning that Elite may have done but not logged yet (Elite logs the next day around 14:00).</li>'
    + '<li><b>Blocked</b>: no cleaner is assigned, or an urgent maintenance ticket is open on the apartment.</li>'
    + '<li><b>Scheduled</b>: a cleaner is assigned and the guest arrives in more than ' + data.riskHours + ' hours.</li>'
    + '<li>Owner stays count as arrivals. Without a checkout in the last 14 days, there is no cleaning to check.</li></ul></details>';
  return h + '</section>';
}

export function boardHtml(data, nowMs, banner, stale, ro) {
  return header(data, banner, stale) + alertHtml(data, nowMs) + stripHtml(data)
    + '<div class="board"><div class="col">' + whoHtml(data, ro) + controlHtml(data) + '</div><div class="col">'
    + problemsHtml(data) + arrivalsHtml(data) + '</div></div>';
}

function sheetHead(title, sub) {
  return '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
function statusBox(tone, word, text) {
  return '<div class="statusbox ' + tone + '"><span class="bar ' + tone + '"></span><div><span class="st ' + tone + '">' + esc(word) + '</span><p>' + esc(text) + '</p></div></div>';
}
function tlItem(t, tone, title, sub) {
  return '<li><span class="tt">' + esc(t) + '</span><span class="dot ' + (tone || '') + '"></span><span class="tx"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span></li>';
}
function ticketsBlk(list) {
  const tk = list || [];
  if (!tk.length) return '<div class="blk"><h3>Open tickets</h3><div class="empty">None on this apartment.</div></div>';
  return '<div class="blk"><h3>Open tickets</h3><ul>' + tk.map((t) => '<li><b>' + esc(t.title) + '</b><small><span class="mono">MNT-' + t.id + '</span> · '
    + esc(t.priority) + ' · since ' + esc(t.since) + ' · ' + (t.tech ? 'assigned to ' + esc(t.tech) : 'no technician') + '</small></li>').join('') + '</ul></div>';
}

export function jobSheet(data, job, nowMs, ro) {
  const arr = data.arrivals.rows.find((a) => a.prevKey === job.key) || null;
  const names = namesOf(data, job.assigned);
  const box = arr ? statusBox(arr.tone, arr.word, arr.cause)
    : statusBox(job.tone, job.word, (job.assigned.length ? 'Assigned to ' + names + '.' : 'No cleaner in HK Planner for this cleaning.') + ' ' + nextLine(job) + '.');
  const nextT = job.next && job.next.sameDay ? (job.next.time || '15:00') : '';
  const tl = '<ul class="tl">'
    + (job.kind === 'extra' ? '' : tlItem(job.checkout || '--:--', 'ok', job.postponedFrom ? 'Checkout ' + ddmm(job.postponedFrom) : 'Checkout',
      job.postponedFrom ? 'Cleaning postponed to today' : job.checkout ? 'Guest leaves' : 'Checkout time not set in Hostaway'))
    + tlItem(dubaiTime(new Date(nowMs).toISOString()), 'now', 'Now',
      job.state === 'done' ? 'Cleaning done' : job.assigned.length ? names + (job.state === 'in_progress' ? ', in progress' : ', not started') : 'Nobody assigned')
    + (nextT ? tlItem(nextT, arr ? arr.tone : job.tone, (job.next.owner ? 'Owner' : 'Guest') + ' arrives', fmtDur(arrivalMs(data.day, nextT) - nowMs) + ' from now')
      : tlItem('', '', 'Next guest', job.next ? ddmm(job.next.date) : 'None in the next 14 days'))
    + '</ul>';
  return sheetHead(placeLabel(job), job.kind === 'extra' ? 'Extra cleaning, today' : 'Checkout cleaning, today')
    + '<div class="sheet-b">' + box + tl
    + '<div class="blk"><h3>Cleaner</h3><div>' + (job.assigned.length ? esc(names) : '<span class="st bad">Nobody</span>') + '</div></div>'
    + ticketsBlk(data.ticketsByListing[job.listingId]) + '</div>'
    + actionsFoot(job.key, job.assigned, job.state === 'done', ro);
}

export function arrivalSheet(data, a, nowMs, ro) {
  const left = arrivalMs(data.day, a.time) - nowMs;
  const pc = a.prevCheckout;
  const prevItem = pc ? tlItem(pc.date === data.day ? (pc.time || '--:--') : ddmm(pc.date), 'ok', 'Previous checkout',
    pc.date === data.day ? (pc.time ? 'Today' : 'Today, checkout time not set') : 'Apartment empty since') : '';
  const tl = '<ul class="tl">' + prevItem
    + tlItem(dubaiTime(new Date(nowMs).toISOString()), 'now', 'Now',
      a.done ? 'Cleaning done' : a.cleaners.length ? a.cleaners.join(' and ') + ', not done yet' : 'Nobody assigned')
    + tlItem(a.time, a.tone, a.kind + ' arrives', left > 0 ? fmtDur(left) + ' from now' : 'Due now') + '</ul>';
  return sheetHead(placeLabel(a), a.kind + ' arriving today at ' + a.time + (a.timeSet ? '' : ' (time not set)'))
    + '<div class="sheet-b">' + statusBox(a.tone, a.word, a.cause) + tl
    + '<div class="blk"><h3>Cleaner</h3><div>' + (a.cleaners.length ? esc(a.cleaners.join(' and ')) : '<span class="st bad">Nobody</span>') + '</div></div>'
    + ticketsBlk(data.ticketsByListing[a.listingId]) + '</div>'
    + (a.prevKey ? actionsFoot(a.prevKey, a.assigned, a.done, ro) : '<div class="sheet-f"><button class="btn" type="button" data-close>Close</button></div>');
}

export function pickerSheet(data, t, ro) {
  const count = {};
  for (const p of data.who.people) count[p.id] = p.keys.length;
  const opts = ro ? '<p class="ro-note" role="status">' + RO_LINE + '</p>' : data.assignable.map((p) => {
    const n = count[p.id] || 0;
    const current = t.assigned.length === 1 && t.assigned[0] === p.id;
    return '<button type="button" data-pick="' + p.id + '" data-key="' + esc(t.key) + '"' + (current ? ' aria-current="true"' : '') + '>'
      + '<span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span><span><b>' + esc(p.name) + '</b><small>'
      + esc(ROLE[p.role] || p.role) + ' · ' + n + ' job' + (n === 1 ? '' : 's') + ' today</small></span></button>';
  }).join('');
  return sheetHead('Assign a cleaner', placeLabel(t) + (t.sub ? ' · ' + t.sub : ''))
    + '<div class="sheet-b"><div class="pick">' + opts + '</div></div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-close>Cancel</button></div>';
}
