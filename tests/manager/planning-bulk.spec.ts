import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, PLAN, planningBody, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const boot = (page: Page, routes: any[], body: any = planningBody()) =>
  bootMgr(page, [me(MANAGER), PLAN(body), ...routes], { email: true, hash: HASH, clock: PNOW });

const card = (page: Page, key: string) => page.locator('.pj[data-job="' + key + '"]');
const bar = (page: Page) => page.locator('.pl-bulk');
const selectBtn = (page: Page) => page.locator('[data-select]');

// Sur telephone, une carte n'est visible que sur son jour.
// force : une carte aria-disabled recoit quand meme le toucher (Playwright attendrait sinon).
async function pick(page: Page, mobile: boolean, key: string, day: string, force = false) {
  if (mobile) await page.locator('.pl-strip [data-day="' + day + '"]').click();
  await card(page, key).click({ force });
}

test('Select : mode selection, la carte se coche sans ouvrir la fiche, Cancel vide tout', async ({ page }, info) => {
  await boot(page, []);
  await expect(selectBtn(page)).toHaveText('Select');
  await selectBtn(page).click();
  await expect(selectBtn(page)).toHaveText('Cancel');
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await expect(card(page, '2026-10-09_Bo Ray')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(bar(page)).toContainText('1 selected');
  await card(page, '2026-10-09_Cy Doe').click();
  await expect(bar(page)).toContainText('2 selected');
  await card(page, '2026-10-09_Cy Doe').click();
  await expect(card(page, '2026-10-09_Cy Doe')).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(page)).toContainText('1 selected');
  await selectBtn(page).click();
  await expect(selectBtn(page)).toHaveText('Select');
  await expect(bar(page)).toHaveCount(0);
  await expect(card(page, '2026-10-09_Bo Ray')).not.toHaveAttribute('aria-pressed', /.*/);
  // Hors mode selection, la carte rouvre la fiche.
  await card(page, '2026-10-09_Bo Ray').click();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
});

test('Clear dans la barre : vide la selection, reste en mode selection', async ({ page }, info) => {
  await boot(page, []);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await bar(page).getByRole('button', { name: 'Clear' }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(selectBtn(page)).toHaveText('Cancel');
  await expect(card(page, '2026-10-09_Bo Ray')).toHaveAttribute('aria-pressed', 'false');
});

test('menage fait ou annule : jamais selectionnable', async ({ page }, info) => {
  await boot(page, []);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06', true);
  // Sur telephone, chaque carte se verifie sur son jour.
  await expect(card(page, '2026-10-06_Ann Lee')).toHaveAttribute('aria-disabled', 'true');
  await expect(card(page, '2026-10-06_Ann Lee')).not.toHaveAttribute('aria-pressed', /.*/);
  await pick(page, isMobile(info), '2026-10-07_Ed Gu', '2026-10-07', true);
  await expect(card(page, '2026-10-07_Ed Gu')).toHaveAttribute('aria-disabled', 'true');
  await expect(card(page, '2026-10-07_Ed Gu')).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
});

test('Select all unassigned : le jour sur telephone, la semaine sur ordinateur', async ({ page }, info) => {
  const body = planningBody();
  const base = body.jobs.find((j: any) => j.key === '2026-10-09_Cy Doe');
  body.jobs.push({ ...base, key: '2026-10-08_Hu Ix', listingId: 'L7', apt: '707', bld: 'Tower G', date: '2026-10-08', guest: 'Hu Ix' });
  await boot(page, [], body);
  await expect(page.getByRole('button', { name: 'Select all unassigned' })).toHaveCount(0);
  await selectBtn(page).click();
  await page.getByRole('button', { name: 'Select all unassigned' }).click();
  const mobile = isMobile(info);
  await expect(bar(page)).toContainText((mobile ? 2 : 3) + ' selected');
  for (const k of ['2026-10-09_Bo Ray', '2026-10-09_Cy Doe']) await expect(card(page, k)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, '2026-10-09_Di Fox')).toHaveAttribute('aria-pressed', 'false');
  if (mobile) await page.locator('.pl-strip [data-day="2026-10-08"]').click();
  await expect(card(page, '2026-10-08_Hu Ix')).toHaveAttribute('aria-pressed', mobile ? 'false' : 'true');
});

