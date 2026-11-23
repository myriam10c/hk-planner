import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';
import { NOW, todayBody } from './fixtures';
import { LOCS, PEOPLE, tiles } from './locations-fixtures';

// Position de l'equipe (plan 2026-10-29, tache 3) : ecran More > Where is everyone,
// ligne de position du bloc « Who does what » de Today, avertissement et envoi
// depuis /manager/. NOW = 11:00 Dubai : la fenetre 07:00-23:00 est ouverte.
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

test('Where is everyone : « Location turned off at 14:02 » sans position, hier, et No location yet sinon', async ({ page }) => {
  await tiles(page);
  const people = [
    ...PEOPLE.slice(0, 3),
    // 09/10 10:32 Dubai (aujourd'hui) et 08/10 18:40 (hier).
    { id: 10, name: 'Pionah', role: 'cleaner', color: '#dd2590', location: null, offAt: '2026-10-09T06:32:00.000Z' },
    { id: 11, name: 'Annet', role: 'cleaner', color: '#6172f3', location: null, offAt: '2026-10-08T14:40:00.000Z' },
    { id: 12, name: 'Rahma', role: 'cleaner', color: '#0086c9', location: null, offAt: null },
  ];
  await bootMgr(page, [me(MANAGER), { ...LOCS, body: { generatedAt: NOW.toISOString(), people } }], { email: true, hash: '#/more/locations', clock: NOW });
  const rows = page.locator('main .loc-list .loc-row');
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(3)).toContainText('Location turned off at 10:32');
  await expect(rows.nth(4)).toContainText('Location turned off yesterday 18:40');
  await expect(rows.nth(5)).toContainText('No location yet');
});

