import { test, expect } from '@playwright/test';

// Bascule des managers vers /manager/ (phase 6a, 11/10/2026) : a partir du 11/10
// 00:00 Dubai, une session EMAIL role=manager qui ouvre la racine est renvoyee
// vers /manager/. Une session PIN manager reste et voit un bandeau qui demande la
// connexion par email. ?legacy=1 garde l'ancienne app pour l'onglet (meme drapeau
// que la bascule des cleaners), avec un bandeau jusqu'au 10/11.
//
// Tourne contre l'arbre de travail :
//   HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/mgr-cutover.spec.ts --project=desktop --project=mobile
// Le reseau est bouchonne (window.fetch remplace avant app.js), /manager/ et /v3/
// sont servis par des pages de remplacement : aucune ecriture, aucun appel a la prod.

type FakeRoute = { match: string; status: number; body: any; fail?: boolean };

// 10/10 23:59:30 et 11/10 00:00:30 a Dubai (UTC+4), puis 11/10 08:00.
const AVANT = new Date('2026-10-10T19:59:30Z');
const MINUIT = new Date('2026-10-10T20:00:30Z');
const APRES = new Date('2026-10-11T04:00:00Z');

const WALTER = { id: 8, name: 'Walter', color: '#e94560', role: 'manager' };
const FAIZA = { id: 4, name: 'Faiza', color: '#e91e63', role: 'cleaner' };
const ELITE = { id: 12, name: 'Elite Cleaning', color: '#999', role: 'subcontractor' };
const SEMAX = { id: 7, name: 'Semax', color: '#7c3aed', role: 'maintenance' };

const SESSION = {
  access_token: 'jwt-test-token', refresh_token: 'refresh-test', token_type: 'bearer', expires_in: 3600,
  user: { id: 'u1', email: 'walter@example.com', aud: 'authenticated', role: 'authenticated' },
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
  at: Date; routes: FakeRoute[]; email?: boolean; path?: string; offline?: boolean;
  // Session PIN : `mode` pose aussi cleanerMode (cleaner, Elite, maintenance) ;
  // un manager PIN n'a pas de cleanerMode, seulement le jeton et son id.
  pin?: any; mode?: boolean;
}) {
  await page.clock.setFixedTime(opts.at);
  await page.route('**/manager/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>MANAGER STUB</title><h1>MANAGER STUB</h1>' }));
  await page.route('**/v3/**', (r: any) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>V3 STUB</title><h1>V3 STUB</h1>' }));
  await page.addInitScript((cfg: any) => {
    try {
      if (cfg.pin) {
        localStorage.setItem('cleanerToken', 'pin-test');
        localStorage.setItem('hkSessionCleanerId', String(cfg.pin.id));
        if (cfg.mode) localStorage.setItem('cleanerMode', JSON.stringify(cfg.pin));
      }
      if (cfg.email) localStorage.setItem('hkAuthSession', JSON.stringify(cfg.email));
      localStorage.setItem('onboardingSeen', '1');
      localStorage.setItem('hkInspAnnounceShown', '9');
    } catch (e) { /* ignore */ }
    if (cfg.offline) Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true });
    const real = window.fetch.bind(window);
    window.fetch = ((input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      for (const r of cfg.routes) {
        if (url.indexOf(r.match) !== -1) {
          if (r.fail) return Promise.reject(new TypeError('Failed to fetch'));
          return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        }
      }
      if (url.indexOf(location.origin) === 0 || url.charAt(0) === '/') return real(input, init);
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as any;
  }, {
    routes: opts.routes,
    pin: opts.pin || null,
    mode: !!opts.mode,
    offline: !!opts.offline,
    email: opts.email ? { ...SESSION, expires_at: Math.floor(opts.at.getTime() / 1000) + 3600 } : null,
  });
  await page.goto(opts.path || '/', { waitUntil: 'commit' });
}

const versManager = async (page: any, hash = '') => {
  await expect(page).toHaveURL(new RegExp('/manager/' + hash.replace(/[?]/g, '\\?') + '$'), { timeout: 10_000 });
  await expect(page.locator('h1')).toHaveText('MANAGER STUB');
};
const reste = async (page: any, ms = 2500) => {
  await page.waitForTimeout(ms);
  expect(new URL(page.url()).pathname).toBe('/');
};
const banner = (page: any) => page.locator('#mgrBanner');

