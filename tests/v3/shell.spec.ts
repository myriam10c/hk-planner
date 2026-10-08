import { expect, test } from '@playwright/test';
import { bootV3, emailSession, fetchLog, noHorizontalScroll } from './helpers';

test('sans session, la v3 renvoie vers la connexion existante sans appeler le proxy', async ({ page }) => {
  await bootV3(page, []);
  await expect(page.getByRole('heading', { name: 'HK Planner' })).toBeVisible();
  await expect(page.getByText('Sign in on HK Planner to see your day.')).toBeVisible();
  const lien = page.getByRole('link', { name: 'Sign in' });
  await expect(lien).toHaveAttribute('href', '/#cleaner');
  expect(await fetchLog(page)).toEqual([]);
});

test('la coquille ne deborde jamais en largeur', async ({ page }) => {
  await bootV3(page, []);
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
});

test('readSession prend le Bearer avant le PIN, et un refresh refuse rend la main au PIN', async ({ page }) => {
  await bootV3(page, [], {
    pinToken: 'jeton-pin',
    emailSession: emailSession('jwt-frais', 'rt-1', 3600),
    // Le renouvellement est refuse (session revoquee) : supabase-js efface la
    // session email et la v3 retombe sur le jeton PIN.
    authRoutes: [{ match: '/auth/v1/token', status: 400, body: { code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' } }],
  });
  const frais = await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    return m.authHeaders(await m.readSession());
  });
  expect(frais['Authorization']).toBe('Bearer jwt-frais');
  expect(frais['X-Cleaner-Token']).toBeUndefined();
  expect(frais['X-App-Secret']).toBeTruthy();

  await page.evaluate((s) => {
    localStorage.setItem('hkAuthSession', JSON.stringify(s));
  }, emailSession('jwt-perime', 'rt-1', -60));
  const perime = await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    return m.authHeaders(await m.readSession());
  });
  expect(perime['Authorization']).toBeUndefined();
  expect(perime['X-Cleaner-Token']).toBe('jeton-pin');
});

test('les polices sont servies depuis le meme domaine', async ({ page }) => {
  await bootV3(page, []);
  const reponses = await Promise.all([
    page.request.get('/v3/fonts/bricolage-grotesque-latin.woff2'),
    page.request.get('/v3/fonts/instrument-sans-latin.woff2'),
  ]);
  for (const r of reponses) expect(r.status()).toBe(200);
});

// Bascule du 09/10 : la racine renvoie les cleaners vers /v3/. Si /v3/ ne charge
// pas (module en panne), un lien de secours visible mene a l'ancienne app avec
// ?legacy=1, qui coupe le renvoi pour l'onglet.
test('v3 qui ne charge pas : lien de secours vers l ancienne app (legacy=1)', async ({ page }) => {
  await page.route('**/v3/app.js', (r) => r.fulfill({ status: 500, contentType: 'text/javascript', body: 'throw new Error("panne")' }));
  await page.goto('/v3/', { waitUntil: 'domcontentloaded' });
  const lien = page.getByRole('link', { name: 'Open the old app' });
  await expect(lien).toBeVisible({ timeout: 8_000 });
  await expect(lien).toHaveAttribute('href', '/?legacy=1#cleaner');
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
});

test('v3 qui charge : le lien de secours statique disparait au premier rendu', async ({ page }) => {
  await bootV3(page, []);
  await expect(page.getByText('Sign in on HK Planner to see your day.')).toBeVisible();
  await expect(page.locator('.boot-fallback')).toHaveCount(0);
});

test('journee illisible : l ecran d erreur propose aussi l ancienne app', async ({ page }) => {
  await bootV3(page, [{ match: 'action=v3.myDay', status: 500, body: { error: 'boom' } }], { pinToken: 'jeton-pin' });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the old app' })).toHaveAttribute('href', '/?legacy=1#cleaner');
});
