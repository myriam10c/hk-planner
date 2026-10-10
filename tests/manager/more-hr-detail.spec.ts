import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';
import { OVERVIEW, TEAM_READ, emp, req, posts } from './hr-fixtures';

// More > HR : fiche employe (#/more/hr/<cleanerId>), memes sections que renderHRDetail de hr.js.
const AMIR = emp({ cleaner_id: 3, hire_date: '2024-10-01', job_title: 'Senior cleaner', nationality: 'Philippines', notes: 'Keys holder', updated_at: '2026-10-01T08:00:00Z' });
const DETAIL = {
  ...OVERVIEW,
  employees: [AMIR, emp({ cleaner_id: 4, hire_date: '2026-06-01', updated_at: '2026-06-01T08:00:00Z' })],
  taken: { '3': { annual: 20, sick: 2, unpaid: 1 } },
  history: [
    req({ id: 43, cleaner_id: 3, start_date: '2026-03-01', end_date: '2026-03-02', days: 2, status: 'rejected', decided_by: 'Hillal', decided_at: '2026-02-20T10:00:00Z' }),
    req({ id: 42, cleaner_id: 3, start_date: '2026-10-10', end_date: '2026-10-12', days: 3, status: 'approved', reason: 'Wedding', decided_by: 'Hillal', decided_at: '2026-10-01T10:00:00Z' }),
    req({ id: 44, cleaner_id: 3, start_date: '2026-05-01', end_date: '2026-05-01', days: 1, status: 'cancelled' }),
    req({ id: 41, cleaner_id: 4, start_date: '2026-10-20', end_date: '2026-10-22', days: 3, status: 'pending' }),
  ],
  documents: [
    { id: 1, cleaner_id: 3, doc_type: 'visa', doc_number: 'V-123', issue_date: '2024-11-10', expiry_date: '2026-11-10', note: null },
    { id: 5, cleaner_id: 3, doc_type: 'passport', doc_number: null, issue_date: null, expiry_date: '2030-01-01', note: 'Renewed' },
    { id: 6, cleaner_id: 3, doc_type: 'contract', doc_number: null, issue_date: null, expiry_date: null, note: null },
    { id: 7, cleaner_id: 4, doc_type: 'passport', doc_number: null, issue_date: null, expiry_date: '2026-10-01', note: null },
  ],
};
const COMP = { status: 'success', compensation: { cleaner_id: 3, hire_date: '2024-10-01', end_date: null, basic_salary: 2000, housing_allowance: 500, transport_allowance: 200, other_allowance: null, total: 2700, unpaid_days: 1 } };
const READ: FakeRoute = { match: 'action=hrOverview', status: 200, body: DETAIL };
const COMP_READ: FakeRoute = { match: 'action=hrGetCompensation', status: 200, body: COMP };
const OK = (action: string): FakeRoute => ({ match: 'action=' + action, status: 200, body: { status: 'success' } });

const boot = (page: any, extra: FakeRoute[] = [], reads: FakeRoute[] = [READ, COMP_READ], hash = '#/more/hr/3') =>
  bootMgr(page, [me(MANAGER), ...extra, ...reads, TEAM_READ], { email: true, hash });

const sec = (page: any, key: string) => page.locator('main [data-hr-sec="' + key + '"]');
const stat = (page: any, key: string) => page.locator('main [data-stat="' + key + '"]');

test('fiche : en-tete, sections dans l ordre de hr.js, soldes calcules par les regles', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Amir', exact: true })).toBeVisible();
  await expect(page.locator('main a.more-back')).toHaveAttribute('href', '#/more/hr');
  await expect(page.locator('main [data-hr-sec] h2')).toHaveText(['Balances', 'Employee record', 'Book leave', 'Leave history', 'Documents', 'Compensation', 'End of service estimate']);
  // 24 mois revolus x 2,5 = 60 acquis, 20 pris, 40 restants ; 2 jours maladie au plein tarif.
  await expect(stat(page, 'accrued')).toHaveText('60');
  await expect(stat(page, 'taken')).toHaveText('20');
  await expect(stat(page, 'left')).toHaveText('40');
  await expect(stat(page, 'sick')).toHaveText('2 / 0 / 0');
  await expect(stat(page, 'sickLeft')).toHaveText('88');
  await expect(stat(page, 'unpaid')).toHaveText('1');
  const rec = sec(page, 'record');
  await expect(rec.getByLabel('Hire date')).toHaveValue('2024-10-01');
  await expect(rec.getByLabel('Job title')).toHaveValue('Senior cleaner');
  await expect(rec.getByLabel('Nationality')).toHaveValue('Philippines');
  await expect(rec.getByLabel('Notes')).toHaveValue('Keys holder');
  await expect(rec.getByRole('button', { name: 'Save' })).toBeVisible();
});

