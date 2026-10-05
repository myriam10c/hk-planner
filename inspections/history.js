import { get } from '/inspections/api.js';

const TZ = 'Asia/Dubai';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function date(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: TZ }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return p.day + ' ' + MON[Number(p.month) - 1] + ' ' + p.year;
}
const ELIG = { checkout: 'Checkout', vacant: 'Vacant', adhoc: 'Ad hoc' };

export async function renderHistory(ctx) {
  const { go, render, esc } = ctx;
  const isCurrent = ctx.isCurrent || (() => true);
  const st = { data: null, error: null };

  const itemHtml = (it) => {
    let h = '<div class="zone-item"><strong>' + esc(it.label) + '</strong>';
    if (it.note) h += '<p class="note">' + esc(it.note) + '</p>';
    if (it.fixNote) h += '<p class="note">Fixed: ' + esc(it.fixNote) + '</p>';
    else if (it.ticket) h += '<p class="note">Ticket #' + esc(it.ticket.id) + ' · ' + esc(it.ticket.status) + '</p>';
    const ph = (it.photos || []).filter((p) => p && p.url);
    if (ph.length) {
      h += '<div class="thumbs">' + ph.map((p) => '<button data-act="photo" data-url="' + esc(p.url) + '" aria-label="Open photo">'
        + '<img src="' + esc(p.url) + '" alt="' + esc(it.label) + ' photo" width="72" height="72" style="width:72px;height:72px;object-fit:cover;border-radius:8px"></button>').join('') + '</div>';
    }
    return h + '</div>';
  };
  const inspHtml = (i) => {
    const title = date(i.startedAt) + ' · ' + (i.inspector || '') + ' · ' + (ELIG[i.eligibility] || '');
    let h = '<article class="card hist"><p class="when">' + esc(title) + '</p>';
    if (!i.finishedAt) h += '<div class="badges"><span class="badge warn">In progress</span></div>';
    if (i.generalNote) h += '<p class="note">' + esc(i.generalNote) + '</p>';
    h += (i.items || []).filter((it) => it.status === 'not_ok').map(itemHtml).join('');
    return h + '</article>';
  };
  const body = () => {
    let h = '<main class="wrap"><button class="btn ghost" data-act="back">Back to fleet</button>';
    if (st.error) return h + '<p class="notice bad" role="alert">' + esc(st.error) + '</p></main>';
    if (!st.data) return h + '<p class="mute">Loading…</p></main>';
    h += '<h1>' + esc(st.data.name) + '</h1>';
    const list = st.data.inspections || [];
    h += list.length ? list.map(inspHtml).join('') : '<p class="mute">No inspection yet</p>';
    return h + '</main>';
  };
  const paint = () => render(body());

  const view = document.getElementById('view');
  view.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'back') return go('#/fleet');
    if (b.dataset.act === 'photo') {
      const dlg = document.createElement('dialog');
      dlg.className = 'photo';
      dlg.innerHTML = '<img alt="Photo"><button class="btn ghost" data-close>Close</button>';
      dlg.querySelector('img').src = b.dataset.url;
      dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });
      dlg.addEventListener('close', () => dlg.remove());
      document.body.appendChild(dlg);
      dlg.showModal();
    }
  };

  paint();
  try { st.data = await get('insp.history', { listingId: ctx.listingId }); } catch (e) { st.error = e.message || 'Could not load the history.'; }
  if (isCurrent()) paint();
}
