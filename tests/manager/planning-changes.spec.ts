import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const boot = (page: any, routes: any[]) => bootMgr(page, [me(MANAGER), ...routes, PLAN()], { email: true, hash: HASH, clock: PNOW });

test('Cancel avec raison puis Undo', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setCancelled', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Cancel cleaning' }).click();
  await expect(sh.locator('h2')).toHaveText('Cancel this cleaning?');
  await sh.locator('#pReason').fill('Owner arrived early');
  await sh.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva cancelled');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'setCancelled')).length).toBe(2);
  const w = await writes(page, 'setCancelled');
  expect(noIdem(w)).toEqual([
    { key: '2026-10-09_Bo Ray', cancelled: true, reason: 'Owner arrived early' },
    { key: '2026-10-09_Bo Ray', cancelled: false },
  ]);
  expect(w[0].idem).toMatch(IDEM);
});

test('menage annule : Restore cleaning, rien d autre', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setCancelled', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-07_Ed Gu', '2026-10-07');
  const sh = page.locator('#sheet');
  await expect(sh).toContainText('Guest extended · by Walter');
  await expect(sh.locator('[data-pa="postpone"]')).toHaveCount(0);
  await sh.getByRole('button', { name: 'Restore cleaning' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 404 · Elysee 1 restored');
  expect(noIdem(await writes(page, 'setCancelled'))).toEqual([{ key: '2026-10-07_Ed Gu', cancelled: false }]);
});

test('Postpone : au lendemain, alerte sur l arrivee suivante, Undo', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setPostponed', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Postpone' }).click();
  await expect(sh.locator('.sheet-warn')).toHaveText('Next guest checks in Sat 10 at 16:00. The cleaning must be done before.');
  await sh.getByRole('button', { name: 'Move to Sat 10' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 805 · Azizi Riviera 39 moved to Sat 10');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'setPostponed')).length).toBe(2);
  expect(noIdem(await writes(page, 'setPostponed'))).toEqual([
    { key: '2026-10-09_Di Fox', postpone: true, new_date: '2026-10-10', original_date: '2026-10-09' },
    { key: '2026-10-09_Di Fox', postpone: false },
  ]);
});

test('menage deja reporte : garde la premiere date d origine, Restore date', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setPostponed', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-07_Gi Lo', '2026-10-08');
  const sh = page.locator('#sheet');
  await expect(sh).toContainText('from Wednesday 7 October');
  await sh.getByRole('button', { name: 'Postpone' }).click();
  await sh.getByRole('button', { name: 'Move to Fri 9' }).click();
  await expect(page.locator('#toast')).toContainText('moved to Fri 9');
  await openJob(page, isMobile(info), '2026-10-07_Gi Lo', '2026-10-08');
  await sh.getByRole('button', { name: 'Restore date' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 606 · Tower F back to Wed 7');
  expect(noIdem(await writes(page, 'setPostponed'))).toEqual([
    { key: '2026-10-07_Gi Lo', postpone: true, new_date: '2026-10-09', original_date: '2026-10-07' },
    { key: '2026-10-07_Gi Lo', postpone: false },
  ]);
});

test('reseau coupe pendant Postpone : message, puis meme cle au second essai', async ({ page }, info) => {
  await boot(page, [
    { match: 'action=setPostponed', status: 0, body: {}, fail: true, once: true },
    { match: 'action=setPostponed', status: 200, body: OK },
  ]);
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Postpone' }).click();
  await sh.getByRole('button', { name: 'Move to Sat 10' }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('No connection. Try again.');
  await sh.getByRole('button', { name: 'Move to Sat 10' }).click();
  await expect(page.locator('#toast')).toContainText('moved to Sat 10');
  const w = await writes(page, 'setPostponed');
  expect(w.length).toBe(2);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[1].idem).toBe(w[0].idem);
});
