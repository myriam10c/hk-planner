import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchDone, fetchLog, MANAGER, me } from './helpers';
import { NOW, todayBody } from './fixtures';
import { noIdem, OK } from './planning-fixtures';

// Today se relit seul : au retour sur l'onglet et avant un geste quand les donnees ont plus
// de 60 s, et au changement de jour de Dubai. Une relecture ne ferme aucune fiche.
const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
// Today relu une minute plus tard : seule l'heure des donnees change (as of 11:01).
const LATER = () => todayBody({ generatedAt: '2026-10-09T07:01:01.000Z' });
// Vendredi 9 a 23:59 a Dubai, puis les donnees du samedi 10.
const BEFORE_MIDNIGHT = new Date('2026-10-09T19:59:00Z');
const FRIDAY = () => todayBody({ generatedAt: '2026-10-09T19:59:00.000Z' });
const SATURDAY = () => todayBody({ day: '2026-10-10', generatedAt: '2026-10-09T20:00:00.000Z' });
// Vendredi 9 a 23:59:40 a Dubai (donnees de moins de 60 s au passage de minuit), puis 00:00:05.
const LATE = new Date('2026-10-09T19:59:40Z');
const FRIDAY_LATE = () => todayBody({ generatedAt: '2026-10-09T19:59:40.000Z' });
const AFTER_MIDNIGHT = new Date('2026-10-09T20:00:05Z');

const todayCalls = async (page: Page) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length;
const writes = async (page: Page, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=' + action)).map((l) => JSON.parse(l.body));
// Suite des lectures de Today et des ecritures, dans l'ordre des appels.
const sequence = async (page: Page) => (await fetchLog(page))
  .filter((l) => /action=(mgr\.today|assignCleaner|setDone)/.test(l.url))
  .map((l) => (l.url.includes('mgr.today') ? 'today' : 'write'));
const backToTab = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
const chip = (page: Page, day: string) => page.locator('[data-wday="' + day + '"]');
const dateLine = (page: Page) => page.locator('#main .top .date');
// Corps d'une carte (fiche) et disque ou « Assign someone » (choix dans la carte), par logement.
const cardOpen = (page: Page, id: string) => page.locator('[data-td-open="' + id + '"]');
const assignBtn = (page: Page, id: string) => page.locator('[data-td-who="' + id + '"]');
// Choix ouvert dans la carte d'un logement, et la tuile d'une personne (un seul choix a la fois).
const cardOf = (page: Page, id: string) => page.locator('.td-card', { has: page.locator('[data-td-open="' + id + '"]') });
const choice = (page: Page) => page.locator('.td-pick');
const tile = (page: Page, pid: string) => page.locator('.td-pick [data-td-pick="' + pid + '"]');
const ANN = '2026-10-09_Ann Lee'; // Apt 308, arrivee bloquee et son menage sans personne
const CY = '2026-10-09_Cy Doe';   // Apt 103, arrivee a risque
const LU = '2026-10-09_Lu Mo';    // Apt 909, menage sans arrivee

test('retour sur l onglet : Today relu seulement au-dela de 60 s', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(LATER())], { email: true, clock: NOW });
  await expect(page.locator('.asof')).toContainText('as of 11:00');
  await page.clock.setFixedTime(new Date(NOW.getTime() + 30_000));
  await backToTab(page);
  await frame(page);
  expect(await todayCalls(page)).toBe(1);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayCalls(page)).toBe(2);
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  await expect(page.getByText('Reconnect to make changes.')).toHaveCount(0);
});

