import { test, expect } from '@playwright/test';

// Bascule des cleaners internes vers /v3/ (decision de Hillal du 08/10/2026) :
// a partir du 09/10 00:00 Dubai, une session role=cleaner qui ouvre la racine
// est renvoyee vers /v3/. Jamais un manager, ni Elite (subcontractor), ni la
// maintenance, ni le role system. ?legacy=1 garde l'ancienne app pour l'onglet.
//
// Tourne contre l'arbre de travail :
//   HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/v3-cutover.spec.ts --project=desktop
// Le reseau est bouchonne (window.fetch remplace avant app.js), /v3/ est servi
// par une page de remplacement : aucune ecriture, aucun appel a la prod.

type FakeRoute = { match: string; status: number; body: any };

// 08/10 23:59:30 et 09/10 00:00:30 a Dubai (UTC+4), puis 09/10 08:00.
const AVANT = new Date('2026-10-08T19:59:30Z');
const MINUIT = new Date('2026-10-08T20:00:30Z');
const APRES = new Date('2026-10-09T04:00:00Z');

const FAIZA = { id: 4, name: 'Faiza', color: '#e91e63', role: 'cleaner' };
const PIONAH = { id: 10, name: 'Pionah', color: '#3f51b5', role: 'cleaner' };
const ELITE = { id: 12, name: 'Elite Cleaning', color: '#999', role: 'subcontractor' };
const SEMAX = { id: 7, name: 'Semax', color: '#7c3aed', role: 'maintenance' };
const WALTER = { id: 8, name: 'Walter', color: '#e94560', role: 'manager' };

const SESSION = {
  access_token: 'jwt-test-token', refresh_token: 'refresh-test', token_type: 'bearer', expires_in: 3600,
  user: { id: 'u1', email: 'faiza@example.com', aud: 'authenticated', role: 'authenticated' },
};

function routesFor(member: any, email: string | null, extra: FakeRoute[] = []): FakeRoute[] {
  return [
    ...extra,
    { match: 'action=cleanerLogin', status: 200, body: { status: 'success', token: 'pin-test', cleaner: member } },
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: member } },
    { match: 'action=getCleaners', status: 200, body: { status: 'success', cleaners: [{ ...member, email }] } },
    { match: 'action=checkouts', status: 200, body: { status: 'success', reservations: [] } },
    {
      match: 'action=getAllData', status: 200,
      body: {
        status: 'success', done: {}, assignments: {}, cleaners: [{ ...member, email }], templates: [],
        listingPrices: {}, timers: {}, cancelled: {}, postponed: {}, extraCleanings: [], leaves: [], holidays: [],
      },
    },
    { match: 'action=', status: 200, body: { status: 'success' } },
  ];
}

