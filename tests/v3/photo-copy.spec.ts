import { expect, test } from '@playwright/test';
import { demarrer, photo } from './conv-helpers';

// Copie de chaque photo dans le telephone (26/10) : sur Android, un telechargement par photo
// (dossier Download, visible dans la Galerie), nomme appartement + piece + heure.

test.describe('Android', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36' });

  test('chaque photo est aussi enregistree dans le telephone', async ({ page }) => {
    await demarrer(page);
    await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
    await page.locator('[data-reply="here"]').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), photo(page)]);
    expect(dl.suggestedFilename()).toMatch(/^HK_1011C-Bloom-Towers_Access-card_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jpg$/);
    await page.locator('.vf [data-reply="next-room"]').click();
    const [dl2] = await Promise.all([page.waitForEvent('download'), photo(page)]);
    expect(dl2.suggestedFilename()).toMatch(/^HK_1011C-Bloom-Towers_Bed_/);
  });
});

test('iPhone : aucun telechargement', async ({ page }) => {
  let n = 0;
  page.on('download', () => { n += 1; });
  await demarrer(page);
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await photo(page);
  await expect(page.locator('.vf .count')).toHaveText('1 photo');
  await page.waitForTimeout(500);
  expect(n).toBe(0);
});
