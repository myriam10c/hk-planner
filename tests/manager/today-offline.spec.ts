import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { DAY, NOW, todayBody } from './fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const WHO = 'Who does what today';
const CACHE = { savedAt: Date.parse('2026-10-09T05:42:00Z'), data: todayBody({ generatedAt: '2026-10-09T05:42:00.000Z' }) };

test('delai client par defaut : 15 s', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  const t = await page.evaluate(async () => (await import('/manager/api.js')).TIMEOUT_MS);
  expect(t).toBe(15000);
});

test('proxy trop lent : message clair, Retry recharge', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), delay: 3000, once: true }, TODAY()], { email: true, clock: NOW, timeoutMs: 300 });
  await expect(page.locator('.err-card')).toContainText('HK Planner is taking too long to answer. Try again.');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
});

test('reseau coupe avec cache : dernier Today et bandeau Data from', async ({ page }) => {
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache: CACHE });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  await expect(page.locator('.banner.warn')).toContainText('Data from 09:42. No connection. Try again.');
  await expect(page.locator('.banner.warn').getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('.asof')).toHaveClass(/stale/);
});

test('reseau coupe sans cache : jamais d ecran blanc', async ({ page }) => {
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW });
  await expect(page.locator('.err-card')).toContainText('No connection. Try again.');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('cache d un autre manager : jamais montre', async ({ page }) => {
  const other = { savedAt: CACHE.savedAt, data: todayBody({ me: { id: 6, name: 'Hillal' } }) };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache: other });
  await expect(page.locator('.err-card')).toContainText('No connection. Try again.');
  await expect(page.getByText('Data from', { exact: false })).toHaveCount(0);
});

test('Hostaway en panne cote proxy : 503 lisible sans cache', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 503, body: { error: 'Bookings are unavailable right now. Try again in a few minutes.' } }], { email: true, clock: NOW });
  await expect(page.locator('.err-card')).toContainText('Bookings are unavailable right now. Try again in a few minutes.');
});

test('reservations servies depuis la copie du proxy : bandeau Bookings data from', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(todayBody({ bookingsCachedAt: '2026-10-09T06:12:00Z' }))], { email: true, clock: NOW });
  await expect(page.getByText('Bookings data from 10:12', { exact: false })).toBeVisible();
});

test('reussite : Today garde sur l appareil', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mgrTodayCache') || 'null'));
  expect(saved.data.day).toBe(DAY);
  expect(typeof saved.savedAt).toBe('number');
});
