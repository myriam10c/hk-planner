import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';

const m = (o: any) => ({
  phone: '', email: null, active: true, hasPin: false, hasAccount: false, isOwner: false, system: false, color: '#4caf50', ...o,
});
const TEAM = {
  members: [
    m({ id: 8, name: 'Walter', role: 'manager', color: '#e94560', email: 'walter@example.com', hasAccount: true, isOwner: true }),
    m({ id: 3, name: 'Amir', role: 'cleaner', email: 'amir@example.com', hasAccount: true, hasPin: true, phone: '+971500000003' }),
    m({ id: 4, name: 'Faiza', role: 'cleaner', hasPin: true }),
    m({ id: 5, name: 'Elite Cleaning', role: 'subcontractor' }),
    m({ id: 6, name: 'Joe', role: 'maintenance', email: 'joe@example.com', hasAccount: true }),
    m({ id: 7, name: 'Old Bob', role: 'cleaner', active: false, email: 'bob@example.com', hasAccount: true }),
  ],
};
const THE_READ: FakeRoute = { match: 'action=mgr.team', status: 200, body: TEAM };

const boot = (page: any, extra: FakeRoute[] = [], read: FakeRoute[] = [THE_READ]) =>
  bootMgr(page, [me(MANAGER), ...extra, ...read], { email: true, hash: '#/more/team' });

const posts = async (page: any, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action) && l.body).map((l) => JSON.parse(l.body));

test('liste : groupes par role, point de couleur, badges, Inactive replie', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Team', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  for (const h of ['Managers', 'Cleaners', 'Subcontractors', 'Maintenance']) {
    await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
  }
  const walter = page.locator('main [data-member="8"]');
  await expect(walter).toContainText('Walter');
  await expect(walter).toContainText('walter@example.com');
  await expect(walter.locator('.tm-badge')).toHaveText(['Account', 'Owner']);
  await expect(walter.locator('.tm-dot')).toHaveCSS('background-color', 'rgb(233, 69, 96)');
  const amir = page.locator('main [data-member="3"]');
  await expect(amir.locator('.tm-badge')).toHaveText(['PIN', 'Account']);
  const faiza = page.locator('main [data-member="4"]');
  await expect(faiza).toContainText('No email');
  await expect(faiza.locator('.tm-badge')).toHaveText(['PIN']);
  await expect(page.locator('main [data-member="5"] .tm-badge')).toHaveCount(0);
  // Inactifs : groupe replie, lecture seule.
  const inactive = page.locator('main details[data-inactive]');
  await expect(inactive.locator('summary')).toContainText('Inactive (1)');
  await expect(page.locator('main [data-inactive-row="7"]')).toBeHidden();
  await inactive.locator('summary').click();
  await expect(page.locator('main [data-inactive-row="7"]')).toBeVisible();
  await expect(page.locator('main [data-inactive-row="7"]')).toContainText('Old Bob');
  await expect(page.locator('main button[data-member="7"]')).toHaveCount(0);
});

