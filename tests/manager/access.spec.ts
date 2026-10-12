import { test, expect } from '@playwright/test';
import { bootMgr, emailSession, fetchLog, MANAGER, me } from './helpers';

const member = (role: string) => ({ ...MANAGER, id: 30, name: 'Member', role });

test('sans session : renvoye vers la connexion', async ({ page }) => {
  await bootMgr(page, []);
  await expect(page.locator('h1')).toHaveText('ROOT STUB');
});

test('cleaner en session email : renvoyee vers /v3/', async ({ page }) => {
  await bootMgr(page, [me(member('cleaner'))], { email: true });
  await expect(page.locator('h1')).toHaveText('V3 STUB');
});

test('role subcontractor : renvoye vers l ancienne app', async ({ page }) => {
  await bootMgr(page, [me(member('subcontractor'))], { email: true });
  await expect(page.locator('h1')).toHaveText('ROOT STUB');
});

test('role maintenance en session email : coquille, atterrit sur Maintenance', async ({ page }) => {
  await bootMgr(page, [me(member('maintenance'))], { email: true });
  await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/maintenance');
});

test('role maintenance en session PIN seulement : ecran email', async ({ page }) => {
  await bootMgr(page, [me(member('maintenance'))], { pin: 'pin-tok' });
  await expect(page.getByRole('heading', { name: 'Sign in with your email' })).toBeVisible();
  await expect(page.locator('#tabbar a')).toHaveCount(0);
  // Ruling E : mot neutre pour Semax.
  await expect(page.locator('#main')).toContainText('The new app needs your email sign-in.');
  await expect(page.locator('#main')).not.toContainText('manager app');
});

test('manager en session PIN seulement : ecran email, aucun appel mgr.today', async ({ page }) => {
  await bootMgr(page, [me(MANAGER)], { pin: 'pin-tok' });
  await expect(page.getByRole('heading', { name: 'Sign in with your email' })).toBeVisible();
  await expect(page.locator('#tabbar a')).toHaveCount(0);
  await expect(page.locator('#main')).toContainText('The manager app needs your email account.');
  const log = await fetchLog(page);
  expect(log.some((l) => l.url.includes('action=mgr.today'))).toBe(false);
  expect(log.find((l) => l.url.includes('action=cleanerMe'))!.headers['X-Cleaner-Token']).toBe('pin-tok');
});

test('manager en session email : coquille, en-tete Bearer', async ({ page }) => {
  await bootMgr(page, [me(MANAGER)], { email: true, hash: '#/planning' });
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
  const log = await fetchLog(page);
  expect(log.find((l) => l.url.includes('action=cleanerMe'))!.headers['Authorization']).toBe('Bearer jwt-test');
});

test('session email lente a renouveler + jeton PIN : la coquille s ouvre, pas d ecran email', async ({ page }) => {
  // Jeton d'acces expire, refresh token present, endpoint de renouvellement trop lent :
  // v3/session.js rend le PIN (prioritaire sur stale), mais la session email existe.
  const expiree = { ...emailSession(), access_token: 'jwt-expire', expires_at: 1000 };
  await bootMgr(page, [me(MANAGER)], {
    pin: 'pin-tok', authDelayMs: 9000,
    storage: { hkAuthSession: JSON.stringify(expiree) },
  });
  await expect.poll(() => page.locator('#tabbar a, #sideNav a').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: 'Sign in with your email' })).toHaveCount(0);
});
