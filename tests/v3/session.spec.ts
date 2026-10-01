import { expect, test } from '@playwright/test';
import { bootV3, emailSession, fetchLog, tokenResponse } from './helpers';

// Session email de la v3 : renouvelee par supabase-js (meme client, meme
// storageKey que l'app racine), au lieu d'etre abandonnee apres une heure.

const JOURNEE = {
  status: 'success',
  date: '2026-09-12',
  me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true,
  totalMinutes: 0,
  stops: [],
};
const MYDAY = { match: 'action=v3.myDay', status: 200, body: JOURNEE };
const TICK_OK = { match: 'action=v3.tick', status: 200, body: { status: 'success' } };
const REFRESH_OK = { match: '/auth/v1/token', status: 200, body: tokenResponse('jwt-neuf', 'rt-2') };
const REFRESH_REFUSE = {
  match: '/auth/v1/token', status: 400,
  body: { code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' },
};

function appelsProxy(log: Array<{ url: string; headers: any }>, action?: string) {
  return log.filter((l) => l.url.indexOf('hostaway-proxy') !== -1 &&
    (!action || l.url.indexOf('action=' + action) !== -1));
}
function appelsToken(log: Array<{ url: string }>) {
  return log.filter((l) => l.url.indexOf('/auth/v1/token') !== -1);
}
async function stocke(page: any) {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('hkAuthSession');
    return raw ? JSON.parse(raw) : null;
  });
}
async function lireSession(page: any) {
  return await page.evaluate(async () => {
    const m = await import('/v3/session.js');
    return await m.getSession();
  });
}

// Point 1. Le bundle vendor est une balise classique AVANT le module, et le
// client est cree une seule fois avec exactement les options de la racine, sauf
// detectSessionInUrl (le fragment de /v3/ est le routeur).
test('un seul client supabase-js, avec les options de la racine', async ({ page }) => {
  const html = await (await page.request.get('/v3/index.html')).text();
  const vendor = html.indexOf('<script src="/vendor/supabase-js-2.116.0.umd.js"></script>');
  const module = html.indexOf('<script type="module" src="/v3/app.js"></script>');
  expect(vendor).toBeGreaterThan(-1);
  expect(module).toBeGreaterThan(vendor);

  await page.addInitScript(() => {
    (window as any).__sbCreate = [];
    let lib: any;
    Object.defineProperty(window, 'supabase', {
      configurable: true,
      get() { return lib; },
      set(v: any) {
        const orig = v.createClient;
        v.createClient = function (url: string, key: string, opts: any) {
          (window as any).__sbCreate.push({ url, key: key ? 'present' : '', opts: JSON.parse(JSON.stringify(opts)) });
          return orig.apply(this, arguments as any);
        };
        lib = v;
      },
    });
  });
  await bootV3(page, [MYDAY], { emailSession: emailSession('jwt-frais', 'rt-1', 3600) });
  await lireSession(page);
  await lireSession(page);
  const crees = await page.evaluate(() => (window as any).__sbCreate);
  expect(crees.length).toBe(1);
  expect(crees[0].url).toBe('https://dqjnqvbxfwtvrjwnnmns.supabase.co');
  expect(crees[0].key).toBe('present');
  expect(crees[0].opts).toEqual({
    auth: {
      flowType: 'implicit', persistSession: true, autoRefreshToken: true,
      detectSessionInUrl: false, storageKey: 'hkAuthSession',
    },
  });
});

// Point 2.
test('jeton valide : Bearer, sans aucun appel a Supabase Auth', async ({ page }) => {
  await bootV3(page, [MYDAY], { emailSession: emailSession('jwt-frais', 'rt-1', 3600) });
  expect(await lireSession(page)).toEqual({ kind: 'bearer', token: 'jwt-frais' });
  const log = await fetchLog(page);
  const myDay = appelsProxy(log, 'v3.myDay');
  expect(myDay.length).toBeGreaterThan(0);
  expect(myDay[0].headers['Authorization']).toBe('Bearer jwt-frais');
  expect(appelsToken(log)).toEqual([]);
});