test('lecture en echec : message et Retry', async ({ page }) => {
  await boot(page, [], [
    { match: 'action=mgr.team', status: 500, body: { error: 'Internal error' }, once: true },
    THE_READ,
  ]);
  await expect(page.locator('main').getByText('Internal error')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main [data-member="3"]')).toBeVisible();
});

test('ajout avec email : poste inviteCleaner avec le bon corps, puis recharge', async ({ page }) => {
  const added = { ...TEAM, members: [...TEAM.members, m({ id: 20, name: 'Nadia', role: 'cleaner', email: 'nadia@example.com', hasAccount: true })] };
  await boot(page, [{ match: 'action=inviteCleaner', status: 200, body: { status: 'success', id: 20, mode: 'invite' } }],
    [{ match: 'action=mgr.team', status: 200, body: TEAM, once: true }, { match: 'action=mgr.team', status: 200, body: added }]);
  await page.getByRole('button', { name: 'Add member' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Add member' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Add with PIN only' })).toBeVisible();
  await sheet.getByLabel('Name').fill('Nadia');
  await sheet.getByLabel('Email (optional)').fill('Nadia@Example.com');
  await sheet.getByLabel('Phone').fill('+971500000020');
  await sheet.getByLabel('Role').selectOption('cleaner');
  await expect(sheet.getByRole('button', { name: 'Add and invite' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Add and invite' }).click();
  await expect(page.locator('main [data-member="20"]')).toBeVisible();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const calls = await posts(page, 'inviteCleaner');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ name: 'Nadia', email: 'nadia@example.com', phone: '+971500000020', role: 'cleaner' });
  expect(calls[0].color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(await posts(page, 'saveCleaner')).toHaveLength(0);
});

test('ajout sans email : PIN obligatoire (3 a 8 chiffres), poste saveCleaner', async ({ page }) => {
  await boot(page, [{ match: 'action=saveCleaner', status: 200, body: { status: 'success', id: 21 } }]);
  await page.getByRole('button', { name: 'Add member' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill('Karim');
  await sheet.getByRole('button', { name: 'Add with PIN only' }).click();
  await expect(sheet.getByRole('alert')).toContainText('PIN');
  expect(await posts(page, 'saveCleaner')).toHaveLength(0);
  await sheet.getByLabel('PIN').fill('12');
  await sheet.getByRole('button', { name: 'Add with PIN only' }).click();
  await expect(sheet.getByRole('alert')).toContainText('3 to 8 digits');
  expect(await posts(page, 'saveCleaner')).toHaveLength(0);
  await sheet.getByLabel('PIN').fill('4821');
  await sheet.getByRole('button', { name: 'Add with PIN only' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const calls = await posts(page, 'saveCleaner');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ name: 'Karim', pin: '4821', role: 'cleaner' });
  expect(calls[0].id).toBeUndefined();
  expect(await posts(page, 'inviteCleaner')).toHaveLength(0);
});

test('modifier le role : saveCleaner avec id et role subcontractor, sans PIN', async ({ page }) => {
  await boot(page, [{ match: 'action=saveCleaner', status: 200, body: { status: 'success', id: 4 } }]);
  await page.locator('main [data-member="4"]').click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Faiza' })).toBeVisible();
  await expect(sheet.getByLabel('Name')).toHaveValue('Faiza');
  await expect(sheet.getByLabel('Role')).toHaveValue('cleaner');
  await sheet.getByLabel('Role').selectOption('subcontractor');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const calls = await posts(page, 'saveCleaner');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ id: 4, name: 'Faiza', role: 'subcontractor' });
  expect(calls[0].pin).toBeUndefined();
  expect(calls[0].email).toBeUndefined();
});

test('renvoyer l invitation : inviteCleaner avec id et email du membre', async ({ page }) => {
  await boot(page, [{ match: 'action=inviteCleaner', status: 200, body: { status: 'success', id: 3, mode: 'reset' } }]);
  await page.locator('main [data-member="3"]').click();
  await expect(page.locator('#sheet').getByRole('button', { name: 'Resend invite' })).toBeVisible();
  await page.locator('#sheet').getByRole('button', { name: 'Resend invite' }).click();
  await expect(page.locator('#toast')).toContainText('amir@example.com');
  const calls = await posts(page, 'inviteCleaner');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ id: 3, email: 'amir@example.com', name: 'Amir', role: 'cleaner' });
  // Sans email : pas de bouton.
  await page.locator('main [data-member="4"]').click();
  await expect(page.locator('#sheet').getByRole('button', { name: 'Resend invite' })).toHaveCount(0);
});

test('desactiver : confirmation, deleteCleaner {id}, membre retire apres succes', async ({ page }) => {
  const after = { members: TEAM.members.map((x) => (x.id === 4 ? { ...x, active: false } : x)) };
  await boot(page, [{ match: 'action=deleteCleaner', status: 200, body: { status: 'success' } }],
    [{ match: 'action=mgr.team', status: 200, body: TEAM, once: true }, { match: 'action=mgr.team', status: 200, body: after }]);
  await page.locator('main [data-member="4"]').click();
  await page.locator('#sheet').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.locator('#sheet')).toContainText('Deactivate Faiza? They will be signed out.');
  expect(await posts(page, 'deleteCleaner')).toHaveLength(0);
  // Cancel revient au formulaire sans rien poster.
  await page.locator('#sheet').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#sheet').getByLabel('Name')).toBeVisible();
  expect(await posts(page, 'deleteCleaner')).toHaveLength(0);
  await page.locator('#sheet').getByRole('button', { name: 'Deactivate' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('main button[data-member="4"]')).toHaveCount(0);
  await expect(page.locator('main [data-inactive-row="4"]')).toHaveCount(1);
  expect(await posts(page, 'deleteCleaner')).toEqual([{ id: 4 }]);
});