async function boot(page: any, opts: {
  at: Date; routes: FakeRoute[]; pin?: any; email?: boolean; path?: string;
}) {
  await page.clock.setFixedTime(opts.at);
  // /v3/ remplacee : on ne verifie ici que la decision de la racine.
  await page.route('**/v3/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>V3 STUB</title><h1>V3 STUB</h1>' }));
  await page.addInitScript((cfg: any) => {
    try {
      if (cfg.pin) {
        localStorage.setItem('cleanerToken', 'pin-test');
        localStorage.setItem('cleanerMode', JSON.stringify(cfg.pin));
        localStorage.setItem('hkSessionCleanerId', String(cfg.pin.id));
      }
      if (cfg.email) localStorage.setItem('hkAuthSession', JSON.stringify(cfg.email));
      localStorage.setItem('onboardingSeen', '1');
      localStorage.setItem('hkInspAnnounceShown', '9');
    } catch (e) { /* ignore */ }
    (window as any).__fetchLog = [];
    const real = window.fetch.bind(window);
    window.fetch = ((input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      (window as any).__fetchLog.push(url);
      for (const r of cfg.routes) {
        if (url.indexOf(r.match) !== -1) {
          return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        }
      }
      if (url.indexOf(location.origin) === 0 || url.charAt(0) === '/') return real(input, init);
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as any;
  }, {
    routes: opts.routes,
    pin: opts.pin || null,
    email: opts.email ? { ...SESSION, expires_at: Math.floor(opts.at.getTime() / 1000) + 3600 } : null,
  });
  await page.goto(opts.path || '/', { waitUntil: 'commit' });
}

const redirige = async (page: any) => {
  await expect(page).toHaveURL(/\/v3\/$/, { timeout: 10_000 });
  await expect(page.locator('h1')).toHaveText('V3 STUB');
};
const reste = async (page: any, ms = 2500) => {
  await page.waitForTimeout(ms);
  expect(new URL(page.url()).pathname).toBe('/');
};

test('decision pure : role cleaner seulement, a partir du 09/10 Dubai, jamais en legacy', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).v3CutoverDue === 'function', null, { timeout: 10_000 });
  const r = await page.evaluate(() => {
    const w = window as any;
    const roles = ['cleaner', 'manager', 'subcontractor', 'maintenance', 'system', null];
    return {
      date: (0, eval)('V3_CUTOVER_DATE'),
      jour: [w.dubaiDateOf(Date.parse('2026-10-08T19:59:59Z')), w.dubaiDateOf(Date.parse('2026-10-08T20:00:00Z'))],
      le8: roles.map((x) => w.v3CutoverDue(x, '2026-10-08', false)),
      le9: roles.map((x) => w.v3CutoverDue(x, '2026-10-09', false)),
      le10: roles.map((x) => w.v3CutoverDue(x, '2026-10-10', false)),
      legacy: w.v3CutoverDue('cleaner', '2026-10-09', true),
    };
  });
  expect(r.date).toBe('2026-10-09');
  expect(r.jour).toEqual(['2026-10-08', '2026-10-09']);
  expect(r.le8).toEqual([false, false, false, false, false, false]);
  expect(r.le9).toEqual([true, false, false, false, false, false]);
  expect(r.le10).toEqual([true, false, false, false, false, false]);
  expect(r.legacy).toBe(false);
});

test('session PIN cleaner deja posee, 08/10 23:59 Dubai : reste sur l ancienne app', async ({ page }) => {
  await boot(page, { at: AVANT, pin: FAIZA, routes: routesFor(FAIZA, 'faiza@example.com') });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
});

test('session PIN cleaner deja posee, 09/10 00:00 Dubai : renvoyee vers /v3/', async ({ page }) => {
  await boot(page, { at: MINUIT, pin: FAIZA, routes: routesFor(FAIZA, 'faiza@example.com') });
  await redirige(page);
});

test('PIN tape (Quick unlock) par une cleaner le 09/10 : renvoyee vers /v3/', async ({ page }) => {
  await boot(page, { at: APRES, routes: routesFor(FAIZA, 'faiza@example.com') });
  await page.click('.auth-link[data-action="usePinInstead"]');
  await expect(page.locator('#pinInput')).toBeVisible({ timeout: 10_000 });
  await page.fill('#pinInput', '1234');
  await redirige(page);
});

test('PIN tape le 08/10 : reste sur l ancienne app', async ({ page }) => {
  await boot(page, { at: AVANT, routes: routesFor(FAIZA, 'faiza@example.com') });
  await page.click('.auth-link[data-action="usePinInstead"]');
  await expect(page.locator('#pinInput')).toBeVisible({ timeout: 10_000 });
  await page.fill('#pinInput', '1234');
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
});

test('cleaner PIN sans adresse le 09/10 : Create your account d abord, pas de boucle vers /v3/', async ({ page }) => {
  await boot(page, { at: APRES, pin: PIONAH, routes: routesFor(PIONAH, null) });
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await reste(page);
  await expect(page.locator('#linkEmail')).toBeVisible();
});

