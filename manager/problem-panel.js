// Fiche d'un probleme (MNT ou TSK) et ses gestes, partagee par Today et Problems.
// Lecture : mgr.problem.get. Gestes : mgr.problem.act, une cle d'idempotence par
// geste (reprise au reessai d'un geste a l'issue inconnue), jamais d'auteur envoye
// (le proxy le prend dans la session).
import { get, newIdem, post } from '/manager/api.js';
import { closeSheet, ddmm, dubaiToday, openSheet, sheetBusy, sheetError, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { assignSheet, detailSheet, errorSheet, loadingSheet, scheduleSheet } from '/manager/screens/problem-view.js';

const RO_LINE = 'Reconnect to make changes.';
const STILL = 'Still processing. Retry.';

// Echec dont l'issue cote serveur est inconnue : delai depasse, reseau coupe, 5xx, ou
// cle encore en cours. Le meme geste rejoue alors la meme cle (pas de doublon).
function uncertain(e) {
  return !!e && (e.kind === 'timeout' || e.kind === 'offline' || (e.status === 409 && e.message === STILL)
    || (e.kind === 'server' && e.status >= 500));
}

export function createProblemPanel(opts) {
  // pending : derniere cle d'un geste a l'issue inconnue, reprise si le meme geste est rejoue.
  const st = { busy: false, row: null, detail: null, view: 'detail', origin: 'detail', seq: 0, pending: null };
  const ro = () => !!opts.readOnly();

  // Probleme affiche dans le panneau (marqueur data-panel), null si le panneau montre autre chose.
  function shownRef() {
    const el = sheetIsOpen() ? document.querySelector('#sheet [data-panel]') : null;
    return el ? el.getAttribute('data-panel') : null;
  }
  const held = (ref) => shownRef() === ref;
  const cached = (ref) => (st.detail && st.detail.problem.ref === ref ? st.detail : null);

  function show(view) {
    st.view = view;
    if (view === 'assign') openSheet(assignSheet(st.detail, ro()));
    else if (view === 'schedule') openSheet(scheduleSheet(st.detail, dubaiToday(Date.now()), ro()));
    else openSheet(detailSheet(st.detail, ro()));
  }

  async function load(ref, view) {
    const mine = ++st.seq;
    st.view = view;
    if (!cached(ref) || !held(ref)) openSheet(loadingSheet(ref, st.row));
    try {
      const d = await get('mgr.problem.get', { ref });
      if (mine !== st.seq || !held(ref)) return;
      st.detail = d;
      show(view);
    } catch (e) {
      if (mine !== st.seq) return;
      if (opts.handleAccess(e)) return;
      if (held(ref)) openSheet(errorSheet(ref, st.row, e.message)); else toast(e.message);
    }
  }

  async function act(ref, verb, extra, done) {
    if (st.busy) { toast('Saving, wait a second.'); return; }
    if (ro()) { toast(RO_LINE); return; }
    st.busy = true;
    if (held(ref)) sheetBusy(true);
    const sig = ref + '|' + verb + '|' + JSON.stringify(extra);
    const idem = st.pending && st.pending.sig === sig ? st.pending.idem : newIdem();
    try {
      await post('mgr.problem.act', { ref, verb, idem, ...extra });
    } catch (e) {
      st.pending = uncertain(e) ? { sig, idem } : null;
      st.busy = false;
      if (held(ref)) sheetBusy(false);
      if (opts.handleAccess(e)) return;
      if (held(ref)) sheetError(e.message); else toast(e.message);
      return;
    }
    st.pending = null;
    st.busy = false;
    if (held(ref)) sheetBusy(false);
    done();
    opts.onChange();
  }

  // Apres Assign ou Schedule : retour a la fiche si on en venait, sinon le panneau se ferme.
  function edited(ref, msg) {
    toast(msg);
    if (!held(ref)) return;
    if (st.origin === 'quick') closeSheet(); else load(ref, 'detail');
  }
  function noteFor(ref) {
    const t = held(ref) ? document.getElementById('pComment') : null;
    return t ? t.value.trim() : '';
  }
  function close(ref, row) {
    if (row) st.row = row;
    const note = noteFor(ref);
    return act(ref, 'close', note ? { note } : {}, () => {
      if (held(ref)) closeSheet();
      toast(ref + ' closed', () => reopen(ref));
    });
  }
  function reopen(ref) {
    return act(ref, 'reopen', {}, () => {
      toast(ref + ' reopened');
      if (held(ref)) load(ref, 'detail');
    });
  }
  function quick(ref, row, view) {
    if (ro()) { toast(RO_LINE); return; }
    if (row) st.row = row;
    if (held(ref) && cached(ref)) { st.origin = 'detail'; show(view); return; }
    st.origin = 'quick';
    st.detail = null;
    load(ref, view);
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('#sheet [data-pact]') : null;
    const ref = el ? shownRef() : null;
    if (!el || !ref) return;
    const k = el.getAttribute('data-pact');
    if (k === 'retry') { load(ref, st.view); return; }
    if (k === 'back') { if (st.origin === 'quick') closeSheet(); else show('detail'); return; }
    const d = cached(ref);
    if (!d) return;
    if (k === 'assign' || k === 'schedule') { st.origin = 'detail'; show(k); return; }
    if (k === 'pick') {
      const id = Number(el.getAttribute('data-id'));
      const p = d.assignees.find((a) => a.id === id);
      act(ref, 'assign', { memberId: id }, () => edited(ref, ref + ' assigned to ' + (p ? p.name : 'Member ' + id)));
      return;
    }
    if (k === 'vendor') {
      const id = Number(el.getAttribute('data-id'));
      const v = d.vendors.find((x) => x.id === id);
      act(ref, 'assign', { vendorId: id }, () => edited(ref, ref + ' sent to ' + (v ? v.name : 'Vendor ' + id)));
      return;
    }
    if (k === 'unassign') { act(ref, 'assign', { unassign: true }, () => edited(ref, ref + ' unassigned')); return; }
    if (k === 'date' || k === 'date-input') {
      const inp = document.getElementById('pDate');
      const day = k === 'date' ? el.getAttribute('data-date') : (inp ? inp.value : '');
      if (!day) { sheetError('Choose a date.'); return; }
      act(ref, 'schedule', { date: day }, () => edited(ref, ref + ' due ' + ddmm(day)));
      return;
    }
    if (k === 'clear-date') { act(ref, 'schedule', { date: null }, () => edited(ref, ref + ' has no due date now')); return; }
    if (k === 'comment') {
      const text = noteFor(ref);
      if (!text) { sheetError('Write a comment first.'); return; }
      act(ref, 'comment', { text }, () => { toast('Comment added'); if (held(ref)) load(ref, 'detail'); });
      return;
    }
    if (k === 'close') { close(ref, st.row); return; }
    if (k === 'reopen') reopen(ref);
  }

  document.addEventListener('click', onClick);
  return {
    open(ref, row) { st.row = row || null; st.origin = 'detail'; st.detail = null; load(ref, 'detail'); },
    assign(ref, row) { quick(ref, row, 'assign'); },
    schedule(ref, row) { quick(ref, row, 'schedule'); },
    close(ref, row) { return close(ref, row); },
    current: shownRef,
    view() { return st.view; },
    dispose() { document.removeEventListener('click', onClick); },
  };
}
