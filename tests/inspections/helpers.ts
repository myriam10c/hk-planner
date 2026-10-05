import type { Page } from '@playwright/test';

// Meme principe que tests/v3/helpers.ts (non importe) : window.fetch est
// bouchonne avant le chargement des modules, journal dans localStorage.
export type FakeRoute = { match: string; status: number; body: any; delay?: number; once?: boolean };

export async function bootInsp(
  page: Page,
  routes: FakeRoute[],
  opts: { hash?: string; pinToken?: string | null } = {},
) {
  await page.addInitScript(
    (cfg: { routes: FakeRoute[]; pinToken: string | null }) => {
      try {
        if (localStorage.getItem('inspTestSeeded') !== '1') {
          localStorage.setItem('inspTestSeeded', '1');
          if (cfg.pinToken) localStorage.setItem('cleanerToken', cfg.pinToken);
        }
      } catch (e) { /* stockage indisponible */ }
      (window as any).__logFetch = function (entry: any) {
        try {
          const l = JSON.parse(localStorage.getItem('inspFetchLog') || '[]');
          l.push(entry);
          localStorage.setItem('inspFetchLog', JSON.stringify(l.slice(-80)));
        } catch (e) { /* quota */ }
      };
      const real = window.fetch.bind(window);
      const servies = new Set<FakeRoute>();
      window.fetch = ((input: any, init: any) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('hostaway-proxy') === -1) return real(input, init);
        (window as any).__logFetch({
          url,
          body: init && init.body && typeof init.body === 'string' ? init.body
            : init && init.body && typeof init.body.entries === 'function'
              ? JSON.stringify(Object.fromEntries(Array.from(init.body.entries()).map((e: any) => [e[0], typeof e[1] === 'string' ? e[1] : 'file']))) : '',
          headers: init && init.headers ? JSON.parse(JSON.stringify(init.headers)) : {},
        });
        for (const r of cfg.routes) {
          if (url.indexOf(r.match) === -1 || servies.has(r)) continue;
          if (r.once) servies.add(r);
          const make = () => new Response(r.status === 204 ? null : JSON.stringify(r.body), {
            status: r.status, headers: { 'Content-Type': 'application/json' },
          });
          if (r.delay) return new Promise((res) => setTimeout(() => res(make()), r.delay));
          return Promise.resolve(make());
        }
        return Promise.resolve(new Response(JSON.stringify({ error: 'no fake route' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        }));
      }) as any;
    },
    { routes, pinToken: opts.pinToken ?? null },
  );
  await page.goto('/inspections/' + (opts.hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__inspReady === true, null, { timeout: 10_000 });
}

export async function fetchLog(page: Page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('inspFetchLog') || '[]'); } catch (e) { return []; }
  }) as Array<{ url: string; body: string; headers: any }>;
}

export async function noHorizontalScroll(page: Page) {
  return await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
}
