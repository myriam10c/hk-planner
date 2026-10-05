import { expect, test } from '@playwright/test';
import { bootV3, emailSession, fetchLog, noHorizontalScroll } from './helpers';

// Ecran Profile (compte, envois en echec, deconnexion, View as / Practice),
// garde de la v3 et ouvert depuis l'en-tete de la liste du jour. Ces tests
// vivaient dans report.spec.ts, retire avec l'ancien ecran Report (tache 4 du
// plan 2026-10-05) : ils sont repris ici sans changement de fond.

const STOP = {
  jobId: 'job_3f2a9c81d47b60e5a2f9', listingId: '102', listingName: '623 Samana Park View',
  aptNumber: '623', unitType: '1 BHK', templateName: '1 Bedroom',
  checkOutTime: '12:00', nextArrivalDate: '2026-09-12', nextArrivalTime: '15:00',
  sameDay: true, guest: 'Marc L.', nextGuest: 'Anna W.', estimatedMinutes: 118,
  state: 'running', startedAt: new Date(Date.now() - 60000).toISOString(),
  checklist: ['Bathroom'], photoRequired: [], progress: {}, openTickets: [], label: null,
  rooms: ['Bedroom', 'Living room', 'Kitchen', 'Bathroom', 'Balcony'], heroPhotoUrl: null,
  othersOnJob: [], references: {},
};

const JOURNEE = {
  status: 'success', date: '2026-09-12', me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true, totalMinutes: 118, stops: [STOP],
};

const ROUTES = [
  { match: 'action=v3.myDay', status: 200, body: JOURNEE },
  { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
];

test('Profile renvoie vers l app actuelle et permet de se deconnecter', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin', hash: '#/profile' });
  await expect(page.getByRole('heading', { name: 'Faiza' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open HK Planner' })).toHaveAttribute('href', '/#cleaner');
  // Aucune action refusee dans ce parcours : le bloc « Not sent » reste absent.
  await expect(page.getByText('Not sent')).toHaveCount(0);
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  expect(await page.evaluate(() => localStorage.getItem('cleanerToken'))).toBeNull();
  expect((await fetchLog(page)).some((l) => l.url.indexOf('action=cleanerLogout') !== -1)).toBe(true);
});

// Constat 1 de la revue de la tache 12, securite : la deconnexion revoque la
// session PIN au serveur meme quand une session email pose le Bearer, et ne
// laisse aucune donnee de session sur le telephone.
test('Sign out revoque la session au serveur et ne laisse aucune donnee sur le telephone', async ({ page }) => {
  await bootV3(page, ROUTES, {
    pinToken: 'jeton-pin',
    emailSession: emailSession('jwt-frais', 'rt-1', 3600),
    hash: '#/profile',
  });
  await page.evaluate(() => {
    localStorage.setItem('cleanerMode', 'cleaner');
    localStorage.setItem('hkPlannerCache', JSON.stringify([{ guest: 'Marc Lefevre', phone: '+971500000000' }]));
    localStorage.setItem('hkSessionCleanerId', '3');
  });
  await page.route((url) => url.pathname === '/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>',
  }));
  await Promise.all([
    page.waitForURL(/#cleaner$/),
    page.getByRole('button', { name: 'Sign out' }).click(),
  ]);
  expect(await page.evaluate(() => ({
    pin: localStorage.getItem('cleanerToken'),
    email: localStorage.getItem('hkAuthSession'),
    mode: localStorage.getItem('cleanerMode'),
    cache: localStorage.getItem('hkPlannerCache'),
    cleanerId: localStorage.getItem('hkSessionCleanerId'),
  }))).toEqual({ pin: null, email: null, mode: null, cache: null, cleanerId: null });
  expect(await page.evaluate(async () => {
    const m = await import('/v3/api.js');
    return await m.readSession();
  })).toBeNull();
  const appels = (await fetchLog(page)).filter((l) => l.url.indexOf('action=cleanerLogout') !== -1);
  expect(appels.length).toBe(1);
  expect(appels[0].headers['X-Cleaner-Token']).toBe('jeton-pin');
});

// Le magasin mort n'existe que si quelqu'un le lit : c'est la raison d'etre du
// bloc « Not sent » de Profile.
test('Profile montre les actions refusees par le proxy et sait vider la liste', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.reportProblem', status: 400, body: { error: 'unknown kind' } },
  ], { pinToken: 'jeton-pin' });
  await page.evaluate(async () => {
    localStorage.setItem('v3TestOffline', '1');
    const m = await import('/v3/offline.js');
    await m.sendOrQueue('v3.reportProblem', { jobId: 'job_3f2a9c81d47b60e5a2f9', kind: 'Leak', idem: m.newIdem() });
  });
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.getByText('Not sent: unknown kind. Tell your manager.')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('link', { name: 'Profile' }).click();
  await expect(page.getByText('Not sent', { exact: true })).toBeVisible();
  await expect(page.getByText('reportProblem')).toBeVisible();
  await page.getByRole('button', { name: 'Clear this list' }).click();
  await expect(page.getByText('Not sent', { exact: true })).toHaveCount(0);
});
