import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';

const SETUP = {
  month: '2026-10',
  listings: [{ id: '22', apt: '', bld: 'Beta Tower' }, { id: '11', apt: '1203', bld: 'Marina Gate' }],
  vendors: [
    { id: 2, name: 'Ali Plumbing', specialty: 'plumbing', phone: '+971500000002', email: 'ali@example.com', hourly_rate: 120, notes: 'Fast', is_active: true },
    { id: 1, name: 'Zed AC', specialty: 'ac', phone: null, email: null, hourly_rate: null, notes: null, is_active: true },
  ],
  equipment: [
    { id: 5, listing_id: '22', name: 'Boiler', category: 'water_heater', brand: 'Ariston', model: 'X1', serial_number: 'S-9',
      install_date: '2026-01-01', warranty_until: '2028-01-01', service_interval_days: 180, next_service: '2026-07-01', condition: 'fair', notes: null, listingLabel: 'Beta Tower' },
    { id: 4, listing_id: '11', name: 'AC unit', category: 'ac', install_date: null, warranty_until: null, service_interval_days: 180,
      next_service: null, condition: 'good', notes: null, listingLabel: '1203 · Marina Gate' },
  ],
  schedules: [
    { id: 7, listing_id: null, equipment_id: null, task_name: 'Pest control', description: null, category: 'general', frequency_days: 90,
      assigned_vendor_id: null, estimated_cost: null, next_due_at: '2026-10-01T00:00:00Z', last_done_at: null, listingLabel: null, vendorName: null },
    { id: 8, listing_id: '11', equipment_id: 4, task_name: 'AC filter', description: 'Clean filters', category: 'ac', frequency_days: 60,
      assigned_vendor_id: 1, estimated_cost: 200, next_due_at: '2026-12-01T00:00:00Z', last_done_at: '2026-10-02T08:00:00Z', listingLabel: '1203 · Marina Gate', vendorName: 'Zed AC' },
  ],
  costs: [
    { id: 31, listing_id: '22', category: 'plumbing', description: 'Leak', amount: 80.5, vendor_id: 2, date: '2026-10-31', listingLabel: 'Beta Tower', vendorName: 'Ali Plumbing' },
    { id: 30, listing_id: '11', category: 'ac', description: 'Gas refill', amount: 150, vendor_id: 1, date: '2026-10-01', listingLabel: '1203 · Marina Gate', vendorName: 'Zed AC' },
  ],
};
const SEPT = { ...SETUP, month: '2026-09', costs: [] };
const THE_READ: FakeRoute = { match: 'action=mgr.setup', status: 200, body: SETUP };
const ok = (action: string): FakeRoute => ({ match: 'action=' + action, status: 200, body: { status: 'success' } });

const boot = (page: any, hash = '#/more/setup', extra: FakeRoute[] = [], read: FakeRoute[] = [THE_READ]) =>
  bootMgr(page, [me(MANAGER), ...extra, ...read], { email: true, hash, clock: new Date('2026-10-11T08:00:00Z') });

const posts = async (page: any, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action) && l.body).map((l) => JSON.parse(l.body));
const reads = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.setup')).map((l) => l.url);

test('onglets : Vendors par defaut, liste des prestataires, retour vers More', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Maintenance setup', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Vendors', 'Equipment', 'Preventive', 'Costs']);
  await expect(page.getByRole('tab', { name: 'Vendors' })).toHaveAttribute('aria-selected', 'true');
  const ali = page.locator('main [data-vendor="2"]');
  await expect(ali).toContainText('Ali Plumbing');
  await expect(ali).toContainText('Plumbing');
  await expect(ali).toContainText('+971500000002');
  await expect(page.locator('main [data-vendor="1"]')).toContainText('AC');
});

