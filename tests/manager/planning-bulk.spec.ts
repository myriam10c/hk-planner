import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, PLAN, planningBody, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const boot = (page: Page, routes: any[], body: any = planningBody()) =>
  bootMgr(page, [me(MANAGER), PLAN(body), ...routes], { email: true, hash: HASH, clock: PNOW });

const card = (page: Page, key: string) => page.locator('.pj[data-job="' + key + '"]');
const bar = (page: Page) => page.locator('.pl-bulk');
const selectBtn = (page: Page) => page.locator('[data-select]');

// Sur telephone, une carte n'est visible que sur son jour.
// force : une carte aria-disabled recoit quand meme le toucher (Playwright attendrait sinon).
async function pick(page: Page, mobile: boolean, key: string, day: string, force = false) {
  if (mobile) await page.locator('.pl-strip [data-day="' + day + '"]').click();
  await card(page, key).click({ force });
}

test('Select : mode selection, la carte se coche sans ouvrir la fiche, Done selecting vide tout', async ({ page }, info) => {
  await boot(page, []);
  await expect(selectBtn(page)).toHaveText('Select');
  // Nom stable, sans aria-pressed ; le compte vit dans un noeud aria-live persistant.
  await expect(selectBtn(page)).not.toHaveAttribute('aria-pressed', /.*/);
  const live = page.locator('.pl-live[aria-live="polite"]');
  await expect(live).toHaveCount(1);
  await live.evaluate((el) => { (el as any).__mark = 1; });
  await selectBtn(page).click();
  await expect(selectBtn(page)).toHaveText('Done selecting');
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await expect(card(page, '2026-10-09_Bo Ray')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(bar(page)).toContainText('1 selected');
  await card(page, '2026-10-09_Cy Doe').click();
  await expect(bar(page)).toContainText('2 selected');
  await expect(live).toHaveText('2 selected');
  expect(await live.evaluate((el) => (el as any).__mark)).toBe(1);
  await card(page, '2026-10-09_Cy Doe').click();
  await expect(card(page, '2026-10-09_Cy Doe')).toHaveAttribute('aria-pressed', 'false');
  await expect(bar(page)).toContainText('1 selected');
  await selectBtn(page).click();
  await expect(selectBtn(page)).toHaveText('Select');
  await expect(bar(page)).toHaveCount(0);
  await expect(card(page, '2026-10-09_Bo Ray')).not.toHaveAttribute('aria-pressed', /.*/);
  // Hors mode selection, la carte rouvre la fiche.
  await card(page, '2026-10-09_Bo Ray').click();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
});

test('Clear dans la barre : vide la selection, reste en mode selection', async ({ page }, info) => {
  await boot(page, []);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await bar(page).getByRole('button', { name: 'Clear' }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(selectBtn(page)).toHaveText('Done selecting');
  await expect(card(page, '2026-10-09_Bo Ray')).toHaveAttribute('aria-pressed', 'false');
});

test('menage fait ou annule : jamais selectionnable', async ({ page }, info) => {
  await boot(page, []);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06', true);
  // Sur telephone, chaque carte se verifie sur son jour.
  await expect(card(page, '2026-10-06_Ann Lee')).toHaveAttribute('aria-disabled', 'true');
  await expect(card(page, '2026-10-06_Ann Lee')).not.toHaveAttribute('aria-pressed', /.*/);
  await pick(page, isMobile(info), '2026-10-07_Ed Gu', '2026-10-07', true);
  await expect(card(page, '2026-10-07_Ed Gu')).toHaveAttribute('aria-disabled', 'true');
  await expect(card(page, '2026-10-07_Ed Gu')).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
});

test('Select all unassigned : le jour sur telephone, la semaine sur ordinateur', async ({ page }, info) => {
  const body = planningBody();
  const base = body.jobs.find((j: any) => j.key === '2026-10-09_Cy Doe');
  body.jobs.push({ ...base, key: '2026-10-08_Hu Ix', listingId: 'L7', apt: '707', bld: 'Tower G', date: '2026-10-08', guest: 'Hu Ix' });
  await boot(page, [], body);
  await expect(page.getByRole('button', { name: 'Select all unassigned' })).toHaveCount(0);
  await selectBtn(page).click();
  await page.getByRole('button', { name: 'Select all unassigned' }).click();
  const mobile = isMobile(info);
  await expect(bar(page)).toContainText((mobile ? 2 : 3) + ' selected');
  for (const k of ['2026-10-09_Bo Ray', '2026-10-09_Cy Doe']) await expect(card(page, k)).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, '2026-10-09_Di Fox')).toHaveAttribute('aria-pressed', 'false');
  if (mobile) await page.locator('.pl-strip [data-day="2026-10-08"]').click();
  await expect(card(page, '2026-10-08_Hu Ix')).toHaveAttribute('aria-pressed', mobile ? 'false' : 'true');
});