// Point 3, et point 7 : aucun appel au proxy ne part avec le Bearer expire.
test('jeton expire, reseau OK : renouvele, stocke, et v3.myDay part avec le nouveau Bearer', async ({ page }) => {
  await bootV3(page, [MYDAY], {
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    authRoutes: [REFRESH_OK],
  });
  await expect(page.getByText('Sign in on HK Planner to see your day.')).toHaveCount(0);
  const log = await fetchLog(page);
  const token = appelsToken(log);
  expect(token.length).toBe(1);
  expect(token[0].url).toContain('grant_type=refresh_token');
  expect(token[0].body).toContain('rt-1');
  const myDay = appelsProxy(log, 'v3.myDay');
  expect(myDay.length).toBe(1);
  expect(myDay[0].headers['Authorization']).toBe('Bearer jwt-neuf');
  expect(appelsProxy(log).some((l) => String(l.headers['Authorization']).indexOf('jwt-perime') !== -1)).toBe(false);
  const s = await stocke(page);
  expect(s.refresh_token).toBe('rt-2');
  expect(s.access_token).toBe('jwt-neuf');
  expect(await lireSession(page)).toEqual({ kind: 'bearer', token: 'jwt-neuf' });
});

// Point 7, en cours de vie : le jeton expire pendant que l'app est ouverte. Le
// geste suivant lit la session au moment de l'envoi, pas celle du boot.
test('un jeton qui expire app ouverte est renouvele avant le geste suivant', async ({ page }) => {
  await bootV3(page, [MYDAY, TICK_OK], {
    emailSession: emailSession('jwt-frais', 'rt-1', 3600),
    authRoutes: [REFRESH_OK],
  });
  await page.evaluate((s) => localStorage.setItem('hkAuthSession', JSON.stringify(s)),
    emailSession('jwt-perime', 'rt-1', -60));
  const r = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return await m.sendOrQueue('v3.tick', { jobId: 'j', itemId: 'i', idem: 'k1' });
  });
  expect(r.ok).toBe(true);
  const tick = appelsProxy(await fetchLog(page), 'v3.tick');
  expect(tick.length).toBe(1);
  expect(tick[0].headers['Authorization']).toBe('Bearer jwt-neuf');
});

// Point 4. Le reseau tombe pendant le renouvellement : la cleaner reste dans
// l'app, ses gestes partent dans la file, et le retour du reseau les rejoue
// avec un Bearer renouvele.
test('jeton expire, hors ligne : session stale, pas d ecran de connexion, rejeu avec le Bearer renouvele', async ({ page }) => {
  await bootV3(page, [MYDAY, TICK_OK], {
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    authRoutes: [REFRESH_OK],
    offline: true,
  });
  await expect(page.getByText('No network. Your saved actions will sync on their own.')).toBeVisible();
  await expect(page.getByText('Sign in on HK Planner to see your day.')).toHaveCount(0);
  expect(await lireSession(page)).toEqual({ kind: 'stale', token: null });
  // La session n'est pas effacee : un echec reseau n'est pas un refus.
  expect((await stocke(page)).refresh_token).toBe('rt-1');

  const r = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return await m.sendOrQueue('v3.tick', { jobId: 'j', itemId: 'i', idem: 'k1' });
  });
  expect(r).toEqual({ ok: false, queued: true, data: null });
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
  // Rien n'est parti au proxy sans identite ou avec le Bearer expire.
  expect(appelsProxy(await fetchLog(page))).toEqual([]);

  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(async () => appelsProxy(await fetchLog(page), 'v3.tick').length, { timeout: 30_000 }).toBe(1);
  const tick = appelsProxy(await fetchLog(page), 'v3.tick');
  expect(tick[0].headers['Authorization']).toBe('Bearer jwt-neuf');
  expect(tick[0].body).toContain('k1');
  await expect(page.getByText('Saved on device, 1 to sync')).toHaveCount(0);
  expect((await stocke(page)).refresh_token).toBe('rt-2');
});

