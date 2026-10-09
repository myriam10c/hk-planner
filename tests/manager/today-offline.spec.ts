import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { DAY, NOW, todayBody } from './fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const WHO = 'Who does what today';
const CACHE = { v: 1, owner: 'u-test', savedAt: Date.parse('2026-10-09T05:42:00Z'), data: todayBody({ generatedAt: '2026-10-09T05:42:00.000Z' }) };

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
  const other = { v: 1, owner: 'u-test', savedAt: CACHE.savedAt, data: todayBody({ me: { id: 6, name: 'Hillal' } }) };
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

const STALE_SESSION = { access_token: 'x', refresh_token: 'r', token_type: 'bearer', expires_in: 1, expires_at: 1, user: { id: 'u-test', email: 'a@example.com' } };
async function staleBoot(page: any, owner: string, cacheData: any = CACHE.data) {
  await page.addInitScript((cfg: any) => {
    localStorage.setItem('mgrTestSeeded', '1');
    localStorage.setItem('hkAuthSession', JSON.stringify(cfg.session));
    localStorage.setItem('mgrTodayCache', JSON.stringify({ v: 1, owner: cfg.owner, savedAt: cfg.savedAt, data: cfg.data }));
    Object.defineProperty(navigator, 'onLine', { get: () => false });
    // Reseau coupe pour de vrai : le renouvellement echoue sans refus (la session reste stockee).
    let inner: any = window.fetch;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get: () => (input: any, init: any) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('/auth/v1/') !== -1) return Promise.reject(new TypeError('Failed to fetch'));
        return inner(input, init);
      },
      set: (f: any) => { inner = f; },
    });
  }, { session: STALE_SESSION, owner, savedAt: CACHE.savedAt, data: cacheData });
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { clock: NOW });
}

test('cache de A, session stale de A : montre', async ({ page }) => {
  await staleBoot(page, 'u-test');
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  await expect(page.locator('.banner.warn')).toContainText('Data from 09:42');
});

test('cache de A, session stale de B : jamais montre', async ({ page }) => {
  await staleBoot(page, 'u-someone-else');
  await expect(page.locator('.err-card')).toBeVisible();
  await expect(page.getByRole('heading', { name: WHO })).toHaveCount(0);
});

test('cache de la veille : date dans le bandeau et Not today\'s data', async ({ page }) => {
  const yesterday = { ...CACHE, savedAt: Date.parse('2026-10-08T14:40:00Z'), data: todayBody({ day: '2026-10-08' }) };
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache: yesterday });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  await expect(page.locator('.banner.warn')).toContainText('Data from Thu 08/10 18:40. No connection. Try again. Not today\'s data.');
});

test('cache sans version : ignore', async ({ page }) => {
  const { v, ...noVersion } = CACHE as any;
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache: noVersion });
  await expect(page.locator('.err-card')).toContainText('No connection. Try again.');
  await expect(page.getByRole('heading', { name: WHO })).toHaveCount(0);
});

test('reussite : le cache est ecrit avec v: 1', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mgrTodayCache') || 'null'));
  expect(saved.v).toBe(1);
});

test('Today en cache : aucun bouton d ecriture, Reconnect to make changes, aucune ecriture', async ({ page }) => {
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache: CACHE });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  await expect(page.locator('[data-assign]')).toHaveCount(0);
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).locator('[data-open="job"]').click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByText('Reconnect to make changes.')).toBeVisible();
  await expect(sheet.locator('[data-assign], [data-done]')).toHaveCount(0);
  // Defense en profondeur : meme un faux bouton injecte est refuse.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-done', '2026-10-09_Ann Lee'); b.setAttribute('data-val', '1'); b.id = 'fake';
    document.getElementById('sheet')!.appendChild(b);
  });
  await page.locator('#fake').click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  const log = (await page.evaluate(() => JSON.parse(localStorage.getItem('mgrFetchLog') || '[]'))) as any[];
  expect(log.filter((l) => /action=(assignCleaner|setDone)/.test(l.url)).length).toBe(0);
});
