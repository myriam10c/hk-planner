import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';

const SETTINGS = {
  autopilot: true, inspectionTarget: 4, excludedCount: 3,
  templates: [{ id: 1, name: 'Standard', items: 12 }, { id: 2, name: 'Deep clean', items: 20 }],
  push: { vapidPublicKey: 'BKEY' },
};
const RUN = {
  checkouts: 5, alreadyAssigned: 2, newlyAssigned: 3, autoSendEnabled: true,
  notified: [
    { cleaner: 'Faiza', phone: '+971501112222', tasks: 3, message: 'Hi', waLink: 'https://wa.me/+971501112222?text=Hi', autoSendEnabled: true },
    { cleaner: 'Pionah', phone: '+971503334444', tasks: 2, message: 'Hi', waLink: 'https://wa.me/+971503334444?text=Hi', autoSendEnabled: true },
  ],
};

// mgr.settings.set avant mgr.settings : les routes du faux fetch se testent par sous-chaine.
const boot = (page: any, extra: FakeRoute[] = [], read: FakeRoute[] = [{ match: 'action=mgr.settings', status: 200, body: SETTINGS }]) =>
  bootMgr(page, [me(MANAGER), ...extra, ...read], { email: true, hash: '#/more/settings' });

const posts = async (page: any, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=' + action + '&') || l.url.endsWith('action=' + action)).map((l) => l.body);

test('sections : autopilote, notifications, inspections, checklists, retour More', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  for (const h of ['Autopilot', 'Notifications', 'Inspections', 'Checklists']) {
    await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('switch', { name: 'Send cleaners their jobs automatically' })).toBeChecked();
  await expect(page.getByText('Quiet hours 22:00 to 08:30 Dubai time.')).toBeVisible();
  await expect(page.getByLabel('Daily inspection target')).toHaveValue('4');
  await expect(page.getByText('3 apartments excluded from inspections')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Manage exclusions' })).toHaveAttribute('href', '#/inspections/fleet');
  const items = page.locator('main [data-checklists] li');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText('Standard · 12 steps');
  await expect(items.nth(1)).toHaveText('Deep clean · 20 steps');
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  // L'interrupteur se tape par toute sa ligne (label), c'est elle qui est mesuree.
  for (const el of await page.locator('main button, main a, main input:not([role=switch]), main label.set-switch').all()) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test('interrupteur autopilote : poste {key, value:false} puis toast Saved', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.settings.set', status: 200, body: { ok: true, settings: { ...SETTINGS, autopilot: false } } }]);
  const sw = page.getByRole('switch', { name: 'Send cleaners their jobs automatically' });
  await expect(sw).toBeChecked();
  await sw.click();
  await expect(page.locator('#toast')).toContainText('Saved');
  await expect(sw).not.toBeChecked();
  expect((await posts(page, 'mgr.settings.set')).map((b) => JSON.parse(b))).toEqual([{ key: 'autopilot', value: false }]);
});

test('interrupteur autopilote : echec serveur affiche le message et revient', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.settings.set', status: 500, body: { error: 'Internal error' } }]);
  const sw = page.getByRole('switch', { name: 'Send cleaners their jobs automatically' });
  await sw.click();
  await expect(page.locator('main').getByText('Internal error')).toBeVisible();
  await expect(sw).toBeChecked();
  await expect(sw).toBeEnabled();
});

test('objectif 51 : message 400 du serveur en ligne, la saisie reste', async ({ page }) => {
  const msg = 'Inspection target must be a whole number from 0 to 50.';
  await boot(page, [{ match: 'action=mgr.settings.set', status: 400, body: { error: msg } }]);
  const input = page.getByLabel('Daily inspection target');
  await input.fill('51');
  await page.locator('main [data-target-save]').click();
  await expect(page.locator('main').getByText(msg)).toBeVisible();
  await expect(input).toHaveValue('51');
  await expect(page.locator('main [data-target-save]')).toBeEnabled();
  expect((await posts(page, 'mgr.settings.set')).map((b) => JSON.parse(b))).toEqual([{ key: 'inspectionTarget', value: 51 }]);
});

test('objectif 6 : poste un entier et toast Saved', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.settings.set', status: 200, body: { ok: true, settings: { ...SETTINGS, inspectionTarget: 6 } } }]);
  await page.getByLabel('Daily inspection target').fill('6');
  await page.locator('main [data-target-save]').click();
  await expect(page.locator('#toast')).toContainText('Saved');
  await expect(page.getByLabel('Daily inspection target')).toHaveValue('6');
  expect((await posts(page, 'mgr.settings.set')).map((b) => JSON.parse(b))).toEqual([{ key: 'inspectionTarget', value: 6 }]);
});

