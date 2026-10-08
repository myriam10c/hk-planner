import { test, expect } from '@playwright/test';

// Revue du 08/10 : les liens de secours de la bascule v3 (« Open the old app »,
// « Open HK Planner », page de repli) ouvrent /?legacy=1#cleaner. Hors ligne, le
// service worker de la racine doit servir la coquille en cache malgre la query.
// Vrai service worker (le blocage global de playwright.config.ts est leve ici),
// Chromium seulement : l'emulation hors ligne y couvre aussi le service worker.
//   HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/sw-offline.spec.ts --project=desktop
test.use({ serviceWorkers: 'allow' });

test('hors ligne, /?legacy=1#cleaner est servi depuis le cache du service worker', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'emulation hors ligne du service worker : Chromium');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Precache termine : la coquille « / » est en cache.
  await expect.poll(async () => page.evaluate(async () => {
    const keys = await caches.keys();
    for (const k of keys) {
      if (k.indexOf('hk-planner-') !== 0) continue;
      const c = await caches.open(k);
      if (await c.match('/')) return true;
    }
    return false;
  }), { timeout: 15_000 }).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  for (const chemin of ['/?legacy=1#cleaner', '/?legacy=1', '/?legacy=0']) {
    const rep = await page.goto(chemin, { waitUntil: 'domcontentloaded' });
    expect(rep && rep.ok(), chemin + ' doit etre servi hors ligne').toBe(true);
    await page.waitForFunction(() => typeof (window as any).v3CutoverDue === 'function', null, { timeout: 10_000 });
    await expect(page.locator('#app')).toBeVisible();
  }
  // ?legacy=1 a bien ete lu par l'app servie depuis le cache.
  await page.goto('/?legacy=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).v3LegacyChosen === 'function', null, { timeout: 10_000 });
  expect(await page.evaluate(() => (window as any).v3LegacyChosen())).toBe(true);
  await context.setOffline(false);
});
