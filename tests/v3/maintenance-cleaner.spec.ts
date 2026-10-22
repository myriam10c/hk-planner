import { expect, test } from '@playwright/test';
import { bootV3, fetchLog, noHorizontalScroll } from './helpers';
import { BLOOM, DAY, WRITE_ROUTES, carteAcces, demarrer, ecritures, fileVide, fileVideApresRetour, photo, piece } from './conv-helpers';

// Maintenance phase 3, app cleaner : (C4) a l'etape 2, chaque ticket ouvert du
// logement est une carte « Still there » / « Fixed now » ; (C8) la carte d'un
// probleme signale dit a qui il est parti ; (C12) Profile montre « My reports,
// last 7 days ».

const TICKETS = [
  { id: 301, title: 'AC · Bedroom', category: 'ac', priority: 'medium', status: 'assigned', assigneeName: 'Semax', reportedOn: '2026-10-10' },
  { id: 302, title: 'Leak · Bathroom', category: 'plumbing', priority: 'medium', status: 'waiting_parts', assigneeName: 'Semax', reportedOn: '2026-10-10' },
  { id: 303, title: 'Broken · Sofa', category: 'general', priority: 'low', status: 'open', assigneeName: null, reportedOn: '2026-10-10' },
  { id: 304, title: 'Stain · Carpet', category: 'general', priority: 'low', status: 'to_confirm', assigneeName: 'Semax', reportedOn: '2026-10-10' },
  { id: 305, title: 'Insects · Kitchen', category: 'pest', priority: 'medium', status: 'open', assigneeName: null, reportedOn: '2026-10-10' },
];
const BLOOM_T = { ...BLOOM, openTickets: TICKETS };
const DAY_T = { ...DAY, stops: [BLOOM_T, DAY.stops[1]] };
const routesAvec = (day: any, extra: any[] = []) => [
  { match: 'action=v3.myDay', status: 200, body: day },
  ...extra,
  { match: 'action=v3.ticketStill', status: 200, body: { ok: true } },
  { match: 'action=v3.checkTicket', status: 200, body: { status: 'success', ticketId: 301, status_value: 'to_confirm' } },
  ...WRITE_ROUTES.filter((r) => r.match !== 'action=v3.myDay'),
];

async function etape2(page: any) {
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await page.locator('[data-reply="here"]').click();
  await carteAcces(page);
  for (const r of ['Bed', 'Bathroom', 'Kitchen']) await piece(page, 1, r);
}

const carte = (page: any, titre: string) => page.locator('.tcard').filter({ has: page.locator('b', { hasText: titre }) });

test('C4 : une carte par ticket ouvert, statut lisible, pas de carte pour le pest, to_confirm sans bouton', async ({ page }) => {
  await demarrer(page, routesAvec(DAY_T));
  await etape2(page);
  await expect(page.getByText('Open problems here. Is it still there?')).toBeVisible();
  await expect(page.locator('.tcard')).toHaveCount(4);
  await expect(carte(page, 'AC · Bedroom').locator('.tsub')).toHaveText('Reported Sat 10 · Semax is on it');
  await expect(carte(page, 'Leak · Bathroom').locator('.tsub')).toHaveText('Reported Sat 10 · waiting parts');
  await expect(carte(page, 'Broken · Sofa').locator('.tsub')).toHaveText('Reported Sat 10 · nobody yet');
  await expect(carte(page, 'Stain · Carpet').locator('.tsub')).toHaveText('Waiting for check');
  await expect(carte(page, 'Stain · Carpet').locator('button')).toHaveCount(0);
  await expect(carte(page, 'AC · Bedroom').getByRole('button', { name: 'Still there' })).toBeVisible();
  await expect(carte(page, 'AC · Bedroom').getByRole('button', { name: 'Fixed now 📷' })).toBeVisible();
  // Le pest garde sa question, sans carte.
  await expect(page.locator('.tcard', { hasText: 'Insects' })).toHaveCount(0);
  await expect(page.getByText('Pest control was asked. Do you see insects?')).toBeVisible();
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
  expect(await page.content()).not.toContain('—');
});

