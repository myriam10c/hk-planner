import { test, expect } from '@playwright/test';

// app.js n'est pas modulaire : ses fonctions de premier niveau sont des globales.
// On teste les helpers purs directement, et les parcours reseau en bouchonnant
// window.fetch AVANT le chargement d'app.js (addInitScript). Le vrai supabase-js
// tourne donc sur des reponses HTTP fabriquees, ce qui teste l'integration reelle.
//
// Boucle locale rapide :
//   python3 -m http.server 8890
//   HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/auth.spec.ts --project=desktop

// `delay` retarde la reponse, `fail` la rejette comme une panne reseau, `never`
// ne la resout jamais : les trois modes de defaillance du proxy la nuit.
type FakeRoute = { match: string; status: number; body: any; delay?: number; fail?: boolean; never?: boolean };

const SESSION = {
  access_token: 'jwt-test-token',
  refresh_token: 'refresh-test',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: 'u1', email: 'walter@example.com', aud: 'authenticated', role: 'authenticated' },
};

async function bootWithFakeNetwork(
  page: any,
  routes: FakeRoute[],
  opts: { hash?: string; storage?: any; pinToken?: string } = {},
) {
  await page.addInitScript(
    (cfg: { routes: FakeRoute[]; storage: any; pinToken: string | null }) => {
      if (cfg.storage) {
        try { localStorage.setItem('hkAuthSession', JSON.stringify(cfg.storage)); } catch (e) { /* ignore */ }
      }
      if (cfg.pinToken) {
        try { localStorage.setItem('cleanerToken', cfg.pinToken); } catch (e) { /* ignore */ }
      }
      // Un rejet de promesse non gere est une regression a part entiere : l'app
      // reste blanche et rien ne le signale. On les collecte pour les asserter.
      (window as any).__unhandled = [];
      window.addEventListener('unhandledrejection', (ev: any) => {
        (window as any).__unhandled.push(String((ev && ev.reason) || ''));
      });
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
            if (r.never) return new Promise(() => { /* jamais resolue */ });
            const make = () => new Response(JSON.stringify(r.body), {
              status: r.status, headers: { 'Content-Type': 'application/json' },
            });
            if (r.fail) {
              return new Promise((_res, rej) => setTimeout(
                () => rej(new TypeError('Failed to fetch')), r.delay || 0));
            }
            if (r.delay) return new Promise((res) => setTimeout(() => res(make()), r.delay));
            return Promise.resolve(make());
          }
        }
        if (url.indexOf(location.origin) === 0 || url.charAt(0) === '/') return real(input, init);
        return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }) as any;
    },
    { routes, storage: opts.storage ?? null, pinToken: opts.pinToken ?? null },
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

// Session dont le JWT est perime : supabase-js va tenter un rafraichissement
// reseau au premier getSession().
function expiredSession() {
  return { ...SESSION, expires_at: Math.floor(Date.now() / 1000) - 60 };
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

// ===== Fix round 1 : constats de la revue (task-6-review.md) =====

test('constat 1 : proxy injoignable avec une session email, l app rend quand meme', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e: any) => crashes.push(String(e)));
  // Toutes les requetes du proxy echouent : c'est la nuit de 22 h a 7 h Dubai.
  await bootWithFakeNetwork(page, [
    { match: 'action=', status: 0, body: null, fail: true },
  ], { storage: storedSession() });
  // L'app doit sortir de l'etat d'attente et laisser fetchAll afficher son
  // erreur habituelle, pas rester sur un ecran blanc.
  await expect(page.locator('#app')).toContainText('Housekeeping Planner', { timeout: 6_000 });
  const unhandled = await page.evaluate(() => (window as any).__unhandled || []);
  expect(unhandled).toEqual([]);
  expect(crashes).toEqual([]);
});

test('constat 3 : un mot de passe faux garde l email saisi', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: '/auth/v1/token', status: 400, body: { error_code: 'invalid_credentials', msg: 'Invalid login credentials' } },
    { match: '/auth/v1/recover', status: 200, body: {} },
  ]);
  await page.fill('#authEmail', 'walter@example.com');
  await page.fill('#authPassword', 'mauvais');
  await page.click('[data-action="emailLogin"]');
  await expect(page.locator('.auth-error')).toHaveText('Wrong email or password.');
  await expect(page.locator('#authEmail')).toHaveValue('walter@example.com');
  // Consequence directe : Forgot password lit une adresse, plus un champ vide.
  await page.click('[data-action="forgotPassword"]');
  await expect(page.locator('.auth-notice')).toContainText('a reset link is on its way');
});

