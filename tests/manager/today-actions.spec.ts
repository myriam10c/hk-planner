import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW, todayBody } from './fixtures';
import { IDEM, noIdem } from './planning-fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const OK = { status: 'success' };

function assignedBody() {
  const b = todayBody();
  b.who.jobs[0] = { ...b.who.jobs[0], assigned: [4], serviceType: 'CHC', tone: 'warn', word: 'Not started' };
  b.who.unassigned = ['2026-10-09_Lu Mo'];
  b.who.people[0].keys = ['2026-10-09_Cy Doe', '2026-10-09_Ann Lee'];
  return b;
}
const writes = async (page: any, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=' + action)).map((l) => JSON.parse(l.body));
// Chaque ecriture de Today porte sa cle d'idempotence (createGestures), jamais d'auteur.
const keyed = (rows: any[]) => {
  for (const r of rows) { expect(r.idem).toMatch(IDEM); expect(r).not.toHaveProperty('actor'); expect(r).not.toHaveProperty('author'); }
  return noIdem(rows);
};

test('Assign depuis Today : assignCleaner en mode set, sans actor, Today recharge', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=assignCleaner', status: 200, body: OK }, TODAY(assignedBody())], { email: true, clock: NOW });
  const row = page.locator('.person.unassigned .job', { hasText: 'Apt 308' });
  await row.getByRole('button', { name: 'Assign' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Assign a cleaner' })).toBeVisible();
  await expect(sheet.locator('[data-pick="4"]')).toContainText('1 job today');
  await sheet.locator('[data-pick="4"]').click();
  await expect(page.locator('#toast')).toContainText('Apt 308 · Binghatti Lavender assigned to Faiza');
  expect(keyed(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: '2026-10-09_Ann Lee', cleaner_ids: [4], mode: 'set', service_type: 'CHC' },
  ]);
  await expect(page.locator('.person.unassigned')).not.toContainText('Apt 308');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length).toBe(2);
});

test('double clic sur la personne : une seule ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 400 }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="10"]').dblclick();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('refus du serveur (conge) : message tel quel dans la fiche, boutons rendus', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 409, body: { error: 'Faiza is on approved leave on 2026-10-09' } }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="4"]').click();
  await expect(page.locator('#sheet .sheet-err')).toHaveText('Faiza is on approved leave on 2026-10-09');
  await expect(page.locator('#sheet [data-pick="4"]')).toBeEnabled();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
});

test('Reassign depuis une fiche d arrivee garde le type de service', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  await page.locator('.arr', { hasText: 'Apt 103' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Reassign' }).click();
  await expect(page.locator('#sheet [data-pick="4"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('#sheet [data-pick="10"]').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect(keyed(await writes(page, 'assignCleaner'))).toEqual([
    { reservation_key: '2026-10-09_Cy Doe', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
  ]);
});

test('Mark done depuis une arrivee, puis Undo : setDone true puis false, sans actor', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await page.locator('.arr', { hasText: 'Apt 103' }).click();
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
  await page.locator('.arr', { hasText: 'Apt 404' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Undo done' }).click();
  await expect(page.locator('#toast')).toContainText('back to not done');
  expect(keyed(await writes(page, 'setDone'))).toEqual([{ key: '2026-10-05_Fa Ho', done: false }]);
});

test('ecriture lente, fiche fermee puis autre fiche, refus 409 : toast, pas d erreur dans l autre fiche', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 409, body: { error: 'Faiza is on approved leave on 2026-10-09' }, delay: 600 }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="4"]').click();
  await page.locator('#sheet [data-close]').first().click();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('.arr', { hasText: 'Apt 103' }).click();
  await expect(page.locator('#sheet').getByRole('heading', { name: /Apt 103/ })).toBeVisible();
  await expect(page.locator('#toast')).toContainText('Faiza is on approved leave on 2026-10-09');
  await expect(page.locator('#sheet .sheet-err')).toHaveCount(0);
});

test('ecriture lente, fiche fermee puis autre fiche, succes : l autre fiche reste ouverte', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 600 }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="4"]').click();
  await page.locator('#sheet [data-close]').first().click();
  await page.locator('.arr', { hasText: 'Apt 103' }).click();
  await expect(page.locator('#toast')).toContainText('assigned to Faiza');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#sheet').getByRole('heading', { name: /Apt 103/ })).toBeVisible();
});

test('tap pendant une ecriture : toast Saving, wait a second', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 800 }, { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="4"]').click();
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-done', '2026-10-09_Cy Doe'); b.setAttribute('data-val', '1'); b.id = 'fake2';
    document.body.appendChild(b);
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(page.locator('#toast')).toContainText('Saving, wait a second.');
  expect((await writes(page, 'setDone')).length).toBe(0);
});

test('Assign du jour, Undo : cle neuve pour l Undo, liste d avant remise', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="10"]').click();
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
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="10"]').click();
  await expect(page.locator('#sheet .sheet-err')).toHaveText('No connection. Try again.');
  await page.locator('#sheet [data-pick="10"]').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  const w = await writes(page, 'assignCleaner');
  expect(w.length).toBe(2);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[1].idem).toBe(w[0].idem);
});
