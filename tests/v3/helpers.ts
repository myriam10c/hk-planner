import type { Page } from '@playwright/test';

// Meme technique que tests/auth.spec.ts : window.fetch est bouchonne AVANT le
// chargement des modules, par addInitScript. La difference tient a une chose,
// le bouchon refuse quand navigator.onLine est faux, pour que
// context.setOffline() coupe vraiment le reseau de l'application.
export type FakeRoute = { match: string; status: number; body: any; delay?: number };

export async function bootV3(
  page: Page,
  routes: FakeRoute[],
  opts: { hash?: string; pinToken?: string | null; emailSession?: any } = {},
) {
  await page.addInitScript(
    (cfg: { routes: FakeRoute[]; pinToken: string | null; emailSession: any }) => {
      // Rien n'est efface ici : addInitScript rejoue a chaque navigation, et un
      // effacement emporterait le drapeau hors ligne et le journal d'un test qui
      // recharge la page. Chaque test part de toute facon d'un contexte neuf.
      // La session n'est semee qu'une fois, au premier document du contexte :
      // addInitScript rejoue a chaque navigation, et une session re-imposee
      // ferait reapparaitre le jeton juste apres une deconnexion, ce que le test
      // de Profile doit justement pouvoir constater. Rien n'efface ces cles par
      // ailleurs, donc un rechargement les retrouve tel quel.
      try {
        if (localStorage.getItem('v3TestSeeded') !== '1') {
          localStorage.setItem('v3TestSeeded', '1');
          if (cfg.pinToken) localStorage.setItem('cleanerToken', cfg.pinToken);
          if (cfg.emailSession) localStorage.setItem('hkAuthSession', JSON.stringify(cfg.emailSession));
        }
      } catch (e) { /* stockage indisponible : le test le verra a l'ecran */ }
      (window as any).__unhandled = [];
      window.addEventListener('unhandledrejection', (ev: any) => {
        (window as any).__unhandled.push(String((ev && ev.reason) || ''));
      });
      // Journal des appels au proxy. Garde dans localStorage et non dans une
      // variable : il doit survivre a un rechargement et a une navigation vers
      // l'app actuelle (test de deconnexion).
      (window as any).__logFetch = function (entry: any) {
        try {
          const l = JSON.parse(localStorage.getItem('v3FetchLog') || '[]');
          l.push(entry);
          localStorage.setItem('v3FetchLog', JSON.stringify(l.slice(-80)));
        } catch (e) { /* quota plein : le test lira ce qu'il y a */ }
      };
      // Deux facons de couper le reseau de l'application : context.setOffline()
      // de Playwright (qui coupe aussi la navigation, donc pas de rechargement
      // possible), et ce drapeau dans localStorage, qui survit a un reload.
      (window as any).__offlineFlag = function () {
        try { return localStorage.getItem('v3TestOffline') === '1'; } catch (e) { return false; }
      };
      const real = window.fetch.bind(window);
      window.fetch = ((input: any, init: any) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const proxy = url.indexOf('hostaway-proxy') !== -1;
        if (proxy) {
          (window as any).__logFetch({
            url,
            body: init && init.body && typeof init.body === 'string' ? init.body : '',
            headers: init && init.headers ? JSON.parse(JSON.stringify(init.headers)) : {},
          });
          if (!navigator.onLine || (window as any).__offlineFlag()) {
            return Promise.reject(new TypeError('Failed to fetch'));
          }
          for (const r of cfg.routes) {
            if (url.indexOf(r.match) !== -1) {
              const make = () => new Response(JSON.stringify(r.body), {
                status: r.status, headers: { 'Content-Type': 'application/json' },
              });
              if (r.delay) return new Promise((res) => setTimeout(() => res(make()), r.delay));
              return Promise.resolve(make());
            }
          }
          return Promise.resolve(new Response(JSON.stringify({ error: 'no fake route' }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
          }));
        }
        return real(input, init);
      }) as any;
    },
    { routes, pinToken: opts.pinToken ?? null, emailSession: opts.emailSession ?? null },
  );
  await page.goto('/v3/' + (opts.hash || ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true, null, { timeout: 10_000 });
}

export async function fetchLog(page: Page) {
  return await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('v3FetchLog') || '[]');
    } catch (e) {
      return [];
    }
  }) as Array<{ url: string; body: string; headers: any }>;
}

// Aucun defilement horizontal : la regle tenue a 390 px comme a 1280 px.
export async function noHorizontalScroll(page: Page) {
  return await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
}