test('Assign groupe : conge grise, une ecriture par menage avec sa cle, toast et Undo par menage', async ({ page }, info) => {
  const body = planningBody();
  body.jobs.find((j: any) => j.key === '2026-10-10_Fa Ho').serviceType = 'MSC';
  await boot(page, [{ match: 'action=assignCleaner', status: 200, body: OK }], body);
  const mobile = isMobile(info);
  await selectBtn(page).click();
  await pick(page, mobile, '2026-10-09_Bo Ray', '2026-10-09');
  await pick(page, mobile, '2026-10-10_Fa Ho', '2026-10-10');
  await expect(bar(page)).toContainText('2 selected');
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  const sh = page.locator('#sheet');
  await expect(sh).toHaveAttribute('aria-hidden', 'false');
  await expect(sh.locator('h2')).toHaveText('Assign 2 cleanings');
  const faiza = sh.locator('[data-pa="bulk-pick"][data-id="4"]');
  await expect(faiza).toBeDisabled();
  await expect(faiza).toContainText('On leave Sat 10');
  await expect(sh.locator('[data-pa="bulk-pick"][data-id="10"]')).toBeEnabled();
  await sh.locator('[data-pa="bulk-pick"][data-id="10"]').click();
  await expect(page.locator('#toast')).toContainText('2 cleanings assigned to Pionah');
  await expect(sh).toHaveAttribute('aria-hidden', 'true');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([
    { reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-10_Fa Ho', cleaner_ids: [10], mode: 'set', service_type: 'MSC' },
  ]);
  for (const b of w) { expect(b.idem).toMatch(IDEM); expect(b.actor).toBeUndefined(); }
  expect(w[0].idem).not.toBe(w[1].idem);
  // Sortie du mode selection, semaine rechargee.
  await expect(selectBtn(page)).toHaveText('Select');
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(async () => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).length).toBe(2);
  // Undo : chaque menage revient a sa propre liste d'avant.
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(4);
  const all = await writes(page, 'assignCleaner');
  expect(noIdem(all.slice(2))).toEqual([
    { reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-10_Fa Ho', cleaner_ids: [12], mode: 'set', service_type: 'MSC' },
  ]);
  expect(new Set(all.map((b) => b.idem)).size).toBe(4);
  await expect(page.locator('#toast')).toContainText('2 cleanings back to their previous assignment');
});

test('echec partiel (refus 4xx) : Not assigned avec le message du serveur, le lot continue, Undo seulement pour les reussis', async ({ page }, info) => {
  await boot(page, [
    { match: 'action=assignCleaner', status: 200, body: OK, once: true },
    { match: 'action=assignCleaner', status: 409, body: { error: 'Cleaner already busy' }, once: true },
    { match: 'action=assignCleaner', status: 200, body: OK },
  ]);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await card(page, '2026-10-09_Cy Doe').click();
  await card(page, '2026-10-09_Di Fox').click();
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pa="bulk-pick"][data-id="12"]').click();
  await expect(page.locator('#toast')).toContainText(
    '2 of 3 assigned to Elite Cleaning. Not assigned: Apt 909 · Bloom Height (Cleaner already busy).');
  expect((await writes(page, 'assignCleaner')).map((b) => b.reservation_key))
    .toEqual(['2026-10-09_Bo Ray', '2026-10-09_Cy Doe', '2026-10-09_Di Fox']);
  // Le menage refuse reste seul coche, en mode selection.
  await expect(selectBtn(page)).toHaveText('Done selecting');
  await expect(bar(page)).toContainText('1 selected');
  await expect(card(page, '2026-10-09_Cy Doe')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, '2026-10-09_Bo Ray')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(5);
  const all = await writes(page, 'assignCleaner');
  expect(noIdem(all.slice(3))).toEqual([
    { reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-09_Di Fox', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
  ]);
});

test('changement de semaine : selection et mode effaces', async ({ page }, info) => {
  await boot(page, []);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await expect(bar(page)).toContainText('1 selected');
  await page.locator('[data-week="1"]').click();
  await expect(selectBtn(page)).toHaveText('Select');
  await expect(bar(page)).toHaveCount(0);
  await page.locator('[data-week="-1"]').click();
  await expect(card(page, '2026-10-09_Bo Ray')).toBeVisible();
  await expect(card(page, '2026-10-09_Bo Ray')).not.toHaveAttribute('aria-pressed', /.*/);
});

test('lecture seule (cache perime) : pas de bouton Select', async ({ page }) => {
  const cache = { v: 1, savedAt: PNOW.getTime() - 3600_000, owner: 'u-test', data: planningBody() };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.planning', status: 0, body: {}, fail: true }],
    { email: true, hash: HASH, clock: PNOW, storage: { mgrPlanningCache: JSON.stringify(cache) } });
  await expect(page.locator('main .banner')).toContainText('Data from 10:00');
  await expect(page.locator('.pj').first()).toBeVisible();
  await expect(selectBtn(page)).toHaveCount(0);
});