test('cleaner PIN sans adresse le 09/10 : une fois le compte cree, renvoyee vers /v3/', async ({ page }) => {
  await boot(page, {
    at: APRES, pin: PIONAH,
    routes: routesFor(PIONAH, null, [
      { match: 'action=linkEmail', status: 200, body: { status: 'success' } },
      { match: '/auth/v1/token', status: 200, body: { ...SESSION, expires_at: Math.floor(APRES.getTime() / 1000) + 3600 } },
    ]),
  });
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await page.fill('#linkEmail', 'pionah@example.com');
  await page.fill('#linkPassword', 'password123');
  await page.fill('#linkPassword2', 'password123');
  await page.click('[data-action="submitLinkEmail"]');
  await redirige(page);
});

test('session email cleaner le 09/10 : renvoyee vers /v3/', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(FAIZA, 'faiza@example.com') });
  await redirige(page);
});

test('session email cleaner le 08/10 : reste', async ({ page }) => {
  await boot(page, { at: AVANT, email: true, routes: routesFor(FAIZA, 'faiza@example.com') });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
});

test('connexion email d une cleaner le 09/10 : renvoyee vers /v3/', async ({ page }) => {
  await boot(page, {
    at: APRES,
    routes: routesFor(FAIZA, 'faiza@example.com', [
      { match: '/auth/v1/token', status: 200, body: { ...SESSION, expires_at: Math.floor(APRES.getTime() / 1000) + 3600 } },
    ]),
  });
  await expect(page.locator('#authEmail')).toBeVisible({ timeout: 10_000 });
  await page.fill('#authEmail', 'faiza@example.com');
  await page.fill('#authPassword', 'password123');
  await page.click('[data-action="emailLogin"]');
  await redirige(page);
});

for (const [nom, membre] of [['manager (email)', WALTER], ['Elite subcontractor (PIN)', ELITE], ['maintenance (PIN)', SEMAX]] as const) {
  test('le 09/10, ' + nom + ' n est jamais renvoye vers /v3/', async ({ page }) => {
    const email = nom.indexOf('email') !== -1;
    await boot(page, {
      at: APRES, email, pin: email ? undefined : membre,
      routes: routesFor(membre, 'x@example.com'),
    });
    await reste(page, 3000);
    await expect(page.locator('#linkEmail')).toHaveCount(0);
  });
}

test('manager connecte par PIN le 09/10 : reste', async ({ page }) => {
  await boot(page, { at: APRES, routes: routesFor(WALTER, 'walter@example.com') });
  await page.click('.auth-link[data-action="usePinInstead"]');
  await expect(page.locator('#pinInput')).toBeVisible({ timeout: 10_000 });
  await page.fill('#pinInput', '1234');
  await reste(page, 3000);
});

test('?legacy=1 garde l ancienne app pour l onglet, meme apres rechargement sans parametre', async ({ page }) => {
  await boot(page, { at: APRES, pin: FAIZA, routes: routesFor(FAIZA, 'faiza@example.com'), path: '/?legacy=1#cleaner' });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await reste(page);
  // ?legacy=0 rend la bascule.
  await page.goto('/?legacy=0', { waitUntil: 'commit' });
  await redirige(page);
});

test('jeton PIN revoque (401 sur cleanerMe) le 09/10 : pas de renvoi, retour au PIN', async ({ page }) => {
  await boot(page, {
    at: APRES, pin: FAIZA,
    routes: [
      { match: 'action=cleanerMe', status: 401, body: { error: 'unauthorized' } },
      ...routesFor(FAIZA, 'faiza@example.com'),
    ],
  });
  await expect(page.locator('#pinInput')).toBeVisible({ timeout: 10_000 });
  await reste(page);
});

test('garde anti-boucle : un second passage par la racine dans les 30 s ne renvoie plus', async ({ page }) => {
  await boot(page, { at: APRES, pin: FAIZA, routes: routesFor(FAIZA, 'faiza@example.com') });
  await redirige(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
});
