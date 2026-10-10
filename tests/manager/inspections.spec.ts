import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW, todayBody } from './fixtures';

import { card, INSP_TODAY, OVERVIEW, HISTORY, REPORTS, KEYS, START } from './insp-fixtures';

const navOf = (page: any, info: any) => (info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar'));
const boot = (page: any, extra: any[] = [], hash = '#/inspections', opts: any = {}) =>
  bootMgr(page, [me(MANAGER), INSP_TODAY(), OVERVIEW, HISTORY, REPORTS, ...extra], { email: true, hash, ...opts });

test('Today : liste, entree courante, pas de lien Back, un seul main', async ({ page }, info) => {
  await boot(page);
  await expect(page.getByText("Today's inspections")).toBeVisible();
  await expect(page.getByText('Apt 101 · Tower A')).toBeVisible();
  await expect(navOf(page, info).locator('a[href="#/inspections"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: 'Back to HK Planner' })).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll('main').length)).toBe(1);
});

test('Fleet : hash traduit, nav visible, bouton Back vers Today', async ({ page }, info) => {
  await boot(page);
  await page.getByRole('button', { name: 'Fleet' }).click();
  await expect(page).toHaveURL(/#\/inspections\/fleet$/);
  await expect(page.getByRole('heading', { name: 'Fleet', exact: true })).toBeVisible();
  await expect(navOf(page, info)).toBeVisible();
  await expect(navOf(page, info).locator('a[href="#/inspections"]')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/inspections$/);
  await expect(page.getByText("Today's inspections")).toBeVisible();
});

test('historique d un logement depuis Fleet, retour vers Fleet', async ({ page }) => {
  await boot(page, [], '#/inspections/fleet');
  await page.getByText('Apt 202 · Tower B').click();
  await expect(page).toHaveURL(/#\/inspections\/history\/B$/);
  await expect(page.getByRole('heading', { name: 'Apt 202 · Tower B' })).toBeVisible();
  await expect(page.getByText('Good overall')).toBeVisible();
  await page.getByRole('button', { name: 'Back to fleet', exact: true }).click();
  await expect(page).toHaveURL(/#\/inspections\/fleet$/);
});

test('manager : bouton Reports ouvre les rapports', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/#\/inspections\/reports$/);
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
});

test('Start inspection puis retour sur Today manager sans erreur de page', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await bootMgr(page, [me(MANAGER), INSP_TODAY(8), START(), { match: 'action=mgr.today', status: 200, body: todayBody() }],
    { email: true, hash: '#/inspections', clock: NOW });
  await page.getByRole('button', { name: 'Start inspection' }).click();
  await expect(page).toHaveURL(/#\/inspections\/inspect\/A\?e=checkout$/);
  await expect(page.getByText('0 / 11 zones')).toBeVisible();
  await navOf(page, info).locator('a[href="#/today"]').click();
  await expect(page.getByRole('heading', { name: 'Team control', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Finish : toast, retour sur Today inspections', async ({ page }) => {
  const items = KEYS.map((k) => ({ zone: k, status: 'ok' }));
  await boot(page, [START(items), { status: 200, match: 'action=insp.finish', body: { inspection: { id: 41, finishedAt: '2026-10-06T07:10:00Z' } } }],
    '#/inspections/inspect/A?e=checkout');
  await page.getByRole('button', { name: 'Finish inspection' }).click();
  await expect(page.getByText('Inspection saved')).toBeVisible();
  await expect(page).toHaveURL(/#\/inspections$/);
  await expect(page.getByText("Today's inspections")).toBeVisible();
});

test('module introuvable : message, Retry et lien vers /inspections/', async ({ page }) => {
  await page.route('**/inspections/fleet.js', (r) => r.abort());
  await boot(page, [], '#/inspections/fleet');
  await expect(page.getByText('Could not load Inspections.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Inspections' })).toHaveAttribute('href', '/inspections/');
});

test('me null (hors ligne) : message de connexion, pas d erreur de page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await bootMgr(page, [{ match: 'action=cleanerMe', status: 200, body: {}, fail: true }], { email: true, hash: '#/inspections' });
  await expect(page.getByText('Inspections need a connection.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(async () => (await fetchLog(page)).filter((l) => l.url.includes('action=cleanerMe')).length).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('parseInspHash et toShellHash', async ({ page }) => {
  await boot(page);
  const r = await page.evaluate(async () => {
    const m = await import('/manager/screens/inspections.js');
    return [
      m.parseInspHash('#/inspections'), m.parseInspHash('#/inspections/inspect/12%2034?e=vacant'),
      m.parseInspHash('#/inspections/history'), m.parseInspHash('#/inspections/zzz'),
      m.toShellHash('#/'), m.toShellHash('#/fleet'), m.toShellHash('#/inspect/A?e=adhoc'),
    ];
  });
  expect(r).toEqual([
    { sub: '', id: null, entry: null }, { sub: 'inspect', id: '12 34', entry: 'vacant' },
    { sub: '', id: null, entry: null }, { sub: '', id: null, entry: null },
    '#/inspections', '#/inspections/fleet', '#/inspections/inspect/A?e=adhoc',
  ]);
});

test('Today manager : lien Open inspections dans Team control', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 200, body: todayBody() }], { email: true, clock: NOW });
  await expect(page.getByRole('link', { name: 'Open inspections' })).toHaveAttribute('href', '#/inspections');
});