test('Where is everyone : Ask them to turn it on, ligne de resultat', async ({ page }) => {
  await tiles(page);
  const NUDGE: FakeRoute = { match: 'action=mgr.locationNudge', status: 200, once: true,
    body: { ok: true, sent: ['Fauzia', 'Semax'], noPush: ['Annet', 'Rahma'], skipped: ['Faiza'] } };
  const QUIET: FakeRoute = { match: 'action=mgr.locationNudge', status: 200, body: { ok: false, reason: 'quiet_hours' } };
  await bootMgr(page, [me(MANAGER), LOCS, NUDGE, QUIET], { email: true, hash: '#/more/locations', clock: NOW });
  const btn = page.getByRole('button', { name: 'Ask them to turn it on' });
  await expect(btn).toBeVisible();
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await btn.click();
  const res = page.locator('[data-loc-nudge-res]');
  await expect(res).toHaveText('Sent to Fauzia, Semax. Notifications off: Annet, Rahma.');
  const log = (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.locationNudge'));
  expect(log).toHaveLength(1);
  expect(log[0].body).toBe('{}');
  expect(log[0].headers.Authorization).toBe('Bearer jwt-test');
  await btn.click();
  await expect(res).toHaveText('Quiet hours (10 PM to 8:30 AM): try later.');
});

test('Where is everyone : Ask them to turn it on, erreur du serveur lisible', async ({ page }) => {
  await tiles(page);
  await bootMgr(page, [me(MANAGER), LOCS, { match: 'action=mgr.locationNudge', status: 503, body: { error: 'Could not send the reminder right now. Try again.' } }],
    { email: true, hash: '#/more/locations', clock: NOW });
  await page.getByRole('button', { name: 'Ask them to turn it on' }).click();
  await expect(page.locator('[data-loc-nudge-res]')).toHaveText('Could not send the reminder right now. Try again.');
  await expect(page.getByRole('button', { name: 'Ask them to turn it on' })).toBeEnabled();
});

test('Where is everyone : seules les personnes rendues par le serveur (share_location false exclu cote proxy)', async ({ page }) => {
  await tiles(page);
  const sans = { ...LOCS, body: { generatedAt: NOW.toISOString(), people: PEOPLE.filter((p) => p.id !== 8) } };
  await bootMgr(page, [me(MANAGER), sans], { email: true, hash: '#/more/locations', clock: NOW });
  await expect(page.locator('main .loc-list .loc-row')).toHaveCount(3);
  await expect(page.locator('main .loc-list')).not.toContainText('Walter');
  await expect(page.locator('[data-loc-map] .loc-pin')).toHaveCount(2);
});

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
  const STOP: FakeRoute = { match: 'action=v3.stopLocation', status: 200, body: { ok: true } };

  test('avertissement une fois, OK envoie la position par v3.saveLocation', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), TODAY, SAVE], { email: true, clock: NOW, locNotice: null });
    const gate = page.locator('#locPrompt');
    await expect(gate.getByRole('heading', { name: 'Share your location' })).toBeVisible();
    await expect(gate).toContainText('Managers see where you are while HK Planner is open, between 7 AM and 11 PM, to organise the day.');
    expect(await calls(page, 'v3.saveLocation')).toBe(0);
    await gate.getByRole('button', { name: 'OK' }).click();
    await expect(gate).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:8'))).toBe('ok');
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
    expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:8'))).toBe('later:2026-10-09');
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

  test('shareLocation false (cleanerMe) : ni avertissement, ni envoi, ni carte Settings', async ({ page }) => {
    const SETTINGS = { autopilot: true, inspectionTarget: 4, excludedCount: 0, templates: [], push: { vapidPublicKey: 'BKEY' } };
    await bootMgr(page, [me({ ...MANAGER, shareLocation: false }), TODAY, SAVE, { match: 'action=mgr.settings', status: 200, body: SETTINGS }],
      { email: true, clock: NOW, locNotice: null });
    await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    // Meme avec un OK garde : rien n'est envoye.
    await page.evaluate(() => localStorage.setItem('hkLocNotice2:8', 'ok'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mgrReady === true);
    await page.waitForTimeout(1000);
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    expect(await calls(page, 'v3.saveLocation')).toBe(0);
    await page.evaluate(() => { location.hash = '#/more/settings'; });
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Location sharing', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-card="location"]')).toHaveCount(0);
  });

  test('Settings : carte Location sharing, meme geste que le bouton (Share my location / Stop sharing)', async ({ page }) => {
    const SETTINGS = { autopilot: true, inspectionTarget: 4, excludedCount: 0, templates: [], push: { vapidPublicKey: 'BKEY' } };
    await bootMgr(page, [me(MANAGER), SAVE, STOP, TODAY, { match: 'action=mgr.settings', status: 200, body: SETTINGS }],
      { email: true, clock: NOW, hash: '#/more/settings', locNotice: 'later:2026-10-09' });
    await expect(page.getByRole('heading', { name: 'Location sharing', exact: true })).toBeVisible();
    await expect(page.locator('[data-loc-state]')).toHaveText('Off');
    // Sous-ecran de More : pas de bouton d'en-tete.
    await expect(page.locator('[data-loc-pill]:visible')).toHaveCount(0);
    await page.getByRole('button', { name: 'Share my location' }).click();
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    await expect(page.locator('[data-loc-state]')).toHaveText('On for this device');
    expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:8'))).toBe('ok');
    await expect.poll(() => calls(page, 'v3.saveLocation')).toBe(1);
    await page.getByRole('button', { name: 'Stop sharing' }).click();
    await expect(page.locator('[data-loc-state]')).toHaveText('Off');
    expect(await page.evaluate(() => localStorage.getItem('hkLocNotice2:8'))).toBe('off');
    await expect.poll(() => calls(page, 'v3.stopLocation')).toBe(1);
    // Today : le bouton d'en-tete dit le meme etat.
    await page.evaluate(() => { location.hash = '#/today'; });
    await expect(page.locator('[data-loc-pill]')).toHaveAttribute('data-state', 'off');
  });

  test('bouton d en-tete : OFF, ON envoie, OFF appelle v3.stopLocation, absent des sous-ecrans', async ({ page, context }) => {
    await bootMgr(page, [me(MANAGER), TODAY, SAVE, STOP], { email: true, clock: NOW });
    const pill = page.locator('[data-loc-pill]');
    await expect(pill).toHaveAttribute('data-state', 'off');
    await expect(pill).toContainText('📍 Location OFF');
    await expect(pill).toContainText('Tap to turn on');
    // Juste sous l'en-tete de Today.
    expect(await page.evaluate(() => {
      const p = document.querySelector('[data-loc-pill]');
      return !!p && !!p.previousElementSibling && p.previousElementSibling.matches('main > header.top');
    })).toBe(true);
    const b = (await pill.boundingBox())!;
    expect(b.height).toBeGreaterThanOrEqual(44);
    await pill.click();
    await expect(pill).toHaveAttribute('data-state', 'on');
    await expect(pill).toContainText('📍 Location ON');
    await expect(pill).toContainText('Your manager sees where you are');
    await expect.poll(() => calls(page, 'v3.saveLocation')).toBe(1);
    await pill.click();
    await expect(pill).toHaveAttribute('data-state', 'off');
    await expect.poll(() => calls(page, 'v3.stopLocation')).toBe(1);
    await context.setGeolocation({ latitude: 25.09, longitude: 55.14, accuracy: 12 });
    await page.waitForTimeout(1200);
    expect(await calls(page, 'v3.saveLocation')).toBe(1);
    // Rechargement : off garde, pas d'avertissement.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as any).__mgrReady === true);
    await expect(page.locator('[data-loc-pill]')).toHaveAttribute('data-state', 'off');
    await page.waitForTimeout(500);
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    // Sous-ecran de More : rien ; retour sur More : present.
    await page.evaluate(() => { location.hash = '#/more/team'; });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-loc-pill]:visible')).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/more'; });
    await expect(page.locator('[data-loc-pill]')).toBeVisible();
    const s = await noHorizontalScroll(page);
    expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  });

  test('bouton d en-tete : maintenance (Semax) sur Maintenance, bloque = aide, hors fenetre = sleeps', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        const p = (navigator as any).permissions;
        const vrai = p.query.bind(p);
        p.query = (d: any) => (d && d.name === 'geolocation' ? Promise.resolve({ state: 'denied' }) : vrai(d));
      } catch (e) { /* le test le verra */ }
    });
    const SEMAX = { id: 7, name: 'Semax', color: '#0e9384', role: 'maintenance', email: 'semax@example.com' };
    await bootMgr(page, [me(SEMAX), { match: 'action=mnt.list', status: 200, body: { tickets: [], proposals: [] } }, SAVE, STOP],
      { email: true, clock: NOW, locNotice: 'ok' });
    const pill = page.locator('[data-loc-pill]');
    await expect(pill).toHaveAttribute('data-state', 'blocked');
    await expect(pill).toContainText('📍 Location blocked');
    await expect(pill).toContainText('Tap for help');
    await pill.click();
    const help = page.locator('#locPrompt[data-variant="blocked"]');
    await expect(help).toContainText('tap the lock icon');
    await help.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('#locPrompt')).toHaveCount(0);
    expect(await calls(page, 'v3.stopLocation')).toBe(0);
  });

  test('bouton d en-tete : 23:30 Dubai, sleeps mais actif', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), TODAY, SAVE, STOP], { email: true, clock: new Date('2026-10-09T23:30:00+04:00'), locNotice: 'ok' });
    const pill = page.locator('[data-loc-pill]');
    await expect(pill).toHaveAttribute('data-state', 'sleeps');
    await expect(pill).toContainText('📍 Location sleeps (7 AM to 11 PM)');
    await expect(pill).toHaveAttribute('data-on', '1');
    await pill.click();
    await expect(pill).toHaveAttribute('data-on', '0');
    await expect.poll(() => calls(page, 'v3.stopLocation')).toBe(1);
  });

  test('bouton d en-tete : absent si shareLocation false', async ({ page }) => {
    await bootMgr(page, [me({ ...MANAGER, shareLocation: false }), TODAY, SAVE], { email: true, clock: NOW });
    await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-loc-pill]:visible')).toHaveCount(0);
  });
});
