import { test, expect, type Page } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { lookMetrics } from './look';
import { NOW, todayBody } from './fixtures';
import { IDEM, noIdem } from './planning-fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const OK = { status: 'success' };
const ANN = '2026-10-09_Ann Lee'; // Apt 308 : arrivee bloquee, menage sans personne
const CY = '2026-10-09_Cy Doe';   // Apt 103 : arrivee a risque, Faiza dessus
const LU = '2026-10-09_Lu Mo';    // Apt 909 : menage sans arrivee

function assignedBody() {
  const b = todayBody();
  b.who.jobs[0] = { ...b.who.jobs[0], assigned: [4], serviceType: 'CHC', tone: 'warn', word: 'Not started' };
  b.who.unassigned = ['2026-10-09_Lu Mo'];
  b.who.people[0].keys = ['2026-10-09_Cy Doe', '2026-10-09_Ann Lee'];
  return b;
}
// Deux menages sans cleaner, dans l'ordre de la liste : Apt 308 (arrivee de 15:00), puis
// Apt 909 (No guest today), qui n'est plus attendu chez Elite.
function twoNoneBody(generatedAt = '2026-10-09T07:00:00.000Z') {
  const b = todayBody({ generatedAt });
  b.who.jobs[1] = { ...b.who.jobs[1], tone: 'bad', word: 'Unassigned' };
  return b;
}
// Le menage key relu avec ids dessus.
function withAssigned(b: any, key: string, ids: number[]) {
  const j = b.who.jobs.find((x: any) => x.key === key);
  Object.assign(j, { assigned: ids, serviceType: 'CHC', tone: 'idle', word: 'Not started' });
  return b;
}

// Le choix s'ouvre dans la carte (lot 4a, tache 4) : « Assign someone » de la carte bloquee,
// le disque d'une carte, ou Assign cleaner / Reassign d'une fiche.
const assign308 = (page: Page) => page.locator('.td-blocked').getByRole('button', { name: 'Assign someone' });
const cardOpen = (page: Page, id: string) => page.locator('[data-td-open="' + id + '"]');
const who = (page: Page, id: string) => page.locator('[data-td-who="' + id + '"]');
const cardOf = (page: Page, id: string) => page.locator('.td-card', { has: page.locator('[data-td-open="' + id + '"]') });
const choice = (page: Page) => page.locator('.td-pick');
const tile = (page: Page, pid: string) => page.locator('.td-pick [data-td-pick="' + pid + '"]');
const filterBtn = (page: Page, v: string) => page.locator('[data-td-filter="' + v + '"]:visible');
const writes = async (page: Page, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=' + action)).map((l) => JSON.parse(l.body));
const todayCalls = async (page: Page) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length;
// Chaque ecriture de Today porte sa cle d'idempotence (createGestures), jamais d'auteur.
const keyed = (rows: any[]) => {
  for (const r of rows) { expect(r.idem).toMatch(IDEM); expect(r).not.toHaveProperty('actor'); expect(r).not.toHaveProperty('author'); }
  return noIdem(rows);
};

test('Assign depuis Today : assignCleaner en mode set, sans actor, Today recharge', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=assignCleaner', status: 200, body: OK }, TODAY(assignedBody())], { email: true, clock: NOW });
  await assign308(page).click();
  // Le choix sous la carte, jamais une feuille.
  const pick = cardOf(page, ANN).locator('.td-pick');
  await expect(pick.getByText('Who cleans it?')).toBeVisible();
  await expect(pick).toHaveAttribute('aria-label', 'Who cleans Apt 308 · Binghatti Lavender?');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(pick.locator('[data-td-pick]')).toHaveText([/Faiza\s*1 job$/, /Pionah\s*0 jobs$/, /Elite Cleaning\s*0 jobs$/]);
  await expect(pick.locator('[data-td-pick="4"]')).toHaveAttribute('data-key', ANN);
  await expect(pick.locator('[data-td-pick="4"] .td-disc')).toHaveText('F');
  await expect(pick.locator('[aria-current]')).toHaveCount(0);
  await pick.locator('[data-td-pick="4"]').click();
  await expect(page.locator('#toast')).toContainText('Apt 308 · Binghatti Lavender assigned to Faiza');
  expect(keyed(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: '2026-10-09_Ann Lee', cleaner_ids: [4], mode: 'set', service_type: 'CHC' },
  ]);
  await expect(page.locator('.td-blocked')).toContainText('Apt 308');
  await expect(page.locator('.td-blocked')).not.toContainText('No cleaner assigned');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length).toBe(2);
  // Plus aucun menage sans cleaner (Apt 909 est attendu chez Elite) : rien ne s'ouvre.
  await expect(choice(page)).toHaveCount(0);
});

