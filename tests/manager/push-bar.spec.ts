import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';

test('bandeau notifications : texte selon l etat, rien quand c est deja actif', async ({ page }) => {
  await bootMgr(page, [me(MANAGER)], { email: true });
  const t = await page.evaluate(async () => {
    const m = await import('/manager/push-bar.js');
    return {
      off: m.pushBarText('off', false, false),
      on: m.pushBarText('on', false, false),
      denied: m.pushBarText('denied', false, false),
      iosWeb: m.pushBarText('unsupported', true, false),
      iosApp: m.pushBarText('unsupported', true, true),
      desk: m.pushBarText('unsupported', false, false),
    };
  });
  expect(t.off).toEqual({ text: 'Turn on notifications to get urgent problems on this phone.', action: true });
  expect(t.on).toBeNull();
  expect(t.denied && t.denied.action).toBe(false);
  expect(t.iosWeb && t.iosWeb.text).toContain('Home Screen');
  expect(t.iosApp).toBeNull();
  expect(t.desk).toBeNull();
});

test('bandeau affiche sans abonnement : Allow et Later, Later le cache pour la journee', async ({ page }) => {
  await page.context().grantPermissions(['notifications']).catch(() => {});
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 503, body: { error: 'x' } }], { email: true, storage: { mgrPushLater: '' } });
  const bar = page.locator('#pushBar');
  const state = await page.evaluate(async () => (await import('/manager/push.js')).pushState());
  test.skip(state !== 'off', 'Etat push de ce navigateur de test : ' + state);
  await expect(bar).toContainText('Turn on notifications to get urgent problems on this phone.');
  await expect(bar.getByRole('button', { name: 'Allow' })).toBeVisible();
  await bar.getByRole('button', { name: 'Later' }).click();
  await expect(bar).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('#pushBar')).toHaveCount(0);
});