// Revue finale (G4) : le pest to_confirm ne repose pas la question, mais garde une carte
// « Waiting for check » ; un second pest ouvert sur le logement a sa carte aussi.
test('C4 : un ticket pest deja to_confirm ne repose pas la question pest et garde sa carte', async ({ page }) => {
  const pestFait = { ...BLOOM, openTickets: [{ ...TICKETS[4], status: 'to_confirm' }] };
  await demarrer(page, routesAvec({ ...DAY, stops: [pestFait, DAY.stops[1]] }));
  await etape2(page);
  await expect(page.getByText('Walls: any marks, holes or damage?')).toBeVisible();
  await expect(page.getByText('Pest control was asked. Do you see insects?')).toHaveCount(0);
  await expect(page.locator('.tcard')).toHaveCount(1);
  await expect(carte(page, 'Insects · Kitchen').locator('.tsub')).toHaveText('Waiting for check');
  await expect(carte(page, 'Insects · Kitchen').locator('button')).toHaveCount(0);
});

test('C4 : un second ticket pest ouvert a sa carte, le premier garde la question', async ({ page }) => {
  const second = { id: 306, title: 'Ants · Bed', category: 'pest', priority: 'medium', status: 'open', assigneeName: null, reportedOn: '2026-10-10' };
  const deuxPests = { ...BLOOM, openTickets: [TICKETS[4], second] };
  await demarrer(page, routesAvec({ ...DAY, stops: [deuxPests, DAY.stops[1]] }));
  await etape2(page);
  await expect(page.getByText('Pest control was asked. Do you see insects?')).toBeVisible();
  await expect(page.locator('.tcard')).toHaveCount(1);
  await expect(carte(page, 'Ants · Bed').getByRole('button', { name: 'Still there' })).toBeVisible();
});

test('C4 : Still there apres la question des murs, une seule ecriture meme sur un second appui', async ({ page }) => {
  await demarrer(page, routesAvec(DAY_T));
  await etape2(page);
  await page.locator('[data-reply="check-ok"]').click();
  await page.locator('[data-reply="walls-ok"]').click();
  // La carte reste repondable apres la question suivante.
  await carte(page, 'AC · Bedroom').getByRole('button', { name: 'Still there' }).click();
  await expect(carte(page, 'AC · Bedroom').locator('.tdone')).toContainText('✓ Still there');
  await expect(carte(page, 'AC · Bedroom').locator('button')).toHaveCount(0);
  // Second appui (bouton force) : rien de plus.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-act', 'ticket-still'); b.setAttribute('data-ticket', '301');
    document.getElementById('thread')!.appendChild(b);
    b.click();
  });
  await fileVide(page);
  const still = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.ticketStill') !== -1);
  expect(still.length).toBe(1);
  expect(JSON.parse(still[0].body)).toMatchObject({ ticketId: 301, jobId: BLOOM.jobId });
  await expect(carte(page, 'AC · Bedroom').locator('.ticks')).toHaveText('✓✓');
});

// Coupure par le drapeau du faux fetch, comme offline.spec.ts : sous WebKit, context.setOffline()
// refuse aussi la lecture des Blob de la page, ce qu'un vrai iPhone en mode avion ne fait pas.
const couper = (page: any) => page.evaluate(() => localStorage.setItem('v3TestOffline', '1'));
const retablir = (page: any) => page.evaluate(() => { localStorage.removeItem('v3TestOffline'); window.dispatchEvent(new Event('online')); });

test('C4 : Fixed now hors ligne, photo puis checkTicket dans l ordre au retour du reseau', async ({ page }) => {
  await demarrer(page, routesAvec(DAY_T));
  await etape2(page);
  await fileVide(page);
  await couper(page);
  await carte(page, 'AC · Bedroom').getByRole('button', { name: 'Fixed now 📷' }).click();
  await expect(page.locator('.vf-title b')).toHaveText('AC · Bedroom · fixed');
  await expect(page.locator('.vf-title span')).toHaveText('Take a photo of it');
  await expect(page.locator('[data-act="fix-done"]')).toBeDisabled();
  await photo(page, 'fix-shutter');
  await page.locator('[data-act="fix-done"]').click();
  await expect(carte(page, 'AC · Bedroom').locator('.tdone')).toContainText('✓ Fixed, photo sent');
  await expect(carte(page, 'AC · Bedroom').locator('.ticks')).toHaveText('✓');
  await retablir(page);
  // La file peut etre vide un instant entre le televersement et checkTicket (mis en file juste
  // apres) : on attend que checkTicket soit parti, puis la file vide.
  await expect.poll(async () => (await ecritures(page)).some((x) => x.action === 'v3.checkTicket'), { timeout: 30_000 }).toBe(true);
  await fileVideApresRetour(page);
  const e = (await ecritures(page)).filter((x) => /uploadPhoto|checkTicket/.test(x.action) && (x.body.ticketId || x.action === 'v3.checkTicket'));
  expect(e.map((x) => x.action)).toEqual(['v3.uploadPhoto', 'v3.checkTicket']);
  expect(e[0].body).toMatchObject({ ticketId: '301', jobId: BLOOM.jobId });
  expect(e[1].body).toMatchObject({ ticketId: 301, jobId: BLOOM.jobId, photoIdem: e[0].body.idem });
  const checks = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.checkTicket') !== -1 && l.body);
  expect(new Set(checks.map((l) => JSON.parse(l.body).idem)).size).toBe(1);
  await expect(carte(page, 'AC · Bedroom').locator('.ticks')).toHaveText('✓✓');
});

