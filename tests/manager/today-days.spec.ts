import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchDone, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { lookMetrics } from './look';
import { NOW, todayBody } from './fixtures';
import { daysOf, IDEM, noIdem, OK, planningBody } from './planning-fixtures';

// Today, bande de sept jours (lot 4a, tache 5) : le jour des donnees puis six jours lus dans
// mgr.planning, en arriere-plan apres le premier rendu de Today. Un autre jour : meme gabarit
// que Today (buildAhead), le premier menage sans cleaner ouvert d'office, choix dans la carte.
const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const PJ = (o: any) => ({
  kind: 'checkout', postponedFrom: null, checkout: '11:00', guest: 'Guest', next: null, assigned: [], serviceType: null,
  state: 'not_started', cancelled: null, laundry: null, extra: null, tone: 'idle', word: 'Scheduled', ...o,
});

// Semaine du 5 octobre, avec pour samedi 10 : un menage sans personne, un annule et un fait sans personne.
function weekBody() {
  const b = planningBody();
  b.jobs.push(
    PJ({ key: '2026-10-10_Jo Kim', listingId: 'L7', apt: '707', bld: 'Marina Gate', date: '2026-10-10', checkout: '10:00', guest: 'Jo Kim',
      next: { date: '2026-10-12', time: '15:00', sameDay: false, before: false }, tone: 'bad', word: 'Unassigned' }),
    PJ({ key: '2026-10-10_Ca Ncl', listingId: 'L11', apt: '111', bld: 'Cancel Tower', date: '2026-10-10', guest: 'Ca Ncl',
      cancelled: { reason: 'Guest extended', by: 'Walter' }, word: 'Cancelled' }),
    PJ({ key: '2026-10-10_Do Ne', listingId: 'L12', apt: '121', bld: 'Done Tower', date: '2026-10-10', guest: 'Do Ne',
      state: 'done', tone: 'ok', word: 'Done' }),
  );
  return b;
}
// Semaine du 12 octobre : un menage lundi 12, rien jeudi 15.
function nextWeekBody(over: any = {}) {
  return planningBody({
    start: '2026-10-12', end: '2026-10-18', today: '2026-10-09', days: daysOf('2026-10-12'),
    jobs: [PJ({ key: '2026-10-12_Mo Day', listingId: 'L13', apt: '1301', bld: 'Monday Heights', date: '2026-10-12', checkout: '12:00', guest: 'Mo Day',
      tone: 'bad', word: 'Unassigned' })],
    counts: { total: 1, unassigned: 1, done: 0, cancelled: 0 },
    ...over,
  });
}
const WEEK1 = (body: any = weekBody(), extra: any = {}) => ({ match: 'action=mgr.planning&start=2026-10-05', status: 200, body, ...extra });
const WEEK2 = (body: any = nextWeekBody(), extra: any = {}) => ({ match: 'action=mgr.planning&start=2026-10-12', status: 200, body, ...extra });
const JK = '2026-10-10_Jo Kim'; // Apt 707, samedi, personne dessus
const FH = '2026-10-10_Fa Ho';  // Apt 505, samedi, Elite Cleaning dessus

// Le bouton « Location » (loc-pill.js, charge apres le premier rendu) se pose sous l'en-tete et
// pousse la page vers le bas : un clic lance pendant ce decalage se perd (mousedown sur la puce,
// mouseup ailleurs). Meme attente que maintenance-ticket.spec.ts (MANAGER partage sa position).
async function boot(page: Page, routes: any[], opts: any) {
  await bootMgr(page, routes, opts);
  await expect(page.locator('#main > [data-loc-pill]')).toBeVisible();
}
const plCalls = async (page: Page) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).map((l) => l.url);
const weekCalls = async (page: Page, start: string) => (await plCalls(page)).filter((u) => u.includes('start=' + start)).length;
const weekDone = async (page: Page, start: string) => (await fetchDone(page)).filter((u) => u.includes('mgr.planning') && u.includes('start=' + start)).length;
const writes = async (page: Page, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action)).map((l) => JSON.parse(l.body));
const todayCalls = async (page: Page) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length;
const chip = (page: Page, day: string) => page.locator('[data-wday="' + day + '"]');
const chips = (page: Page) => page.locator('[data-wday]');
const counts = (page: Page) => chips(page).locator('.td-wc');
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
// Journee du jour des donnees affichee : son titre et sa carte bloquee.
const todayBoard = (page: Page) => page.locator('.td-blocked', { hasText: 'Apt 308' });
const card = (page: Page, text: string) => page.locator('.td-card', { hasText: text });
const disc = (page: Page, key: string) => page.locator('[data-td-who="' + key + '"]');
const choice = (page: Page) => page.locator('.td-pick');
const wtile = (page: Page, pid: string) => page.locator('.td-pick [data-td-wpick="' + pid + '"]');
const backToTab = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
});
const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
// Ordre des lectures de la semaine du 5 octobre et des affectations.
const weekAndWrites = async (page: Page) => (await fetchLog(page))
  .filter((l) => l.url.includes('start=2026-10-05') || l.url.endsWith('action=assignCleaner'))
  .map((l) => (l.url.endsWith('action=assignCleaner') ? 'write' : 'week'));

