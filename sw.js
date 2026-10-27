// HK Planner Service Worker.
// Strategy:
//  - Navigations + core app shell (/app.js, /styles.css): network-first with
//    cache fallback, so returning users always get the latest deploy.
//  - Other same-origin static assets: stale-while-revalidate.
//  - API calls (Supabase functions, Hostaway, etc.) bypass the cache entirely.
//  - Bump VERSION to force all clients to drop the old cache.

const VERSION = 'v-20261027-1713-bcbf15b';
const CACHE = 'hk-planner-' + VERSION;
// /vendor/supabase-js-*.umd.js est une dependance dure : app.js appelle
// createClient() en tete de fichier, si le vendor manque toute l'app est morte.
const PRECACHE = ['/', '/index.html', '/hr.js', '/app.js', '/styles.css', '/auth.css', '/vendor/supabase-js-2.116.0.umd.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch((err) => {
      console.warn('[sw] precache failed (non-fatal)', err);
    })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // Seuls les caches de cette app sont nettoyes. Les caches sont partages
      // par origine : sans ce prefixe, chaque activation (donc chaque
      // deploiement) effacerait aussi le cache de l'app cleaner, qui a son
      // propre service worker sous /v3/, et sa coquille hors ligne avec.
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('hk-planner-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // La v3 a son propre service worker (/v3/sw.js). Sans cette sortie, celui de
  // la racine mettrait en cache les modules de la v3 avant que le sien ne
  // prenne la main, et servirait une version perimee apres un deploiement.
  if (url.pathname.indexOf('/v3/') === 0) return;
  // /manager/ (nouvelle app manager) : aucun service worker en phase 1. Reseau
  // seul, avec les en-tetes no-cache de _headers : jamais de module perime.
  if (url.pathname.indexOf('/manager/') === 0) return;
  // Bypass dynamic API calls
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('hostaway.com')) return;
  if (url.hostname.includes('green-api.com')) return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Only handle same-origin GETs. Cross-origin requests
  // (cdnjs libs, Google Fonts) are left to the browser: intercepting opaque
  // no-cors script responses here made them fail with net::ERR_FAILED, which
  // silently broke jsPDF/xlsx/Chart (invoice + exports) for returning users.
  if (url.origin === location.origin) {
    // Navigations + core app shell: network-first so a fresh deploy is picked up
    // immediately; cached copy is only a fallback when offline.
    // security-contacts.json too: the VPS job republishes it as soon as the
    // Drive sheet changes (business/scheduled/hk_security_contacts.py).
    if (req.mode === 'navigate' || url.pathname === '/app.js' || url.pathname === '/hr.js' || url.pathname === '/styles.css' || url.pathname === '/security-contacts.json') {
      e.respondWith(networkFirst(req));
    } else {
      e.respondWith(staleWhileRevalidate(req));
    }
  }
});

// ===== Web Push =====
// Expected payload (built by the edge function): {title, body, url, tag}, plus
// optional {urgent, icon, ack: {url, id, token, secret}} for reminders.
// The subscription uses userVisibleOnly = true, so we MUST show a notification.
self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { body: e.data ? e.data.text() : '' };
  }
  const title = data.title || 'HK Planner';
  const notifData = { url: data.url || '/' };
  if (data.ack) notifData.ack = data.ack;
  let options;
  if (data.urgent) {
    // Title is kept as sent: the server already prefixes "URGENT ...".
    options = {
      body: data.body || '',
      icon: data.icon || '/icons/alert-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || 'hk-planner-urgent',
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 200, 500, 200, 800],
      silent: false,
      data: notifData,
    };
  } else {
    options = {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag || 'hk-planner',
      renotify: true,
      data: notifData,
    };
  }
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const nd = e.notification.data || {};
  const target = nd.url || '/';
  const ack = nd.ack;
  // Ack the reminder in parallel: a failure must never block the navigation.
  const ackPromise = (async () => {
    if (!ack || !ack.url) return;
    try {
      await fetch(ack.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Secret': ack.secret || '' },
        body: JSON.stringify({ id: ack.id, token: ack.token }),
      });
    } catch (err) { /* offline or server error: the reminder will simply come back */ }
  })();
  const navPromise = (async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        try { await client.focus(); } catch (err) { /* focus refused, the fallback below still opens the target */ }
        // navigate() throws or resolves to null when this worker does not control the
        // tab (e.g. a /v3/ tab): open the target in a new window instead.
        let navigated = null;
        if ('navigate' in client) {
          try { navigated = await client.navigate(target); } catch (err) { navigated = null; }
        }
        if (!navigated) await self.clients.openWindow(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })();
  e.waitUntil(Promise.all([ackPromise, navPromise]));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Navigation hors ligne avec une query (/?legacy=1 des liens de secours de la
    // bascule v3) : la coquille est une seule page, on sert celle en cache.
    if (req.mode === 'navigate') {
      const shell = (await cache.match(req, { ignoreSearch: true })) || (await cache.match('/'));
      if (shell) return shell;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || networkPromise;
}
