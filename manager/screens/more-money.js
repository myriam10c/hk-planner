// More > Cleaning money : trois chiffres du mois (revenu equipe, garde sur Elite, profit potentiel)
// et stats par cleaner. Lecture seule : mgr.reports (snapshot serveur).
// Regle comptable : aucun montant n'est calcule ici, tout vient du snapshot ; une valeur absente
// s'affiche « Not available ».
import { get } from '/manager/api.js';
import { esc, I } from '/manager/ui/dom.js';
import { NA, STALE_MS, money, count, monthLabel, dubaiStamp, isNum, isObj } from '/manager/screens/more-reports.js';

const NF1 = new Intl.NumberFormat('en-AE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec1 = (v) => (isNum(v) ? NF1.format(v) : NA);

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Cleaning money</h1></div></header>';
}

const plural = (n, one, many) => (n === 1 ? one : many);
const block = (key, label, value, sub) => '<div class="mn-stat" data-mn-stat="' + key + '"><span class="mn-label">' + esc(label)
  + '</span><b class="mn-value">' + value + '</b><span class="mn-sub">' + sub + '</span></div>';

function summary(t, team) {
  const n = team && isNum(team.cleanings_count) ? team.cleanings_count : null;
  const teamSub = n === null ? '' : n + ' ' + plural(n, 'cleaning', 'cleanings') + ' done by your team';
  return '<section data-mn="summary"><div class="mn-stats">'
    + block('team', 'Team revenue', team ? money(team.revenue_ht) : NA, teamSub)
    + block('elite', 'Kept on Elite', money(t.margin_ht),
      count(t.cleanings_count) + ' ' + plural(t.cleanings_count, 'cleaning', 'cleanings') + ' · revenue ' + money(t.revenue_ht) + ' · Elite cost ' + money(t.cost_ht))
    + block('potential', 'Potential profit', money(t.potential_profit_ht), 'Team revenue + kept on Elite')
    + '</div><p class="mn-note">All amounts exclude VAT. Before variable costs: OTA commission, products, laundry, salaries.</p></section>';
}

function flags(team) {
  const items = [];
  const f = (v, one, many) => { if (isNum(v) && v > 0) items.push('<li>' + esc(v === 1 ? one : v + many) + '</li>'); };
  f(team.not_done_count, '1 team cleaning not marked done, not counted.', ' team cleanings not marked done, not counted.');
  f(team.missing_fee_count, '1 team cleaning with no cleaning fee on the booking.', ' team cleanings with no cleaning fee on the booking.');
  f(team.unmatched_count, '1 team cleaning not matched to a booking, revenue not counted.', ' team cleanings not matched to a booking, revenue not counted.');
  f(team.shared_with_elite_count, '1 cleaning with both Elite and a team member, counted as Elite.', ' cleanings with both Elite and a team member, counted as Elite.');
  const sk = team.skipped_count;
  if (isNum(sk) && sk > 0) items.push('<li>' + esc((sk === 1 ? '1 team assignment' : sk + ' team assignments') + ' not counted: no checkout that day, or booking already counted.') + '</li>');
  return items.length ? '<ul class="mn-flags">' + items.join('') + '</ul>' : '';
}

function teamSection(team) {
  if (!team) return '<section class="card" data-mn="team"><div class="sec-head"><h2>Your team</h2></div><p class="empty pad">Team figures are not available for this month.</p></section>';
  const list = Array.isArray(team.by_cleaner) ? team.by_cleaner : [];
  const rows = list.map((c) => {
    const p = isObj(c) ? c : {};
    return '<div class="mn-person"><span class="mn-ptxt"><span class="mn-name">' + esc(String(p.name == null ? '' : p.name)) + '</span>'
      + '<span>' + count(p.cleanings) + ' ' + plural(p.cleanings, 'cleaning', 'cleanings') + ' · ' + count(p.days_worked) + ' ' + plural(p.days_worked, 'day', 'days') + ' · ' + dec1(p.per_day) + ' per day</span></span>'
      + '<span class="mn-pval">' + money(p.revenue_ht) + '</span></div>';
  }).join('');
  return '<section class="card" data-mn="team"><div class="sec-head"><h2>Your team</h2></div>'
    + (isNum(team.per_cleaner_day) ? '<p class="mn-avg">Average: ' + NF1.format(team.per_cleaner_day) + ' cleanings per cleaner per day worked</p>' : '')
    + (list.length ? '<div class="mn-people">' + rows + '</div>' : '<p class="empty pad">No team cleanings this month.</p>')
    + flags(team) + '</section>';
}

export async function renderMoney(ctx) {
  const main = ctx.main;
  // Ecran reserve au proprietaire : sinon message, aucune lecture (le serveur refuse aussi).
  if (!(ctx.me && ctx.me.isOwner === true)) {
    main.innerHTML = header() + '<div class="ph" data-mn="owner-only"><p role="alert">Only the owner can see this screen.</p></div>';
    return;
  }
  const st = { data: null, month: '', seq: 0 };

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
    const a = d.accounting;
    let body;
    if (!a) {
      body = '<section class="card"><p class="empty pad">No snapshot for this month yet.</p></section>';
    } else {
      const t = isObj(a.totals) ? a.totals : {};
      const team = isObj(t.team) ? t.team : null;
      const at = a.computedAt ? Date.parse(a.computedAt) : NaN;
      const stale = Number.isFinite(at) && Date.now() - at > STALE_MS;
      body = '<p class="rp-fresh">' + (a.computedAt ? 'Computed ' + esc(dubaiStamp(a.computedAt)) : 'Computed: Not available')
        + (stale ? ' <span class="pill warn">Snapshot is older than 3 hours</span>' : '') + '</p>'
        + '<div class="card">' + summary(t, team) + '</div>'
        + teamSection(team)
        + '<div class="rp-acts"><a class="btn" href="#/more/reports">Elite invoice check</a></div>';
    }
    main.innerHTML = header() + '<div class="rp mn">'
      + '<div class="rp-top"><label for="mn-month">Month</label><select id="mn-month" data-mn-month>'
      + months.map((m) => '<option value="' + esc(m) + '"' + (m === d.month ? ' selected' : '') + '>' + esc(monthLabel(m)) + '</option>').join('')
      + '</select></div>' + body + '</div>';
  }

  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-mn-retry>Retry</button></div>';
  }

  async function load(month) {
    const my = ++st.seq;
    main.innerHTML = header() + '<div class="ph"><p role="status">Loading cleaning money...</p></div>';
    try {
      const d = await get('mgr.reports', month ? { month } : undefined);
      if (!ctx.isCurrent() || my !== st.seq) return;
      st.data = d;
      st.month = d.month;
      paint();
    } catch (e) {
      if (!ctx.isCurrent() || my !== st.seq || handleAccess(e)) return;
      paintError(e.message || 'Could not load cleaning money.');
    }
  }

  const onClick = (ev) => {
    if (!ctx.isCurrent()) return;
    const t = ev.target.closest && ev.target.closest('[data-mn-retry]');
    if (t && main.contains(t)) load(st.month || '');
  };
  const onChange = (ev) => {
    if (!ctx.isCurrent()) return;
    const t = ev.target;
    if (!t || !t.hasAttribute || !t.hasAttribute('data-mn-month') || !main.contains(t)) return;
    load(t.value);
  };
  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  ctx.onLeave(() => { document.removeEventListener('click', onClick); document.removeEventListener('change', onChange); st.seq++; });

  await load('');
}
