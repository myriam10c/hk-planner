// Ecran Maintenance (#/maintenance, spec 2026-10-12 section 6, maquettes 1, 2, 3, 5) :
// onglets Proposals, Open, Done ; valider, rejeter ou fusionner une proposition.
// Lecture : mnt.list (une liste gardee en memoire par onglet), mnt.get pour un lien
// ?ref=PRP-n ou MNT-n (fiche ticket, maquette 4). Gestes : mnt.act, une cle
// d'idempotence par geste (createGestures), jamais d'auteur envoye ; photo de cloture
// par mnt.photo avant ticket.done. Donnees non fraiches : aucun geste, « Reconnect to make changes. ».
import { get, post, upload } from '/manager/api.js';
import { createGestures } from '/manager/gesture.js';
import { shrink } from '/inspections/photo.js';
import {
  announceMntBadge, closeSheet, dubaiTime, openSheet, sheetBusy, sheetError, sheetIsOpen, toast,
} from '/manager/ui/dom.js';
import * as V from '/manager/screens/maintenance-view.js';

const TABS = ['proposals', 'open', 'done'];
const FILTERS = ['mine', 'urgent', 'unassigned'];
const SEARCH_DELAY_MS = 250;
const DUE_MAX_DAYS = 60; // MNT_DUE_MAX_DAYS (mnt_act.ts)
const COST_RE = /^\d+(\.\d{1,2})?$/; // meme regle que parseCost (mnt_act.ts)
// Liste lue il y a plus d'une minute : relue avant un geste (comme Planning).
const STALE_MS = 60000;
// Types acceptes par le depot (v3_photos.ts) quand la photo n'a pas pu etre reduite.
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const BAD_PHOTO = 'This photo format is not supported. Take a new photo.';

