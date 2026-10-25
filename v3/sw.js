// Service worker de l'application cleaner v3. Portee /v3/ : il ne touche a rien
// de l'app actuelle, qui garde son propre service worker a la racine. Deux
// enregistrements coexistent, le navigateur donne la page au plus specifique.
//
// Strategie :
//  - navigations, coquille, modules .js, styles .css et client supabase-js :
//    reseau d'abord, cache en repli. Un deploiement est pris des le premier
//    chargement et les modules restent de la meme version : avant, app.js venait
//    du reseau et les autres modules de l'ancien cache, le nouvel app.js
//    importait des exports absents et l'app restait blanche (revue finale,
//    maintenance phase 3). Hors ligne, le cache sert toujours toute l'app ;
//  - polices, licences, manifeste : cache d'abord puis revalidation ;
//  - appels au proxy : jamais caches, la file hors ligne s'en charge.
//
// Aucun abonnement push ici, et donc aucun handler `push` : la cleaner recoit
// deja ses notifications par l'app actuelle (service worker de la racine). Un
// second abonnement lui en ferait deux pour chaque affectation (spec, phase A).
const VERSION = 'v-20261023-2333-bbe60f5';
const CACHE = 'hk-v3-' + VERSION;
// Tout ce que /v3/ sert : la coquille, les modules, l'ecran Profile, les
// modules de la conversation (/v3/conv/), les trois feuilles de style, les trois
// polices auto-hebergees et leurs licences
// (l'OFL demande que la licence voyage avec la police). Plus le client de
// session supabase-js charge par index.html, seul fichier hors de /v3/ : le
// gestionnaire fetch le sert aussi. Aucun commentaire DANS la liste, le test
// tests/v3/sw.spec.ts la decoupe sur les virgules.
const PRECACHE = [
  '/v3/',
  '/v3/index.html',
  '/v3/app.js',
  '/v3/boot.js',
  '/v3/api.js',
  '/v3/offline.js',
  '/v3/ui.js',
  '/v3/practice.js',
  '/v3/proxy-config.js',
  '/v3/session.js',
  '/v3/screens/profile.js',
  '/v3/conv/camera.js',
  '/v3/conv/conversation.js',
  '/v3/conv/day.js',
  '/v3/conv/persist.js',
  '/v3/conv/problems.js',
  '/v3/conv/report.js',
  '/v3/conv/rules.js',
  '/v3/conv/share.js',
  '/v3/conv/stamp.js',
  '/v3/conv/sync.js',
  '/v3/conv/ui.js',
  '/v3/styles/tokens.css',
  '/v3/styles/cleaner.css',
  '/v3/conv.css',
  '/v3/fonts/atkinson-hyperlegible-next-latin.woff2',
  '/v3/fonts/bricolage-grotesque-latin.woff2',
  '/v3/fonts/instrument-sans-latin.woff2',
  '/v3/fonts/OFL-AtkinsonHyperlegibleNext.txt',
  '/v3/fonts/OFL-BricolageGrotesque.txt',
  '/v3/fonts/OFL-InstrumentSans.txt',
  '/v3/manifest.webmanifest',
  '/vendor/supabase-js-2.116.0.umd.js',
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
  // Seul fichier hors de /v3/ que la v3 charge : sans lui hors ligne, la v3
  // demarrerait sans client de session.
  const vendor = url.pathname === '/vendor/supabase-js-2.116.0.umd.js';
  if (url.pathname.indexOf('/v3/') !== 0 && !vendor) return;

  const p = url.pathname;
  if (req.mode === 'navigate' || vendor || p === '/v3/' || p === '/v3/index.html' ||
      /\.(js|css)$/.test(p)) {
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
