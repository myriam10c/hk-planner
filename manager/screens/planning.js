// Ecran Planning (spec 2026-10-09, sections 3, 4 et 9.3) : la semaine de menages,
// grille de 7 jours sur ordinateur, un jour a la fois sur telephone, une couleur
// par personne. Lecture : mgr.planning (un appel par semaine, derniere semaine vue
// gardee sur l'appareil, en lecture seule). Gestes : les actions existantes du
// proxy, une cle d'idempotence par geste, jamais d'auteur envoye.
import { get, post } from '/manager/api.js';
import { createGestures, uncertain } from '/manager/gesture.js';
import { clearCache, loadCache, saveCache } from '/manager/today-cache.js';
import {
  addDays, closeSheet, dubaiTime, dubaiToday, esc, focusBack, focusMark, openSheet, placeLabel, sheetBusy, sheetError, sheetIsOpen, toast,
} from '/manager/ui/dom.js';
import { dayShort, defaultDay, filterJobs, LAUNDRY_ITEMS, laundryParse, namesOf, weekStartOf } from '/manager/screens/planning-rules.js';
import * as V from '/manager/screens/planning-view.js';

const KEY = 'mgrPlanningCache';
const RO_LINE = 'Reconnect to make changes.';
// Au-dela, la semaine est relue avant d'ouvrir un choix de personne.
const STALE_MS = 60000;

