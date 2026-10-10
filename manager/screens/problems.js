// Ecran Problems (spec 2026-10-09, sections 3 et 4) : une boite de tri pour les
// tickets (maintenance, inspections, signalements cleaner) et les taches d'equipe.
// Puces de filtre, recherche, pages de 50, fiche et gestes partages avec Today.
import { get } from '/manager/api.js';
import { clearCache, loadCache, saveCache } from '/manager/today-cache.js';
import { announceBadge, closeSheet, dubaiTime, dubaiToday, esc, openSheet, toast } from '/manager/ui/dom.js';
import { createProblemPanel } from '/manager/problem-panel.js';
import { apartmentSheet, chipsHtml, listHtml, problemsShell } from '/manager/screens/problems-view.js';

export const PROBLEMS_CACHE = 'mgrProblemsCache';
export const PAGE = 50;
const SEARCH_DELAY_MS = 250;
const NO_FILTER = { urgent: false, mine: false, unassigned: false, listingId: null, source: null, q: '' };

export function queryOf(f, offset) {
  const p = { offset: String(offset), limit: String(PAGE) };
  if (f.urgent) p.urgent = '1';
  if (f.mine) p.mine = '1';
  if (f.unassigned) p.unassigned = '1';
  if (f.listingId) p.listingId = f.listingId;
  if (f.source) p.source = f.source;
  if (f.q) p.q = f.q;
  return p;
}
export function hasFilter(f) { return !!(f.urgent || f.mine || f.unassigned || f.listingId || f.source || f.q); }

export async function renderProblems(ctx) {
  const main = ctx.main;
  const st = { data: null, rows: [], fresh: false, loading: true, error: null, savedAt: 0, f: { ...NO_FILTER }, seq: 0, more: false, typing: null, focusRef: null };
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
      st.fresh = true;
      st.savedAt = Date.now();
      if (!hasFilter(f)) saveCache(PROBLEMS_CACHE, d, st.savedAt);
      announceBadge(d.counts.urgent);
    } catch (e) {
      if (mine !== st.seq) return;
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    paint();
  }

  async function loadMore() {
    if (st.more || !st.data) return;
    const mine = st.seq;
    st.more = true;
    paint();
    try {
      const d = await get('mgr.problems', queryOf(st.f, st.rows.length));
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
      ? e.target.closest('[data-chip],[data-src],[data-apt-open],[data-apt],[data-more],[data-retry],[data-clear],[data-row]') : null;
    if (!el || !ctx.isCurrent()) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (el.hasAttribute('data-more')) { loadMore(); return; }
    if (el.hasAttribute('data-clear')) { search.value = ''; setFilter((f) => Object.assign(f, NO_FILTER)); return; }
    if (el.hasAttribute('data-chip')) {
      const k = el.getAttribute('data-chip');
      if (k === 'urgent' || k === 'mine' || k === 'unassigned') setFilter((f) => { f[k] = !f[k]; });
      return;
    }
    if (el.hasAttribute('data-src')) { const v = el.getAttribute('data-src') || null; setFilter((f) => { f.source = v; }); return; }
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

  document.addEventListener('click', onClick);
  search.addEventListener('input', onInput);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    search.removeEventListener('input', onInput);
    clearTimeout(st.typing);
    panel.dispose();
  });
  await refresh();
}
