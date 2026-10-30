// More > Where is everyone (plan 2026-10-29, tache 3) : derniere position connue
// de chaque personne, sur une carte Leaflet (vendored dans /vendor/leaflet/, la CSP
// refuse les feuilles de style externes) avec les tuiles OSM, puis la liste.
// Lecture : mgr.locations ; une seule ecriture, la relance « Ask them to turn it on »
// (mgr.locationNudge, notification aux personnes sans position recente). Rafraichi toutes les 60 s tant que l'ecran est
// affiche et la page visible ; tout s'arrete en quittant l'ecran.
import { get, post } from '/manager/api.js';
import { dubaiTime, esc, I } from '/manager/ui/dom.js';
import { ageText, FRESH_MAP_MIN, ageMin, initialsOf, isStale, nudgeText, offText, placeText } from '/manager/ui/location-text.js';

const REFRESH_MS = 60000;
const ROLE = { cleaner: 'Cleaner', manager: 'Manager', maintenance: 'Maintenance' };
// Sans position fraiche : entre Dubai Marina et Downtown.
const DEFAULT_VIEW = { center: [25.14, 55.21], zoom: 12 };
const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

// Couleur de la personne (Team) seulement si c'est un hex : elle part dans un style.
function colorOf(p) { return /^#[0-9a-f]{3,8}$/i.test(String(p.color || '')) ? p.color : ''; }

// Leaflet charge une seule fois par page : feuille de style puis script classique.
let leafletLoad = null;
function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletLoad) return leafletLoad;
  leafletLoad = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/vendor/leaflet/leaflet.css';
      css.setAttribute('data-leaflet', '');
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = '/vendor/leaflet/leaflet.js';
    s.onload = () => (window.L && window.L.map ? resolve(window.L) : reject(new Error('Leaflet missing')));
    s.onerror = () => reject(new Error('Leaflet not loaded'));
    document.head.appendChild(s);
  }).catch((e) => { leafletLoad = null; throw e; });
  return leafletLoad;
}

function header(updated) {
  return '<header class="top"><div><a class="more-back" href="#/more">' + I.prev + '<span>More</span></a>'
    + '<h1>Where is everyone</h1><div class="date" data-loc-updated>' + esc(updated) + '</div></div>'
    + '<button class="btn loc-refresh" type="button" data-loc-refresh>Refresh</button></header>';
}

function pinHtml(p, stale) {
  const c = colorOf(p);
  return '<span class="loc-pin' + (stale ? ' stale' : '') + '"' + (c ? ' style="background:' + c + '"' : '') + '>' + esc(initialsOf(p.name)) + '</span>';
}

function popupHtml(p, nowMs) {
  const loc = p.location;
  return '<b>' + esc(p.name) + '</b>' + (placeText(loc.place) ? '<br>' + esc(placeText(loc.place)) : '')
    + '<br><span class="loc-pop-age">' + esc(ageText(loc, nowMs)) + '</span>';
}

function rowHtml(p, nowMs) {
  const loc = p.location;
  const role = ROLE[p.role] || p.role || '';
  const dot = '<span class="loc-av" aria-hidden="true"' + (colorOf(p) ? ' style="background:' + colorOf(p) + '"' : '') + '>' + esc(initialsOf(p.name)) + '</span>';
  const name = '<span class="loc-nm">' + esc(p.name) + '<span class="loc-rl">' + esc(role) + '</span></span>';
  if (!loc) {
    // Coupe par la personne (bouton Location OFF) : l'heure de la coupure.
    const off = p.offAt ? offText(p.offAt, nowMs) : '';
    return '<li><div class="loc-row none' + (off ? ' off' : '') + '">' + dot + '<span class="loc-txt">' + name
      + '<span class="loc-where">' + esc(off || 'No location yet') + '</span></span></div></li>';
  }
  const where = placeText(loc.place);
  return '<li><button class="loc-row' + (isStale(loc, nowMs) ? ' stale' : '') + '" type="button" data-loc-id="' + esc(p.id) + '">' + dot
    + '<span class="loc-txt">' + name + (where ? '<span class="loc-where">' + esc(where) + '</span>' : '')
    + '</span><span class="loc-age">' + esc(ageText(loc, nowMs)) + '</span></button></li>';
}

