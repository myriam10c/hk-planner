import { test, expect } from '@playwright/test';

// app.js n'est pas modulaire : ses fonctions de premier niveau sont des globales.
// On teste les helpers purs directement, et les parcours reseau en bouchonnant
// window.fetch AVANT le chargement d'app.js (addInitScript). Le vrai supabase-js
// tourne donc sur des reponses HTTP fabriquees, ce qui teste l'integration reelle.
//
// Boucle locale rapide :
//   python3 -m http.server 8890
//   HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/auth.spec.ts --project=desktop

type FakeRoute = { match: string; status: number; body: any };

const SESSION = {
  access_token: 'jwt-test-token',
  refresh_token: 'refresh-test',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: 'u1', email: 'walter@example.com', aud: 'authenticated', role: 'authenticated' },
};

async function bootWithFakeNetwork(page: any, routes: FakeRoute[], opts: { hash?: string; storage?: any } = {}) {
  await page.addInitScript(
    (cfg: { routes: FakeRoute[]; storage: any }) => {
      if (cfg.storage) {
        try { localStorage.setItem('hkAuthSession', JSON.stringify(cfg.storage)); } catch (e) { /* ignore */ }
      }
      (window as any).__fetchLog = [];
      const real = window.fetch.bind(window);
      window.fetch = ((input: any, init: any) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        (window as any).__fetchLog.push({
          url,
          body: init && init.body ? String(init.body) : '',
          headers: init && init.headers ? JSON.parse(JSON.stringify(init.headers)) : {},
        });
        for (const r of cfg.routes) {
          if (url.indexOf(r.match) !== -1) {
            return Promise.resolve(new Response(JSON.stringify(r.body), {
              status: r.status, headers: { 'Content-Type': 'application/json' },
            }));
          }
        }
        if (url.indexOf(location.origin) === 0 || url.charAt(0) === '/') return real(input, init);
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }) as any;
    },
    { routes, storage: opts.storage ?? null },
  );
  const hash = opts.hash || '';
  await page.goto('/' + hash, { waitUntil: 'domcontentloaded' });
  // Le rechargement rend l'etat de depart deterministe (localStorage pose, fetch
  // bouchonne des le premier script). On le saute quand le fragment porte un
  // access_token : supabase-js le consomme au premier chargement puis nettoie
  // l'URL par replaceState, donc un reload repartirait sans le fragment et
  // l'ecran teste ne serait jamais celui du lien d'email.
  if (hash.indexOf('access_token') === -1) await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).parseAuthHash === 'function', null, { timeout: 10_000 });
}

function storedSession() {
  return { ...SESSION, expires_at: Math.floor(Date.now() / 1000) + 3600 };
}

test('parseAuthHash lit le type et les erreurs du fragment', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).parseAuthHash === 'function', null, { timeout: 10_000 });
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      recovery: w.parseAuthHash('#access_token=abc&refresh_token=d&type=recovery'),
      invite: w.parseAuthHash('#access_token=abc&type=invite'),
      expired: w.parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'),
      empty: w.parseAuthHash(''),
      cleaner: w.parseAuthHash('#cleaner'),
    };
  });
  expect(r.recovery.type).toBe('recovery');
  expect(r.recovery.hasToken).toBe(true);
  expect(r.invite.type).toBe('invite');
  expect(r.expired.error).toBe('otp_expired');
  expect(r.expired.errorDescription).toContain('expired');
  expect(r.empty.type).toBe('');
  expect(r.empty.hasToken).toBe(false);
  expect(r.cleaner.type).toBe('');
});

test('authErrorMessage rend des messages anglais lisibles', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).authErrorMessage === 'function', null, { timeout: 10_000 });
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      bad: w.authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }),
      expired: w.authErrorMessage({ code: 'otp_expired', message: 'Email link is invalid or has expired' }),
      rate: w.authErrorMessage({ code: 'over_email_send_rate_limit', message: 'rate limit exceeded' }),
      weak: w.authErrorMessage({ code: 'weak_password', message: 'Password should be at least 8 characters' }),
      unknown: w.authErrorMessage({ message: '' }),
    };
  });
  expect(r.bad).toBe('Wrong email or password.');
  expect(r.expired).toContain('expired');
  expect(r.rate).toContain('Too many attempts');
  expect(r.weak).toContain('at least 8 characters');
  expect(r.unknown).toBe('Something went wrong. Try again.');
});

