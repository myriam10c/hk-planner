import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW } from './fixtures';
import { ACT_OK, detailTask, listBody } from './problem-fixtures';

// Fiche d'une tache d'equipe sur #/tasks (createProblemPanel) : les tests de la fiche
// ouverte depuis Today (avant la phase 2 maintenance) sont repris ici avec des refs TSK.
const LIST = { match: 'action=mgr.problems', status: 200, body: listBody() };
const DETAIL = (body: any = detailTask({ photos: [{ url: 'https://signed.test/v3/p1.jpg', label: 'Reported' }] })) =>
  ({ match: 'action=mgr.problem.get', status: 200, body });
const ACT = (status = 200, body: any = ACT_OK(), delay = 0) => ({ match: 'action=mgr.problem.act', status, body, delay });
const acts = async (page: any) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problem.act')).map((l) => JSON.parse(l.body));
const boot = (page: any, routes: any[], opts: any = {}) =>
  bootMgr(page, [me(MANAGER), LIST, ...routes], { email: true, clock: NOW, hash: '#/tasks', ...opts });
const openGas = async (page: any) => {
  await page.locator('.prow', { hasText: 'Gas not working' }).click();
  await expect(page.locator('#sheet [data-panel="TSK-429"]')).toBeVisible();
};

test('fiche d une tache : photos, commentaires, historique, gestes', async ({ page }) => {
  await boot(page, [DETAIL()]);
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.locator('.sub')).toContainText('TSK-429');
  await expect(sheet.getByRole('img', { name: 'Reported' })).toBeVisible();
  await expect(sheet).toContainText('Called the gas company.');
  await expect(sheet).toContainText('Reported by Faiza');
  for (const n of ['Assign', 'Schedule', 'Close problem']) await expect(sheet.getByRole('button', { name: n, exact: true })).toBeVisible();
  expect((await fetchLog(page)).find((l) => l.url.includes('action=mgr.problem.get'))!.url).toContain('ref=TSK-429');
});

test('note de copie : ouverte ou deja close (rendu de la fiche)', async ({ page }) => {
  await boot(page, [{ ...DETAIL(detailTask({ mirror: { ref: 'TSK-17', status: 'open', assignee: 'Semax' } })), once: true },
    DETAIL(detailTask({ mirror: { ref: 'TSK-17', status: 'done', assignee: 'Semax' } }))]);
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.locator('.note')).toHaveText('Also tracked as team task TSK-17 (Semax). It closes with this ticket.');
  await sheet.locator('[data-close]').first().click();
  await openGas(page);
  await expect(sheet.locator('.note')).toHaveText('Also tracked as team task TSK-17 (Semax), already closed.');
});