// Revue finale (M1) : arrivee bloquee dont le menage d'avant est un autre jour, sans personne.
// La ligne de la cause du proxy porte Assign someone, qui ouvre le choix dans la carte ; la tuile
// ecrit sur ce menage d'avant (prevKey), meme ecriture qu'ailleurs.
test('carte bloquee, menage d un autre jour sans personne : Assign someone sur la cause, ecriture sur prevKey', async ({ page }) => {
  const body = todayBody();
  body.arrivals.rows[3] = { ...body.arrivals.rows[3], tone: 'bad', word: 'Blocked', cause: 'No cleaner assigned. The 08/10 checkout.' };
  await bootMgr(page, [me(MANAGER), TODAY(body), { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  // Bouton Location pose avant le premier toucher (il pousse la page : un clic pendant ce decalage se perd).
  await expect(page.locator('#main > [data-loc-pill]')).toBeVisible();
  const b = page.locator('.td-blocked', { hasText: 'Apt 805' });
  const line = b.locator('.td-why li');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText('No cleaner assigned. The 08/10 checkout.');
  const btn = line.getByRole('button', { name: 'Assign someone' });
  await expect(btn).toHaveAttribute('data-td-who', 'arr:6');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  const pick = b.locator('.td-pick');
  await expect(pick).toHaveAttribute('aria-label', 'Who cleans Apt 805 · Azizi Riviera 39?');
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(pick.locator('[data-td-pick="12"]')).toHaveAttribute('data-key', '2026-10-08_Ed Gu');
  await pick.locator('[data-td-pick="12"]').click();
  await expect(page.locator('#toast')).toContainText('Apt 805 · Azizi Riviera 39 assigned to Elite Cleaning');
  expect(keyed(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: '2026-10-08_Ed Gu', cleaner_ids: [12], mode: 'set', service_type: 'CHC' },
  ]);
});

test('double clic sur la personne : une seule ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 400 }], { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '10').dblclick();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('refus du serveur (conge) : message tel quel dans le choix, tuiles rendues', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 409, body: { error: 'Faiza is on approved leave on 2026-10-09' } }], { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '4').click();
  const pick = cardOf(page, ANN).locator('.td-pick');
  await expect(pick.getByRole('alert')).toHaveText('Faiza is on approved leave on 2026-10-09');
  await expect(tile(page, '4')).toBeEnabled();
  await expect(tile(page, '10')).toBeEnabled();
  await expect(choice(page)).toHaveCount(1);
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
});

test('Reassign depuis une fiche d arrivee garde le type de service', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  await cardOpen(page, CY).click();
  await page.locator('#sheet').getByRole('button', { name: 'Reassign' }).click();
  // La fiche se ferme, le choix s'ouvre dans la carte ; Faiza, seule sur le menage, est marquee.
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  const pick = cardOf(page, CY).locator('.td-pick');
  await expect(pick.locator('[data-td-pick="4"]')).toHaveAttribute('aria-current', 'true');
  await expect(pick.locator('[aria-current]')).toHaveCount(1);
  await pick.locator('[data-td-pick="10"]').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect(keyed(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: '2026-10-09_Cy Doe', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
  ]);
});

test('Mark done depuis une arrivee, puis Undo : setDone true puis false, sans actor', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await cardOpen(page, CY).click();
  await page.locator('#sheet').getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva marked done');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'setDone')).length).toBe(2);
  const done = await writes(page, 'setDone');
  expect(keyed(done)).toEqual([
    { key: '2026-10-09_Cy Doe', done: true }, { key: '2026-10-09_Cy Doe', done: false },
  ]);
  expect(done[0].idem).not.toBe(done[1].idem);
});

test('Undo done depuis une arrivee deja prete', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await cardOpen(page, 'arr:8').click();
  await page.locator('#sheet').getByRole('button', { name: 'Undo done' }).click();
  await expect(page.locator('#toast')).toContainText('back to not done');
  expect(keyed(await writes(page, 'setDone'))).toEqual([{ key: '2026-10-05_Fa Ho', done: false }]);
});

