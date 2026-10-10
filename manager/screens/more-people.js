// More > Ratings and stats : note de proprete (90 jours et depuis toujours), menages et
// temps du mois choisi, avis recents. Lecture seule : mgr.people (?month=YYYY-MM).
// Les chiffres viennent du serveur, rien n'est recalcule ici hormis l'affichage.
import { get } from '/manager/api.js';
import { esc, I } from '/manager/ui/dom.js';

const ROLE_LABEL = { manager: 'Manager', cleaner: 'Cleaner', maintenance: 'Maintenance', subcontractor: 'Subcontractor' };

function header() {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Ratings and stats</h1></div></header>';
}

// 'YYYY-MM' -> 'October 2026' ; decalage de n mois sans fuseau.
function monthLabel(m) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function shiftMonth(m, n) {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7);
}
function dubaiStamp(iso) {
  try {
    const d = new Date(iso);
    // Date et heure separees : le melange change de separateur selon le navigateur.
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai' })
      + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });
  } catch (e) { return ''; }
}
const fmtAvg = (v) => (Math.round(v * 10) / 10).toFixed(1);
const tone = (v) => (v >= 9 ? 'ok' : v >= 7 ? 'warn' : 'bad');
const mins = (v) => v + ' min';

export async function renderPeople(ctx) {
  const main = ctx.main;
  const st = { data: null, month: '', current: '', seq: 0 };

  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden' && e.message === 'email sign-in required') { ctx.emailRequired(); return true; }
    return false;
  }

  const stat = (label, value, cls) => '<div class="pp-stat"><span>' + esc(label) + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + value + '</b></div>';

  function card(p, perf) {
    const r = p.rating;
    const avg = (v, label) => (r && r.enoughData && v !== null && v !== undefined
      ? stat(label, '<span class="pill ' + tone(v) + '">' + fmtAvg(v) + ' / 10</span>')
      : stat(label, '<span class="pp-muted">Not enough data</span>'));
    const timed = perf && perf.timed > 0;
    const reviews = r && r.recent.length
      ? '<details class="pp-recent"><summary>Recent reviews (' + r.recent.length + ')</summary><div class="pp-revs">'
        + r.recent.map((x) => '<div class="pp-rev"><span class="pp-rev-t"><b>' + esc(x.listingName) + '</b>'
          + '<span class="pp-muted">' + esc(x.date) + (x.guest ? ' · ' + esc(x.guest) : '') + '</span></span>'
          + (x.score === null ? '<span class="pp-muted">No score</span>' : '<span class="pill ' + tone(x.score) + '">' + x.score + ' / 10</span>') + '</div>').join('')
        + '</div></details>'
      : '<p class="pp-muted pp-none">No reviews yet.</p>';
    return '<section class="card pp-card" data-person="' + esc(p.id) + '">'
      + '<div class="sec-head"><h2>' + esc(p.name) + '</h2>'
      + (p.role ? '<span class="pill idle">' + esc(ROLE_LABEL[p.role] || p.role) + '</span>' : '') + '</div>'
      + '<div class="pp-stats">'
      + avg(r && r.avg90, 'Cleanliness, last 90 days') + avg(r && r.avgAll, 'Cleanliness, all time')
      + stat('Reviews', r ? String(r.count) : '0')
      + '</div>'
      + '<div class="pp-stats pp-month">'
      + stat('Cleanings in ' + monthLabel(st.data.month), perf ? String(perf.cleanings) : '<span class="pp-muted">Not available</span>')
      + stat('Average time', timed ? mins(perf.avgMinutes) : '<span class="pp-muted">No timer</span>')
      + stat('Fastest', timed ? mins(perf.fastest) : '<span class="pp-muted">No timer</span>')
      + stat('Slowest', timed ? mins(perf.slowest) : '<span class="pp-muted">No timer</span>')
      + '</div>' + reviews + '</section>';
  }

  function paint() {
    if (!ctx.isCurrent() || !st.data) return;
    const d = st.data;
    const ratings = d.ratings || { people: [], computedAt: null, unmatched: 0 };
    const perfBy = new Map((d.performance || []).map((p) => [String(p.id), p]));
    const seen = new Set();
    const people = (ratings.people || []).map((r) => { seen.add(String(r.id)); return { id: r.id, name: r.name, role: r.role, rating: r }; });
    (d.performance || []).forEach((p) => { if (!seen.has(String(p.id))) people.push({ id: p.id, name: p.name, role: p.role, rating: null }); });
    const canNext = st.current && d.month < st.current;
    const fresh = ratings.computedAt
      ? 'Ratings computed ' + esc(dubaiStamp(ratings.computedAt)) + (ratings.unmatched ? ' · ' + ratings.unmatched + ' unmatched reviews' : '')
      : 'Ratings not computed yet';
    main.innerHTML = header() + '<div class="pp-page">'
      + '<div class="pp-nav"><button class="iconbtn" type="button" data-prev aria-label="Previous month">' + I.prev + '</button>'
      + '<span class="pp-month-l" aria-live="polite">' + esc(monthLabel(d.month)) + '</span>'
      + '<button class="iconbtn" type="button" data-next aria-label="Next month"' + (canNext ? '' : ' disabled') + '>' + I.next + '</button></div>'
      + '<p class="pp-fresh">' + fresh + '</p>'
      + (people.length ? people.map((p) => card(p, perfBy.get(String(p.id)))).join('') : '<p class="empty pad">No ratings or cleanings to show.</p>')
      + '</div>';
  }

  function paintError(msg) {
    main.innerHTML = header() + '<div class="err-card"><p role="alert">' + esc(msg) + '</p>'
      + '<button class="btn primary" type="button" data-retry>Retry</button></div>';
  }

  async function load(month) {
    const my = ++st.seq;
    main.innerHTML = header() + '<div class="ph"><p role="status">Loading ratings and stats...</p></div>';
    try {
      const d = await get('mgr.people', month ? { month } : undefined);
      if (!ctx.isCurrent() || my !== st.seq) return;
      st.data = d;
      st.month = d.month;
      // Sans mois demande, le serveur rend le mois courant de Dubai : borne du bouton Next.
      if (!month) st.current = d.month;
      paint();
    } catch (e) {
      if (!ctx.isCurrent() || my !== st.seq || handleAccess(e)) return;
      paintError(e.message || 'Could not load ratings and stats.');
    }
  }

  const onClick = (ev) => {
    if (!ctx.isCurrent()) return;
    const t = ev.target.closest && ev.target.closest('[data-prev],[data-next],[data-retry]');
    if (!t || !main.contains(t)) return;
    if (t.hasAttribute('data-retry')) { load(st.month || ''); return; }
    if (t.disabled || !st.data) return;
    load(shiftMonth(st.data.month, t.hasAttribute('data-prev') ? -1 : 1));
  };
  document.addEventListener('click', onClick);
  ctx.onLeave(() => { document.removeEventListener('click', onClick); st.seq++; });

  await load('');
}
