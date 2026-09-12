import { expect, test } from '@playwright/test';
import { bootV3, fetchLog } from './helpers';

// `use.serviceWorkers: 'block'` est pose au niveau racine de playwright.config.ts,
// avec un commentaire qui dit pourquoi : sans ce blocage, la fermeture du contexte
// pend au-dela du delai du test. Les projets v3 en heritent et ne le surchargent
// pas : aucun service worker ne s'enregistre pendant la suite. Ces tests verifient
// donc le contenu servi, jamais l'installation. L'installation reelle, le
// controleur de la page et la cohabitation avec le service worker de la racine
// sont verifies a la main (rapport de la tache 13) puis en production (tache 14).
test('le service worker v3 precache la coquille, les modules et les polices', async ({ page }) => {
  const r = await page.request.get('/v3/sw.js');
  expect(r.status()).toBe(200);
  const source = await r.text();
  for (const chemin of [
    '/v3/', '/v3/index.html', '/v3/app.js', '/v3/api.js', '/v3/offline.js', '/v3/ui.js',
    '/v3/photo.js',
    '/v3/screens/today.js', '/v3/screens/job.js', '/v3/screens/finish.js',
    '/v3/screens/report.js', '/v3/screens/profile.js',
    '/v3/styles/tokens.css', '/v3/styles/cleaner.css',
    '/v3/fonts/bricolage-grotesque-latin.woff2', '/v3/fonts/instrument-sans-latin.woff2',
    '/v3/fonts/OFL-BricolageGrotesque.txt', '/v3/fonts/OFL-InstrumentSans.txt',
    '/v3/manifest.webmanifest', '/v3/proxy-config.js',
  ]) {
    expect(source).toContain("'" + chemin + "'");
  }
  // Les appels au proxy ne passent jamais par le cache.
  expect(source).toContain('supabase.co');
  // Aucun abonnement push cote v3 (spec, phase A) : la cleaner recoit deja ses
  // notifications par l'app actuelle. Un handler `push` ici voudrait dire qu'un
  // second abonnement existe, donc deux notifications par affectation.
  expect(source).not.toContain("addEventListener('push'");
});

test('chaque fichier precache est vraiment servi', async ({ page }) => {
  const source = await (await page.request.get('/v3/sw.js')).text();
  const liste = source.match(/const PRECACHE = \[([^\]]+)\]/);
  expect(liste).not.toBeNull();
  const chemins = liste![1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  expect(chemins.length).toBeGreaterThanOrEqual(17);
  for (const c of chemins) {
    const rep = await page.request.get(c);
    expect(rep.status(), c + ' doit etre servi').toBe(200);
  }
});

test('le service worker de la racine laisse passer /v3/ et ne vide pas son cache', async ({ page }) => {
  const source = await (await page.request.get('/sw.js')).text();
  // Sans cette ligne, le cache de l'app actuelle servirait des modules v3 perimes
  // tant que /v3/sw.js n'a pas pris la main.
  expect(source).toContain("url.pathname.indexOf('/v3/') === 0");
  // Les caches sont partages par origine : le menage de la racine ne doit
  // emporter que les siens, sinon chaque activation (donc chaque deploiement,
  // et chaque ouverture de l'app actuelle apres) effacerait la coquille hors
  // ligne de la v3 sans un mot.
  expect(source).toContain("k.indexOf('hk-planner-') === 0");
  // Et rien d'autre de la v3 n'y entre.
  expect(source).not.toContain('hk-v3-');
});

// Cohabitation des deux enregistrements. Sur une page de /v3/, le navigateur rend
// a `navigator.serviceWorker.ready` l'enregistrement le plus specifique, celui de
// /v3/, qui ne porte AUCUN abonnement push (phase A). Le desabonnement de la
// deconnexion (tache 12) devenait donc silencieusement inutile, et le telephone
// continuait de recevoir les taches de la cleaner precedente. On parcourt les
// enregistrements et on desabonne celui qui porte l'abonnement, la racine.
test('la deconnexion desabonne le push porte par l enregistrement de la racine', async ({ page }) => {
  await page.addInitScript(() => {
    const racine = {
      scope: location.origin + '/',
      pushManager: {
        getSubscription: () => Promise.resolve({
          toJSON: () => ({ endpoint: 'https://push.example/racine' }),
          unsubscribe: () => {
            try { localStorage.setItem('v3TestUnsub', 'https://push.example/racine'); } catch (e) { /* vu par le test */ }
            return Promise.resolve(true);
          },
        }),
      },
    };
    const v3 = {
      scope: location.origin + '/v3/',
      pushManager: { getSubscription: () => Promise.resolve(null) },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: () => Promise.resolve(v3),
        ready: Promise.resolve(v3),
        getRegistration: () => Promise.resolve(v3),
        getRegistrations: () => Promise.resolve([racine, v3]),
        addEventListener: () => {},
      },
    });
  });
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: { status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' }, linenRequired: true, totalMinutes: 0, stops: [] } },
    { match: 'action=deletePushSubscription', status: 200, body: { status: 'success' } },
    { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
  ], { pinToken: 'jeton-pin', hash: '#/profile' });
  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  const appels = (await fetchLog(page)).filter((l) => l.url.indexOf('action=deletePushSubscription') !== -1);
  expect(appels.length).toBe(1);
  expect(appels[0].body).toContain('https://push.example/racine');
  expect(await page.evaluate(() => localStorage.getItem('v3TestUnsub'))).toBe('https://push.example/racine');
});

// Repli quand `getRegistrations` manque. Aucun moteur en circulation n'expose
// `serviceWorker` sans cette methode, mais la garde d'entree la rendait
// obligatoire : sur un tel moteur la deconnexion sautait la revocation en
// silence, et un telephone qui change de main continuait de recevoir les taches
// de la cleaner precedente. `ready` suffit a retrouver l'abonnement.
test('la deconnexion desabonne aussi quand getRegistrations n existe pas', async ({ page }) => {
  await page.addInitScript(() => {
    const seul = {
      scope: location.origin + '/',
      pushManager: {
        getSubscription: () => Promise.resolve({
          toJSON: () => ({ endpoint: 'https://push.example/sans-getregistrations' }),
          unsubscribe: () => {
            try {
              localStorage.setItem('v3TestUnsub', 'https://push.example/sans-getregistrations');
            } catch (e) { /* vu par le test */ }
            return Promise.resolve(true);
          },
        }),
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: () => Promise.resolve(seul),
        ready: Promise.resolve(seul),
        getRegistration: () => Promise.resolve(seul),
        // Pas de getRegistrations : c'est tout l'objet du test.
        addEventListener: () => {},
      },
    });
  });
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: { status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' }, linenRequired: true, totalMinutes: 0, stops: [] } },
    { match: 'action=deletePushSubscription', status: 200, body: { status: 'success' } },
    { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
  ], { pinToken: 'jeton-pin', hash: '#/profile' });
  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  const appels = (await fetchLog(page)).filter((l) => l.url.indexOf('action=deletePushSubscription') !== -1);
  expect(appels.length).toBe(1);
  expect(appels[0].body).toContain('https://push.example/sans-getregistrations');
  expect(await page.evaluate(() => localStorage.getItem('v3TestUnsub')))
    .toBe('https://push.example/sans-getregistrations');
});