test('ecriture lente, choix ferme puis une fiche, refus 409 : toast, pas d erreur dans la fiche', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 409, body: { error: 'Faiza is on approved leave on 2026-10-09' }, delay: 600 }], { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '4').click();
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(choice(page)).toHaveCount(0);
  await cardOpen(page, CY).click();
  await expect(page.locator('#sheet').getByRole('heading', { name: /Apt 103/ })).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Faiza is on approved leave on 2026-10-09');
  await expect(page.locator('#sheet .sheet-err')).toHaveCount(0);
  await expect(choice(page)).toHaveCount(0);
});

test('ecriture lente, choix ferme puis une fiche, succes : la fiche reste ouverte', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 600 }], { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '4').click();
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await cardOpen(page, CY).click();
  await expect(page.locator('#toast')).toContainText('assigned to Faiza');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#sheet').getByRole('heading', { name: /Apt 103/ })).toBeVisible();
});

test('tap pendant une ecriture : toast Saving, wait a second', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 800 }, { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '4').click();
  // Tuiles desactivees pendant l'ecriture.
  await expect(tile(page, '10')).toBeDisabled();
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-done', '2026-10-09_Cy Doe'); b.setAttribute('data-val', '1'); b.id = 'fake2';
    document.body.appendChild(b);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#toast')).toContainText('Saving, wait a second.');
  expect((await writes(page, 'setDone')).length).toBe(0);
  // Le disque d'une autre carte n'ouvre aucun second choix pendant l'ecriture.
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.innerHTML = ''; });
  await who(page, LU).click();
  await expect(page.locator('#toast')).toContainText('Saving, wait a second.');
  await expect(choice(page)).toHaveCount(1);
  await expect(cardOf(page, LU).locator('.td-pick')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('assigned to Faiza');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('Assign du jour, Undo : cle neuve pour l Undo, liste d avant remise', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  const w = await writes(page, 'assignCleaner');
  expect(keyed(w)).toEqual([
    { reservation_key: '2026-10-09_Ann Lee', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
    { reservation_key: '2026-10-09_Ann Lee', cleaner_ids: [], mode: 'set', service_type: 'CHC' },
  ]);
  expect(w[0].idem).not.toBe(w[1].idem);
});

test('Assign du jour, reseau coupe puis meme geste : la meme cle est reprise', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 0, body: {}, fail: true, once: true },
    { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '10').click();
  await expect(choice(page).getByRole('alert')).toHaveText('No connection. Try again.');
  await tile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  const w = await writes(page, 'assignCleaner');
  expect(w.length).toBe(2);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[1].idem).toBe(w[0].idem);
});

// ---------- Choix dans la carte et enchainement (lot 4a, tache 4) ----------
test('enchaînement : après une affectation, la carte suivante sans cleaner s ouvre', async ({ page }) => {
  const after = withAssigned(twoNoneBody('2026-10-09T07:00:30.000Z'), ANN, [4]);
  await bootMgr(page, [me(MANAGER), { ...TODAY(twoNoneBody()), once: true }, { match: 'action=assignCleaner', status: 200, body: OK }, TODAY(after)],
    { email: true, clock: NOW });
  await assign308(page).click();
  await tile(page, '4').click();
  await expect(page.locator('#toast')).toContainText('Apt 308 · Binghatti Lavender assigned to Faiza');
  // Choix du logement suivant sans cleaner, sur les donnees relues : ouvert, dans le champ, focus sur sa premiere tuile.
  const next = cardOf(page, LU).locator('.td-pick');
  await expect(next).toBeVisible();
  await expect(choice(page)).toHaveCount(1);
  await expect(next.locator('[data-td-pick]').first()).toBeFocused();
  await expect(who(page, LU)).toHaveAttribute('aria-expanded', 'true');
  await expect(next).toBeInViewport();
  await expect(page.locator('.td-blocked')).toContainText('Cleaner: Faiza');
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: ANN, cleaner_ids: [4], mode: 'set', service_type: 'CHC' },
  ]);
});

test('après une réaffectation, rien ne s ouvre', async ({ page }) => {
  const after = withAssigned(twoNoneBody('2026-10-09T07:01:01.000Z'), CY, [10]);
  await bootMgr(page, [me(MANAGER), { ...TODAY(twoNoneBody()), once: true }, { match: 'action=assignCleaner', status: 200, body: OK }, TODAY(after)],
    { email: true, clock: NOW });
  await who(page, CY).click();
  await expect(cardOf(page, CY).locator('.td-pick')).toBeVisible();
  await tile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva assigned to Pionah');
  // Today relu (as of 11:01) : Apt 308 et Apt 909 restent sans cleaner, mais aucun choix ne s'ouvre.
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  await expect(choice(page)).toHaveCount(0);
  await expect(who(page, CY)).toHaveAttribute('aria-expanded', 'false');
  await expect(assign308(page)).toBeVisible();
});