test('decision pure : manager ou maintenance en session email seulement, a partir du 11/10 Dubai, jamais en legacy', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).mgrCutoverDue === 'function', null, { timeout: 10_000 });
  const r = await page.evaluate(() => {
    const w = window as any;
    const roles = ['manager', 'cleaner', 'subcontractor', 'maintenance', 'system', null];
    return {
      consts: [(0, eval)('MGR_CUTOVER_DATE'), (0, eval)('MGR_LEGACY_UNTIL'), (0, eval)('MGR_CUTOVER_PATH'), (0, eval)('MGR_REDIRECT_KEY')],
      le10: roles.map((x) => w.mgrCutoverDue(x, true, '2026-10-10', false)),
      le11: roles.map((x) => w.mgrCutoverDue(x, true, '2026-10-11', false)),
      le12: roles.map((x) => w.mgrCutoverDue(x, true, '2026-10-12', false)),
      pin: w.mgrCutoverDue('manager', false, '2026-10-11', false),
      legacy: w.mgrCutoverDue('manager', true, '2026-10-11', true),
    };
  });
  expect(r.consts).toEqual(['2026-10-11', '2026-11-10', '/manager/', 'hkMgrRedirectAt']);
  expect(r.le10).toEqual([false, false, false, false, false, false]);
  expect(r.le11).toEqual([true, false, false, true, false, false]);
  expect(r.le12).toEqual([true, false, false, true, false, false]);
  expect(r.pin).toBe(false);
  expect(r.legacy).toBe(false);
});

test('session email manager le 11/10 00:00 Dubai : renvoyee vers /manager/', async ({ page }) => {
  await boot(page, { at: MINUIT, email: true, routes: routesFor(WALTER, 'walter@example.com') });
  await versManager(page);
});

test('session email manager le 10/10 23:59 Dubai : reste, sans bandeau', async ({ page }) => {
  await boot(page, { at: AVANT, email: true, routes: routesFor(WALTER, 'walter@example.com') });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
  await expect(banner(page)).toHaveCount(0);
});

for (const [path, hash] of [
  ['/?task=12', '#/tasks?ref=TSK-12'], ['/?mnt=12', '#/maintenance?ref=MNT-12'], ['/?prp=5', '#/maintenance?ref=PRP-5'],
] as const) {
  test('lien de push ' + path + ' : renvoye vers /manager/' + hash, async ({ page }) => {
    await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com'), path });
    await versManager(page, hash);
  });
}

test('lien de push /?mnt=abc (id invalide) : /manager/ sans ref', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com'), path: '/?mnt=abc' });
  await versManager(page);
});

test('session email maintenance (Semax) le 11/10 : renvoyee vers /manager/, lien ticket compris', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(SEMAX, 'semax@example.com'), path: '/?mnt=12' });
  await versManager(page, '#/maintenance?ref=MNT-12');
});

test('session PIN maintenance le 11/10 : reste, bandeau de connexion par email', async ({ page }) => {
  await boot(page, { at: APRES, pin: SEMAX, mode: true, routes: routesFor(SEMAX, 'semax@example.com') });
  await reste(page, 3000);
  await expect(banner(page)).toContainText('The new manager app needs your email sign-in.');
});

test('?legacy=1 : une session email maintenance garde l ancienne app avec le bandeau', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(SEMAX, 'semax@example.com'), path: '/?legacy=1' });
  await reste(page, 3000);
  await expect(banner(page)).toContainText('You are using the old manager app.');
});

test('connexion email d un manager le 11/10 : renvoye vers /manager/', async ({ page }) => {
  await boot(page, {
    at: APRES,
    routes: routesFor(WALTER, 'walter@example.com', [
      { match: '/auth/v1/token', status: 200, body: { ...SESSION, expires_at: Math.floor(APRES.getTime() / 1000) + 3600 } },
    ]),
  });
  await expect(page.locator('#authEmail')).toBeVisible({ timeout: 10_000 });
  // Ecran d'authentification : pas de renvoi tant que la connexion n'est pas faite.
  await reste(page, 1500);
  await page.fill('#authEmail', 'walter@example.com');
  await page.fill('#authPassword', 'password123');
  await page.click('[data-action="emailLogin"]');
  await versManager(page);
});

test('?legacy=1 garde l ancienne app avec le bandeau, meme apres rechargement ; ?legacy=0 rend la bascule', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com'), path: '/?legacy=1' });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('You are using the old manager app. It will be removed on 10 November 2026.');
  await expect(banner(page).getByRole('button', { name: 'Open the new app' })).toBeVisible();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await reste(page);
  await expect(banner(page)).toBeVisible();
  await page.goto('/?legacy=0', { waitUntil: 'commit' });
  await versManager(page);
});

test('bandeau legacy : Open the new app ouvre /manager/ et rend la bascule a l onglet', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com'), path: '/?legacy=1' });
  await expect(banner(page)).toBeVisible({ timeout: 10_000 });
  const avant = await page.evaluate(() => history.length);
  await banner(page).getByRole('button', { name: 'Open the new app' }).click();
  await versManager(page);
  expect(await page.evaluate(() => sessionStorage.getItem('hkV3Legacy'))).toBeNull();
  // replace et non assign : pas d'entree d'historique ajoutee (Back ne ramene pas une page figee).
  expect(await page.evaluate(() => history.length)).toBe(avant);
});

