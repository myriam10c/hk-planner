import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const boot = (page: any, routes: any[]) => bootMgr(page, [me(MANAGER), PLAN(), ...routes], { email: true, hash: HASH, clock: PNOW });

test('Assign : deux personnes, assignCleaner en mode set, sans auteur, puis rechargement', async ({ page }, info) => {
  await boot(page, [{ match: 'action=assignCleaner', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(sh.locator('h2')).toHaveText('Assign');
  await sh.locator('[data-pa="toggle"][data-id="4"]').click();
  await sh.locator('[data-pa="toggle"][data-id="10"]').click();
  await expect(sh.locator('[data-pa="toggle"][data-id="10"]')).toHaveAttribute('aria-pressed', 'true');
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva assigned to Faiza and Pionah');
  await expect(sh).toHaveAttribute('aria-hidden', 'true');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([{ reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [4, 10], mode: 'set', service_type: 'CHC' }]);
  expect(w[0].idem).toMatch(IDEM);
  await expect.poll(async () => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).length).toBe(2);
  // Undo : remet la liste d'avant (personne), nouveau geste donc nouvelle cle.
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  const all = await writes(page, 'assignCleaner');
  expect(noIdem(all)[1]).toEqual({ reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [], mode: 'set', service_type: 'CHC' });
  expect(all[1].idem).not.toBe(all[0].idem);
});

test('conge : la personne en conge ce jour-la est grisee « On leave »', async ({ page }, info) => {
  await boot(page, []);
  await openJob(page, isMobile(info), '2026-10-10_Fa Ho', '2026-10-10');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Reassign' }).click();
  const faiza = sh.locator('[data-pa="toggle"][data-id="4"]');
  await expect(faiza).toBeDisabled();
  await expect(faiza).toContainText('On leave');
  await expect(sh.locator('[data-pa="toggle"][data-id="12"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(sh.locator('[data-pa="toggle"][data-id="10"]')).toContainText('0 jobs that day');
});

test('refus du serveur (conge) : message tel quel, boutons rendus, personne en conge toujours grisee', async ({ page }, info) => {
  await boot(page, [{ match: 'action=assignCleaner', status: 409, body: { error: 'Pionah is on approved leave on 2026-10-10' } }]);
  await openJob(page, isMobile(info), '2026-10-10_Fa Ho', '2026-10-10');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Reassign' }).click();
  await sh.locator('[data-pa="toggle"][data-id="10"]').click();
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('Pionah is on approved leave on 2026-10-10');
  await expect(sh.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(sh.locator('[data-pa="toggle"][data-id="4"]')).toBeDisabled();
  await expect(sh).toHaveAttribute('aria-hidden', 'false');
});

test('double clic sur Save : une seule ecriture', async ({ page }, info) => {
  await boot(page, [{ match: 'action=assignCleaner', status: 200, body: OK, delay: 400 }]);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Assign', exact: true }).click();
  await sh.locator('[data-pa="toggle"][data-id="10"]').click();
  await sh.getByRole('button', { name: 'Save', exact: true }).dblclick();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('Mark done puis Undo : setDone vrai puis faux, deux gestes', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setDone', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  await page.locator('#sheet').getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 805 · Azizi Riviera 39 marked done');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'setDone')).length).toBe(2);
  const w = await writes(page, 'setDone');
  expect(noIdem(w)).toEqual([{ key: '2026-10-09_Di Fox', done: true }, { key: '2026-10-09_Di Fox', done: false }]);
  expect(w[0].idem).not.toBe(w[1].idem);
  for (const b of w) expect(b.actor).toBeUndefined();
});

test('menage fait : Undo done, ni Assign ni Postpone ni Cancel', async ({ page }, info) => {
  await boot(page, []);
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  const sh = page.locator('#sheet');
  await expect(sh.getByRole('button', { name: 'Undo done' })).toBeVisible();
  for (const pa of ['assign', 'postpone', 'cancel']) await expect(sh.locator('[data-pa="' + pa + '"]')).toHaveCount(0);
});
