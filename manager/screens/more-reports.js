// More > Reports : compta Elite du mois (snapshot serveur cleaning_accounting_cache), operations,
// sante des logements, exports CSV, lien vers les rapports d'inspection. Lecture seule : mgr.reports.
// Regle comptable : aucun montant n'est calcule ici. Totaux, lignes et non rapproches sont
// affiches tels que le serveur les rend (mise en forme seulement), une valeur absente
// s'affiche « Not available », et le CSV des lignes est une copie brute du snapshot.
import { download, get } from '/manager/api.js';
import { esc, I } from '/manager/ui/dom.js';

const NA = '<span class="rp-muted">Not available</span>';
const STALE_MS = 3 * 3600 * 1000;
const PROPS_SHOWN = 20;
const NF2 = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF1 = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const money = (v) => (isNum(v) ? 'AED ' + NF2.format(v) : NA);
const pct = (v) => (isNum(v) ? NF1.format(v) + '%' : NA);
const count = (v) => (isNum(v) ? String(v) : NA);

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Reports</h1></div></header>';
}
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function dubaiStamp(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })
    + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });
}
function weekday(day) {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
}
const stat = (label, value) => '<div class="rp-stat"><span>' + esc(label) + '</span><b>' + value + '</b></div>';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// CSV des lignes du snapshot : colonnes = cles dans l'ordre ou elles arrivent, valeurs brutes.
export function rowsToCsv(rows) {
  const cols = [];
  const seen = new Set();
  rows.forEach((r) => { if (isObj(r)) Object.keys(r).forEach((k) => { if (!seen.has(k)) { seen.add(k); cols.push(k); } }); });
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  // BOM UTF-8 en tete : Excel lit alors les noms arabes et accentues ; les valeurs restent telles quelles.
  return '\ufeff' + [cols.map(cell).join(',')].concat(rows.map((r) => cols.map((c) => cell(isObj(r) ? r[c] : '')).join(','))).join('\n');
}

