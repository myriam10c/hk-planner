import type { Page } from '@playwright/test';

// Meme principe que tests/inspections/helpers.ts : window.fetch bouchonne avant
// les modules, journal dans localStorage. « / » et « /v3/ » sont remplaces par
// des pages temoins : on ne verifie ici que les decisions de /manager/.
// raw : corps texte rendu tel quel (ex. un CSV), avec contentType (defaut text/csv).
export type FakeRoute = { match: string; status: number; body: any; delay?: number; once?: boolean; fail?: boolean; raw?: string; contentType?: string };

export const MANAGER = { id: 8, name: 'Walter', color: '#e94560', role: 'manager', email: 'walter@example.com' };
export const me = (member: any) => ({ match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: member } });
// Image d'un pixel servie a la place des URL signees du stockage (aucun appel reseau).
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Session au format ecrit par supabase-js dans hkAuthSession, valide tres loin.
export function emailSession() {
  return {
    access_token: 'jwt-test', refresh_token: 'refresh-test', token_type: 'bearer',
    expires_in: 3600, expires_at: 4102444800, user: { id: 'u-test', email: 'walter@example.com' },
  };
}

export async function bootMgr(
  page: Page,
  routes: FakeRoute[],
  opts: { email?: boolean; pin?: string; hash?: string; timeoutMs?: number; cache?: { savedAt: number; data: any }; clock?: Date; storage?: Record<string, string>; authDelayMs?: number } = {},
) {
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://signed.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') }));
  await page.route(/\/v3\/(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>V3 STUB</title><h1>V3 STUB</h1>' }));
  await page.route(/:\d+\/(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ROOT STUB</title><h1>ROOT STUB</h1>' }));
  if (opts.clock) await page.clock.setFixedTime(opts.clock);
  await page.addInitScript((cfg: any) => {
    try {
      if (localStorage.getItem('mgrTestSeeded') !== '1') {
        localStorage.setItem('mgrTestSeeded', '1');
        if (cfg.email) localStorage.setItem('hkAuthSession', JSON.stringify(cfg.email));
        if (cfg.pin) localStorage.setItem('cleanerToken', cfg.pin);
        if (cfg.cache) localStorage.setItem('mgrTodayCache', JSON.stringify(cfg.cache));
        if (cfg.storage) for (const k of Object.keys(cfg.storage)) localStorage.setItem(k, cfg.storage[k]);
      }
    } catch (e) { /* stockage indisponible */ }
    if (cfg.timeoutMs) (window as any).__MGR_TIMEOUT_MS = cfg.timeoutMs;
    (window as any).__logFetch = function (entry: any) {
      try {
        const l = JSON.parse(localStorage.getItem('mgrFetchLog') || '[]');
        l.push(entry);
        localStorage.setItem('mgrFetchLog', JSON.stringify(l.slice(-100)));
      } catch (e) { /* quota */ }
    };
    const real = window.fetch.bind(window);
    const servies = new Set<any>();
    window.fetch = ((input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/auth/v1/') !== -1 && cfg.authDelayMs) {
        return new Promise((_res, rej) => setTimeout(() => rej(new TypeError('Failed to fetch')), cfg.authDelayMs));
      }
      if (url.indexOf('/auth/v1/') !== -1) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.indexOf('hostaway-proxy') === -1) return real(input, init);
      (window as any).__logFetch({
        url, body: init && typeof init.body === 'string' ? init.body : '',
        headers: init && init.headers ? JSON.parse(JSON.stringify(init.headers)) : {},
      });
      for (const r of cfg.routes) {
        if (url.indexOf(r.match) === -1 || servies.has(r)) continue;
        if (r.once) servies.add(r);
        if (r.fail) return new Promise((_res, rej) => setTimeout(() => rej(new TypeError('Failed to fetch')), r.delay || 0));
        const make = () => (typeof r.raw === 'string'
          ? new Response(r.raw, { status: r.status, headers: { 'Content-Type': r.contentType || 'text/csv' } })
          : new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        if (r.delay) return new Promise((res) => setTimeout(() => res(make()), r.delay));
        return Promise.resolve(make());
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'no fake route' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }) as any;
  }, {
    routes, email: opts.email ? emailSession() : null, pin: opts.pin || null,
    cache: opts.cache || null, timeoutMs: opts.timeoutMs || 0, storage: opts.storage || null, authDelayMs: opts.authDelayMs || 0,
  });
  await page.goto('/manager/' + (opts.hash || ''), { waitUntil: 'domcontentloaded' });
}

export async function fetchLog(page: Page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('mgrFetchLog') || '[]'); } catch (e) { return []; }
  }) as Array<{ url: string; body: string; headers: any }>;
}

export async function noHorizontalScroll(page: Page) {
  return await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
}