test('Today est affiche avant la reponse de mgr.planning, les comptes de la bande arrivent ensuite', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(weekBody(), { delay: 2500 }), WEEK2(nextWeekBody(), { delay: 2500 })], { email: true, clock: NOW });
  await expect(h1(page)).toHaveText('Friday');
  await expect(todayBoard(page)).toBeVisible();
  // Today affiche, aucune semaine encore rendue : comptes inconnus, point median.
  expect((await fetchDone(page)).filter((u) => u.includes('mgr.planning'))).toEqual([]);
  const days = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
  expect(await chips(page).evaluateAll((l) => l.map((b) => b.getAttribute('data-wday')))).toEqual(days);
  await expect(chips(page).locator('.td-wl')).toHaveText(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
  await expect(chips(page).locator('.td-wn')).toHaveText(['9', '10', '11', '12', '13', '14', '15']);
  await expect(counts(page)).toHaveText(['1', '·', '·', '·', '·', '·', '·']);
  await expect(page.locator('.td-date')).toContainText('9 October · today');
  await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'false');
  // Lues en arriere-plan, une fois par semaine que touchent les six jours suivants.
  await expect.poll(() => plCalls(page)).toEqual([expect.stringContaining('start=2026-10-05'), expect.stringContaining('start=2026-10-12')]);
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
  // Rien d'autre n'a bouge : toujours Today, toujours deux appels.
  await expect(h1(page)).toHaveText('Friday');
  expect((await plCalls(page)).length).toBe(2);
  expect(await todayCalls(page)).toBe(1);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('bande : sept jours, comptes sans cleaner, point median tant que la semaine n est pas lue', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2(nextWeekBody(), { delay: 2500 })], { email: true, clock: NOW });
  // Samedi : 707 seul sans cleaner (l'annule et le fait sans personne ne comptent pas), 3 menages.
  await expect(counts(page)).toHaveText(['1', '1', '0', '·', '·', '·', '·']);
  await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-label', 'Fri 9, 3 cleanings, 1 with no cleaner');
  await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-label', 'Sat 10, 3 cleanings, 1 with no cleaner');
  await expect(chip(page, '2026-10-11')).toHaveAttribute('aria-label', 'Sun 11, 0 cleanings, 0 with no cleaner');
  // Compte inconnu : point median, et un aria-label sans compte.
  await expect(chip(page, '2026-10-12')).toHaveAttribute('aria-label', 'Mon 12');
  await expect(chip(page, '2026-10-12').locator('.td-wc')).toHaveClass(/td-zero/);
  await expect(chip(page, '2026-10-11').locator('.td-wc')).toHaveClass(/td-zero/);
  await expect(chip(page, '2026-10-10').locator('.td-wc')).not.toHaveClass(/td-zero/);
  await expect(chip(page, '2026-10-12')).toHaveAttribute('aria-label', 'Mon 12, 1 cleaning, 1 with no cleaner');
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
  await expect(chip(page, '2026-10-15')).toHaveAttribute('aria-label', 'Thu 15, 0 cleanings, 0 with no cleaner');
});

test('semaine en echec en arriere-plan : aucun message, toucher le jour relance la lecture', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), { match: 'action=mgr.planning&start=2026-10-05', status: 500, body: { error: 'Internal error' }, once: true },
    WEEK1(), WEEK2()], { email: true, clock: NOW });
  await expect(chip(page, '2026-10-12')).toHaveAttribute('aria-label', 'Mon 12, 1 cleaning, 1 with no cleaner');
  await expect.poll(() => weekDone(page, '2026-10-05')).toBe(1);
  // Aucun bandeau ni message : les comptes de la semaine restent absents.
  await expect(page.locator('.banner, .err-card, [role="alert"]')).toHaveCount(0);
  // #toast est toujours dans la page : vide et sans la classe on tant qu'aucun message n'est parti.
  await expect(page.locator('#toast')).toHaveText('');
  await expect(page.locator('#toast')).not.toHaveClass(/\bon\b/);
  await expect(counts(page)).toHaveText(['1', '·', '·', '1', '0', '0', '0']);
  await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-label', 'Sat 10');
  // Toucher le jour relance la lecture.
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Apt 707')).toBeVisible();
  expect(await weekCalls(page, '2026-10-05')).toBe(2);
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
});

