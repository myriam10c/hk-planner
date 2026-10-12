import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchDone, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { NOW, todayBody } from './fixtures';
import { daysOf, IDEM, OK, planningBody } from './planning-fixtures';

// Today, bloc « Who does what » : jours suivants (Tomorrow et 5 jours) lus dans mgr.planning.
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

const plCalls = async (page: Page) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).map((l) => l.url);
const writes = async (page: Page, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action)).map((l) => JSON.parse(l.body));
const who = (page: Page) => page.locator('section[aria-labelledby="h-who"]');
const chip = (page: Page, day: string) => page.locator('[data-wday="' + day + '"]');

test('jours : Today, Tomorrow puis 5 jours, Today choisi, aucun appel mgr.planning au demarrage', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: 'Who does what today', exact: true })).toBeVisible();
  const chips = who(page).locator('[data-wday]');
  await expect(chips).toHaveText(['Today', 'Tomorrow', 'Sun 11', 'Mon 12', 'Tue 13', 'Wed 14', 'Thu 15']);
  await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'false');
  expect(await plCalls(page)).toEqual([]);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('Tomorrow : mgr.planning de la semaine, menage sans personne avec Assign, annules et faits jamais proposes', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), WEEK1()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(chip(page, '2026-10-10')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Who does what, Sat 10', exact: true })).toBeVisible();
  expect(await plCalls(page)).toEqual([expect.stringContaining('start=2026-10-05')]);
  const un = who(page).locator('.person.unassigned');
  await expect(un.locator('.job')).toHaveCount(1);
  const row = un.locator('.job', { hasText: 'Apt 707 · Marina Gate' });
  await expect(row).toContainText('10:00');
  await expect(row).toContainText('Checks in Mon 12 at 15:00');
  await expect(row.getByRole('button', { name: 'Assign' })).toBeVisible();
  await expect(who(page)).not.toContainText('Cancel Tower');
  await expect(un).not.toContainText('Done Tower');
  const elite = who(page).locator('.person', { hasText: 'Elite Cleaning' });
  await expect(elite).toContainText('Subcontractor');
  await expect(elite).toContainText('Apt 505 · Tower E');
  // Le reste de Today reste sur aujourd'hui.
  await expect(page.getByRole('heading', { name: 'Ready for today’s arrivals' })).toBeVisible();
  await expect(page.locator('.strip')).toContainText('cleanings today');
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('Tomorrow dans la semaine suivante : start du lundi suivant', async ({ page }) => {
  const sunday = new Date('2026-10-11T07:00:00Z');
  await bootMgr(page, [me(MANAGER), TODAY(todayBody({ day: '2026-10-11' })), WEEK2()], { email: true, clock: sunday });
  await expect(who(page).locator('[data-wday]').nth(1)).toHaveAttribute('data-wday', '2026-10-12');
  await chip(page, '2026-10-12').click();
  await expect(page.getByRole('heading', { name: 'Who does what, Mon 12', exact: true })).toBeVisible();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 1301 · Monday Heights');
  expect(await plCalls(page)).toEqual([expect.stringContaining('start=2026-10-12')]);
});

test('Assign sur un autre jour : conge grise, assignCleaner avec idem et sans auteur, toast, Undo remet la liste', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, WEEK1()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await who(page).locator('.person.unassigned .job', { hasText: 'Apt 707' }).getByRole('button', { name: 'Assign' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Assign a cleaner' })).toBeVisible();
  await expect(sheet).toContainText('Sat 10');
  await expect(sheet.locator('[data-wpick="4"]')).toBeDisabled();
  await expect(sheet.locator('[data-wpick="4"]')).toContainText('Cleaner · On leave');
  await expect(sheet.locator('[data-wpick="12"]')).toContainText('Subcontractor · 1 job that day');
  await expect(sheet.locator('[data-wpick="10"]')).toContainText('Cleaner · 0 jobs that day');
  await sheet.locator('[data-wpick="10"]').click();
  await expect(page.locator('#toast')).toContainText('Apt 707 · Marina Gate assigned to Pionah');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  const w1 = await writes(page, 'assignCleaner');
  expect(w1.length).toBe(1);
  expect(w1[0].idem).toMatch(IDEM);
  const { idem, ...body } = w1[0];
  expect(body).toEqual({ reservation_key: '2026-10-10_Jo Kim', cleaner_ids: [10], mode: 'set', service_type: 'CHC' });
  // Rechargement de la semaine, le jour choisi reste.
  await expect.poll(async () => (await plCalls(page)).length).toBe(2);
  await expect(page.getByRole('heading', { name: 'Who does what, Sat 10', exact: true })).toBeVisible();
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  const w2 = (await writes(page, 'assignCleaner'))[1];
  expect(w2.idem).toMatch(IDEM);
  expect(w2.idem).not.toBe(idem);
  const { idem: _i, ...body2 } = w2;
  expect(body2).toEqual({ reservation_key: '2026-10-10_Jo Kim', cleaner_ids: [], mode: 'set', service_type: 'CHC' });
  for (const w of await writes(page, 'assignCleaner')) { expect(w).not.toHaveProperty('actor'); expect(w).not.toHaveProperty('author'); }
  await expect(page.locator('#toast')).toContainText('Apt 707 · Marina Gate back to nobody');
});

test('retour sur Today : le bloc du jour tel quel, sans nouvel appel mgr.today', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), WEEK1()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(page.getByRole('heading', { name: 'Who does what, Sat 10', exact: true })).toBeVisible();
  await chip(page, '2026-10-09').click();
  await expect(page.getByRole('heading', { name: 'Who does what today', exact: true })).toBeVisible();
  await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.person.unassigned')).toContainText('Apt 308');
  await expect(page.locator('.person.unassigned')).toContainText('Same-day arrivals first');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length).toBe(1);
  // Semaine gardee en memoire : revenir sur Sat 10 ne relit pas mgr.planning.
  await chip(page, '2026-10-10').click();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 707');
  expect((await plCalls(page)).length).toBe(1);
});

