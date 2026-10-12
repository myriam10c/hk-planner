import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me, noHorizontalScroll } from './helpers';
import { PLAN, PNOW } from './planning-fixtures';
import { detailTsk, listBody } from './problem-fixtures';

const SEMAX = { ...MANAGER, id: 7, name: 'Semax', role: 'maintenance', email: 'semax@example.com' };
const navOf = (page: any, info: any) => (info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar'));
const hashOf = (page: any) => page.evaluate(() => location.hash);
const TASKS = { match: 'action=mgr.problems', status: 200, body: listBody() };

test('navigation manager : Today, Planning, Maintenance, Inspections, More ; entree courante marquee, More est le hub', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=insp.today', status: 200, body: { day: '2026-10-06', target: 4, cachedAt: null, today: [], also: [] } }], { email: true, hash: '#/planning' });
  const nav = info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar');
  await expect(nav).toBeVisible();
  await expect(nav.locator('a')).toHaveText(['Today', 'Planning', 'Maintenance', 'Inspections', 'More']);
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

test('Semax (maintenance, email) : atterrit sur Maintenance, ne voit que Maintenance et Planning', async ({ page }, info) => {
  await bootMgr(page, [me(SEMAX), PLAN()], { email: true, clock: PNOW });
  const nav = navOf(page, info);
  await expect(nav.locator('a')).toHaveText(['Maintenance', 'Planning']);
  await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
  await expect.poll(() => hashOf(page)).toBe('#/maintenance');
  await expect(nav.locator('a[href="#/maintenance"]')).toHaveAttribute('aria-current', 'page');
  await nav.locator('a[href="#/planning"]').click();
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
  for (const h of ['#/today', '#/more', '#/more/team', '#/inspections']) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await expect.poll(() => hashOf(page)).toBe('#/maintenance');
    await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
  }
  await expect(nav.locator('a')).toHaveText(['Maintenance', 'Planning']);
});

test('Semax : #/today tape a la main au chargement renvoie a #/maintenance', async ({ page }) => {
  await bootMgr(page, [me(SEMAX)], { email: true, hash: '#/today' });
  await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
  await expect.poll(() => hashOf(page)).toBe('#/maintenance');
});

test('manager : vue inconnue renvoie a #/today ; #/maintenance ouvre l ecran Maintenance', async ({ page }) => {
  await bootMgr(page, [me(MANAGER)], { email: true, hash: '#/zzz' });
  await expect.poll(() => hashOf(page)).toBe('#/today');
  await page.evaluate(() => { location.hash = '#/maintenance'; });
  await expect(page.getByRole('heading', { name: 'Maintenance', exact: true })).toBeVisible();
});

for (const [from, to] of [
  ['#/problems?ref=TSK-13', '#/tasks?ref=TSK-13'], ['#/problems', '#/tasks'],
  ['#/problems?ref=MNT-12', '#/maintenance?ref=MNT-12'],
] as const) {
  test('ancien lien ' + from + ' : devient ' + to, async ({ page }) => {
    await bootMgr(page, [me(MANAGER), TASKS, { match: 'action=mgr.problem.get', status: 404, body: { error: 'Problem not found' } }], { email: true, hash: from });
    await expect.poll(() => hashOf(page)).toBe(to);
    await expect(page.getByRole('heading', { name: to.startsWith('#/tasks') ? 'Tasks' : 'Maintenance', exact: true })).toBeVisible();
  });
}

test('Tasks : sous More (More marque courant), sans puces de source ticket', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), TASKS], { email: true, hash: '#/tasks' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(page.locator('.prow')).toHaveCount(3);
  await expect(navOf(page, info).locator('a[href="#/more"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#pChips [data-src]')).toHaveCount(0);
  await expect(page.locator('#pChips')).not.toContainText('Inspection');
  await expect(page.locator('#pChips')).not.toContainText('Cleaner report');
});