// Navigateur a New York : le jour de Today est celui de Dubai, jamais celui du navigateur.
// Le jour local ne change pas pendant ces tests : l'ecran des notifications, ecarte au jour
// local du demarrage (helpers.ts), reste ferme meme s'il s'affiche apres minuit a Dubai.
test.describe('minuit a Dubai', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('retour sur l onglet juste apres minuit (donnees de moins de 60 s) : Today relu, le samedi devient Today', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), { ...TODAY(FRIDAY_LATE()), once: true }, TODAY(SATURDAY())], { email: true, clock: LATE });
    await expect(dateLine(page)).toContainText('9 October · today');
    await page.clock.setFixedTime(new Date('2026-10-09T20:00:10Z'));
    await backToTab(page);
    await expect(dateLine(page)).toContainText('10 October · today');
    expect(await todayCalls(page)).toBe(2);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Saturday');
    await expect(page.locator('[data-wday]').first()).toHaveAttribute('data-wday', '2026-10-10');
    await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, '2026-10-09')).toHaveCount(0);
    await expect(assignBtn(page, ANN)).toBeVisible();
  });

  test('passage de minuit, ecran ouvert : Today relu tout seul, la veille n est plus jamais Today', async ({ page }) => {
    await page.clock.install({ time: BEFORE_MIDNIGHT });
    await bootMgr(page, [me(MANAGER), { ...TODAY(FRIDAY()), once: true }, TODAY(SATURDAY())], { email: true });
    await expect(dateLine(page)).toContainText('9 October · today');
    await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(90_000);
    await expect.poll(() => todayCalls(page)).toBe(2);
    await expect(dateLine(page)).toContainText('10 October · today');
    await expect(page.locator('[data-wday]').first()).toHaveAttribute('data-wday', '2026-10-10');
    await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(page, '2026-10-09')).toHaveCount(0);
    // Les gestes du jour sont ouverts : aucune lecture seule apres une relecture reussie.
    await assignBtn(page, ANN).click();
    await expect(cardOf(page, ANN).locator('[data-td-pick="10"]')).toBeVisible();
    await expect(page.getByText('Reconnect to make changes.')).toHaveCount(0);
  });

  test('passage de minuit, relecture en echec : donnees de la veille signalees, Reconnect, un seul essai', async ({ page }) => {
    await page.clock.install({ time: BEFORE_MIDNIGHT });
    await bootMgr(page, [me(MANAGER), { ...TODAY(FRIDAY()), once: true },
      { match: 'action=mgr.today', status: 503, body: { error: 'Bookings are unavailable right now. Try again in a few minutes.' } }], { email: true });
    await expect(dateLine(page)).toContainText('9 October');
    await page.clock.runFor(90_000);
    await expect.poll(() => todayCalls(page)).toBe(2);
    await expect(page.locator('.banner.warn')).toContainText('Bookings are unavailable right now.');
    await expect(page.locator('.banner.warn')).toContainText('Not today\'s data.');
    await expect(page.locator('[data-assign]')).toHaveCount(0);
    await expect(page.locator('[data-td-who]')).toHaveCount(0);
    // La veille n'est plus jamais appelee « today ».
    await expect(dateLine(page)).toContainText('9 October · as of');
    await expect(dateLine(page)).not.toContainText('today');
    await expect(page.locator('.td-sum')).toHaveText(
      '4 guests arrive on Friday. 1 apartment is ready, 2 are at risk, 1 is blocked. 3 cleanings, 1 with no cleaner, 1 expected with Elite.');
    // Relecture du jour deja tentee : la fiche s'ouvre, en lecture seule, avec la ligne.
    await cardOpen(page, ANN).click();
    await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#sheet #sheetTitle')).toHaveText(/Apt 308/);
    await expect(page.locator('#sheet').getByText('Reconnect to make changes.')).toBeVisible();
    // Pas de nouvel essai a chaque verification : le bouton Retry reste la.
    await page.clock.runFor(120_000);
    await page.evaluate(() => Promise.resolve());
    expect(await todayCalls(page)).toBe(2);
    await expect(page.locator('.banner.warn').getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('appui sur un menage de la veille juste apres minuit : Today relu, aucune fiche, le samedi affiche', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), { ...TODAY(FRIDAY_LATE()), once: true }, TODAY(SATURDAY())], { email: true, clock: LATE });
    await expect(dateLine(page)).toContainText('9 October');
    // Minuit passe, avant la verification des 30 s (minuteries en temps reel, a peine lancees).
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await cardOpen(page, ANN).click();
    await expect(dateLine(page)).toContainText('10 October · today');
    expect(await todayCalls(page)).toBe(2);
    await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
    await frame(page);
    await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.getByText('Reconnect to make changes.')).toHaveCount(0);
  });

  test('appui sur un menage de la veille pendant une relecture lente : ignore, une seule relecture', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), { ...TODAY(FRIDAY_LATE()), once: true }, { ...TODAY(SATURDAY()), delay: 2000 }],
      { email: true, clock: LATE });
    await expect(dateLine(page)).toContainText('9 October');
    await page.clock.setFixedTime(AFTER_MIDNIGHT);
    await backToTab(page);
    await expect.poll(() => todayCalls(page)).toBe(2);
    await cardOpen(page, ANN).click();
    await frame(page);
    // Toujours pendant la relecture : aucune fiche, aucune seconde relecture.
    expect((await fetchDone(page)).filter((u) => u.includes('action=mgr.today')).length).toBe(1);
    await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
    expect(await todayCalls(page)).toBe(2);
    await expect.poll(async () => (await fetchDone(page)).filter((u) => u.includes('action=mgr.today')).length).toBe(2);
    await expect(dateLine(page)).toContainText('10 October');
    await frame(page);
    expect(await todayCalls(page)).toBe(2);
    await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  });

  test('ecran quitte avant minuit : Today n est plus relu', async ({ page }) => {
    await page.clock.install({ time: BEFORE_MIDNIGHT });
    await bootMgr(page, [me(MANAGER), TODAY(FRIDAY())], { email: true });
    await expect(dateLine(page)).toContainText('9 October');
    await page.evaluate(() => { location.hash = '#/more'; });
    await expect(page.locator('main a.more-row').first()).toBeVisible();
    await page.clock.runFor(90_000);
    await page.evaluate(() => Promise.resolve());
    expect(await todayCalls(page)).toBe(1);
  });
});

