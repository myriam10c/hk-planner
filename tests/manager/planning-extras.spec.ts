import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, planningBody, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';

test('Add extra : prix obligatoire, une seule creation au double clic, sans auteur', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=addExtraCleaning', status: 200, body: OK, delay: 300 }], { email: true, hash: HASH, clock: PNOW });
  await page.getByRole('button', { name: 'Add extra' }).click();
  const sh = page.locator('#sheet');
  await expect(sh.locator('h2')).toHaveText('Add an extra cleaning');
  await expect(sh.locator('#xDate')).toHaveValue('2026-10-09');
  await sh.locator('#xListing').selectOption('L8');
  await sh.locator('#xDate').fill('2026-10-10');
  await sh.locator('#xLabel').selectOption('Mid-stay');
  await sh.getByRole('button', { name: 'Create extra' }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('Price billed is required.');
  await sh.locator('#xPrice').fill('200');
  await sh.locator('#xRate').fill('100');
  await sh.locator('#xWho').selectOption('10');
  await sh.locator('#xNotes').fill('Late checkout');
  await sh.getByRole('button', { name: 'Create extra' }).dblclick();
  await expect(page.locator('#toast')).toContainText('Extra cleaning added for Apt 808 · Tower H on Sat 10');
  const w = await writes(page, 'addExtraCleaning');
  expect(w.length).toBe(1);
  expect(noIdem(w)).toEqual([{
    listing_id: 'L8', cleaning_date: '2026-10-10', label: 'Mid-stay', guest_name: null,
    price_billed: 200, cleaner_price: 100, notes: 'Late checkout', assigned_cleaner_id: 10,
  }]);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[0].created_by).toBeUndefined();
});

test('Edit extra puis Delete', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(),
    { match: 'action=updateExtraCleaning', status: 200, body: OK },
    { match: 'action=deleteExtraCleaning', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Edit extra' }).click();
  await expect(sh.locator('h2')).toHaveText('Edit extra cleaning');
  await expect(sh.locator('#xPrice')).toHaveValue('250');
  await expect(sh.locator('#xWho')).toHaveCount(0);
  await sh.locator('#xPrice').fill('300');
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Extra cleaning saved for Apt 808 · Tower H');
  expect(noIdem(await writes(page, 'updateExtraCleaning'))).toEqual([{
    id: 31, listing_id: 'L8', cleaning_date: '2026-10-09', label: 'Deep clean', guest_name: 'Owner',
    price_billed: 300, cleaner_price: 120, notes: 'Bring the steamer',
  }]);
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  await sh.getByRole('button', { name: 'Edit extra' }).click();
  await sh.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sh.locator('h2')).toHaveText('Delete this extra cleaning?');
  await sh.getByRole('button', { name: 'Delete extra' }).click();
  await expect(page.locator('#toast')).toContainText('Extra cleaning deleted');
  expect(noIdem(await writes(page, 'deleteExtraCleaning'))).toEqual([{ id: 31 }]);
});

test('Edit extra : l extra disparu au rechargement, Save n en cree pas un nouveau', async ({ page }, info) => {
  const gone = planningBody();
  gone.jobs = gone.jobs.filter((j: any) => j.key !== 'extra_2026-10-09_mabc');
  await bootMgr(page, [me(MANAGER), { ...PLAN(), once: true }, { ...PLAN(), once: true }, PLAN(gone),
    { match: 'action=setDone', status: 200, body: OK },
    { match: 'action=addExtraCleaning', status: 200, body: OK },
    { match: 'action=updateExtraCleaning', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  const mobile = isMobile(info);
  // Un geste sur un autre menage laisse un toast Undo.
  await openJob(page, mobile, '2026-10-09_Di Fox', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#toast')).toContainText('marked done');
  // Edition de l extra ouverte, puis l Undo recharge une semaine sans cet extra.
  await openJob(page, mobile, 'extra_2026-10-09_mabc', '2026-10-09');
  await sh.getByRole('button', { name: 'Edit extra' }).click();
  await expect(sh.locator('h2')).toHaveText('Edit extra cleaning');
  await page.locator('#toast [data-undo]').dispatchEvent('click');
  await expect.poll(async () => (await fetchLog(page)).filter((l: any) => l.url.includes('action=mgr.planning')).length).toBe(3);
  await expect(page.locator('.pj[data-job="extra_2026-10-09_mabc"]')).toHaveCount(0);
  await sh.locator('#xPrice').fill('300');
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('This cleaning is no longer on the planning.');
  expect(await writes(page, 'addExtraCleaning')).toEqual([]);
  expect(await writes(page, 'updateExtraCleaning')).toEqual([]);
});

test('Add extra : reponse 500 puis reessai, meme cle (ecriture peut-etre faite)', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), PLAN(),
    { match: 'action=addExtraCleaning', status: 500, body: { error: 'Internal error' }, once: true },
    { match: 'action=addExtraCleaning', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  await page.getByRole('button', { name: 'Add extra' }).click();
  const sh = page.locator('#sheet');
  await sh.locator('#xListing').selectOption('L8');
  await sh.locator('#xDate').fill('2026-10-10');
  await sh.locator('#xPrice').fill('200');
  await sh.getByRole('button', { name: 'Create extra' }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('Internal error');
  await sh.getByRole('button', { name: 'Create extra' }).click();
  await expect(page.locator('#toast')).toContainText('Extra cleaning added for Apt 808 · Tower H on Sat 10');
  const w = await writes(page, 'addExtraCleaning');
  expect(w.length).toBe(2);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[1].idem).toBe(w[0].idem);
});

// ---------- Revue finale (F4) : Semax (role maintenance) ----------
const SEMAX = { ...MANAGER, id: 7, name: 'Semax', role: 'maintenance', email: 'semax@example.com' };
function semaxBody() {
  const b = planningBody();
  for (const j of b.jobs) if (j.extra) { j.extra.priceBilled = null; j.extra.cleanerPrice = null; }
  return b;
}

test('F4 : Semax, fiche d un menage sans lien Apartment sheet ni prix de l extra', async ({ page }, info) => {
  await bootMgr(page, [me(SEMAX), PLAN(semaxBody())], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  const sh = page.locator('#sheet');
  await expect(sh).toContainText('Deep clean');
  await expect(sh.getByRole('link', { name: 'Apartment sheet' })).toHaveCount(0);
  await expect(sh).not.toContainText('Price billed');
  await expect(sh).not.toContainText('Cleaner rate');
});

test('F4 : Semax modifie un extra sans prix : champs de prix caches, aucun prix envoye', async ({ page }, info) => {
  await bootMgr(page, [me(SEMAX), PLAN(semaxBody()), { match: 'action=updateExtraCleaning', status: 200, body: OK }],
    { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Edit extra' }).click();
  await expect(sh.locator('h2')).toHaveText('Edit extra cleaning');
  await expect(sh.locator('#xPrice')).toHaveCount(0);
  await expect(sh.locator('#xRate')).toHaveCount(0);
  await sh.locator('#xNotes').fill('Bring the vacuum');
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Extra cleaning saved for Apt 808 · Tower H');
  expect(noIdem(await writes(page, 'updateExtraCleaning'))).toEqual([{
    id: 31, listing_id: 'L8', cleaning_date: '2026-10-09', label: 'Deep clean', guest_name: 'Owner', notes: 'Bring the vacuum',
  }]);
});

test('F4 : un manager garde le lien Apartment sheet', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  await expect(page.locator('#sheet').getByRole('link', { name: 'Apartment sheet' })).toBeVisible();
  await expect(page.locator('#sheet')).toContainText('Price billed');
});
