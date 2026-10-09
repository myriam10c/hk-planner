import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { NOW, todayBody } from './fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('4 blocs, statuts, alerte, aucun defilement horizontal (' + scheme + ')', async ({ page }, info) => {
      await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
      const h = (name: string) => page.getByRole('heading', { name, exact: true });
      await expect(h('Who does what today')).toBeVisible();
      await expect(h('Open problems')).toBeVisible();
      await expect(h('Team control')).toBeVisible();
      await expect(h('Ready for today’s arrivals')).toBeVisible();
      await expect(page.getByText('Data as of 11:00')).toBeVisible();
      await expect(page.locator('.alert')).toContainText('1 arrival blocked');
      await expect(page.locator('.strip')).toContainText('without a cleaner');
      await expect(page.getByText('No cleaner assigned, and urgent ticket open: Gas not working (#429).')).toBeVisible();
      await expect(page.getByText('Not started yet, Faiza. Guest in 4 h, checkout time not set.')).toBeVisible();
      await expect(page.locator('.arr', { hasText: 'Owner stay' })).toContainText('Usually Elite · not logged yet');
      await expect(page.locator('.person.unassigned')).toContainText('Usually Elite · not logged yet');
      const faiza = page.locator('.person', { hasText: 'Faiza' }).first();
      await expect(faiza).toContainText('--:--');
      await expect(faiza).toContainText('checkout time not set');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(10, 11, 14)' : 'rgb(243, 244, 247)');
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      const y = async (name: string) => (await h(name).boundingBox())!.y;
      if (info.project.name === 'mgr-mobile') {
        expect(await y('Who does what today')).toBeLessThan(await y('Open problems'));
        expect(await y('Open problems')).toBeLessThan(await y('Team control'));
        expect(await y('Team control')).toBeLessThan(await y('Ready for today’s arrivals'));
      } else {
        expect(Math.abs((await y('Who does what today')) - (await y('Open problems')))).toBeLessThan(2);
      }
    });
  });
}

test('mgr.today part avec le Bearer de la session email', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
  const log = await fetchLog(page);
  expect(log.find((l) => l.url.includes('action=mgr.today'))!.headers['Authorization']).toBe('Bearer jwt-test');
});

test('fiche arrivee au clavier : fleches, Entree, Echap rend le focus', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  const rows = page.locator('.arr');
  await expect(rows).toHaveCount(4);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.getByRole('heading', { name: 'Apt 103 · Damac Reva' })).toBeVisible();
  await expect(sheet).toContainText('Today, checkout time not set');
  if (info.project.name === 'mgr-desktop') {
    const box = await sheet.boundingBox();
    expect(Math.round(box!.width)).toBe(460);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(rows.nth(1)).toBeFocused();
});

test('probleme : fiche en lecture seule avec lien vers l app actuelle', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await page.locator('.prob', { hasText: 'Gas not working' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Open in the current app' })).toHaveAttribute('href', '/?legacy=1');
  await sheet.getByRole('button', { name: 'Close' }).last().click();
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
});

test('erreur du proxy sans donnees : message et Retry, jamais d ecran blanc', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 500, body: { error: 'Internal error' }, once: true }, TODAY()], { email: true, clock: NOW });
  await expect(page.locator('.err-card')).toContainText('Internal error');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
});