test('geste apres plus de 60 s : Today relu avant l ecriture, Undo vers la liste relue', async ({ page }) => {
  // Entre-temps, quelqu'un a mis Elite Cleaning sur Apt 308.
  const later = LATER();
  later.who.jobs[0] = { ...later.who.jobs[0], assigned: [12], serviceType: 'CHC' };
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=assignCleaner', status: 200, body: OK }, TODAY(later)],
    { email: true, clock: NOW });
  await assignBtn(page, ANN).click();
  await expect(tile(page, '10')).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await tile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Apt 308 · Binghatti Lavender assigned to Pionah');
  expect((await sequence(page)).slice(0, 3)).toEqual(['today', 'today', 'write']);
  // Relecture d'apres l'ecriture rendue, puis Undo plus d'une minute apres : relu d'abord.
  await expect.poll(async () => (await fetchDone(page)).filter((u) => u.includes('action=mgr.today')).length).toBe(3);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 122_000));
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  expect((await sequence(page)).slice(0, 6)).toEqual(['today', 'today', 'write', 'today', 'today', 'write']);
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: '2026-10-09_Ann Lee', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-09_Ann Lee', cleaner_ids: [12], mode: 'set', service_type: 'CHC' },
  ]);
});

test('geste apres plus de 60 s, relecture en echec : Reconnect, aucune ecriture, fiche et donnees gardees', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=mgr.today', status: 0, body: {}, fail: true },
    { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await cardOpen(page, CY).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('button', { name: 'Mark done' })).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await sheet.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  expect(await todayCalls(page)).toBe(2);
  expect(await writes(page, 'setDone')).toHaveLength(0);
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('.banner.warn')).toContainText('No connection. Try again.');
  await expect(page.locator('.td-blocked')).toContainText('Apt 308');
});

test('geste apres plus de 60 s, choix ferme pendant la relecture : aucune ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { ...TODAY(LATER()), delay: 1000 },
    { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  await assignBtn(page, ANN).click();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await tile(page, '10').click();
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(choice(page)).toHaveCount(0);
  await expect.poll(async () => (await fetchDone(page)).filter((u) => u.includes('action=mgr.today')).length).toBe(2);
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  await frame(page);
  expect(await writes(page, 'assignCleaner')).toHaveLength(0);
  await expect(choice(page)).toHaveCount(0);
});

// Toute fiche de Today reste ouverte pendant et apres une relecture, avec ce qui y est saisi.
const SHEETS = [
  { name: 'menage', title: /Apt 909/, open: (page: Page) => cardOpen(page, LU).click() },
  { name: 'arrivee', title: /Apt 103/, open: (page: Page) => cardOpen(page, CY).click() },
];
for (const s of SHEETS) {
  test('relecture avec une fiche ouverte (' + s.name + ') : la fiche reste ouverte, la saisie aussi', async ({ page }) => {
    await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(LATER())], { email: true, clock: NOW });
    await s.open(page);
    const sheet = page.locator('#sheet');
    await expect(sheet).toHaveAttribute('aria-hidden', 'false');
    await expect(sheet.locator('#sheetTitle')).toHaveText(s.title);
    // Champ pose dans la fiche : une saisie en cours, curseur dedans.
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.id = 'probe';
      i.setAttribute('aria-label', 'Probe');
      document.querySelector('#sheet .sheet-b')!.appendChild(i);
    });
    await page.locator('#probe').fill('half typed');
    await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
    await backToTab(page);
    await expect(page.locator('.asof')).toContainText('as of 11:01');
    expect(await todayCalls(page)).toBe(2);
    await expect(sheet).toHaveAttribute('aria-hidden', 'false');
    await expect(sheet.locator('#sheetTitle')).toHaveText(s.title);
    await expect(page.locator('#probe')).toHaveValue('half typed');
    await expect(page.locator('#probe')).toBeFocused();
  });
}

