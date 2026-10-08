import { test, expect } from '@playwright/test';
import { bootInsp, fetchLog, noHorizontalScroll } from './helpers';

// Date de rectification programmee : saisie a l'inspection, modification depuis l'historique, affichage Reports.
const ME = (id: number, role: string) => ({ status: 200, match: 'action=cleanerMe', body: { cleaner: { id, name: 'X', role } } });
const START = { status: 200, match: 'action=insp.start', body: {
  inspection: { id: 41, listingId: 'A', eligibility: 'checkout', startedAt: '2026-10-06T06:42:00Z' }, items: [], photos: [{ id: 1, zone: 'ac', kind: 'issue' }] } };
const JPG = { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) };
const dubai = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const plus = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso: string) => Number(iso.slice(8, 10)) + ' ' + MON[Number(iso.slice(5, 7)) - 1];

test('inspection : champ Fix scheduled for seulement en Needs maintenance, envoye avec la zone', async ({ page }) => {
  const day = plus(dubai(), 3);
  await bootInsp(page, [ME(3, 'cleaner'), START,
    { status: 200, match: 'action=insp.uploadPhoto', body: { photo: { id: 2, zone: 'ac', kind: 'issue' } } },
    { status: 200, match: 'action=insp.saveItem', body: { item: { zone: 'ac', status: 'not_ok', note: 'AC leaking', outcome: 'maintenance', ticketId: 77, fixScheduledFor: day, fixScheduledSlot: 'morning' } } },
  ], { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const ac = page.getByTestId('zone-ac');
  await ac.getByRole('button', { name: 'Not OK: AC', exact: true }).click();
  await ac.getByLabel('What is wrong?').fill('AC leaking');
  await ac.locator('input[type=file]').first().setInputFiles(JPG);
  await expect(ac.getByLabel('Fix scheduled for (optional)')).toHaveCount(0);
  await ac.getByRole('button', { name: 'Fixed on the spot' }).click();
  await expect(ac.getByLabel('Fix scheduled for (optional)')).toHaveCount(0);
  await ac.getByRole('button', { name: 'Needs maintenance' }).click();
  await ac.getByLabel('Fix scheduled for (optional)').fill(day);
  await ac.getByLabel('Time (optional)').fill('morning');
  await ac.getByRole('button', { name: 'Save' }).click();
  await expect(ac).toContainText('Fix scheduled: ' + short(day) + ', morning');
  const saves = (await fetchLog(page)).filter((l) => l.url.includes('insp.saveItem')).map((l) => JSON.parse(l.body));
  expect(saves.pop()).toMatchObject({ zone: 'ac', outcome: 'maintenance', fixScheduledFor: day, fixScheduledSlot: 'morning' });
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('inspection : sans date, Save reste possible et la date part a null', async ({ page }) => {
  await bootInsp(page, [ME(3, 'cleaner'), START,
    { status: 200, match: 'action=insp.saveItem', body: { item: { zone: 'ac', status: 'not_ok', note: 'Leak', outcome: 'maintenance', ticketId: 77 } } },
  ], { pinToken: 'tok', hash: '#/inspect/A?e=checkout' });
  const ac = page.getByTestId('zone-ac');
  await ac.getByRole('button', { name: 'Not OK: AC', exact: true }).click();
  await ac.getByLabel('What is wrong?').fill('Leak');
  await ac.getByRole('button', { name: 'Needs maintenance' }).click();
  await expect(ac.getByRole('button', { name: 'Save' })).toBeEnabled();
  await ac.getByRole('button', { name: 'Save' }).click();
  await expect(ac).toContainText('Needs maintenance');
  const saves = (await fetchLog(page)).filter((l) => l.url.includes('insp.saveItem')).map((l) => JSON.parse(l.body));
  expect(saves.pop()).toMatchObject({ fixScheduledFor: null, fixScheduledSlot: null });
});

const hist = (items: any[], inspectorId = 3) => ({ status: 200, match: 'action=insp.history', body: { listingId: 'B', name: 'Apt 202 · Tower B', inspections: [
  { id: 2, inspector: 'Faiza', inspectorId, startedAt: '2026-10-01T05:30:00Z', finishedAt: '2026-10-01T06:00:00Z', eligibility: 'checkout', generalNote: null, items }] } });
const AC = (extra: any = {}) => ({ zone: 'ac', label: 'AC', status: 'not_ok', note: 'Leak', outcome: 'maintenance', fixNote: null,
  ticket: { id: 50, status: 'open', title: 'AC: Leak' }, photos: [], fixScheduledFor: null, fixScheduledSlot: null, fixOverdue: false, ...extra });

test('historique : date passee et ticket ouvert, badge Overdue ; manager change la date', async ({ page }) => {
  const day = plus(dubai(), 2);
  await bootInsp(page, [ME(2, 'manager'), hist([AC({ fixScheduledFor: '2026-10-03', fixScheduledSlot: 'morning', fixOverdue: true })]),
    { status: 200, match: 'action=insp.setFixSchedule', body: { item: { zone: 'ac', fixScheduledFor: day, fixScheduledSlot: '2 pm' } } },
  ], { pinToken: 'tok', hash: '#/history/B' });
  await expect(page.getByText('Fix scheduled: 3 Oct, morning')).toBeVisible();
  await expect(page.getByText('Overdue', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change fix date' }).click();
  await page.getByLabel('Fix scheduled for (optional)').fill(day);
  await page.getByLabel('Time (optional)').fill('2 pm');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Fix scheduled: ' + short(day) + ', 2 pm')).toBeVisible();
  await expect(page.getByText('Overdue', { exact: true })).toHaveCount(0);
  const call = (await fetchLog(page)).filter((l) => l.url.includes('insp.setFixSchedule')).map((l) => JSON.parse(l.body)).pop();
  expect(call).toEqual({ inspectionId: 2, zone: 'ac', date: day, slot: '2 pm' });
});

test('historique : inspectrice auteure peut poser la date, autre cleaner non, ticket clos non', async ({ page }) => {
  await bootInsp(page, [ME(3, 'cleaner'), hist([AC(), AC({ zone: 'kitchen', label: 'Kitchen & appliances', ticket: { id: 51, status: 'resolved', title: 'x' } })])],
    { pinToken: 'tok', hash: '#/history/B' });
  await expect(page.getByRole('button', { name: 'Set fix date' })).toHaveCount(1);
});

test('historique : un autre cleaner ne voit pas le bouton', async ({ page }) => {
  await bootInsp(page, [ME(9, 'cleaner'), hist([AC()])], { pinToken: 'tok', hash: '#/history/B' });
  await expect(page.getByText('Ticket #50 · open')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set fix date' })).toHaveCount(0);
});

test('historique : erreur serveur affichee, formulaire garde', async ({ page }) => {
  await bootInsp(page, [ME(2, 'manager'), hist([AC()]),
    { status: 409, match: 'action=insp.setFixSchedule', body: { error: 'This ticket is already closed.' } }], { pinToken: 'tok', hash: '#/history/B' });
  await page.getByRole('button', { name: 'Set fix date' }).click();
  await page.getByLabel('Fix scheduled for (optional)').fill(plus(dubai(), 1));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This ticket is already closed.')).toBeVisible();
  await expect(page.getByLabel('Fix scheduled for (optional)')).toBeVisible();
});

test('reports : date de rectification et Overdue sur la ligne', async ({ page }) => {
  await bootInsp(page, [ME(2, 'manager'), { status: 200, match: 'action=insp.reports', body: {
    from: '2026-09-30', to: '2026-10-06',
    totals: { inspections: 1, apartments: 1, clean: 0, withIssues: 1, fixedOnSpot: 0, sentToMaintenance: 2, openTickets: 2 },
    reports: [{ id: 4, listingId: 'A', name: 'Apt 414 · Azizi Riviera 11', inspector: 'Walter', finishedAt: '2026-10-06T06:42:00Z', eligibility: 'checkout', result: 'maintenance',
      issues: [
        { zone: 'ac', label: 'AC', outcome: 'maintenance', ticket: { id: 128, status: 'open' }, fixScheduledFor: '2026-10-05', fixScheduledSlot: null, fixOverdue: true },
        { zone: 'living', label: 'Living room', outcome: 'maintenance', ticket: { id: 129, status: 'open' }, fixScheduledFor: null, fixScheduledSlot: null, fixOverdue: false },
      ] }] } }], { pinToken: 'tok', hash: '#/reports' });
  const row = page.getByTestId('report-4');
  await expect(row).toContainText('AC · Fix scheduled: 5 Oct');
  await expect(row.getByText('Overdue', { exact: true })).toBeVisible();
  await expect(row).not.toContainText('Living room · Fix scheduled');
});

test('historique : apres sauvegarde, Overdue suit la reponse du serveur ; ticket closed sans bouton', async ({ page }) => {
  await bootInsp(page, [ME(2, 'manager'),
    hist([AC({ fixScheduledFor: '2026-10-03', fixOverdue: true }), AC({ zone: 'kitchen', label: 'Kitchen & appliances', ticket: { id: 51, status: 'closed', title: 'x' } })]),
    { status: 200, match: 'action=insp.setFixSchedule', body: { item: { zone: 'ac', fixScheduledFor: '2026-10-03', fixScheduledSlot: 'pm', fixOverdue: true } } },
  ], { pinToken: 'tok', hash: '#/history/B' });
  await expect(page.getByRole('button', { name: /fix date/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Change fix date' }).click();
  await page.getByLabel('Time (optional)').fill('pm');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Fix scheduled: 3 Oct, pm')).toBeVisible();
  await expect(page.getByText('Overdue', { exact: true })).toBeVisible();
});
