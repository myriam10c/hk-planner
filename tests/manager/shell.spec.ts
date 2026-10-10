import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me, noHorizontalScroll } from './helpers';

// Planning (phase 3) et Inspections (phase 4) sont livres : seul More reste provisoire.
const LINKS: Array<[string, string, string]> = [
  ['more', 'More', '/?legacy=1'],
];

test('navigation : 5 entrees, entree courante marquee, ecrans provisoires avec lien vers l ecran actuel', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=insp.today', status: 200, body: { day: '2026-10-06', target: 4, cachedAt: null, today: [], also: [] } }], { email: true, hash: '#/planning' });
  const nav = info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar');
  await expect(nav).toBeVisible();
  await expect(nav.locator('a')).toHaveText(['Today', 'Planning', 'Problems', 'Inspections', 'More']);
  for (const [id, title, href] of LINKS) {
    await nav.locator('a[href="#/' + id + '"]').click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(nav.locator('a[href="#/' + id + '"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main .ph a.btn')).toHaveAttribute('href', href);
  }
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
