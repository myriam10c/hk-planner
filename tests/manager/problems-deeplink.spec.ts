import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW } from './fixtures';
import { detailTask, listBody, TROW } from './problem-fixtures';

const LIST = { match: 'action=mgr.problems', status: 200, body: listBody() };
const hashOf = (page: any) => page.evaluate(() => location.hash);
const gets = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problem.get')).length;

test('lien #/tasks?ref= : la fiche d un probleme de la liste s ouvre au chargement', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST, { match: 'action=mgr.problem.get', status: 200, body: detailTask() }],
    { email: true, clock: NOW, hash: '#/tasks?ref=TSK-429' });
  await expect(page.locator('#sheet [data-panel="TSK-429"]')).toBeVisible();
  await expect(page.locator('#sheet')).toContainText('Gas not working');
  await expect(page.locator('.prow')).toHaveCount(3);
  expect(await hashOf(page)).toBe('#/tasks?ref=TSK-429');
});

test('lien vers un probleme hors de la liste : lu par mgr.problem.get puis ouvert', async ({ page }) => {
  const other = TROW({ ref: 'TSK-777', id: 777, title: 'Door lock jammed' });
  await bootMgr(page, [me(MANAGER), LIST, { match: 'action=mgr.problem.get', status: 200, body: detailTask({ problem: other }) }],
    { email: true, clock: NOW, hash: '#/tasks?ref=TSK-777' });
  await expect(page.locator('#sheet [data-panel="TSK-777"]')).toBeVisible();
  await expect(page.locator('#sheet')).toContainText('Door lock jammed');
  const log = await fetchLog(page);
  expect(log.some((l) => l.url.includes('action=mgr.problem.get') && l.url.includes('ref=TSK-777'))).toBe(true);
});

test('lien vers un probleme inconnu (404) : toast, la liste reste, le hash redevient #/tasks', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST, { match: 'action=mgr.problem.get', status: 404, body: { error: 'Problem not found' } }],
    { email: true, clock: NOW, hash: '#/tasks?ref=TSK-999' });
  await expect(page.locator('#toast')).toContainText('This problem was not found. It may be closed.');
  await expect(page.locator('.prow')).toHaveCount(3);
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(() => hashOf(page)).toBe('#/tasks');
});

test('fermer la fiche ramene le hash a #/tasks, un clic le remet sans nouvelle navigation', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST, { match: 'action=mgr.problem.get', status: 200, body: detailTask() }],
    { email: true, clock: NOW, hash: '#/tasks?ref=TSK-429' });
  await expect(page.locator('#sheet [data-panel="TSK-429"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(() => hashOf(page)).toBe('#/tasks');
  const before = await page.evaluate(() => history.length);
  await page.locator('.prow').first().click();
  await expect(page.locator('#sheet [data-panel="TSK-429"]')).toBeVisible();
  expect(await hashOf(page)).toBe('#/tasks?ref=TSK-429');
  expect(await page.evaluate(() => history.length)).toBe(before);
  expect(await gets(page)).toBe(2);
});

test('Retour du navigateur depuis un lien de la fiche logement revient a la fiche logement', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST, { match: 'action=mgr.problem.get', status: 200, body: detailTask() }],
    { email: true, clock: NOW, hash: '#/more' });
  await page.evaluate(() => { location.hash = '#/tasks?ref=TSK-429'; });
  await expect(page.locator('#sheet [data-panel="TSK-429"]')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await hashOf(page)).toBe('#/more');
});