// Cinq menages sans personne le vendredi 9 (Bo Ray, Cy Doe et trois de plus).
function fiveBody() {
  const body = planningBody();
  const base = body.jobs.find((j: any) => j.key === '2026-10-09_Cy Doe');
  for (const [k, apt] of [['Ja Ke', '701'], ['Li Mu', '702'], ['No Op', '703']]) {
    body.jobs.push({ ...base, key: '2026-10-09_' + k, listingId: 'L' + apt, apt, bld: 'Tower Q', guest: k, tone: 'bad', word: 'Unassigned' });
  }
  return body;
}

test('reseau coupe pendant le lot : progression, arret net, Not confirmed, echecs gardes coches, nouvel essai avec la meme cle', async ({ page }, info) => {
  await boot(page, [
    { match: 'action=assignCleaner', status: 200, body: OK, once: true, delay: 1200 },
    { match: 'action=assignCleaner', status: 0, body: {}, fail: true, once: true, delay: 1200 },
    { match: 'action=assignCleaner', status: 200, body: OK },
  ]);
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await card(page, '2026-10-09_Cy Doe').click();
  await card(page, '2026-10-09_Di Fox').click();
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  const sh = page.locator('#sheet');
  await sh.locator('[data-pa="bulk-pick"][data-id="12"]').click();
  await expect(sh.locator('#bulkProg')).toHaveText('Assigning 1 of 3…');
  await expect(sh.locator('#bulkProg')).toHaveAttribute('role', 'status');
  // Pendant le lot, une carte ne bouge pas.
  await page.evaluate(() => (document.querySelector('.pj[data-job="2026-10-09_Bo Ray"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect(page.locator('#toast')).toContainText('Saving, wait a second.');
  await expect(sh.locator('#bulkProg')).toHaveText('Assigning 2 of 3…');
  await expect(page.locator('#toast')).toContainText(
    '1 of 3 assigned to Elite Cleaning. Not confirmed: Apt 909 · Bloom Height, Apt 805 · Azizi Riviera 39.');
  // Le troisieme n'a pas ete envoye.
  const w = await writes(page, 'assignCleaner');
  expect(w.map((b) => b.reservation_key)).toEqual(['2026-10-09_Bo Ray', '2026-10-09_Cy Doe']);
  await expect(sh).toHaveAttribute('aria-hidden', 'true');
  await expect(selectBtn(page)).toHaveText('Done selecting');
  await expect(bar(page)).toContainText('2 selected');
  await expect(card(page, '2026-10-09_Cy Doe')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, '2026-10-09_Di Fox')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, '2026-10-09_Bo Ray')).toHaveAttribute('aria-pressed', 'false');
  // Nouvel essai : Assign puis un toucher ; Cy Doe reprend sa cle (issue inconnue).
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  await sh.locator('[data-pa="bulk-pick"][data-id="12"]').click();
  await expect(page.locator('#toast')).toContainText('2 cleanings assigned to Elite Cleaning');
  const all = await writes(page, 'assignCleaner');
  expect(all.map((b) => b.reservation_key)).toEqual(['2026-10-09_Bo Ray', '2026-10-09_Cy Doe', '2026-10-09_Cy Doe', '2026-10-09_Di Fox']);
  expect(all[2].idem).toBe(all[1].idem);
  expect(all[3].idem).toMatch(IDEM);
  await expect(selectBtn(page)).toHaveText('Select');
});

test('erreur 5xx : Not confirmed, le lot continue ; au plus trois appartements nommes puis and N more', async ({ page }) => {
  await boot(page, [
    { match: 'action=assignCleaner', status: 502, body: { error: 'Bad gateway' } },
  ], fiveBody());
  await selectBtn(page).click();
  await page.getByRole('button', { name: 'Select all unassigned' }).click();
  await expect(bar(page)).toContainText('5 selected');
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pa="bulk-pick"][data-id="10"]').click();
  await expect(page.locator('#toast')).toHaveText(
    '0 of 5 assigned to Pionah. Not confirmed: Apt 103 · Damac Reva, Apt 909 · Bloom Height, Apt 701 · Tower Q and 2 more.');
  expect((await writes(page, 'assignCleaner')).length).toBe(5);
  await expect(page.locator('#toast [data-undo]')).toHaveCount(0);
  await expect(bar(page)).toContainText('5 selected');
});