// Le choix d'une personne (dans la carte depuis la tache 4) reste ouvert pendant et apres une
// relecture, le focus sur la meme tuile.
test('relecture avec le choix ouvert dans la carte : le choix reste ouvert, le focus aussi', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(LATER())], { email: true, clock: NOW });
  await assignBtn(page, ANN).click();
  await expect(tile(page, '10')).toBeVisible();
  await tile(page, '10').focus();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await backToTab(page);
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  expect(await todayCalls(page)).toBe(2);
  await expect(cardOf(page, ANN).locator('.td-pick')).toBeVisible();
  await expect(tile(page, '10')).toBeFocused();
  expect(await writes(page, 'assignCleaner')).toHaveLength(0);
});

// Gestes de la nouvelle structure (lot 4a) : la carte ouvre une fiche, le disque mene a une
// ecriture ; tous deux relisent d'abord un tableau de plus de 60 s.
test('carte touchee apres plus de 60 s : Today relu d abord, puis la fiche sur le tableau relu', async ({ page }) => {
  const later = LATER();
  later.arrivals.rows[1] = { ...later.arrivals.rows[1], cause: 'In progress, Faiza. Guest in 4 h.' };
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(later)], { email: true, clock: NOW });
  await expect(cardOpen(page, CY)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await cardOpen(page, CY).click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.locator('#sheetTitle')).toHaveText('Apt 103 · Damac Reva');
  await expect(sheet).toContainText('In progress, Faiza. Guest in 4 h.');
  expect(await todayCalls(page)).toBe(2);
  await expect(page.locator('.asof')).toContainText('as of 11:01');
});

test('carte touchee apres plus de 60 s, relecture en echec : fiche en lecture seule, aucune ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=mgr.today', status: 0, body: {}, fail: true }],
    { email: true, clock: NOW });
  await expect(cardOpen(page, CY)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await cardOpen(page, CY).click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.getByText('Reconnect to make changes.')).toBeVisible();
  await expect(sheet.locator('[data-assign], [data-done]')).toHaveCount(0);
  await expect(page.locator('.banner.warn')).toContainText('No connection. Try again.');
  expect(await todayCalls(page)).toBe(2);
});

// Carte touchee pendant une relecture deja en cours (retour sur l onglet, Today lent) : la
// fiche attend la fin de cette relecture, puis s'ouvre sur le tableau relu, sans autre appel.
test('carte touchee pendant une relecture en cours : la fiche s ouvre apres, sur le tableau relu', async ({ page }) => {
  const later = LATER();
  later.arrivals.rows[1] = { ...later.arrivals.rows[1], cause: 'In progress, Faiza. Guest in 4 h.' };
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { ...TODAY(later), delay: 2000 }], { email: true, clock: NOW });
  await expect(cardOpen(page, CY)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayCalls(page)).toBe(2);
  await cardOpen(page, CY).click();
  await frame(page);
  // Relecture encore en cours : pas encore de fiche, aucune seconde relecture.
  expect((await fetchDone(page)).filter((u) => u.includes('action=mgr.today')).length).toBe(1);
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.locator('#sheetTitle')).toHaveText('Apt 103 · Damac Reva');
  await expect(sheet).toContainText('In progress, Faiza. Guest in 4 h.');
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  expect(await todayCalls(page)).toBe(2);
});

test('carte touchee pendant une relecture en cours qui echoue : fiche en lecture seule, un seul appel de plus', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=mgr.today', status: 0, body: {}, fail: true, delay: 2000 }],
    { email: true, clock: NOW });
  await expect(cardOpen(page, CY)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayCalls(page)).toBe(2);
  await cardOpen(page, CY).click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.locator('#sheetTitle')).toHaveText('Apt 103 · Damac Reva');
  await expect(sheet.getByText('Reconnect to make changes.')).toBeVisible();
  await expect(sheet.locator('[data-assign], [data-done]')).toHaveCount(0);
  expect(await todayCalls(page)).toBe(2);
});

// Carte touchee pendant une ecriture (choix envoye, puis ferme) : la fiche s'ouvre tout de
// suite sur le tableau affiche, sans relire ; la relecture suit l'ecriture et ne ferme pas la fiche.
test('carte touchee pendant une ecriture : fiche ouverte tout de suite, Today relu une fois apres l ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(LATER()),
    { match: 'action=assignCleaner', status: 200, body: OK, delay: 2000 }], { email: true, clock: NOW });
  await assignBtn(page, LU).click();
  const sheet = page.locator('#sheet');
  await expect(cardOf(page, LU).locator('.td-pick')).toBeVisible();
  await tile(page, '4').click();
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(choice(page)).toHaveCount(0);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await cardOpen(page, CY).click();
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.locator('#sheetTitle')).toHaveText('Apt 103 · Damac Reva');
  // Ecriture encore en cours : fiche ouverte sans relecture.
  expect((await fetchDone(page)).filter((u) => u.includes('action=assignCleaner')).length).toBe(0);
  expect(await todayCalls(page)).toBe(1);
  await expect(page.locator('#toast')).toContainText('assigned to Faiza');
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  expect(await todayCalls(page)).toBe(2);
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.locator('#sheetTitle')).toHaveText('Apt 103 · Damac Reva');
});