// Point 4, coupure franche (navigator.onLine faux) : aucune attente sur le
// client, la reponse est immediate.
test('hors ligne franc : stale tout de suite, et le PIN passe avant stale', async ({ page, context }) => {
  await bootV3(page, [MYDAY], { emailSession: emailSession('jwt-frais', 'rt-1', 3600) });
  await page.evaluate((s) => localStorage.setItem('hkAuthSession', JSON.stringify(s)),
    emailSession('jwt-perime', 'rt-1', -60));
  await context.setOffline(true);
  const t0 = Date.now();
  expect(await lireSession(page)).toEqual({ kind: 'stale', token: null });
  expect(Date.now() - t0).toBeLessThan(2000);
  await page.evaluate(() => localStorage.setItem('cleanerToken', 'jeton-pin'));
  expect(await lireSession(page)).toEqual({ kind: 'pin', token: 'jeton-pin' });
  const ok = await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    try { await m.api.get('v3.myDay', {}); return 'sent'; } catch (e: any) { return e.kind; }
  });
  expect(ok).toBe('offline');
  await context.setOffline(false);
});

// Ruling : en stale, aucun appel sans identite ne part au proxy. Le journal du
// bouchon enregistre chaque fetch vers le proxy, meme refuse hors ligne : un
// journal vide prouve que la requete n'a jamais ete tentee.
test('en stale, une requete est hors ligne avant tout fetch, et sans en-tete d identite', async ({ page }) => {
  await bootV3(page, [MYDAY], {
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    offline: true,
  });
  const r = await page.evaluate(async () => {
    const s = await import('/v3/session.js');
    const a = await import('/v3/api.js');
    const sess = await s.getSession();
    let kind = 'sent';
    try { await a.api.get('v3.myDay', {}); } catch (e: any) { kind = e.kind; }
    return { sess, kind, headers: a.authHeaders({ kind: 'stale', token: null }) };
  });
  expect(r.sess).toEqual({ kind: 'stale', token: null });
  expect(r.kind).toBe('offline');
  expect(appelsProxy(await fetchLog(page))).toEqual([]);
  expect(r.headers['Authorization']).toBeUndefined();
  expect(r.headers['X-Cleaner-Token']).toBeUndefined();
  expect(r.headers['X-App-Secret']).toBeTruthy();
});

// Point 5, sans PIN : l'ecran de connexion existant.
test('refresh token refuse sans PIN : ecran sign in, session effacee', async ({ page }) => {
  await bootV3(page, [MYDAY], {
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    authRoutes: [REFRESH_REFUSE],
  });
  await expect(page.getByText('Sign in on HK Planner to see your day.')).toBeVisible();
  expect(await stocke(page)).toBeNull();
  expect(appelsProxy(await fetchLog(page))).toEqual([]);
  expect(await lireSession(page)).toBeNull();
});

// Point 5 et point 6, avec PIN : le PIN prend le relais.
test('refresh token refuse avec PIN : la journee part avec le jeton PIN', async ({ page }) => {
  await bootV3(page, [MYDAY], {
    pinToken: 'jeton-pin',
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    authRoutes: [REFRESH_REFUSE],
  });
  await expect(page.getByText('Sign in on HK Planner to see your day.')).toHaveCount(0);
  const myDay = appelsProxy(await fetchLog(page), 'v3.myDay');
  expect(myDay.length).toBe(1);
  expect(myDay[0].headers['X-Cleaner-Token']).toBe('jeton-pin');
  expect(myDay[0].headers['Authorization']).toBeUndefined();
  expect(await lireSession(page)).toEqual({ kind: 'pin', token: 'jeton-pin' });
});

// Point 6 : Bearer valide > PIN.
test('Bearer valide passe avant le PIN', async ({ page }) => {
  await bootV3(page, [MYDAY], { pinToken: 'jeton-pin', emailSession: emailSession('jwt-frais', 'rt-1', 3600) });
  expect(await lireSession(page)).toEqual({ kind: 'bearer', token: 'jwt-frais' });
  const myDay = appelsProxy(await fetchLog(page), 'v3.myDay');
  expect(myDay[0].headers['Authorization']).toBe('Bearer jwt-frais');
  expect(myDay[0].headers['X-Cleaner-Token']).toBeUndefined();
});

