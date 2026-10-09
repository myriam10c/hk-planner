// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier,
// cache local du dernier Today (spec section 7).
import { get } from '/manager/api.js';
import { loadToday, saveToday } from '/manager/today-cache.js';
import { dubaiTime, esc, openSheet, sheetIsOpen } from '/manager/ui/dom.js';
import { arrivalSheet, boardHtml, jobSheet, problemSheet } from '/manager/screens/today-view.js';

function shellHtml(inner) { return '<header class="top"><div><h1>Today</h1></div></header>' + inner; }

export async function renderToday(ctx) {
  const main = ctx.main;
  const st = { data: null, savedAt: 0, fresh: false, loading: true, error: null };
  const cached = loadToday();
  // Hors ligne au demarrage (ctx.me inconnu) : le cache de l'appareil. Sinon,
  // seulement celui du manager connecte.
  if (cached && (!ctx.me || (cached.data.me && cached.data.me.id === ctx.me.id))) {
    st.data = cached.data;
    st.savedAt = cached.savedAt;
  }

  function banner() {
    let h = '';
    if (st.data && !st.fresh) {
      const when = dubaiTime(new Date(st.savedAt).toISOString());
      if (st.error) {
        h += '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message)
          + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
      } else if (st.loading) {
        h += '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.</span></div>';
      }
    }
    if (st.data && st.data.bookingsCachedAt) {
      h += '<div class="banner warn" role="status"><span>Bookings data from ' + esc(dubaiTime(st.data.bookingsCachedAt))
        + '. Hostaway is not answering, statuses may be late.</span></div>';
    }
    return h;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    if (st.data) { main.innerHTML = boardHtml(st.data, Date.now(), banner(), !st.fresh); return; }
    if (st.loading) { main.innerHTML = shellHtml('<p class="boot" role="status">Loading today…</p>'); return; }
    main.innerHTML = shellHtml('<div class="err-card" role="alert"><p>' + esc(st.error ? st.error.message : 'Could not load.')
      + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>');
  }

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran.
  function handleAccess(e) {
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
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    paint();
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-retry],[data-open]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (!st.data) return;
    const op = el.getAttribute('data-open');
    const now = Date.now();
    if (op === 'job') {
      const j = st.data.who.jobs.find((x) => x.key === el.getAttribute('data-key'));
      if (j) openSheet(jobSheet(st.data, j, now));
    } else if (op === 'arr') {
      const a = st.data.arrivals.rows.find((x) => x.id === el.getAttribute('data-id'));
      if (a) openSheet(arrivalSheet(st.data, a, now));
    } else if (op === 'prob') {
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) openSheet(problemSheet(p));
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

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  });
  await refresh();
}
