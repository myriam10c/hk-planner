import { test, expect } from '@playwright/test';

// Le service worker est bloqué par la config Playwright (`serviceWorkers: 'block'`),
// donc on ne peut pas l'installer. On charge sw.js comme du texte et on l'exécute
// dans un faux scope `self`, ce qui teste les vrais handlers sans navigateur SW.
async function runSwHandlers(page: any, swSource: string, scenario: 'push' | 'click') {
  return await page.evaluate(
    ({ src, mode }: { src: string; mode: string }) => {
      const listeners: Record<string, Function> = {};
      const shown: any[] = [];
      const focused: string[] = [];
      const opened: string[] = [];
      const closes: string[] = [];
      const fakeSelf: any = {
        addEventListener: (name: string, fn: Function) => { listeners[name] = fn; },
        skipWaiting: () => {},
        location: { origin: 'https://app.test' },
        registration: {
          showNotification: (title: string, options: any) => {
            shown.push({ title, options });
            return Promise.resolve();
          },
        },
        clients: {
          claim: () => Promise.resolve(),
          matchAll: () => Promise.resolve(
            mode === 'click'
              ? [{ url: 'https://app.test/', focus: () => { focused.push('focus'); return Promise.resolve(); }, navigate: (u: string) => { focused.push(u); return Promise.resolve(); } }]
              : [],
          ),
          openWindow: (u: string) => { opened.push(u); return Promise.resolve(); },
        },
      };
      const fakeCaches = { open: () => Promise.resolve({ addAll: () => Promise.resolve(), match: () => Promise.resolve(undefined), put: () => Promise.resolve() }), keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) };
      new Function('self', 'caches', 'location', 'fetch', src)(
        fakeSelf, fakeCaches, fakeSelf.location, () => Promise.reject(new Error('no network in test')),
      );

      const waits: Promise<any>[] = [];
      if (mode === 'push') {
        listeners['push']({
          data: { json: () => ({ title: 'New task: Fix AC', body: 'From Hillal', url: 'https://app.test/?task=42', tag: 'team-task-42' }) },
          waitUntil: (p: Promise<any>) => waits.push(p),
        });
      } else {
        listeners['notificationclick']({
          notification: { close: () => { closes.push('closed'); }, data: { url: 'https://app.test/?task=42' } },
          waitUntil: (p: Promise<any>) => waits.push(p),
        });
      }
      return Promise.all(waits).then(() => ({
        shown, focused, opened, closes,
        hasPush: typeof listeners['push'] === 'function',
        hasClick: typeof listeners['notificationclick'] === 'function',
      }));
    },
    { src: swSource, mode: scenario },
  );
}

test('sw.js expose un handler push qui affiche la notification du payload', async ({ page, request }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const swSource = await (await request.get('/sw.js')).text();
  const r = await runSwHandlers(page, swSource, 'push');
  expect(r.hasPush).toBe(true);
  expect(r.shown).toHaveLength(1);
  expect(r.shown[0].title).toBe('New task: Fix AC');
  expect(r.shown[0].options.body).toBe('From Hillal');
  expect(r.shown[0].options.tag).toBe('team-task-42');
  expect(r.shown[0].options.data.url).toBe('https://app.test/?task=42');
  expect(r.shown[0].options.icon).toBe('/icons/icon-192.png');
});

test('sw.js expose un handler notificationclick qui focus la fenetre existante', async ({ page, request }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const swSource = await (await request.get('/sw.js')).text();
  const r = await runSwHandlers(page, swSource, 'click');
  expect(r.hasClick).toBe(true);
  expect(r.closes).toContain('closed');
  expect(r.focused).toContain('focus');
  expect(r.focused).toContain('https://app.test/?task=42');
  expect(r.opened).toHaveLength(0);
});
