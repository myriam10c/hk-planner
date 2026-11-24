// Ecran Assign (lot 4b, spec-quick-assign section 3) : une ligne par menage, une initiale par
// personne, un toucher affecte ou retire. Lecture : mgr.planning des semaines que touchent les
// sept jours de la bande, en parallele ; une semaine en echec met ses jours en lecture seule.
// Ecriture : assignCleaner add ou remove avec la liste vue a l'ecran (expect_ids), une cle
// d'idempotence par geste et par menage, jamais d'auteur ; donnees de plus de 60 s relues
// d'abord (regle du lot 1). Modele et vue purs : assign-model.js, assign-view.js.
import { get, post } from '/manager/api.js';
import { createGestures, uncertain } from '/manager/gesture.js';
import { STALE_MS } from '/manager/fresh.js';
import { addDays, dubaiToday, toast } from '/manager/ui/dom.js';
import { weekStartOf } from '/manager/screens/planning-rules.js';
import { buildRows, firstDay, mergeWeeks, peopleOn, stripDays, toggleOp } from '/manager/screens/assign-model.js';
import { assignHtml } from '/manager/screens/assign-view.js';

const RO_LINE = 'Reconnect to make changes.';
const BUSY = 'Saving, wait a second.';
const LOADING = '<div class="qa"><header class="qa-head"><a class="qa-back" href="#/today">Today</a><h1>Assign</h1></header>'
  + '<p class="qa-empty" role="status">Loading…</p></div>';
// Liste d'ids comparee comme un ensemble : nombres uniques, tries.
const idSet = (ids) => [...new Set((ids || []).map(Number))].sort((a, b) => a - b);
const sameSet = (a, b) => { const x = idSet(a), y = idSet(b); return x.length === y.length && x.every((v, i) => v === y[i]); };

