import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW } from './fixtures';
import { ACT_OK, detailBody, detailTsk, listBody } from './problem-fixtures';

const ROUTES = () => [
  me(MANAGER),
  { match: 'action=mgr.problems', status: 200, body: listBody() },
  { match: 'ref=TSK-13', status: 200, body: detailTsk() },
  { match: 'action=mgr.problem.get', status: 200, body: detailBody() },
  { match: 'action=mgr.problem.act', status: 200, body: ACT_OK() },
];
const acts = async (page: any) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problem.act')).map((l) => JSON.parse(l.body));

test('clavier : j/k et fleches, Entree, Echap, A, S, C avec Undo, / pour chercher', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-desktop', 'clavier : ordinateur');
  await bootMgr(page, ROUTES(), { email: true, clock: NOW, hash: '#/problems' });
  const rows = page.locator('.prow');
  await expect(rows).toHaveCount(3);
  await page.keyboard.press('j');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('j');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press('k');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('Enter');
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('a');
  await expect(sheet.getByRole('heading', { name: 'Assign MNT-429' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await expect(sheet.getByRole('heading', { name: 'Schedule MNT-429' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await acts(page)).map((a) => a.verb)).toEqual(['close', 'reopen']);
  await page.keyboard.press('/');
  await expect(page.locator('#pSearch')).toBeFocused();
  await page.keyboard.type('cas');
  await page.waitForTimeout(400);
  expect((await acts(page)).length).toBe(2);
});

test('clavier dans la fiche ouverte : C ferme ce probleme-la', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-desktop', 'clavier : ordinateur');
  await bootMgr(page, ROUTES(), { email: true, clock: NOW, hash: '#/problems' });
  await page.locator('.prow').nth(1).click();
  await expect(page.locator('#sheet').getByRole('heading', { name: 'AC not cooling' })).toBeVisible();
  await page.locator('#sheet .sheet-h').click();
  // Choix Assign ouvert depuis la fiche : C, A et S ne font rien.
  await page.locator('#sheet [data-pact="assign"]').click();
  await expect(page.locator('#sheet').getByRole('heading', { name: 'Assign TSK-13' })).toBeVisible();
  await page.locator('#sheet .sheet-h').click();
  for (const k of ['c', 's', 'a']) await page.keyboard.press(k);
  await page.waitForTimeout(300);
  await expect(page.locator('#sheet').getByRole('heading', { name: 'Assign TSK-13' })).toBeVisible();
  expect((await acts(page)).length).toBe(0);
  await page.locator('#sheet [data-pact="back"]').click();
  await expect(page.locator('#sheet').getByRole('heading', { name: 'AC not cooling' })).toBeVisible();
  await page.locator('#sheet .sheet-h').click();
  await page.keyboard.press('c');
  await expect(page.locator('#toast')).toContainText('TSK-13 closed');
  expect((await acts(page)).map((a) => [a.ref, a.verb])).toEqual([['TSK-13', 'close']]);
});

async function swipe(page: any, nth: number, dx: number, o: { startX?: number; tap?: boolean; dy?: number } = {}) {
  await page.locator('.prow').nth(nth).evaluate((el: Element, a: any) => {
    const r = el.getBoundingClientRect();
    const x0 = a.startX ?? r.left + r.width / 2;
    const y0 = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
    }));
    ev('pointerdown', x0, y0);
    for (let i = 1; i <= 6; i++) ev('pointermove', x0 + (a.dx * i) / 6, y0 + ((a.dy || 0) * i) / 6);
    ev('pointerup', x0 + a.dx, y0 + (a.dy || 0));
    if (a.tap) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x0 + a.dx, clientY: y0 }));
  }, { dx, ...o });
}

test('glisser : gauche ferme avec Undo, droite ouvre Assign ; court, vertical ou depuis le bord : rien', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-mobile', 'glisser : telephone');
  await bootMgr(page, ROUTES(), { email: true, clock: NOW, hash: '#/problems' });
  await expect(page.locator('.prow')).toHaveCount(3);
  const intent = await page.evaluate(async () => {
    const m = await import('/manager/ui/swipe.js');
    return [m.swipeIntent(-100, -80, 200, 390), m.swipeIntent(-100, 10, 10, 390), m.swipeIntent(-40, 0, 200, 390), m.swipeIntent(-100, 10, 200, 390), m.swipeIntent(100, 10, 200, 390)];
  });
  expect(intent).toEqual([null, null, null, 'close', 'assign']);
  await swipe(page, 0, -40);
  await swipe(page, 0, -150, { startX: 10 });
  await swipe(page, 0, -120, { dy: 200 });
  expect((await acts(page)).length).toBe(0);
  await swipe(page, 0, -150, { tap: true });
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await acts(page)).map((a) => a.verb)).toEqual(['close', 'reopen']);
  await swipe(page, 1, 150, { tap: true });
  await expect(page.locator('#sheet').getByRole('heading', { name: 'Assign TSK-13' })).toBeVisible();
  expect((await acts(page)).length).toBe(2);
});
