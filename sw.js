// HK Planner Service Worker — stale-while-revalidate for static assets.
// Strategy:
//  - First visit: full network, populates cache as side effect.
//  - Subsequent visits: instant render from cache, background revalidate.
//  - API calls (Supabase functions, Hostaway, etc.) bypass the cache entirely.
//  - Bump VERSION to force all clients to drop the old cache.

const VERSION = 'v14-2026-06-08-invoice-english-final';
const CACHE = 'hk-planner-' + VERSION;
const PRECACHE = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json'];

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Bypass dynamic API calls
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('hostaway.com')) return;
  if (url.hostname.includes('green-api.com')) return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Only handle same-origin GETs (stale-while-revalidate). Cross-origin requests
  // (cdnjs libs, Google Fonts) are left to the browser: intercepting opaque
  // no-cors script responses here made them fail with net::ERR_FAILED, which
  // silently broke jsPDF/xlsx/Chart/QRCode (invoice + exports) for returning users.
  if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req));
  }
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const networkPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || networkPromise;
}