test('route sans fiche (Nadia) : creation du dossier, pas de soldes ni de conges', async ({ page }) => {
  await boot(page, [OK('hrSaveEmployee')], [READ], '#/more/hr/9');
  await expect(page.getByRole('heading', { name: 'Nadia', exact: true })).toBeVisible();
  await expect(page.locator('main [data-hr-sec] h2')).toHaveText(['Create employee record']);
  const rec = sec(page, 'record');
  await rec.getByRole('button', { name: 'Create' }).click();
  await expect(rec.getByText('Hire date is required.')).toBeVisible();
  expect(await posts(page, 'hrSaveEmployee')).toHaveLength(0);
  await rec.getByLabel('Hire date').fill('2026-09-01');
  await rec.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('#toast')).toContainText('Employee record saved');
  expect(await posts(page, 'hrSaveEmployee')).toEqual([{
    cleaner_id: 9, hire_date: '2026-09-01', job_title: null, nationality: null,
    opening_annual_days: 0, opening_date: '2026-09-01', end_date: null, notes: null,
  }]);
  expect((await fetchLog(page)).filter((l) => l.url.includes('hrGetCompensation'))).toHaveLength(0);
});

test('sous-traitant : pas de dossier RH', async ({ page }) => {
  await boot(page, [], [READ], '#/more/hr/5');
  await expect(page.getByRole('heading', { name: 'Elite Cleaning', exact: true })).toBeVisible();
  await expect(page.locator('main').getByText('Subcontractors have no HR record.')).toBeVisible();
  await expect(page.locator('main [data-hr-sec]')).toHaveCount(0);
  await expect(page.locator('main input')).toHaveCount(0);
});

test('enregistrer le dossier : poste les champs puis recharge ; erreur du serveur affichee', async ({ page }) => {
  await boot(page, [{ match: 'action=hrSaveEmployee', status: 400, body: { error: 'end_date cannot precede hire_date' }, once: true }, OK('hrSaveEmployee')]);
  const rec = sec(page, 'record');
  await rec.getByLabel('Job title').fill('Team lead');
  await rec.getByLabel('Opening annual balance (days)').fill('4.5');
  await rec.getByLabel('Opening balance date').fill('2025-01-01');
  await rec.getByLabel('End of service date (leave empty if active)').fill('2024-01-01');
  await rec.getByRole('button', { name: 'Save' }).click();
  await expect(rec.getByText('end_date cannot precede hire_date')).toBeVisible();
  // La saisie reste en place apres l'erreur.
  await expect(rec.getByLabel('Job title')).toHaveValue('Team lead');
  await rec.getByLabel('End of service date (leave empty if active)').fill('');
  await rec.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#toast')).toContainText('Employee record saved');
  const calls = await posts(page, 'hrSaveEmployee');
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual({
    cleaner_id: 3, hire_date: '2024-10-01', job_title: 'Team lead', nationality: 'Philippines',
    opening_annual_days: 4.5, opening_date: '2025-01-01', end_date: null, notes: 'Keys holder',
  });
  // Le dossier n'envoie jamais de salaire.
  expect('basic_salary' in calls[1]).toBe(false);
});

test('poser un conge : controles des dates et apercu des jours et feries, rien n est poste', async ({ page }) => {
  await boot(page, [OK('hrSubmitLeave')]);
  const bk = sec(page, 'book');
  await bk.getByRole('button', { name: 'Submit request' }).click();
  await expect(bk.getByText('Pick both dates.')).toBeVisible();
  await bk.getByLabel('From').fill('2026-12-03');
  await bk.getByLabel('To').fill('2026-12-01');
  await bk.getByRole('button', { name: 'Submit request' }).click();
  await expect(bk.getByText('End date must be on or after start date.')).toBeVisible();
  await bk.getByLabel('From').fill('2026-12-01');
  await bk.getByLabel('To').fill('2026-12-03');
  await expect(bk.locator('[data-leave-preview]')).toHaveText('3 days, weekends included. Public holiday in range: National Day (2026-12-02).');
  expect(await posts(page, 'hrSubmitLeave')).toHaveLength(0);
});