export async function renderLocations(ctx) {
  const main = ctx.main;
  const st = { data: null, err: '', loading: false, fitted: false, nudging: false };
  let map = null;
  let layer = null;
  let markers = {};
  let timer = null;
  const $ = (sel) => main.querySelector(sel);

  function handleAccess(e) {
    if (e && e.kind === 'auth') { location.replace('/'); return true; }
    if (e && e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  function updatedLine() {
    if (!st.data) return '';
    return st.data.generatedAt ? 'Updated ' + dubaiTime(st.data.generatedAt) : '';
  }

  function paintShell() {
    main.innerHTML = header('') + '<div class="loc">'
      + '<section class="card loc-card"><div class="loc-map" data-loc-map role="region" aria-label="Map of the team"></div>'
      + '<p class="empty pad loc-map-err" data-loc-map-err hidden>The map could not load. The list below is up to date.</p></section>'
      // Relance par notification (mgr.locationNudge) : managers seulement.
      + (ctx.role === 'manager'
        ? '<section class="card loc-nudge" aria-label="Ask the team"><button class="btn primary loc-nudge-btn" type="button" data-loc-nudge>'
          + 'Ask them to turn it on</button><p class="loc-nudge-res" data-loc-nudge-res role="status"></p></section>'
        : '')
      + '<section class="card" aria-labelledby="h-loc"><div class="sec-head"><h2 id="h-loc">Team</h2></div>'
      + '<div data-loc-list><p class="empty pad" role="status">Loading positions…</p></div></section></div>';
  }

  function paintList() {
    const box = $('[data-loc-list]');
    if (!box) return;
    const up = $('[data-loc-updated]');
    if (up) up.textContent = updatedLine();
    if (!st.data) {
      if (st.err) {
        box.innerHTML = '<div class="wpad"><div class="err-card" role="alert"><p>' + esc(st.err) + '</p>'
          + '<button class="btn primary" type="button" data-retry>Retry</button></div></div>';
      }
      return;
    }
    const now = Date.now();
    const people = st.data.people || [];
    let h = st.err ? '<div class="wpad"><div class="banner warn" role="status"><span>' + esc(st.err) + '</span></div></div>' : '';
    h += people.length ? '<ul class="loc-list">' + people.map((p) => rowHtml(p, now)).join('') + '</ul>'
      : '<p class="empty pad">Nobody in the team yet.</p>';
    box.innerHTML = h;
  }

  function paintMarkers() {
    if (!map || !st.data) return;
    const L = window.L;
    const now = Date.now();
    layer.clearLayers();
    markers = {};
    const fresh = [];
    for (const p of st.data.people || []) {
      const loc = p.location;
      if (!loc || !isFinite(loc.lat) || !isFinite(loc.lng)) continue;
      const stale = isStale(loc, now);
      const icon = L.divIcon({ className: 'loc-icon', html: pinHtml(p, stale), iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] });
      const m = L.marker([loc.lat, loc.lng], { icon, title: p.name, keyboard: true, zIndexOffset: stale ? 0 : 500 });
      m.bindPopup(popupHtml(p, now));
      m.addTo(layer);
      markers[p.id] = m;
      if (ageMin(loc, now) <= FRESH_MAP_MIN) fresh.push([loc.lat, loc.lng]);
    }
    // Cadrage au premier chargement seulement : un rafraichissement ne deplace pas la carte.
    if (st.fitted) return;
    st.fitted = true;
    if (fresh.length === 1) map.setView(fresh[0], 15);
    else if (fresh.length > 1) map.fitBounds(fresh, { padding: [36, 36], maxZoom: 15 });
  }

  async function initMap() {
    let L = null;
    try { L = await loadLeaflet(); } catch (e) { L = null; }
    if (!ctx.isCurrent()) return;
    const el = $('[data-loc-map]');
    if (!L || !el) {
      if (el) el.hidden = true;
      const err = $('[data-loc-map-err]');
      if (err) err.hidden = false;
      return;
    }
    map = L.map(el, { zoomControl: true, attributionControl: true }).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    layer = L.layerGroup().addTo(map);
    paintMarkers();
  }

  async function load() {
    if (st.loading) return;
    st.loading = true;
    const btn = $('[data-loc-refresh]');
    if (btn) btn.disabled = true;
    try {
      const d = await get('mgr.locations');
      if (!ctx.isCurrent()) return;
      st.data = d;
      st.err = '';
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      // Donnees deja affichees : gardees, le message passe en bandeau.
      st.err = (e && e.message) || 'Could not load the positions.';
    } finally {
      st.loading = false;
      const b = $('[data-loc-refresh]');
      if (b) b.disabled = false;
    }
    if (!ctx.isCurrent()) return;
    paintList();
    paintMarkers();
  }

  function focusPerson(id) {
    const p = st.data && (st.data.people || []).find((x) => String(x.id) === String(id));
    if (!p || !p.location || !map) return;
    map.setView([p.location.lat, p.location.lng], Math.max(map.getZoom(), 16));
    const m = markers[p.id];
    if (m) m.openPopup();
    const el = $('[data-loc-map]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Une relance a la fois ; le resultat reste affiche jusqu'a la suivante.
  async function nudge(btn) {
    if (st.nudging) return;
    st.nudging = true;
    btn.disabled = true;
    const res = $('[data-loc-nudge-res]');
    if (res) { res.className = 'loc-nudge-res'; res.textContent = 'Sending…'; }
    let text = '', bad = false;
    try {
      text = nudgeText(await post('mgr.locationNudge', {}));
    } catch (e) {
      if (!ctx.isCurrent() || handleAccess(e)) return;
      text = (e && e.message) || 'Could not send. Try again.';
      bad = true;
    } finally {
      st.nudging = false;
      const b = $('[data-loc-nudge]');
      if (b) b.disabled = false;
    }
    if (!ctx.isCurrent()) return;
    const r = $('[data-loc-nudge-res]');
    if (r) { r.className = 'loc-nudge-res' + (bad ? ' bad' : ''); r.textContent = text; }
  }

  const onClick = (e) => {
    if (!ctx.isCurrent()) return;
    const t = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-loc-nudge')) { nudge(t); return; }
    if (t.hasAttribute('data-loc-refresh') || t.hasAttribute('data-retry')) { load(); return; }
    if (t.hasAttribute('data-loc-id')) focusPerson(t.getAttribute('data-loc-id'));
  };
  // Page cachee : aucun appel ; retour sur la page : relecture tout de suite.
  const onVis = () => {
    if (document.visibilityState === 'visible' && ctx.isCurrent()) load();
  };
  main.addEventListener('click', onClick);
  document.addEventListener('visibilitychange', onVis);
  timer = setInterval(() => {
    if (!ctx.isCurrent() || document.visibilityState === 'hidden') return;
    load();
  }, REFRESH_MS);
  ctx.onLeave(() => {
    clearInterval(timer);
    main.removeEventListener('click', onClick);
    document.removeEventListener('visibilitychange', onVis);
    if (map) { try { map.remove(); } catch (e) { /* deja retiree */ } }
    map = null;
  });

  paintShell();
  await Promise.all([initMap(), load()]);
}
