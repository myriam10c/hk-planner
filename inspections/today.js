import { get, post } from '/inspections/api.js';
import { todayDubai } from '/inspections/fix.js';

const TZ = 'Asia/Dubai';
const hh = (n) => String(n).padStart(2, '0') + ':00';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso) => { const p = String(iso).split('-'); return Number(p[2]) + ' ' + MON[Number(p[1]) - 1]; };
const clock = (iso) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ });
const longDate = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

// Liste relue au retour au premier plan quand elle a plus d'une minute. Ecran ouvert, le jour
// de Dubai est verifie toutes les 30 s (une minuterie calee sur minuit glisse quand l'appareil dort).
const STALE_MS = 60000;
const DAY_CHECK_MS = 30000;
// Gestes qui dependent de la liste du jour (Inspect another apartment n'en depend pas).
const DAY_ACTS = ['claim', 'release', 'assign', 'assign-to', 'start'];

function reason(e) {
  if (!e) return '';
  if (e.kind === 'checkout') {
    let t = 'Checkout' + (e.checkOutTime != null ? ' ' + hh(e.checkOutTime) : '');
    if (e.nextCheckIn && e.nextCheckIn.time != null) t += ' → Check-in ' + hh(e.nextCheckIn.time);
    return t;
  }
  if (e.kind === 'unavailable') return 'Not free today';
  return 'Vacant' + (e.nextArrival ? ' · next arrival ' + dayMonth(e.nextArrival) : '');
}
function last(c) {
  if (c.daysSince == null) return 'Never inspected';
  const d = c.daysSince;
  const ago = d === 0 ? 'today' : d === 1 ? '1 day ago' : d + ' days ago';
  return 'Last inspected ' + ago + (c.lastInspector ? ' by ' + c.lastInspector : '');
}
function dot(c) {
  if (c.daysSince == null || c.daysSince > 45) return 'dot-red';
  return c.daysSince >= 30 ? 'dot-orange' : 'dot-green';
}

