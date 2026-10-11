import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';
import { OVERVIEW, READ, TEAM_READ, posts, sign } from './hr-fixtures';

// More > HR : vue d'ensemble (meme ordre que renderHRManager de hr.js).
const boot = (page: any, extra: FakeRoute[] = [], reads: FakeRoute[] = [READ], hash = '#/more/hr') =>
  bootMgr(page, [me(MANAGER), ...extra, ...reads, TEAM_READ], { email: true, hash });

test('sections dans l ordre de hr.js, contenus et liens', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'HR and leave', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  const heads = page.locator('main [data-hr-sec] h2');
  await expect(heads).toHaveText(['Pending requests', 'Away today', 'Documents expiring', 'Team', 'Not set up yet', 'Public holidays']);

  const pending = page.locator('main [data-hr-sec="pending"]');
  await expect(pending.locator('.meta')).toHaveText('1');
  await expect(pending).toContainText('Faiza');
  await expect(pending).toContainText('Annual leave · 2026-10-20 to 2026-10-22 · 3 days');
  await expect(pending).toContainText('Family visit');

  const away = page.locator('main [data-hr-sec="away"]');
  await expect(away).toContainText('Amir');
  await expect(away).toContainText('Back on 2026-10-13');

  const docs = page.locator('main [data-hr-sec="docs"] a');
  await expect(docs).toHaveCount(2);
  await expect(docs.nth(0)).toHaveAttribute('href', '#/more/hr/3');
  await expect(docs.nth(0)).toContainText('Residence visa · expires 2026-11-10');
  await expect(docs.nth(0)).toContainText('30 days left');
  await expect(docs.nth(1)).toContainText('Expired 10 days ago');

  const team = page.locator('main [data-hr-sec="team"] a');
  await expect(team).toHaveCount(2);
  await expect(team.nth(0)).toHaveAttribute('href', '#/more/hr/3');
  await expect(team.nth(0)).toContainText('Amir');
  await expect(team.nth(0)).toContainText('Senior cleaner · since 2024-10-01');
  await expect(team.nth(0).locator('.pill')).toHaveText('On leave');
  // 24 mois revolus x 2,5 = 60, moins 20 pris = 40.
  await expect(team.nth(0).locator('[data-balance]')).toHaveText('40');
  await expect(team.nth(1)).toContainText('Faiza');
  await expect(team.nth(1).locator('.pill')).toHaveCount(0);
  await expect(team.nth(1).locator('[data-balance]')).toHaveText('0');

  // Ni sous-traitant, ni inactif, ni personne deja suivie.
  const missing = page.locator('main [data-hr-sec="missing"] a');
  await expect(missing).toHaveCount(2);
  await expect(missing.nth(0)).toContainText('Walter');
  await expect(missing.nth(1)).toContainText('Nadia');
  await expect(missing.nth(1)).toHaveAttribute('href', '#/more/hr/9');

  // Tous les feries a venir, tries, le passe exclu.
  const hol = page.locator('main [data-hr-sec="holidays"] [data-holiday]');
  await expect(hol).toHaveCount(2);
  await expect(hol.nth(0)).toContainText('National Day');
  await expect(hol.nth(0)).toContainText('2026-12-02');
  await expect(hol.nth(1)).toContainText('Eid Al Fitr');
});

test('aucune demande en attente : section masquee', async ({ page }) => {
  await boot(page, [], [{ match: 'action=hrOverview', status: 200, body: { ...OVERVIEW, pending: [] } }]);
  await expect(page.locator('main [data-hr-sec="team"]')).toBeVisible();
  await expect(page.locator('main [data-hr-sec="pending"]')).toHaveCount(0);
  await expect(page.locator('main [data-hr-sec] h2').first()).toHaveText('Away today');
});