test('constat 4 : un proxy lent affiche un etat d attente des le depart', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerMe', status: 200, delay: 3000, body: { status: 'success', cleaner: { id: 8, name: 'Walter', color: '#e94560', role: 'manager' } } },
  ], { storage: storedSession() });
  await expect(page.locator('#app')).toContainText('Signing you in', { timeout: 500 });
});

test('constat 4 : une session PIN ouvre l app sans attendre le rafraichissement du JWT', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    // Le rafraichissement ne repond jamais : hors ligne, supabase-js peut y
    // passer 25 a 40 secondes.
    { match: 'grant_type=refresh_token', status: 200, body: {}, never: true },
    { match: 'action=', status: 200, body: { status: 'success', reservations: [], done: {}, assignments: {}, cleaners: [], templates: [] } },
  ], { storage: expiredSession(), pinToken: 'pin-session-test' });
  // La vue planner s'ouvre sur le jeton PIN, sans attendre le JWT.
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#authEmail')).toHaveCount(0);
  await expect(page.locator('#app')).not.toContainText('Signing you in');
});

test('constat 6 : email_not_confirmed ne revele plus qu un compte existe', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).authErrorMessage === 'function', null, { timeout: 10_000 });
  const m = await page.evaluate(() => (window as any).authErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' }));
  expect(m).toBe('Wrong email or password.');
});

test('constat 7 : l ecran PIN est presente comme un deverrouillage rapide', async ({ page }) => {
  await bootWithFakeNetwork(page, []);
  await page.click('[data-action="usePinInstead"]');
  await expect(page.locator('.pin-screen')).toContainText('Quick unlock');
  await expect(page.locator('.pin-screen')).toContainText('Enter your 4-digit PIN');
  await expect(page.locator('.pin-screen')).not.toContainText('Cleaner Login');
  await expect(page.locator('[data-action="useEmailInstead"]')).toBeVisible();
});

test('un 401 sur cleanerMe garde le message de session terminee', async ({ page }) => {
  // Sans le garde-fou d'adoptEmailSession, le message « pas de membre actif »
  // ecrasait celui du 401 et disait faux au manager.
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerMe', status: 401, body: { error: 'unauthorized' } },
    { match: '/auth/v1/logout', status: 200, body: {} },
  ], { storage: storedSession() });
  await expect(page.locator('.auth-error')).toHaveText('Your session ended. Sign in again.');
  await expect(page.locator('#authEmail')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Fix round final de la revue de branche (constats 1 et 4).
// ---------------------------------------------------------------------------

test('revue finale constat 1 : un manager connecte par email peut se deconnecter', async ({ page }) => {
  // adoptEmailSession met cleanerMode a null pour un manager, et les trois
  // boutons Logout etaient gates sur cleanerMode : aucun moyen de sortir.
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: { id: 8, name: 'Walter', color: '#e94560', role: 'manager' } } },
    { match: '/auth/v1/logout', status: 200, body: {} },
    { match: 'action=', status: 200, body: { status: 'success', reservations: [], done: {}, assignments: {}, cleaners: [], templates: [] } },
  ], { storage: storedSession() });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  const logout = page.locator('.header [data-action="cleanerLogout"]').first();
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(page.locator('#authEmail')).toBeVisible({ timeout: 10_000 });
  const left = await page.evaluate(() => ({
    session: localStorage.getItem('hkAuthSession'),
    pin: localStorage.getItem('cleanerToken'),
    mode: localStorage.getItem('cleanerMode'),
  }));
  expect(left.session).toBeNull();
  expect(left.pin).toBeNull();
  expect(left.mode).toBeNull();
});

test('revue finale constat 4 : reason invalid_token dit que la session est terminee', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: null, reason: 'invalid_token' } },
    { match: '/auth/v1/logout', status: 200, body: {} },
  ], { storage: storedSession() });
  await expect(page.locator('.auth-error')).toHaveText('Your session ended. Sign in again.');
  await expect(page.locator('#authEmail')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hkAuthSession'))).toBeNull();
});

test('revue finale constat 4 : reason inactive dit que le compte est desactive', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: null, reason: 'inactive' } },
    { match: '/auth/v1/logout', status: 200, body: {} },
  ], { storage: storedSession() });
  await expect(page.locator('.auth-error')).toHaveText('This account is deactivated. Ask a manager.');
  await expect(page.locator('#authEmail')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hkAuthSession'))).toBeNull();
});

