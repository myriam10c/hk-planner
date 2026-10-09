// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier.
import { get } from '/manager/api.js';
import { esc, openSheet, sheetIsOpen } from '/manager/ui/dom.js';
import { arrivalSheet, boardHtml, jobSheet, problemSheet } from '/manager/screens/today-view.js';

function shellHtml(inner) { return '<header class="top"><div><h1>Today</h1></div></header>' + inner; }

export async function renderToday(ctx) {
  const main = ctx.main;
  const st = { data: null, loading: true, error: null };

  function paint() {
    if (!ctx.isCurrent()) return;
    if (st.data) {
      const banner = st.error
        ? '<div class="banner warn" role="status"><span>Could not refresh. ' + esc(st.error.message) + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>'
        : '';
      main.innerHTML = boardHtml(st.data, Date.now(), banner, !!st.error);
      return;
    }
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
      st.data = await get('mgr.today');
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
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