test('poser un conge valide : poste aussitot, sans signature ni nombre de jours', async ({ page }) => {
  await boot(page, [OK('hrSubmitLeave')]);
  const bk = sec(page, 'book');
  await bk.getByLabel('Type').selectOption('sick');
  await bk.getByLabel('From').fill('2026-12-01');
  await bk.getByLabel('To').fill('2026-12-03');
  await bk.getByLabel('Reason (optional)').fill('Flu');
  await bk.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.locator('#toast')).toContainText('Request submitted');
  // Aucun pad de signature : le manager pose le conge d'un autre, comme hrSubmitLeaveFor.
  await expect(page.locator('#sheet canvas')).toHaveCount(0);
  const calls = await posts(page, 'hrSubmitLeave');
  // Corps identique a hr.js ; le serveur recalcule les jours.
  expect(calls).toEqual([{ cleaner_id: 3, leave_type: 'sick', start_date: '2026-12-01', end_date: '2026-12-03', reason: 'Flu' }]);
  expect('employee_signature' in calls[0]).toBe(false);
  await expect(bk.getByLabel('From')).toHaveValue('');
});

test('historique : actifs puis clos, annulation confirmee (proprietaire), formulaire sauf annule', async ({ page }) => {
  await boot(page, [OK('hrCancelLeave')]);
  const hist = sec(page, 'history');
  const rows = hist.locator('[data-leave]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-leave', '42');
  await expect(rows.nth(0)).toContainText('Annual leave');
  await expect(rows.nth(0)).toContainText('2026-10-10 to 2026-10-12 · 3 days');
  await expect(rows.nth(0)).toContainText('"Wedding"');
  await expect(rows.nth(0)).toContainText('Approved by Hillal on 2026-10-01');
  await expect(hist.getByText('Past and closed')).toBeVisible();
  await expect(rows.nth(1)).toHaveAttribute('data-leave', '44');
  await expect(rows.nth(2)).toHaveAttribute('data-leave', '43');
  await expect(hist.getByRole('button', { name: 'Cancel this leave' })).toHaveCount(1);
  await expect(rows.nth(1).getByRole('button', { name: 'Download form' })).toHaveCount(0);
  await expect(rows.nth(2).getByRole('button', { name: 'Download form' })).toBeVisible();

  await rows.nth(0).getByRole('button', { name: 'Cancel this leave' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Cancel this leave?' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Keep' }).click();
  expect(await posts(page, 'hrCancelLeave')).toHaveLength(0);
  await rows.nth(0).getByRole('button', { name: 'Cancel this leave' }).click();
  await sheet.getByRole('button', { name: 'Cancel leave' }).click();
  await expect(page.locator('#toast')).toContainText('Leave cancelled');
  expect(await posts(page, 'hrCancelLeave')).toEqual([{ id: 42 }]);
});

test('Download form depuis l historique : lien signe dans le meme onglet', async ({ page }) => {
  await boot(page, [{ match: 'action=hrLeaveForm', status: 200, body: { status: 'success', url: 'https://signed.test/form-43.pdf' } }]);
  const asked: string[] = [];
  await page.route('https://signed.test/**', (r) => {
    asked.push(r.request().url());
    return r.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="leave-form-43.pdf"' }, body: '%PDF-1.4' });
  });
  await sec(page, 'history').locator('[data-leave="43"]').getByRole('button', { name: 'Download form' }).click();
  await expect.poll(() => asked).toContain('https://signed.test/form-43.pdf');
  expect(page.url()).toContain('#/more/hr/3');
  const calls = (await fetchLog(page)).filter((l) => l.url.includes('action=hrLeaveForm'));
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toContain('id=43');
});

