import { get, post } from '/inspections/api.js';
import { fixBadge, fixFields } from '/inspections/fix.js';

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
  const st = { data: null, error: null, edit: null, busy: false, editError: '' };
  const me = ctx.me || {};
  const CLOSED = ['resolved', 'cancelled'];
  // Date de rectification modifiable : manager ou inspecteur auteur, zone en maintenance, ticket encore ouvert.
  const canFix = (it, i) => it.outcome === 'maintenance' && !(it.ticket && CLOSED.includes(it.ticket.status))
    && (me.role === 'manager' || (me.cleaner_id != null && me.cleaner_id === i.inspectorId));
  const editKey = (i, it) => i.id + ':' + it.zone;

  const fixHtml = (it, i) => {
    const key = editKey(i, it);
    if (st.edit && st.edit.key === key) {
      return '<div class="fixedit" data-testid="fixedit-' + esc(key) + '">' + fixFields(esc, key, st.edit.date, st.edit.slot)
        + (st.editError ? '<p class="notice bad" role="alert">' + esc(st.editError) + '</p>' : '')
        + '<div class="actions"><button class="btn primary" data-act="fix-save" data-k="' + esc(key) + '"' + (st.busy ? ' disabled' : '') + '>Save</button>'
        + (it.fixScheduledFor ? '<button class="btn ghost" data-act="fix-clear" data-k="' + esc(key) + '"' + (st.busy ? ' disabled' : '') + '>Remove date</button>' : '')
        + '<button class="btn ghost" data-act="fix-cancel"' + (st.busy ? ' disabled' : '') + '>Cancel</button></div></div>';
    }
    const b = fixBadge(esc, it);
    let h = b ? '<div class="badges">' + b + '</div>' : '';
    if (canFix(it, i)) {
      h += '<button class="btn ghost small" data-act="fix-edit" data-k="' + esc(key) + '">' + (it.fixScheduledFor ? 'Change fix date' : 'Set fix date') + '</button>';
    }
    return h;
  };
  const itemHtml = (it, i) => {
    let h = '<div class="zone-item"><strong>' + esc(it.label) + '</strong>';
    const miss = it.missingLabels || [];
    if (miss.length) h += '<p class="note">Missing: ' + miss.map(esc).join(', ') + '</p>';
    if (it.note) h += '<p class="note">' + esc(it.note) + '</p>';
    if (it.fixNote) h += '<p class="note">Fixed: ' + esc(it.fixNote) + '</p>';
    else if (it.ticket) h += '<p class="note">Ticket #' + esc(it.ticket.id) + ' · ' + esc(it.ticket.status) + '</p>';
    if (it.outcome === 'maintenance') h += fixHtml(it, i);
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
    h += (i.items || []).filter((it) => it.status === 'not_ok').map((it) => itemHtml(it, i)).join('');
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
  const find = (key) => {
    for (const i of (st.data && st.data.inspections) || []) for (const it of i.items || []) if (editKey(i, it) === key) return { i, it };
    return null;
  };
  async function saveFix(key, date, slot) {
    const f = find(key);
    if (!f || st.busy) return;
    st.busy = true; st.editError = ''; paint();
    try {
      const r = await post('insp.setFixSchedule', { inspectionId: f.i.id, zone: f.it.zone, date: date || null, slot: date ? slot : null });
      const item = r.item || {};
      f.it.fixScheduledFor = item.fixScheduledFor || null; f.it.fixScheduledSlot = item.fixScheduledSlot || null;
      f.it.fixOverdue = false; // une date posee n'est jamais dans le passe
      st.edit = null;
      ctx.toast && ctx.toast(f.it.fixScheduledFor ? 'Fix date saved' : 'Fix date removed');
    } catch (e) { st.editError = e.message || 'Could not save the fix date.'; }
    st.busy = false;
    if (isCurrent()) paint();
  }

  const view = document.getElementById('view');
  view.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'back') return go('#/fleet');
    if (b.disabled) return;
    if (b.dataset.act === 'fix-edit') {
      const f = find(b.dataset.k);
      if (!f) return;
      st.edit = { key: b.dataset.k, date: f.it.fixScheduledFor || '', slot: f.it.fixScheduledSlot || '' }; st.editError = '';
      paint();
      const el = document.getElementById('fixd-' + b.dataset.k);
      if (el) el.focus();
      return;
    }
    if (b.dataset.act === 'fix-cancel') { st.edit = null; st.editError = ''; return paint(); }
    if (b.dataset.act === 'fix-clear') return saveFix(b.dataset.k, null, null);
    if (b.dataset.act === 'fix-save') {
      if (!st.edit.date) { st.editError = 'Pick a date, or use Remove date.'; return paint(); }
      return saveFix(b.dataset.k, st.edit.date, (st.edit.slot || '').trim());
    }
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

  // Saisie de la date et du creneau : brouillon en memoire, sans repeindre.
  view.oninput = (ev) => {
    const t = ev.target;
    if (!st.edit || !t.dataset || t.dataset.z !== st.edit.key) return;
    if (t.dataset.f === 'fixDate') st.edit.date = t.value;
    if (t.dataset.f === 'fixSlot') st.edit.slot = t.value;
  };

  paint();
  try { st.data = await get('insp.history', { listingId: ctx.listingId }); } catch (e) { st.error = e.message || 'Could not load the history.'; }
  if (isCurrent()) paint();
}
