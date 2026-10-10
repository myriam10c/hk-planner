import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { daysOf, isMobile, openJob, PLAN, planningBody, PNOW } from './planning-fixtures';

const HASH = '#/planning';

test('premier appel : semaine du lundi, en-tete de la semaine', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await expect(page.locator('main h1')).toHaveText('Planning');
  await expect(page.locator('main .top .date')).toHaveText('5 to 11 Oct 2026');
  await expect(page.locator('.pj').first()).toBeVisible();
  const urls = (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).map((l) => l.url);
  expect(urls.length).toBe(1);
  expect(urls[0]).toContain('start=2026-10-05');
});

test('ordinateur : 7 colonnes, une couleur par personne, conges et jour ferie', async ({ page }, info) => {
  test.skip(isMobile(info), 'grille : ordinateur');
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  const cols = page.locator('.pl-col');
  await expect(cols).toHaveCount(7);
  await expect(page.locator('.pl-col h2')).toHaveText(['Mon 5', 'Tue 6', 'Wed 7', 'Thu 8', 'Fri 9', 'Sat 10', 'Sun 11']);
  await expect(cols.nth(4).locator('.pj')).toHaveCount(4);
  await expect(cols.nth(4).locator('.pl-dh .meta')).toContainText('4 cleanings');
  await expect(cols.nth(4).locator('.pl-dh .meta')).toContainText('2 unassigned');
  await expect(page.locator('.pj[data-job="2026-10-06_Ann Lee"]')).toHaveClass(/pc-p1/);
  await expect(page.locator('.pj[data-job="2026-10-06_Ann Lee"]')).toContainText('Linen 22');
  await expect(page.locator('.pj[data-job="2026-10-09_Di Fox"]')).toHaveClass(/pc-p2/);
  await expect(page.locator('.pj[data-job="2026-10-10_Fa Ho"]')).toHaveClass(/pc-sub/);
  const bo = page.locator('.pj[data-job="2026-10-09_Bo Ray"]');
  await expect(bo).toHaveClass(/pc-none/);
  await expect(bo).toContainText('Unassigned');
  await expect(bo).toContainText('Check-in 15:00');
  await expect(page.locator('.pj[data-job="extra_2026-10-09_mabc"]')).toHaveClass(/extra/);
  await expect(page.locator('.pj[data-job="extra_2026-10-09_mabc"]')).toContainText('Extra');
  await expect(page.locator('.pj[data-job="2026-10-07_Ed Gu"]')).toHaveClass(/cancelled/);
  await expect(page.locator('.pj[data-job="2026-10-07_Gi Lo"]')).toContainText('From 07/10');
  await expect(cols.nth(5).locator('.pl-off')).toHaveText('Faiza off');
  await expect(cols.nth(6).locator('.pl-hol')).toHaveText('Test holiday');
});

test('telephone : un jour a la fois, aujourd hui par defaut', async ({ page }, info) => {
  test.skip(!isMobile(info), 'jour : telephone');
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await expect(page.locator('.pl-strip button')).toHaveCount(7);
  await expect(page.locator('.pl-strip [data-day="2026-10-09"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pl-day .pj')).toHaveCount(4);
  await expect(page.locator('.pl-grid')).toHaveCount(0);
  await page.locator('.pl-strip [data-day="2026-10-10"]').click();
  await expect(page.locator('.pl-day .pj')).toHaveCount(1);
  await expect(page.locator('.pl-day .pj')).toContainText('Apt 505');
  await expect(page.locator('.pl-day .pl-off')).toHaveText('Faiza off');
});

test('filtre par personne : Pionah, Unassigned, puis Everyone', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await page.locator('[data-filter="10"]').click();
  await expect(page.locator('[data-filter="10"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pj')).toHaveCount(2);
  await page.locator('[data-filter="none"]').click();
  await expect(page.locator('.pj')).toHaveCount(2);
  await expect(page.locator('.pj').nth(0)).toContainText('Apt 103');
  await expect(page.locator('.pj').nth(1)).toContainText('Apt 909');
  await page.locator('[data-filter="all"]').click();
  await expect(page.locator('.pj')).toHaveCount(isMobile(info) ? 4 : 8);
});

test('semaine suivante puis This week', async ({ page }) => {
  const next = planningBody({ start: '2026-10-12', end: '2026-10-18', days: daysOf('2026-10-12'), jobs: [], counts: { total: 0, unassigned: 0, done: 0, cancelled: 0 } });
  await bootMgr(page, [me(MANAGER), { match: 'start=2026-10-12', status: 200, body: next }, PLAN()], { email: true, hash: HASH, clock: PNOW });
  await expect(page.locator('.pj').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.locator('main .top .date')).toHaveText('12 to 18 Oct 2026');
  await expect(page.locator('main .empty').first()).toHaveText('No cleaning');
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(page.locator('main .top .date')).toHaveText('5 to 11 Oct 2026');
  await expect(page.locator('.pj').first()).toBeVisible();
  const urls = (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).map((l) => l.url);
  expect(urls.map((u) => u.split('start=')[1])).toEqual(['2026-10-05', '2026-10-12', '2026-10-05']);
});

test('fiche d un menage : extra, linge compte, statut', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  const sh = page.locator('#sheet');
  await expect(sh.locator('h2')).toHaveText('Apt 808 · Tower H');
  for (const t of ['Extra cleaning · Fri 9', 'Deep clean', 'Owner', '250 AED', '120 AED', 'Bring the steamer', 'Pionah', 'Not counted']) {
    await expect(sh).toContainText(t);
  }
  await page.keyboard.press('Escape');
  await expect(sh).toHaveAttribute('aria-hidden', 'true');
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  await expect(sh.locator('.statusbox')).toContainText('Done');
  await expect(sh).toContainText('Pillowcases 4');
  await expect(sh).toContainText('Total 22.');
  await expect(sh).toContainText('Tuesday 6 October, checkout 12:00');
});

test('hors ligne : semaine en cache, Data from, lecture seule', async ({ page }, info) => {
  const cache = { v: 1, savedAt: PNOW.getTime() - 3600_000, owner: 'u-test', data: planningBody() };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.planning', status: 0, body: {}, fail: true }],
    { email: true, hash: HASH, clock: PNOW, storage: { mgrPlanningCache: JSON.stringify(cache) } });
  await expect(page.locator('main .banner')).toContainText('Data from 10:00');
  await expect(page.locator('main .banner')).toContainText('No connection. Try again.');
  await expect(page.getByRole('button', { name: 'Add extra' })).toHaveCount(0);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await expect(page.locator('#sheet .ro-note')).toHaveText('Reconnect to make changes.');
  await expect(page.locator('#sheet [data-pa]')).toHaveCount(0);
});

test('proxy lent : message clair et Retry', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...PLAN(), delay: 2000 }], { email: true, hash: HASH, timeoutMs: 300 });
  await expect(page.locator('main .err-card')).toContainText('HK Planner is taking too long to answer. Try again.');
  await expect(page.locator('main h1')).toHaveText('Planning');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('Planning : aucun defilement horizontal (' + scheme + ')', async ({ page }) => {
      await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
      await expect(page.locator('.pj').first()).toBeVisible();
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    });
  });
}