test('non proprietaire : pas de decision ni de suppression, Download form reste', async ({ page }) => {
  await boot(page, [], [{ match: 'action=hrOverview', status: 200, body: { ...OVERVIEW, isOwner: false } }]);
  const pending = page.locator('main [data-hr-sec="pending"]');
  await expect(pending).toContainText('Faiza');
  await expect(pending.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(pending.getByRole('button', { name: 'Reject' })).toHaveCount(0);
  await expect(pending.getByRole('button', { name: 'Download form' })).toBeVisible();
  await expect(page.locator('main [data-hr-sec="holidays"] [data-del-holiday]')).toHaveCount(0);
  await expect(page.locator('main [data-hr-sec="holidays"]').getByRole('button', { name: 'Add holiday' })).toBeVisible();
});

test('Approve sans signature : rien n est poste ; Cancel : rien non plus', async ({ page }) => {
  await boot(page, [{ match: 'action=hrDecideLeave', status: 200, body: { status: 'success' } }]);
  await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Approve' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Manager signature to approve' })).toBeVisible();
  await expect(sheet.locator('canvas')).toBeVisible();
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.getByText('Please sign first.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await posts(page, 'hrDecideLeave')).toHaveLength(0);
  // Signer puis effacer revient a ne pas avoir signe.
  await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Approve' }).click();
  await sign(page);
  await sheet.getByRole('button', { name: 'Clear' }).click();
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(sheet.getByText('Please sign first.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await posts(page, 'hrDecideLeave')).toHaveLength(0);
});

test('Approve avec signature : poste manager_signature PNG puis recharge', async ({ page }) => {
  await boot(page, [{ match: 'action=hrDecideLeave', status: 200, body: { status: 'success' } }],
    [{ match: 'action=hrOverview', status: 200, body: OVERVIEW, once: true },
      { match: 'action=hrOverview', status: 200, body: { ...OVERVIEW, pending: [] } }]);
  await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Approve' }).click();
  await sign(page);
  await page.locator('#sheet').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('main [data-hr-sec="pending"]')).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Leave approved');
  const calls = await posts(page, 'hrDecideLeave');
  expect(calls).toHaveLength(1);
  expect(calls[0].id).toBe(41);
  expect(calls[0].decision).toBe('approved');
  expect(calls[0].manager_signature.startsWith('data:image/png;base64,')).toBe(true);
  expect(calls[0].manager_signature.length).toBeLessThanOrEqual(100000);
  expect('note' in calls[0]).toBe(true);
});

test('Reject : note facultative, pas de signature', async ({ page }) => {
  await boot(page, [{ match: 'action=hrDecideLeave', status: 200, body: { status: 'success' } }],
    [{ match: 'action=hrOverview', status: 200, body: OVERVIEW, once: true },
      { match: 'action=hrOverview', status: 200, body: { ...OVERVIEW, pending: [] } }]);
  await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Reject' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.locator('canvas')).toHaveCount(0);
  await sheet.getByLabel('Note (optional)').fill('Peak week');
  await sheet.getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('main [data-hr-sec="pending"]')).toHaveCount(0);
  const calls = await posts(page, 'hrDecideLeave');
  expect(calls).toEqual([{ id: 41, decision: 'rejected', note: 'Peak week' }]);
});

test('refus du serveur (403) : message du serveur sur la carte, rien ne bouge', async ({ page }) => {
  await boot(page, [{ match: 'action=hrDecideLeave', status: 403, body: { error: 'owner auth required' } }]);
  await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Reject' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('#sheet').getByText('owner auth required')).toBeVisible();
  await expect(page.locator('main [data-hr-sec="pending"]')).toContainText('Faiza');
});

test('lecture refusee (403) : message du serveur et Retry', async ({ page }) => {
  await boot(page, [], [{ match: 'action=hrOverview', status: 403, body: { error: 'Manager access required.' }, once: true }, READ]);
  await expect(page.locator('main').getByText('Manager access required.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main [data-hr-sec="team"]')).toBeVisible();
});

test('ajout d un ferie : controle des dates, poste, puis recharge', async ({ page }) => {
  const added = { ...OVERVIEW, holidays: [...OVERVIEW.holidays, { id: 73, holiday_date: '2026-11-30', name: 'Commemoration Day' }] };
  await boot(page, [{ match: 'action=hrSaveHoliday', status: 200, body: { status: 'success' } }],
    [{ match: 'action=hrOverview', status: 200, body: OVERVIEW, once: true }, { match: 'action=hrOverview', status: 200, body: added }]);
  const sec = page.locator('main [data-hr-sec="holidays"]');
  await sec.getByRole('button', { name: 'Add holiday' }).click();
  await expect(sec.getByText('Pick a date and a name.')).toBeVisible();
  await sec.getByLabel('Date').fill('2026-10-01');
  await sec.getByLabel('Name').fill('Too late');
  await sec.getByRole('button', { name: 'Add holiday' }).click();
  await expect(sec.getByText('This date is in the past. Check the year (2026).')).toBeVisible();
  await sec.getByLabel('Date').fill('2028-01-01');
  await sec.getByRole('button', { name: 'Add holiday' }).click();
  await expect(sec.getByText('Too far ahead. Only 2026 and 2027 can be encoded.')).toBeVisible();
  expect(await posts(page, 'hrSaveHoliday')).toHaveLength(0);
  await sec.getByLabel('Date').fill('2026-11-30');
  await sec.getByLabel('Name').fill('Commemoration Day');
  await sec.getByRole('button', { name: 'Add holiday' }).click();
  await expect(page.locator('main [data-hr-sec="holidays"] [data-holiday]').nth(0)).toContainText('Commemoration Day');
  expect(await posts(page, 'hrSaveHoliday')).toEqual([{ holiday_date: '2026-11-30', name: 'Commemoration Day' }]);
});

