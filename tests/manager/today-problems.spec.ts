import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW, todayBody } from './fixtures';
import { ACT_OK, detailBody } from './problem-fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const DETAIL = (body: any = detailBody()) => ({ match: 'action=mgr.problem.get', status: 200, body });
const ACT = (status = 200, body: any = ACT_OK(), delay = 0) => ({ match: 'action=mgr.problem.act', status, body, delay });
const acts = async (page: any) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problem.act')).map((l) => JSON.parse(l.body));
const openGas = (page: any) => page.locator('.prob', { hasText: 'Gas not working' }).click();

test('fiche d un probleme depuis Today : photos, commentaires, historique, copie TSK, gestes', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL()], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.locator('.sub')).toHaveText('MNT-429 · Maintenance · Apt 308 · Binghatti Lavender');
  await expect(sheet.getByRole('img', { name: 'Reported' })).toBeVisible();
  await expect(sheet).toContainText('Called the gas company.');
  await expect(sheet).toContainText('Reported by Faiza');
  await expect(sheet).toContainText('Also tracked as team task TSK-17 (Semax). It closes with this ticket.');
  for (const n of ['Assign', 'Schedule', 'Close problem']) await expect(sheet.getByRole('button', { name: n, exact: true })).toBeVisible();
  expect((await fetchLog(page)).find((l) => l.url.includes('action=mgr.problem.get'))!.url).toContain('ref=MNT-429');
});

test('Assign depuis la fiche : une cle par geste, sans actor, Today et fiche recharges', async ({ page }) => {
  const assigned = detailBody({ problem: { ...detailBody().problem, status: 'assigned', assignee: { kind: 'member', id: 7, name: 'Semax' } } });
  await bootMgr(page, [me(MANAGER), TODAY(), { ...DETAIL(), once: true }, ACT(), DETAIL(assigned)], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(sheet.getByRole('heading', { name: 'Assign MNT-429' })).toBeVisible();
  await expect(sheet.locator('[data-pact="vendor"]')).toContainText('CoolFix');
  await sheet.locator('[data-pact="pick"][data-id="7"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-429 assigned to Semax');
  const a = await acts(page);
  expect(a).toEqual([{ ref: 'MNT-429', verb: 'assign', memberId: 7, idem: expect.stringMatching(/^mgr-[A-Za-z0-9]{8,}$/) }]);
  await expect(sheet.locator('.pfacts')).toContainText('Semax');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length).toBe(2);
});

test('Close avec note puis Undo : close puis reopen, deux cles differentes', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), ACT()], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.locator('#pComment').fill('Replaced the valve');
  await sheet.getByRole('button', { name: 'Close problem' }).click();
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#toast')).toContainText('MNT-429 reopened');
  const a = await acts(page);
  expect(a.map((x) => [x.verb, x.note])).toEqual([['close', 'Replaced the valve'], ['reopen', undefined]]);
  expect(a[0].idem).not.toBe(a[1].idem);
});

test('double clic sur Close problem : une seule ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), ACT(200, ACT_OK(), 400)], { email: true, clock: NOW });
  await openGas(page);
  await page.locator('#sheet').getByRole('button', { name: 'Close problem' }).dblclick();
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  expect((await acts(page)).length).toBe(1);
});

test('refus du serveur : message tel quel dans la fiche, boutons rendus', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), ACT(409, { error: 'MNT-429 is already closed.' })], { email: true, clock: NOW });
  await openGas(page);
  await page.locator('#sheet').getByRole('button', { name: 'Close problem' }).click();
  await expect(page.locator('#sheet .sheet-err')).toHaveText('MNT-429 is already closed.');
  await expect(page.locator('#sheet').getByRole('button', { name: 'Close problem' })).toBeEnabled();
});

test('fiche indisponible : message et Retry dans la fiche', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { ...DETAIL(), status: 500, body: { error: 'Internal error' }, once: true }, DETAIL()], { email: true, clock: NOW });
  await openGas(page);
  await expect(page.locator('#sheet .sheet-err')).toHaveText('Internal error');
  await page.locator('#sheet').getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#sheet').getByRole('button', { name: 'Assign', exact: true })).toBeVisible();
});

test('Today en cache (reseau coupe) : fiche en lecture seule, aucun geste', async ({ page }) => {
  const cache = { v: 1, owner: 'u-test', savedAt: Date.parse('2026-10-09T05:42:00Z'), data: todayBody() };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 0, body: null, fail: true }, DETAIL()], { email: true, clock: NOW, cache });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.locator('.ro-note')).toHaveText('Reconnect to make changes.');
  await expect(sheet.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  await expect(sheet.locator('#pComment')).toHaveCount(0);
});

test('reessai apres un delai depasse : meme cle pour le meme geste, nouvelle cle ensuite', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), { ...ACT(200, ACT_OK(), 1500), once: true }, ACT()],
    { email: true, clock: NOW, timeoutMs: 400 });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.locator('#pComment').fill('Replaced the valve');
  await sheet.getByRole('button', { name: 'Close problem' }).click();
  await expect(sheet.locator('.sheet-err')).toHaveText('HK Planner is taking too long to answer. Try again.');
  await sheet.getByRole('button', { name: 'Close problem' }).click();
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#toast')).toContainText('MNT-429 reopened');
  const a = await acts(page);
  expect(a.map((x) => x.verb)).toEqual(['close', 'close', 'reopen']);
  expect(a[1].idem).toBe(a[0].idem);
  expect(a[2].idem).not.toBe(a[0].idem);
});

test('reessai apres coupure reseau ou 409 Still processing : meme cle ; autre texte ou autre erreur : cle neuve', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(),
    { ...ACT(), fail: true, once: true }, { ...ACT(409, { error: 'Still processing. Retry.' }), once: true },
    { ...ACT(500, { error: 'Internal error' }), once: true }, ACT()], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  const comment = sheet.getByRole('button', { name: 'Comment', exact: true });
  await sheet.locator('#pComment').fill('Called again');
  await comment.click();
  await expect(sheet.locator('.sheet-err')).toHaveText('No connection. Try again.');
  await comment.click();
  await expect(sheet.locator('.sheet-err')).toHaveText('Still processing. Retry.');
  await comment.click();
  await expect(sheet.locator('.sheet-err')).toHaveText('Internal error');
  await comment.click();
  await expect(page.locator('#toast')).toContainText('Comment added');
  const a = await acts(page);
  expect(a.map((x) => x.text)).toEqual(['Called again', 'Called again', 'Called again', 'Called again']);
  expect([a[1].idem, a[2].idem]).toEqual([a[0].idem, a[0].idem]);
  expect(a[3].idem).not.toBe(a[0].idem);
});

test('reessai avec un autre texte apres une coupure : cle neuve', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), { ...ACT(), fail: true, once: true }, ACT()], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.locator('#pComment').fill('Called again');
  await sheet.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(sheet.locator('.sheet-err')).toHaveText('No connection. Try again.');
  await sheet.locator('#pComment').fill('Called the gas company again');
  await sheet.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Comment added');
  const a = await acts(page);
  expect(a.length).toBe(2);
  expect(a[1].idem).not.toBe(a[0].idem);
});

test('copie Hermes deja terminee : pas de phrase « It closes with this ticket. »', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(detailBody({ mirror: { ref: 'TSK-17', status: 'done', assignee: 'Semax' } }))],
    { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.locator('.note')).toHaveText('Also tracked as team task TSK-17 (Semax), already closed.');
});
