// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier,
// cache local du dernier Today (spec section 7).
import { get, post } from '/manager/api.js';
import { clearToday, loadToday, saveToday } from '/manager/today-cache.js';
import { createGestures } from '/manager/gesture.js';
import { addDays, announceBadge, closeSheet, dubaiTime, esc, openSheet, placeLabel, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { aheadPickerSheet, arrivalSheet, boardHtml, jobSheet, pickerSheet } from '/manager/screens/today-view.js';
import { namesOf, weekStartOf } from '/manager/screens/planning-rules.js';
import { createProblemPanel } from '/manager/problem-panel.js';

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
  // day : jour choisi dans « Who does what » (null = aujourd'hui).
  const st = { data: null, savedAt: 0, fresh: false, loading: true, error: null, busy: false, sheetKey: null, day: null };
  // Semaines mgr.planning lues pour les autres jours, en memoire pour la vie de l'ecran :
  // start -> { data, fresh, loading, error, seq }. wseq : garde contre une reponse tardive.
  const weeks = {};
  let wseq = 0;
  const gestures = createGestures();
  const cached = loadToday();
  // Hors ligne au demarrage (ctx.me inconnu) : le cache de l'appareil. Sinon,
  // seulement celui du manager connecte.
  if (cached && (!ctx.me || (cached.data.me && cached.data.me.id === ctx.me.id))) {
    st.data = cached.data;
    st.savedAt = cached.savedAt;
  }

  // Donnees en cache ou d'un autre jour : aucune ecriture possible.
  function readOnly() { return !st.fresh || !st.data || st.data.day !== dubaiDay(Date.now()); }
  function refuseRo() { toast('Reconnect to make changes.'); }

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

  // Jours du bloc : aujourd'hui (Dubai), demain, puis cinq jours.
  function aheadState() {
    const today = dubaiDay(Date.now());
    const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(today, n));
    const sel = st.day && days.includes(st.day) ? st.day : today;
    return { days, sel, week: sel === today ? null : weeks[weekStartOf(sel)] || null };
  }
  function otherDay() { const a = aheadState(); return a.sel === a.days[0] ? null : a.sel; }

  function paint() {
    if (!ctx.isCurrent()) return;
    if (st.data) { main.innerHTML = boardHtml(st.data, Date.now(), banner(), !st.fresh, readOnly(), aheadState()); return; }
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
      announceBadge(d.problems.counts.urgent);
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    paint();
  }

  // Semaine d'un autre jour : seule la derniere demande pour cette semaine compte, et
  // l'ecran n'est repeint que si le jour choisi est encore dans cette semaine.
  async function loadWeek(start) {
    const w = weeks[start] || (weeks[start] = { data: null, fresh: false, loading: false, error: null, seq: 0 });
    const mine = ++wseq;
    w.seq = mine;
    w.loading = true;
    w.error = null;
    paintIfShown(start);
    try {
      const d = await get('mgr.planning', { start });
      if (w.seq !== mine || !ctx.isCurrent()) return;
      w.data = d;
      w.fresh = true;
    } catch (e) {
      if (w.seq !== mine || !ctx.isCurrent()) return;
      if (handleAccess(e)) return;
      w.error = e;
      w.fresh = false;
    }
    w.loading = false;
    paintIfShown(start);
  }
  function paintIfShown(start) {
    const d = otherDay();
    if (d && weekStartOf(d) === start) paint();
  }
  function pickDay(day) {
    st.day = day;
    const d = otherDay();
    if (d) {
      const w = weeks[weekStartOf(d)];
      if (!w || (!w.data && !w.loading)) { loadWeek(weekStartOf(d)); return; }
    }
    paint();
  }
  function aheadJob(key) {
    const d = otherDay();
    const w = d ? weeks[weekStartOf(d)] : null;
    const j = w && w.data ? w.data.jobs.find((x) => x.key === key) : null;
    return j && !j.cancelled && j.state !== 'done' ? { j, w, start: weekStartOf(d) } : null;
  }
  // Ecriture sur un autre jour : semaine fraiche obligatoire, cle d'idempotence par geste,
  // jamais d'auteur, puis rechargement de cette semaine (le jour choisi reste).
  async function aheadWrite(start, key, body, okMsg, undoFn) {
    if (st.busy) { busyToast(); return; }
    const w = weeks[start];
    if (!w || !w.fresh || !w.data) { refuseRo(); return; }
    st.busy = true;
    sheetBusy(true);
    try {
      await gestures.run('assignCleaner|' + JSON.stringify(body), (idem) => post('assignCleaner', { ...body, idem }));
    } catch (e) {
      st.busy = false;
      sheetBusy(false);
      document.querySelectorAll('#sheet [data-off]').forEach((b) => { b.disabled = true; });
      if (handleAccess(e)) return;
      if (heldHere(key)) sheetError(e.message); else toast(e.message);
      return;
    }
    st.busy = false;
    if (heldHere(key)) closeSheet();
    toast(okMsg, undoFn);
    loadWeek(start);
  }
  function aheadAssign(key, id) {
    const t = aheadJob(key);
    if (!t) return;
    const { j, w, start } = t;
    const prev = j.assigned.slice();
    const ids = [Number(id)];
    const service = j.serviceType || 'CHC';
    const where = placeLabel(j);
    const label = (list) => (list.length ? namesOf(w.data, list) : 'nobody');
    const body = (list) => ({ reservation_key: key, cleaner_ids: list, mode: 'set', service_type: service });
    aheadWrite(start, key, body(ids), where + ' assigned to ' + label(ids),
      () => aheadWrite(start, key, body(prev), where + ' back to ' + label(prev)));
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
  function heldHere(key) { return sheetIsOpen() && st.sheetKey === key; }
  function busyToast() { toast('Saving, wait a second.'); }
  async function undo(fn) {
    if (st.busy) { busyToast(); return; }
    if (readOnly()) { refuseRo(); return; }
    st.busy = true;
    try { await fn(); } catch (e) { toast(e.message); }
    st.busy = false;
    refresh();
  }

  async function write(t, call, okMsg, undoCall) {
    if (st.busy) { busyToast(); return; }
    if (readOnly()) { refuseRo(); return; }
    const key = t.key;
    st.busy = true;
    sheetBusy(true);
    try {
      await call();
    } catch (e) {
      st.busy = false;
      sheetBusy(false);
      if (handleAccess(e)) return;
      if (heldHere(key)) sheetError(e.message); else toast(e.message);
      return;
    }
    st.busy = false;
    if (heldHere(key)) closeSheet();
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
    const el = e.target && e.target.closest
      ? e.target.closest('[data-retry],[data-open],[data-assign],[data-pick],[data-done],[data-wday],[data-wretry],[data-wassign],[data-wpick]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (!st.data) return;
    if (el.hasAttribute('data-wday')) { pickDay(el.getAttribute('data-wday')); return; }
    if (el.hasAttribute('data-wretry')) { const d = otherDay(); if (d) loadWeek(weekStartOf(d)); return; }
    if (el.hasAttribute('data-wassign') || el.hasAttribute('data-wpick')) {
      if (el.disabled) return;
      if (st.busy) { busyToast(); return; }
      const t = aheadJob(el.getAttribute(el.hasAttribute('data-wassign') ? 'data-wassign' : 'data-key'));
      if (!t) return;
      if (!t.w.fresh) { refuseRo(); return; }
      if (el.hasAttribute('data-wpick')) { aheadAssign(t.j.key, el.getAttribute('data-wpick')); return; }
      st.sheetKey = t.j.key;
      openSheet(aheadPickerSheet(t.w.data, t.j));
      return;
    }
    if (el.hasAttribute('data-pick') || el.hasAttribute('data-assign') || el.hasAttribute('data-done')) {
      if (st.busy) { busyToast(); return; }
      if (readOnly()) { refuseRo(); return; }
    }
    if (el.hasAttribute('data-pick')) { assign(el.getAttribute('data-key'), el.getAttribute('data-pick')); return; }
    if (el.hasAttribute('data-assign')) {
      const t = targetFor(el.getAttribute('data-assign'));
      if (t) { st.sheetKey = t.key; openSheet(pickerSheet(st.data, t, readOnly())); }
      return;
    }
    if (el.hasAttribute('data-done')) { setDone(el.getAttribute('data-done'), el.getAttribute('data-val') === '1'); return; }
    const op = el.getAttribute('data-open');
    const now = Date.now();
    if (op === 'job') {
      const j = st.data.who.jobs.find((x) => x.key === el.getAttribute('data-key'));
      if (j) { st.sheetKey = j.key; openSheet(jobSheet(st.data, j, now, readOnly())); }
    } else if (op === 'arr') {
      const a = st.data.arrivals.rows.find((x) => x.id === el.getAttribute('data-id'));
      if (a) { st.sheetKey = a.prevKey || null; openSheet(arrivalSheet(st.data, a, now, readOnly())); }
    } else if (op === 'prob') {
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) { st.sheetKey = null; panel.open(p.ref, p); }
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

  // Fiche et gestes des problemes : meme panneau que l'ecran Problems.
  const panel = createProblemPanel({ readOnly, onChange: () => refresh(), handleAccess });
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    panel.dispose();
  });
  await refresh();
}
