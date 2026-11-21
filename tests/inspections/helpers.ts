import type { Page } from '@playwright/test';

// Meme principe que tests/v3/helpers.ts (non importe) : window.fetch est
// bouchonne avant le chargement des modules, journal dans localStorage.
// `hold` : la reponse est retenue jusqu'a ce que le test la libere (liberer(page, nom)),
// comme tests/v3/helpers.ts, au lieu d'un delai fixe.
export type FakeRoute = { match: string; status: number; body: any; delay?: number; once?: boolean; fail?: boolean; hold?: string };

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
      // Reponses retenues (option `hold`), par nom : liberee une fois, la route repond ensuite tout de suite.
      const tenues: Record<string, { libre: boolean; attente: Array<() => void> }> = {};
      const tenue = (nom: string) => tenues[nom] || (tenues[nom] = { libre: false, attente: [] });
      (window as any).__liberer = (nom: string) => {
        const t = tenue(nom);
        t.libre = true;
        t.attente.splice(0).forEach((f) => f());
      };
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
          // fail : panne reseau (fetch rejete), comme tests/manager/helpers.ts.
          if (r.fail) return new Promise((_res, rej) => setTimeout(() => rej(new TypeError('Failed to fetch')), r.delay || 0));
          // Reponse rendue (meme tardive) : notee a part dans inspFetchDone, pour attendre sans delai fixe.
          const make = () => {
            try {
              const l = JSON.parse(localStorage.getItem('inspFetchDone') || '[]');
              l.push(url);
              localStorage.setItem('inspFetchDone', JSON.stringify(l.slice(-80)));
            } catch (e) { /* quota */ }
            return new Response(r.status === 204 ? null : JSON.stringify(r.body), {
              status: r.status, headers: { 'Content-Type': 'application/json' },
            });
          };
          if (r.hold && !tenue(r.hold).libre) {
            const t = tenue(r.hold);
            return new Promise((res) => { t.attente.push(() => res(make())); });
          }
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

// Libere les reponses retenues sous ce nom (route `hold`).
export async function liberer(page: Page, nom: string) {
  await page.evaluate((n) => (window as any).__liberer(n), nom);
}

export async function fetchLog(page: Page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('inspFetchLog') || '[]'); } catch (e) { return []; }
  }) as Array<{ url: string; body: string; headers: any }>;
}

// URL des reponses deja rendues par le faux serveur (y compris les reponses lentes).
export async function fetchDone(page: Page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('inspFetchDone') || '[]'); } catch (e) { return []; }
  }) as string[];
}

export async function noHorizontalScroll(page: Page) {
  return await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
}