test('desactiver refuse (403) : le membre reste, le message du serveur s affiche', async ({ page }) => {
  await boot(page, [{ match: 'action=deleteCleaner', status: 403, body: { error: 'Only managers can do this.' } }]);
  await page.locator('main [data-member="4"]').click();
  await page.locator('#sheet').getByRole('button', { name: 'Deactivate' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('#sheet').getByRole('alert')).toHaveText('Only managers can do this.');
  await expect(page.locator('main button[data-member="4"]')).toHaveCount(1);
  expect(await posts(page, 'deleteCleaner')).toEqual([{ id: 4 }]);
});

test('on ne peut pas se desactiver soi-meme', async ({ page }) => {
  await boot(page);
  await page.locator('main [data-member="8"]').click();
  await expect(page.locator('#sheet').getByLabel('Name')).toHaveValue('Walter');
  await expect(page.locator('#sheet').getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
});

test('aucun defilement horizontal et cibles de 44 px (telephone, panneau ouvert)', async ({ page }) => {
  await boot(page);
  await expect(page.locator('main [data-member="3"]')).toBeVisible();
  let s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  for (const el of await page.locator('main button, main a, main summary').all()) {
    if (!(await el.isVisible())) continue;
    expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await page.locator('main [data-member="3"]').click();
  await expect(page.locator('#sheet.on')).toHaveCount(1);
  s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  for (const el of await page.locator('#sheet button, #sheet input, #sheet select').all()) {
    if (!(await el.isVisible())) continue;
    expect((await el.boundingBox())!.height, await el.evaluate((n) => n.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(43.99);
  }
});

test('ajout avec email et PIN : invite puis saveCleaner avec l id renvoye', async ({ page }) => {
  await boot(page, [
    { match: 'action=inviteCleaner', status: 200, body: { status: 'success', id: 22, mode: 'invite' } },
    { match: 'action=saveCleaner', status: 200, body: { status: 'success', id: 22 } },
  ]);
  await page.getByRole('button', { name: 'Add member' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill('Layla');
  await sheet.getByLabel('Email (optional)').fill('layla@example.com');
  await sheet.getByLabel('PIN').fill('4821');
  await sheet.getByRole('button', { name: 'Add and invite' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await posts(page, 'inviteCleaner')).toHaveLength(1);
  const saves = await posts(page, 'saveCleaner');
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({ id: 22, name: 'Layla', pin: '4821', role: 'cleaner' });
});

test('ajout avec email et PIN : le PIN refuse est dit, le panneau reste', async ({ page }) => {
  await boot(page, [
    { match: 'action=inviteCleaner', status: 200, body: { status: 'success', id: 22, mode: 'invite' } },
    { match: 'action=saveCleaner', status: 400, body: { error: 'pin must be 3-8 digits' } },
  ]);
  await page.getByRole('button', { name: 'Add member' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill('Layla');
  await sheet.getByLabel('Email (optional)').fill('layla@example.com');
  await sheet.getByLabel('PIN').fill('4821');
  await sheet.getByRole('button', { name: 'Add and invite' }).click();
  await expect(sheet.getByRole('alert')).toContainText('Member invited, but the PIN was not saved: pin must be 3-8 digits');
});

test('rechargement apres ecriture en echec : toast et carte Retry', async ({ page }) => {
  await boot(page, [{ match: 'action=saveCleaner', status: 200, body: { status: 'success', id: 4 } }],
    [{ match: 'action=mgr.team', status: 200, body: TEAM, once: true }, { match: 'action=mgr.team', status: 500, body: { error: 'Internal error' }, once: true }, THE_READ]);
  await page.locator('main [data-member="4"]').click();
  await page.locator('#sheet').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#toast')).toContainText('Saved, but the list could not be refreshed.');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main [data-member="4"]')).toBeVisible();
});
