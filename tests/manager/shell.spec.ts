import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me, noHorizontalScroll } from './helpers';

test('navigation : 5 entrees, entree courante marquee, More est le hub', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=insp.today', status: 200, body: { day: '2026-10-06', target: 4, cachedAt: null, today: [], also: [] } }], { email: true, hash: '#/planning' });
  const nav = info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar');
  await expect(nav).toBeVisible();
  await expect(nav.locator('a')).toHaveText(['Today', 'Planning', 'Problems', 'Inspections', 'More']);
  await nav.locator('a[href="#/more"]').click();
  await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  await expect(nav.locator('a[href="#/more"]')).toHaveAttribute('aria-current', 'page');
  await nav.locator('a[href="#/inspections"]').click();
  await expect(page.getByText("Today's inspections")).toBeVisible();
  await expect(nav.locator('a[href="#/inspections"]')).toHaveAttribute('aria-current', 'page');
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('aucun defilement horizontal, fond selon le theme (' + scheme + ')', async ({ page }) => {
      await bootMgr(page, [me(MANAGER)], { email: true, hash: '#/more' });
      await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(10, 11, 14)' : 'rgb(243, 244, 247)');
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    });
  });
}
