// Service worker de l'application cleaner v3. Portee /v3/ : il ne touche a rien
// de l'app actuelle, qui garde son propre service worker a la racine. Deux
// enregistrements coexistent, le navigateur donne la page au plus specifique.
//
// Strategie :
//  - navigations et coquille : reseau d'abord, cache en repli, pour qu'un
//    deploiement soit pris tout de suite ;
//  - modules, styles, polices : cache d'abord puis revalidation, pour que l'app
//    ouvre instantanement et marche sans reseau dans un appartement ;
//  - appels au proxy : jamais caches, la file hors ligne s'en charge.
//
// Aucun abonnement push ici, et donc aucun handler `push` : la cleaner recoit
// deja ses notifications par l'app actuelle (service worker de la racine). Un
// second abonnement lui en ferait deux pour chaque affectation (spec, phase A).
const VERSION = 'v3-dev';
const CACHE = 'hk-v3-' + VERSION;
// Tout ce que /v3/ sert : la coquille, les six modules, les cinq ecrans, les
// deux feuilles de style, les deux polices auto-hebergees et leurs licences
// (l'OFL demande que la licence voyage avec la police).
const PRECACHE = [
  '/v3/',
  '/v3/index.html',
  '/v3/app.js',
  '/v3/api.js',
  '/v3/offline.js',
  '/v3/ui.js',
  '/v3/photo.js',
  '/v3/proxy-config.js',
  '/v3/screens/today.js',
  '/v3/screens/job.js',
  '/v3/screens/finish.js',
  '/v3/screens/report.js',
  '/v3/screens/profile.js',
  '/v3/styles/tokens.css',
  '/v3/styles/cleaner.css',
  '/v3/fonts/bricolage-grotesque-latin.woff2',
  '/v3/fonts/instrument-sans-latin.woff2',
  '/v3/fonts/OFL-BricolageGrotesque.txt',
  '/v3/fonts/OFL-InstrumentSans.txt',
  '/v3/manifest.webmanifest',
];

// Un fichier apres l'autre, jamais cache.addAll : addAll est tout ou rien, un
// seul 404 (un fichier renomme, une licence retiree) laisserait la cleaner sans
// aucune coquille hors ligne au lieu d'un fichier en moins.
async function precache() {
  const cache = await caches.open(CACHE);
  const echecs = [];
  await Promise.all(PRECACHE.map(function (chemin) {
    return cache.add(chemin).catch(function () { echecs.push(chemin); });
  }));
  if (echecs.length) console.warn('[sw v3] precache incomplet', echecs);
}

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(precache().catch((err) => {
    console.warn('[sw v3] precache failed (non-fatal)', err);
  }));
});

self.addEventListener('activate', (e) => {
  // Seuls les caches « hk-v3- » sont nettoyes : « hk-planner-* » appartient au
  // service worker de la racine, et les caches sont partages par origine.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf('hk-v3-') === 0 && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Le proxy et Hostaway ne passent jamais par le cache : une reponse perimee
  // ferait travailler une cleaner sur la journee de la veille.
  if (url.hostname.indexOf('supabase.co') !== -1) return;
  if (url.hostname.indexOf('hostaway.com') !== -1) return;
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/v3/') !== 0) return;

  if (req.mode === 'navigate' || url.pathname === '/v3/app.js' || url.pathname === '/v3/index.html') {
    e.respondWith(networkFirst(req));
  } else {
    e.respondWith(staleWhileRevalidate(req));
  }
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
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const reseau = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  }).catch(() => cached);
  return cached || reseau;
}