test('pastille Maintenance : nombre de propositions annonce par mgr:mntbadge', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER)], { email: true, hash: '#/more' });
  await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
  const nav = navOf(page, info);
  await expect(nav.locator('a[href="#/maintenance"] .nbadge')).toHaveCount(0);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('mgr:mntbadge', { detail: { proposals: 3 } })));
  await expect(nav.locator('a[href="#/maintenance"] .nbadge')).toHaveText('3');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('mgr:mntbadge', { detail: { proposals: 0 } })));
  await expect(nav.locator('a[href="#/maintenance"] .nbadge')).toHaveCount(0);
});

// ---------- Revue finale (F3, F8, F10) ----------

test('F3 : barre d onglets, une colonne par entree (2 pour Semax, 5 pour un manager)', async ({ page }, info) => {
  test.skip(info.project.name === 'mgr-desktop', 'barre d onglets du telephone');
  await bootMgr(page, [me(SEMAX)], { email: true });
  await expect(page.locator('#tabbar a')).toHaveCount(2);
  const cols = () => page.evaluate(() => getComputedStyle(document.getElementById('tabbar')!).gridTemplateColumns.split(' ').length);
  expect(await cols()).toBe(2);
  const w = await page.evaluate(() => {
    const bar = document.getElementById('tabbar')!.getBoundingClientRect();
    const last = document.querySelectorAll('#tabbar a')[1].getBoundingClientRect();
    return { bar: bar.right, last: last.right };
  });
  expect(w.bar - w.last).toBeLessThan(20);
});

test('F3 : manager, 5 colonnes', async ({ page }, info) => {
  test.skip(info.project.name === 'mgr-desktop', 'barre d onglets du telephone');
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 200, body: {} }], { email: true, hash: '#/more' });
  await expect(page.locator('#tabbar a')).toHaveCount(5);
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('tabbar')!).gridTemplateColumns.split(' ').length)).toBe(5);
});

test('F10 : Semax ouvre #/tasks (vue cachee, sans entree de navigation) et une push ?task= y arrive', async ({ page }, info) => {
  await bootMgr(page, [me(SEMAX), TASKS, { match: 'action=mgr.problem.get', status: 200, body: detailTsk() }],
    { email: true, hash: '#/tasks?ref=TSK-13' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(page.locator('#sheet [data-panel="TSK-13"]')).toBeVisible();
  const nav = navOf(page, info);
  await expect(nav.locator('a')).toHaveText(['Maintenance', 'Planning']);
  await expect(nav.locator('a[aria-current="page"]')).toHaveCount(0);
});

test('F8 : role garde par membre ; hors ligne, il ne sert qu au meme membre', async ({ page }, info) => {
  const nav = () => navOf(page, info).locator('a');
  // Connexion confirmee : role garde avec l'id du membre.
  await bootMgr(page, [me(SEMAX)], { email: true });
  await expect(nav()).toHaveText(['Maintenance', 'Planning']);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('mgrRole')))!)).toEqual({ id: 7, role: 'maintenance' });
});

for (const [label, storage, expected] of [
  ['meme membre : nav Semax', { mgrRole: JSON.stringify({ id: 7, role: 'maintenance' }), hkSessionCleanerId: '7' }, ['Maintenance', 'Planning']],
  ['autre membre : nav manager', { mgrRole: JSON.stringify({ id: 7, role: 'maintenance' }), hkSessionCleanerId: '8' }, ['Today', 'Planning', 'Maintenance', 'Inspections', 'More']],
  ['ancien format (texte) : ignore', { mgrRole: 'maintenance', hkSessionCleanerId: '7' }, ['Today', 'Planning', 'Maintenance', 'Inspections', 'More']],
  ['sans membre connu : ignore', { mgrRole: JSON.stringify({ id: 7, role: 'maintenance' }) }, ['Today', 'Planning', 'Maintenance', 'Inspections', 'More']],
] as const) {
  test('F8 : cleanerMe injoignable, ' + label, async ({ page }, info) => {
    await bootMgr(page, [{ match: 'action=cleanerMe', status: 0, body: null, fail: true }], { email: true, storage: storage as any });
    await expect(navOf(page, info).locator('a')).toHaveText(expected as any);
  });
}