test('fiche groupee : avertissement de remplacement, compte du jour ou de la semaine', async ({ page }, info) => {
  await boot(page, []);
  const mobile = isMobile(info);
  await selectBtn(page).click();
  await pick(page, mobile, '2026-10-09_Bo Ray', '2026-10-09');
  await card(page, '2026-10-09_Di Fox').click();
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  const sh = page.locator('#sheet');
  await expect(sh).toContainText('Replaces the current cleaner on 1 cleaning.');
  // Un seul jour : compte de ce jour (Pionah a Di Fox et l'extra le vendredi 9).
  await expect(sh.locator('[data-pa="bulk-pick"][data-id="10"]')).toContainText('2 jobs that day');
  await expect(sh.locator('[data-pa="bulk-pick"][data-id="12"]')).toContainText('0 jobs that day');
  await sh.locator('[data-close]').first().click();
  await pick(page, mobile, '2026-10-10_Fa Ho', '2026-10-10');
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  await expect(sh).toContainText('Replaces the current cleaner on 2 cleanings.');
  await expect(sh.locator('[data-pa="bulk-pick"][data-id="12"]')).toContainText('1 job this week');
});

test('Select all unassigned suit le filtre de personne', async ({ page }, info) => {
  await boot(page, []);
  await page.locator('[data-filter="10"]').click();
  await selectBtn(page).click();
  await page.getByRole('button', { name: 'Select all unassigned' }).click();
  await expect(bar(page)).toHaveCount(0);
  await page.locator('[data-filter="none"]').click();
  await page.getByRole('button', { name: 'Select all unassigned' }).click();
  await expect(bar(page)).toContainText('2 selected');
  await expect(card(page, '2026-10-09_Bo Ray')).toHaveAttribute('aria-pressed', 'true');
});