// Point 8 : un 401 du proxy avec un Bearer declenche UN renouvellement et UN
// nouvel essai.
test('401 du proxy puis succes : un renouvellement, un nouvel essai avec le nouveau Bearer', async ({ page }) => {
  await bootV3(page, [
    MYDAY,
    { match: 'action=v3.tick', status: 401, body: { error: 'auth required' }, once: true },
    TICK_OK,
  ], { emailSession: emailSession('jwt-frais', 'rt-1', 3600), authRoutes: [REFRESH_OK] });
  const r = await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    return await m.api.post('v3.tick', { jobId: 'j', itemId: 'i', idem: 'k2' });
  });
  expect(r).toEqual({ status: 'success' });
  const log = await fetchLog(page);
  const tick = appelsProxy(log, 'v3.tick');
  expect(tick.map((t) => t.headers['Authorization'])).toEqual(['Bearer jwt-frais', 'Bearer jwt-neuf']);
  // Meme requete, meme cle d'idempotence : le nouvel essai ne reconstruit rien.
  expect(tick[1].body).toBe(tick[0].body);
  expect(tick[0].body).toContain('k2');
  expect(appelsToken(log).length).toBe(1);
});

test('401 du proxy deux fois : ApiError auth, sans boucle', async ({ page }) => {
  await bootV3(page, [
    MYDAY,
    { match: 'action=v3.tick', status: 401, body: { error: 'auth required' } },
  ], { emailSession: emailSession('jwt-frais', 'rt-1', 3600), authRoutes: [REFRESH_OK] });
  const r = await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    try { await m.api.post('v3.tick', { jobId: 'j', itemId: 'i', idem: 'k3' }); return 'ok'; } catch (e: any) { return e.kind + ':' + e.status; }
  });
  expect(r).toBe('auth:401');
  const log = await fetchLog(page);
  expect(appelsProxy(log, 'v3.tick').length).toBe(2);
  expect(appelsToken(log).length).toBe(1);
});

// Le 401 du secret applicatif (« unauthorized ») ne dit rien de la session :
// aucun renouvellement, donc aucune rotation du refresh token pour rien.
test('401 unauthorized (secret applicatif) avec un Bearer : aucun renouvellement', async ({ page }) => {
  await bootV3(page, [
    MYDAY,
    { match: 'action=v3.tick', status: 401, body: { error: 'unauthorized' } },
  ], { emailSession: emailSession('jwt-frais', 'rt-1', 3600), authRoutes: [REFRESH_OK] });
  const r = await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    try { await m.api.post('v3.tick', { idem: 'k5' }); return 'ok'; } catch (e: any) { return e.kind + ':' + e.status; }
  });
  expect(r).toBe('auth:401');
  const log = await fetchLog(page);
  expect(appelsProxy(log, 'v3.tick').length).toBe(1);
  expect(appelsToken(log)).toEqual([]);
  expect((await stocke(page)).refresh_token).toBe('rt-1');
});

test('401 du proxy avec un PIN : aucun renouvellement, ApiError auth', async ({ page }) => {
  await bootV3(page, [
    MYDAY,
    { match: 'action=v3.tick', status: 401, body: { error: 'auth required' } },
  ], { pinToken: 'jeton-pin' });
  const r = await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    try { await m.api.post('v3.tick', { idem: 'k4' }); return 'ok'; } catch (e: any) { return e.kind; }
  });
  expect(r).toBe('auth');
  const log = await fetchLog(page);
  expect(appelsProxy(log, 'v3.tick').length).toBe(1);
  expect(appelsToken(log)).toEqual([]);
});