test('reponse tardive : la semaine lente ne repeint pas le jour choisi ensuite', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), WEEK2(), WEEK1(weekBody(), { delay: 1500 })], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(who(page)).toContainText('Loading Sat 10…');
  await chip(page, '2026-10-12').click();
  await expect(page.getByRole('heading', { name: 'Who does what, Mon 12', exact: true })).toBeVisible();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 1301');
  // Attendre que la reponse lente soit rendue (sans delai fixe), puis verifier qu'elle n'a rien repeint.
  await expect.poll(async () => (await fetchDone(page)).filter((u) => u.includes('start=2026-10-05')).length).toBe(1);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  await expect(page.getByRole('heading', { name: 'Who does what, Mon 12', exact: true })).toBeVisible();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 1301');
  await expect(chip(page, '2026-10-12')).toHaveAttribute('aria-pressed', 'true');
  // La semaine lente est gardee : Sat 10 s'affiche sans nouvel appel.
  await chip(page, '2026-10-10').click();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 707');
  expect((await plCalls(page)).length).toBe(2);
});

test('jour vide : No cleaning planned', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), WEEK2()], { email: true, clock: NOW });
  await chip(page, '2026-10-15').click();
  await expect(who(page)).toContainText('No cleaning planned for Thu 15.');
});

test('erreur mgr.planning : message et Retry, puis le jour', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=mgr.planning', status: 500, body: { error: 'Internal error' }, once: true }, WEEK1()], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(who(page).locator('.err-card')).toContainText('Internal error');
  await who(page).getByRole('button', { name: 'Retry' }).click();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 707');
  // Le Today du jour n'a pas ete relu par ce Retry.
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length).toBe(1);
});