// Comptes de la bande relus pendant une longue session (revue finale, Important 2) : quand Today
// est relu, une semaine lue il y a plus de 5 min, ou en echec, est relue en arriere-plan ; seules
// les puces changent, sur place (#main n'est pas repeint).
test('comptes de la bande : Today relu plus de 5 min apres la lecture des semaines, puces relues sur place', async ({ page }) => {
  const sat = weekBody();
  sat.jobs.push(PJ({ key: '2026-10-10_Ky Lo', listingId: 'L17', apt: '717', bld: 'Marina Gate', date: '2026-10-10', guest: 'Ky Lo',
    tone: 'bad', word: 'Unassigned' }));
  const mon = nextWeekBody();
  Object.assign(mon.jobs[0], { assigned: [10], serviceType: 'CHC', tone: 'idle', word: 'Scheduled' });
  await boot(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(todayBody({ generatedAt: '2026-10-09T07:05:01.000Z' })),
    { ...WEEK1(), once: true }, WEEK1(sat, { delay: 1500 }), { ...WEEK2(), once: true }, WEEK2(mon, { delay: 1500 })], { email: true, clock: NOW });
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 301_000));
  await backToTab(page);
  await expect(page.locator('.asof')).toContainText('as of 11:05');
  // Today relu et repeint : marque posee sur une puce, elle doit survivre a la mise a jour des comptes.
  await chip(page, '2026-10-10').evaluate((b) => b.setAttribute('data-probe', '1'));
  expect(await weekCalls(page, '2026-10-05')).toBe(2);
  expect(await weekCalls(page, '2026-10-12')).toBe(2);
  await expect(counts(page)).toHaveText(['1', '2', '0', '0', '0', '0', '0']);
  await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-label', 'Sat 10, 4 cleanings, 2 with no cleaner');
  await expect(chip(page, '2026-10-10')).toHaveAttribute('data-probe', '1');
  // Aucun bandeau, toujours Today.
  await expect(h1(page)).toHaveText('Friday');
  await expect(page.locator('.banner, .err-card')).toHaveCount(0);
});

test('comptes de la bande : Today relu moins de 5 min apres, aucun appel mgr.planning de plus', async ({ page }) => {
  await boot(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(todayBody({ generatedAt: '2026-10-09T07:04:00.000Z' })), WEEK1(), WEEK2()],
    { email: true, clock: NOW });
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 240_000));
  await backToTab(page);
  await expect(page.locator('.asof')).toContainText('as of 11:04');
  await frame(page);
  expect(await todayCalls(page)).toBe(2);
  expect((await plCalls(page)).length).toBe(2);
});

test('comptes de la bande : semaine en echec relue au Today suivant, sans message', async ({ page }) => {
  await boot(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(todayBody({ generatedAt: '2026-10-09T07:01:01.000Z' })),
    { match: 'action=mgr.planning&start=2026-10-05', status: 500, body: { error: 'Internal error' }, once: true }, WEEK1(), WEEK2()],
    { email: true, clock: NOW });
  await expect(chip(page, '2026-10-12')).toHaveAttribute('aria-label', 'Mon 12, 1 cleaning, 1 with no cleaner');
  await expect.poll(() => weekDone(page, '2026-10-05')).toBe(1);
  await expect(counts(page)).toHaveText(['1', '·', '·', '1', '0', '0', '0']);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await backToTab(page);
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  // Semaine en echec relue ; la semaine lue il y a 61 s ne l'est pas.
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
  expect(await weekCalls(page, '2026-10-05')).toBe(2);
  expect(await weekCalls(page, '2026-10-12')).toBe(1);
  await expect(page.locator('.banner, .err-card, [role="alert"]')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('');
});

test('Tomorrow : meme gabarit que Today, menage sans personne a affecter, annules et faits jamais proposes', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2()], { email: true, clock: NOW });
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
  await chip(page, '2026-10-10').click();
  await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
  await expect(h1(page)).toHaveText('Saturday');
  await expect(page.locator('.td-date')).toHaveText('10 October · tomorrow');
  await expect(page.locator('.td-sum')).toHaveText('3 cleanings. 1 has no cleaner yet.');
  // Semaine lue en arriere-plan, encore fraiche : pas relue.
  expect(await weekCalls(page, '2026-10-05')).toBe(1);
  const row = card(page, 'Apt 707 · Marina Gate');
  await expect(row).toContainText('No cleaner yet');
  await expect(row).toContainText('Out 10:00. Next guest Mon 12 at 15:00.');
  await expect(disc(page, JK)).toHaveAttribute('aria-label', 'Assign a cleaner to Apt 707 · Marina Gate');
  await expect(page.locator('[data-td-moment="later"]')).toContainText('Next guest later');
  await expect(page.locator('.td-main')).not.toContainText('Cancel Tower');
  // Menage fait : une ligne Done, jamais propose (aucun disque).
  await expect(card(page, 'Done Tower')).toContainText('Done');
  await expect(card(page, 'Done Tower').locator('[data-td-who]')).toHaveCount(0);
  await expect(card(page, 'Apt 505 · Tower E')).toContainText('Elite Cleaning');
  // Pas de Not for today, pas de panneau, pas de fiche (donnees mgr.planning).
  await expect(page.locator('[data-td-more]')).toHaveCount(0);
  await expect(page.locator('.td-side')).toHaveCount(0);
  await expect(page.locator('[data-td-open]')).toHaveCount(0);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('Tomorrow dans la semaine suivante : start du lundi suivant', async ({ page }) => {
  const sunday = new Date('2026-10-11T07:00:00Z');
  await boot(page, [me(MANAGER), TODAY(todayBody({ day: '2026-10-11' })), WEEK2()], { email: true, clock: sunday });
  await expect(chips(page).nth(1)).toHaveAttribute('data-wday', '2026-10-12');
  await expect(chip(page, '2026-10-12')).toHaveAttribute('aria-label', 'Mon 12, 1 cleaning, 1 with no cleaner');
  await chip(page, '2026-10-12').click();
  await expect(h1(page)).toHaveText('Monday');
  await expect(page.locator('.td-date')).toHaveText('12 October · tomorrow');
  await expect(card(page, 'Apt 1301 · Monday Heights')).toBeVisible();
  // Les six jours suivants tiennent dans la semaine du lundi 12 : une seule lecture.
  expect(await plCalls(page)).toEqual([expect.stringContaining('start=2026-10-12')]);
});