test('Assign : une cle par geste, sans actor, liste et fiche relues', async ({ page }) => {
  const assigned = detailTask({ problem: { ...detailTask().problem, status: 'assigned', assignee: { kind: 'member', id: 7, name: 'Semax' } } });
  await boot(page, [{ ...DETAIL(), once: true }, ACT(), DETAIL(assigned)]);
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(sheet.getByRole('heading', { name: 'Assign TSK-429' })).toBeVisible();
  await sheet.locator('[data-pact="pick"][data-id="7"]').click();
  await expect(page.locator('#toast')).toContainText('TSK-429 assigned to Semax');
  const a = await acts(page);
  expect(a).toEqual([{ ref: 'TSK-429', verb: 'assign', memberId: 7, idem: expect.stringMatching(/^mgr-[A-Za-z0-9]{8,}$/) }]);
  await expect(sheet.locator('.pfacts')).toContainText('Semax');
  await expect.poll(async () => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problems')).length).toBeGreaterThanOrEqual(2);
});

test('Close avec note puis Undo : close puis reopen, deux cles differentes', async ({ page }) => {
  await boot(page, [DETAIL(), ACT()]);
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.locator('#pComment').fill('Replaced the valve');
  await sheet.getByRole('button', { name: 'Close problem' }).click();
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#toast')).toContainText('TSK-429 closed');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#toast')).toContainText('TSK-429 reopened');
  const a = await acts(page);
  expect(a.map((x) => [x.verb, x.note])).toEqual([['close', 'Replaced the valve'], ['reopen', undefined]]);
  expect(a[0].idem).not.toBe(a[1].idem);
});

test('double clic sur Close problem : une seule ecriture', async ({ page }) => {
  await boot(page, [DETAIL(), ACT(200, ACT_OK(), 400)]);
  await openGas(page);
  await page.locator('#sheet').getByRole('button', { name: 'Close problem' }).dblclick();
  await expect(page.locator('#toast')).toContainText('TSK-429 closed');
  expect((await acts(page)).length).toBe(1);
});

test('refus du serveur : message tel quel dans la fiche, boutons rendus', async ({ page }) => {
  await boot(page, [DETAIL(), ACT(409, { error: 'TSK-429 is already closed.' })]);
  await openGas(page);
  await page.locator('#sheet').getByRole('button', { name: 'Close problem' }).click();
  await expect(page.locator('#sheet .sheet-err')).toHaveText('TSK-429 is already closed.');
  await expect(page.locator('#sheet').getByRole('button', { name: 'Close problem' })).toBeEnabled();
});

test('fiche indisponible : message et Retry dans la fiche', async ({ page }) => {
  await boot(page, [{ ...DETAIL(), status: 500, body: { error: 'Internal error' }, once: true }, DETAIL()]);
  await page.locator('.prow', { hasText: 'Gas not working' }).click();
  await expect(page.locator('#sheet .sheet-err')).toHaveText('Internal error');
  await page.locator('#sheet').getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#sheet').getByRole('button', { name: 'Assign', exact: true })).toBeVisible();
});

test('liste en cache (reseau coupe) : fiche en lecture seule, aucun geste', async ({ page }) => {
  const cache = JSON.stringify({ v: 1, owner: 'u-test', savedAt: Date.parse('2026-10-09T05:42:00Z'), data: listBody() });
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.problems', status: 0, body: null, fail: true }, DETAIL()],
    { email: true, clock: NOW, hash: '#/tasks', storage: { mgrProblemsCache: cache } });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.locator('.ro-note')).toHaveText('Reconnect to make changes.');
  await expect(sheet.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  await expect(sheet.locator('#pComment')).toHaveCount(0);
});

test('reessai apres un delai depasse : meme cle pour le meme geste, nouvelle cle ensuite', async ({ page }) => {
  await boot(page, [DETAIL(), { ...ACT(200, ACT_OK(), 1500), once: true }, ACT()], { timeoutMs: 400 });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.locator('#pComment').fill('Replaced the valve');
  await sheet.getByRole('button', { name: 'Close problem' }).click();
  await expect(sheet.locator('.sheet-err')).toHaveText('HK Planner is taking too long to answer. Try again.');
  await sheet.getByRole('button', { name: 'Close problem' }).click();
  await expect(page.locator('#toast')).toContainText('TSK-429 closed');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#toast')).toContainText('TSK-429 reopened');
  const a = await acts(page);
  expect(a.map((x) => x.verb)).toEqual(['close', 'close', 'reopen']);
  expect(a[1].idem).toBe(a[0].idem);
  expect(a[2].idem).not.toBe(a[0].idem);
});

test('reessai apres coupure reseau, 409 Still processing ou 5xx : meme cle ; autre texte ou autre erreur : cle neuve', async ({ page }) => {
  await boot(page, [DETAIL(),
    { ...ACT(), fail: true, once: true }, { ...ACT(409, { error: 'Still processing. Retry.' }), once: true },
    { ...ACT(500, { error: 'Internal error' }), once: true }, { ...ACT(409, { error: 'Problem already closed.' }), once: true },
    ACT()]);
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
  await expect(sheet.locator('.sheet-err')).toHaveText('Problem already closed.');
  await comment.click();
  await expect(page.locator('#toast')).toContainText('Comment added');
  const a = await acts(page);
  expect(a.map((x) => x.text)).toEqual(['Called again', 'Called again', 'Called again', 'Called again', 'Called again']);
  expect([a[1].idem, a[2].idem, a[3].idem]).toEqual([a[0].idem, a[0].idem, a[0].idem]);
  expect(a[4].idem).not.toBe(a[0].idem);
});

test('reessai avec un autre texte apres une coupure : cle neuve', async ({ page }) => {
  await boot(page, [DETAIL(), { ...ACT(), fail: true, once: true }, ACT()]);
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