export async function renderMaintenance(ctx) {
  const main = ctx.main;
  const hq = new URLSearchParams(location.hash.split('?')[1] || '');
  const hashTab = TABS.includes(hq.get('tab')) ? hq.get('tab') : null;
  // view : proposals, rejected (See rejected), open ou done. lists : derniere liste lue par vue.
  const st = {
    view: hashTab || 'proposals', tabInHash: !!hashTab, filter: 'all', q: '', lists: {}, meta: null,
    loading: false, error: null, seq: 0, busy: false, typing: null, prp: null, from: 'card',
    tk: null, tkSeq: 0, photo: null,
  };
  const gestures = createGestures();
  // Cles des envois de photo, a part : une photo deja deposee n'est pas renvoyee.
  const photoGestures = createGestures();
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

  main.innerHTML = V.shellHtml(ctx.role === 'maintenance');
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
    if (!st.view) h = '<p class="boot" role="status">Loading…</p>';
    else if (st.view === 'proposals') h = V.proposalsHtml(e, st.error, now);
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
      keep(view, d, asked);
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

  function keep(view, d, asked) {
    st.lists[view] = { data: d, savedAt: Date.now(), fresh: true, f: asked };
    st.meta = { counts: d.counts, team: d.team || [], vendors: d.vendors || [], listings: d.listings || [] };
    announceMntBadge(d.counts && d.counts.proposals);
  }

  // Premier affichage sans onglet dans le hash : Proposals lue d'abord, rien n'est peint
  // avant de connaitre le compte ; aucune proposition en attente -> Open (pas de Proposals vide).
  async function boot() {
    if (hashTab) { await refresh(); return; }
    st.view = null;
    st.loading = true;
    paint();
    const mine = ++st.seq;
    try {
      const d = await get('mnt.list', params('proposals'));
      if (mine !== st.seq || !ctx.isCurrent()) return;
      keep('proposals', d, { filter: st.filter, q: st.q });
    } catch (e) {
      if (mine !== st.seq || !ctx.isCurrent() || handleAccess(e)) return;
      st.view = 'proposals';
      st.error = e;
      st.loading = false;
      paint();
      return;
    }
    st.view = Number(st.meta.counts && st.meta.counts.proposals) > 0 ? 'proposals' : 'open';
    if (st.view === 'open') { await refresh(); return; }
    st.loading = false;
    paint();
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

  // Feuille qui appartient au geste : la reference affichee, ou 'NEW' pour + New ticket.
  function owns(key) {
    if (!key || !sheetIsOpen()) return false;
    if (key === 'NEW') return !!document.querySelector('#sheet [data-mnew]');
    return shownRef() === key;
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
    if (!(await freshEnough())) return null;
    st.busy = true;
    if (owns(ref)) sheetBusy(true);
    let r;
    try {
      r = await gestures.run('mnt.act|' + JSON.stringify(body), (idem) => post('mnt.act', { ...body, idem }));
    } catch (e) {
      st.busy = false;
      if (!ctx.isCurrent()) return null;
      if (owns(ref)) sheetBusy(false);
      if (handleAccess(e)) return null;
      if (owns(ref)) sheetError(e.message); else toast(e.message);
      if (e.status === 409 || e.status === 404) refresh();
      return null;
    }
    st.busy = false;
    // Ecran quitte pendant l'envoi : ni toast ni relecture ici.
    if (!ctx.isCurrent()) return r;
    if (owns(ref)) { sheetBusy(false); closeSheet(); }
    toast(typeof okMsg === 'function' ? okMsg(r || {}) : okMsg);
    refresh();
    return r;
  }

  // Liste lue il y a plus d'une minute : relue avant le geste. Relecture ratee :
  // anciennes donnees gardees, en lecture seule, aucun geste.
  let reloading = false;
  async function freshEnough() {
    const e = cur();
    if (!e || Date.now() - e.savedAt <= STALE_MS) return true;
    if (reloading) return false;
    reloading = true;
    await refresh();
    reloading = false;
    if (!ctx.isCurrent()) return false;
    if (readOnly()) { toast(V.RO_LINE); return false; }
    return true;
  }

  // Proposition par reference : depuis une carte, la liste fraiche d'abord ; depuis une
  // feuille, la proposition affichee (lien PRP hors liste, detail de mnt.get).
  function prpOf(ref, fromSheet) {
    const held = st.prp && st.prp.ref === ref ? st.prp : null;
    if (fromSheet && held) return held;
    for (const k of ['proposals', 'rejected']) {
      const e = st.lists[k];
      const p = e && e.data.proposals.find((x) => x.ref === ref);
      if (p) return p;
    }
    return held;
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
  // Champs d'un ticket (Create ticket, + New ticket) ; null apres une erreur dans la feuille.
  function ticketFields(needApt) {
    const title = ($('mtTitle').value || '').trim();
    if (!title) { sheetError('Write a title first.'); return null; }
    const listingId = $('mtApt').value || null;
    if (needApt && !listingId) { sheetError('Choose an apartment.'); return null; }
    const u = pressed('[data-urg]');
    const w = pressed('[data-who]');
    const body = {
      title, listingId, category: $('mtCat').value,
      urgency: u ? u.getAttribute('data-urg') : 'normal', note: ($('mtNote').value || '').trim(),
    };
    const who = w ? w.getAttribute('data-who') : 'none';
    if (who === 'vendor') {
      const v = $('mtVendor').value;
      if (!v) { sheetError('Choose a vendor.'); return null; }
      body.vendorId = Number(v);
    } else if (who.startsWith('m:')) body.memberId = Number(who.slice(2));
    return body;
  }
  function sendAccept(p) {
    const f = ticketFields(false);
    if (!f) return;
    write(p.ref, { op: 'proposal.accept', proposalId: p.id, ...f }, (r) => (r.ref || 'Ticket') + ' created');
  }
  function showNew() {
    if (readOnly()) { toast(V.RO_LINE); return; }
    openSheet(V.newTicketSheet(st.meta));
  }
  function sendNew() {
    const f = ticketFields(true);
    if (!f) return;
    write('NEW', { op: 'ticket.create', ...f }, (r) => (r.ref || 'Ticket') + ' created');
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

  // --- Fiche ticket (maquette 4) ---------------------------------------------
  // mnt.get?ref=MNT-n ; feuille de chargement d'abord (la reference passe dans le hash).
  // Fermee entre-temps : rien n'est rouvert. Inconnu : toast et retour a la liste.
  async function openTicket(ref) {
    const mine = ++st.tkSeq;
    openSheet(V.ticketLoadingSheet(ref));
    let d;
    try {
      d = await get('mnt.get', { ref });
    } catch (e) {
      if (!ctx.isCurrent() || mine !== st.tkSeq || handleAccess(e)) return;
      if (e.status === 404 || e.status === 400) { ticketMissing(ref); return; }
      if (shownRef() === ref) openSheet(V.ticketErrorSheet(ref, e.message));
      return;
    }
    if (!ctx.isCurrent() || mine !== st.tkSeq) return;
    if (!d || d.kind !== 'ticket' || !d.ticket) { ticketMissing(ref); return; }
    if (shownRef() !== ref) return;
    st.tk = d.ticket;
    showTicket();
  }
  function ticketMissing(ref) {
    if (shownRef() === ref) closeSheet();
    toast('This ticket was not found.');
    syncHash();
  }
  function showTicket() { openSheet(V.ticketSheet(st.tk, readOnly(), Date.now())); }
  function tkSub(html) {
    if (readOnly()) { toast(V.RO_LINE); return; }
    openSheet(html);
  }
  const tkBody = (t, op, extra) => ({ op, ticketId: t.id, ...(extra || {}) });

  // Cloture : la photo d'abord (mnt.photo, sa propre cle), puis ticket.done avec le
  // chemin rendu. Envoi de photo rate : la feuille reste, aucun ticket.done.
  async function sendDone(t) {
    if (st.busy) { toast('Saving, wait a second.'); return; }
    if (readOnly()) { toast(V.RO_LINE); return; }
    const note = ($('mtDoneNote').value || '').trim();
    const cost = ($('mtCost').value || '').trim();
    if (cost && !COST_RE.test(cost)) { sheetError('Cost must be a number.'); return; }
    const input = $('mtPhoto');
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    let photoPath = null;
    if (file) {
      // Cle tiree du fichier d'origine : un reessai reprend la meme cle et le meme chemin.
      const key = t.id + '|' + file.name + '|' + file.size + '|' + file.lastModified;
      if (st.photo && st.photo.key === key) photoPath = st.photo.path;
      else {
        st.busy = true;
        sheetBusy(true);
        // Reduite avant l'envoi (1600 px, JPEG), comme Inspections. Illisible (HEIC
        // non decode) et d'un type refuse par le depot : erreur dans la feuille.
        let small = null;
        try { small = await shrink(file); } catch (e) { small = file; }
        if (!small || (small === file && !PHOTO_TYPES.includes(file.type))) {
          st.busy = false;
          if (owns(t.ref)) { sheetBusy(false); sheetError(BAD_PHOTO); }
          return;
        }
        const sent = small === file ? file
          : new File([small], (file.name.replace(/\.[^.]*$/, '') || 'photo') + '.jpg', { type: 'image/jpeg' });
        let r;
        try {
          r = await photoGestures.run('mnt.photo|' + key, (idem) => upload('mnt.photo', { idem, file: sent, ticketId: String(t.id) }));
        } catch (e) {
          st.busy = false;
          if (owns(t.ref)) sheetBusy(false);
          if (handleAccess(e)) return;
          if (owns(t.ref)) sheetError(e.message); else toast(e.message);
          return;
        }
        st.busy = false;
        if (!r || !r.path) {
          if (owns(t.ref)) { sheetBusy(false); sheetError('The photo was not saved. Try again.'); }
          return;
        }
        st.photo = { key, path: r.path };
        photoPath = r.path;
        if (!owns(t.ref)) return;
        // Boutons rendus avant write() : un refus avant l'envoi (lecture seule) ne laisse pas la feuille bloquee.
        sheetBusy(false);
      }
    }
    const body = tkBody(t, 'ticket.done', { note });
    if (photoPath) body.photoPath = photoPath;
    if (cost) body.cost = cost;
    write(t.ref, body, t.ref + ' done');
  }

  function onTicketClick(k, el, t) {
    const ref = t.ref;
    if (k === 'tk-retry') { openTicket(ref); return; }
    if (k === 'tk-back') { showTicket(); return; }
    if (k === 'tk-start') { write(ref, tkBody(t, 'ticket.start'), ref + ' started'); return; }
    if (k === 'tk-broken') { write(ref, tkBody(t, 'ticket.start'), ref + ' reopened'); return; }
    if (k === 'tk-reopen') { write(ref, tkBody(t, 'ticket.reopen'), ref + ' reopened'); return; }
    if (k === 'tk-done') { tkSub(V.doneSheet(t)); return; }
    if (k === 'tk-waiting') { tkSub(V.waitingSheet(t)); return; }
    if (k === 'tk-comment') { tkSub(V.commentSheet(t)); return; }
    if (k === 'tk-assign') { tkSub(V.assignSheet(t, st.meta)); return; }
    if (k === 'tk-due') { tkSub(V.dueSheet(t, Date.now(), DUE_MAX_DAYS)); return; }
    if (k === 'tk-photo-clear') { const i = $('mtPhoto'); if (i) i.value = ''; photoName(); return; }
    if (k === 'tk-done-send') { sendDone(t); return; }
    if (k === 'tk-wait-send') {
      const note = ($('mtWaitNote').value || '').trim();
      write(ref, tkBody(t, 'ticket.waiting_parts', note ? { note } : null), ref + ' waiting parts');
      return;
    }
    if (k === 'tk-comment-send') {
      const text = ($('mtComment').value || '').trim();
      if (!text) { sheetError('Write a comment first.'); return; }
      write(ref, tkBody(t, 'ticket.comment', { text }), 'Comment added to ' + ref);
      return;
    }
    if (k === 'tk-assign-send') {
      const a = pressed('[data-asg]');
      const v = a ? a.getAttribute('data-asg') : '';
      if (!v) { sheetError('Choose a person or a vendor.'); return; }
      if (v === 'none') { write(ref, tkBody(t, 'ticket.assign', { unassign: true }), 'Nobody follows ' + ref + ' now'); return; }
      const id = Number(v.slice(2));
      const list = v.startsWith('v:') ? (st.meta.vendors || []) : (st.meta.team || []);
      const who = list.find((x) => Number(x.id) === id);
      const extra = v.startsWith('v:') ? { vendorId: id } : { memberId: id };
      write(ref, tkBody(t, 'ticket.assign', extra), ref + ' assigned to ' + (who ? who.name : 'them'));
      return;
    }
    if (k === 'tk-due-send') {
      const d = ($('mtDue').value || '').trim();
      if (!d) { sheetError('Choose a date.'); return; }
      write(ref, tkBody(t, 'ticket.due', { date: d }), ref + ' due ' + d.slice(8, 10) + '/' + d.slice(5, 7));
      return;
    }
    if (k === 'tk-due-clear') write(ref, tkBody(t, 'ticket.due', { date: null }), 'Due date removed from ' + ref);
  }

  // Nom de la photo choisie dans la feuille Mark done, avec Remove.
  function photoName() {
    const i = $('mtPhoto');
    const out = $('mtPhotoName');
    if (!i || !out) return;
    const f = i.files && i.files[0];
    out.innerHTML = f ? V.photoChosenHtml(f.name) : '';
  }

  function onSheetClick(el) {
    const k = el.getAttribute('data-mact');
    const ref = shownRef();
    if (k === 'urg') { press(el, 'data-urg'); return; }
    if (k === 'who') {
      press(el, 'data-who');
      const box = $('mtVendorBox');
      if (box) box.hidden = el.getAttribute('data-who') !== 'vendor';
      return;
    }
    if (k === 'asg') { press(el, 'data-asg'); return; }
    if (k === 'new-send') { sendNew(); return; }
    if (k && k.startsWith('tk-')) {
      if (st.tk && ref === st.tk.ref) onTicketClick(k, el, st.tk);
      else if (k === 'tk-retry' && ref) openTicket(ref);
      return;
    }
    const p = ref ? prpOf(ref, true) : null;
    if (!p) return;
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
    if (el.hasAttribute('data-new')) { showNew(); return; }
    if (el.hasAttribute('data-ticket')) { openTicket(el.getAttribute('data-ticket')); return; }
    const ref = el.getAttribute('data-ref');
    if (el.hasAttribute('data-reopen')) {
      write(null, { op: 'ticket.reopen', ticketId: Number(el.getAttribute('data-id')) }, ref + ' reopened');
      return;
    }
    const p = prpOf(ref, false);
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

  function onChange(e) {
    if (ctx.isCurrent() && e.target && e.target.id === 'mtPhoto') photoName();
  }

  // Retour sur l'app : l'onglet affiche est relu (un autre telephone a pu agir).
  const onVis = () => { if (document.visibilityState === 'visible' && !st.busy && st.view && ctx.isCurrent()) refresh(); };

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('visibilitychange', onVis);
  search.addEventListener('input', onInput);
  ctx.onLeave(() => {
    if (watcher) watcher.disconnect();
    document.removeEventListener('click', onClick);
    document.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onVis);
    search.removeEventListener('input', onInput);
    clearTimeout(st.typing);
  });

  await boot();
  const linked = hq.get('ref');
  if (linked && ctx.isCurrent()) await openLinked(linked.trim().toUpperCase());

  // Lien profond : PRP-n lu par mnt.get, MNT-n vers la fiche ticket.
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
