import { get, post } from '/inspections/api.js';

const TZ = 'Asia/Dubai';
const hh = (n) => String(n).padStart(2, '0') + ':00';
const dayMonth = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const longDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function reason(e) {
  if (!e) return '';
  if (e.kind === 'checkout') {
    let t = 'Checkout' + (e.checkOutTime != null ? ' ' + hh(e.checkOutTime) : '');
    if (e.nextCheckIn && e.nextCheckIn.time != null) t += ' → Check-in ' + hh(e.nextCheckIn.time);
    return t;
  }
  return 'Vacant' + (e.nextArrival ? ' · next arrival ' + dayMonth(e.nextArrival) : '');
}
function last(c) {
  if (c.daysSince == null) return 'Never inspected';
  const d = c.daysSince;
  const ago = d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago';
  return 'Last inspected ' + ago + (c.lastInspector ? ' by ' + c.lastInspector : '');
}
function dot(c) {
  if (c.daysSince == null || c.daysSince > 45) return 'dot-red';
  return c.daysSince >= 30 ? 'dot-orange' : 'dot-green';
}

export async function renderToday(ctx) {
  const { me, go, toast, render, esc } = ctx;
  const isCurrent = ctx.isCurrent || (() => true);
  let busy = false;
  const isMgr = me.role === 'manager';
  const st = { data: null, error: null, picker: null, assign: null, cleaners: null, q: '' };

  const cardHtml = (c) => {
    const mine = c.claimedBy === me.cleaner_id;
    let actions = '';
    if (c.inProgressBy) actions += '<span class="state">In progress by ' + esc(c.inProgressBy) + '</span>';
    else if (c.claimedBy == null) actions += '<button class="btn primary" data-act="claim" data-id="' + esc(c.listingId) + '">I\'ll take it</button>';
    else if (mine) actions += '<button class="btn primary" data-act="start" data-id="' + esc(c.listingId) + '" data-e="' + esc(c.eligibility && c.eligibility.kind) + '">Start inspection</button>'
      + '<button class="btn ghost" data-act="release" data-id="' + esc(c.listingId) + '">Release</button>';
    else {
      actions += '<span class="state">Taken by ' + esc(c.claimedByName || 'a teammate') + '</span>';
      if (isMgr) actions += '<button class="btn ghost" data-act="release" data-id="' + esc(c.listingId) + '">Release</button>';
    }
    if (isMgr) actions += '<button class="btn ghost" data-act="assign" data-id="' + esc(c.listingId) + '">Assign</button>';
    return '<article class="card"><div class="card-top"><span class="dot ' + dot(c) + '" aria-hidden="true"></span><h3>' + esc(c.name) + '</h3></div>'
      + '<p class="reason">' + esc(reason(c.eligibility)) + '</p>'
      + '<p class="mute">' + esc(last(c)) + '</p>'
      + '<div class="badges">' + (c.missed > 0 ? '<span class="badge warn">Missed ' + c.missed + '×</span>' : '')
      + (c.openIssue ? '<span class="badge bad">Open issue</span>' : '') + '</div>'
      + '<div class="actions">' + actions + '</div></article>';
  };

  const head = () => '<header class="top"><div><h1>Today\'s inspections</h1><p class="mute">'
    + esc(st.data ? longDate(st.data.day) : '') + '</p></div>'
    + '<button class="btn ghost" data-act="fleet">Fleet</button></header>';

  const body = () => {
    if (st.picker) {
      const q = st.q.trim().toLowerCase();
      const rows = st.picker.filter((r) => !r.excluded && (!q || String(r.name).toLowerCase().includes(q)));
      return '<main class="wrap"><button class="btn ghost" data-act="back">Back</button><h1>Inspect another apartment</h1>'
        + '<input id="pq" class="search" type="search" placeholder="Search apartments" value="' + esc(st.q) + '" aria-label="Search apartments">'
        + '<ul class="list">' + rows.map((r) => '<li><button class="row" data-act="adhoc" data-id="' + esc(r.listingId) + '">' + esc(r.name) + '</button></li>').join('')
        + (rows.length ? '' : '<li class="mute pad">No apartment found.</li>') + '</ul></main>';
    }
    if (st.assign) {
      return '<main class="wrap"><button class="btn ghost" data-act="back">Back</button><h1>Assign to</h1><ul class="list">'
        + (st.cleaners || []).map((c) => '<li><button class="row" data-act="assign-to" data-cid="' + esc(c.id) + '">' + esc(c.name) + '</button></li>').join('')
        + '</ul></main>';
    }
    let h = '<main class="wrap">' + head();
    if (st.error) {
      h += '<p class="notice bad" role="alert">' + esc(st.error) + '</p>';
    } else if (st.data) {
      const d = st.data;
      if (d.cachedAt) h += '<p class="notice">Bookings data from ' + esc(clock(d.cachedAt)) + '</p>';
      h += '<p class="mute">Target today: ' + esc(d.target) + '</p>';
      h += d.today.length ? d.today.map(cardHtml).join('') : '<p class="mute">Nothing suggested today.</p>';
      if (d.also && d.also.length) {
        h += '<details class="also"><summary>Also possible today (' + d.also.length + ')</summary>' + d.also.map(cardHtml).join('') + '</details>';
      }
    } else h += '<p class="mute">Loading…</p>';
    h += '<button class="btn block" data-act="picker">Inspect another apartment</button></main>';
    return h;
  };

  const paint = () => {
    render(body());
    const pq = document.getElementById('pq');
    if (pq) { pq.focus(); pq.setSelectionRange(pq.value.length, pq.value.length); }
  };

  function patch(p) {
    if (!p || !st.data) return;
    for (const c of st.data.today.concat(st.data.also || [])) {
      if (c.listingId === p.listingId) { c.claimedBy = p.claimedBy; c.claimedByName = p.claimedByName; }
    }
  }
  // Un seul geste a la fois : un double appui n'envoie qu'une requete. Apres un
  // refus (409 compris), on affiche le message du serveur et on recharge la liste.
  async function act(fn, btn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) {
      toast(e.message || 'Something went wrong.');
      if (e.kind === 'server') {
        st.assign = null;
        try { st.data = await get('insp.today'); st.error = null; } catch (e2) { /* on garde l'ecran actuel */ }
      }
    } finally { busy = false; }
    if (isCurrent()) paint();
  }

  const view = document.getElementById('view');
  view.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act, id = b.dataset.id;
    if (a === 'fleet') return go('#/fleet');
    if (a === 'start') return go('#/inspect/' + encodeURIComponent(id) + '?e=' + (b.dataset.e || 'adhoc'));
    if (a === 'adhoc') return go('#/inspect/' + encodeURIComponent(id) + '?e=adhoc');
    if (a === 'back') { st.picker = null; st.assign = null; st.q = ''; return paint(); }
    if (a === 'claim') return act(async () => { patch((await post('insp.claim', { listingId: id })).proposal); }, b);
    if (a === 'release') return act(async () => { patch((await post('insp.unclaim', { listingId: id })).proposal || { listingId: id, claimedBy: null, claimedByName: null }); }, b);
    if (a === 'picker') return act(async () => {
      if (!st.overview) st.overview = await get('insp.overview');
      st.picker = st.overview.rows || [];
    }, b);
    if (a === 'assign') return act(async () => {
      if (!st.cleaners) {
        const r = await get('getCleaners');
        st.cleaners = (r.cleaners || []).filter((c) => c.is_active !== false && c.role !== 'subcontractor');
      }
      st.assign = id;
    }, b);
    if (a === 'assign-to') return act(async () => {
      const p = (await post('insp.assign', { listingId: st.assign, cleanerId: Number(b.dataset.cid) })).proposal;
      patch(p); st.assign = null;
    }, b);
  };
  view.oninput = (ev) => { if (ev.target.id === 'pq') { st.q = ev.target.value; paint(); } };

  paint();
  try { st.data = await get('insp.today'); } catch (e) { st.error = e.message || 'Could not load today\'s inspections.'; }
  if (isCurrent()) paint();
}