test('Assign sur un autre jour : conge grise, assignCleaner avec idem et sans auteur, toast, Undo remet la liste', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, WEEK1(), WEEK2()], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  const pick = card(page, 'Apt 707').locator('.td-pick');
  await expect(pick).toHaveAttribute('aria-label', 'Who cleans Apt 707 · Marina Gate?');
  await expect(wtile(page, '4')).toBeDisabled();
  await expect(wtile(page, '4')).toContainText('On leave');
  await expect(wtile(page, '12')).toContainText('1 job');
  await expect(wtile(page, '10')).toContainText('0 jobs');
  await wtile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Apt 707 · Marina Gate assigned to Pionah');
  await expect(choice(page)).toHaveCount(0);
  const w1 = await writes(page, 'assignCleaner');
  expect(w1.length).toBe(1);
  expect(w1[0].idem).toMatch(IDEM);
  const { idem, ...body } = w1[0];
  expect(body).toEqual({ reservation_key: JK, cleaner_ids: [10], mode: 'set', service_type: 'CHC' });
  // Rechargement de la semaine, le jour choisi reste.
  await expect.poll(() => weekCalls(page, '2026-10-05')).toBe(2);
  await expect(h1(page)).toHaveText('Saturday');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  const w2 = (await writes(page, 'assignCleaner'))[1];
  expect(w2.idem).toMatch(IDEM);
  expect(w2.idem).not.toBe(idem);
  const { idem: _i, ...body2 } = w2;
  expect(body2).toEqual({ reservation_key: JK, cleaner_ids: [], mode: 'set', service_type: 'CHC' });
  for (const w of await writes(page, 'assignCleaner')) { expect(w).not.toHaveProperty('actor'); expect(w).not.toHaveProperty('author'); }
  await expect(page.locator('#toast')).toContainText('Apt 707 · Marina Gate back to nobody');
});

test('retour sur Today : le bloc du jour tel quel, sans nouvel appel mgr.today', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(h1(page)).toHaveText('Saturday');
  await chip(page, '2026-10-09').click();
  await expect(todayBoard(page)).toBeVisible();
  await expect(h1(page)).toHaveText('Friday');
  await expect(page.locator('.td-sum')).toContainText('4 guests arrive today.');
  await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.td-blocked')).toContainText('No cleaner assigned');
  // Le choix ouvert d'office sur samedi ne suit pas sur Today.
  await expect(choice(page)).toHaveCount(0);
  expect(await todayCalls(page)).toBe(1);
  // Semaine gardee en memoire : revenir sur Sat 10 ne relit pas mgr.planning.
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Apt 707')).toBeVisible();
  expect(await weekCalls(page, '2026-10-05')).toBe(1);
});

test('reponse tardive : la semaine lente ne repeint pas le jour choisi ensuite', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK2(), WEEK1(weekBody(), { delay: 2500 })], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(page.locator('.td-main')).toContainText('Loading Sat 10…');
  await chip(page, '2026-10-12').click();
  await expect(h1(page)).toHaveText('Monday');
  await expect(card(page, 'Apt 1301')).toBeVisible();
  // Attendre que la reponse lente soit rendue (sans delai fixe), puis verifier qu'elle n'a rien repeint.
  await expect.poll(() => weekDone(page, '2026-10-05')).toBe(1);
  await expect(counts(page).nth(1)).toHaveText('1');
  await expect(h1(page)).toHaveText('Monday');
  await expect(card(page, 'Apt 1301')).toBeVisible();
  await expect(chip(page, '2026-10-12')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'Apt 1301').locator('.td-pick')).toBeVisible();
  // La semaine lente est gardee : Sat 10 s'affiche sans nouvel appel.
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Apt 707')).toBeVisible();
  expect((await plCalls(page)).length).toBe(2);
});

test('jour vide : No cleaning planned for Thu 15.', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2()], { email: true, clock: NOW });
  await chip(page, '2026-10-15').click();
  await expect(h1(page)).toHaveText('Thursday');
  await expect(page.locator('.td-empty')).toHaveText('No cleaning planned for Thu 15.');
  await expect(page.locator('.td-sum')).toHaveText('No cleaning planned.');
  await expect(choice(page)).toHaveCount(0);
});