function saveText(text, filename) {
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function breakdown(key, title, obj) {
  if (!isObj(obj) || !Object.keys(obj).length) return '';
  const rows = Object.keys(obj).map((k) => {
    const v = isObj(obj[k]) ? obj[k] : {};
    return '<div class="rp-brow"><div class="rp-bhead"><b>' + esc(k) + '</b><span>' + count(v.count) + ' cleanings</span></div>'
      + '<div class="rp-bvals"><span>Cost excl. VAT ' + money(v.cost_ht) + '</span><span>Revenue excl. VAT ' + money(v.revenue_ht) + '</span>'
      + '<span>Margin excl. VAT ' + money(v.margin_ht) + '</span></div></div>';
  }).join('');
  return '<div class="rp-break" data-rp-break="' + key + '"><h3>' + esc(title) + '</h3>' + rows + '</div>';
}

function unmatchedList(title, list) {
  if (!Array.isArray(list)) return '';
  const item = (x) => (isObj(x)
    ? Object.values(x).filter((v) => v !== null && v !== undefined && v !== '').map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(' · ')
    : String(x));
  return '<details class="rp-unm"><summary>' + esc(title) + ' (' + list.length + ')</summary>'
    + (list.length ? '<ul>' + list.map((x) => '<li>' + esc(item(x)) + '</li>').join('') + '</ul>' : '<p class="rp-muted rp-pad">None.</p>')
    + '</details>';
}

function accountingCard(d) {
  const a = d.accounting;
  let body;
  if (!a) {
    body = '<p class="empty pad">No accounting snapshot for this month yet.</p>';
  } else {
    const t = isObj(a.totals) ? a.totals : {};
    const at = a.computedAt ? Date.parse(a.computedAt) : NaN;
    const stale = !Number.isFinite(at) || Date.now() - at > STALE_MS;
    const rows = Array.isArray(a.rows) ? a.rows : null;
    body = '<p class="rp-fresh">' + (a.computedAt ? 'Computed ' + esc(dubaiStamp(a.computedAt)) : 'Computed: Not available')
      + (stale ? ' <span class="pill warn">Snapshot is older than 3 hours</span>' : '') + '</p>'
      + '<div class="rp-stats">'
      + stat('Cleanings', count(t.cleanings_count)) + stat('Revenue incl. VAT', money(t.revenue_ttc))
      + stat('Elite cost excl. VAT', money(t.cost_ht)) + stat('Margin excl. VAT', money(t.margin_ht))
      + stat('Margin rate', pct(t.margin_pct)) + stat('VAT net', money(t.vat_net))
      + stat('Unmatched', count(a.unmatchedCount))
      + '</div>'
      + breakdown('by_service', 'By service', t.by_service) + breakdown('by_bedrooms', 'By bedrooms', t.by_bedrooms)
      + '<div class="rp-unms">' + unmatchedList('Unmatched reservations', a.unmatchedResa) + unmatchedList('Unmatched pricing', a.unmatchedPricing) + '</div>'
      + '<div class="rp-acts">' + (rows && rows.length
        ? '<button class="btn" type="button" data-rp-csv>Download CSV</button>'
        : '<span class="rp-muted">No cleaning rows in this snapshot.</span>') + '</div>';
  }
  return '<section class="card" data-rp="accounting"><div class="sec-head"><h2>Elite accounting</h2></div>' + body + '</section>';
}

function opsCard(d) {
  const o = d.ops || {};
  const days = Array.isArray(o.last7DaysCompletions) ? o.last7DaysCompletions : [];
  const max = Math.max(1, ...days.map((x) => (isNum(x.completions) ? x.completions : 0)));
  const bars = days.map((x) => '<div class="rp-day"><span class="rp-n">' + count(x.completions) + '</span>'
    + '<span class="rp-bar"><i style="height:' + Math.round(((isNum(x.completions) ? x.completions : 0) / max) * 100) + '%"></i></span>'
    + '<span class="rp-d">' + esc(weekday(x.date)) + '</span></div>').join('');
  return '<section class="card" data-rp="ops"><div class="sec-head"><h2>Operations</h2></div>'
    + '<div class="rp-stats">'
    + stat('Average cleaning time', isNum(o.avgCleaningTime) ? o.avgCleaningTime + ' min' : NA)
    + stat('Timer sessions', count(o.totalTimerSessions))
    + stat('Open tickets', count(o.openMaintenanceTickets))
    + stat('Resolved in ' + monthLabel(d.month), count(o.resolvedThisMonth))
    + stat('Average resolution', isNum(o.avgResolutionHours) ? o.avgResolutionHours + ' h' : NA)
    + '</div>'
    + '<div class="rp-week"><h3>Completed cleanings, last 7 days</h3><div class="rp-days">' + (bars || NA) + '</div></div></section>';
}

function propsCard(d, all) {
  const list = Array.isArray(d.properties) ? d.properties : [];
  const shown = all ? list : list.slice(0, PROPS_SHOWN);
  const tone = (s) => (s >= 80 ? 'ok' : s >= 50 ? 'warn' : 'bad');
  const rows = shown.map((p) => '<a class="rp-prop" href="#/more/apartment/' + encodeURIComponent(p.listingId) + '">'
    + '<span class="rp-ptxt"><b>' + esc(p.apt ? p.apt + ' · ' + p.bld : p.bld) + '</b>'
    + '<span class="rp-muted">' + p.openTickets + ' open · ' + p.urgentOpen + ' urgent</span></span>'
    + '<span class="pill ' + tone(p.score) + '">' + esc(String(p.score)) + '</span>'
    + '<span class="rp-chev">' + I.next + '</span></a>').join('');
  return '<section class="card" data-rp="properties"><div class="sec-head"><h2>Property health</h2><span class="meta">Worst first</span></div>'
    + (list.length ? '<div class="rp-props">' + rows + '</div>' : '<p class="empty pad">No apartments.</p>')
    + (!all && list.length > PROPS_SHOWN ? '<div class="rp-acts"><button class="btn" type="button" data-rp-all>Show all (' + list.length + ')</button></div>' : '')
    + '</section>';
}

function exportsCard(st) {
  const b = (kind, label) => '<button class="btn" type="button" data-rp-export="' + kind + '"' + (st.exporting === kind ? ' disabled' : '') + '>'
    + esc(st.exporting === kind ? 'Preparing...' : label) + '</button>';
  return '<section class="card" data-rp="exports"><div class="sec-head"><h2>Exports</h2><span class="meta">' + esc(monthLabel(st.data.month)) + '</span></div>'
    + '<div class="rp-acts">' + b('cleanings', 'Cleanings CSV') + b('maintenance', 'Maintenance CSV') + '</div>'
    + (st.exportError ? '<p class="rp-err" role="alert">' + esc(st.exportError) + '</p>' : '')
    + '</section>';
}

const EXPORTS = {
  cleanings: ['exportCleaningsCsv', (m) => 'cleanings_' + m + '.csv'],
  maintenance: ['exportMaintenanceCsv', (m) => 'maintenance_costs_' + m + '.csv'],
};

export async function renderReports(ctx) {
  const main = ctx.main;
  const st = { data: null, month: '', seq: 0, all: false, exporting: '', exportError: '' };

  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
    return false;
  }

  function paint() {
    if (!ctx.isCurrent() || !st.data) return;
    const d = st.data;
    const months = Array.isArray(d.months) ? d.months.slice() : [];
    if (!months.includes(d.month)) months.unshift(d.month);
    main.innerHTML = header() + '<div class="rp">'
      + '<div class="rp-top"><label for="rp-month">Month</label><select id="rp-month" data-rp-month>'
      + months.map((m) => '<option value="' + esc(m) + '"' + (m === d.month ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>').join('')
      + '</select></div>'
      + accountingCard(d) + opsCard(d) + propsCard(d, st.all) + exportsCard(st)
      + '<section class="card" data-rp="inspections"><div class="sec-head"><h2>Inspection reports</h2></div>'
      + '<div class="rp-acts"><a class="btn" href="#/inspections/reports">Open inspection reports</a></div></section>'
      + '</div>';
  }

  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-rp-retry>Retry</button></div>';
  }

  async function load(month) {
    const my = ++st.seq;
    main.innerHTML = header() + '<div class="ph"><p role="status">Loading reports...</p></div>';
    try {
      const d = await get('mgr.reports', month ? { month } : undefined);
      if (!ctx.isCurrent() || my !== st.seq) return;
      st.data = d;
      st.month = d.month;
      st.all = false;
      st.exporting = '';
      st.exportError = '';
      paint();
    } catch (e) {
      if (!ctx.isCurrent() || my !== st.seq || handleAccess(e)) return;
      paintError(e.message || 'Could not load reports.');
    }
  }

  async function runExport(kind) {
    const [action, name] = EXPORTS[kind];
    const month = st.data.month;
    st.exporting = kind;
    st.exportError = '';
    paint();
    try {
      await download(action, { month }, name(month));
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      st.exportError = e.message || 'Export failed.';
    }
    if (!ctx.isCurrent() || !st.data || st.data.month !== month) return;
    st.exporting = '';
    paint();
  }

  const onClick = (ev) => {
    if (!ctx.isCurrent()) return;
    const t = ev.target.closest && ev.target.closest('[data-rp-retry],[data-rp-csv],[data-rp-all],[data-rp-export]');
    if (!t || !main.contains(t)) return;
    if (t.hasAttribute('data-rp-retry')) { load(st.month || ''); return; }
    if (!st.data || t.disabled) return;
    if (t.hasAttribute('data-rp-csv')) {
      const a = st.data.accounting;
      if (a && Array.isArray(a.rows)) saveText(rowsToCsv(a.rows), 'elite_accounting_' + st.data.month + '.csv');
      return;
    }
    if (t.hasAttribute('data-rp-all')) { st.all = true; paint(); return; }
    const kind = t.getAttribute('data-rp-export');
    if (kind && EXPORTS[kind] && !st.exporting) runExport(kind);
  };
  const onChange = (ev) => {
    if (!ctx.isCurrent()) return;
    const t = ev.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-rp-month') || !main.contains(t)) return;
    load(t.value);
  };
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  ctx.onLeave(() => { document.removeEventListener('click', onClick); document.removeEventListener('change', onChange); st.seq++; });

  await load('');
}
