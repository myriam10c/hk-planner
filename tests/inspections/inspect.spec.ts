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

const JPG = { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };

test('envoi de photo : le focus et la saisie restent en place', async ({ page }) => {
  await bootInsp(page, [ME, START(), { status: 200, match: 'action=insp.uploadPhoto', delay: 700, body: { photo: { id: 1, zone: 'kitchen', kind: 'issue' } } }],
    { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const k = page.getByTestId('zone-kitchen');
  await k.getByRole('button', { name: 'Not OK' }).click();
  await k.locator('input[type=file]').first().setInputFiles(JPG);
  const ta = k.getByLabel('What is wrong?');
  await ta.click();
  await ta.pressSequentially('Oven dirty');
  await expect(k.getByText('Uploading…')).toBeVisible();
  await expect(k.getByText('Uploading…')).toHaveCount(0);
  await expect(ta).toBeFocused();
  await expect(ta).toHaveValue('Oven dirty');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).id)).toBe('note-kitchen');
});

test('photo refusee par le serveur : Remove la retire', async ({ page }) => {
  await bootInsp(page, [ME, START(), { status: 400, match: 'action=insp.uploadPhoto', body: { error: 'Photo too big' } }],
    { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const k = page.getByTestId('zone-kitchen');
  await k.getByRole('button', { name: 'Not OK' }).click();
  await k.locator('input[type=file]').first().setInputFiles(JPG);
  await k.getByRole('button', { name: 'Remove' }).click();
  await expect(k.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  await expect(k.getByRole('button', { name: 'Retry upload' })).toHaveCount(0);
});

test('fichier non image : pas d envoi', async ({ page }) => {
  await bootInsp(page, [ME, START()], { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const k = page.getByTestId('zone-kitchen');
  await k.getByRole('button', { name: 'Not OK' }).click();
  await k.locator('input[type=file]').first().setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  await expect(page.getByText('Photo too large or unsupported. Take it again.')).toBeVisible();
  expect((await fetchLog(page)).some((l) => l.url.includes('insp.uploadPhoto'))).toBe(false);
});

test('brouillon conserve entre zones, ticket existant : pas de nouveau toast, "stays open"', async ({ page }) => {
  await bootInsp(page, [ME, START([{ zone: 'ac', status: 'not_ok', note: 'Noisy', outcome: 'maintenance', ticketId: 7 }]),
    { status: 200, match: 'action=insp.saveItem', body: { item: { zone: 'ac', status: 'ok', ticketId: 7 } } }],
    { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const k = page.getByTestId('zone-kitchen');
  await k.getByRole('button', { name: 'Not OK' }).click();
  await k.getByLabel('What is wrong?').fill('Draft text');
  await page.getByTestId('zone-living').getByRole('button', { name: 'Not OK' }).click();
  await k.getByRole('button', { name: 'Not OK' }).click();
  await expect(k.getByLabel('What is wrong?')).toHaveValue('Draft text');
  const ac = page.getByTestId('zone-ac');
  await ac.getByRole('button', { name: 'Change' }).click();
  await ac.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(ac).toContainText('Ticket #7 stays open');
  await expect(page.getByText('Ticket #7 created', { exact: true }).locator('visible=true')).toHaveCount(0);
});

test('apres Finish : pas de toast parasite d un envoi en retard', async ({ page }) => {
  const items = KEYS.map((k) => ({ zone: k, status: 'ok' }));
  await bootInsp(page, [ME, START(items), { status: 200, match: 'action=insp.finish', body: { inspection: { id: 41 } } },
    { status: 200, match: 'action=insp.today', body: { day: '2026-10-06', target: 4, cachedAt: null, today: [], also: [] } }],
    { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  await page.getByRole('button', { name: 'Finish inspection' }).click();
  await expect(page.getByText('Inspection saved')).toBeVisible();
  await expect(page.getByText("Today's inspections")).toBeVisible();
});

test('Cancel sur une zone deja enregistree : resume et Change reviennent', async ({ page }) => {
  await bootInsp(page, [ME, START([{ zone: 'kitchen', status: 'ok' }])], { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const k = page.getByTestId('zone-kitchen');
  await k.getByRole('button', { name: 'Change' }).click();
  await k.getByRole('button', { name: 'Not OK' }).click();
  await k.getByRole('button', { name: 'Cancel' }).click();
  await expect(k.getByText('OK', { exact: true })).toBeVisible();
  await expect(k.getByRole('button', { name: 'Change' })).toBeVisible();
});

test('ticket sur une zone corrigee : "stays open"', async ({ page }) => {
  await bootInsp(page, [ME, START([{ zone: 'ac', status: 'not_ok', note: 'Noisy', outcome: 'fixed', fixNote: 'Cleaned', ticketId: 9 }])], { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  await expect(page.getByTestId('zone-ac')).toContainText('Ticket #9 stays open');
});