test('disque touche apres plus de 60 s : Today relu avant le choix dans la carte', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(LATER())], { email: true, clock: NOW });
  await expect(assignBtn(page, LU)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await assignBtn(page, LU).click();
  await expect(cardOf(page, LU).locator('.td-pick')).toBeVisible();
  expect(await todayCalls(page)).toBe(2);
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
});

// Disque ou « Assign someone » touche pendant une relecture deja en cours (retour sur l'onglet,
// Today lent) : le geste attend cette relecture au lieu d'en lancer une seconde.
test('disque touche pendant une relecture en cours : le choix attend la relecture, un seul appel de plus', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { ...TODAY(LATER()), delay: 2000 }], { email: true, clock: NOW });
  await expect(assignBtn(page, LU)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayCalls(page)).toBe(2);
  await assignBtn(page, LU).click();
  await frame(page);
  // Relecture encore en cours : pas encore de choix, aucune seconde relecture.
  expect((await fetchDone(page)).filter((u) => u.includes('action=mgr.today')).length).toBe(1);
  await expect(choice(page)).toHaveCount(0);
  await expect(cardOf(page, LU).locator('.td-pick')).toBeVisible();
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  expect(await todayCalls(page)).toBe(2);
});

test('Assign someone touche pendant une relecture en cours qui echoue : aucun choix, Reconnect, un seul appel de plus', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=mgr.today', status: 0, body: {}, fail: true, delay: 2000 }],
    { email: true, clock: NOW });
  await expect(assignBtn(page, ANN)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await backToTab(page);
  await expect.poll(() => todayCalls(page)).toBe(2);
  await page.locator('.td-blocked').getByRole('button', { name: 'Assign someone' }).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  await expect(page.locator('.banner.warn')).toContainText('No connection. Try again.');
  await expect(choice(page)).toHaveCount(0);
  await expect(page.locator('[data-td-who]')).toHaveCount(0);
  expect(await todayCalls(page)).toBe(2);
});

// Filtre et repli d'un moment : affichage seul (ni fiche ni ecriture), applique tout de suite ;
// tableau de plus de 60 s relu en arriere-plan, le filtre et le repli restent.
test('filtre et moment touches apres plus de 60 s : appliques tout de suite, Today relu en arriere-plan', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { ...TODAY(LATER()), delay: 500 }], { email: true, clock: NOW });
  const faiza = page.locator('[data-td-filter="4"]:visible');
  await faiza.click();
  await faiza.click();
  // Donnees de moins de 60 s : aucune relecture.
  await frame(page);
  expect(await todayCalls(page)).toBe(1);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await faiza.click();
  await expect(faiza).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-td-open]')).toHaveCount(1);
  await page.locator('[data-td-moment="arr-1500"]').click();
  await expect(page.locator('[data-td-moment="arr-1500"]')).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => todayCalls(page)).toBe(2);
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  await expect(faiza).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-td-moment="arr-1500"]')).toHaveAttribute('aria-expanded', 'false');
  expect(await todayCalls(page)).toBe(2);
});

// Garde de fraicheur partagee (manager/fresh.js, Today et Planning) : une relecture qui lance une
// exception (un repeint qui plante) ne laisse pas le verrou pose ; le geste suivant relit encore.
test('fresh.js : une relecture en exception ne bloque pas les gestes suivants', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.locator('.td-blocked')).toBeVisible();
  const r = await page.evaluate(async () => {
    const { createFreshGate } = await import('/manager/fresh.js');
    let reads = 0;
    const gate = createFreshGate({
      blocked: () => false, stale: () => true, readOnly: () => false, refuse: () => {}, isCurrent: () => true,
      refresh: async () => { reads++; if (reads === 1) throw new Error('paint failed'); },
    });
    let first = '';
    try { first = String(await gate()); } catch (e) { first = 'threw: ' + (e as Error).message; }
    const second = await gate();
    return { first, second, reads };
  });
  expect(r).toEqual({ first: 'threw: paint failed', second: true, reads: 2 });
});