// Revue finale (G10) : checkTicket refuse « ticket is already closed » (un technicien l'a clos
// entre-temps) : la carte passe a ✓✓ et rien ne va dans « Not sent ».
test('C4 : Fixed now sur un ticket clos entre-temps, ✓✓ et magasin mort vide', async ({ page }) => {
  await demarrer(page, routesAvec(DAY_T, [
    { match: 'action=v3.checkTicket', status: 400, body: { error: 'ticket is already closed' } },
  ]));
  await etape2(page);
  await carte(page, 'AC · Bedroom').getByRole('button', { name: 'Fixed now 📷' }).click();
  await photo(page, 'fix-shutter');
  await page.locator('[data-act="fix-done"]').click();
  await fileVide(page);
  await expect(carte(page, 'AC · Bedroom').locator('.ticks')).toHaveText('✓✓');
  const checks = (await fetchLog(page)).filter((l) => l.url.indexOf('action=v3.checkTicket') !== -1);
  expect(checks.length).toBeGreaterThanOrEqual(1);
  const morts = await page.evaluate(async () => (await (await import('/v3/offline.js')).deadEntries()).length);
  expect(morts).toBe(0);
  await expect(page.getByText('Not sent:', { exact: false })).toHaveCount(0);
});

async function signalerFuite(page: any, photos = 1) {
  await page.locator('[data-reply="check-ok"]').click();
  await page.locator('[data-reply="walls-ok"]').click();
  await page.locator('[data-reply="some-damage"]').click();
  await page.locator('[data-kind="Leak"]').click();
  for (let i = 0; i < photos; i++) await photo(page, 'flow-shutter');
  await page.locator('[data-flow="photos-done"]').click();
  await page.locator('[data-flow="no-note"]').click();
}

test('C8 : la carte du probleme dit a qui il est parti', async ({ page }) => {
  await demarrer(page, routesAvec(DAY_T, [
    { match: 'action=v3.reportProblem', status: 200, body: { status: 'success', ticketId: 812, priority: 'medium', sentTo: 'Semax' } },
  ]));
  await etape2(page);
  await signalerFuite(page, 2);
  await expect(page.locator('.msg.problem span:not(.ticks)').last()).toHaveText('Whole apartment · sent to Semax · 2 photos');
  expect(await page.content()).not.toContain('team notified');
});

test('C8 : sans technicien de permanence, « sent to the team » ; hors ligne, « saved, sending… »', async ({ page }) => {
  await demarrer(page, routesAvec(DAY_T, [
    { match: 'action=v3.reportProblem', status: 200, body: { status: 'success', ticketId: 812, priority: 'medium', sentTo: null } },
  ]));
  await etape2(page);
  await fileVide(page);
  await couper(page);
  await signalerFuite(page);
  await expect(page.locator('.msg.problem span:not(.ticks)').last()).toHaveText('Whole apartment · saved, sending…');
  await retablir(page);
  await fileVideApresRetour(page);
  await expect(page.locator('.msg.problem span:not(.ticks)').last()).toHaveText('Whole apartment · sent to the team');
});

