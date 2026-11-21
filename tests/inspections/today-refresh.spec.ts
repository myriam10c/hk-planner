import { test, expect, type Page } from '@playwright/test';
import { bootInsp, fetchDone, fetchLog } from './helpers';

// Today se relit seul : au retour au premier plan quand la liste a plus de 60 s ou n'est pas
// du jour de Dubai, et au changement de jour de Dubai ecran ouvert. Un Retry sur l'erreur.
const ME = { status: 200, match: 'action=cleanerMe', body: { status: 'success', cleaner: { id: 3, name: 'Faiza', color: '#abc', role: 'cleaner' } } };
const MGR = { status: 200, match: 'action=cleanerMe', body: { status: 'success', cleaner: { id: 1, name: 'Hillal', color: '#abc', role: 'manager' } } };
const card = (o: any) => ({ listingId: 'A', name: 'Apt 101 · Tower A', eligibility: { kind: 'checkout', checkOutTime: 12, nextCheckIn: null },
  daysSince: null, lastInspector: null, missed: 0, openIssue: false, claimedBy: null, claimedByName: null, inProgressBy: null, inProgressById: null, doneToday: null, ...o });
// Liste du mardi 6 octobre (jour de Dubai), puis celle du mercredi 7.
const DAY6 = (o: any = {}) => ({ day: '2026-10-06', target: 4, cachedAt: null, today: [card({})], also: [], ...o });
const DAY7 = () => ({ day: '2026-10-07', target: 4, cachedAt: null, today: [card({ listingId: 'N', name: 'Apt 707 · Tower N' })], also: [] });
const TODAY = (body: any, extra: any = {}) => ({ status: 200, match: 'action=insp.today', body, ...extra });
const DOWN = { status: 503, match: 'action=insp.today', body: { error: 'Bookings are unavailable right now. Try again in a few minutes.' } };
const CLAIM = { status: 200, match: 'action=insp.claim', body: { proposal: { listingId: 'A', claimedBy: 3, claimedByName: 'Faiza' } } };
const OVERVIEW = { status: 200, match: 'action=insp.overview', body: { coveragePct: 50, inspectedThisMonth: 3, rows: [
  { listingId: 'X1', name: 'Apt 900 · Tower X', excluded: false }] } };
const CLEANERS = { status: 200, match: 'action=getCleaners', body: { status: 'success', cleaners: [{ id: 3, name: 'Faiza', role: 'cleaner', is_active: true }] } };

const T0 = new Date('2026-10-06T06:00:00Z'); // mardi 6, 10:00 a Dubai
const BEFORE_MIDNIGHT = new Date('2026-10-06T19:59:00Z'); // mardi 6, 23:59 a Dubai
const LATE = new Date('2026-10-06T19:59:40Z'); // mardi 6, 23:59:40 (liste de moins de 60 s a minuit)
const AFTER_MIDNIGHT = new Date('2026-10-06T20:00:05Z'); // mercredi 7, 00:00:05

const calls = async (page: Page, action: string) => (await fetchLog(page)).filter((l) => l.url.includes('action=' + action)).length;
const todayDone = async (page: Page) => (await fetchDone(page)).filter((u) => u.includes('action=insp.today')).length;
const backToTab = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
const dateLine = (page: Page) => page.locator('header.top .mute');

test('Today : erreur de chargement, Retry recharge (Loading…), double appui = une requete', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await bootInsp(page, [ME, { ...DOWN, once: true }, TODAY(DAY6(), { delay: 800 })], { pinToken: 'tok' });
  await expect(page.getByText('Bookings are unavailable right now.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).dblclick();
  await expect(page.getByText('Loading…')).toBeVisible();
  await expect(page.getByText('Apt 101 · Tower A')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  expect(await calls(page, 'insp.today')).toBe(2);
  expect(await calls(page, 'insp.overview')).toBe(0);
});

test('Today : refus 403, pas de Retry, lien retour vers HK Planner', async ({ page }) => {
  await bootInsp(page, [ME, { status: 403, match: 'action=insp.today', body: { error: 'forbidden' } }], { pinToken: 'tok' });
  await expect(page.getByText('forbidden')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Back to HK Planner' })).toBeVisible();
});

test('retour au premier plan : Today relu seulement au-dela de 60 s', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), TODAY(DAY6({ target: 5 }))], { pinToken: 'tok' });
  await expect(page.getByText('Target today: 4')).toBeVisible();
  await page.clock.setFixedTime(new Date(T0.getTime() + 30_000));
  await backToTab(page);
  await frame(page);
  expect(await calls(page, 'insp.today')).toBe(1);
  await page.clock.setFixedTime(new Date(T0.getTime() + 61_000));
  await backToTab(page);
  await expect(page.getByText('Target today: 5')).toBeVisible();
  expect(await calls(page, 'insp.today')).toBe(2);
});