test('suppression d un ferie (proprietaire) : confirmation puis hrDeleteHoliday', async ({ page }) => {
  const less = { ...OVERVIEW, holidays: OVERVIEW.holidays.filter((h) => h.id !== 71) };
  await boot(page, [{ match: 'action=hrDeleteHoliday', status: 200, body: { status: 'success' } }],
    [{ match: 'action=hrOverview', status: 200, body: OVERVIEW, once: true }, { match: 'action=hrOverview', status: 200, body: less }]);
  await page.locator('main [data-del-holiday="71"]').click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toContainText('National Day');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  expect(await posts(page, 'hrDeleteHoliday')).toHaveLength(0);
  await page.locator('main [data-del-holiday="71"]').click();
  await sheet.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('main [data-hr-sec="holidays"] [data-holiday]')).toHaveCount(1);
  expect(await posts(page, 'hrDeleteHoliday')).toEqual([{ id: 71 }]);
});

test('Download form : hrLeaveForm puis le lien signe dans le meme onglet', async ({ page }) => {
  // Le lien signe sert un PDF en piece jointe : la page le demande et reste sur l'ecran.
  await boot(page, [{ match: 'action=hrLeaveForm', status: 200, body: { status: 'success', url: 'https://signed.test/form-41.pdf' } }]);
  // Apres bootMgr : sa route signed.test (image) passerait sinon avant celle-ci.
  const asked: string[] = [];
  await page.route('https://signed.test/**', (r) => {
    asked.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="leave-form-41.pdf"' }, body: '%PDF-1.4' });
  });
  await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Download form' }).click();
  await expect.poll(() => asked).toContain('https://signed.test/form-41.pdf');
  expect(page.context().pages()).toHaveLength(1);
  expect(page.url()).toContain('#/more/hr');
  await expect(page.locator('main [data-hr-sec="team"]')).toBeVisible();
  const calls = (await fetchLog(page)).filter((l) => l.url.includes('action=hrLeaveForm'));
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain('id=41');
  await expect(page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Download form' })).toBeEnabled();
});

test('Download form en echec : message du serveur sur la carte, aucune navigation', async ({ page }) => {
  await boot(page, [{ match: 'action=hrLeaveForm', status: 500, body: { error: 'failed to build the form, try again' } }]);
  await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Download form' }).click();
  await expect(page.locator('main [data-hr-sec="pending"]').getByText('failed to build the form, try again')).toBeVisible();
  expect(page.url()).toContain('#/more/hr');
  expect(page.context().pages()).toHaveLength(1);
});

test('quitter l ecran : un clic plus tard ne declenche plus rien', async ({ page }) => {
  await boot(page, [{ match: 'action=hrDecideLeave', status: 200, body: { status: 'success' } }]);
  await expect(page.locator('main [data-hr-sec="team"]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/more'; });
  await expect(page.locator('main a.more-row').first()).toBeVisible();
  // Un bouton porteur des memes attributs, injecte dans la page, ne doit rien envoyer.
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-reject', '41');
    b.id = 'ghost';
    b.textContent = 'ghost';
    document.querySelector('main')!.appendChild(b);
  });
  await page.locator('#ghost').click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('sans defilement horizontal, cibles de 44 px (' + scheme + ')', async ({ page }) => {
      await boot(page);
      await expect(page.locator('main [data-hr-sec="holidays"]')).toBeVisible();
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      for (const b of await page.locator('main [data-hr-sec] button, main [data-hr-sec] a').all()) {
        const box = await b.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await page.locator('main [data-hr-sec="pending"]').getByRole('button', { name: 'Approve' }).click();
      await expect(page.locator('#sheet canvas')).toBeVisible();
      const s2 = await noHorizontalScroll(page);
      expect(s2.scrollWidth).toBeLessThanOrEqual(s2.clientWidth);
    });
  });
}

test('identifiant invalide : l apercu RH, jamais une fiche NaN', async ({ page }) => {
  for (const bad of ['abc', '0', '-2', '1.5']) {
    await boot(page, [], [READ], '#/more/hr/' + bad);
    await expect(page.locator('main [data-hr-sec="team"]')).toBeVisible();
    await expect(page.locator('main [data-hr-sec="balances"]')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('NaN');
    expect((await fetchLog(page)).some((l) => l.url.includes('hrGetCompensation'))).toBe(false);
  }
});

test('quitter pendant le chargement de la fiche : rien n est peint par dessus More', async ({ page }) => {
  await boot(page, [], [READ]);
  await expect(page.locator('main [data-hr-sec="team"]')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/more/hr/3'; location.hash = '#/more'; });
  await expect(page.locator('main a.more-row').first()).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.locator('main a.more-row').first()).toBeVisible();
  await expect(page.locator('main [data-hr-sec="balances"]')).toHaveCount(0);
});