test('erreur mgr.planning : message et Retry, puis le jour', async ({ page }) => {
  const fail = { match: 'action=mgr.planning&start=2026-10-05', status: 500, body: { error: 'Internal error' }, once: true };
  await boot(page, [me(MANAGER), TODAY(), fail, { ...fail }, WEEK1(), WEEK2()], { email: true, clock: NOW });
  await expect.poll(() => weekDone(page, '2026-10-05')).toBe(1);
  await chip(page, '2026-10-10').click();
  await expect(page.locator('.td-main .err-card')).toContainText('Internal error');
  await page.locator('.td-main').getByRole('button', { name: 'Retry' }).click();
  await expect(card(page, 'Apt 707')).toBeVisible();
  // Arrivee sur le jour : le premier menage sans cleaner s'ouvre quand il est enfin lu.
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  // Le Today du jour n'a pas ete relu par ce Retry.
  expect(await todayCalls(page)).toBe(1);
});

test('semaine non fraiche apres un rechargement en echec : plus de choix, Reconnect to make changes', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, { ...WEEK1(), once: true },
    { match: 'action=mgr.planning', status: 500, body: { error: 'Internal error' } }], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  await wtile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  const banner = page.locator('.banner.warn');
  await expect(banner).toContainText('Internal error');
  await expect(banner).toContainText('Reconnect to make changes.');
  await expect(banner.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('[data-td-who]')).toHaveCount(0);
  await expect(choice(page)).toHaveCount(0);
  await expect(card(page, 'Apt 707')).toBeVisible();
  // Un geste arrive quand meme (ancienne tuile) : refuse sans ecriture.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-td-wpick', '10'); b.setAttribute('data-key', '2026-10-10_Jo Kim');
    document.body.appendChild(b);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('Reassign sur un autre jour : disque de la carte (pas pour un menage fait), meme choix', async ({ page }) => {
  const body = weekBody();
  body.jobs.push(PJ({ key: '2026-10-10_Ze Ta', listingId: 'L14', apt: '141', bld: 'Zeta Tower', date: '2026-10-10', guest: 'Ze Ta',
    assigned: [10], serviceType: 'CHC', state: 'done', tone: 'ok', word: 'Done' }));
  await boot(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, WEEK1(body), WEEK2()], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  await expect(disc(page, FH)).toHaveAttribute('aria-label', 'Change the cleaner of Apt 505 · Tower E');
  // Menage fait : aucun disque.
  await expect(card(page, 'Zeta Tower').locator('[data-td-who]')).toHaveCount(0);
  await disc(page, FH).click();
  const pick = card(page, 'Apt 505').locator('.td-pick');
  await expect(pick).toBeVisible();
  await expect(choice(page)).toHaveCount(1);
  await expect(pick.locator('[data-td-wpick="12"]')).toHaveAttribute('aria-current', 'true');
  await expect(pick.locator('[data-td-wpick="10"]')).toContainText('1 job');
  await pick.locator('[data-td-wpick="10"]').click();
  await expect(page.locator('#toast')).toContainText('Apt 505 · Tower E assigned to Pionah');
  const w = await writes(page, 'assignCleaner');
  expect(w.length).toBe(1);
  expect(w[0].idem).toMatch(IDEM);
  const { idem, ...b } = w[0];
  expect(b).toEqual({ reservation_key: FH, cleaner_ids: [10], mode: 'set', service_type: 'CHC' });
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  const { idem: _i, ...b2 } = (await writes(page, 'assignCleaner'))[1];
  expect(b2).toEqual({ reservation_key: FH, cleaner_ids: [12], mode: 'set', service_type: 'CHC' });
});

test('apres minuit : les puces partent du jour des donnees, le bloc d hier n est jamais appele Today', async ({ page }) => {
  // Horloge au samedi 10 (Dubai), donnees du vendredi 9 encore a l'ecran.
  const sat = new Date('2026-10-10T07:00:00Z');
  await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2()], { email: true, clock: sat });
  await expect(chips(page).first()).toHaveAttribute('data-wday', '2026-10-09');
  await expect(chips(page).locator('.td-wl')).toHaveText(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu']);
  await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.td-date')).toContainText('9 October · as of');
  await expect(page.locator('.td-date')).not.toContainText('today');
  // Samedi (le jour de l'horloge) se lit dans mgr.planning, sans « tomorrow » ;
  // « tomorrow » suit l'horloge : dimanche 11.
  await chip(page, '2026-10-10').click();
  await expect(h1(page)).toHaveText('Saturday');
  await expect(page.locator('.td-date')).toHaveText('10 October');
  await expect(card(page, 'Apt 707')).toBeVisible();
  await chip(page, '2026-10-11').click();
  await expect(page.locator('.td-date')).toHaveText('11 October · tomorrow');
});

test('clavier : apres un toucher sur une puce, le focus reste sur la puce', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(weekBody(), { delay: 2500 }), WEEK2()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.td-main')).toContainText('Loading Sat 10…');
  await expect(chip(page, '2026-10-10')).toBeFocused();
  // Le choix ouvert d'office ne prend pas le focus.
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  await expect(chip(page, '2026-10-10')).toBeFocused();
  await chip(page, '2026-10-09').focus();
  await page.keyboard.press('Enter');
  await expect(todayBoard(page)).toBeVisible();
  await expect(chip(page, '2026-10-09')).toBeFocused();
});