const REPORTS = [
  { id: 9, title: 'AC · Bedroom', place: 'Bedroom', listingLabel: '1011C - Bloom Towers', reportedOn: DAY.date, status: 'with_tech', techName: 'Semax' },
  { id: 8, title: 'Leak · Bathroom', place: 'Bathroom', listingLabel: '704 Golf Links', reportedOn: '2026-10-10', status: 'with_tech', techName: null },
  { id: 7, title: 'Broken · Sofa', place: 'Sofa', listingLabel: '704 Golf Links', reportedOn: '2026-10-10', status: 'open', techName: null },
  { id: 6, title: 'Power · Kitchen', place: 'Kitchen', listingLabel: '704 Golf Links', reportedOn: '2026-10-10', status: 'in_progress', techName: 'Semax' },
  { id: 5, title: 'Leak · Kitchen', place: 'Kitchen', listingLabel: '704 Golf Links', reportedOn: '2026-10-10', status: 'waiting_parts', techName: 'Semax' },
  { id: 4, title: 'Stain · Carpet', place: 'Carpet', listingLabel: '704 Golf Links', reportedOn: '2026-10-10', status: 'to_confirm', techName: 'Semax' },
  { id: 3, title: 'Missing · Towel', place: 'Towel', listingLabel: '704 Golf Links', reportedOn: '2026-10-10', status: 'fixed', techName: 'Semax' },
];

test('C12 : Profile, My reports, last 7 days', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myReports', status: 200, body: { reports: REPORTS } },
    { match: 'action=v3.myDay', status: 200, body: DAY },
  ], { pinToken: 'jeton-pin', hash: '#/profile' });
  await expect(page.getByText('My reports, last 7 days')).toBeVisible();
  const rows = page.locator('.myrep .mr-row');
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toContainText('AC · Bedroom');
  await expect(rows.nth(0).locator('.mr-sub')).toHaveText('1011C - Bloom Towers · today');
  await expect(rows.nth(1).locator('.mr-sub')).toHaveText('704 Golf Links · Sat 10');
  await expect(rows.locator('.mr-st')).toHaveText([
    'With Semax', 'With the team', 'Not assigned yet', 'In progress', 'Waiting parts', 'Checked, waiting', 'Fixed',
  ]);
  const { scrollWidth, clientWidth } = await noHorizontalScroll(page);
  expect(scrollWidth).toBe(clientWidth);
});

test('C12 : aucun signalement, « No report this week. »', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myReports', status: 200, body: { reports: [] } },
    { match: 'action=v3.myDay', status: 200, body: DAY },
  ], { pinToken: 'jeton-pin', hash: '#/profile' });
  await expect(page.getByText('No report this week.')).toBeVisible();
});

test('C12 : hors ligne, « Reports load when you are online. »', async ({ page, context }) => {
  await bootV3(page, [
    { match: 'action=v3.myReports', status: 200, body: { reports: REPORTS } },
    { match: 'action=v3.myDay', status: 200, body: DAY },
  ], { pinToken: 'jeton-pin' });
  await expect(page.locator('.row').first()).toBeVisible();
  await context.setOffline(true);
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByText('Reports load when you are online.')).toBeVisible();
});

// Revue finale (G3) : « Not sent » ne depend pas de v3.myReports ; « My reports » dit
// « Loading… » jusqu'a la reponse.
test('C12 : Not sent s affiche tout de suite, My reports dit Loading… jusqu a la reponse', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myReports', status: 200, body: { reports: REPORTS }, delay: 4000 },
    { match: 'action=v3.myDay', status: 200, body: DAY },
    { match: 'action=v3.reportProblem', status: 400, body: { error: 'unknown kind' } },
  ], { pinToken: 'jeton-pin' });
  await expect(page.locator('.row').first()).toBeVisible();
  await page.evaluate(async () => {
    localStorage.setItem('v3TestOffline', '1');
    const m = await import('/v3/offline.js');
    await m.sendOrQueue('v3.reportProblem', { jobId: 'job_x', kind: 'Leak', idem: m.newIdem() });
    localStorage.removeItem('v3TestOffline');
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(async () => page.evaluate(async () => (await (await import('/v3/offline.js')).deadEntries()).length)).toBe(1);
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByText('Not sent', { exact: true })).toBeVisible({ timeout: 1500 });
  await expect(page.locator('.myrep .mr-empty')).toHaveText('Loading…');
  await expect(page.locator('.myrep .mr-row')).toHaveCount(7, { timeout: 8000 });
  await expect(page.getByText('Not sent', { exact: true })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
});