// Point 9 : la deconnexion passe par le client (auth.signOut, portee locale).
test('Sign out retire la session email par le client', async ({ page }) => {
  await bootV3(page, [MYDAY, { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } }], {
    emailSession: emailSession('jwt-frais', 'rt-1', 3600),
    hash: '#/profile',
  });
  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  expect(await stocke(page)).toBeNull();
  const logout = (await fetchLog(page)).filter((l) => l.url.indexOf('/auth/v1/logout') !== -1);
  expect(logout.length).toBe(1);
  expect(logout[0].url).toContain('scope=local');
});

// Point 11 : sans le bundle vendor, la v3 marche encore comme avant.
test('sans window.supabase : lecture directe, Bearer frais puis PIN, et un avertissement', async ({ page }) => {
  const avertissements: string[] = [];
  page.on('console', (m) => { if (m.type() === 'warning') avertissements.push(m.text()); });
  await page.route('**/vendor/supabase-js-2.116.0.umd.js', (route) => route.fulfill({ status: 404, body: '' }));
  await bootV3(page, [MYDAY], { pinToken: 'jeton-pin', emailSession: emailSession('jwt-frais', 'rt-1', 3600) });
  expect(await page.evaluate(() => typeof (window as any).supabase)).toBe('undefined');
  expect(await lireSession(page)).toEqual({ kind: 'bearer', token: 'jwt-frais' });
  expect(appelsProxy(await fetchLog(page), 'v3.myDay')[0].headers['Authorization']).toBe('Bearer jwt-frais');
  await page.evaluate((s) => localStorage.setItem('hkAuthSession', JSON.stringify(s)),
    emailSession('jwt-perime', 'rt-1', -60));
  expect(await lireSession(page)).toEqual({ kind: 'pin', token: 'jeton-pin' });
  await page.evaluate(() => localStorage.removeItem('cleanerToken'));
  expect(await lireSession(page)).toBeNull();
  expect(avertissements.some((t) => t.indexOf('supabase') !== -1)).toBe(true);
  expect(appelsToken(await fetchLog(page))).toEqual([]);
});

// Constat 1 de la revue. La boucle de retry du client (30 s) se termine en echec
// hors ligne : supabase-js garde cet echec 60 s pour le meme refresh token. Le
// retour du reseau doit l'effacer, sinon le rejeu attendrait 60 a 90 s.
test('retour du reseau apres un echec de renouvellement en cache : rejeu en moins de 5 s', async ({ page }) => {
  test.setTimeout(120_000);
  await bootV3(page, [MYDAY, TICK_OK], {
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    authRoutes: [REFRESH_OK],
    offline: true,
  });
  // Le champ interne existe dans le bundle : une montee de version qui le
  // renomme doit casser ce test, pas desactiver la remise a zero en silence.
  expect(await page.evaluate(async () => {
    const m = await import('/v3/session.js');
    const c: any = m.supabaseClientForTests();
    return !!c && 'lastRefreshFailure' in c.auth;
  })).toBe(true);
  await expect.poll(async () => page.evaluate(async () => {
    const m = await import('/v3/session.js');
    const c: any = m.supabaseClientForTests();
    return c.auth.lastRefreshFailure !== null;
  }), { timeout: 60_000, intervals: [1000] }).toBe(true);

  const r = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return await m.sendOrQueue('v3.tick', { jobId: 'j', itemId: 'i', idem: 'k6' });
  });
  expect(r.queued).toBe(true);
  const t0 = Date.now();
  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(async () => appelsProxy(await fetchLog(page), 'v3.tick').length, { timeout: 5_000 }).toBe(1);
  expect(Date.now() - t0).toBeLessThan(5_000);
  expect(appelsProxy(await fetchLog(page), 'v3.tick')[0].headers['Authorization']).toBe('Bearer jwt-neuf');
});