test('relecture de fond en echec sur la liste du jour : liste gardee telle quelle', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), DOWN], { pinToken: 'tok' });
  await expect(page.getByRole('button', { name: "I'll take it" })).toBeVisible();
  await page.clock.setFixedTime(new Date(T0.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayDone(page)).toBe(2);
  await frame(page);
  await expect(page.getByText('Apt 101 · Tower A')).toBeVisible();
  await expect(page.getByRole('button', { name: "I'll take it" })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
});

test('relecture lente puis prise en charge : la reponse en retard n efface pas la prise', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), TODAY(DAY6({ target: 5 }), { delay: 2000 }), CLAIM], { pinToken: 'tok' });
  await expect(page.getByRole('button', { name: "I'll take it" })).toBeVisible();
  await page.clock.setFixedTime(new Date(T0.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => calls(page, 'insp.today')).toBe(2);
  await page.getByRole('button', { name: "I'll take it" }).click();
  await expect(page.getByRole('button', { name: 'Start inspection' })).toBeVisible();
  await expect.poll(() => todayDone(page)).toBe(2);
  await frame(page);
  await expect(page.getByRole('button', { name: 'Start inspection' })).toBeVisible();
  await expect(page.getByRole('button', { name: "I'll take it" })).toHaveCount(0);
});

// Une relecture ne sort pas l'utilisateur de l'ecran ou il est, et ne touche pas a sa saisie.
test('relecture pendant "Inspect another apartment" : ecran de recherche garde, texte et focus aussi', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), TODAY(DAY6({ target: 5 })), OVERVIEW], { pinToken: 'tok' });
  await expect(page.getByText('Target today: 4')).toBeVisible();
  await page.getByRole('button', { name: 'Inspect another apartment' }).click();
  await page.locator('#pq').pressSequentially('Apt 9');
  await expect(page.locator('#pq')).toHaveValue('Apt 9');
  await page.clock.setFixedTime(new Date(T0.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayDone(page)).toBe(2);
  await frame(page);
  await expect(page.getByRole('heading', { name: 'Inspect another apartment' })).toBeVisible();
  await expect(page.locator('#pq')).toHaveValue('Apt 9');
  await expect(page.locator('#pq')).toBeFocused();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByText('Target today: 5')).toBeVisible();
});

