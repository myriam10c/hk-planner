// Ecran Maintenance (#/maintenance, spec 2026-10-12 section 6, maquettes 1, 2, 3, 5) :
// onglets Proposals, Open, Done ; valider, rejeter ou fusionner une proposition.
// Lecture : mnt.list (une liste gardee en memoire par onglet), mnt.get pour un lien
// ?ref=PRP-n. Gestes : mnt.act, une cle d'idempotence par geste (createGestures),
// jamais d'auteur envoye. Donnees non fraiches : aucun geste, « Reconnect to make changes. ».
import { get, post } from '/manager/api.js';
import { createGestures } from '/manager/gesture.js';
import {
  announceMntBadge, closeSheet, dubaiTime, openSheet, sheetBusy, sheetError, sheetIsOpen, toast,
} from '/manager/ui/dom.js';
import * as V from '/manager/screens/maintenance-view.js';

const TABS = ['proposals', 'open', 'done'];
const FILTERS = ['mine', 'urgent', 'unassigned'];
const SEARCH_DELAY_MS = 250;

export async function renderMaintenance(ctx) {
  const main = ctx.main;
  const hq = new URLSearchParams(location.hash.split('?')[1] || '');
  const hashTab = TABS.includes(hq.get('tab')) ? hq.get('tab') : null;
  // view : proposals, rejected (See rejected), open ou done. lists : derniere liste lue par vue.
  const st = {
    view: hashTab || 'proposals', tabInHash: !!hashTab, filter: 'all', q: '', lists: {}, meta: null,
    loading: false, error: null, seq: 0, busy: false, typing: null, prp: null, from: 'card',
  };
  const gestures = createGestures();
  const tabOf = (v) => (v === 'rejected' ? 'proposals' : v);
  const cur = () => st.lists[st.view] || null;
  const readOnly = () => !cur() || !cur().fresh || !st.meta;

  function handleAccess(e) {
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  main.innerHTML = V.shellHtml();
  const $ = (id) => document.getElementById(id);
  const search = $('mtSearch');

  function paint() {
    if (!ctx.isCurrent()) return;
    const e = cur();
    const asof = $('mtAsof');
    asof.hidden = !e;
    asof.textContent = e ? 'Data as of ' + dubaiTime(new Date(e.savedAt).toISOString()) : '';
    asof.classList.toggle('stale', !!e && !e.fresh);
    $('mtTabs').innerHTML = V.tabsHtml(tabOf(st.view), st.meta && st.meta.counts);
    $('mtBanner').innerHTML = V.bannerHtml(e, st.error, st.loading);
    const open = st.view === 'open';
    $('mtTools').hidden = !open;
    if (open) $('mtChips').innerHTML = V.chipsHtml(st.filter, st.meta && st.meta.counts);
    const now = Date.now();
    let h;
    if (st.view === 'proposals') h = V.proposalsHtml(e, st.error, now);
    else if (st.view === 'rejected') h = V.rejectedHtml(e, st.error);
    else if (open) h = V.openHtml(e, st.error, st.filter !== 'all' || !!st.q, now);
    else h = V.doneHtml(e, st.error);
    $('mtList').innerHTML = h;
  }

  function params(view) {
    const p = { tab: tabOf(view) };
    if (view === 'rejected') p.rejected = '1';
    if (view === 'open') {
      if (st.filter !== 'all') p.filter = st.filter;
      if (st.q) p.q = st.q;
    }
    return p;
  }

  async function refresh() {
    const mine = ++st.seq;
    const view = st.view;
    st.loading = true;
    st.error = null;
    paint();
    const asked = { filter: st.filter, q: st.q };
    try {
      const d = await get('mnt.list', params(view));
      if (mine !== st.seq || !ctx.isCurrent()) return false;
      st.lists[view] = { data: d, savedAt: Date.now(), fresh: true, f: asked };
      st.meta = { counts: d.counts, team: d.team || [], vendors: d.vendors || [], listings: d.listings || [] };
      announceMntBadge(d.counts && d.counts.proposals);
    } catch (e) {
      if (mine !== st.seq || !ctx.isCurrent()) return false;
      if (handleAccess(e)) return false;
      st.error = e;
      const e2 = st.lists[view];
      if (e2) {
        e2.fresh = false;
        // Puces et recherche reviennent au filtre de la liste affichee.
        if (view === 'open' && e2.f) { st.filter = e2.f.filter; st.q = e2.f.q; if (document.activeElement !== search) search.value = st.q; }
      }
    }
    st.loading = false;
    paint();
    return true;
  }

  // --- Hash : onglet garde (?tab=), feuille suivie (?ref=) par replaceState -------
  function baseHash() { return '#/maintenance' + (st.tabInHash ? '?tab=' + tabOf(st.view) : ''); }
  function shownRef() {
    const el = sheetIsOpen() ? document.querySelector('#sheet [data-mref]') : null;
    return el ? el.getAttribute('data-mref') : null;
  }
  function syncHash() {
    if (!ctx.isCurrent() || location.hash.split('?')[0] !== '#/maintenance') return;
    const ref = shownRef();
    const want = ref ? '#/maintenance?ref=' + encodeURIComponent(ref) : baseHash();
    if (location.hash !== want) history.replaceState(history.state, '', want);
  }
  const sheetEl = document.getElementById('sheet');
  const watcher = sheetEl ? new MutationObserver(syncHash) : null;
  if (watcher) {
    watcher.observe(sheetEl, { attributes: true, attributeFilter: ['class'] });
    watcher.observe(document.getElementById('sheetInner'), { childList: true });
  }

  function setView(v) {
    if (v === st.view) return;
    st.view = v;
    st.error = null;
    if (TABS.includes(v)) { st.tabInHash = true; syncHash(); }
    refresh();
  }

  // --- Gestes ---------------------------------------------------------------
  // Un geste : cle d'idempotence (reprise au reessai incertain), feuille bloquee
  // pendant l'envoi, erreur du serveur dans la feuille (409 : la liste est relue).
  async function write(ref, body, okMsg) {
    if (st.busy) { toast('Saving, wait a second.'); return null; }
    if (readOnly()) { toast(V.RO_LINE); return null; }
    st.busy = true;
    if (ref && shownRef() === ref) sheetBusy(true);
    let r;
    try {
      r = await gestures.run('mnt.act|' + JSON.stringify(body), (idem) => post('mnt.act', { ...body, idem }));
    } catch (e) {
      st.busy = false;
      if (ref && shownRef() === ref) sheetBusy(false);
      if (handleAccess(e)) return null;
      if (ref && shownRef() === ref) sheetError(e.message); else toast(e.message);
      if (e.status === 409 || e.status === 404) refresh();
      return null;
    }
    st.busy = false;
    if (ref && shownRef() === ref) { sheetBusy(false); closeSheet(); }
    toast(typeof okMsg === 'function' ? okMsg(r || {}) : okMsg);
    refresh();
    return r;
  }

  function prpOf(ref) {
    if (st.prp && st.prp.ref === ref) return st.prp;
    for (const k of ['proposals', 'rejected']) {
      const e = st.lists[k];
      const p = e && e.data.proposals.find((x) => x.ref === ref);
      if (p) return p;
    }
    return null;
  }
  function showProposal(p, others) {
    st.prp = p;
    st.others = others || [];
    st.from = 'proposal';
    openSheet(V.proposalSheet(p, readOnly(), st.others));
  }
  function showCreate(p, from) {
    if (readOnly()) { toast(V.RO_LINE); return; }
    st.prp = p;
    st.from = from;
    openSheet(V.createSheet(p, st.meta, false));
  }
  function showReject(p, from) {
    if (readOnly()) { toast(V.RO_LINE); return; }
    st.prp = p;
    st.from = from;
    openSheet(V.rejectSheet(p, false));
  }
  function merge(p, tid, tref) {
    return write(p.ref, { op: 'proposal.merge', proposalId: p.id, ticketId: Number(tid) }, 'Added to ' + tref);
  }

  function pressed(sel) {
    const el = document.querySelector('#sheet ' + sel + '[aria-pressed="true"]');
    return el || null;
  }
  function press(el, attr) {
    document.querySelectorAll('#sheet [' + attr + ']').forEach((b) => b.setAttribute('aria-pressed', b === el ? 'true' : 'false'));
  }
  function sendAccept(p) {
    const title = ($('mtTitle').value || '').trim();
    if (!title) { sheetError('Write a title first.'); return; }
    const u = pressed('[data-urg]');
    const w = pressed('[data-who]');
    const body = {
      op: 'proposal.accept', proposalId: p.id, title, listingId: $('mtApt').value || null, category: $('mtCat').value,
      urgency: u ? u.getAttribute('data-urg') : 'normal', note: ($('mtNote').value || '').trim(),
    };
    const who = w ? w.getAttribute('data-who') : 'none';
    if (who === 'vendor') {
      const v = $('mtVendor').value;
      if (!v) { sheetError('Choose a vendor.'); return; }
      body.vendorId = Number(v);
    } else if (who.startsWith('m:')) body.memberId = Number(who.slice(2));
    write(p.ref, body, (r) => (r.ref || 'Ticket') + ' created');
  }
  function sendReject(p) {
    const r = pressed('[data-reason]');
    if (!r) { sheetError('Choose a reason.'); return; }
    const reason = r.getAttribute('data-reason');
    const note = ($('mtWhy').value || '').trim();
    if (reason === 'other' && !note) { sheetError('Write why.'); return; }
    const body = { op: 'proposal.reject', proposalId: p.id, reason };
    if (note) body.note = note;
    write(p.ref, body, p.ref + ' rejected');
  }

  // Crochet de la tache 5 : fiche ticket. Provisoire, la reference et Close.
  function openTicket(ref) { openSheet(V.ticketStubSheet(ref)); }

  function onSheetClick(el) {
    const k = el.getAttribute('data-mact');
    const ref = shownRef();
    const p = ref ? prpOf(ref) : null;
    if (!p) return;
    if (k === 'urg') { press(el, 'data-urg'); return; }
    if (k === 'who') {
      press(el, 'data-who');
      const box = $('mtVendorBox');
      if (box) box.hidden = el.getAttribute('data-who') !== 'vendor';
      return;
    }
    if (k === 'reason') {
      press(el, 'data-reason');
      const box = $('mtWhyBox');
      if (box) box.hidden = el.getAttribute('data-reason') !== 'other';
      return;
    }
    if (k === 'back') { if (st.from === 'proposal') openSheet(V.proposalSheet(p, readOnly(), st.others)); else closeSheet(); return; }
    if (k === 'create') { showCreate(p, 'proposal'); return; }
    if (k === 'reject') { showReject(p, 'proposal'); return; }
    if (k === 'merge') { merge(p, el.getAttribute('data-tid'), el.getAttribute('data-tref')); return; }
    if (k === 'accept-send') { sendAccept(p); return; }
    if (k === 'reject-send') sendReject(p);
  }

  function onClick(e) {
    if (!ctx.isCurrent() || !e.target || !e.target.closest) return;
    const s = e.target.closest('#sheet [data-mact]');
    if (s) { onSheetClick(s); return; }
    const el = e.target.closest('#main [data-tab],#main [data-filter],#main [data-retry],#main [data-clear],#main [data-see-rejected],'
      + '#main [data-back-proposals],#main [data-create],#main [data-reject],#main [data-merge],#main [data-more-prp],'
      + '#main [data-ticket],#main [data-reopen],#main [data-new]');
    if (!el) return;
    if (el.hasAttribute('data-tab')) { setView(el.getAttribute('data-tab')); return; }
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (el.hasAttribute('data-see-rejected')) { setView('rejected'); return; }
    if (el.hasAttribute('data-back-proposals')) { setView('proposals'); return; }
    if (el.hasAttribute('data-filter')) {
      const f = el.getAttribute('data-filter');
      if (!FILTERS.includes(f)) return;
      st.filter = st.filter === f ? 'all' : f;
      refresh();
      return;
    }
    if (el.hasAttribute('data-clear')) { st.filter = 'all'; st.q = ''; search.value = ''; refresh(); return; }
    if (el.hasAttribute('data-new')) { openSheet(V.newTicketStubSheet()); return; }
    if (el.hasAttribute('data-ticket')) { openTicket(el.getAttribute('data-ticket')); return; }
    const ref = el.getAttribute('data-ref');
    if (el.hasAttribute('data-reopen')) {
      write(null, { op: 'ticket.reopen', ticketId: Number(el.getAttribute('data-id')) }, ref + ' reopened');
      return;
    }
    const p = prpOf(ref);
    if (!p) return;
    if (el.hasAttribute('data-create')) { showCreate(p, 'card'); return; }
    if (el.hasAttribute('data-reject')) { showReject(p, 'card'); return; }
    if (el.hasAttribute('data-more-prp')) { showProposal(p, []); return; }
    if (el.hasAttribute('data-merge')) merge(p, el.getAttribute('data-tid'), el.getAttribute('data-tref'));
  }

  function onInput() {
    clearTimeout(st.typing);
    st.typing = setTimeout(() => {
      const q = search.value.trim();
      if (q === st.q || st.view !== 'open') return;
      st.q = q;
      refresh();
    }, SEARCH_DELAY_MS);
  }

  document.addEventListener('click', onClick);
  search.addEventListener('input', onInput);
  ctx.onLeave(() => {
    if (watcher) watcher.disconnect();
    document.removeEventListener('click', onClick);
    search.removeEventListener('input', onInput);
    clearTimeout(st.typing);
  });

  await refresh();
  // Onglet par defaut : Proposals s'il y a des propositions en attente, sinon Open.
  if (!hashTab && ctx.isCurrent() && st.view === 'proposals' && st.meta && !(Number(st.meta.counts.proposals) > 0)) {
    st.view = 'open';
    await refresh();
  }
  const linked = hq.get('ref');
  if (linked && ctx.isCurrent()) await openLinked(linked.trim().toUpperCase());

  // Lien profond : PRP-n lu par mnt.get, MNT-n vers la fiche ticket (tache 5).
  async function openLinked(ref) {
    if (/^MNT-\d+$/.test(ref)) { openTicket(ref); return; }
    const missing = () => { toast('This proposal was not found.'); syncHash(); };
    if (!/^PRP-\d+$/.test(ref)) { missing(); return; }
    try {
      const d = await get('mnt.get', { ref });
      if (!ctx.isCurrent()) return;
      if (!d || d.kind !== 'proposal' || !d.proposal) { missing(); return; }
      showProposal(d.proposal, d.proposal.sameListingOpen || []);
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      if (e.status === 404) missing(); else { toast(e.message); syncHash(); }
    }
  }
}