// Constat 2. Une demande de rejeu qui arrive pendant un rejeu en cours n'est
// pas perdue : une seule passe de plus part a la fin.
test('un flush demande pendant un flush en cours relance exactement une passe', async ({ page }) => {
  await bootV3(page, [MYDAY, { ...TICK_OK, delay: 800 }], { pinToken: 'jeton-pin', offline: true });
  const r = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    await m.sendOrQueue('v3.tick', { idem: 'a1' });
    // Le journal garde aussi la tentative refusee hors ligne : on repart a vide.
    localStorage.setItem('v3FetchLog', '[]');
    localStorage.removeItem('v3TestOffline');
    const premier = m.flush();
    // Le rejeu a deja lu la file (une entree) : B arrive apres, puis une
    // demande de rejeu pendant que A est en vol.
    await new Promise((res) => setTimeout(res, 200));
    await m.enqueue({ action: 'v3.tick', body: { idem: 'b2' }, at: Date.now() });
    m.flush();
    m.flush();
    await premier;
    for (let i = 0; i < 50 && (await m.pendingCount()) > 0; i++) {
      await new Promise((res) => setTimeout(res, 100));
    }
    return await m.pendingCount();
  });
  expect(r).toBe(0);
  const tick = appelsProxy(await fetchLog(page), 'v3.tick');
  // A une fois, B une fois : ni passe perdue, ni passe en double.
  expect(tick.map((t) => JSON.parse(t.body).idem)).toEqual(['a1', 'b2']);
});

// Constat 2, variante : l'onglet de l'app racine a renouvele ou reconnecte, le
// client de la v3 recoit SIGNED_IN par BroadcastChannel, la file repart.
test('SIGNED_IN venu d un autre onglet relance le rejeu', async ({ page }) => {
  await bootV3(page, [MYDAY, TICK_OK], { emailSession: emailSession('jwt-frais', 'rt-1', 3600) });
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  const r = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return await m.sendOrQueue('v3.tick', { idem: 'c3' });
  });
  expect(r.queued).toBe(true);
  // Reseau revenu sans evenement « online » : seul SIGNED_IN peut relancer.
  // Le journal garde aussi la tentative refusee hors ligne : on repart a vide.
  await page.evaluate((s) => {
    localStorage.setItem('v3FetchLog', '[]');
    localStorage.removeItem('v3TestOffline');
    const ch = new BroadcastChannel('hkAuthSession');
    ch.postMessage({ event: 'SIGNED_IN', session: s });
    ch.close();
  }, emailSession('jwt-frais', 'rt-1', 3600));
  await expect.poll(async () => appelsProxy(await fetchLog(page), 'v3.tick').length, { timeout: 5_000 }).toBe(1);
  await expect(page.getByText('Saved on device, 1 to sync')).toHaveCount(0);
});

// Constat 3. Demarrage en « stale » sur un reseau lent : le renouvellement
// aboutit apres le delai de 4 s, la journee se recharge d'elle-meme.
test('renouvellement tardif apres un demarrage en stale : la journee remplace No network', async ({ page }) => {
  await bootV3(page, [MYDAY], {
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    authRoutes: [{ ...REFRESH_OK, delay: 6_000 }],
  });
  await expect(page.getByText('No network. Your saved actions will sync on their own.')).toBeVisible();
  await expect(page.getByText('No network. Your saved actions will sync on their own.')).toHaveCount(0, { timeout: 10_000 });
  const myDay = appelsProxy(await fetchLog(page), 'v3.myDay');
  expect(myDay.length).toBe(1);
  expect(myDay[0].headers['Authorization']).toBe('Bearer jwt-neuf');
});

// Constat 6. Hors ligne avec un jeton expire, auth.signOut ne peut pas aboutir
// (il attend le renouvellement, puis /logout) : le filet de signOutEmail est
// alors la seule chose qui retire la session du telephone.
test('signOutEmail hors ligne avec un jeton expire efface quand meme la session', async ({ page }) => {
  await bootV3(page, [MYDAY], {
    emailSession: emailSession('jwt-perime', 'rt-1', -60),
    offline: true,
  });
  const t0 = Date.now();
  await page.evaluate(async () => {
    const m = await import('/v3/session.js');
    await m.signOutEmail();
  });
  expect(Date.now() - t0).toBeLessThan(6_000);
  expect(await stocke(page)).toBeNull();
  expect(await lireSession(page)).toBeNull();
});
