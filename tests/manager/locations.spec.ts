import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';
import { NOW, todayBody } from './fixtures';

// Position de l'equipe (plan 2026-10-29, tache 3) : ecran More > Where is everyone,
// ligne de position du bloc « Who does what » de Today, avertissement et envoi
// depuis /manager/. NOW = 11:00 Dubai : la fenetre 07:00-23:00 est ouverte.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();

// Format de mgrLocations (supabase/functions/hostaway-proxy/team_locations.ts).
const PEOPLE = [
  { id: 4, name: 'Faiza', role: 'cleaner', color: '#7a5af8',
    location: { lat: 25.0805, lng: 55.1403, accuracy: 12, recordedAt: ago(4), ageMin: 4,
      place: { kind: 'at', listingId: 'L2', label: '103 · Damac Reva', distanceM: 40 } } },
  { id: 7, name: 'Semax', role: 'maintenance', color: '#0e9384',
    location: { lat: 25.197, lng: 55.274, accuracy: 30, recordedAt: ago(125), ageMin: 125,
      place: { kind: 'near', listingId: 'L9', label: '1205 · Marina Gate', distanceM: 1234 } } },
  // 2026-10-08 18:40 Dubai : hier.
  { id: 8, name: 'Walter', role: 'manager', color: '#e94560',
    location: { lat: 25.1, lng: 55.2, accuracy: 20, recordedAt: '2026-10-08T14:40:00.000Z', ageMin: 980,
      place: { kind: 'near', listingId: 'L3', label: '404 · Elysee', distanceM: 450 } } },
  { id: 10, name: 'Pionah', role: 'cleaner', color: '#dd2590', location: null },
];
const LOCS: FakeRoute = { match: 'action=mgr.locations', status: 200, body: { generatedAt: NOW.toISOString(), people: PEOPLE } };

