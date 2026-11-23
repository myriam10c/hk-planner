// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier,
// cache local du dernier Today (spec section 7).
import { get, post } from '/manager/api.js';
import { clearToday, loadToday, saveToday } from '/manager/today-cache.js';
import { createGestures } from '/manager/gesture.js';
import { createFreshGate, isStale } from '/manager/fresh.js';
import { addDays, announceMntBadge, closeSheet, dubaiTime, esc, focusMark, openSheet, placeLabel, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { fillPhotos } from '/manager/ui/job-photos.js';
import { arrivalSheet, boardHtml, jobSheet, patchWday } from '/manager/screens/today-view.js';
import { buildAhead, buildToday, countNone, isNone, nextNone, visible } from '/manager/screens/today-model.js';
import { namesOf, weekStartOf } from '/manager/screens/planning-rules.js';

function dubaiParts(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return p;
}
function dubaiDay(ms) { const p = dubaiParts(ms); return p.year + '-' + p.month + '-' + p.day; }

// Ecran ouvert : le jour de Dubai est verifie toutes les 30 s (Today relu quand il change).
const DAY_CHECK_MS = 30000;
// Repeint : le focus revient sur l'element affiche qui porte le meme attribut (carte, disque,
// tuile ou Cancel du choix ouvert, puce de filtre, pastille d'un moment, Not for today), sinon
// sur ceux de focusMark.
const TD_FOCUS = ['data-td-open', 'data-td-who', 'data-td-pick', 'data-td-wpick', 'data-td-cancel', 'data-td-filter', 'data-td-moment', 'data-td-more'];

function shellHtml(inner) { return '<header class="top"><div><h1>Today</h1></div></header>' + inner; }

export async function renderToday(ctx) {
  const main = ctx.main;
  // day : jour choisi dans la bande des sept jours (null = le jour des donnees). triedOn : jour de Dubai
  // de la derniere relecture tentee.
  // ui : filtre (id d'une personne, 'none' ou null), moments replies (Not for today replie
  // par defaut), choix ouvert dans une carte (id du logement, un seul a la fois) ; garde d'un
  // rendu a l'autre. pickErr : refus du serveur affiche dans le choix ouvert. chain : logement
  // qui n'avait personne et vient d'etre affecte, le choix du suivant s'ouvre apres la relecture.
  // Autre jour de la bande : arrive = jour qui vient d'etre choisi (son premier menage sans
  // cleaner s'ouvre des que sa semaine est lue fraiche) ; wchain = { day, from }, l'enchainement
  // de chain sur ce jour, apres la relecture de sa semaine.
  const st = { data: null, savedAt: 0, fresh: false, loading: true, error: null, busy: false, sheetKey: null, day: null, triedOn: null,
    pending: null, ui: { filter: null, collapsed: { more: true }, pick: null }, pickErr: null, chain: null, arrive: null, wchain: null };
  // Journee du modele, calculee une fois par reponse mgr.today.
  let memo = { data: null, day: null };
  function model() {
    if (memo.data !== st.data) memo = { data: st.data, day: buildToday(st.data) };
    return memo.day;
  }
  // Semaines mgr.planning lues pour les autres jours, en memoire pour la vie de l'ecran :
  // start -> { data, fresh, loading, error, seq, at }. wseq : garde contre une reponse tardive.
  // at : heure de la derniere reponse fraiche.
  const weeks = {};
  let wseq = 0;
  // Journee d'un autre jour (buildAhead), calculee une fois par reponse mgr.planning et par jour.
  const aheadMemo = new WeakMap();
  function aheadDayOf(w, date) {
    if (!w || !w.data) return null;
    let m = aheadMemo.get(w.data);
    if (!m) { m = new Map(); aheadMemo.set(w.data, m); }
    if (!m.has(date)) m.set(date, buildAhead(w.data, date));
    return m.get(date);
  }
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

  // Jours du bloc : le jour des donnees chargees (Today), puis six jours. Partir du jour
  // des donnees (et pas de l'horloge) : apres minuit, la puce du jour reste celle du bloc
  // affiche, et son libelle suit l'horloge (jamais « Today » pour le bloc d'hier).
  function aheadState() {
    const clock = dubaiDay(Date.now());
    const base = st.data && st.data.day ? st.data.day : clock;
    const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(base, n));
    const sel = st.day && days.includes(st.day) ? st.day : base;
    return { days, sel, clock, week: sel === base ? null : weeks[weekStartOf(sel)] || null };
  }
  function otherDay() { const a = aheadState(); return a.sel === a.days[0] ? null : a.sel; }
  // Journee affichee : Today, ou l'autre jour choisi (null tant que sa semaine n'est pas lue).
  function shownDay() {
    const d = otherDay();
    if (!d) return st.data ? model() : null;
    return aheadDayOf(weeks[weekStartOf(d)], d);
  }
  // Autre jour : lecture seule tant que sa semaine n'est pas lue fraiche.
  function aheadRo(w) { return !(w && w.fresh && w.data); }

  function tdMark() {
    const a = document.activeElement;
    if (!a || a === main || !main.contains(a)) return null;
    for (const k of TD_FOCUS) if (a.hasAttribute(k)) return '[' + k + '="' + CSS.escape(a.getAttribute(k)) + '"]';
    return focusMark(main);
  }
  // Premier element affiche : la puce d'une personne existe aussi dans le panneau du grand ecran.
  function tdBack(mark) {
    if (!mark) return;
    const el = Array.from(main.querySelectorAll(mark)).find((x) => x.getClientRects().length);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }
  const wdShort = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  // Puce de la bande : menages du jour et menages sans cleaner (counts.none pour le jour des
  // donnees, countNone pour les autres) ; null tant que la semaine n'est pas lue.
  function stripDay(d, day, selected) {
    const known = !!day;
    const n = !known ? null : day.source === 'today' ? day.counts.none : countNone(weeks[weekStartOf(d)].data, d);
    return { date: d, label: wdShort(d), num: Number(d.slice(8)), n, total: known ? day.counts.cleanings : null, selected };
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    const mark = tdMark();
    if (st.data) {
      const a = aheadState();
      const today = model();
      const other = a.sel !== a.days[0];
      const day = other ? aheadDayOf(a.week, a.sel) : today;
      main.innerHTML = boardHtml({
        data: st.data, day, moments: day ? visible(day, st.ui.filter) : [], ui: st.ui, banner: banner(), stale: !st.fresh,
        ro: other ? aheadRo(a.week) : readOnly(),
        strip: a.days.map((d, i) => stripDay(d, i === 0 ? today : aheadDayOf(weeks[weekStartOf(d)], d), d === a.sel)),
        nowMs: Date.now(), ahead: other ? { sel: a.sel, week: a.week } : null, busy: st.busy, pickError: st.pickErr,
      });
      tdBack(mark);
      return;
    }
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

  // Relecture de Today ; st.pending garde la relecture en cours (une carte touchee l'attend).
  function refresh() {
    const p = reload();
    st.pending = p;
    const clear = () => { if (st.pending === p) st.pending = null; };
    p.then(clear, clear);
    return p;
  }
  async function reload() {
    // Journee affichee avant la relecture : un filtre qui s'y appliquait et ne s'applique plus est enleve.
    const before = st.data ? model() : null;
    st.loading = true;
    st.error = null;
    st.triedOn = dubaiDay(Date.now());
    paint();
    try {
      const d = await get('mgr.today');
      st.data = d;
      st.savedAt = Date.now();
      st.fresh = true;
      saveToday(d, st.savedAt);
      if (d.maintenance) announceMntBadge(d.maintenance.counts.proposals);
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    const next = settle(before);
    if (next) showPick(next); else paint();
    // Comptes de la bande : semaines lues en arriere-plan apres le rendu, sans bandeau d'erreur.
    if (st.fresh) loadStrip();
  }

  // Apres une relecture (reussie ou non). Filtre : enleve quand la personne ou le groupe filtre
  // avait des logements et n'en a plus, ou quand la personne filtree n'est plus affectable (sa
  // puce disparait). Choix ouvert : ferme en lecture seule ou si son logement n'est plus dans
  // Today. Rend le logement dont le choix s'ouvre ensuite (enchainement), sinon null.
  function settle(before) {
    const from = st.chain;
    st.chain = null;
    // Autre jour affiche : son choix ouvert et son filtre se jugent sur sa semaine (settleWeek).
    if (!st.data || otherDay()) return null;
    const ui = st.ui;
    const day = model();
    dropFilter(before, day);
    if (ui.pick != null && (readOnly() || !day.units.some((u) => u.id === ui.pick && u.key))) { ui.pick = null; st.pickErr = null; }
    if (from == null || ui.pick != null || readOnly()) return null;
    return nextNone(day, from, ui.filter);
  }

  // Filtre enleve apres une relecture quand la personne ou le groupe filtre avait des logements
  // et n'en a plus, ou quand la personne filtree n'est plus affectable (sa puce disparait).
  function dropFilter(before, day) {
    const ui = st.ui;
    if (ui.filter == null || !before || !day) return;
    const f = String(ui.filter);
    const left = (d) => (f === 'none' ? d.counts.none : (d.people.find((p) => String(p.id) === f) || { count: 0 }).count);
    const able = (d) => d.people.some((p) => String(p.id) === f && p.assignable);
    if ((left(before) > 0 && left(day) === 0) || (f !== 'none' && able(before) && !able(day))) ui.filter = null;
  }

  // Relecture due : donnees de plus d'une minute ou d'un autre jour de Dubai.
  function due() { return !st.data || isStale(st.savedAt, Date.now()) || st.data.day !== dubaiDay(Date.now()); }
  // Geste du jour : Today relu d'abord quand la relecture est due (meme garde que Planning).
  // Donnees en cache ou derniere lecture ratee : refus sans relecture.
  const freshEnough = createFreshGate({
    blocked: () => !st.fresh || !st.data, stale: due, refresh, readOnly, refuse: refuseRo, isCurrent: ctx.isCurrent,
  });
  // Geste d'ecriture du jour (disque, tuile, bouton d'une fiche, Undo) : une relecture deja en
  // cours est attendue au lieu d'en lancer une seconde, puis freshEnough. Cela vaut pour toute
  // relecture, celle que freshEnough lance pour un autre geste comprise (refresh pose
  // st.pending) : un geste arrive pendant elle l'attend, il n'est pas abandonne. Un seul geste
  // attend ainsi a la fois : un autre arrive pendant cette attente est abandonne.
  let gating = false;
  async function gate() {
    if (st.loading && st.pending) {
      if (gating) return false;
      gating = true;
      try { await st.pending; } finally { gating = false; }
      if (!ctx.isCurrent()) return false;
    }
    return freshEnough();
  }

  // Semaine d'un autre jour : seule la derniere demande pour cette semaine compte. Journee
  // affichee dans cette semaine : repeinte (paint garde le choix ouvert, les tuiles desactivees
  // pendant une ecriture et le focus). Sinon seules les puces de la bande changent, sur place :
  // une reponse en arriere-plan ne remplace jamais une carte qu'on est en train de toucher.
  async function loadWeek(start) {
    const w = weeks[start] || (weeks[start] = { data: null, fresh: false, loading: false, error: null, seq: 0, at: 0 });
    const mine = ++wseq;
    w.seq = mine;
    w.loading = true;
    w.error = null;
    const d0 = otherDay();
    const before = d0 && weekStartOf(d0) === start ? aheadDayOf(w, d0) : null;
    paintIfShown(start);
    try {
      const d = await get('mgr.planning', { start });
      if (w.seq !== mine || !ctx.isCurrent()) return;
      w.data = d;
      w.fresh = true;
      w.at = Date.now();
    } catch (e) {
      if (w.seq !== mine || !ctx.isCurrent()) return;
      if (handleAccess(e)) return;
      w.error = e;
      w.fresh = false;
    }
    w.loading = false;
    const d = otherDay();
    if (!d || weekStartOf(d) !== start) { paintStrip(); return; }
    const next = settleWeek(d, start, d0, before);
    if (next != null) showPick(next.id, next.quiet); else paint();
  }
  function paintStrip() {
    if (!ctx.isCurrent() || !st.data) return;
    const a = aheadState();
    const today = model();
    a.days.forEach((d, i) => {
      const b = main.querySelector('[data-wday="' + d + '"]');
      if (b) patchWday(b, stripDay(d, i === 0 ? today : aheadDayOf(weeks[weekStartOf(d)], d), d === a.sel));
    });
  }
  function paintIfShown(start) {
    const d = otherDay();
    if (d && weekStartOf(d) === start) paint();
  }
  // Bande : chaque semaine que touchent les six jours suivants, lue une fois (sans attendre).
  function loadStrip() {
    const seen = {};
    for (const d of aheadState().days.slice(1)) {
      const s = weekStartOf(d);
      if (!seen[s] && !weeks[s]) loadWeek(s);
      seen[s] = true;
    }
  }
  // Apres la lecture de la semaine de l'autre jour affiche d (filtre : seulement si d etait deja
  // affiche au depart de la lecture, d0). Choix ouvert : ferme en lecture seule ou si son
  // logement n'est plus a affecter. Rend { id, quiet } du choix qui s'ouvre ensuite :
  // enchainement apres une ecriture (focus sur les tuiles), ou arrivee sur le jour (premier
  // menage sans cleaner, sans prendre le focus) ; sinon null.
  function settleWeek(d, start, d0, before) {
    const w = weeks[start];
    const day = aheadDayOf(w, d);
    const from = st.wchain && st.wchain.day === d ? st.wchain.from : null;
    st.wchain = null;
    if (d === d0) dropFilter(before, day);
    if (st.ui.pick != null && (aheadRo(w) || !day.units.some((u) => u.id === st.ui.pick && u.canAssign))) { st.ui.pick = null; st.pickErr = null; }
    if (aheadRo(w)) return null;
    const arriving = st.arrive === d;
    st.arrive = null;
    if (st.ui.pick != null) return null;
    if (from != null) { const id = nextNone(day, from, st.ui.filter); return id == null ? null : { id, quiet: false }; }
    if (arriving) { const id = nextNone(day, null, st.ui.filter); return id == null ? null : { id, quiet: true }; }
    return null;
  }
  // Puce de la bande. Autre jour : un seul choix ouvert, filtre enleve ; sa semaine est lue si
  // elle ne l'est pas (echec en arriere-plan compris), relue si elle a plus de 60 s, et son
  // premier menage sans cleaner s'ouvre quand elle est fraiche (sans prendre le focus).
  function pickDay(day) {
    const was = aheadState().sel;
    st.day = day;
    const d = otherDay();
    if (aheadState().sel !== was) {
      st.ui.pick = null;
      st.pickErr = null;
      st.ui.filter = null;
      st.wchain = null;
      st.arrive = d;
    }
    if (d) {
      const start = weekStartOf(d);
      const w = weeks[start];
      if (!w || (!w.loading && (!w.fresh || isStale(w.at, Date.now())))) { loadWeek(start); return; }
      if (!w.loading && st.arrive === d) {
        st.arrive = null;
        const id = nextNone(aheadDayOf(w, d), null, st.ui.filter);
        if (id != null) { showPick(id, true); return; }
      }
    }
    paint();
  }
  function aheadJob(key) {
    const d = otherDay();
    const w = d ? weeks[weekStartOf(d)] : null;
    const j = w && w.data ? w.data.jobs.find((x) => x.key === key) : null;
    return j && !j.cancelled && j.state !== 'done' ? { j, w, start: weekStartOf(d), day: d } : null;
  }
  // Disque d'une carte d'un autre jour : semaine fraiche obligatoire, relue d'abord si lue il y
  // a plus d'une minute (opening : une seule relecture attendue a la fois). Relecture en echec :
  // anciennes donnees gardees, choix refuse.
  let opening = false;
  async function openAheadPick(id) {
    const d = otherDay();
    if (!d) return;
    const start = weekStartOf(d);
    let w = weeks[start];
    if (!w || !w.data) return;
    if (!w.fresh) { refuseRo(); return; }
    if (isStale(w.at, Date.now())) {
      if (opening) return;
      opening = true;
      try { await loadWeek(start); } finally { opening = false; }
      if (!ctx.isCurrent() || otherDay() !== d) return;
      w = weeks[start];
      if (!w.fresh) { refuseRo(); return; }
    }
    const u = aheadDayOf(w, d).units.find((x) => x.id === id);
    if (!u || !u.canAssign) return;
    showPick(id);
  }
  // Choix dans une carte d'un autre jour : meme compte rendu que pickPlace ; l'enchainement
  // vers le menage suivant sans cleaner suit la relecture de la semaine (settleWeek).
  function aheadPlace(id, wasNone, d) {
    return {
      held: () => st.ui.pick === id && otherDay() === d,
      busy: () => { st.pickErr = null; paint(); },
      error: (msg) => { st.pickErr = msg; paint(); },
      done: () => { closePick(false); if (wasNone) st.wchain = { day: d, from: id }; },
    };
  }
  // Ecriture sur un autre jour : semaine fraiche obligatoire, cle d'idempotence par geste,
  // jamais d'auteur, puis rechargement de cette semaine (le jour choisi reste). at : le choix
  // ouvert (aheadPlace), absent pour Undo.
  async function aheadWrite(start, body, okMsg, undoFn, at) {
    if (st.busy) { busyToast(); return; }
    const w = weeks[start];
    if (!w || !w.fresh || !w.data) { refuseRo(); return; }
    st.busy = true;
    if (at) at.busy(true);
    try {
      await gestures.run('assignCleaner|' + JSON.stringify(body), (idem) => post('assignCleaner', { ...body, idem }));
    } catch (e) {
      st.busy = false;
      if (at) at.busy(false);
      if (handleAccess(e)) return;
      if (at && at.held()) at.error(e.message); else toast(e.message);
      return;
    }
    st.busy = false;
    if (at && at.held()) at.done();
    toast(okMsg, undoFn);
    loadWeek(start);
  }
  function aheadAssign(key, id, at) {
    const t = aheadJob(key);
    if (!t) return;
    const { j, w, start } = t;
    const prev = j.assigned.slice();
    const ids = [Number(id)];
    const service = j.serviceType || 'CHC';
    const where = placeLabel(j);
    const label = (list) => (list.length ? namesOf(w.data, list) : 'nobody');
    const body = (list) => ({ reservation_key: key, cleaner_ids: list, mode: 'set', service_type: service });
    aheadWrite(start, body(ids), where + ' assigned to ' + label(ids),
      () => aheadWrite(start, body(prev), where + ' back to ' + label(prev)), at);
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
    if (!(await gate())) return;
    if (st.busy) { busyToast(); return; }
    st.busy = true;
    try { await fn(); } catch (e) { if (!handleAccess(e)) toast(e.message); }
    st.busy = false;
    refresh();
  }
  // Ecriture du jour : cle d'idempotence par geste (reprise au reessai incertain), jamais d'auteur.
  const send = (action, body) => () => gestures.run(action + '|' + JSON.stringify(body), (idem) => post(action, { ...body, idem }));

  // Ou une ecriture rend compte. place.held() : le geste est encore a l'ecran ; busy(on) :
  // boutons desactives ou rendus ; error(msg) : refus du serveur affiche tel quel ; done() :
  // reussite. Par defaut la fiche du menage (Mark done, Undo done).
  function sheetPlace(key) {
    return { held: () => heldHere(key), busy: sheetBusy, error: sheetError, done: closeSheet };
  }
  // Choix dans la carte : tuiles desactivees pendant l'ecriture, refus dans le choix (role
  // alert) ; reussite : choix ferme, et si le logement n'avait personne, le choix du logement
  // suivant sans cleaner s'ouvre apres la relecture (settle). Choix ferme pendant l'ecriture :
  // refus en toast, aucun enchainement.
  function pickPlace(id, wasNone) {
    return {
      held: () => st.ui.pick === id,
      busy: () => { st.pickErr = null; paint(); },
      error: (msg) => { st.pickErr = msg; paint(); },
      done: () => { closePick(false); if (wasNone) st.chain = id; },
    };
  }

  async function write(t, call, okMsg, undoCall, at) {
    if (st.busy) { busyToast(); return; }
    if (readOnly()) { refuseRo(); return; }
    const place = at || sheetPlace(t.key);
    st.busy = true;
    place.busy(true);
    try {
      await call();
    } catch (e) {
      st.busy = false;
      place.busy(false);
      if (handleAccess(e)) return;
      if (place.held()) place.error(e.message); else toast(e.message);
      return;
    }
    st.busy = false;
    if (place.held()) place.done();
    toast(okMsg, () => undo(undoCall));
    refresh();
  }

  function assign(key, id, at) {
    const t = targetFor(key);
    if (!t) return;
    const prev = t.assigned.slice();
    const service = t.serviceType || 'CHC';
    return write(t,
      send('assignCleaner', { reservation_key: key, cleaner_ids: [Number(id)], mode: 'set', service_type: service }),
      placeLabel(t) + ' assigned to ' + nameOf(id),
      send('assignCleaner', { reservation_key: key, cleaner_ids: prev, mode: 'set', service_type: service }),
      at);
  }

  function setDone(key, val) {
    const t = targetFor(key);
    if (!t) return;
    return write(t,
      send('setDone', { key, done: val }),
      placeLabel(t) + (val ? ' marked done' : ' back to not done'),
      send('setDone', { key, done: !val }));
  }

  // Bouton d'une fiche (Assign cleaner, Reassign, Mark done, Undo done) : Today relu d'abord si
  // la relecture est due (gate). Geste abandonne si la fiche a ete fermee pendant la relecture ;
  // fiche fermee si son menage n'est plus dans Today relu. Assign cleaner et Reassign ferment la
  // fiche et ouvrent le choix dans la carte du logement.
  async function todayGesture(el) {
    const toPick = el.hasAttribute('data-assign');
    const key = el.getAttribute(toPick ? 'data-assign' : 'data-done');
    const fromSheet = !!el.closest('#sheet');
    if (!(await gate())) return;
    if (fromSheet && !heldHere(key)) return;
    const t = targetFor(key);
    if (!t) { if (fromSheet) closeSheet(); return; }
    if (toPick) {
      const u = model().units.find((x) => x.key === key);
      if (fromSheet) closeSheet();
      if (u) showPick(u.id);
      return;
    }
    setDone(key, el.getAttribute('data-val') === '1');
  }

  // ---------- Choix dans la carte ----------
  // Ouvre le choix d'un logement de la journee affichee (un seul a la fois), deplie son moment ;
  // la carte defile dans le champ et le focus va a la premiere personne disponible (jamais sous
  // une fiche ouverte). quiet : ouvert d'office a l'arrivee sur un autre jour, ni defilement ni
  // focus (il reste sur la puce du jour).
  function showPick(id, quiet) {
    st.ui.pick = id;
    st.pickErr = null;
    const day = shownDay();
    const m = day ? day.moments.find((x) => x.unitIds.indexOf(id) >= 0) : null;
    if (m) delete st.ui.collapsed[m.id];
    paint();
    const box = main.querySelector('.td-pick');
    if (!box) return;
    box.classList.add('td-fresh');
    if (quiet || sheetIsOpen()) return;
    const card = box.closest('.td-card') || box;
    card.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const first = box.querySelector('[data-td-pick]:not([disabled]),[data-td-wpick]:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  }
  // Ferme le choix ouvert. Le focus revient au disque de la carte (ou a Assign someone, Change)
  // quand il etait dans le choix, ou toujours avec force (Echap, Cancel).
  function closePick(force) {
    const id = st.ui.pick;
    if (id == null) return;
    const a = document.activeElement;
    const inside = force || !a || a === document.body || !!(a.closest && a.closest('.td-pick'));
    st.ui.pick = null;
    st.pickErr = null;
    paint();
    if (!inside || sheetIsOpen()) return;
    const who = Array.from(main.querySelectorAll('[data-td-who="' + CSS.escape(id) + '"]')).find((x) => x.getClientRects().length);
    if (who) who.focus({ preventScroll: true });
  }
  // Disque d'une carte, Assign someone, Change : le choix s'ouvre derriere la garde de fraicheur.
  async function openWho(id) {
    if (!(await gate())) return;
    const u = model().units.find((x) => x.id === id);
    if (!u || !u.canAssign || readOnly()) return;
    showPick(id);
  }
  // Tuile d'une personne : l'ecriture de assign() derriere la meme garde ; abandonnee si le
  // choix a ete ferme (ou a change) pendant la relecture.
  async function pickPerson(key, pid) {
    const id = st.ui.pick;
    if (!(await gate())) return;
    if (id == null || st.ui.pick !== id) return;
    const u = model().units.find((x) => x.id === id);
    if (!u || u.key !== key) return;
    assign(key, pid, pickPlace(id, isNone(u)));
  }

  // Filtre et repli d'un moment : affichage seul, applique tout de suite ; un tableau de plus
  // de 60 s est relu en arriere-plan (filtre et replis gardes). Apres minuit, une relecture
  // par jour (comme dayCheck). Derniere lecture ratee : rien, le bandeau garde Retry.
  // Autre jour affiche : rien (ses donnees viennent de mgr.planning).
  function touchRefresh() {
    if (st.loading || st.busy || !st.data || otherDay()) return;
    const day = dubaiDay(Date.now());
    if (st.data.day !== day) { if (st.triedOn !== day) refresh(); return; }
    if (st.fresh && due()) refresh();
  }
  // Corps d'une carte : la fiche actuelle (jobSheet ou arrivalSheet). Tableau d'un autre jour
  // de Dubai : Today relu avant toute fiche (relecture en cours : appui ignore ; relecture du
  // jour deja tentee, en echec : fiche en lecture seule). Tableau du jour de plus de 60 s, ou
  // relecture deja en cours : la fiche attend la relecture, puis s'ouvre sur le tableau relu
  // (en lecture seule si la relecture a echoue). Ecriture en cours : fiche ouverte tout de
  // suite sur le tableau affiche, sans relire (la relecture suit l'ecriture).
  // openingCard : un seul appui attendu a la fois (double toucher).
  let openingCard = false;
  async function openCard(id) {
    if (openingCard) return;
    const day = dubaiDay(Date.now());
    if (st.data.day !== day) {
      if (st.loading) return;
      if (st.triedOn !== day) { refresh(); return; }
    } else if (!st.busy && (st.loading || (st.fresh && due()))) {
      openingCard = true;
      try { await (st.loading && st.pending ? st.pending : refresh()); } finally { openingCard = false; }
      if (!ctx.isCurrent() || !st.data || st.data.day !== dubaiDay(Date.now())) return;
    }
    const u = model().units.find((x) => x.id === id);
    if (!u) return;
    const now = Date.now();
    if (u.opens.type === 'job') {
      const j = st.data.who.jobs.find((x) => x.key === u.opens.ref);
      if (j) { st.sheetKey = j.key; openSheet(jobSheet(st.data, j, now, readOnly())); fillPhotos(j.key); }
    } else {
      const a = st.data.arrivals.rows.find((x) => x.id === u.opens.ref);
      if (a) { st.sheetKey = a.prevKey || null; openSheet(arrivalSheet(st.data, a, now, readOnly())); fillPhotos(a.prevKey); }
    }
  }

  function onClick(e) {
    const el = e.target && e.target.closest
      ? e.target.closest('[data-retry],[data-td-open],[data-td-filter],[data-td-moment],[data-td-more],[data-td-who],[data-td-pick],[data-td-wpick],[data-td-cancel],[data-assign],[data-done],[data-wday],[data-wretry]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (!st.data) return;
    if (el.hasAttribute('data-wday')) { pickDay(el.getAttribute('data-wday')); return; }
    // Safari ne donne pas le focus a un bouton touche : le focus est pose ici pour qu'il reste
    // sur la puce ou la pastille apres le nouveau rendu.
    if (el.hasAttribute('data-td-filter') || el.hasAttribute('data-td-moment') || el.hasAttribute('data-td-more')) {
      if (document.activeElement !== el) el.focus({ preventScroll: true });
    }
    if (el.hasAttribute('data-td-filter')) {
      const v = el.getAttribute('data-td-filter');
      st.ui.filter = st.ui.filter === v ? null : v;
      paint();
      touchRefresh();
      return;
    }
    if (el.hasAttribute('data-td-moment') || el.hasAttribute('data-td-more')) {
      const id = el.hasAttribute('data-td-more') ? 'more' : el.getAttribute('data-td-moment');
      if (st.ui.collapsed[id]) delete st.ui.collapsed[id]; else st.ui.collapsed[id] = true;
      paint();
      touchRefresh();
      return;
    }
    if (el.hasAttribute('data-wretry')) { const d = otherDay(); if (d) loadWeek(weekStartOf(d)); return; }
    // Tuile d'une personne sur un autre jour (personne en conge : tuile desactivee).
    if (el.hasAttribute('data-td-wpick')) {
      if (el.disabled) return;
      if (st.busy || el.getAttribute('aria-disabled') === 'true') { busyToast(); return; }
      const t = aheadJob(el.getAttribute('data-key'));
      if (!t) return;
      if (!t.w.fresh) { refuseRo(); return; }
      const u = aheadDayOf(t.w, t.day).units.find((x) => x.key === t.j.key);
      aheadAssign(t.j.key, el.getAttribute('data-td-wpick'), u ? aheadPlace(u.id, isNone(u), t.day) : null);
      return;
    }
    // Choix dans la carte. Cancel le ferme, meme pendant une ecriture (elle continue, le
    // resultat vient en toast). Pendant une ecriture, toucher une tuile, un disque ou un bouton
    // d'ecriture d'une fiche : « Saving, wait a second. ».
    if (el.hasAttribute('data-td-cancel')) { closePick(true); return; }
    if (el.hasAttribute('data-td-pick')) {
      if (st.busy || el.getAttribute('aria-disabled') === 'true') { busyToast(); return; }
      pickPerson(el.getAttribute('data-key'), el.getAttribute('data-td-pick'));
      return;
    }
    if (el.hasAttribute('data-td-who')) {
      if (st.busy) { busyToast(); return; }
      const id = el.getAttribute('data-td-who');
      if (st.ui.pick === id) { closePick(true); return; }
      if (otherDay()) openAheadPick(id); else openWho(id);
      return;
    }
    if (el.hasAttribute('data-assign') || el.hasAttribute('data-done')) {
      if (st.busy) { busyToast(); return; }
      todayGesture(el);
      return;
    }
    if (el.hasAttribute('data-td-open')) openCard(el.getAttribute('data-td-open'));
  }

  // Echap ferme le choix ouvert et rend le focus au disque (une fiche ouverte se ferme d'abord,
  // seule : dom.js a deja traite la touche). Fleches haut / bas entre les cartes d'un meme
  // moment, et entre les lignes d'un meme bloc (tickets de Maintenance).
  function onKey(e) {
    if (e.key === 'Escape') {
      if (e.defaultPrevented || sheetIsOpen() || st.ui.pick == null) return;
      e.preventDefault();
      closePick(true);
      return;
    }
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || sheetIsOpen()) return;
    const a = document.activeElement && document.activeElement.closest ? document.activeElement : null;
    if (!a) return;
    const card = a.closest('[data-td-open]');
    const row = card ? null : a.closest('[data-nav-row]');
    if (!card && !row) return;
    const box = card ? card.closest('.td-moment') : row.closest('section');
    if (!box) return;
    const all = Array.from(box.querySelectorAll(card ? '[data-td-open]' : '[data-nav-row]'));
    const cur = card || row;
    const next = all[all.indexOf(cur) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  }

  // Retour sur l'onglet : Today relu si la relecture est due, et la semaine du jour
  // affiche (autre jour) relue.
  const onVis = () => {
    if (document.visibilityState !== 'visible' || !ctx.isCurrent() || st.busy) return;
    if (!st.loading && due()) refresh();
    const d = otherDay();
    if (d) loadWeek(weekStartOf(d));
  };
  // Changement de jour de Dubai, ecran ouvert : Today relu tout seul, une tentative par jour
  // (en echec, le bandeau garde Retry).
  const dayCheck = setInterval(() => {
    if (!ctx.isCurrent() || st.busy || st.loading || !st.data) return;
    const day = dubaiDay(Date.now());
    if (st.data.day !== day && st.triedOn !== day) refresh();
  }, DAY_CHECK_MS);
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVis);
  ctx.onLeave(() => {
    clearInterval(dayCheck);
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVis);
  });
  await refresh();
}
