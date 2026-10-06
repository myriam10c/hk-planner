import { get } from '/inspections/api.js';

const TZ = 'Asia/Dubai';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(date) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ,
  }).formatToParts(date).map((x) => [x.type, x.value]));
}
const todayDubai = () => { const p = parts(new Date()); return p.year + '-' + p.month.padStart(2, '0') + '-' + p.day.padStart(2, '0'); };
const plusDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function when(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = parts(d);
  const dow = DOW[new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 12)).getUTCDay()];
  return dow + ' ' + Number(p.day) + ' ' + MON[Number(p.month) - 1] + ' · ' + p.hour + ':' + p.minute;
}

const PERIODS = [
  { id: 'today', label: 'Today' },
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: 'month', label: 'This month' },
];
function range(id) {
  const t = todayDubai();
  if (id === 'today') return { from: t, to: t };
  if (id === '30') return { from: plusDays(t, -29), to: t };
  if (id === 'month') return { from: t.slice(0, 8) + '01', to: t };
  return { from: plusDays(t, -6), to: t };
}
const FILTERS = [{ id: 'all', label: 'All' }, { id: 'clean', label: 'No issues' }, { id: 'issues', label: 'With issues' }];

export async function renderReports(ctx) {
  const { go, render, esc } = ctx;
  const isCurrent = ctx.isCurrent || (() => true);
  const st = { period: '7', filter: 'all', data: null, error: null, loading: true };
  let reqSeq = 0;

  const chips = (list, cur, act) => '<div class="chips" role="group">' + list.map((c) =>
    '<button class="chip" data-act="' + act + '" data-v="' + esc(c.id) + '" aria-pressed="' + (c.id === cur ? 'true' : 'false') + '">' + esc(c.label) + '</button>').join('') + '</div>';

  const tile = (id, n, label, cls) => '<div class="tile ' + cls + '" data-testid="tile-' + id + '"><strong>' + esc(n) + '</strong><span>' + esc(label) + '</span></div>';

  const badge = (r) => {
    if (r.result === 'clean') return '<span class="badge ok">No issues</span>';
    if (r.result === 'fixed') return '<span class="badge warn">Fixed on the spot</span>';
    const t = (r.issues || []).filter((i) => i && i.ticket);
    const txt = t.length ? t.map((i) => 'Ticket #' + i.ticket.id + ' · ' + i.ticket.status).join(', ') : '';
    return '<span class="badge bad">Maintenance' + (txt ? ' · ' + esc(txt) : '') + '</span>';
  };
  const rowHtml = (r) => '<article class="card rrow" data-testid="report-' + esc(r.id) + '">'
    + '<p class="mute">' + esc(when(r.finishedAt)) + '</p>'
    + '<button class="link" data-act="open" data-id="' + esc(r.listingId) + '">' + esc(r.name) + '</button>'
    + '<p class="mute">by ' + esc(r.inspector || 'unknown') + '</p>'
    + '<div class="badges">' + badge(r) + '</div></article>';

  const body = () => {
    let h = '<main class="wrap"><header class="top"><div><h1>Reports</h1></div><button class="btn ghost" data-act="home">Today</button></header>';
    h += chips(PERIODS, st.period, 'period');
    if (st.loading) return h + '<p class="state">Loading…</p></main>';
    if (st.error) return h + '<p class="notice bad" role="alert">' + esc(st.error) + '</p><button class="btn primary" data-act="retry">Retry</button></main>';
    const d = st.data, t = d.totals || {};
    h += '<div class="tiles">' + tile('inspections', t.inspections || 0, 'Inspections', '') + tile('apartments', t.apartments || 0, 'Apartments checked', '')
      + tile('clean', t.clean || 0, 'No issues', 'good') + tile('issues', t.withIssues || 0, 'With issues', 'warn') + '</div>';
    h += '<p class="mute">Fixed on the spot: ' + esc(t.fixedOnSpot || 0) + ' · Sent to maintenance: ' + esc(t.sentToMaintenance || 0)
      + ' · Tickets still open: ' + esc(t.openTickets || 0) + '</p>';
    h += chips(FILTERS, st.filter, 'filter');
    const rows = (d.reports || []).filter((r) => st.filter === 'all' || (st.filter === 'clean' ? r.result === 'clean' : r.result !== 'clean'));
    h += rows.length ? rows.map(rowHtml).join('') : '<p class="mute">No inspections in this period</p>';
    return h + '</main>';
  };
  const paint = () => render(body());

  async function load() {
    const mine = ++reqSeq;
    st.loading = true; st.error = null; paint();
    let data = null, err = null;
    try { data = await get('insp.reports', range(st.period)); } catch (e) { err = e.message || 'Could not load the reports.'; }
    if (mine !== reqSeq || !isCurrent()) return;
    st.loading = false; st.data = data; st.error = err;
    paint();
  }

  const view = document.getElementById('view');
  view.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'home') return go('#/');
    if (a === 'open') return go('#/history/' + encodeURIComponent(b.dataset.id));
    if (a === 'retry') return load();
    if (a === 'period') { if (st.period === b.dataset.v) return; st.period = b.dataset.v; return load(); }
    if (a === 'filter') { st.filter = b.dataset.v; return paint(); }
  };
  await load();
}
