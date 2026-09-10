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

// ===== Front app.js =====

test('urlBase64ToUint8Array decode une cle VAPID base64url de 65 octets', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).urlBase64ToUint8Array === 'function', null, { timeout: 10_000 });
  const r = await page.evaluate(() => {
    const w = window as any;
    // Cle publique VAPID de test (P-256 non compresse : 0x04 + 32 + 32 = 65 octets).
    const raw = new Uint8Array(65);
    raw[0] = 4;
    for (let i = 1; i < 65; i++) raw[i] = i;
    const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const out = w.urlBase64ToUint8Array(b64);
    return { length: out.length, first: out[0], last: out[64], isUint8: out instanceof Uint8Array };
  });
  expect(r.isUint8).toBe(true);
  expect(r.length).toBe(65);
  expect(r.first).toBe(4);
  expect(r.last).toBe(64);
});

test('renderNotifBanner propose Enable quand la permission est default', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderNotifBanner === 'function', null, { timeout: 10_000 });
  const html = await page.evaluate(() => {
    const w = window as any;
    localStorage.removeItem('notifBannerDismissed');
    localStorage.removeItem('pushSubscribed');
    w.pushPermission = () => 'default';
    w.pushSupported = () => true;
    w.isIOSLike = () => false;
    return w.renderNotifBanner();
  });
  expect(html).toContain('data-action="enablePushNotifications"');
  expect(html).toContain('Enable');
  expect(html).not.toContain('Home Screen');
});

test('renderNotifBanner affiche le mode d emploi iOS quand le push est indisponible hors PWA', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderNotifBanner === 'function', null, { timeout: 10_000 });
  const html = await page.evaluate(() => {
    const w = window as any;
    localStorage.removeItem('notifBannerDismissed');
    w.pushSupported = () => false;
    w.isIOSLike = () => true;
    w.isStandalonePWA = () => false;
    return w.renderNotifBanner();
  });
  expect(html).toContain('Add to Home Screen');
  expect(html).toContain('Share');
  expect(html).not.toContain('data-action="enablePushNotifications"');
});

test('renderNotifBanner est vide quand la permission est accordee et l abonnement enregistre', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderNotifBanner === 'function', null, { timeout: 10_000 });
  const html = await page.evaluate(() => {
    const w = window as any;
    localStorage.removeItem('notifBannerDismissed');
    w.pushPermission = () => 'granted';
    w.pushSupported = () => true;
    localStorage.setItem('pushSubscribed', '1');
    return w.renderNotifBanner();
  });
  expect(html).toBe('');
});

test('subscribePush recupere la cle VAPID, s abonne et enregistre l abonnement', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).subscribePush === 'function', null, { timeout: 10_000 });
  const r = await page.evaluate(async () => {
    const w = window as any;
    localStorage.removeItem('pushSubscribed');
    const calls: any[] = [];
    const subscribeArgs: any[] = [];
    w.api = async (action: string) => {
      calls.push({ action });
      if (action === 'getVapidPublicKey') return { status: 'success', publicKey: 'BEd0Rk9nQ2hhbmdlbWVudA' };
      return { status: 'success' };
    };
    w.apiWrite = async (action: string, opts: any) => { calls.push({ action, body: opts.body }); return { status: 'success' }; };
    w.pushRegistration = async () => ({
      pushManager: {
        getSubscription: async () => null,
        subscribe: async (opts: any) => {
          subscribeArgs.push(opts);
          return {
            toJSON: () => ({ endpoint: 'https://push.example/sub-1', keys: { p256dh: 'PPP', auth: 'AAA' } }),
          };
        },
      },
    });
    await w.subscribePush();
    return { calls, subscribeArgs: subscribeArgs.map((o) => ({ userVisibleOnly: o.userVisibleOnly, keyIsUint8: o.applicationServerKey instanceof Uint8Array })), flag: localStorage.getItem('pushSubscribed') };
  });
  expect(r.calls[0].action).toBe('getVapidPublicKey');
  expect(r.subscribeArgs[0]).toEqual({ userVisibleOnly: true, keyIsUint8: true });
  const save = r.calls.find((c: any) => c.action === 'savePushSubscription');
  expect(save).toBeTruthy();
  expect(save.body.endpoint).toBe('https://push.example/sub-1');
  expect(save.body.keys).toEqual({ p256dh: 'PPP', auth: 'AAA' });
  expect(r.flag).toBe('1');
});

test('subscribePush reutilise un abonnement existant sans re-souscrire', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).subscribePush === 'function', null, { timeout: 10_000 });
  const r = await page.evaluate(async () => {
    const w = window as any;
    const calls: string[] = [];
    let subscribeCount = 0;
    w.api = async (action: string) => { calls.push(action); return { status: 'success', publicKey: 'BEd0' }; };
    w.apiWrite = async (action: string, opts: any) => { calls.push(action); return { status: 'success', body: opts.body }; };
    w.pushRegistration = async () => ({
      pushManager: {
        getSubscription: async () => ({ toJSON: () => ({ endpoint: 'https://push.example/old', keys: { p256dh: 'P', auth: 'A' } }) }),
        subscribe: async () => { subscribeCount++; return null; },
      },
    });
    await w.subscribePush();
    return { calls, subscribeCount };
  });
  expect(r.subscribeCount).toBe(0);
  expect(r.calls).toContain('savePushSubscription');
  expect(r.calls).not.toContain('getVapidPublicKey');
});
