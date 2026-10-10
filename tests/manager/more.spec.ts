import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me, noHorizontalScroll } from './helpers';

const navOf = (page: any, info: any) => (info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar'));
const boot = (page: any, hash = '#/more') => bootMgr(page, [me(MANAGER)], { email: true, hash });

const ROWS: Array<[string, string, string]> = [
  ['Team', 'Accounts, roles and invitations', '#/more/team'],
  ['Apartment', 'One sheet per apartment: cleanings, linen, tickets, inspections, security contacts', '#/more/apartment'],
  ['Reviews', 'Review disputes', '#/more/reviews'],
  ['Settings', 'Autopilot, notifications, inspection target, checklists', '#/more/settings'],
  ['HR and leave', 'Leave requests, balances, documents, public holidays', '#/more/hr'],
  ['Ratings and stats', 'Cleanliness ratings, cleanings and times per person', '#/more/people'],
  ['Maintenance setup', 'Vendors, equipment, preventive maintenance and costs', '#/more/setup'],
  ['Reports', 'In the current app for now', '/?legacy=1'],
];

test('hub : 8 lignes dans l ordre avec leurs liens, More marque courant', async ({ page }, info) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  const rows = page.locator('main a.more-row');
  await expect(rows).toHaveCount(8);
  for (let i = 0; i < ROWS.length; i++) {
    const [title, desc, href] = ROWS[i];
    await expect(rows.nth(i)).toHaveAttribute('href', href);
    await expect(rows.nth(i)).toContainText(title);
    await expect(rows.nth(i)).toContainText(desc);
    const box = await rows.nth(i).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('main .more-row .pill', { hasText: 'Current app' })).toHaveCount(1);
  await expect(navOf(page, info).locator('a[href="#/more"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('main').getByText('Signed in as Walter')).toBeVisible();
  await expect(page.locator('main [data-theme-toggle]')).toBeVisible();
});

test('section inconnue : retour au hub', async ({ page }) => {
  await boot(page, '#/more/zzz');
  await expect(page.locator('main a.more-row')).toHaveCount(8);
});

test('module de section absent : carte d erreur avec Retry et lien vers l ancienne app', async ({ page }) => {
  await page.route('**/manager/screens/more-team.js', (r) => r.abort());
  await boot(page, '#/more/team');
  await expect(page.getByText('Could not load this section.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the current app' })).toHaveAttribute('href', '/?legacy=1');
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
});

test('parseMoreHash', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const m = await import('/manager/screens/more.js');
    return ['#/more', '#/more/apartment/123', '#/more/team/9', '#/more/apartment/%E0', '#/more/zzz', '#/more/apartment/a%20b',
      '#/more/hr', '#/more/hr/12', '#/more/hr/%E0', '#/more/setup/vendors', '#/more/people/3', '#/more/reports'].map((h) => m.parseMoreHash(h));
  });
  expect(r).toEqual([
    { section: '', id: null }, { section: 'apartment', id: '123' }, { section: 'team', id: null },
    { section: 'apartment', id: null }, { section: '', id: null }, { section: 'apartment', id: 'a b' },
    { section: 'hr', id: null }, { section: 'hr', id: '12' }, { section: 'hr', id: null },
    { section: 'setup', id: 'vendors' }, { section: 'people', id: null }, { section: 'reports', id: null },
  ]);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('hub et carte d erreur sans defilement horizontal (' + scheme + ')', async ({ page }) => {
      await boot(page);
      await expect(page.locator('main a.more-row')).toHaveCount(8);
      let s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      await page.route('**/manager/screens/more-settings.js', (r) => r.abort());
      await page.goto('/manager/#/more/settings');
      await page.reload();
      await expect(page.getByText('Could not load this section.')).toBeVisible();
      s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    });
  });
}