test('documents : liste, ajout, modification, suppression confirmee', async ({ page }) => {
  await boot(page, [OK('hrSaveDocument'), OK('hrDeleteDocument')]);
  const docs = sec(page, 'docs');
  const rows = docs.locator('[data-doc]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Residence visa');
  await expect(rows.nth(0)).toContainText('V-123 · expires 2026-11-10');
  await expect(rows.nth(0).locator('.pill')).toHaveText('30 days left');
  await expect(rows.nth(0).locator('.pill')).toHaveClass(/warn/);
  await expect(rows.nth(1)).toContainText('expires 2030-01-01 · Renewed');
  await expect(rows.nth(1).locator('.pill')).toHaveClass(/ok/);
  await expect(rows.nth(2)).toContainText('no expiry');
  await expect(rows.nth(2).locator('.pill')).toHaveCount(0);

  const sheet = page.locator('#sheet');
  await docs.getByRole('button', { name: 'Add document' }).click();
  await sheet.getByLabel('Type').selectOption('emirates_id');
  await sheet.getByLabel('Number').fill('784-1990');
  await sheet.getByLabel('Expires').fill('2028-02-01');
  await sheet.getByRole('button', { name: 'Save document' }).click();
  await expect(page.locator('#toast')).toContainText('Document saved');
  await rows.nth(0).getByRole('button', { name: 'Edit' }).click();
  await expect(sheet.getByLabel('Number')).toHaveValue('V-123');
  await sheet.getByLabel('Note').fill('Renewal started');
  await sheet.getByRole('button', { name: 'Save document' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await posts(page, 'hrSaveDocument')).toEqual([
    { cleaner_id: 3, doc_type: 'emirates_id', doc_number: '784-1990', issue_date: null, expiry_date: '2028-02-01', note: null },
    { id: 1, cleaner_id: 3, doc_type: 'visa', doc_number: 'V-123', issue_date: '2024-11-10', expiry_date: '2026-11-10', note: 'Renewal started' },
  ]);

  await rows.nth(2).getByRole('button', { name: 'Delete' }).click();
  await expect(sheet.getByRole('heading', { name: 'Delete this document?' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  expect(await posts(page, 'hrDeleteDocument')).toHaveLength(0);
  await rows.nth(2).getByRole('button', { name: 'Delete' }).click();
  await sheet.getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('#toast')).toContainText('Document deleted');
  expect(await posts(page, 'hrDeleteDocument')).toEqual([{ id: 6 }]);
});

test('non proprietaire : ni remuneration, ni annulation, ni suppression du dossier', async ({ page }) => {
  await boot(page, [], [{ match: 'action=hrOverview', status: 200, body: { ...DETAIL, isOwner: false } }, COMP_READ]);
  await expect(sec(page, 'record')).toBeVisible();
  await expect(sec(page, 'comp')).toHaveCount(0);
  await expect(sec(page, 'gratuity')).toHaveCount(0);
  await expect(page.locator('main').getByRole('button', { name: 'Delete record' })).toHaveCount(0);
  await expect(page.locator('main').getByRole('button', { name: 'Cancel this leave' })).toHaveCount(0);
  await expect(page.locator('main [data-hr-sec="history"] [data-leave]')).toHaveCount(3);
  expect((await fetchLog(page)).filter((l) => l.url.includes('hrGetCompensation'))).toHaveLength(0);
});

test('remuneration (proprietaire) : valeurs du serveur, enregistrement du dossier complet', async ({ page }) => {
  await boot(page, [OK('hrSaveEmployee')]);
  const comp = sec(page, 'comp');
  await expect(comp.getByLabel('Basic salary (AED / month)')).toHaveValue('2000');
  await expect(comp.getByLabel('Housing allowance')).toHaveValue('500');
  await expect(comp.getByLabel('Other allowance')).toHaveValue('');
  await expect(stat(page, 'total')).toHaveText('2700 AED');
  await expect(stat(page, 'basicShare')).toHaveText('74%');
  await expect(sec(page, 'gratuity')).toContainText('Indicative only');
  await expect(stat(page, 'gratuityUnpaid')).toHaveText('1 days');
  const compCalls = (await fetchLog(page)).filter((l) => l.url.includes('action=hrGetCompensation'));
  expect(compCalls[0].url).toContain('cleaner_id=3');
  await comp.getByLabel('Basic salary (AED / month)').fill('2100');
  await comp.getByLabel('Other allowance').fill('');
  await comp.getByRole('button', { name: 'Save compensation' }).click();
  await expect(page.locator('#toast')).toContainText('Compensation saved');
  expect(await posts(page, 'hrSaveEmployee')).toEqual([{
    cleaner_id: 3, hire_date: '2024-10-01', end_date: null, job_title: 'Senior cleaner', nationality: 'Philippines',
    opening_annual_days: 0, opening_date: null, notes: 'Keys holder',
    basic_salary: 2100, housing_allowance: 500, transport_allowance: 200, other_allowance: null,
  }]);
});

test('remuneration : dossier modifie depuis l ouverture, rien n est enregistre', async ({ page }) => {
  const changed = { ...DETAIL, employees: [{ ...AMIR, job_title: 'Supervisor', updated_at: '2026-10-11T09:00:00Z' }, DETAIL.employees[1]] };
  await boot(page, [OK('hrSaveEmployee')], [
    { match: 'action=hrOverview', status: 200, body: DETAIL, once: true },
    { match: 'action=hrOverview', status: 200, body: changed }, COMP_READ]);
  const comp = sec(page, 'comp');
  await comp.getByLabel('Basic salary (AED / month)').fill('9999');
  await comp.getByRole('button', { name: 'Save compensation' }).click();
  await expect(comp.getByText('This record changed since you opened it. Check the values and save again.')).toBeVisible();
  expect(await posts(page, 'hrSaveEmployee')).toHaveLength(0);
  await expect(sec(page, 'record').getByLabel('Job title')).toHaveValue('Supervisor');
});

test('remuneration : chargement en echec, message et pas de formulaire', async ({ page }) => {
  await boot(page, [], [READ, { match: 'action=hrGetCompensation', status: 404, body: { error: 'no employee record' } }]);
  const comp = sec(page, 'comp');
  await expect(comp.getByText('Could not load compensation data: no employee record')).toBeVisible();
  await expect(comp.getByRole('button', { name: 'Save compensation' })).toHaveCount(0);
  await expect(sec(page, 'gratuity')).toHaveCount(0);
});

test('supprimer le dossier (proprietaire) : confirmation puis retour a la vue d ensemble', async ({ page }) => {
  await boot(page, [OK('hrDeleteEmployee')]);
  await sec(page, 'record').getByRole('button', { name: 'Delete record' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet).toContainText('Delete the HR record of Amir? This cannot be undone.');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  expect(await posts(page, 'hrDeleteEmployee')).toHaveLength(0);
  await sec(page, 'record').getByRole('button', { name: 'Delete record' }).click();
  await sheet.getByRole('button', { name: 'Delete record' }).click();
  await expect(page).toHaveURL(/#\/more\/hr$/);
  expect(await posts(page, 'hrDeleteEmployee')).toEqual([{ cleaner_id: 3 }]);
});

test('quitter la fiche : ecouteurs liberes, un clic plus tard ne poste rien', async ({ page }) => {
  await boot(page, [OK('hrSaveEmployee')]);
  await expect(sec(page, 'record')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/more'; });
  await expect(page.locator('main a.more-row').first()).toBeVisible();
  await page.evaluate(() => {
    const b = document.createElement('button');
    b.setAttribute('data-save-rec', '');
    b.id = 'ghost';
    b.textContent = 'ghost';
    document.querySelector('main')!.appendChild(b);
  });
  await page.locator('#ghost').click();
  await page.waitForTimeout(200);
  expect(await posts(page, 'hrSaveEmployee')).toHaveLength(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('fiche sans defilement horizontal, cibles de 44 px (' + scheme + ')', async ({ page }) => {
      await boot(page);
      await expect(sec(page, 'gratuity')).toBeVisible();
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      for (const b of await page.locator('main [data-hr-sec] button, main [data-hr-sec] input, main [data-hr-sec] select').all()) {
        const box = await b.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      await sec(page, 'docs').getByRole('button', { name: 'Add document' }).click();
      await expect(page.locator('#sheet').getByLabel('Type')).toBeVisible();
      const s2 = await noHorizontalScroll(page);
      expect(s2.scrollWidth).toBeLessThanOrEqual(s2.clientWidth);
    });
  });
}
