// Ecran Planning (spec 2026-10-09, sections 3, 4 et 9.3) : la semaine de menages,
// grille de 7 jours sur ordinateur, un jour a la fois sur telephone, une couleur
// par personne. Lecture : mgr.planning (un appel par semaine, derniere semaine vue
// gardee sur l'appareil, en lecture seule). Gestes : les actions existantes du
// proxy, une cle d'idempotence par geste, jamais d'auteur envoye.
import { get, post } from '/manager/api.js';
import { createGestures } from '/manager/gesture.js';
import { clearCache, loadCache, saveCache } from '/manager/today-cache.js';
import {
  addDays, closeSheet, dubaiTime, dubaiToday, esc, openSheet, placeLabel, sheetBusy, sheetError, sheetIsOpen, toast,
} from '/manager/ui/dom.js';
import { dayShort, defaultDay, LAUNDRY_ITEMS, laundryParse, namesOf, weekStartOf } from '/manager/screens/planning-rules.js';
import * as V from '/manager/screens/planning-view.js';

const KEY = 'mgrPlanningCache';
const RO_LINE = 'Reconnect to make changes.';

export async function renderPlanning(ctx) {
  const main = ctx.main;
  const today = dubaiToday(Date.now());
  const mq = window.matchMedia('(min-width: 960px)');
  const st = {
    start: weekStartOf(today), today, day: today, data: null, savedAt: 0, fresh: false,
    loading: true, error: null, busy: false, filter: null, seq: 0, sheet: null, pick: new Set(),
  };
  const gestures = createGestures();
  // ACT[data-pa] = (menage, bouton) => void ; hooks.resync : apres une ecriture rendue.
  const ACT = {};
  const hooks = { resync: () => {} };

  const readOnly = () => !st.fresh || !st.data;
  const job = (key) => (st.data ? st.data.jobs.find((j) => j.key === key) || null : null);
  const heldHere = (key) => sheetIsOpen() && !!st.sheet && st.sheet.key === key;

  // Derniere semaine vue sur cet appareil, seulement la meme semaine et le meme manager.
  function fromCache() {
    const c = loadCache(KEY, (d) => !!(d && d.start && Array.isArray(d.jobs) && Array.isArray(d.days)));
    if (!c || c.data.start !== st.start) return;
    if (ctx.me && (!c.data.me || c.data.me.id !== ctx.me.id)) return;
    st.data = c.data;
    st.savedAt = c.savedAt;
  }

  function banner() {
    if (!st.data || st.fresh) return '';
    const savedDay = dubaiToday(st.savedAt);
    const when = (savedDay === st.today ? '' : dayShort(savedDay) + ' ') + dubaiTime(new Date(st.savedAt).toISOString());
    if (st.error) {
      return '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message)
        + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
    }
    return '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.</span></div>';
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    main.innerHTML = V.screenHtml({
      data: st.data, start: st.start, today: st.today, day: st.day, wide: mq.matches, filter: st.filter,
      loading: st.loading, error: st.error, banner: banner(), stale: !st.fresh, ro: readOnly(),
    });
  }

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran.
  function handleAccess(e) {
    if (e.kind === 'auth' || e.kind === 'forbidden') clearCache(KEY);
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  async function refresh() {
    const mine = ++st.seq;
    const start = st.start;
    st.loading = true;
    st.error = null;
    if (!st.data) fromCache();
    paint();
    try {
      const d = await get('mgr.planning', { start });
      if (mine !== st.seq || !ctx.isCurrent()) return;
      st.data = d;
      st.savedAt = Date.now();
      st.fresh = true;
      saveCache(KEY, d, st.savedAt);
    } catch (e) {
      if (mine !== st.seq || !ctx.isCurrent()) return;
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    if (st.data && !st.data.days.some((x) => x.date === st.day)) st.day = defaultDay(st.data.start, st.today);
    paint();
  }

  function goWeek(n) {
    st.start = n === 0 ? weekStartOf(st.today) : addDays(st.start, 7 * n);
    st.day = defaultDay(st.start, st.today);
    st.data = null;
    st.fresh = false;
    closeSheet();
    refresh();
  }

  // Panneau d'un menage (key) dans une vue : detail, assign, cancel, postpone,
  // laundry, extra, delete. key '__new' = creation d'un extra (aucun menage).
  function show(key, view) {
    const j = key === '__new' ? null : job(key);
    if (key !== '__new' && !j) { closeSheet(); return; }
    const fn = view === 'detail' ? V.jobSheet : V[view + 'Sheet'];
    if (typeof fn !== 'function') return;
    st.sheet = { key, view };
    openSheet(fn(st.data, j, readOnly(), st));
  }

  // Boutons du panneau rendus apres une ecriture : ceux d'une personne en conge restent bloques.
  function unbusy() {
    sheetBusy(false);
    document.querySelectorAll('#sheet [data-off]').forEach((b) => { b.disabled = true; });
    hooks.resync();
  }

  // Un geste : cle d'idempotence (reprise au reessai incertain), panneau bloque
  // pendant l'envoi, erreur du serveur telle quelle, puis toast et rechargement.
  async function write(key, action, body, okMsg, undo) {
    if (st.busy) { toast('Saving, wait a second.'); return false; }
    if (readOnly()) { toast(RO_LINE); return false; }
    st.busy = true;
    sheetBusy(true);
    try {
      await gestures.run(action + '|' + JSON.stringify(body), (idem) => post(action, { ...body, idem }));
    } catch (e) {
      st.busy = false;
      unbusy();
      if (handleAccess(e)) return false;
      if (heldHere(key)) sheetError(e.message); else toast(e.message);
      return false;
    }
    st.busy = false;
    unbusy();
    if (heldHere(key)) closeSheet();
    toast(okMsg, undo);
    refresh();
    return true;
  }

  // Gestes (taches 6 a 9) : ajoutes juste sous cette ligne.

  // Tache 6 : Assign (une ou plusieurs personnes, mode set, type de service garde), Mark done / Undo.
  function assignTo(j, ids) {
    const prev = j.assigned.slice();
    const service = j.serviceType || 'CHC';
    const where = placeLabel(j);
    const label = (list) => (list.length ? namesOf(st.data, list) : 'nobody');
    return write(j.key, 'assignCleaner', { reservation_key: j.key, cleaner_ids: ids, mode: 'set', service_type: service },
      ids.length ? where + ' assigned to ' + label(ids) : where + ' unassigned',
      () => write(j.key, 'assignCleaner', { reservation_key: j.key, cleaner_ids: prev, mode: 'set', service_type: service },
        where + ' back to ' + label(prev)));
  }
  function markDone(j, val) {
    const where = placeLabel(j);
    return write(j.key, 'setDone', { key: j.key, done: val }, where + (val ? ' marked done' : ' back to not done'),
      () => write(j.key, 'setDone', { key: j.key, done: !val }, where + (val ? ' back to not done' : ' marked done')));
  }
  ACT.assign = (j) => {
    if (!j) return;
    if (readOnly()) { toast(RO_LINE); return; }
    st.pick = new Set(j.assigned);
    show(j.key, 'assign');
  };
  ACT.toggle = (j, el) => {
    if (!j || el.disabled) return;
    const id = Number(el.getAttribute('data-id'));
    if (st.pick.has(id)) st.pick.delete(id); else st.pick.add(id);
    el.setAttribute('aria-pressed', st.pick.has(id) ? 'true' : 'false');
  };
  ACT['save-assign'] = (j) => { if (j) assignTo(j, [...st.pick].sort((a, b) => a - b)); };
  ACT['clear-assign'] = (j) => { if (j) assignTo(j, []); };
  ACT.done = (j) => { if (j) markDone(j, true); };
  ACT.undone = (j) => { if (j) markDone(j, false); };

  function onClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    const el = t ? t.closest('[data-retry],[data-week],[data-day],[data-filter],[data-job],[data-add-extra],#sheet [data-pa]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (el.hasAttribute('data-week')) { goWeek(Number(el.getAttribute('data-week'))); return; }
    if (!st.data) return;
    if (el.hasAttribute('data-day')) { st.day = el.getAttribute('data-day'); paint(); return; }
    if (el.hasAttribute('data-filter')) {
      const f = el.getAttribute('data-filter');
      st.filter = f === 'all' || String(st.filter) === f ? null : f;
      paint();
      return;
    }
    if (el.hasAttribute('data-job')) { show(el.getAttribute('data-job'), 'detail'); return; }
    if (el.hasAttribute('data-add-extra')) { if (ACT.addExtra) ACT.addExtra(); return; }
    const k = el.getAttribute('data-pa');
    if (k === 'back') {
      if (st.sheet && st.sheet.key !== '__new') show(st.sheet.key, 'detail'); else closeSheet();
      return;
    }
    const j = st.sheet ? job(st.sheet.key) : null;
    if (ACT[k]) ACT[k](j, el);
  }

  const onMq = () => paint();
  document.addEventListener('click', onClick);
  mq.addEventListener('change', onMq);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    mq.removeEventListener('change', onMq);
  });
  await refresh();
}