test('Undo d un lot : une nouvelle selection faite entre-temps reste', async ({ page }, info) => {
  await boot(page, [{ match: 'action=assignCleaner', status: 200, body: OK }]);
  const mobile = isMobile(info);
  await selectBtn(page).click();
  await pick(page, mobile, '2026-10-09_Bo Ray', '2026-10-09');
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pa="bulk-pick"][data-id="10"]').click();
  await expect(page.locator('#toast')).toContainText('1 cleaning assigned to Pionah');
  await expect(selectBtn(page)).toHaveText('Select');
  await selectBtn(page).click();
  await card(page, '2026-10-09_Cy Doe').click();
  await expect(bar(page)).toContainText('1 selected');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  await expect(page.locator('#toast')).toContainText('1 cleaning back to their previous assignment');
  await expect(selectBtn(page)).toHaveText('Done selecting');
  await expect(bar(page)).toContainText('1 selected');
  await expect(card(page, '2026-10-09_Cy Doe')).toHaveAttribute('aria-pressed', 'true');
});

test('clavier : le focus reste sur Select, sur la carte cochee et sur Select all apres le repeint', async ({ page }, info) => {
  await boot(page, []);
  if (isMobile(info)) await page.locator('.pl-strip [data-day="2026-10-09"]').click();
  await selectBtn(page).focus();
  await page.keyboard.press('Enter');
  await expect(selectBtn(page)).toHaveText('Done selecting');
  await expect(selectBtn(page)).toBeFocused();
  await card(page, '2026-10-09_Cy Doe').focus();
  await page.keyboard.press('Enter');
  await expect(card(page, '2026-10-09_Cy Doe')).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, '2026-10-09_Cy Doe')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(card(page, '2026-10-09_Cy Doe')).toHaveAttribute('aria-pressed', 'false');
  await expect(card(page, '2026-10-09_Cy Doe')).toBeFocused();
  const all = page.locator('[data-select-all]');
  await all.focus();
  await page.keyboard.press('Enter');
  await expect(bar(page)).toContainText('2 selected');
  await expect(all).toBeFocused();
});

test('donnees de plus de 60 s : la semaine est relue avant la fiche groupee', async ({ page }, info) => {
  const later = planningBody();
  later.jobs.find((j: any) => j.key === '2026-10-09_Bo Ray').assigned = [12];
  await bootMgr(page, [me(MANAGER), { ...PLAN(), once: true }, PLAN(later)], { email: true, hash: HASH, clock: PNOW });
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  const sh = page.locator('#sheet');
  await expect(sh).toHaveAttribute('aria-hidden', 'false');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).length).toBe(2);
  // La fiche est construite sur la reponse fraiche : Bo Ray a maintenant quelqu'un.
  await expect(sh).toContainText('Replaces the current cleaner on 1 cleaning.');
});

test('donnees de plus de 60 s, relecture en echec : anciennes donnees gardees, aucune fiche, Reconnect', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), { ...PLAN(), once: true }, { match: 'action=mgr.planning', status: 0, body: {}, fail: true }],
    { email: true, hash: HASH, clock: PNOW });
  await selectBtn(page).click();
  await pick(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await bar(page).getByRole('button', { name: 'Assign' }).click();
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(card(page, '2026-10-09_Bo Ray')).toBeVisible();
  expect((await writes(page, 'assignCleaner')).length).toBe(0);
});

test('donnees de plus de 60 s : Assign d un seul menage relit la semaine avant le choix', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  if (isMobile(info)) await page.locator('.pl-strip [data-day="2026-10-09"]').click();
  await card(page, '2026-10-09_Bo Ray').click();
  await page.clock.setFixedTime(new Date(PNOW.getTime() + 61_000));
  await page.locator('#sheet [data-pa="assign"]').click();
  await expect(page.locator('#sheet h2')).toHaveText('Assign');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).length).toBe(2);
});

test('retour sur l onglet : la semaine affichee est relue', async ({ page }) => {
  await boot(page, []);
  await expect(page.locator('.pj').first()).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).length).toBe(2);
});