test('semaine lue il y a plus de 60 s : relue avant le choix de personne', async ({ page }) => {
  const later = weekBody();
  later.jobs.find((j: any) => j.key === FH).assigned = [10];
  await boot(page, [me(MANAGER), TODAY(), { ...WEEK1(), once: true }, WEEK1(later), WEEK2()], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  await expect(wtile(page, '10')).toContainText('0 jobs');
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(choice(page)).toHaveCount(0);
  expect(await weekCalls(page, '2026-10-05')).toBe(1);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await disc(page, JK).click();
  // Choix ouvert sur la reponse fraiche : Pionah a maintenant Apt 505 ce jour-la.
  await expect(wtile(page, '10')).toContainText('1 job');
  expect(await weekCalls(page, '2026-10-05')).toBe(2);
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  // Arrivee sur un jour dont la semaine a plus de 60 s : relue avant le choix ouvert d'office.
  await chip(page, '2026-10-09').click();
  await expect(todayBoard(page)).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 125_000));
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  expect(await weekCalls(page, '2026-10-05')).toBe(3);
});

test('semaine de plus de 60 s, relecture en echec : pas de choix, Reconnect, anciennes donnees gardees', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), { ...WEEK1(), once: true }, { match: 'action=mgr.planning', status: 0, body: {}, fail: true }],
    { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await disc(page, JK).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  await expect(choice(page)).toHaveCount(0);
  await expect(card(page, 'Apt 707')).toBeVisible();
  await expect(page.locator('.banner.warn')).toContainText('Reconnect to make changes.');
  await expect(page.locator('[data-td-who]')).toHaveCount(0);
  expect((await writes(page, 'assignCleaner')).length).toBe(0);
});

// Tuile d'un autre jour (revue finale, Important 1) : le choix ouvert d'office peut rester ouvert
// longtemps ; une tuile touchee sur une semaine de plus de 60 s la relit d'abord (meme regle que
// la tuile de Today). L'Undo remet la liste relue, pas celle de la vieille semaine.
test('tuile d un autre jour touchee apres plus de 60 s : semaine relue avant l ecriture, Undo vers la liste relue', async ({ page }) => {
  // Entre-temps, quelqu'un a mis Elite Cleaning sur Apt 707 dans le Planning.
  const later = weekBody();
  Object.assign(later.jobs.find((j: any) => j.key === JK), { assigned: [12], serviceType: 'CHC', tone: 'idle', word: 'Scheduled' });
  await boot(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, { ...WEEK1(), once: true }, WEEK1(later), WEEK2()],
    { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  // Choix ouvert d'office sur Apt 707, laisse ouvert plus d'une minute.
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await wtile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Apt 707 · Marina Gate assigned to Pionah');
  expect((await weekAndWrites(page)).slice(0, 3)).toEqual(['week', 'week', 'write']);
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([{ reservation_key: JK, cleaner_ids: [10], mode: 'set', service_type: 'CHC' }]);
  // Undo : la liste lue dans la semaine relue (Elite Cleaning), jamais « nobody ».
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  expect(noIdem(await writes(page, 'assignCleaner'))[1]).toEqual({ reservation_key: JK, cleaner_ids: [12], mode: 'set', service_type: 'CHC' });
  await expect(page.locator('#toast')).toContainText('Apt 707 · Marina Gate back to Elite Cleaning');
});

test('tuile d un autre jour touchee apres plus de 60 s, relecture en echec : Reconnect, aucune ecriture', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, { ...WEEK1(), once: true },
    { match: 'action=mgr.planning', status: 0, body: {}, fail: true }], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await wtile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  expect(await weekCalls(page, '2026-10-05')).toBe(2);
  expect(await writes(page, 'assignCleaner')).toHaveLength(0);
  // Anciennes donnees gardees, lecture seule : plus de choix, bandeau avec Retry.
  await expect(card(page, 'Apt 707')).toBeVisible();
  await expect(choice(page)).toHaveCount(0);
  await expect(page.locator('.banner.warn')).toContainText('Reconnect to make changes.');
  await frame(page);
  expect(await writes(page, 'assignCleaner')).toHaveLength(0);
});