test('revue finale constat 4 : reason unlinked dit que le compte n est relie a personne', async ({ page }) => {
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: null, reason: 'unlinked' } },
    { match: '/auth/v1/logout', status: 200, body: {} },
  ], { storage: storedSession() });
  // Hotfix du 12/09 : le message ne renvoie plus vers un manager, il dit le
  // chemin que la personne peut prendre seule, et un bouton l y emmene.
  await expect(page.locator('.auth-error')).toHaveText(
    'This email is not linked to your profile yet. Sign in with your PIN, then add your email and password in your profile.');
  await expect(page.locator('#authEmail')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('hkAuthSession'))).toBeNull();
  await page.click('#authPinButton');
  await expect(page.locator('#pinInput')).toBeVisible();
});

test('correctif 11/09 : un manager connecte par PIN a aussi un bouton Logout', async ({ page }) => {
  // Un login PIN de role manager laisse cleanerMode a null (vue manager) et n a
  // pas de JWT : la condition cleanerMode||authAccessToken cachait le bouton.
  await bootWithFakeNetwork(page, [
    { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
    { match: 'action=', status: 200, body: { status: 'success', reservations: [], done: {}, assignments: {}, cleaners: [], templates: [] } },
  ], { pinToken: 'pin-manager-test' });
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  const logout = page.locator('.header [data-action="cleanerLogout"]').first();
  await expect(logout).toBeVisible();
  await logout.click();
  // Un logout PIN ramene sur l ecran PIN (Quick unlock), pas sur le login email.
  await expect(page.locator('#pinInput')).toBeVisible({ timeout: 10_000 });
  const left = await page.evaluate(() => ({
    pin: localStorage.getItem('cleanerToken'),
    mode: localStorage.getItem('cleanerMode'),
  }));
  expect(left.pin).toBeNull();
  expect(left.mode).toBeNull();
});

// ===== Hotfix du 12/09 : comptes en libre-service =====
//
// Parcours vise : un membre qui n'a qu'un PIN ouvre l'app, touche « First time
// here? Create your account », entre son PIN, choisit une adresse et un mot de
// passe, et repart avec une session email. Aucun manager dans la boucle.

const SEMAX = { id: 7, name: 'Semax', color: '#7c3aed', role: 'maintenance' };

// Reponses minimales de fetchAll : sans elles, le chargement des donnees jette
// et repeint l'ecran au milieu du test.
function dataRoutes(email: string | null): FakeRoute[] {
  return [
    { match: 'action=cleanerLogin', status: 200, body: { status: 'success', token: 'pin-test', cleaner: SEMAX } },
    { match: 'action=getCleaners', status: 200, body: { status: 'success', cleaners: [{ ...SEMAX, email }] } },
    { match: 'action=checkouts', status: 200, body: { status: 'success', reservations: [] } },
    {
      match: 'action=getAllData',
      status: 200,
      body: {
        status: 'success', done: {}, assignments: {}, cleaners: [{ ...SEMAX, email }],
        templates: [], listingPrices: {}, timers: {}, cancelled: {}, postponed: {},
        extraCleanings: [], leaves: [], holidays: [],
      },
    },
    { match: 'action=', status: 200, body: { status: 'success' } },
  ];
}

// Login par PIN depuis le lien « First time here? » de l'ecran email.
async function pinLoginFromCreateLink(page: any, routes: FakeRoute[]) {
  await bootWithFakeNetwork(page, routes);
  await page.click('[data-action="startAccountSetup"]');
  await expect(page.locator('#pinInput')).toBeVisible();
  await page.fill('#pinInput', '1234');
}

test('le login par email propose de creer son compte et mene a l ecran PIN', async ({ page }) => {
  await bootWithFakeNetwork(page, []);
  const lien = page.locator('[data-action="startAccountSetup"]');
  await expect(lien).toContainText('First time here? Create your account');
  await lien.click();
  await expect(page.locator('#pinInput')).toBeVisible();
  // La raison de l'ecran PIN est dite, sinon il ressemble a une impasse.
  await expect(page.locator('.pin-screen')).toContainText('Enter your PIN');
});

test('apres un PIN sans adresse, l ecran Create your account s ouvre et se saute', async ({ page }) => {
  await pinLoginFromCreateLink(page, dataRoutes(null));
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.auth-card')).toContainText('Create your account');
  await expect(page.locator('#linkPassword')).toBeVisible();
  await expect(page.locator('#linkPassword2')).toBeVisible();
  // Rien ne bloque : « Skip for now » rend la main a l'app.
  await page.click('[data-action="skipAccountSetup"]');
  await expect(page.locator('#linkEmail')).toHaveCount(0);
  // Et l'ecran reste atteignable depuis la zone profil (le bandeau ou vit Logout).
  const profil = page.locator('.header [data-action="openAccountSetup"]').first();
  await expect(profil).toBeVisible({ timeout: 10_000 });
  await profil.click();
  await expect(page.locator('#linkEmail')).toBeVisible();
});

test('un membre qui a deja une adresse n est pas invite a creer un compte', async ({ page }) => {
  await pinLoginFromCreateLink(page, dataRoutes('semax@example.com'));
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#linkEmail')).toHaveCount(0);
  await expect(page.locator('.header [data-action="openAccountSetup"]')).toHaveCount(0);
});

test('Create your account envoie linkEmail puis ouvre la session email', async ({ page }) => {
  await pinLoginFromCreateLink(page, [
    { match: 'action=linkEmail', status: 200, body: { status: 'success' } },
    { match: '/auth/v1/token', status: 200, body: SESSION },
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: SEMAX } },
    ...dataRoutes(null),
  ]);
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await page.fill('#linkEmail', '  Sserunkumavan@Example.COM ');
  await page.fill('#linkPassword', 'motdepasse1');
  await page.fill('#linkPassword2', 'motdepasse1');
  await page.click('[data-action="submitLinkEmail"]');
  await page.waitForFunction(() => !document.getElementById('linkEmail'), null, { timeout: 10_000 });
  const envoi = await page.evaluate(() => {
    const log = (window as any).__fetchLog as any[];
    const call = log.filter((c) => c.url.indexOf('action=linkEmail') !== -1).pop();
    return call ? JSON.parse(call.body) : null;
  });
  // L'adresse part normalisee, le corps ne porte aucun identifiant de membre :
  // l'identite vient de la session PIN, cote proxy.
  expect(envoi).toEqual({ email: 'sserunkumavan@example.com', password: 'motdepasse1' });
  // Puis le Bearer prend le relais du jeton PIN.
  const auth = await page.evaluate(() => {
    const log = (window as any).__fetchLog as any[];
    const call = log.filter((c) => c.url.indexOf('action=cleanerMe') !== -1).pop();
    return call ? call.headers.Authorization : null;
  });
  expect(auth).toBe('Bearer jwt-test-token');
});