test('filtre sans cleaner : la carte affectée sort, la suivante s ouvre, puis le filtre s enlève', async ({ page }) => {
  const one = withAssigned(twoNoneBody('2026-10-09T07:00:20.000Z'), ANN, [4]);
  const both = withAssigned(withAssigned(twoNoneBody('2026-10-09T07:00:40.000Z'), ANN, [4]), LU, [10]);
  await bootMgr(page, [me(MANAGER), { ...TODAY(twoNoneBody()), once: true }, { match: 'action=assignCleaner', status: 200, body: OK },
    { ...TODAY(one), once: true }, TODAY(both)], { email: true, clock: NOW });
  await filterBtn(page, 'none').click();
  await expect(filterBtn(page, 'none')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-td-open]')).toHaveCount(2);
  await assign308(page).click();
  await tile(page, '4').click();
  await expect(page.locator('#toast')).toContainText('Apt 308 · Binghatti Lavender assigned to Faiza');
  // Apt 308 a quitte la liste filtree ; le choix d'Apt 909 est ouvert, le filtre reste.
  await expect(cardOpen(page, ANN)).toHaveCount(0);
  await expect(cardOf(page, LU).locator('.td-pick')).toBeVisible();
  await expect(filterBtn(page, 'none')).toHaveAttribute('aria-pressed', 'true');
  await expect(cardOf(page, LU).locator('[data-td-pick]').first()).toBeFocused();
  await tile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Apt 909 · Bloom Height assigned to Pionah');
  // Plus aucun logement sans cleaner : le filtre s'enleve, toute la journee revient, aucun choix.
  await expect(page.locator('[data-td-filter="none"]')).toHaveCount(0);
  await expect(page.locator('[data-td-open]')).toHaveCount(5);
  await expect(choice(page)).toHaveCount(0);
  expect(noIdem(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: ANN, cleaner_ids: [4], mode: 'set', service_type: 'CHC' },
    { reservation_key: LU, cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
  ]);
});

// Filtre sur une personne : enleve quand elle n'a plus de logement apres une relecture.
test('filtre sur une personne : enlevé quand elle n a plus de logement', async ({ page }) => {
  const after = withAssigned(todayBody({ generatedAt: '2026-10-09T07:00:30.000Z' }), CY, [10]);
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=assignCleaner', status: 200, body: OK }, TODAY(after)],
    { email: true, clock: NOW });
  await filterBtn(page, '4').click();
  await expect(filterBtn(page, '4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-td-open]')).toHaveCount(1);
  await who(page, CY).click();
  await tile(page, '10').click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva assigned to Pionah');
  await expect(page.locator('[data-td-filter][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('[data-td-open]')).toHaveCount(5);
  // Une reaffectation : aucun choix ne s'ouvre.
  await expect(choice(page)).toHaveCount(0);
});

// Filtre sur une personne qui n'est plus affectable (absente de la liste relue) : sa puce
// disparait, le filtre s'enleve, meme si elle reste sur un menage du jour.
test('filtre sur une personne qui n est plus affectable : enlevé a la relecture', async ({ page }) => {
  const later = todayBody({ generatedAt: '2026-10-09T07:01:01.000Z' });
  later.assignable = later.assignable.filter((p: any) => p.id !== 4);
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, TODAY(later)], { email: true, clock: NOW });
  await filterBtn(page, '4').click();
  await expect(page.locator('[data-td-open]')).toHaveCount(1);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 61_000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.asof')).toContainText('as of 11:01');
  await expect(page.locator('[data-td-filter][aria-pressed="true"]')).toHaveCount(0);
  // Sa puce (telephone) disparait ; le panneau du grand ecran la garde, elle a encore un menage.
  await expect(page.locator('.td-fchip[data-td-filter="4"]')).toHaveCount(0);
  await expect(page.locator('[data-td-open]')).toHaveCount(5);
  expect(await todayCalls(page)).toBe(2);
});