async function tiles(page: any) {
  await page.route(/tile\.openstreetmap\.org/, (r: any) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') }));
}
const calls = async (page: any, action: string) => (await fetchLog(page)).filter((l) => l.url.includes('action=' + action)).length;

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('Where is everyone : liste, points sur la carte, aucun defilement horizontal (' + scheme + ')', async ({ page }) => {
      await tiles(page);
      await bootMgr(page, [me(MANAGER), LOCS], { email: true, hash: '#/more/locations', clock: NOW });
      await expect(page.getByRole('heading', { name: 'Where is everyone', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
      await expect(page.locator('[data-loc-updated]')).toHaveText('Updated 11:00');
      const rows = page.locator('main .loc-list .loc-row');
      await expect(rows).toHaveCount(4);
      await expect(rows.nth(0)).toContainText('Faiza');
      await expect(rows.nth(0)).toContainText('At 103 · Damac Reva');
      await expect(rows.nth(0)).toContainText('4 min ago');
      await expect(rows.nth(0)).not.toHaveClass(/stale/);
      await expect(rows.nth(1)).toContainText('1.2 km from 1205 · Marina Gate');
      await expect(rows.nth(1)).toContainText('2 h ago');
      await expect(rows.nth(1)).toHaveClass(/stale/);
      await expect(rows.nth(2)).toContainText('450 m from 404 · Elysee');
      await expect(rows.nth(2)).toContainText('yesterday 18:40');
      await expect(rows.nth(3)).toContainText('Pionah');
      await expect(rows.nth(3)).toContainText('No location yet');
      // Trois points (Pionah n'a pas de position), initiales et couleur de la personne.
      const pins = page.locator('[data-loc-map] .loc-pin');
      await expect(pins).toHaveCount(3);
      await expect(page.locator('[data-loc-map] .loc-pin', { hasText: 'F' }).first()).toHaveCSS('background-color', 'rgb(122, 90, 248)');
      await expect(page.locator('[data-loc-map] .loc-pin.stale')).toHaveCount(2);
      await expect(page.locator('.leaflet-control-attribution')).toContainText('OpenStreetMap');
      const box = await page.locator('[data-loc-map]').boundingBox();
      expect(box!.height).toBeGreaterThan(200);
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      for (const el of await page.locator('main .loc-row, main [data-loc-refresh]').all()) {
        const b = await el.boundingBox();
        expect(b!.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test('Where is everyone : taper une ligne centre la carte et ouvre la bulle', async ({ page }) => {
  await tiles(page);
  await bootMgr(page, [me(MANAGER), LOCS], { email: true, hash: '#/more/locations', clock: NOW });
  await expect(page.locator('[data-loc-map] .loc-pin')).toHaveCount(3);
  await page.locator('main .loc-row', { hasText: 'Semax' }).click();
  const pop = page.locator('.leaflet-popup-content');
  await expect(pop).toContainText('Semax');
  await expect(pop).toContainText('1.2 km from 1205 · Marina Gate');
  await expect(pop).toContainText('2 h ago');
});

test('Where is everyone : Refresh relit, rafraichi toutes les 60 s, arret en quittant l ecran', async ({ page }) => {
  await tiles(page);
  await page.clock.install({ time: NOW });
  await bootMgr(page, [me(MANAGER), LOCS], { email: true, hash: '#/more/locations' });
  await expect(page.locator('main .loc-list .loc-row')).toHaveCount(4);
  expect(await calls(page, 'mgr.locations')).toBe(1);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => calls(page, 'mgr.locations')).toBe(2);
  await page.clock.runFor(61000);
  await expect.poll(() => calls(page, 'mgr.locations')).toBe(3);
  await page.evaluate(() => { location.hash = '#/more'; });
  await expect(page.locator('main a.more-row').first()).toBeVisible();
  await page.clock.runFor(130000);
  expect(await calls(page, 'mgr.locations')).toBe(3);
});

test('Where is everyone : erreur du serveur, Retry', async ({ page }) => {
  await tiles(page);
  await bootMgr(page, [me(MANAGER), { ...LOCS, status: 500, body: { error: 'boom' }, once: true }, LOCS], { email: true, hash: '#/more/locations', clock: NOW });
  await expect(page.getByRole('alert')).toContainText('boom');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main .loc-list .loc-row')).toHaveCount(4);
});

test('Today : ligne de position sous le nom, rien sans position, lien Map', async ({ page }) => {
  const body = todayBody({ locations: PEOPLE });
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 200, body }], { email: true, clock: NOW });
  const who = page.locator('section[aria-labelledby="h-who"]');
  await expect(who.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '#/more/locations');
  const faiza = who.locator('.person', { hasText: 'Faiza' }).first();
  await expect(faiza.locator('.loc-ln')).toHaveText('At 103 · Damac Reva · 4 min ago');
  await expect(faiza.locator('.loc-ln')).not.toHaveClass(/stale/);
  const semax = who.locator('.person', { hasText: 'Semax' }).first();
  await expect(semax.locator('.loc-ln')).toHaveText('1.2 km from 1205 · Marina Gate · 2 h ago');
  await expect(semax.locator('.loc-ln')).toHaveClass(/stale/);
  await expect(who.locator('.person', { hasText: 'Pionah' }).locator('.loc-ln')).toHaveCount(0);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  await who.getByRole('link', { name: 'Map' }).click();
  await expect(page).toHaveURL(/#\/more\/locations$/);
});

test('Today : locations absent ou null, aucune ligne', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 200, body: todayBody({ locations: null }) }], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
  await expect(page.locator('.loc-ln')).toHaveCount(0);
});

test.describe('envoi depuis /manager/', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 25.08, longitude: 55.14, accuracy: 12 });
  });
  const SAVE: FakeRoute = { match: 'action=v3.saveLocation', status: 200, body: { ok: true, saved: true } };
  const TODAY: FakeRoute = { match: 'action=mgr.today', status: 200, body: todayBody() };

  test('avertissement une fois, OK envoie la position par v3.saveLocation', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), TODAY, SAVE], { email: true, clock: NOW, locNotice: null });
    const gate = page.locator('#locPrompt');
    await expect(gate.getByRole('heading', { name: 'Share your location' })).toBeVisible();
    await expect(gate).toContainText('Your managers see where you are while HK Planner is open, between 7 AM and 11 PM, to organise the day.');
    expect(await calls(page, 'v3.saveLocation')).toBe(0);
    await gate.getByRole('button', { name: 'OK' }).click();
    await expect(gate).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('hkLocNotice'))).toBe('ok');
    await expect.poll(() => calls(page, 'v3.saveLocation')).toBe(1);
    const log = (await fetchLog(page)).filter((l) => l.url.includes('action=v3.saveLocation'));
    const b = JSON.parse(log[0].body);
    expect(b.lat).toBeCloseTo(25.08, 5);
    expect(b.lng).toBeCloseTo(55.14, 5);
    expect(log[0].headers.Authorization).toBe('Bearer jwt-test');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mgrReady === true);
    await page.waitForTimeout(500);
    await expect(page.locator('#locPrompt')).toHaveCount(0);
  });

  test('Not now : rien n est envoye, pas de retour le meme jour', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), TODAY, SAVE], { email: true, clock: NOW, locNotice: null });
    await page.locator('#locPrompt').getByRole('button', { name: 'Not now' }).click();
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('hkLocNotice'))).toBe('later:2026-10-09');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mgrReady === true);
    await page.waitForTimeout(500);
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    expect(await calls(page, 'v3.saveLocation')).toBe(0);
  });

  test('jamais par-dessus l ecran des notifications : il passe apres', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), TODAY, SAVE], { email: true, clock: NOW, locNotice: null, storage: { mgrPushLater: '' } });
    await expect(page.locator('#pushPrompt')).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    await page.locator('#pushPrompt').getByRole('button', { name: 'Not now' }).click();
    await expect(page.locator('#locPrompt').getByRole('heading', { name: 'Share your location' })).toBeVisible();
  });

  test('Settings : carte Location sharing, Share my location rouvre l avertissement', async ({ page }) => {
    const SETTINGS = { autopilot: true, inspectionTarget: 4, excludedCount: 0, templates: [], push: { vapidPublicKey: 'BKEY' } };
    await bootMgr(page, [me(MANAGER), SAVE, { match: 'action=mgr.settings', status: 200, body: SETTINGS }],
      { email: true, clock: NOW, hash: '#/more/settings', locNotice: 'later:2026-10-09' });
    await expect(page.getByRole('heading', { name: 'Location sharing', exact: true })).toBeVisible();
    await expect(page.locator('[data-loc-state]')).toHaveText('Off');
    await page.getByRole('button', { name: 'Share my location' }).click();
    await page.locator('#locPrompt').getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('[data-loc-state]')).toHaveText('On for this device');
    await expect.poll(() => calls(page, 'v3.saveLocation')).toBe(1);
  });
});