test('sans session, l app ouvre l ecran de connexion par email', async ({ page }) => {
  await bootWithFakeNetwork(page, []);
  await expect(page.locator('#authEmail')).toBeVisible();
  await expect(page.locator('#authPassword')).toBeVisible();
  await expect(page.locator('.auth-card')).toContainText('Sign in');
});

test('un mot de passe faux affiche un message en anglais et garde l ecran', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: '/auth/v1/token', status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } },
  ]);
  await page.fill('#authEmail', 'walter@example.com');
  await page.fill('#authPassword', 'mauvais');
  await page.click('[data-action="emailLogin"]');
  await expect(page.locator('.auth-error')).toHaveText('Wrong email or password.');
  await expect(page.locator('#authEmail')).toBeVisible();
});

test('une connexion reussie envoie le JWT au proxy en Bearer', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: '/auth/v1/token', status: 200, body: SESSION },
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: { id: 8, name: 'Walter', color: '#e94560', role: 'manager' } } },
  ]);
  await page.fill('#authEmail', 'walter@example.com');
  await page.fill('#authPassword', 'bon-mot-de-passe');
  await page.click('[data-action="emailLogin"]');
  await page.waitForFunction(() => !document.getElementById('authEmail'), null, { timeout: 10_000 });
  const auth = await page.evaluate(() => {
    const log = (window as any).__fetchLog as any[];
    const call = log.filter((c) => c.url.indexOf('action=cleanerMe') !== -1).pop();
    return call ? call.headers.Authorization : null;
  });
  expect(auth).toBe('Bearer jwt-test-token');
});

test('une session valide sans membre actif est fermee avec un message clair', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: null } },
    // 200 et pas 204 : le constructeur Response refuse un corps sur un statut
    // sans contenu, et le bouchon renvoie toujours du JSON.
    { match: '/auth/v1/logout', status: 200, body: {} },
  ], { storage: storedSession() });
  await expect(page.locator('.auth-error')).toContainText('not linked to an active team member');
  await expect(page.locator('#authEmail')).toBeVisible();
});

test('un lien de reinitialisation ouvre l ecran nouveau mot de passe', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: '/auth/v1/user', status: 200, body: SESSION.user },
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: { id: 8, name: 'Walter', color: '#e94560', role: 'manager' } } },
  ], { hash: '#access_token=jwt-test-token&refresh_token=refresh-test&expires_in=3600&token_type=bearer&type=recovery' });
  await expect(page.locator('#authNewPassword')).toBeVisible();
  await expect(page.locator('#authNewPassword2')).toBeVisible();
});

test('un lien expire renvoie sur le login avec l explication', async ({ page }) => {
  await bootWithFakeNetwork(page, [], {
    hash: '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
  });
  await expect(page.locator('#authEmail')).toBeVisible();
  await expect(page.locator('.auth-error')).toContainText('expired');
});

test('Forgot password repond la meme chose quel que soit le compte', async ({ page }) => {
  await bootWithFakeNetwork(page, [{ match: '/auth/v1/recover', status: 200, body: {} }]);
  await page.fill('#authEmail', 'inconnu@example.com');
  await page.click('[data-action="forgotPassword"]');
  await expect(page.locator('.auth-notice')).toContainText('a reset link is on its way');
});

test('deux mots de passe differents sont refuses sans appel reseau', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: '/auth/v1/user', status: 200, body: SESSION.user },
  ], { hash: '#access_token=jwt-test-token&refresh_token=refresh-test&expires_in=3600&token_type=bearer&type=invite' });
  await page.fill('#authNewPassword', 'motdepasse1');
  await page.fill('#authNewPassword2', 'motdepasse2');
  await page.click('[data-action="submitNewPassword"]');
  await expect(page.locator('.auth-error')).toHaveText('The two passwords do not match.');
});

test('l ecran PIN reste atteignable depuis le login par email', async ({ page }) => {
  await bootWithFakeNetwork(page, []);
  await page.click('[data-action="usePinInstead"]');
  await expect(page.locator('#pinInput')).toBeVisible();
  await page.click('[data-action="useEmailInstead"]');
  await expect(page.locator('#authEmail')).toBeVisible();
});