// Course (revue finale) : la relecture lancee par le disque est supplantee par une autre (retour
// sur l'onglet) ; sa reponse ne compte pas, le choix attend la derniere et s'ouvre sur elle.
test('disque d un autre jour, relecture supplantee : le choix attend la derniere reponse de la semaine', async ({ page }) => {
  const last = weekBody();
  last.jobs.find((j: any) => j.key === FH).assigned = [10];
  await boot(page, [me(MANAGER), TODAY(), { ...WEEK1(), once: true }, { ...WEEK1(weekBody(), { delay: 800 }), once: true },
    WEEK1(last, { delay: 4000 }), WEEK2()], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(choice(page)).toHaveCount(0);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await disc(page, JK).click();
  await backToTab(page);
  // Reponse supplantee rendue : aucun choix ouvert sur elle.
  await expect.poll(() => weekDone(page, '2026-10-05'), { intervals: [50] }).toBe(2);
  await frame(page);
  await expect(choice(page)).toHaveCount(0);
  // Derniere reponse : le choix s'ouvre, Pionah a maintenant Apt 505 ce jour-la.
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  await expect(wtile(page, '10')).toContainText('1 job');
  expect(await weekDone(page, '2026-10-05')).toBe(3);
});

// Enchainement sur un autre jour (st.wchain) : apres l'affectation d'un menage qui n'avait
// personne, le choix du menage suivant sans cleaner s'ouvre sur la semaine relue.
test('enchainement sur un autre jour : apres une affectation, le menage suivant sans cleaner s ouvre', async ({ page }) => {
  const two = weekBody();
  two.jobs.push(PJ({ key: '2026-10-10_Ky Lo', listingId: 'L17', apt: '717', bld: 'Marina Gate', date: '2026-10-10', guest: 'Ky Lo',
    tone: 'bad', word: 'Unassigned' }));
  const after = JSON.parse(JSON.stringify(two));
  Object.assign(after.jobs.find((j: any) => j.key === JK), { assigned: [10], serviceType: 'CHC', tone: 'idle', word: 'Scheduled' });
  await boot(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, { ...WEEK1(two), once: true }, WEEK1(after), WEEK2()],
    { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('2');
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Apt 707').locator('.td-pick')).toBeVisible();
  await wtile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Apt 707 · Marina Gate assigned to Pionah');
  const next = card(page, 'Apt 717').locator('.td-pick');
  await expect(next).toBeVisible();
  await expect(choice(page)).toHaveCount(1);
  // Faiza est en conge : le focus va a Pionah, premiere personne disponible.
  await expect(next.locator('[data-td-wpick="10"]')).toBeFocused();
  expect(await weekCalls(page, '2026-10-05')).toBe(2);
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([{ reservation_key: JK, cleaner_ids: [10], mode: 'set', service_type: 'CHC' }]);
});

test('Heure d un extra sur un autre jour : Extra cleaning at 09:30, sans heure Extra cleaning', async ({ page }) => {
  const b = weekBody();
  b.jobs.push(
    PJ({ key: 'extra_2026-10-10_mx1', kind: 'extra', listingId: 'L14', apt: '1401', bld: 'Timed Tower', date: '2026-10-10', checkout: null, guest: null,
      tone: 'bad', word: 'Unassigned', extra: { id: 41, label: 'Deep clean', cleaningDate: '2026-10-10', cleaningTime: '09:30' } }),
    PJ({ key: 'extra_2026-10-10_mx2', kind: 'extra', listingId: 'L15', apt: '1501', bld: 'Plain Tower', date: '2026-10-10', checkout: null, guest: null,
      tone: 'bad', word: 'Unassigned', extra: { id: 42, label: 'Deep clean', cleaningDate: '2026-10-10' } }),
  );
  await boot(page, [me(MANAGER), TODAY(), WEEK1(b), WEEK2()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(card(page, 'Timed Tower').locator('.td-ti')).toHaveText('Extra cleaning at 09:30.');
  await expect(card(page, 'Plain Tower').locator('.td-ti')).toHaveText('Extra cleaning.');
});

test('autre jour : premier menage sans cleaner ouvert d office, personne en conge desactivee', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2()], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  await chip(page, '2026-10-10').click();
  // Apt 505 (Elite dessus) vient avant dans la liste : le choix ouvert d'office est celui d'Apt 707.
  await expect(choice(page)).toHaveCount(1);
  const pick = card(page, 'Apt 707').locator('.td-pick');
  await expect(pick.getByText('Who cleans it?')).toBeVisible();
  await expect(disc(page, JK)).toHaveAttribute('aria-expanded', 'true');
  await expect(pick.locator('[data-td-wpick]')).toHaveText([/Faiza\s*On leave$/, /Pionah\s*0 jobs$/, /Elite Cleaning\s*1 job$/]);
  await expect(wtile(page, '4')).toBeDisabled();
  await expect(wtile(page, '10')).toBeEnabled();
  // Ouvert par le disque : le focus va a la premiere personne disponible (Faiza est en conge).
  await pick.getByRole('button', { name: 'Cancel' }).click();
  await expect(choice(page)).toHaveCount(0);
  await disc(page, JK).click();
  await expect(wtile(page, '10')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(choice(page)).toHaveCount(0);
  await expect(disc(page, JK)).toBeFocused();
  // Dimanche, sans menage : aucun choix.
  await chip(page, '2026-10-11').click();
  await expect(page.locator('.td-empty')).toHaveText('No cleaning planned for Sun 11.');
  await expect(choice(page)).toHaveCount(0);
});

test('autre jour : menage reporte apres l arrivee du guest, Guest arrives first en tete avec le mot du proxy', async ({ page }) => {
  const b = weekBody();
  b.jobs.push(PJ({ key: '2026-10-07_Ri Ta', listingId: 'L16', apt: '1601', bld: 'Late Tower', date: '2026-10-10', checkout: null, guest: 'Ri Ta',
    postponedFrom: '2026-10-07', assigned: [10], serviceType: 'CHC', next: { date: '2026-10-09', time: '15:00', sameDay: false, before: true },
    tone: 'bad', word: 'Guest arrives first' }));
  await boot(page, [me(MANAGER), TODAY(), WEEK1(b), WEEK2()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  const first = page.locator('[data-td-moment]').first();
  await expect(first).toHaveAttribute('data-td-moment', 'first');
  await expect(first).toContainText('Guest arrives first');
  await expect(first).toHaveAttribute('aria-label', 'Guest arrives first: 1 late');
  const late = card(page, 'Late Tower');
  await expect(late.locator('.td-st')).toHaveClass(/td-k-first/);
  await expect(late.locator('.td-st')).toContainText('Guest arrives first · Pionah');
  await expect(late.locator('.td-ti')).toHaveText('Postponed from 07/10. Guest arrives Fri 9 at 15:00, before this cleaning.');
  await expect(late).not.toContainText('Next guest');
  await expect(page.locator('[data-td-moment="later"]')).not.toContainText('Late Tower');
});

test('la reponse de la semaine pendant une ecriture ne ferme pas le choix et ne rend pas les tuiles', async ({ page }) => {
  await boot(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 6000 },
    WEEK1(weekBody(), { delay: 3000 }), WEEK2(nextWeekBody(), { delay: 3000 })], { email: true, clock: NOW });
  await page.locator('.td-blocked').getByRole('button', { name: 'Assign someone' }).click();
  const pionah = page.locator('.td-pick [data-td-pick="10"]');
  await pionah.focus();
  await page.keyboard.press('Enter');
  await expect(pionah).toHaveAttribute('aria-disabled', 'true');
  // L'ecriture est partie avant les semaines.
  expect(await weekDone(page, '2026-10-05')).toBe(0);
  await expect.poll(() => weekDone(page, '2026-10-12')).toBe(1);
  await expect.poll(() => weekDone(page, '2026-10-05')).toBe(1);
  await expect(counts(page)).toHaveText(['1', '1', '0', '1', '0', '0', '0']);
  // Rendu par la reponse : choix ouvert, tuiles toujours desactivees, focus garde.
  await expect(choice(page)).toHaveCount(1);
  await expect(page.locator('.td-pick [data-td-pick]')).toHaveCount(3);
  for (const id of ['4', '10', '12']) await expect(page.locator('.td-pick [data-td-pick="' + id + '"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(pionah).toBeFocused();
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
  await expect(page.locator('#toast')).toContainText('Apt 308 · Binghatti Lavender assigned to Pionah');
});

test('meme personne, meme couleur : la classe du disque de Faiza est la meme sur Today et sur un autre jour', async ({ page }) => {
  await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2()], { email: true, clock: NOW });
  await expect(counts(page).nth(1)).toHaveText('1');
  const cls = (sel: string) => page.locator(sel).first().getAttribute('class');
  const today = { faiza: await cls('[data-td-filter="4"] .td-disc'), pionah: await cls('[data-td-filter="10"] .td-disc') };
  expect(today.faiza).toMatch(/td-p\d/);
  expect(today.faiza).not.toBe(today.pionah);
  await chip(page, '2026-10-10').click();
  await expect(choice(page)).toHaveCount(1);
  expect(await cls('[data-td-filter="4"] .td-disc')).toBe(today.faiza);
  expect(await cls('.td-pick [data-td-wpick="4"] .td-disc')).toBe(today.faiza);
  expect(await cls('[data-td-filter="10"] .td-disc')).toBe(today.pionah);
  expect(await cls('.td-pick [data-td-wpick="10"] .td-disc')).toBe(today.pionah);
});

// Un autre jour tient les seuils de Today, choix ouvert et personne en conge comprise.
const WIDTHS = [320, 390, 768, 960, 1280, 1440];
for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('autre jour lisible (' + scheme + ')', async ({ page }) => {
      await boot(page, [me(MANAGER), TODAY(), WEEK1(), WEEK2()], { email: true, clock: NOW });
      await expect(counts(page).nth(1)).toHaveText('1');
      await chip(page, '2026-10-10').click();
      await expect(wtile(page, '4')).toBeDisabled();
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        // Personnes : puces a toute largeur (pas de panneau sur un autre jour).
        await expect(page.locator('.td-fchip[data-td-filter="4"]')).toBeVisible();
        const m = await lookMetrics(page);
        const where = width + ' px';
        expect(m.overflowX, 'défilement horizontal, ' + where).toBeLessThanOrEqual(0);
        expect(m.smallTop, 'cibles, ' + where).toEqual([]);
        expect(m.tinyTop, 'texte sous 14 px, ' + where).toEqual([]);
        expect(m.lowTop, 'contraste, ' + where).toEqual([]);
      }
    });
  });
}