test('Assign cleaner depuis une fiche : la fiche se ferme, le choix s ouvre dans la carte', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(twoNoneBody())], { email: true, clock: NOW });
  await cardOpen(page, LU).click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await sheet.getByRole('button', { name: 'Assign cleaner' }).click();
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  const pick = cardOf(page, LU).locator('.td-pick');
  await expect(pick).toBeVisible();
  await expect(pick).toBeInViewport();
  await expect(pick.locator('[data-td-pick]').first()).toBeFocused();
  await expect(pick.locator('[aria-current]')).toHaveCount(0);
  await expect(choice(page)).toHaveCount(1);
});

test('Échap referme le choix et rend le focus au disque', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await who(page, LU).click();
  await expect(who(page, LU)).toHaveAttribute('aria-expanded', 'true');
  await expect(cardOf(page, LU).locator('[data-td-pick]').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(choice(page)).toHaveCount(0);
  await expect(who(page, LU)).toBeFocused();
  await expect(who(page, LU)).toHaveAttribute('aria-expanded', 'false');
  // Une fiche ouverte par-dessus : Echap ferme la fiche seule, le choix reste.
  await who(page, LU).click();
  await cardOpen(page, CY).click();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(cardOf(page, LU).locator('.td-pick')).toBeVisible();
  // Un seul choix a la fois ; Cancel le ferme et rend le focus au bouton qui l'a ouvert.
  await assign308(page).click();
  await expect(choice(page)).toHaveCount(1);
  await expect(cardOf(page, ANN).locator('.td-pick')).toBeVisible();
  await choice(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(choice(page)).toHaveCount(0);
  await expect(assign308(page)).toBeFocused();
  // Le disque du choix ouvert le referme.
  await who(page, LU).click();
  await expect(choice(page)).toHaveCount(1);
  await who(page, LU).click();
  await expect(choice(page)).toHaveCount(0);
});

test('lecture seule : aucun disque cliquable', async ({ page }) => {
  const cache = { v: 1, owner: 'u-test', savedAt: Date.parse('2026-10-09T05:42:00Z'), data: twoNoneBody('2026-10-09T05:42:00.000Z') };
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache });
  await expect(page.getByRole('heading', { level: 1, name: 'Friday', exact: true })).toBeVisible();
  await expect(page.locator('.banner.warn')).toContainText('No connection. Try again.');
  await expect(page.locator('[data-td-who]')).toHaveCount(0);
  await expect(page.locator('[data-td-pick]')).toHaveCount(0);
  await expect(cardOf(page, LU).locator('.td-whostatic')).toBeVisible();
  // La fiche : Reconnect to make changes., aucun bouton d'ecriture.
  await cardOpen(page, LU).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByText('Reconnect to make changes.')).toBeVisible();
  await expect(sheet.getByRole('button', { name: /Assign cleaner|Reassign|Mark done/ })).toHaveCount(0);
  // Defense en profondeur : une tuile injectee est refusee, aucune ecriture, aucun choix.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-td-pick', '4'); b.setAttribute('data-key', '2026-10-09_Lu Mo'); b.id = 'fakepick';
    document.getElementById('main')!.appendChild(b);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#toast')).toContainText('Reconnect to make changes.');
  expect(await writes(page, 'assignCleaner')).toHaveLength(0);
  await expect(choice(page)).toHaveCount(0);
});

// Le choix ouvert tient les seuils de Today : cibles de 44 px, texte de 14 px, contraste,
// aucun defilement horizontal, dans la carte bloquee (avec un refus affiche) et dans une carte.
const WIDTHS = [320, 390, 768, 960, 1280, 1440];
for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('choix ouvert lisible (' + scheme + ')', async ({ page }) => {
      await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 409, body: { error: 'Faiza is on approved leave on 2026-10-09' } }],
        { email: true, clock: NOW });
      await assign308(page).click();
      await tile(page, '4').click();
      await expect(choice(page).getByRole('alert')).toBeVisible();
      for (const at of ['Apt 308', 'Apt 103']) {
        if (at === 'Apt 103') {
          await who(page, CY).click();
          await expect(cardOf(page, CY).locator('[aria-current="true"]')).toBeVisible();
        }
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          const m = await lookMetrics(page);
          const where = at + ', ' + width + ' px';
          expect(m.overflowX, 'défilement horizontal, ' + where).toBeLessThanOrEqual(0);
          expect(m.smallTop, 'cibles, ' + where).toEqual([]);
          expect(m.tinyTop, 'texte sous 14 px, ' + where).toEqual([]);
          expect(m.lowTop, 'contraste, ' + where).toEqual([]);
        }
      }
      expect(await todayCalls(page)).toBe(1);
    });
  });
}