export async function renderToday(ctx) {
  const { me, go, toast, render, esc } = ctx;
  const isCurrent = ctx.isCurrent || (() => true);
  let busy = false;
  const isMgr = me.role === 'manager';
  // okAt : heure de la derniere reponse reussie de insp.today. triedOn : jour de Dubai de la
  // derniere lecture tentee (une seule tentative automatique par jour). status : code de l'erreur.
  // assignDay : jour de la liste sur laquelle le logement de « Assign to » a ete choisi.
  const st = { data: null, error: null, status: 0, okAt: 0, triedOn: null, picker: null, assign: null, assignDay: null, cleaners: null, q: '' };
  // Une seule lecture de insp.today a la fois (reading) : un appel pendant une lecture en cours
  // la rejoint. gen compte les reponses de gestes appliquees a la liste : une lecture partie
  // avant l'une d'elles est ecartee (elle ne remplace pas une reponse plus recente).
  let reading = null, gen = 0;
  const view = document.getElementById('view');

  const cardHtml = (c) => {
    const mine = c.claimedBy === me.cleaner_id;
    let actions = '';
    const unavail = !!(c.eligibility && c.eligibility.kind === 'unavailable') && !c.doneToday && !c.inProgressBy;
    if (unavail) {
      // Plus libre : ni prise, ni demarrage, ni assignation ; seul un relachement reste possible.
      if (c.claimedBy != null && !mine) actions += '<span class="state">Taken by ' + esc(c.claimedByName || 'a teammate') + '</span>';
      if (c.claimedBy != null && (mine || isMgr)) actions += '<button class="btn ghost" data-act="release" data-id="' + esc(c.listingId) + '">Release</button>';
    } else if (c.doneToday) actions += '<span class="state">Done by ' + esc(c.doneToday.by) + ' at ' + esc(clock(c.doneToday.at)) + '</span>';
    else if (c.inProgressBy && c.inProgressById != null && c.inProgressById === me.cleaner_id) {
      actions += '<button class="btn primary" data-act="start" data-id="' + esc(c.listingId) + '" data-e="' + esc(c.eligibility && c.eligibility.kind) + '">Resume inspection</button>';
    } else if (c.inProgressBy) actions += '<span class="state">In progress by ' + esc(c.inProgressBy) + '</span>';
    else if (c.claimedBy == null) actions += '<button class="btn primary" data-act="claim" data-id="' + esc(c.listingId) + '">I\'ll take it</button>';
    else if (mine) actions += '<button class="btn primary" data-act="start" data-id="' + esc(c.listingId) + '" data-e="' + esc(c.eligibility && c.eligibility.kind) + '">Start inspection</button>'
      + '<button class="btn ghost" data-act="release" data-id="' + esc(c.listingId) + '">Release</button>';
    else {
      actions += '<span class="state">Taken by ' + esc(c.claimedByName || 'a teammate') + '</span>';
      if (isMgr) actions += '<button class="btn ghost" data-act="release" data-id="' + esc(c.listingId) + '">Release</button>';
    }
    if (isMgr && !c.doneToday && !unavail) actions += '<button class="btn ghost" data-act="assign" data-id="' + esc(c.listingId) + '">Assign</button>';
    return '<article class="card"><div class="card-top"><span class="dot ' + dot(c) + '" aria-hidden="true"></span><h3>' + esc(c.name) + '</h3></div>'
      + '<p class="reason' + (unavail ? ' dim' : '') + '">' + esc(reason(c.eligibility)) + '</p>'
      + '<p class="mute">' + esc(last(c)) + '</p>'
      + '<div class="badges">' + (c.missed > 0 ? '<span class="badge warn">Missed ' + c.missed + '×</span>' : '')
      + (c.openIssue ? '<span class="badge bad">Open issue</span>' : '')
      + (c.focusCount > 0 ? '<span class="badge warn">' + c.focusCount + (c.focusCount > 1 ? ' points' : ' point') + ' to check</span>' : '') + '</div>'
      + '<div class="actions">' + actions + '</div></article>';
  };

  const head = () => '<header class="top"><div><h1>Today\'s inspections</h1><p class="mute">'
    + esc(st.data ? longDate(st.data.day) : '') + '</p></div>'
    + '<div class="top-actions">' + (ctx.embedded ? '' : '<a class="btn ghost" href="/">Back to HK Planner</a>') + '<button class="btn ghost" data-act="fleet">Fleet</button>'
    + (isMgr ? '<button class="btn ghost" data-act="reports">Reports</button>' : '') + '</div></header>';

  const body = () => {
    if (st.picker) {
      const q = st.q.trim().toLowerCase();
      const rows = st.picker.filter((r) => !r.excluded && (!q || String(r.name).toLowerCase().includes(q)));
      return '<main class="wrap"><button class="btn ghost" data-act="back">Back</button><h1>Inspect another apartment</h1>'
        + '<input id="pq" class="search" type="search" placeholder="Search apartments" value="' + esc(st.q) + '" aria-label="Search apartments">'
        + '<ul class="list">' + rows.map((r) => '<li><button class="row" data-act="adhoc" data-id="' + esc(r.listingId) + '">' + esc(r.name) + '</button></li>').join('')
        + (rows.length ? '' : '<li class="mute pad">No apartment found.</li>') + '</ul></main>';
    }
    if (st.assign) {
      return '<main class="wrap"><button class="btn ghost" data-act="back">Back</button><h1>Assign to</h1><ul class="list">'
        + (st.cleaners || []).map((c) => '<li><button class="row" data-act="assign-to" data-cid="' + esc(c.id) + '">' + esc(c.name) + '</button></li>').join('')
        + '</ul></main>';
    }
    let h = '<main class="wrap">' + head();
    if (st.error) {
      h += '<p class="notice bad" role="alert">' + esc(st.error) + '</p>';
      // Refus 403 : relire n'y change rien (lien retour vers HK Planner dans l'en-tete). Lecture
      // en cours : le bouton reste a sa place, desactive, pour qu'un second appui ne tombe pas
      // sur « Inspect another apartment » remonte sous le doigt.
      if (st.status !== 403) {
        h += reading ? '<button class="btn primary" data-act="retry" disabled>Loading…</button>'
          : '<button class="btn primary" data-act="retry">Retry</button>';
      }
    } else if (st.data) {
      const d = st.data;
      if (d.cachedAt) h += '<p class="notice">Bookings data from ' + esc(clock(d.cachedAt)) + '</p>';
      h += '<p class="mute">Target today: ' + esc(d.target) + '</p>';
      h += d.today.length ? d.today.map(cardHtml).join('') : '<p class="mute">Nothing suggested today.</p>';
      if (d.also && d.also.length) {
        h += '<details class="also"><summary>Also possible today (' + d.also.length + ')</summary>' + d.also.map(cardHtml).join('') + '</details>';
      }
    } else h += '<p class="mute">Loading…</p>';
    h += '<button class="btn block" data-act="picker">Inspect another apartment</button></main>';
    return h;
  };

  const paint = () => {
    render(body());
    const pq = document.getElementById('pq');
    if (pq) { pq.focus(); pq.setSelectionRange(pq.value.length, pq.value.length); }
  };
  // Repeinte apres une lecture : rien tant que la recherche ou le choix d'une personne est
  // ouvert (ecran, saisie et focus gardes, liste repeinte au retour). Sur la liste, le bloc
  // « Also possible today » ouvert le reste et le bouton qui avait le focus le retrouve.
  function show() {
    if (!isCurrent() || st.picker || st.assign) return;
    const also = view.querySelector('details.also');
    const open = !!(also && also.open);
    const a = document.activeElement;
    const sel = a && a !== view && view.contains(a) && a.dataset && a.dataset.act
      ? '[data-act="' + a.dataset.act + '"]' + (a.dataset.id ? '[data-id="' + CSS.escape(a.dataset.id) + '"]' : '') : null;
    paint();
    const d = view.querySelector('details.also');
    if (d && open) d.open = true;
    const el = sel && view.querySelector(sel);
    if (el) el.focus();
  }

  const isToday = () => !!st.data && st.data.day === todayDubai();
  function load() {
    if (reading) return reading;
    const g = gen;
    st.triedOn = todayDubai();
    reading = get('insp.today').then((d) => {
      if (g !== gen && st.data) return;
      st.data = d; st.okAt = Date.now(); st.error = null; st.status = 0;
    }, (e) => {
      // Relecture ratee : la liste du jour reste telle quelle ; une liste d'un autre jour de
      // Dubai n'est plus montree, l'erreur et Retry la remplacent.
      if (isToday()) return;
      st.data = null; st.error = e.message || 'Could not load today\'s inspections.'; st.status = e.status || 0;
    }).then(() => { reading = null; show(); });
    // Sans liste : « Loading… » (premier chargement, ou bouton de l'erreur desactive).
    if (!st.data) show();
    return reading;
  }

  function patch(p) {
    if (!p || !st.data) return;
    gen++;
    for (const c of st.data.today.concat(st.data.also || [])) {
      if (c.listingId === p.listingId) { c.claimedBy = p.claimedBy; c.claimedByName = p.claimedByName; }
    }
  }
  // Un seul geste a la fois : un double appui n'envoie qu'une requete. Apres un
  // refus (409 compris), on affiche le message du serveur et on recharge la liste.
  async function act(fn, btn) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try { await fn(); } catch (e) {
      toast(e.message || 'Something went wrong.');
      if (e.kind === 'server') { st.assign = null; await load(); }
    } finally { busy = false; }
    if (isCurrent()) paint();
  }

  view.onclick = (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act, id = b.dataset.id;
    if (a === 'fleet') return go('#/fleet');
    if (a === 'reports') return go('#/reports');
    if (a === 'retry') { load(); return; }
    // « Assign to » ouvert sur la liste d'un autre jour de Dubai (meme relue depuis, l'ecran
    // reste ouvert pendant une relecture) : le logement choisi n'est pas ecrit, l'ecran se
    // ferme sur la liste et Today est relu.
    if (a === 'assign-to' && st.assignDay !== todayDubai()) {
      st.assign = null;
      paint();
      if (!busy) load();
      return;
    }
    // Liste d'un autre jour de Dubai (ou plus de liste) : un geste du jour n'ecrit rien et
    // n'ouvre rien, il relit Today (une lecture deja en cours n'est pas doublee).
    if (DAY_ACTS.includes(a) && !isToday()) { if (!busy) load(); return; }
    if (a === 'start') return go('#/inspect/' + encodeURIComponent(id) + '?e=' + (b.dataset.e || 'adhoc'));
    if (a === 'adhoc') return go('#/inspect/' + encodeURIComponent(id) + '?e=adhoc');
    if (a === 'back') { st.picker = null; st.assign = null; st.q = ''; return paint(); }
    if (a === 'claim') return act(async () => { patch((await post('insp.claim', { listingId: id })).proposal); }, b);
    if (a === 'release') return act(async () => { patch((await post('insp.unclaim', { listingId: id })).proposal || { listingId: id, claimedBy: null, claimedByName: null }); }, b);
    if (a === 'picker') return act(async () => {
      if (!st.overview) st.overview = await get('insp.overview');
      st.picker = st.overview.rows || [];
    }, b);
    if (a === 'assign') {
      // Jour de la liste ou le logement est choisi, retenu a l'appui (avant toute lecture).
      const day = st.data.day;
      return act(async () => {
        if (!st.cleaners) {
          const r = await get('getCleaners');
          st.cleaners = (r.cleaners || []).filter((c) => c.is_active !== false && c.role !== 'subcontractor');
        }
        st.assign = id; st.assignDay = day;
      }, b);
    }
    if (a === 'assign-to') return act(async () => {
      const p = (await post('insp.assign', { listingId: st.assign, cleanerId: Number(b.dataset.cid) })).proposal;
      patch(p); st.assign = null;
    }, b);
  };
  view.oninput = (ev) => { if (ev.target.id === 'pq') { st.q = ev.target.value; paint(); } };

  // Retour au premier plan : Today relu quand la derniere reponse reussie a plus d'une minute
  // ou que la liste n'est pas du jour de Dubai. Jamais pendant un geste.
  const due = () => !st.data || Date.now() - st.okAt > STALE_MS || st.data.day !== todayDubai();
  const onVis = () => {
    if (!isCurrent()) { stop(); return; }
    if (document.visibilityState !== 'visible' || busy) return;
    if (due()) load();
  };
  // Changement de jour de Dubai, ecran ouvert : une seule tentative automatique par jour
  // (en echec sur la liste de la veille, l'erreur garde Retry).
  const dayCheck = setInterval(() => {
    if (!isCurrent()) { stop(); return; }
    if (busy || reading || !st.data) return;
    const day = todayDubai();
    if (st.data.day !== day && st.triedOn !== day) load();
  }, DAY_CHECK_MS);
  function stop() { clearInterval(dayCheck); document.removeEventListener('visibilitychange', onVis); }
  document.addEventListener('visibilitychange', onVis);
  if (ctx.onLeave) ctx.onLeave(stop);

  await load();
}
