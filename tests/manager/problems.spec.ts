import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { NOW } from './fixtures';
import { detailTask, listBody, manyRows, TROW } from './problem-fixtures';

const LIST = (body: any = listBody()) => ({ match: 'action=mgr.problems', status: 200, body });
const lists = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problems')).map((l) => l.url);

test('liste des taches : titre Tasks, ordre du serveur, ref en Fragment Mono, logement, echeance', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST()], { email: true, clock: NOW, hash: '#/tasks' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  const rows = page.locator('.prow');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('.pref')).toHaveText(['TSK-429', 'TSK-13', 'TSK-501']);
  expect(await rows.first().locator('.pref').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Fragment Mono');
  await expect(rows.nth(0)).toContainText('Apt 308 · Binghatti Lavender');
  await expect(rows.nth(0)).toContainText('Unassigned');
  await expect(rows.nth(1)).toContainText('Overdue 15/05');
  await expect(rows.nth(2)).toContainText('Due 12/10');
  const u = (await lists(page))[0];
  expect(u).toContain('offset=0');
  expect(u).toContain('limit=50');
});

test('puces : Urgent, logement ; chaque changement relit la liste avec ses filtres', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST()], { email: true, clock: NOW, hash: '#/tasks' });
  await expect(page.locator('.prow')).toHaveCount(3);
  await page.locator('#pChips [data-chip="urgent"]').click();
  await expect(page.locator('#pChips [data-chip="urgent"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pChips [data-apt-open]').click();
  await expect(page.locator('#sheet')).toContainText('Apartments with open tasks');
  await page.locator('#sheet [data-apt="L1"]').click();
  await expect.poll(async () => (await lists(page)).pop() || '').toContain('listingId=L1');
  const u = (await lists(page)).pop()!;
  expect(u).toContain('urgent=1');
  expect(u).not.toContain('source=');
  expect(u).not.toContain('mine=1');
  await expect(page.locator('#pChips [data-apt-open]')).toHaveText('Apt 308 · Binghatti Lavender');
});

test('recherche : une seule lecture apres la frappe, q dans la requete, Clear filters', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...LIST(), once: true }, LIST(listBody({ rows: [], total: 0 }))], { email: true, clock: NOW, hash: '#/tasks' });
  await expect(page.locator('.prow')).toHaveCount(3);
  await page.locator('#pSearch').pressSequentially('gas', { delay: 30 });
  await expect(page.locator('#pList')).toContainText('Nothing matches these filters.');
  const l = await lists(page);
  expect(l.length).toBe(2);
  expect(l[1]).toContain('q=gas');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('#pSearch')).toHaveValue('');
});

test('pages de 50 : Load more demande offset=50 et ajoute a la suite', async ({ page }) => {
  const first = listBody({ rows: manyRows(50, 1000), total: 60 });
  const second = listBody({ rows: manyRows(10, 1050), total: 60, offset: 50 });
  await bootMgr(page, [me(MANAGER), { match: 'offset=50', status: 200, body: second }, LIST(first)], { email: true, clock: NOW, hash: '#/tasks' });
  await expect(page.locator('.prow')).toHaveCount(50);
  await expect(page.locator('.pfoot')).toContainText('50 of 60');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.locator('.prow')).toHaveCount(60);
  await expect(page.locator('.prow').last().locator('.pref')).toHaveText('TSK-1059');
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});

test('reseau coupe avec la derniere liste en cache : bandeau Data from, lecture seule', async ({ page }) => {
  const cache = JSON.stringify({ v: 1, owner: 'u-test', savedAt: Date.parse('2026-10-09T05:42:00Z'), data: listBody() });
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.problems', status: 0, body: null, fail: true },
    { match: 'action=mgr.problem.get', status: 200, body: detailTask() }],
  { email: true, clock: NOW, hash: '#/tasks', storage: { mgrProblemsCache: cache } });
  await expect(page.locator('.banner.warn')).toContainText('Data from 09:42. No connection. Try again.');
  await expect(page.locator('.prow')).toHaveCount(3);
  await page.locator('.prow').first().click();
  await expect(page.locator('#sheet .ro-note')).toHaveText('Reconnect to make changes.');
});

test('rien d ouvert : message simple, sans bouton', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST(listBody({ rows: [], total: 0 }))], { email: true, clock: NOW, hash: '#/tasks' });
  await expect(page.locator('#pList')).toContainText('Nothing open.');
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('aucun defilement horizontal, titres longs (' + scheme + ')', async ({ page }) => {
      const long = listBody({ rows: [TROW({ title: 'Water leaking under the kitchen sink near the dishwasher '.repeat(3) }), ...listBody().rows.slice(1)] });
      await bootMgr(page, [me(MANAGER), LIST(long)], { email: true, clock: NOW, hash: '#/tasks' });
      await expect(page.locator('.prow')).toHaveCount(3);
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    });
  });
}

test('relecture ratee apres un changement de puce : puces de la liste affichee, pas de Load more', async ({ page }) => {
  const first = listBody({ rows: manyRows(50, 1000), total: 60 });
  await bootMgr(page, [me(MANAGER), { match: 'urgent=1', status: 0, body: null, fail: true }, LIST(first)],
    { email: true, clock: NOW, hash: '#/tasks' });
  await expect(page.locator('.prow')).toHaveCount(50);
  await expect(page.getByRole('button', { name: 'Load more' })).toBeVisible();
  await page.locator('#pChips [data-chip="urgent"]').click();
  await expect(page.locator('.banner.warn')).toContainText('No connection. Try again.');
  await expect(page.locator('#pChips [data-chip="urgent"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.prow')).toHaveCount(50);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  expect((await lists(page)).filter((u) => u.includes('offset=50')).length).toBe(0);
});