test('semaine non fraiche apres un rechargement en echec : plus de Assign, Reconnect to make changes', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, { ...WEEK1(), once: true },
    { match: 'action=mgr.planning', status: 500, body: { error: 'Internal error' } }], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await who(page).locator('.person.unassigned .job', { hasText: 'Apt 707' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-wpick="10"]').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  await expect(who(page).locator('.banner.warn')).toContainText('Internal error');
  await expect(who(page).locator('[data-wassign]')).toHaveCount(0);
  // Un geste arrive quand meme (ancien bouton) : refuse sans ecriture.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-wpick', '10'); b.setAttribute('data-key', '2026-10-10_Jo Kim');
    document.body.appendChild(b);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('Reassign sur un autre jour : bouton dans les groupes de personnes (pas pour un menage fait), meme choix', async ({ page }) => {
  const body = weekBody();
  body.jobs.push(PJ({ key: '2026-10-10_Ze Ta', listingId: 'L14', apt: '141', bld: 'Zeta Tower', date: '2026-10-10', guest: 'Ze Ta',
    assigned: [10], serviceType: 'CHC', state: 'done', tone: 'ok', word: 'Done' }));
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }, WEEK1(body)], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  const elite = who(page).locator('.person', { hasText: 'Elite Cleaning' });
  const row = elite.locator('.job', { hasText: 'Apt 505' });
  await expect(row.getByRole('button', { name: 'Reassign' })).toBeVisible();
  // Menage fait : pas de Reassign.
  await expect(who(page).locator('.person', { hasText: 'Pionah' }).locator('.job', { hasText: 'Apt 141' }).getByRole('button')).toHaveCount(0);
  await row.getByRole('button', { name: 'Reassign' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Assign a cleaner' })).toBeVisible();
  await expect(sheet.locator('[data-wpick="12"]')).toHaveAttribute('aria-current', 'true');
  await expect(sheet).toContainText('Now: Elite Cleaning.');
  await sheet.locator('[data-wpick="10"]').click();
  await expect(page.locator('#toast')).toContainText('Apt 505 · Tower E assigned to Pionah');
  const w = await writes(page, 'assignCleaner');
  expect(w.length).toBe(1);
  expect(w[0].idem).toMatch(IDEM);
  const { idem, ...b } = w[0];
  expect(b).toEqual({ reservation_key: '2026-10-10_Fa Ho', cleaner_ids: [10], mode: 'set', service_type: 'CHC' });
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  const { idem: _i, ...b2 } = (await writes(page, 'assignCleaner'))[1];
  expect(b2).toEqual({ reservation_key: '2026-10-10_Fa Ho', cleaner_ids: [12], mode: 'set', service_type: 'CHC' });
});

test('apres minuit : les puces partent du jour des donnees, le bloc d hier n est jamais appele Today', async ({ page }) => {
  // Horloge au samedi 10 (Dubai), donnees du vendredi 9 encore a l'ecran.
  const sat = new Date('2026-10-10T07:00:00Z');
  await bootMgr(page, [me(MANAGER), TODAY(), WEEK1()], { email: true, clock: sat });
  const chips = who(page).locator('[data-wday]');
  await expect(chips).toHaveText(['Fri 9', 'Today', 'Tomorrow', 'Mon 12', 'Tue 13', 'Wed 14', 'Thu 15']);
  await expect(chip(page, '2026-10-09')).toHaveAttribute('aria-pressed', 'true');
  // La puce Today (samedi) montre bien samedi, lu dans mgr.planning.
  await chip(page, '2026-10-10').click();
  await expect(page.getByRole('heading', { name: 'Who does what, Sat 10', exact: true })).toBeVisible();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 707');
});

test('clavier : apres un toucher sur une puce, le focus reste sur la puce', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), WEEK1(weekBody(), { delay: 300 })], { email: true, clock: NOW });
  await chip(page, '2026-10-10').focus();
  await page.keyboard.press('Enter');
  await expect(who(page)).toContainText('Loading Sat 10…');
  await expect(chip(page, '2026-10-10')).toBeFocused();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 707');
  await expect(chip(page, '2026-10-10')).toBeFocused();
  await chip(page, '2026-10-09').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Who does what today', exact: true })).toBeVisible();
  await expect(chip(page, '2026-10-09')).toBeFocused();
});

test('semaine lue il y a plus de 60 s : relue avant le choix de personne', async ({ page }) => {
  const later = weekBody();
  later.jobs.find((j: any) => j.key === '2026-10-10_Fa Ho').assigned = [10];
  await bootMgr(page, [me(MANAGER), TODAY(), { ...WEEK1(), once: true }, WEEK1(later)], { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await who(page).locator('.person.unassigned .job', { hasText: 'Apt 707' }).getByRole('button', { name: 'Assign' }).click();
  await expect(page.locator('#sheet [data-wpick="10"]')).toContainText('0 jobs that day');
  await page.locator('#sheet [data-close]').first().click();
  expect((await plCalls(page)).length).toBe(1);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await who(page).locator('.person.unassigned .job', { hasText: 'Apt 707' }).getByRole('button', { name: 'Assign' }).click();
  // Fiche ouverte sur la reponse fraiche : Pionah a maintenant Apt 505 ce jour-la.
  await expect(page.locator('#sheet [data-wpick="10"]')).toContainText('1 job that day');
  expect((await plCalls(page)).length).toBe(2);
});

test('semaine de plus de 60 s, relecture en echec : pas de choix, Reconnect, anciennes donnees gardees', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { ...WEEK1(), once: true }, { match: 'action=mgr.planning', status: 0, body: {}, fail: true }],
    { email: true, clock: NOW });
  await chip(page, '2026-10-10').click();
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 707');
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await who(page).locator('.person.unassigned .job', { hasText: 'Apt 707' }).getByRole('button', { name: 'Assign' }).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(who(page).locator('.person.unassigned')).toContainText('Apt 707');
  expect((await writes(page, 'assignCleaner')).length).toBe(0);
});
