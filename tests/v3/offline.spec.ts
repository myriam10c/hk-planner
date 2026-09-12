import { expect, test } from '@playwright/test';
import { bootV3, fetchLog } from './helpers';

const JOURNEE = {
  status: 'success',
  date: '2026-09-12',
  me: { id: 3, name: 'Faiza', role: 'cleaner' },
  linenRequired: true,
  totalMinutes: 306,
  stops: [
    {
      jobId: '2026-09-12_Marc Lefevre', listingId: '102', listingName: '623 Samana Park View',
      aptNumber: '623', unitType: '1 BHK', templateName: '1 Bedroom',
      checkOutTime: '12:00', nextArrivalDate: '2026-09-12', nextArrivalTime: '15:00',
      sameDay: true, guest: 'Marc L.', nextGuest: 'Anna W.', estimatedMinutes: 118,
      state: 'todo', startedAt: null,
      checklist: ['Master Bed & Linens', 'Bathroom', 'Final Check'],
      photoRequired: [], progress: {}, openTickets: [], label: null,
    },
  ],
};

const ROUTES = [
  { match: 'action=v3.myDay', status: 200, body: JOURNEE },
  { match: 'action=v3.startJob', status: 200, body: { status: 'success', jobId: '2026-09-12_Marc Lefevre', startedAt: '2026-09-12T08:00:00Z' } },
  { match: 'action=v3.tick', status: 200, body: { status: 'success' } },
];

test('hors ligne, les gestes sont gardes puis rejoues une seule fois, dans l ordre', async ({ page, context }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await expect(page.getByRole('heading', { name: '623 Samana Park View' })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Master Bed & Linens' }).click();
  await page.getByRole('button', { name: 'Bathroom' }).click();
  await page.getByRole('button', { name: 'Final Check' }).click();

  // Le bandeau dit exactement combien de gestes attendent.
  await expect(page.getByText('Saved on device, 3 to sync')).toBeVisible();
  // Les trois lignes restent cochees a l'ecran : le geste est acquis localement.
  await expect(page.getByRole('button', { name: 'Bathroom' })).toHaveAttribute('aria-pressed', 'true');

  await context.setOffline(false);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });

  const log = await fetchLog(page);
  const ticks = log.filter((l) => l.url.indexOf('action=v3.tick') !== -1);
  // Trois tentatives hors ligne plus trois rejeux : six entrees au journal,
  // mais trois cles d'idempotence distinctes et aucune repetee au rejeu.
  const idems = ticks.map((l) => JSON.parse(l.body).idem);
  expect(new Set(idems).size).toBe(3);
  const items = ticks.filter((_l, i) => i >= ticks.length - 3).map((l) => JSON.parse(l.body).itemId);
  expect(items).toEqual(['Master Bed & Linens', 'Bathroom', 'Final Check']);
});

test('un second retour en ligne ne rejoue rien', async ({ page, context }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Bathroom' }).click();
  // Attendre que le geste soit vraiment en file avant de repasser en ligne :
  // sans cette attente, toHaveCount(0) plus bas peut etre satisfait a vide
  // (la bande n'a jamais eu le temps de s'afficher), ce qui rend le test
  // instable en v3-desktop (revue tache 11, constat 1).
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });
  const avant = (await fetchLog(page)).length;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(500);
  expect((await fetchLog(page)).length).toBe(avant);
});

test('une action refusee par le proxy est signalee et mise de cote', async ({ page, context }) => {
  await bootV3(page, [
    { match: 'action=v3.myDay', status: 200, body: JOURNEE },
    { match: 'action=v3.startJob', status: 200, body: { status: 'success', jobId: '2026-09-12_Marc Lefevre', startedAt: '2026-09-12T08:00:00Z' } },
    { match: 'action=v3.tick', status: 400, body: { error: 'itemId required' } },
  ], { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Bathroom' }).click();
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();

  await context.setOffline(false);
  // La cleaner est prevenue, l'entree sort de la file et va dans le magasin mort.
  await expect(page.getByText('Not sent: itemId required. Tell your manager.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Saved on device', { exact: false })).toHaveCount(0, { timeout: 10_000 });
  const morts = await page.evaluate(async () => {
    const m = await import('/v3/offline.js');
    return await m.deadEntries();
  });
  expect(morts.length).toBe(1);
  expect(morts[0].action).toBe('v3.tick');
  expect(morts[0].reason).toBe('itemId required');
});

test('la file survit a un rechargement de page', async ({ page }) => {
  await bootV3(page, ROUTES, { pinToken: 'jeton-pin' });
  await page.getByRole('button', { name: 'Start this cleaning' }).click();
  // Drapeau plutot que context.setOffline : ce dernier couperait aussi le
  // chargement de la page et le reload echouerait avant d'atteindre le test.
  await page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
  await page.getByRole('button', { name: 'Bathroom' }).click();
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as any).__v3ready === true);
  await expect(page.getByText('Saved on device, 1 to sync')).toBeVisible();
});
