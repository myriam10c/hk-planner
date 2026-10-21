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

test('ecran plein sans abonnement : Turn on notifications et Not now, Not now le cache pour la journee', async ({ page }) => {
  await page.context().grantPermissions(['notifications']).catch(() => {});
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 503, body: { error: 'x' } }], { email: true, storage: { mgrPushLater: '' } });
  const state = await page.evaluate(async () => (await import('/manager/push.js')).pushState());
  test.skip(state !== 'off', 'Etat push de ce navigateur de test : ' + state);
  const scr = page.locator('#pushPrompt');
  await expect(scr).toBeVisible();
  await expect(scr.getByRole('heading', { name: 'Turn on notifications' })).toBeVisible();
  await expect(scr).toContainText('Turn on notifications to get urgent problems on this phone.');
  await expect(scr.getByRole('button', { name: 'Turn on notifications' })).toBeFocused();
  await scr.getByRole('button', { name: 'Not now' }).click();
  await expect(scr).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('#pushPrompt')).toHaveCount(0);
});

test('titres de l ecran plein selon l etat', async ({ page }) => {
  await bootMgr(page, [me(MANAGER)], { email: true });
  const t = await page.evaluate(async () => {
    const m = await import('/manager/push-bar.js');
    return [m.pushPromptTitle('off'), m.pushPromptTitle('denied'), m.pushPromptTitle('unsupported')];
  });
  expect(t).toEqual(['Turn on notifications', 'Notifications are blocked', 'Add HK Planner to your Home Screen']);
});
