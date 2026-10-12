// Ecran Tasks (#/tasks, sous More ; ex Problems, spec 2026-10-09 sections 3 et 4) :
// les taches d'equipe seules depuis la phase 2 maintenance (les tickets vivent dans
// Maintenance). Puces de filtre, recherche, pages de 50, fiche et gestes partages avec Today.
import { get } from '/manager/api.js';
import { clearCache, loadCache, saveCache } from '/manager/today-cache.js';
import { closeSheet, dubaiTime, dubaiToday, esc, openSheet, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { attachSwipe } from '/manager/ui/swipe.js';
import { createProblemPanel } from '/manager/problem-panel.js';
import { apartmentSheet, chipsHtml, listHtml, problemsShell } from '/manager/screens/problems-view.js';

export const PROBLEMS_CACHE = 'mgrProblemsCache';
export const PAGE = 50;
const SEARCH_DELAY_MS = 250;
const NO_FILTER = { urgent: false, mine: false, unassigned: false, listingId: null, q: '' };

export function queryOf(f, offset) {
  const p = { offset: String(offset), limit: String(PAGE) };
  if (f.urgent) p.urgent = '1';
  if (f.mine) p.mine = '1';
  if (f.unassigned) p.unassigned = '1';
  if (f.listingId) p.listingId = f.listingId;
  if (f.q) p.q = f.q;
  return p;
}
export function hasFilter(f) { return !!(f.urgent || f.mine || f.unassigned || f.listingId || f.q); }

export async function renderProblems(ctx) {
  const main = ctx.main;
  // df : filtre qui a produit st.data (le cache n'est ecrit que sans filtre).
  const st = { data: null, rows: [], fresh: false, loading: true, error: null, savedAt: 0, f: { ...NO_FILTER }, df: { ...NO_FILTER }, seq: 0, more: false, typing: null, focusRef: null };
  const cached = loadCache(PROBLEMS_CACHE, (d) => Array.isArray(d.rows) && !!d.counts);
  if (cached && (!ctx.me || (cached.data.me && cached.data.me.id === ctx.me.id))) {
    st.data = cached.data;
    st.rows = cached.data.rows;
    st.savedAt = cached.savedAt;
  }

  // Donnees en cache, en echec, ou d'un autre jour : aucune ecriture possible.
  function readOnly() { return !st.fresh || !st.data || st.data.day !== dubaiToday(Date.now()); }
  function handleAccess(e) {
    if (e.kind === 'auth' || e.kind === 'forbidden') clearCache(PROBLEMS_CACHE);
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }
  const panel = createProblemPanel({ readOnly, onChange: () => refresh(), handleAccess });

  main.innerHTML = problemsShell();
  const $ = (id) => document.getElementById(id);
  const search = $('pSearch');

  function banner() {
    if (!st.data) return '';
    let h = '';
    if (!st.fresh) {
      const when = dubaiTime(new Date(st.savedAt).toISOString());
      const note = st.data.day !== dubaiToday(Date.now()) ? ' Not today\'s data.' : '';
      if (st.error) {
        h += '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message) + esc(note)
          + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
      } else if (st.loading) {
        h += '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.' + esc(note) + '</span></div>';
      }
    }
    if (st.fresh && st.data.bookingsUnavailable) {
      h += '<div class="banner warn" role="status"><span>Bookings are unavailable right now, so today\'s arrivals do not move problems up the list.</span></div>';
    }
    return h;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    const asof = $('pAsof');
    asof.hidden = !st.data;
    asof.textContent = st.data ? 'Data as of ' + dubaiTime(st.data.generatedAt) : '';
    asof.classList.toggle('stale', !!st.data && !st.fresh);
    $('pBanner').innerHTML = banner();
    $('pChips').innerHTML = st.data ? chipsHtml(st.data, st.f) : '';
    $('pList').innerHTML = listHtml(st, hasFilter(st.f));
    restoreFocus();
  }

  // Apres un rendu, le focus revient sur la ligne suivie (celle d'apres un Close),
  // jamais vole a la recherche ni au panneau.
  function restoreFocus() {
    if (!st.focusRef || sheetIsOpen()) return;
    const a = document.activeElement;
    if (a && a !== document.body && !(a.closest && a.closest('#pList'))) return;
    const all = Array.from(document.querySelectorAll('#pList [data-row]'));
    const el = all.find((x) => x.getAttribute('data-ref') === st.focusRef) || all[0];
    if (el) el.focus();
  }

  async function refresh() {
    const mine = ++st.seq;
    st.loading = true;
    st.error = null;
    paint();
    const f = { ...st.f };
    try {
      const d = await get('mgr.problems', queryOf(f, 0));
      if (mine !== st.seq) return;
      st.data = d;
      st.rows = d.rows;
      st.df = f;
      st.fresh = true;
      st.savedAt = Date.now();
      if (!hasFilter(f)) saveCache(PROBLEMS_CACHE, d, st.savedAt);
    } catch (e) {
      if (mine !== st.seq) return;
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
      // Les puces et la recherche reviennent au filtre de la liste affichee.
      st.f = { ...st.df };
      if (document.activeElement !== search) search.value = st.f.q;
    }
    st.loading = false;
    paint();
  }

  async function loadMore() {
    if (st.more || st.loading || !st.fresh || !st.data) return;
    const mine = st.seq;
    st.more = true;
    paint();
    try {
      const d = await get('mgr.problems', queryOf(st.df, st.rows.length));
      if (mine === st.seq) {
        st.rows = st.rows.concat(d.rows);
        st.data = { ...d, rows: st.rows };
      }
    } catch (e) {
      if (!handleAccess(e)) toast(e.message);
    }
    st.more = false;
    paint();
  }

  function rowOf(ref) { return st.rows.find((r) => r.ref === ref) || null; }
  function setFilter(fn) { fn(st.f); refresh(); }

  function onClick(e) {
    const el = e.target && e.target.closest
      ? e.target.closest('[data-chip],[data-apt-open],[data-apt],[data-more],[data-retry],[data-clear],[data-row]') : null;
    if (!el || !ctx.isCurrent()) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (el.hasAttribute('data-more')) { loadMore(); return; }
    if (el.hasAttribute('data-clear')) { search.value = ''; setFilter((f) => Object.assign(f, NO_FILTER)); return; }
    if (el.hasAttribute('data-chip')) {
      const k = el.getAttribute('data-chip');
      if (k === 'urgent' || k === 'mine' || k === 'unassigned') setFilter((f) => { f[k] = !f[k]; });
      return;
    }
    if (el.hasAttribute('data-apt-open')) { if (st.data) openSheet(apartmentSheet(st.data.apartments, st.f.listingId)); return; }
    if (el.hasAttribute('data-apt')) { const v = el.getAttribute('data-apt') || null; closeSheet(); setFilter((f) => { f.listingId = v; }); return; }
    const ref = el.getAttribute('data-ref');
    st.focusRef = ref;
    panel.open(ref, rowOf(ref));
  }

  function onInput() {
    clearTimeout(st.typing);
    st.typing = setTimeout(() => {
      const q = search.value.trim();
      if (q === st.f.q) return;
      st.f.q = q;
      refresh();
    }, SEARCH_DELAY_MS);
  }

  function typing(t) {
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function rowEls() { return Array.from(document.querySelectorAll('#pList [data-row]')); }
  function focusedRow() {
    const a = document.activeElement;
    return a && a.closest ? a.closest('#pList [data-row]') : null;
  }
  function nextRef(ref) {
    const i = st.rows.findIndex((r) => r.ref === ref);
    const n = st.rows[i + 1] || st.rows[i - 1];
    return n ? n.ref : null;
  }
  // Clavier (ordinateur) : j/k et fleches, Entree (bouton natif), A, S, C, /.
  function onKey(e) {
    if (!ctx.isCurrent() || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const k = e.key;
    if (k === '/') {
      if (sheetIsOpen()) return;
      e.preventDefault();
      search.focus();
      return;
    }
    const open = panel.current();
    if (sheetIsOpen() && !open) return;
    const l = k.length === 1 ? k.toLowerCase() : k;
    if (l === 'a' || l === 's' || l === 'c') {
      // Choix Assign ou Schedule ouvert : les raccourcis ne valent que sur la fiche.
      if (open && panel.view() !== 'detail') return;
      const fr = focusedRow();
      const ref = open || (fr && fr.getAttribute('data-ref'));
      if (!ref) return;
      e.preventDefault();
      const row = rowOf(ref);
      if (l === 'a') panel.assign(ref, row);
      else if (l === 's') panel.schedule(ref, row);
      else { st.focusRef = nextRef(ref); panel.close(ref, row); }
      return;
    }
    if (sheetIsOpen()) return;
    if (k === 'ArrowDown' || k === 'j' || k === 'ArrowUp' || k === 'k') {
      const all = rowEls();
      if (!all.length) return;
      e.preventDefault();
      const cur = focusedRow();
      const down = k === 'ArrowDown' || k === 'j';
      const i = cur ? all.indexOf(cur) : -1;
      const next = cur ? all[Math.max(0, Math.min(all.length - 1, i + (down ? 1 : -1)))] : all[0];
      next.focus();
      st.focusRef = next.getAttribute('data-ref');
    }
  }
  // Glisser (telephone, moins de 960 px) : gauche Close, droite Assign.
  const detachSwipe = attachSwipe($('pList'), {
    enabled: () => window.matchMedia('(max-width: 959px)').matches,
    onSwipe: (ref, intent) => {
      const row = rowOf(ref);
      if (!row) return;
      if (intent === 'close') { st.focusRef = nextRef(ref); panel.close(ref, row); } else panel.assign(ref, row);
    },
  });

  // Lien profond : #/tasks?ref=REF. Le hash suit la fiche ouverte par replaceState
  // (pas de hashchange, donc pas de nouveau rendu ni d'entree d'historique en plus).
  function refFromHash() {
    const q = (location.hash.split('?')[1] || '');
    return new URLSearchParams(q).get('ref') || null;
  }
  function syncHash() {
    if (!ctx.isCurrent() || location.hash.split('?')[0] !== '#/tasks') return;
    const ref = panel.current();
    const want = ref ? '#/tasks?ref=' + encodeURIComponent(ref) : '#/tasks';
    if (location.hash !== want) history.replaceState(history.state, '', want);
  }
  const sheetEl = document.getElementById('sheet');
  const watcher = sheetEl ? new MutationObserver(syncHash) : null;
  if (watcher) {
    watcher.observe(sheetEl, { attributes: true, attributeFilter: ['class'] });
    watcher.observe(document.getElementById('sheetInner'), { childList: true });
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  search.addEventListener('input', onInput);
  ctx.onLeave(() => {
    if (watcher) watcher.disconnect();
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    search.removeEventListener('input', onInput);
    clearTimeout(st.typing);
    detachSwipe();
    panel.dispose();
  });
  await refresh();
  const linked = refFromHash();
  if (linked && ctx.isCurrent()) {
    st.focusRef = linked;
    panel.open(linked, rowOf(linked), { onMissing: () => { if (ctx.isCurrent()) toast('This task was not found.'); } });
  }
}
