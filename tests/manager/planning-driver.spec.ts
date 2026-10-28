import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { PLAN, planningBody, PNOW } from './planning-fixtures';

// Planning du chauffeur (28/10/2026) : managers seulement, message WhatsApp de la veille.
const HASH = '#/planning';
const body = () => {
  const b = planningBody();
  b.jobs.find((j: any) => j.key === '2026-10-09_Di Fox').addr = 'Azizi Riviera 39 - Meydan';
  return b;
};

test('Driver : demain propose, tournee par personne, adresse avec quartier', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), PLAN(body())], { email: true, hash: HASH, clock: PNOW });
  await page.locator('[data-driver]').click();
  await expect(page.locator('#sheetTitle')).toHaveText('Driver schedule');
  await expect(page.locator('#sheet .sub')).toContainText('Saturday 10 October');
  await expect(page.locator('#drvText')).toHaveText([
    '🚐 *DRIVER SCHEDULE · Sat 10*',
    'Start: pick up the team and the clean linen at the office.',
    '',
    '*Elite Cleaning*',
    '1. Apt 505 · Tower E · free from 11:00',
    '',
    'End: pick up each cleaner at the last apartment and bring the dirty linen back to the office.',
    '1 cleaning · 1 cleaner',
  ].join('\n'));
  await page.locator('#sheet [data-pa="driver-day"][data-date="2026-10-09"]').click();
  await expect(page.locator('#drvText')).toContainText('*Pionah*\n1. Apt 805 · Azizi Riviera 39 - Meydan\n2. Apt 808 · Tower H');
  await expect(page.locator('#sheet .sheet-warn')).toContainText('2 cleanings not assigned yet');
  await expect(page.locator('#sheet .sheet-warn')).toContainText('Apt 103 · Damac Reva');
});

test('Driver : Share envoie le texte au partage du telephone', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__shared = [];
    (navigator as any).share = async (d: any) => { (window as any).__shared.push(d); };
  });
  await bootMgr(page, [me(MANAGER), PLAN(body())], { email: true, hash: HASH, clock: PNOW });
  await page.locator('[data-driver]').click();
  await page.locator('#sheet [data-pa="driver-share"]').click();
  const shared = await page.evaluate(() => (window as any).__shared);
  expect(shared.length).toBe(1);
  expect(shared[0].text).toContain('*Elite Cleaning*');
  expect(shared[0].files).toBeUndefined();
});

test('Driver : absent pour le role maintenance', async ({ page }) => {
  await bootMgr(page, [me({ ...MANAGER, id: 9, name: 'Semax', role: 'maintenance' }), PLAN(body())], { email: true, hash: HASH, clock: PNOW });
  await expect(page.locator('main h1')).toHaveText('Planning');
  await expect(page.locator('.pj').first()).toBeVisible();
  await expect(page.locator('[data-driver]')).toHaveCount(0);
});