// Revue finale (G8) : une panne du proxy n'est pas une coupure reseau.
test('C12 : erreur du proxy, « Reports are unavailable right now. »', async ({ page }) => {
  await bootV3(page, [
    { match: 'action=v3.myReports', status: 500, body: { error: 'boom' } },
    { match: 'action=v3.myDay', status: 200, body: DAY },
  ], { pinToken: 'jeton-pin', hash: '#/profile' });
  await expect(page.getByText('Reports are unavailable right now.')).toBeVisible();
  await expect(page.getByText('Reports load when you are online.')).toHaveCount(0);
});

// ---- View as et Practice ----
const TEAM = [{ id: 3, name: 'Faiza', role: 'cleaner' }];
const JOUR_MANAGER = {
  status: 'success', date: DAY.date, me: { id: 1, name: 'Hillal', role: 'manager' },
  linenRequired: true, totalMinutes: 0, stops: [], team: TEAM,
};
const JOUR_FAIZA = {
  ...DAY, me: { id: 3, name: 'Faiza', role: 'cleaner' }, stops: [BLOOM_T],
  viewAs: true, viewer: { id: 1, name: 'Hillal' }, team: TEAM,
};
const ROUTES_MANAGER = [
  { match: 'action=v3.myDay&as=3', status: 200, body: JOUR_FAIZA },
  { match: 'action=v3.myDay', status: 200, body: JOUR_MANAGER },
  { match: 'action=cleanerLogout', status: 200, body: { status: 'success' } },
  { match: 'action=', status: 403, body: { error: 'forbidden' } },
];

async function sansCamera(page: any) {
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
    }
  });
}

const appelsInterdits = async (page: any) => (await fetchLog(page)).filter((l) =>
  l.url.indexOf('hostaway-proxy') !== -1 && l.url.indexOf('action=v3.myDay') === -1);

test('View as : les tickets ouverts se lisent, aucun bouton de carte', async ({ page }) => {
  await bootV3(page, ROUTES_MANAGER, { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: "View Faiza's day" }).click();
  await expect(page.locator('.row-name').first()).toHaveText('1011C Bloom Towers');
  await page.getByRole('button', { name: /1011C Bloom Towers/ }).click();
  await expect(page.getByText('Read only. Only Faiza can answer here.')).toBeVisible();
  await expect(page.locator('[data-act="ticket-still"], [data-act="ticket-fixed"]')).toHaveCount(0);
  // Profile en View as : pas de section My reports, aucune lecture au serveur.
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByText('Try the cleaner app')).toBeVisible();
  await expect(page.getByText('My reports, last 7 days')).toHaveCount(0);
  expect(await appelsInterdits(page)).toEqual([]);
});

test('Practice : Still there, Fixed now, signalement et My reports sont simules, rien ne part au serveur', async ({ page }) => {
  await sansCamera(page);
  await bootV3(page, ROUTES_MANAGER, { pinToken: 'jeton-manager', hash: '#/profile' });
  await page.getByRole('button', { name: 'Practice as Faiza' }).click();
  await expect(page.locator('.row-name').first()).toHaveText('1011C Bloom Towers');
  await etape2(page);
  await carte(page, 'Leak · Bathroom').getByRole('button', { name: 'Still there' }).click();
  await expect(carte(page, 'Leak · Bathroom').locator('.ticks')).toHaveText('✓✓');
  await carte(page, 'AC · Bedroom').getByRole('button', { name: 'Fixed now 📷' }).click();
  await photo(page, 'fix-shutter');
  await page.locator('[data-act="fix-done"]').click();
  await expect(carte(page, 'AC · Bedroom').locator('.ticks')).toHaveText('✓✓');
  await signalerFuite(page);
  await expect(page.locator('.msg.problem span:not(.ticks)').last()).toHaveText('Whole apartment · sent to the team');
  await page.evaluate(() => { location.hash = '#/profile'; });
  await expect(page.getByText('My reports, last 7 days')).toBeVisible();
  await expect(page.locator('.myrep .mr-row')).toHaveCount(1);
  await expect(page.locator('.myrep .mr-row')).toContainText('Leak · Whole apartment');
  await expect(page.locator('.myrep .mr-st')).toHaveText('Not assigned yet');
  expect(await appelsInterdits(page)).toEqual([]);
  const file = await page.evaluate(async () => (await (await import('/v3/offline.js')).pendingEntries()).length);
  expect(file).toBe(0);
});