test('deux mots de passe differents ne partent jamais au proxy', async ({ page }) => {
  await pinLoginFromCreateLink(page, dataRoutes(null));
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await page.fill('#linkEmail', 'semax@example.com');
  await page.fill('#linkPassword', 'motdepasse1');
  await page.fill('#linkPassword2', 'motdepasse2');
  await page.click('[data-action="submitLinkEmail"]');
  await expect(page.locator('.auth-error')).toHaveText('The two passwords do not match.');
  const appels = await page.evaluate(() =>
    ((window as any).__fetchLog as any[]).filter((c) => c.url.indexOf('action=linkEmail') !== -1).length);
  expect(appels).toBe(0);
});

test('un mot de passe trop court est refuse sans appel reseau', async ({ page }) => {
  await pinLoginFromCreateLink(page, dataRoutes(null));
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await page.fill('#linkEmail', 'semax@example.com');
  await page.fill('#linkPassword', 'court');
  await page.fill('#linkPassword2', 'court');
  await page.click('[data-action="submitLinkEmail"]');
  await expect(page.locator('.auth-error')).toHaveText('Password too short. Use at least 8 characters.');
  const appels = await page.evaluate(() =>
    ((window as any).__fetchLog as any[]).filter((c) => c.url.indexOf('action=linkEmail') !== -1).length);
  expect(appels).toBe(0);
});

test('un refus du proxy est affiche tel quel et garde l ecran', async ({ page }) => {
  await pinLoginFromCreateLink(page, [
    {
      match: 'action=linkEmail', status: 409,
      body: { error: 'This email is already used by another team member.' },
    },
    ...dataRoutes(null),
  ]);
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  await page.fill('#linkEmail', 'harlene@example.com');
  await page.fill('#linkPassword', 'motdepasse1');
  await page.fill('#linkPassword2', 'motdepasse1');
  await page.click('[data-action="submitLinkEmail"]');
  await expect(page.locator('.auth-error')).toHaveText('This email is already used by another team member.');
  await expect(page.locator('#linkEmail')).toBeVisible();
});

test('l ecran Create your account tient dans 390 px sans defilement horizontal', async ({ page }) => {
  await pinLoginFromCreateLink(page, dataRoutes(null));
  await expect(page.locator('#linkEmail')).toBeVisible({ timeout: 10_000 });
  const debord = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(debord).toBeLessThanOrEqual(0);
});