// Jour demande par l'adresse (#/assign?d=AAAA-MM-JJ), sinon null.
function wantedDay() {
  const d = new URLSearchParams((location.hash || '').split('?')[1] || '').get('d');
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export async function renderAssign(ctx) {
  const main = ctx.main;
  const wanted = wantedDay();
  // sel : jour affiche ; chosen : jour d'arrivee deja tranche sur des donnees lues (firstDay) ;
  // picked : jour choisi a la main dans la bande ; pinned : cle -> groupe au premier affichage de
  // la ligne (vide a chaque changement de jour) ; eliteOpen : groupe Often with Elite ouvert (au
  // depart : rien de cache) ; busy : menages dont l'ecriture (ou la relecture qui la precede, ou
  // celle qui suit un echec incertain) est en cours ; clock : jour de Dubai de la derniere lecture.
  const st = { loaded: false, starts: [], clock: dubaiToday(Date.now()), sel: null, chosen: false, picked: false,
    pinned: new Map(), eliteOpen: true, busy: new Set() };
  // Semaines lues : debut -> { data, ok, at } ; data garde la derniere reponse, ok dit si la
  // derniere lecture a reussi, at son heure (fraicheur).
  const weeks = {};
  // Listes ecrites par cet ecran, plus recentes que la lecture : cle -> { ids, tick, start }. tick :
  // Infinity pendant l'ecriture, puis le numero de la reponse ; une lecture partie apres cette
  // reponse (sur la semaine start) la remplace. Compteur plutot qu'horloge : l'horloge peut rester figee.
  const local = new Map();
  let tick = 0;
  let reading = null;
  // Un suivi de geste par menage : rejouer le meme geste apres un echec incertain reprend sa cle.
  const gestures = new Map();
  const gesturesFor = (key) => {
    if (!gestures.has(key)) gestures.set(key, createGestures());
    return gestures.get(key);
  };

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran. left : plus aucun rendu
  // (l'ecran de connexion par email remplace #main sans changer de vue).
  let left = false;
  function handleAccess(e) {
    if (e.kind === 'auth') { left = true; location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      left = true;
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  // ---------- Donnees ----------
  // Semaines fusionnees, avec les listes ecrites par cet ecran par-dessus.
  function merged() {
    const m = mergeWeeks(st.starts.map((s) => (weeks[s] ? weeks[s].data : null)));
    if (local.size) m.jobs = m.jobs.map((j) => (local.has(j.key) ? { ...j, assigned: local.get(j.key).ids.slice() } : j));
    return m;
  }
  const weekOf = (date) => weeks[weekStartOf(date)];
  // Lecture seule : semaine jamais lue, ou derniere lecture en echec.
  function roOn(date) { const w = weekOf(date); return !(w && w.ok); }
  function staleOn(date) { const w = weekOf(date); return !w || Date.now() - w.at > STALE_MS; }

  // Lit les semaines de la bande (aujourd'hui, et la suivante quand aujourd'hui + 6 y tombe).
  // Rend false quand l'ecran n'est plus affiche ou a ete quitte (acces refuse).
  async function readWeeks() {
    const t0 = ++tick;
    const today = dubaiToday(Date.now());
    const starts = [weekStartOf(today)];
    const last = weekStartOf(addDays(today, 6));
    if (last !== starts[0]) starts.push(last);
    const res = await Promise.all(starts.map((start) => get('mgr.planning', { start })
      .then((data) => ({ start, data }), (error) => ({ start, error }))));
    if (!ctx.isCurrent()) return false;
    const denied = res.find((r) => r.error && (r.error.kind === 'auth' || r.error.kind === 'forbidden'));
    if (denied) { handleAccess(denied.error); return false; }
    const now = Date.now();
    const fresh = new Set();
    for (const r of res) {
      const w = weeks[r.start] || (weeks[r.start] = { data: null, ok: false, at: 0 });
      if (r.error) { w.ok = false; continue; }
      w.data = r.data;
      w.ok = true;
      w.at = now;
      fresh.add(r.start);
    }
    for (const [k, v] of local) if (v.tick < t0 && fresh.has(v.start)) local.delete(k);
    st.starts = starts;
    st.clock = today;
    st.loaded = true;
    settleDay();
    return true;
  }
  // Une lecture a la fois : un geste ou Retry arrive pendant elle l'attend.
  function reread() {
    if (!reading) reading = readWeeks().finally(() => { reading = null; });
    return reading;
  }
  // Lecture partie apres cet instant : une lecture deja en vol (partie avant) est attendue, puis
  // une neuve part (ou celle qu'un autre geste vient de lancer, partie apres elle aussi).
  async function readAfter() {
    if (reading) await reading;
    return reread();
  }

  // Jour d'arrivee (une fois, sur des donnees lues) : firstDay (d s'il est dans la bande, sauf
  // aujourd'hui a 0 dans la bande ; sinon le premier jour que la bande compte ; sinon aujourd'hui).
  // Un jour de la bande choisi a la main avant la premiere lecture reussie reste tel quel. Sans
  // aucune donnee : d ou aujourd'hui.
  function settleDay() {
    const m = merged();
    const today = m.today || st.clock;
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    if (!st.chosen && m.today) {
      st.sel = st.picked && days.includes(st.sel) ? st.sel : firstDay(m, m.today, wanted);
      st.chosen = true;
      return;
    }
    if (!days.includes(st.sel)) st.sel = wanted && days.includes(wanted) ? wanted : today;
  }

  // ---------- Rendu ----------
  function viewModel() {
    const m = merged();
    const strip = stripDays(m, m.today || st.clock);
    const sel = st.sel;
    const w = weekOf(sel);
    const has = !!(w && w.data);
    const rows = has ? buildRows(m, sel, st.pinned) : { todo: [], assigned: [], elite: [] };
    // Chaque ligne garde le groupe de son premier affichage tant qu'on reste sur ce jour, touchee
    // ou non : une relecture ne deplace rien sous le doigt (une ligne faite ou annulee part).
    for (const r of rows.todo.concat(rows.assigned, rows.elite)) if (!st.pinned.has(r.key)) st.pinned.set(r.key, r.group);
    // empty : aucun menage non annule ce jour-la ; nothingLeft : des menages, tous faits.
    const empty = has && !m.jobs.some((j) => j.date === sel && !j.cancelled);
    const nothingLeft = has && !empty && !(rows.todo.length + rows.assigned.length + rows.elite.length);
    const ro = {};
    for (const s of strip) ro[s.date] = roOn(s.date);
    return { strip, sel, people: has ? peopleOn(m, sel) : [], rows, eliteOpen: st.eliteOpen, busy: st.busy, ro, empty, nothingLeft };
  }
  // Repeint : le focus revient sur le meme bouton (initiale : cle du menage ET personne).
  function focusMark() {
    const a = document.activeElement;
    if (!a || a === main || !main.contains(a)) return null;
    const v = (k) => '[' + k + '="' + CSS.escape(a.getAttribute(k)) + '"]';
    if (a.hasAttribute('data-qa-key') && a.hasAttribute('data-qa-id')) return v('data-qa-key') + v('data-qa-id');
    if (a.hasAttribute('data-qa-day')) return v('data-qa-day');
    if (a.hasAttribute('data-qa-elite')) return '[data-qa-elite]';
    if (a.hasAttribute('data-qa-retry')) return '[data-qa-retry]';
    return null;
  }
  function paint() {
    if (!ctx.isCurrent() || left) return;
    const mark = focusMark();
    main.innerHTML = st.loaded ? assignHtml(viewModel()) : LOADING;
    if (!mark) return;
    const el = main.querySelector(mark);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }

  // ---------- Gestes ----------
  // Ligne d'un menage (avec son groupe), sur son jour : { row, date }, ou null s'il n'est plus a
  // montrer (annule, fait, disparu).
  function rowOf(key) {
    const m = merged();
    const j = m.jobs.find((x) => x.key === key);
    if (!j) return null;
    const r = buildRows(m, j.date, st.pinned);
    const row = r.todo.concat(r.assigned, r.elite).find((x) => x.key === key);
    return row ? { row, date: j.date } : null;
  }
  function nameOf(id) {
    const p = merged().people.find((x) => Number(x.id) === Number(id));
    return p ? p.name : 'Member ' + id;
  }
  function drop(key, msg) {
    st.busy.delete(key);
    paint();
    toast(msg);
  }

  // Geste sur un menage : toucher d'une initiale ou Undo. op = { body, after, undo } (toggleOp),
  // body.expect_ids est la liste vue a l'ecran. Une ecriture a la fois par menage. Donnees de plus
  // de 60 s, ou relecture deja en cours : relecture d'abord ; geste abandonne si la liste du menage
  // a change pendant elle, refuse si son jour passe en lecture seule.
  async function gesture(key, op) {
    if (!ctx.isCurrent() || left) return;
    if (st.busy.has(key)) { toast(BUSY); return; }
    const t = rowOf(key);
    if (!t) return;
    if (roOn(t.date)) { toast(RO_LINE); return; }
    st.busy.add(key);
    // prev : liste locale juste avant l'ecriture (la meme que celle que write garde).
    let prev;
    try {
      if (reading || staleOn(t.date)) {
        paint();
        await reread();
        if (!ctx.isCurrent() || left) return;
        if (roOn(t.date)) { drop(key, RO_LINE); return; }
        const now = rowOf(key);
        if (!now || !sameSet(now.row.ids, op.body.expect_ids)) { drop(key, t.row.place + ' changed. Check and tap again.'); return; }
      }
      prev = local.get(key);
      await write(key, t.row.place, weekStartOf(t.date), op);
    } catch (e) {
      // Exception imprevue (les refus de l'API sont traites par write) : une ecriture encore en vol
      // (tick Infinity : une seule par menage) revient a la liste d'avant ; une ecriture tranchee
      // garde la sienne. Le message s'affiche.
      const cur = local.get(key);
      if (cur && cur.tick === Infinity) { if (prev) local.set(key, prev); else local.delete(key); }
      if (ctx.isCurrent() && !left) drop(key, (e && e.message) || 'Something went wrong. Try again.');
    } finally {
      // Jamais de ligne laissee sur « Saving ».
      st.busy.delete(key);
    }
  }

  // Ecriture : la liste voulue (after) s'affiche tout de suite. Reussite : toast avec Undo (le geste
  // inverse, par le meme chemin, cle neuve). 409 avec current : un collegue a change la liste, la
  // ligne la prend. Echec incertain (delai, reseau, 5xx, cle encore en cours) : l'ecriture a peut-etre
  // eu lieu, le message s'affiche et la semaine est relue tout de suite ; la ligne montre ensuite la
  // liste du serveur. Autre refus : la ligne revient a l'etat d'avant, le message tel quel.
  async function write(key, place, start, op) {
    const body = op.body;
    const prev = local.get(key);
    local.set(key, { ids: op.after.slice(), tick: Infinity, start });
    paint();
    let err = null;
    try {
      await gesturesFor(key).run('assignCleaner|' + JSON.stringify(body), (idem) => post('assignCleaner', { ...body, idem }));
    } catch (e) { err = e; }
    if (!ctx.isCurrent()) return;
    st.busy.delete(key);
    const current = err && err.status === 409 && err.data && Array.isArray(err.data.current) ? idSet(err.data.current) : null;
    // Rejeu d'une ecriture deja faite dont la reponse s'est perdue : assignCleaner n'a pas
    // d'idempotence cote serveur, il repond 409 avec la liste voulue. C'est une reussite.
    if (err && !(current && sameSet(current, op.after))) {
      if (handleAccess(err)) return;
      if (current) {
        local.set(key, { ids: current, tick: ++tick, start });
        paint();
        toast('Someone else changed ' + place + '. Check and tap again.');
        return;
      }
      if (uncertain(err)) {
        // La ligne reste occupee sur la liste voulue le temps de la relecture ; partie apres ce tick,
        // elle remplace cette liste par celle du serveur (une relecture en echec met le jour en
        // lecture seule, Retry la relance).
        local.set(key, { ids: op.after.slice(), tick: ++tick, start });
        st.busy.add(key);
        paint();
        toast(err.message);
        await readAfter();
        st.busy.delete(key);
        paint();
        return;
      }
      if (prev) local.set(key, prev); else local.delete(key);
      paint();
      toast(err.message);
      return;
    }
    local.set(key, { ids: op.after.slice(), tick: ++tick, start });
    paint();
    const name = nameOf(body.cleaner_id);
    const back = { body: op.undo, after: idSet(body.expect_ids), undo: body };
    toast(body.mode === 'add' ? place + ' assigned to ' + name : name + ' removed from ' + place, () => gesture(key, back));
  }

  function tap(key, id) {
    if (st.busy.has(key)) { toast(BUSY); return; }
    const t = rowOf(key);
    if (t) gesture(key, toggleOp(t.row, id));
  }
  // Autre jour : rendu seul, aucune ecriture ; les lignes reprennent leur groupe.
  function pickDay(d) {
    if (d === st.sel) return;
    st.sel = d;
    st.picked = true;
    st.pinned.clear();
    paint();
  }
  async function retry() {
    await reread();
    paint();
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-qa-day],[data-qa-elite],[data-qa-retry],[data-qa-key]') : null;
    if (!el || !main.contains(el) || !st.loaded) return;
    if (el.hasAttribute('data-qa-retry')) { retry(); return; }
    // Safari ne donne pas le focus a un bouton touche : pose ici, il revient apres le rendu.
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    if (el.hasAttribute('data-qa-day')) { pickDay(el.getAttribute('data-qa-day')); return; }
    if (el.hasAttribute('data-qa-elite')) { st.eliteOpen = !st.eliteOpen; paint(); return; }
    // Initiale refusee : en lecture seule, le toucher le dit (le bandeau est souvent hors de
    // l'ecran) ; une personne off, barree, reste muette.
    if (el.getAttribute('aria-disabled') === 'true') { if (roOn(st.sel)) toast(RO_LINE); return; }
    tap(el.getAttribute('data-qa-key'), el.getAttribute('data-qa-id'));
  }

  document.addEventListener('click', onClick);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    // Un Undo laisse a l'ecran viserait un ecran quitte : le toast part avec lui.
    const t = document.getElementById('toast');
    if (t && t.querySelector('[data-undo]')) t.classList.remove('on');
  });
  paint();
  await reread();
  paint();
}
