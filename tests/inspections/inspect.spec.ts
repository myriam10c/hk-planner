import { test, expect } from '@playwright/test';
import { bootInsp, fetchLog } from './helpers';

const ZONES = ['Entrance, door & lock','Living room','Kitchen & appliances','Bedroom(s) & bedding','Bathroom(s) & plumbing','AC','Wi-Fi & TV','Balcony & windows','Inventory & consumables','General cleanliness'];
const KEYS = ['entrance','living','kitchen','bedrooms','bathrooms','ac','wifi_tv','balcony','inventory','cleanliness'];
const ME = { status: 200, match: 'action=cleanerMe', body: { cleaner: { cleaner_id: 3, name: 'Faiza', role: 'cleaner' } } };
const START = (items: any[] = [], photos: any[] = []) => ({ status: 200, match: 'action=insp.start', body: {
  inspection: { id: 41, listingId: 'A', eligibility: 'checkout', startedAt: '2026-10-06T06:42:00Z' }, items, photos } });
const OK = { status: 200, match: 'action=insp.saveItem', body: { item: { zone: 'x', status: 'ok' } } };

test('parcours : 9 OK, AC en maintenance avec photo, fin', async ({ page }) => {
  await bootInsp(page, [ME, START(),
    { status: 200, match: 'action=insp.uploadPhoto', body: { photo: { id: 1, zone: 'ac', kind: 'issue' } } },
    OK,
    { status: 200, match: 'action=insp.finish', body: { inspection: { id: 41, finishedAt: '2026-10-06T07:10:00Z' } } },
    { status: 200, match: 'action=insp.today', body: { day: '2026-10-06', target: 4, cachedAt: null, today: [], also: [] } },
  ], { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  for (const z of ZONES) {
    if (z === 'AC') continue;
    await page.getByTestId('zone-' + KEYS[ZONES.indexOf(z)]).getByRole('button', { name: 'OK', exact: true }).click();
  }
  const ac = page.getByTestId('zone-ac');
  await ac.getByRole('button', { name: 'Not OK' }).click();
  await ac.getByLabel('What is wrong?').fill('AC leaking water');
  await ac.locator('input[type=file]').first().setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await ac.getByRole('button', { name: 'Needs maintenance' }).click();
  await ac.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('10 / 10 zones')).toBeVisible();
  await page.getByRole('button', { name: 'Finish inspection' }).click();
  await expect(page.getByText('Inspection saved')).toBeVisible();
  const log = await fetchLog(page);
  const saves = log.filter((l) => l.url.includes('insp.saveItem')).map((l) => JSON.parse(l.body));
  expect(saves.find((s) => s.zone === 'ac')).toMatchObject({ status: 'not_ok', note: 'AC leaking water', outcome: 'maintenance', inspectionId: 41 });
  expect(log.some((l) => l.url.includes('insp.uploadPhoto') && JSON.parse(l.body).zone === 'ac')).toBe(true);
});

test('reprise : zones deja saisies affichees', async ({ page }) => {
  await bootInsp(page, [ME, START([{ zone: 'entrance', status: 'ok' }, { zone: 'ac', status: 'not_ok', note: 'Noisy', outcome: 'fixed', fixNote: 'Filter cleaned' }], [{ id: 1, zone: 'ac', kind: 'issue' }])],
    { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  await expect(page.getByText('2 / 10 zones')).toBeVisible();
  await expect(page.getByTestId('zone-ac')).toContainText('Filter cleaned');
});

test('erreur de fin affichee telle quelle', async ({ page }) => {
  const items = KEYS.map((k) => ({ zone: k, status: 'ok' }));
  await bootInsp(page, [ME, START(items), { status: 400, match: 'action=insp.finish', body: { error: 'Add a photo for: AC' } }],
    { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  await page.getByRole('button', { name: 'Finish inspection' }).click();
  await expect(page.getByText('Add a photo for: AC')).toBeVisible();
});

test('Not OK sans description : Save bloque', async ({ page }) => {
  await bootInsp(page, [ME, START()], { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const k = page.getByTestId('zone-kitchen');
  await k.getByRole('button', { name: 'Not OK' }).click();
  await expect(k.getByRole('button', { name: 'Save' })).toBeDisabled();
});