test('Run autopilot now : bilan et liens wa.me a taper, aucune ouverture automatique', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.autopilot.run', status: 200, body: RUN, delay: 300 }]);
  let popups = 0;
  page.on('popup', () => { popups++; });
  const url0 = page.url();
  const btn = page.getByRole('button', { name: 'Run autopilot now' });
  await btn.click();
  await expect(btn).toBeDisabled();
  await expect(page.getByText('3 new assignments, 2 already assigned')).toBeVisible();
  const links = page.locator('main [data-autopilot-result] a', { hasText: 'Send on WhatsApp' });
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute('href', RUN.notified[0].waLink);
  await expect(links.nth(0)).toHaveAttribute('target', '_blank');
  await expect(links.nth(0)).toHaveAttribute('rel', 'noopener');
  await expect(page.locator('main [data-autopilot-result]')).toContainText('Faiza');
  await expect(page.locator('main [data-autopilot-result]')).toContainText('Pionah');
  await page.waitForTimeout(500);
  expect(popups).toBe(0);
  expect(page.url()).toBe(url0);
  expect(await posts(page, 'mgr.autopilot.run')).toEqual(['{}']);
});

test('notifications : PushManager absent = Not supported on this device, sans erreur', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { delete (window as any).PushManager; });
  await boot(page);
  await expect(page.getByText('Not supported on this device')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send a test' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Permission imposee : le navigateur de test (headless, appareil emule) a sa propre valeur.
const permission = (page: any, p: string) => page.addInitScript((perm: string) => {
  if (!('PushManager' in window)) (window as any).PushManager = function PushManager() {};
  Object.defineProperty(window, 'Notification', { configurable: true, value: { permission: perm, requestPermission: async () => perm } });
}, p);

test('notifications : permission non demandee = Off avec Turn on', async ({ page }) => {
  await permission(page, 'default');
  await boot(page);
  await expect(page.locator('main [data-push-state]')).toHaveText('Off');
  await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a test' })).toHaveCount(0);
});

test('notifications : permission refusee = Blocked in the browser settings, sans bouton', async ({ page }) => {
  await permission(page, 'denied');
  await boot(page);
  await expect(page.locator('main [data-push-state]')).toHaveText('Blocked in the browser settings');
  await expect(page.getByRole('button', { name: 'Turn on' })).toHaveCount(0);
});

test('lecture en echec : Retry recharge les reglages', async ({ page }) => {
  await boot(page, [], [
    { match: 'action=mgr.settings', status: 500, body: { error: 'Internal error' }, once: true },
    { match: 'action=mgr.settings', status: 200, body: SETTINGS },
  ]);
  await expect(page.locator('main').getByText('Internal error')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Autopilot', exact: true })).toBeVisible();
});

test('sombre : resultat de l autopilote affiche, aucun defilement horizontal', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await boot(page, [{ match: 'action=mgr.autopilot.run', status: 200, body: RUN }]);
  await page.getByRole('button', { name: 'Run autopilot now' }).click();
  await expect(page.locator('main [data-autopilot-result] a')).toHaveCount(2);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  if (process.env.SET_SHOT) await page.screenshot({ path: process.env.SET_SHOT + '-' + info.project.name + '.png', fullPage: true });
});