test('onglet par l url et changement d onglet sans relecture', async ({ page }) => {
  await boot(page, '#/more/setup/equipment');
  await expect(page.getByRole('tab', { name: 'Equipment' })).toHaveAttribute('aria-selected', 'true');
  // Groupes par logement, libelles du serveur, jamais « Unknown ».
  await expect(page.getByRole('heading', { name: 'Beta Tower', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1203 · Marina Gate', exact: true })).toBeVisible();
  const boiler = page.locator('main [data-equipment="5"]');
  await expect(boiler).toContainText('Boiler');
  await expect(boiler).toContainText('Fair');
  await expect(boiler).toContainText('Service due');
  await expect(page.locator('main')).not.toContainText('Unknown');
  await page.getByRole('tab', { name: 'Preventive' }).click();
  await expect(page.locator('main [data-schedule="8"]')).toContainText('AC filter');
  expect(await reads(page)).toHaveLength(1);
  await expect(page).toHaveURL(/#\/more\/setup\/preventive$/);
});

test('prestataire sans specialite : le message 400 du serveur reste dans le panneau', async ({ page }) => {
  await boot(page, '#/more/setup', [{ match: 'action=saveVendor', status: 400, body: { error: 'name and specialty required' } }]);
  await page.getByRole('button', { name: 'Add vendor' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill('New Co');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('name and specialty required');
  await expect(page.locator('#sheet.on')).toHaveCount(1);
  await expect(page.locator('#toast')).not.toContainText('Saved');
  expect(await reads(page)).toHaveLength(1);
});

test('ajout puis modification d un prestataire : corps postes et relecture', async ({ page }) => {
  await boot(page, '#/more/setup', [ok('saveVendor')]);
  await page.getByRole('button', { name: 'Add vendor' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Name').fill('Spark Co');
  await sheet.getByLabel('Specialty').selectOption('electrical');
  await sheet.getByLabel('Phone').fill('+971500000099');
  await sheet.getByLabel('Hourly rate (AED)').fill('90');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(async () => (await reads(page)).length).toBe(2);
  await page.locator('main [data-vendor="2"]').click();
  await expect(sheet.getByLabel('Name')).toHaveValue('Ali Plumbing');
  await expect(sheet.getByLabel('Notes')).toHaveValue('Fast');
  await sheet.getByLabel('Email').fill('new@example.com');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const calls = await posts(page, 'saveVendor');
  expect(calls).toEqual([
    { name: 'Spark Co', phone: '+971500000099', email: '', specialty: 'electrical', hourly_rate: 90, notes: '' },
    { id: 2, name: 'Ali Plumbing', phone: '+971500000002', email: 'new@example.com', specialty: 'plumbing', hourly_rate: 120, notes: 'Fast' },
  ]);
});

test('suppression d un prestataire avec confirmation', async ({ page }) => {
  await boot(page, '#/more/setup', [ok('deleteVendor')]);
  await page.locator('main [data-vendor="1"]').click();
  const sheet = page.locator('#sheet');
  await sheet.getByRole('button', { name: 'Delete' }).click();
  await expect(sheet.getByText('Delete Zed AC?').first()).toBeVisible();
  expect(await posts(page, 'deleteVendor')).toHaveLength(0);
  await sheet.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await posts(page, 'deleteVendor')).toEqual([{ id: 1 }]);
});

test('equipement : ajout avec dates, intervalle et etat', async ({ page }) => {
  await boot(page, '#/more/setup/equipment', [ok('saveEquipment')]);
  await page.getByRole('button', { name: 'Add equipment' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Apartment').selectOption('11');
  await sheet.getByLabel('Name').fill('Washer');
  await sheet.getByLabel('Category').selectOption('washer');
  await sheet.getByLabel('Install date').fill('2026-03-01');
  await sheet.getByLabel('Warranty until').fill('2028-03-01');
  await sheet.getByLabel('Service interval (days)').fill('120');
  await sheet.getByLabel('Condition').selectOption('excellent');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const [b] = await posts(page, 'saveEquipment');
  expect(b).toMatchObject({ listing_id: '11', name: 'Washer', category: 'washer', install_date: '2026-03-01',
    warranty_until: '2028-03-01', service_interval_days: 120, condition: 'excellent' });
  expect(b.id).toBeUndefined();
});

test('equipement : modification renvoie l id et les valeurs existantes', async ({ page }) => {
  await boot(page, '#/more/setup/equipment', [ok('saveEquipment')]);
  await page.locator('main [data-equipment="5"]').click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByLabel('Install date')).toHaveValue('2026-01-01');
  await sheet.getByLabel('Condition').selectOption('poor');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  const [b] = await posts(page, 'saveEquipment');
  expect(b).toEqual({ id: 5, listing_id: '22', name: 'Boiler', category: 'water_heater', brand: 'Ariston', model: 'X1', serial_number: 'S-9',
    install_date: '2026-01-01', warranty_until: '2028-01-01', service_interval_days: 180, condition: 'poor', notes: '' });
});

test('preventif : echeance, en retard, ajout et Mark done', async ({ page }) => {
  await boot(page, '#/more/setup/preventive', [ok('savePreventiveMaintenance'), ok('completePreventive')]);
  const pest = page.locator('main [data-schedule="7"]');
  await expect(pest).toContainText('Pest control');
  await expect(pest).toContainText('Overdue');
  await expect(page.locator('main [data-schedule="8"]')).toContainText('Zed AC');
  await page.getByRole('button', { name: 'Add task' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Task').fill('Duct cleaning');
  await sheet.getByLabel('Apartment').selectOption('22');
  await sheet.getByLabel('Every (days)').fill('180');
  await sheet.getByLabel('Vendor').selectOption('2');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect((await posts(page, 'savePreventiveMaintenance'))[0]).toMatchObject({
    task_name: 'Duct cleaning', listing_id: '22', frequency_days: 180, assigned_vendor_id: 2,
  });
  await pest.getByRole('button', { name: 'Mark done' }).click();
  await sheet.getByLabel('Actual cost (AED)').fill('350');
  await sheet.getByLabel('Notes').fill('All rooms');
  await sheet.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await posts(page, 'completePreventive')).toEqual([{ id: 7, actual_cost: 350, notes: 'All rooms' }]);
});

test('preventif : refus du serveur affiche tel quel', async ({ page }) => {
  await boot(page, '#/more/setup/preventive', [{ match: 'action=completePreventive', status: 403, body: { error: 'Only managers can do this.' } }]);
  await page.locator('main [data-schedule="8"]').getByRole('button', { name: 'Mark done' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByRole('button', { name: 'Mark done' }).click();
  await expect(sheet.getByRole('alert')).toHaveText('Only managers can do this.');
});

test('couts : mois, total des montants du serveur, mois precedent, ajout', async ({ page }) => {
  await boot(page, '#/more/setup/costs', [ok('addMaintenanceCost')], [
    { match: 'month=2026-09', status: 200, body: SEPT },
    THE_READ,
  ]);
  await expect(page.locator('main')).toContainText('October 2026');
  await expect(page.locator('main [data-cost="31"]')).toContainText('AED 80.50');
  await expect(page.locator('main [data-cost="31"]')).toContainText('Ali Plumbing');
  await expect(page.locator('main [data-cost-total]')).toHaveText('AED 230.50');
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous month' }).click();
  await expect(page.locator('main')).toContainText('September 2026');
  await expect(page.locator('main')).toContainText('No costs this month.');
  await expect(page.getByRole('tab', { name: 'Costs' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Add cost' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Apartment').selectOption('11');
  await sheet.getByLabel('Category').selectOption('ac');
  await sheet.getByLabel('Description').fill('Compressor');
  await sheet.getByLabel('Amount (AED)').fill('420.5');
  await sheet.getByLabel('Vendor').selectOption('1');
  await sheet.getByLabel('Date').fill('2026-09-15');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  expect(await posts(page, 'addMaintenanceCost')).toEqual([
    { listing_id: '11', category: 'ac', description: 'Compressor', amount: 420.5, vendor_id: 1, date: '2026-09-15' },
  ]);
  // Relecture du mois affiche.
  await expect.poll(async () => (await reads(page)).filter((u) => u.includes('month=2026-09')).length).toBe(2);
});

test('lecture en echec : message et Retry', async ({ page }) => {
  await boot(page, '#/more/setup', [], [
    { match: 'action=mgr.setup', status: 503, body: { error: 'Maintenance setup is unavailable right now. Try again.' }, once: true },
    THE_READ,
  ]);
  await expect(page.locator('main').getByText('Maintenance setup is unavailable right now. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('main [data-vendor="2"]')).toBeVisible();
});

test('refus « email sign-in required » : ecran de connexion par email', async ({ page }) => {
  await boot(page, '#/more/setup', [], [{ match: 'action=mgr.setup', status: 403, body: { error: 'email sign-in required' } }]);
  await expect(page.getByRole('heading', { name: 'Sign in with your email' })).toBeVisible();
  await expect(page.locator('main [data-vendor]')).toHaveCount(0);
});

test('aucun defilement horizontal et cibles de 44 px, tous les onglets et un panneau', async ({ page }) => {
  await boot(page, '#/more/setup');
  await expect(page.locator('main [data-vendor="2"]')).toBeVisible();
  // Les quatre onglets tiennent dans l ecran, aucun n est coupe.
  const vw = page.viewportSize()!.width;
  for (const el of await page.getByRole('tab').all()) {
    const box = (await el.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
  }
  for (const tab of ['Vendors', 'Equipment', 'Preventive', 'Costs']) {
    await page.getByRole('tab', { name: tab }).click();
    const s = await noHorizontalScroll(page);
    expect(s.scrollWidth, tab).toBeLessThanOrEqual(s.clientWidth);
    for (const el of await page.locator('main button, main a').all()) {
      if (!(await el.isVisible())) continue;
      expect((await el.boundingBox())!.height, await el.evaluate((n) => n.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(43.99);
    }
  }
  await page.getByRole('button', { name: 'Add cost' }).click();
  await expect(page.locator('#sheet.on')).toHaveCount(1);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
  for (const el of await page.locator('#sheet button, #sheet input, #sheet select').all()) {
    if (!(await el.isVisible())) continue;
    expect((await el.boundingBox())!.height, await el.evaluate((n) => n.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(43.99);
  }
});

test('preventif : echec partiel du serveur, panneau ferme, message en toast, un seul envoi et liste relue', async ({ page }) => {
  await boot(page, '#/more/setup/preventive', [{ match: 'action=completePreventive', status: 500,
    body: { error: 'Task marked done, but the cost was not recorded. Add it in Costs.' } }]);
  await page.locator('main [data-schedule="7"]').getByRole('button', { name: 'Mark done' }).click();
  const sheet = page.locator('#sheet');
  await sheet.getByLabel('Actual cost (AED)').fill('100');
  await sheet.getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#toast')).toContainText('Task marked done, but the cost was not recorded. Add it in Costs.');
  // Le panneau est ferme : pas de second appui possible qui repousserait next_due_at.
  await expect(page.locator('#sheet.on')).toHaveCount(0);
  await expect.poll(async () => (await reads(page)).length).toBe(2);
  expect(await posts(page, 'completePreventive')).toHaveLength(1);
});
