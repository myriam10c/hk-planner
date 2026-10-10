import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const FIELDS = ['pillowcases', 'bed_sheets', 'duvet_covers', 'small_towels', 'face_towels', 'large_towels', 'bath_mats'];

test('Count linen : 7 champs obligatoires, boutons + et -, sans auteur', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=saveLaundryCount', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Count linen' }).click();
  await expect(sh.locator('h2')).toHaveText('Linen collected');
  const save = sh.getByRole('button', { name: 'Save count' });
  await expect(save).toBeDisabled();
  const plus = sh.locator('[data-pa="lq-step"][data-field="pillowcases"][data-d="1"]');
  await plus.click();
  await plus.click();
  await plus.click();
  await sh.locator('[data-pa="lq-step"][data-field="pillowcases"][data-d="-1"]').click();
  await expect(sh.locator('#lq_pillowcases')).toHaveValue('2');
  for (const f of FIELDS.slice(1)) await sh.locator('#lq_' + f).fill('1');
  await expect(save).toBeEnabled();
  await sh.locator('#lq_bath_mats').fill('');
  await expect(save).toBeDisabled();
  await sh.locator('#lq_bath_mats').fill('0');
  await save.click();
  await expect(page.locator('#toast')).toContainText('Linen count saved for Apt 805 · Azizi Riviera 39');
  const w = await writes(page, 'saveLaundryCount');
  expect(noIdem(w)).toEqual([{
    reservation_key: '2026-10-09_Di Fox', pillowcases: 2, bed_sheets: 1, duvet_covers: 1,
    small_towels: 1, face_towels: 1, large_towels: 1, bath_mats: 0,
  }]);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[0].author).toBeUndefined();
});

test('linge deja compte : prerempli, Save changes', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=saveLaundryCount', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Edit linen count' }).click();
  await expect(sh.locator('#lq_pillowcases')).toHaveValue('4');
  await expect(sh.locator('#lq_bath_mats')).toHaveValue('2');
  await sh.locator('#lq_bath_mats').fill('3');
  await sh.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#toast')).toContainText('Linen count saved for Apt 308 · Binghatti Lavender');
  expect(noIdem(await writes(page, 'saveLaundryCount'))[0].bath_mats).toBe(3);
});

test('refus du serveur : message tel quel, Save rendu selon les champs', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=saveLaundryCount', status: 400, body: { error: 'bath_mats is out of range' } }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Edit linen count' }).click();
  await sh.getByRole('button', { name: 'Save changes' }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('bath_mats is out of range');
  await expect(sh.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});