export async function renderPlanning(ctx) {
  const main = ctx.main;
  const today = dubaiToday(Date.now());
  const mq = window.matchMedia('(min-width: 960px)');
  const st = {
    start: weekStartOf(today), today, day: today, data: null, savedAt: 0, fresh: false,
    loading: true, error: null, busy: false, filter: null, seq: 0, sheet: null, pick: new Set(),
    sel: false, picked: new Set(), bulk: false, fetchedAt: 0,
    // Role maintenance (Semax) : ni fiche appartement ni prix des extras (revue finale #5, #6).
    manager: ctx.role !== 'maintenance',
  };
  const gestures = createGestures();
  // Assignation groupee : un suivi de geste par menage, garde pour la vie de l'ecran.
  // Chaque ecriture a sa cle ; rejouer le meme geste sur un menage apres un echec
  // incertain reprend sa cle, sans melanger avec les autres menages du lot.
  const bulkGestures = new Map();
  const gesturesFor = (key) => {
    if (!bulkGestures.has(key)) bulkGestures.set(key, createGestures());
    return bulkGestures.get(key);
  };
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

  // Compte de la selection annonce aux lecteurs d'ecran : un seul noeud pour la vie de l'ecran.
  const live = document.createElement('p');
  live.className = 'pl-live';
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);
  function updateLive() {
    const t = st.sel && !readOnly() && st.picked.size ? st.picked.size + ' selected' : '';
    if (live.textContent !== t) live.textContent = t;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    const mark = focusMark(main);
    main.innerHTML = V.screenHtml({
      data: st.data, start: st.start, today: st.today, day: st.day, wide: mq.matches, filter: st.filter,
      loading: st.loading, error: st.error, banner: banner(), stale: !st.fresh, ro: readOnly(),
      sel: st.sel && !readOnly(), picked: st.picked,
    });
    focusBack(main, mark);
    updateLive();
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
      st.fetchedAt = st.savedAt;
      st.fresh = true;
      saveCache(KEY, d, st.savedAt);
    } catch (e) {
      if (mine !== st.seq || !ctx.isCurrent()) return;
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    prunePicked();
    if (st.data && !st.data.days.some((x) => x.date === st.day)) st.day = defaultDay(st.data.start, st.today);
    paint();
  }

  // Selection : seulement des menages encore presents et selectionnables.
  function prunePicked() {
    for (const k of [...st.picked]) if (!V.selectable(job(k))) st.picked.delete(k);
  }
  function endSelect() {
    st.sel = false;
    st.picked = new Set();
  }

  function goWeek(n) {
    endSelect();
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
  // Semaine lue il y a plus d'une minute : relue avant d'ouvrir un choix de personne.
  // Relecture en echec : anciennes donnees gardees, mais aucune ecriture.
  let reloading = false;
  async function freshEnough() {
    if (readOnly()) { toast(RO_LINE); return false; }
    if (Date.now() - st.fetchedAt <= STALE_MS) return true;
    if (reloading) return false;
    const start = st.start;
    reloading = true;
    await refresh();
    reloading = false;
    if (!ctx.isCurrent() || st.start !== start) return false;
    if (readOnly()) { toast(RO_LINE); return false; }
    return true;
  }
  ACT.assign = async (j) => {
    if (!j) return;
    const key = j.key;
    if (!(await freshEnough())) return;
    if (!heldHere(key)) return;
    const cur = job(key);
    if (!cur) { closeSheet(); return; }
    if (!V.selectable(cur)) { show(key, 'detail'); return; }
    st.pick = new Set(cur.assigned);
    show(key, 'assign');
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

  // Tache 7 : Cancel (raison facultative) / Restore, Postpone d'un jour / Restore date.
  ACT.cancel = (j) => { if (j) show(j.key, 'cancel'); };
  ACT['confirm-cancel'] = (j) => {
    if (!j) return;
    const inp = document.getElementById('pReason');
    const reason = inp ? inp.value.trim() : '';
    const where = placeLabel(j);
    write(j.key, 'setCancelled', { key: j.key, cancelled: true, reason }, where + ' cancelled',
      () => write(j.key, 'setCancelled', { key: j.key, cancelled: false }, where + ' restored'));
  };
  ACT.restore = (j) => { if (j) write(j.key, 'setCancelled', { key: j.key, cancelled: false }, placeLabel(j) + ' restored'); };
  ACT.postpone = (j) => { if (j) show(j.key, 'postpone'); };
  // Toujours la premiere date d'origine : deux reports de suite gardent le vrai depart.
  ACT['confirm-postpone'] = (j) => {
    if (!j) return;
    const to = addDays(j.date, 1);
    const from = j.postponedFrom || j.date;
    const where = placeLabel(j);
    const back = j.postponedFrom
      ? () => write(j.key, 'setPostponed', { key: j.key, postpone: true, new_date: j.date, original_date: from }, where + ' back to ' + dayShort(j.date))
      : () => write(j.key, 'setPostponed', { key: j.key, postpone: false }, where + ' back to ' + dayShort(j.date));
    write(j.key, 'setPostponed', { key: j.key, postpone: true, new_date: to, original_date: from }, where + ' moved to ' + dayShort(to), back);
  };
  ACT['restore-date'] = (j) => {
    if (j && j.postponedFrom) write(j.key, 'setPostponed', { key: j.key, postpone: false }, placeLabel(j) + ' back to ' + dayShort(j.postponedFrom));
  };

  // Tache 8 : linge du menage (meme regle que l'ancienne fiche : sept champs, un vide n'est pas un zero).
  function laundryValues() {
    const out = {};
    for (const it of LAUNDRY_ITEMS) {
      const inp = document.getElementById('lq_' + it.key);
      out[it.key] = inp ? inp.value.trim() : '';
    }
    return out;
  }
  function syncLaundry() {
    const b = document.querySelector('#sheet [data-pa="save-laundry"]');
    if (b && !st.busy) b.disabled = !laundryParse(laundryValues()).ok;
  }
  hooks.resync = syncLaundry;
  ACT.laundry = (j) => { if (j) { show(j.key, 'laundry'); syncLaundry(); } };
  ACT['lq-step'] = (j, el) => {
    const inp = document.getElementById('lq_' + el.getAttribute('data-field'));
    if (!inp) return;
    const cur = inp.value.trim() === '' ? 0 : Number(inp.value);
    const next = (Number.isFinite(cur) ? Math.round(cur) : 0) + Number(el.getAttribute('data-d'));
    inp.value = String(Math.max(0, Math.min(999, next)));
    syncLaundry();
  };
  ACT['save-laundry'] = (j) => {
    if (!j) return;
    const p = laundryParse(laundryValues());
    if (!p.ok) { sheetError('Check the ' + p.label + ' field.'); return; }
    write(j.key, 'saveLaundryCount', { reservation_key: j.key, ...p.values }, 'Linen count saved for ' + placeLabel(j));
  };
  const onInput = (e) => { if (e.target && e.target.closest && e.target.closest('#sheet .lq')) syncLaundry(); };
  document.addEventListener('input', onInput);
  ctx.onLeave(() => document.removeEventListener('input', onInput));

  // Tache 9 : menages en plus. Prix facture obligatoire (regle de l'ancienne fiche).
  function extraBody() {
    const v = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
    const listing = v('xListing'), date = v('xDate'), price = v('xPrice'), rate = v('xRate');
    // Prix caches (extra sans prix lisible, role maintenance) : jamais envoyes, le serveur garde les siens.
    const priced = !!document.getElementById('xPrice');
    if (!listing) return { error: 'Choose an apartment.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Choose a date.' };
    if (priced && (price === '' || !Number.isFinite(Number(price)) || Number(price) < 0)) return { error: 'Price billed is required.' };
    if (priced && rate !== '' && (!Number.isFinite(Number(rate)) || Number(rate) < 0)) return { error: 'Cleaner rate must be a number.' };
    const body = {
      listing_id: listing, cleaning_date: date, label: v('xLabel') || null, guest_name: v('xGuest') || null, notes: v('xNotes') || null,
    };
    if (priced) { body.price_billed = Number(price); body.cleaner_price = rate === '' ? null : Number(rate); }
    return { body };
  }
  ACT.addExtra = () => {
    if (readOnly()) { toast(RO_LINE); return; }
    show('__new', 'extra');
  };
  ACT['edit-extra'] = (j) => { if (j && j.extra) show(j.key, 'extra'); };
  ACT['x-save'] = (j) => {
    const r = extraBody();
    if (r.error) { sheetError(r.error); return; }
    // Creation decidee par le panneau lui-meme : un extra edite qui a disparu au
    // rechargement ne doit jamais devenir un nouvel extra facture.
    if (st.sheet && st.sheet.key === '__new') {
      const whoEl = document.getElementById('xWho');
      const who = whoEl ? whoEl.value : '';
      const l = st.data.listings.find((x) => x.id === r.body.listing_id) || {};
      write('__new', 'addExtraCleaning', { ...r.body, assigned_cleaner_id: who ? Number(who) : null },
        'Extra cleaning added for ' + (placeLabel(l) || 'the apartment') + ' on ' + dayShort(r.body.cleaning_date));
      return;
    }
    if (!j || !j.extra) { sheetError('This cleaning is no longer on the planning.'); return; }
    write(j.key, 'updateExtraCleaning', { id: j.extra.id, ...r.body }, 'Extra cleaning saved for ' + placeLabel(j));
  };
  ACT['x-delete'] = (j) => { if (j && j.extra) show(j.key, 'delete'); };
  ACT['x-delete-confirm'] = (j) => {
    if (j && j.extra) write(j.key, 'deleteExtraCleaning', { id: j.extra.id }, 'Extra cleaning deleted');
  };

  // Assignation groupee (Select) : ecritures assignCleaner l'une apres l'autre, chacune
  // avec sa cle. Un refus du serveur (4xx) n'arrete pas le lot ; reseau coupe ou delai
  // depasse l'arrete : le reste n'est pas envoye et compte comme non confirme.
  function pickedJobs() {
    if (!st.data) return [];
    return st.data.jobs.filter((j) => st.picked.has(j.key) && V.selectable(j))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  const many = (n) => n + ' cleaning' + (n === 1 ? '' : 's');
  function progress(verb, i, n) {
    const el = document.getElementById('bulkProg');
    if (el) el.textContent = verb + ' ' + i + ' of ' + n + '…';
  }
  // items : [{ j, ids, service }] ; rend { ok: [items], failed: [{ item, message, unsure }] } ou null (sortie d'ecran).
  // unsure : l'ecriture a peut-etre eu lieu (delai, reseau, 5xx) ou n'a pas ete tentee.
  async function runBulk(items, verb) {
    const ok = [], failed = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      progress(verb, i + 1, items.length);
      const body = { reservation_key: it.j.key, cleaner_ids: it.ids, mode: 'set', service_type: it.service };
      try {
        await gesturesFor(it.j.key).run('assignCleaner|' + JSON.stringify(body), (idem) => post('assignCleaner', { ...body, idem }));
        ok.push(it);
      } catch (e) {
        if (handleAccess(e)) return null;
        failed.push({ item: it, message: e.message, unsure: uncertain(e) });
        if (e.kind === 'offline' || e.kind === 'timeout') {
          for (const rest of items.slice(i + 1)) failed.push({ item: rest, message: '', unsure: true });
          break;
        }
      }
    }
    return { ok, failed };
  }
  // Au plus trois appartements nommes par partie, puis « and N more ».
  function places(list, withMsg) {
    const names = list.slice(0, 3).map((f) => (placeLabel(f.item.j) || 'Apartment') + (withMsg && f.message ? ' (' + f.message + ')' : ''));
    return names.join(', ') + (list.length > 3 ? ' and ' + (list.length - 3) + ' more' : '');
  }
  function failText(failed, refusedWord) {
    const unsure = failed.filter((f) => f.unsure), refused = failed.filter((f) => !f.unsure);
    return (unsure.length ? ' Not confirmed: ' + places(unsure, false) + '.' : '')
      + (refused.length ? ' ' + refusedWord + ': ' + places(refused, true) + '.' : '');
  }
  // own : lot lance depuis la selection. Apres un echec, seuls les menages en echec restent
  // coches (mode selection garde) pour un nouvel essai en un toucher. Un Undo ne touche
  // jamais a la selection (elle peut etre une nouvelle selection du manager).
  async function bulkWrite(items, report, own) {
    if (st.busy) { toast('Saving, wait a second.'); return; }
    if (readOnly()) { toast(RO_LINE); return; }
    st.busy = true;
    st.bulk = true;
    sheetBusy(true);
    const r = await runBulk(items, own ? 'Assigning' : 'Restoring');
    st.busy = false;
    st.bulk = false;
    unbusy();
    if (!r) return;
    if (st.sheet && st.sheet.key === '__bulk') closeSheet();
    report(r);
    if (own) {
      if (r.failed.length) { st.sel = true; st.picked = new Set(r.failed.map((f) => f.item.j.key)); } else endSelect();
    }
    refresh();
  }
  function bulkAssign(id) {
    const jobs = pickedJobs();
    if (!jobs.length) { closeSheet(); return; }
    const who = namesOf(st.data, [id]);
    const items = jobs.map((j) => ({ j, ids: [id], service: j.serviceType || 'CHC', prev: j.assigned.slice() }));
    bulkWrite(items, (r) => {
      const undo = r.ok.length ? () => bulkUndo(r.ok) : undefined;
      if (!r.failed.length) { toast(many(r.ok.length) + ' assigned to ' + who, undo); return; }
      toast(r.ok.length + ' of ' + items.length + ' assigned to ' + who + '.' + failText(r.failed, 'Not assigned'), undo);
    }, true);
  }
  // Undo : chaque menage reussi revient a sa propre liste d'avant (meme type de service).
  function bulkUndo(done) {
    const items = done.map((it) => ({ j: it.j, ids: it.prev, service: it.service }));
    bulkWrite(items, (r) => {
      if (!r.failed.length) { toast(many(r.ok.length) + ' back to their previous assignment'); return; }
      toast(r.ok.length + ' of ' + items.length + ' back to their previous assignment.' + failText(r.failed, 'Not restored'));
    }, false);
  }
  ACT['bulk-pick'] = (j, el) => {
    if (el.disabled) return;
    bulkAssign(Number(el.getAttribute('data-id')));
  };
  async function openBulk() {
    if (!(await freshEnough())) return;
    const jobs = pickedJobs();
    if (!jobs.length) return;
    st.sheet = { key: '__bulk', view: 'bulk' };
    openSheet(V.bulkSheet(st.data, jobs, readOnly()));
  }
  function onSelectClick(el) {
    if (el.hasAttribute('data-select')) {
      if (st.sel) endSelect(); else if (!readOnly()) st.sel = true;
      paint();
      return;
    }
    if (el.hasAttribute('data-select-all')) {
      // Meme liste que celle affichee : le jour (telephone) ou la semaine (ordinateur), filtre de personne compris.
      const shown = mq.matches ? st.data.jobs : st.data.jobs.filter((j) => j.date === st.day);
      for (const j of filterJobs(shown, st.filter)) if (V.selectable(j) && !j.assigned.length) st.picked.add(j.key);
      paint();
      return;
    }
    const b = el.getAttribute('data-bulk');
    if (b === 'clear') { st.picked = new Set(); paint(); return; }
    if (b === 'assign') {
      if (readOnly()) { toast(RO_LINE); return; }
      if (!pickedJobs().length) return;
      openBulk();
    }
  }

  function onClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    const el = t ? t.closest('[data-retry],[data-week],[data-day],[data-filter],[data-job],[data-add-extra],[data-select],[data-select-all],[data-bulk],#sheet [data-pa]') : null;
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
    // Pendant un lot : ni carte ni selection ne bougent.
    if (st.bulk && (el.hasAttribute('data-job') || el.hasAttribute('data-select') || el.hasAttribute('data-select-all') || el.hasAttribute('data-bulk'))) {
      toast('Saving, wait a second.');
      return;
    }
    if (el.hasAttribute('data-select') || el.hasAttribute('data-select-all') || el.hasAttribute('data-bulk')) { onSelectClick(el); return; }
    if (el.hasAttribute('data-job')) {
      const key = el.getAttribute('data-job');
      // Mode selection : la carte se coche au lieu d'ouvrir la fiche.
      if (st.sel && !readOnly()) {
        if (!V.selectable(job(key))) return;
        if (st.picked.has(key)) st.picked.delete(key); else st.picked.add(key);
        paint();
        return;
      }
      show(key, 'detail');
      return;
    }
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
  // Retour sur l'onglet : la semaine affichee est relue (un autre manager a pu assigner).
  const onVis = () => { if (document.visibilityState === 'visible' && !st.busy && ctx.isCurrent()) refresh(); };
  document.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVis);
  mq.addEventListener('change', onMq);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVis);
    mq.removeEventListener('change', onMq);
    live.remove();
  });
  await refresh();
}
