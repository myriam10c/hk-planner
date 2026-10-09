// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier,
// cache local du dernier Today (spec section 7).
import { get, post } from '/manager/api.js';
import { clearToday, loadToday, saveToday } from '/manager/today-cache.js';
import { closeSheet, dubaiTime, esc, openSheet, placeLabel, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { arrivalSheet, boardHtml, jobSheet, pickerSheet, problemSheet } from '/manager/screens/today-view.js';

function dubaiParts(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return p;
}
function dubaiDay(ms) { const p = dubaiParts(ms); return p.year + '-' + p.month + '-' + p.day; }

function shellHtml(inner) { return '<header class="top"><div><h1>Today</h1></div></header>' + inner; }

export async function renderToday(ctx) {
  const main = ctx.main;
  const st = { data: null, savedAt: 0, fresh: false, loading: true, error: null, busy: false };
  const cached = loadToday();
  // Hors ligne au demarrage (ctx.me inconnu) : le cache de l'appareil. Sinon,
  // seulement celui du manager connecte.
  if (cached && (!ctx.me || (cached.data.me && cached.data.me.id === ctx.me.id))) {
    st.data = cached.data;
    st.savedAt = cached.savedAt;
  }

  function banner() {
    let h = '';
    if (st.data && !st.fresh) {
      let when = dubaiTime(new Date(st.savedAt).toISOString());
      const old = st.data.day !== dubaiDay(Date.now());
      if (old) { const p = dubaiParts(st.savedAt); when = p.weekday + ' ' + p.day + '/' + p.month + ' ' + when; }
      const note = old ? ' Not today\'s data.' : '';
      if (st.error) {
        h += '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message) + esc(note)
          + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
      } else if (st.loading) {
        h += '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.' + esc(note) + '</span></div>';
      }
    }
    if (st.data && st.data.bookingsCachedAt) {
      h += '<div class="banner warn" role="status"><span>Bookings data from ' + esc(dubaiTime(st.data.bookingsCachedAt))
        + '. Hostaway is not answering, statuses may be late.</span></div>';
    }
    return h;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    if (st.data) { main.innerHTML = boardHtml(st.data, Date.now(), banner(), !st.fresh); return; }
    if (st.loading) { main.innerHTML = shellHtml('<p class="boot" role="status">Loading today…</p>'); return; }
    main.innerHTML = shellHtml('<div class="err-card" role="alert"><p>' + esc(st.error ? st.error.message : 'Could not load.')
      + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>');
  }

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran.
  function handleAccess(e) {
    if (e.kind === 'auth' || e.kind === 'forbidden') clearToday();
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  async function refresh() {
    st.loading = true;
    st.error = null;
    paint();
    try {
      const d = await get('mgr.today');
      st.data = d;
      st.savedAt = Date.now();
      st.fresh = true;
      saveToday(d, st.savedAt);
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    paint();
  }

  // Cible d'une ecriture : un menage du jour, ou le menage precedent d'une arrivee.
  function targetFor(key) {
    const j = st.data.who.jobs.find((x) => x.key === key);
    if (j) return { key, apt: j.apt, bld: j.bld, assigned: j.assigned, serviceType: j.serviceType, sub: j.checkout ? 'checkout ' + j.checkout : '' };
    const a = st.data.arrivals.rows.find((x) => x.prevKey === key);
    if (a) return { key, apt: a.apt, bld: a.bld, assigned: a.assigned, serviceType: a.serviceType, sub: a.kind + ' at ' + a.time };
    return null;
  }
  function nameOf(id) {
    const p = st.data.assignable.find((x) => x.id === Number(id));
    return p ? p.name : 'Member ' + id;
  }
  function sheetBusy(on) {
    document.querySelectorAll('#sheet button:not([data-close])').forEach((b) => { b.disabled = on; });
  }
  function sheetError(msg) {
    const body = document.querySelector('#sheet .sheet-b');
    if (!body) return;
    let el = body.querySelector('.sheet-err');
    if (!el) {
      el = document.createElement('p');
      el.className = 'sheet-err';
      el.setAttribute('role', 'alert');
      body.prepend(el);
    }
    el.textContent = msg;
  }
  async function undo(fn) {
    try { await fn(); } catch (e) { toast(e.message); }
    refresh();
  }

  async function write(t, call, okMsg, undoCall) {
    if (st.busy) return;
    st.busy = true;
    sheetBusy(true);
    try {
      await call();
    } catch (e) {
      st.busy = false;
      sheetBusy(false);
      if (handleAccess(e)) return;
      sheetError(e.message);
      return;
    }
    st.busy = false;
    closeSheet();
    toast(okMsg, () => undo(undoCall));
    refresh();
  }

  function assign(key, id) {
    const t = targetFor(key);
    if (!t) return;
    const prev = t.assigned.slice();
    const service = t.serviceType || 'CHC';
    return write(t,
      () => post('assignCleaner', { reservation_key: key, cleaner_ids: [Number(id)], mode: 'set', service_type: service }),
      placeLabel(t) + ' assigned to ' + nameOf(id),
      () => post('assignCleaner', { reservation_key: key, cleaner_ids: prev, mode: 'set', service_type: service }));
  }

  function setDone(key, val) {
    const t = targetFor(key);
    if (!t) return;
    return write(t,
      () => post('setDone', { key, done: val }),
      placeLabel(t) + (val ? ' marked done' : ' back to not done'),
      () => post('setDone', { key, done: !val }));
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-retry],[data-open],[data-assign],[data-pick],[data-done]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (!st.data) return;
    if (el.hasAttribute('data-pick')) { assign(el.getAttribute('data-key'), el.getAttribute('data-pick')); return; }
    if (el.hasAttribute('data-assign')) {
      const t = targetFor(el.getAttribute('data-assign'));
      if (t) openSheet(pickerSheet(st.data, t));
      return;
    }
    if (el.hasAttribute('data-done')) { setDone(el.getAttribute('data-done'), el.getAttribute('data-val') === '1'); return; }
    const op = el.getAttribute('data-open');
    const now = Date.now();
    if (op === 'job') {
      const j = st.data.who.jobs.find((x) => x.key === el.getAttribute('data-key'));
      if (j) openSheet(jobSheet(st.data, j, now));
    } else if (op === 'arr') {
      const a = st.data.arrivals.rows.find((x) => x.id === el.getAttribute('data-id'));
      if (a) openSheet(arrivalSheet(st.data, a, now));
    } else if (op === 'prob') {
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) openSheet(problemSheet(p));
    }
  }

  // Fleches haut / bas entre les lignes d'un meme bloc (problemes, arrivees).
  function onKey(e) {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || sheetIsOpen()) return;
    const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-nav-row]') : null;
    if (!row) return;
    const all = Array.from(row.closest('section').querySelectorAll('[data-nav-row]'));
    const next = all[all.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  });
  await refresh();
}