test('relecture pendant "Assign to" : l ecran de choix reste ouvert', async ({ page }) => {
  await page.clock.setFixedTime(T0);
  await bootInsp(page, [MGR, TODAY(DAY6(), { once: true }), TODAY(DAY6({ target: 5 })), CLEANERS], { pinToken: 'tok' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByRole('heading', { name: 'Assign to' })).toBeVisible();
  await page.clock.setFixedTime(new Date(T0.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayDone(page)).toBe(2);
  await frame(page);
  await expect(page.getByRole('heading', { name: 'Assign to' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Faiza' })).toBeVisible();
});

// Navigateur a New York : le jour de Today est celui de Dubai, jamais celui du navigateur.
test.describe('minuit a Dubai', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('passage de minuit, ecran ouvert : liste du nouveau jour', async ({ page }) => {
    await page.clock.install({ time: BEFORE_MIDNIGHT });
    await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), TODAY(DAY7())], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    await page.clock.runFor(90_000);
    await expect.poll(() => calls(page, 'insp.today')).toBe(2);
    await expect(dateLine(page)).toContainText('7 October');
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    await expect(page.getByText('Apt 101 · Tower A')).toHaveCount(0);
  });

  test('retour au premier plan apres minuit, relecture en echec : erreur et Retry, la veille n est plus affichee', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), { ...DOWN, once: true }, TODAY(DAY7())], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await backToTab(page);
    await expect(page.getByText('Bookings are unavailable right now.', { exact: false })).toBeVisible();
    await expect(page.getByText('Apt 101 · Tower A')).toHaveCount(0);
    await expect(dateLine(page)).not.toContainText('6 October');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    expect(await calls(page, 'insp.today')).toBe(3);
  });

  test('"I\'ll take it" sur la liste de la veille : aucune ecriture, Today relu', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), TODAY(DAY7()), CLAIM], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    // Minuit passe, avant la verification des 30 s.
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await page.getByRole('button', { name: "I'll take it" }).click();
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    expect(await calls(page, 'insp.today')).toBe(2);
    expect(await calls(page, 'insp.claim')).toBe(0);
    await expect(page.getByRole('button', { name: 'Start inspection' })).toHaveCount(0);
  });

  test('"Start inspection" sur la liste de la veille : pas d inspection ouverte, Today relu', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [ME, TODAY(DAY6({ today: [card({ claimedBy: 3, claimedByName: 'Faiza' })] }), { once: true }), TODAY(DAY7())], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await page.getByRole('button', { name: 'Start inspection' }).click();
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    await expect(page).not.toHaveURL(/#\/inspect\//);
    expect(await calls(page, 'insp.today')).toBe(2);
  });

  test('"Release" sur la liste de la veille : aucune ecriture, Today relu', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [ME, TODAY(DAY6({ today: [card({ claimedBy: 3, claimedByName: 'Faiza' })] }), { once: true }), TODAY(DAY7()),
      { status: 200, match: 'action=insp.unclaim', body: { proposal: { listingId: 'A', claimedBy: null, claimedByName: null } } }], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await page.getByRole('button', { name: 'Release' }).click();
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    expect(await calls(page, 'insp.today')).toBe(2);
    expect(await calls(page, 'insp.unclaim')).toBe(0);
  });

  test('"Assign" sur la liste de la veille : pas d ecran de choix, Today relu', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [MGR, TODAY(DAY6(), { once: true }), TODAY(DAY7()), CLEANERS], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await page.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assign to' })).toHaveCount(0);
    expect(await calls(page, 'insp.today')).toBe(2);
    expect(await calls(page, 'getCleaners')).toBe(0);
  });

  // « Assign to » ouvert sur la liste du 6 : le logement choisi n'est jamais ecrit sur le 7,
  // meme une fois Today relu (la relecture laisse l'ecran de choix ouvert).
  const ASSIGN = { status: 200, match: 'action=insp.assign', body: { proposal: { listingId: 'A', claimedBy: 3, claimedByName: 'Faiza' } } };
  test('"Assign to" ouvert avant minuit, Today relu au retour au premier plan, puis un nom : aucune ecriture, liste du 7', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [MGR, TODAY(DAY6(), { once: true }), TODAY(DAY7()), CLEANERS, ASSIGN], { pinToken: 'tok' });
    await page.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByRole('heading', { name: 'Assign to' })).toBeVisible();
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await backToTab(page);
    await expect.poll(() => todayDone(page)).toBe(2);
    await frame(page);
    await expect(page.getByRole('heading', { name: 'Assign to' })).toBeVisible();
    await page.getByRole('button', { name: 'Faiza' }).click();
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Assign to' })).toHaveCount(0);
    expect(await calls(page, 'insp.assign')).toBe(0);
  });

  test('"Assign to" ouvert avant minuit, un nom puis un second appui : aucune ecriture, liste du 7', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [MGR, TODAY(DAY6(), { once: true }), TODAY(DAY7()), CLEANERS, ASSIGN], { pinToken: 'tok' });
    await page.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByRole('heading', { name: 'Assign to' })).toBeVisible();
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    const faiza = page.getByRole('button', { name: 'Faiza' });
    await faiza.click();
    await expect.poll(() => todayDone(page)).toBe(2);
    await frame(page);
    // Second appui sur le meme nom, s'il est encore a l'ecran.
    if (await faiza.count()) await faiza.click();
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    await frame(page);
    expect(await calls(page, 'insp.assign')).toBe(0);
  });

  test('une seule relecture a la fois : appui et retour au premier plan pendant une relecture lente', async ({ page }) => {
    await page.clock.setFixedTime(LATE);
    await bootInsp(page, [ME, TODAY(DAY6(), { once: true }), TODAY(DAY7(), { delay: 2000 }), CLAIM], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await backToTab(page);
    await expect.poll(() => calls(page, 'insp.today')).toBe(2);
    await page.getByRole('button', { name: "I'll take it" }).click();
    await backToTab(page);
    await frame(page);
    // Toujours pendant la relecture : aucune seconde lecture, aucune ecriture.
    expect(await todayDone(page)).toBe(1);
    expect(await calls(page, 'insp.today')).toBe(2);
    await expect.poll(() => todayDone(page)).toBe(2);
    await expect(page.getByText('Apt 707 · Tower N')).toBeVisible();
    expect(await calls(page, 'insp.today')).toBe(2);
    expect(await calls(page, 'insp.claim')).toBe(0);
  });

  test('ecran quitte : Today n est plus relu', async ({ page }) => {
    await page.clock.install({ time: BEFORE_MIDNIGHT });
    await bootInsp(page, [ME, TODAY(DAY6()), OVERVIEW], { pinToken: 'tok' });
    await expect(dateLine(page)).toContainText('6 October');
    await page.getByRole('button', { name: 'Fleet' }).click();
    await expect(page.getByRole('heading', { name: 'Fleet', exact: true })).toBeVisible();
    await page.clock.runFor(90_000);
    await backToTab(page);
    await page.clock.runFor(1000);
    await page.evaluate(() => Promise.resolve());
    expect(await calls(page, 'insp.today')).toBe(1);
  });
});
