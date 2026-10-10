import { get, post } from '/inspections/api.js';

const dot = (c) => (c === 'green' ? 'dot-green' : c === 'orange' ? 'dot-orange' : 'dot-red');

function last(r) {
  if (r.daysSince == null) return 'Never inspected';
  const d = r.daysSince;
  const ago = d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago';
  return ago + (r.lastInspector ? ' · ' + r.lastInspector : '');
}

export async function renderFleet(ctx) {
  const { me, go, toast, render, esc } = ctx;
  const isCurrent = ctx.isCurrent || (() => true);
  const isMgr = me.role === 'manager';
  let busy = false;
  const st = { data: null, error: null, q: '', menu: null };

  const rowHtml = (r) => {
    const id = esc(r.listingId);
    let h = '<article class="card frow' + (r.excluded ? ' off' : '') + '" data-testid="row-' + id + '">'
      + '<div class="card-top"><span class="dot ' + (r.excluded ? 'dot-off' : dot(r.color)) + '" aria-hidden="true"></span>'
      + '<button class="link" data-act="open" data-id="' + id + '">' + esc(r.name) + '</button></div>';
    if (r.excluded) h += '<div class="badges"><span class="badge">Excluded</span></div>';
    else {
      h += '<p class="mute">' + esc(last(r)) + '</p><div class="badges">';
      if (r.openIssues > 0) h += '<span class="badge bad">' + r.openIssues + ' open issue' + (r.openIssues === 1 ? '' : 's') + '</span>';
      if (r.missed > 0) h += '<span class="badge warn">Missed ' + r.missed + '×</span>';
      h += '</div>';
    }
    if (isMgr) {
      h += '<div class="actions"><button class="btn ghost small" data-act="toggle" data-id="' + id + '" data-ex="' + (r.excluded ? '0' : '1') + '">'
        + (r.excluded ? 'Include again' : 'Exclude from inspections') + '</button></div>';
    }
    return h + '</article>';
  };

  const body = () => {
    let h = '<main class="wrap"><header class="top"><div><h1>Fleet</h1></div><button class="btn ghost" data-act="home">' + (ctx.embedded ? 'Back' : 'Today') + '</button></header>';
    if (st.error && !st.data) return h + '<p class="notice bad" role="alert">' + esc(st.error) + '</p></main>';
    if (!st.data) return h + '<p class="mute">Loading…</p></main>';
    const d = st.data;
    h += '<p class="count">' + esc(d.coveragePct) + '% of apartments inspected in the last 30 days · '
      + esc(d.inspectedThisMonth) + ' inspection' + (d.inspectedThisMonth === 1 ? '' : 's') + ' this month</p>';
    h += '<input id="fq" class="search" type="search" placeholder="Search apartments" value="' + esc(st.q) + '" aria-label="Search apartments">';
    const q = st.q.trim().toLowerCase();
    const rows = (d.rows || []).filter((r) => !q || String(r.name).toLowerCase().includes(q));
    const live = rows.filter((r) => !r.excluded), off = rows.filter((r) => r.excluded);
    h += live.map(rowHtml).join('') + off.map(rowHtml).join('');
    if (!rows.length) h += '<p class="mute">No apartment found.</p>';
    return h + '</main>';
  };

  const paint = () => {
    render(body());
    const fq = document.getElementById('fq');
    if (fq && st.focusQ) { fq.focus(); fq.setSelectionRange(fq.value.length, fq.value.length); }
  };

  async function toggle(id, ex, btn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try {
      await post('insp.setExcluded', { listingId: id, excluded: ex });
      const row = st.data.rows.find((r) => r.listingId === id);
      if (row) row.excluded = ex;
      st.data.rows.sort((a, b) => (a.excluded === b.excluded ? 0 : a.excluded ? 1 : -1));
    } catch (e) {
      toast(e.message || 'Something went wrong.');
      try { st.data = await get('insp.overview'); } catch (e2) { /* on garde l'ecran */ }
    } finally { busy = false; }
    if (isCurrent()) paint();
  }

  const view = document.getElementById('view');
  view.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'home') return go('#/');
    if (a === 'open') { st.focusQ = false; return go('#/history/' + encodeURIComponent(b.dataset.id)); }
    if (a === 'toggle') { st.focusQ = false; return toggle(b.dataset.id, b.dataset.ex === '1', b); }
  };
  view.oninput = (ev) => { if (ev.target.id === 'fq') { st.q = ev.target.value; st.focusQ = true; paint(); } };

  paint();
  try { st.data = await get('insp.overview'); } catch (e) { st.error = e.message || 'Could not load the fleet.'; }
  if (isCurrent()) paint();
}
