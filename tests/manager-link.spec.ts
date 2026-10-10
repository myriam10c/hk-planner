import { test, expect } from '@playwright/test';

// Lien « New manager app » dans More de l'ancienne app : vue manager seulement.
// Tourne contre l'arbre de travail :
//   HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/manager-link.spec.ts --project=desktop --project=mobile
// Reseau bouchonne (window.fetch remplace avant app.js), /manager/ servi par une
// page de remplacement : aucune ecriture, aucun appel a la prod.

type FakeRoute = { match: string; status: number; body: any };
const WALTER = { id: 8, name: 'Walter', color: '#e94560', role: 'manager' };
const SEMAX = { id: 7, name: 'Semax', color: '#7c3aed', role: 'maintenance' };
const SESSION = {
  access_token: 'jwt-test-token', refresh_token: 'refresh-test', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
  user: { id: 'u1', email: 'walter@example.com', aud: 'authenticated', role: 'authenticated' },
};

function routesFor(member: any): FakeRoute[] {
  return [
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: member } },
    { match: 'action=getCleaners', status: 200, body: { status: 'success', cleaners: [{ ...member, email: 'x@example.com' }] } },
    { match: 'action=checkouts', status: 200, body: { status: 'success', reservations: [] } },
    {
      match: 'action=getAllData', status: 200,
      body: {
        status: 'success', done: {}, assignments: {}, cleaners: [{ ...member, email: 'x@example.com' }], templates: [],
        listingPrices: {}, timers: {}, cancelled: {}, postponed: {}, extraCleanings: [], leaves: [], holidays: [],
      },
    },
    { match: 'action=', status: 200, body: { status: 'success' } },
  ];
}

async function boot(page: any, member: any) {
  await page.route(/\/manager\/(\?.*)?$/, (r: any) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>MANAGER STUB</title><h1>MANAGER STUB</h1>' }));
  await page.addInitScript((cfg: any) => {
    try {
      localStorage.setItem('hkAuthSession', JSON.stringify(cfg.session));
      localStorage.setItem('onboardingSeen', '1');
      localStorage.setItem('hkInspAnnounceShown', '9');
    } catch (e) { /* ignore */ }
    const real = window.fetch.bind(window);
    window.fetch = ((input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      for (const r of cfg.routes) {
        if (url.indexOf(r.match) !== -1) {
          return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        }
      }
      if (url.indexOf(location.origin) === 0 || url.charAt(0) === '/') return real(input, init);
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as any;
  }, { routes: routesFor(member), session: SESSION });
  await page.goto('/', { waitUntil: 'commit' });
}

test('manager : More montre New manager app, qui ouvre /manager/', async ({ page }) => {
  await boot(page, WALTER);
  await page.locator('.bottom-nav [data-arg0="__more"]').click();
  const link = page.locator('#moreMenu a[data-mgr-app]');
  await expect(link).toHaveText('New manager app');
  await expect(link).toHaveAttribute('href', '/manager/');
  await link.click();
  await expect(page).toHaveURL(/\/manager\/$/);
  await expect(page.locator('h1')).toHaveText('MANAGER STUB');
});

test('maintenance : ni More ni lien vers /manager/', async ({ page }) => {
  await boot(page, SEMAX);
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.bottom-nav [data-arg0="__more"]')).toHaveCount(0);
  await expect(page.locator('a[href="/manager/"]')).toHaveCount(0);
});