test('Assign groupe : conge grise, une ecriture par menage avec sa cle, toast et Undo par menage', async ({ page }, info) => {
  const body = planningBody();
  body.jobs.find((j: any) => j.key === '2026-10-10_Fa Ho').serviceType = 'MSC';
  await boot(page, [{ match: 'action=assignCleaner', status: 200, body: OK }], body);
  const mobile = isMobile(info);
  await selectBtn(page).click();
  await pick(page, mobile, '2026-10-09_Bo Ray', '2026-10-09');
  await pick(page, mobile, '2026-10-10_Fa Ho', '2026-10-10');
  await expect(bar(page)).toContainText('2 selected');
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  const sh = page.locator('#sheet');
  await expect(sh).toHaveAttribute('aria-hidden', 'false');
  await expect(sh.locator('h2')).toHaveText('Assign 2 cleanings');
  const faiza = sh.locator('[data-pa="bulk-pick"][data-id="4"]');
  await expect(faiza).toBeDisabled();
  await expect(faiza).toContainText('On leave Sat 10');
  await expect(sh.locator('[data-pa="bulk-pick"][data-id="10"]')).toBeEnabled();
  await sh.locator('[data-pa="bulk-pick"][data-id="10"]').click();
  await expect(page.locator('#toast')).toContainText('2 cleanings assigned to Pionah');
  await expect(sh).toHaveAttribute('aria-hidden', 'true');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([
    { reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-10_Fa Ho', cleaner_ids: [10], mode: 'set', service_type: 'MSC' },
  ]);
  for (const b of w) { expect(b.idem).toMatch(IDEM); expect(b.actor).toBeUndefined(); }
  expect(w[0].idem).not.toBe(w[1].idem);
  // Sortie du mode selection, semaine rechargee.
  await expect(selectBtn(page)).toHaveText('Select');
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(async () => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).length).toBe(2);
  // Undo : chaque menage revient a sa propre liste d'avant.
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(4);
  const all = await writes(page, 'assignCleaner');
  expect(noIdem(all.slice(2))).toEqual([
    { reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-10_Fa Ho', cleaner_ids: [12], mode: 'set', service_type: 'MSC' },
  ]);
  expect(new Set(all.map((b) => b.idem)).size).toBe(4);
  await expect(page.locator('#toast')).toContainText('2 cleanings back to their previous assignment');
});

test('echec partiel : K of N, appartement et message du serveur, Undo seulement pour les reussis', async ({ page }, info) => {
  await boot(page, [
    { match: 'action=assignCleaner', status: 200, body: OK, once: true },
    { match: 'action=assignCleaner', status: 500, body: { error: 'Cleaner already busy' }, once: true },
    { match: 'action=assignCleaner', status: 200, body: OK },
  ]);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await card(page, '2026-10-09_Cy Doe').click();
  await card(page, '2026-10-09_Di Fox').click();
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pa="bulk-pick"][data-id="12"]').click();
  await expect(page.locator('#toast')).toContainText(
    '2 of 3 assigned to Elite Cleaning. Not assigned: Apt 909 · Bloom Height (Cleaner already busy).');
  expect((await writes(page, 'assignCleaner')).map((b) => b.reservation_key))
    .toEqual(['2026-10-09_Bo Ray', '2026-10-09_Cy Doe', '2026-10-09_Di Fox']);
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(5);
  const all = await writes(page, 'assignCleaner');
  expect(noIdem(all.slice(3))).toEqual([
    { reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-09_Di Fox', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
  ]);
});

test('changement de semaine : selection et mode effaces', async ({ page }, info) => {
  await boot(page, []);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await expect(bar(page)).toContainText('1 selected');
  await page.locator('[data-week="1"]').click();
  await expect(selectBtn(page)).toHaveText('Select');
  await expect(bar(page)).toHaveCount(0);
  await page.locator('[data-week="-1"]').click();
  await expect(card(page, '2026-10-09_Bo Ray')).toBeVisible();
  await expect(card(page, '2026-10-09_Bo Ray')).not.toHaveAttribute('aria-pressed', /.*/);
});

test('lecture seule (cache perime) : pas de bouton Select', async ({ page }) => {
  const cache = { v: 1, savedAt: PNOW.getTime() - 3600_000, owner: 'u-test', data: planningBody() };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.planning', status: 0, body: {}, fail: true }],
    { email: true, hash: HASH, clock: PNOW, storage: { mgrPlanningCache: JSON.stringify(cache) } });
  await expect(page.locator('main .banner')).toContainText('Data from 10:00');
  await expect(page.locator('.pj').first()).toBeVisible();
  await expect(selectBtn(page)).toHaveCount(0);
});