test('?legacy=1 : une session email cleaner ou sous-traitant ne voit jamais le bandeau manager', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(ELITE, 'x@example.com'), path: '/?legacy=1' });
  await reste(page, 3000);
  await expect(banner(page)).toHaveCount(0);
});

test('garde anti-boucle : le manager qui reste voit le bandeau Open the new app', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com') });
  await versManager(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
  await expect(banner(page)).toBeVisible();
  await expect(banner(page).getByRole('button', { name: 'Open the new app' })).toBeVisible();
});

test('bandeau legacy : Dismiss le cache pour l onglet', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com'), path: '/?legacy=1' });
  await expect(banner(page)).toBeVisible({ timeout: 10_000 });
  await banner(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner(page)).toHaveCount(0);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1000);
  await expect(banner(page)).toHaveCount(0);
});

test('session PIN manager avec adresse le 11/10 : reste, bandeau Sign out and sign in with email', async ({ page }) => {
  await boot(page, { at: APRES, pin: WALTER, routes: routesFor(WALTER, 'walter@example.com') });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
  await expect(banner(page)).toContainText('The new manager app needs your email sign-in.');
  const btn = banner(page).getByRole('button', { name: 'Sign out and sign in with email' });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#authEmail')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#authEmail')).toHaveValue('walter@example.com');
  await expect(banner(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('cleanerToken'))).toBeNull();
});

test('session PIN manager sans adresse connue : bandeau Set up email sign-in, ouvre Create your account', async ({ page }) => {
  // getCleaners ne trouve pas la ligne au boot (pas d'ecran obligatoire), la
  // ligne chargee ensuite n'a pas d'adresse.
  await boot(page, {
    at: APRES, pin: WALTER,
    routes: routesFor(WALTER, null, [{ match: 'action=getCleaners', status: 200, body: { status: 'success', cleaners: [] } }]),
  });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  const btn = banner(page).getByRole('button', { name: 'Set up email sign-in' });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await expect(banner(page)).toHaveCount(0);
});

test('PIN tape par un manager le 11/10 : reste', async ({ page }) => {
  await boot(page, { at: APRES, routes: routesFor(WALTER, 'walter@example.com') });
  await page.click('.auth-link[data-action="startAccountSetup"]');
  await expect(page.locator('#pinInput')).toBeVisible({ timeout: 10_000 });
  await page.fill('#pinInput', '1234');
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page, 3000);
  await expect(banner(page)).toContainText('The new manager app needs your email sign-in.');
});

test('session email cleaner le 11/10 : toujours vers /v3/, jamais /manager/', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(FAIZA, 'faiza@example.com') });
  await expect(page).toHaveURL(/\/v3\/$/, { timeout: 10_000 });
});

for (const [nom, membre, email] of [
  ['Elite subcontractor (PIN)', ELITE, false], ['Elite subcontractor (email)', ELITE, true],
] as const) {
  test('le 11/10, ' + nom + ' n est jamais renvoye vers /manager/', async ({ page }) => {
    await boot(page, {
      at: APRES, email, pin: email ? undefined : membre, mode: !email,
      routes: routesFor(membre, 'x@example.com'),
    });
    await reste(page, 3000);
    await expect(banner(page)).toHaveCount(0);
  });
}

test('hors ligne, session email manager le 11/10 : pas de renvoi', async ({ page }) => {
  await boot(page, { at: APRES, email: true, offline: true, routes: routesFor(WALTER, 'walter@example.com') });
  await reste(page, 3000);
});

test('cleanerMe en panne reseau, session email manager le 11/10 : pas de renvoi (role non confirme)', async ({ page }) => {
  await boot(page, {
    at: APRES, email: true,
    routes: [{ match: 'action=cleanerMe', status: 0, body: null, fail: true }, ...routesFor(WALTER, 'walter@example.com')],
  });
  await reste(page, 3000);
});

test('garde anti-boucle : un second passage par la racine dans les 30 s ne renvoie plus', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com') });
  await versManager(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await reste(page);
});

test('More garde le lien New manager app vers /manager/ (ancienne app en legacy)', async ({ page }) => {
  await boot(page, { at: APRES, email: true, routes: routesFor(WALTER, 'walter@example.com'), path: '/?legacy=1' });
  await page.locator('.bottom-nav [data-arg0="__more"]').click();
  await expect(page.locator('#moreMenu a[data-mgr-app]')).toHaveAttribute('href', '/manager/');
});
