import { test, expect } from '@playwright/test';
import { bootInsp, fetchLog, noHorizontalScroll } from './helpers';

const MGR = { status: 200, match: 'action=cleanerMe', body: { cleaner: { cleaner_id: 2, name: 'Walter', role: 'manager' } } };
const CLN = { status: 200, match: 'action=cleanerMe', body: { cleaner: { cleaner_id: 3, name: 'Faiza', role: 'cleaner' } } };
const TODAY = { status: 200, match: 'action=insp.today', body: { day: '2026-10-06', cleaners: [], candidates: [], summary: {} } };

const REPORTS = { status: 200, match: 'action=insp.reports', body: {
  from: '2026-09-30', to: '2026-10-06',
  totals: { inspections: 4, apartments: 3, clean: 1, withIssues: 2, fixedOnSpot: 2, sentToMaintenance: 1, openTickets: 1 },
  reports: [
    { id: 4, listingId: 'A', name: 'Apt 414 · Azizi Riviera 11', inspector: 'Walter', finishedAt: '2026-10-06T06:42:00Z', eligibility: 'checkout', result: 'maintenance',
      issues: [{ zone: 'ac', label: 'AC', outcome: 'maintenance', ticket: { id: 128, status: 'open' } }] },
    { id: 3, listingId: 'B', name: 'Apt 202 · Tower B', inspector: 'Faiza', finishedAt: '2026-10-05T10:00:00Z', eligibility: 'vacant', result: 'fixed',
      issues: [{ zone: 'tap', label: 'Tap', outcome: 'fixed', ticket: null }] },
    { id: 2, listingId: 'C', name: 'Apt 303 · Tower C', inspector: 'Walter', finishedAt: '2026-10-04T10:00:00Z', eligibility: 'adhoc', result: 'clean', issues: [] },
    { id: 1, listingId: 'A', name: 'Apt 414 · Azizi Riviera 11', inspector: 'Faiza', finishedAt: '2026-10-01T10:00:00Z', eligibility: 'adhoc', result: 'clean', issues: [] },
  ] } };
const HISTORY = { status: 200, match: 'action=insp.history', body: { listingId: 'A', name: 'Apt 414 · Azizi Riviera 11', inspections: [] } };

const dubai = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const plus = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function lastReportsUrl(page: any) {
  const log = await fetchLog(page);
  const u = log.filter((l) => l.url.includes('action=insp.reports')).pop();
  return new URL(u!.url);
}

test('rapports : tuiles, totaux et lignes', async ({ page }) => {
  await bootInsp(page, [MGR, REPORTS], { pinToken: 'tok', hash: '#/reports' });
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await expect(page.getByTestId('tile-inspections')).toContainText('4');
  await expect(page.getByTestId('tile-apartments')).toContainText('3');
  await expect(page.getByTestId('tile-clean')).toContainText('1');
  await expect(page.getByTestId('tile-issues')).toContainText('2');
  await expect(page.getByText('Fixed on the spot: 2 · Sent to maintenance: 1 · Tickets still open: 1')).toBeVisible();
  const r = page.getByTestId('report-4');
  await expect(r).toContainText('Tue 6 Oct · 10:42');
  await expect(r).toContainText('Apt 414 · Azizi Riviera 11');
  await expect(r).toContainText('by Walter');
  await expect(r).toContainText('Ticket #128 · open');
  await expect(page.getByTestId('report-3')).toContainText('Fixed on the spot');
  await expect(page.getByTestId('report-2')).toContainText('No issues');
  const u = await lastReportsUrl(page);
  expect(u.searchParams.get('to')).toBe(dubai());
  expect(u.searchParams.get('from')).toBe(plus(dubai(), -6));
});

test('rapports : filtres cote client', async ({ page }) => {
  await bootInsp(page, [MGR, REPORTS], { pinToken: 'tok', hash: '#/reports' });
  await expect(page.getByTestId('report-4')).toBeVisible();
  await page.getByRole('button', { name: 'No issues', exact: true }).click();
  await expect(page.getByTestId('report-2')).toBeVisible();
  await expect(page.getByTestId('report-4')).toHaveCount(0);
  await page.getByRole('button', { name: 'With issues', exact: true }).click();
  await expect(page.getByTestId('report-4')).toBeVisible();
  await expect(page.getByTestId('report-3')).toBeVisible();
  await expect(page.getByTestId('report-2')).toHaveCount(0);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('report-2')).toBeVisible();
  expect((await fetchLog(page)).filter((l) => l.url.includes('insp.reports'))).toHaveLength(1);
});

async function pick(page: any, label: string) { await page.locator('.chips').first().getByRole('button', { name: label }).click(); }
async function sent(page: any, from: string, to: string) {
  await expect.poll(async () => { const u = await lastReportsUrl(page); return u.searchParams.get('from') + '|' + u.searchParams.get('to'); }).toBe(from + '|' + to);
}

test('rapports : periodes, 00:30 Dubai le 6 oct (20:30Z la veille)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T20:30:00Z'));
  await bootInsp(page, [MGR, REPORTS], { pinToken: 'tok', hash: '#/reports' });
  await sent(page, '2026-09-30', '2026-10-06');
  await pick(page, 'Today'); await sent(page, '2026-10-06', '2026-10-06');
  await pick(page, '30 days'); await sent(page, '2026-09-07', '2026-10-06');
  await pick(page, 'This month'); await sent(page, '2026-10-01', '2026-10-06');
  await pick(page, '7 days'); await sent(page, '2026-09-30', '2026-10-06');
});

test('rapports : This month le 1er nov Dubai (21:00Z le 31 oct)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T21:00:00Z'));
  await bootInsp(page, [MGR, REPORTS], { pinToken: 'tok', hash: '#/reports' });
  await pick(page, 'This month'); await sent(page, '2026-11-01', '2026-11-01');
});

test('rapports : reponse lente obsolete ignoree', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-06T08:00:00Z'));
  const slow = { ...REPORTS, match: 'from=2026-09-30', delay: 1500 };
  const empty = { status: 200, match: 'from=2026-10-06', body: { from: '2026-10-06', to: '2026-10-06', totals: { inspections: 1, apartments: 1, clean: 1, withIssues: 0, fixedOnSpot: 0, sentToMaintenance: 0, openTickets: 0 }, reports: [REPORTS.body.reports[2]] } };
  await bootInsp(page, [MGR, slow, empty], { pinToken: 'tok', hash: '#/reports' });
  await pick(page, 'Today');
  await expect(page.getByTestId('tile-inspections')).toContainText('1');
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('tile-inspections')).toContainText('1');
  await expect(page.getByTestId('report-2')).toBeVisible();
  await expect(page.getByTestId('report-4')).toHaveCount(0);
});

test('rapports : 403 cleaner, message serveur et Back sans Retry', async ({ page }) => {
  await bootInsp(page, [CLN, TODAY, { status: 403, match: 'action=insp.reports', body: { error: 'Managers only' } }], { pinToken: 'tok', hash: '#/reports' });
  await expect(page.getByText('Managers only')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('rapports : un appui ouvre l historique', async ({ page }) => {
  await bootInsp(page, [MGR, REPORTS, HISTORY], { pinToken: 'tok', hash: '#/reports' });
  await page.getByTestId('report-4').click();
  await expect(page).toHaveURL(/#\/history\/A$/);
});

test('rapports : bouton visible pour manager, absent pour cleaner', async ({ page }) => {
  await bootInsp(page, [MGR, TODAY, REPORTS], { pinToken: 'tok' });
  await expect(page.getByRole('button', { name: 'Reports' })).toBeVisible();
  await page.getByRole('button', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/#\/reports$/);
});
test('rapports : cleaner sans bouton Reports', async ({ page }) => {
  await bootInsp(page, [CLN, TODAY], { pinToken: 'tok' });
  await expect(page.getByRole('button', { name: 'Fleet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reports' })).toHaveCount(0);
});

test('rapports : etat vide', async ({ page }) => {
  await bootInsp(page, [MGR, { status: 200, match: 'action=insp.reports', body: { from: 'a', to: 'b', totals: { inspections: 0, apartments: 0, clean: 0, withIssues: 0, fixedOnSpot: 0, sentToMaintenance: 0, openTickets: 0 }, reports: [] } }], { pinToken: 'tok', hash: '#/reports' });
  await expect(page.getByText('No inspections in this period')).toBeVisible();
});

test('rapports : erreur serveur puis Retry', async ({ page }) => {
  await bootInsp(page, [MGR, { status: 500, match: 'action=insp.reports', once: true, body: { error: 'Database busy' } }, REPORTS], { pinToken: 'tok', hash: '#/reports' });
  await expect(page.getByText('Database busy')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('report-4')).toBeVisible();
});

test('rapports : echappement HTML et pas de defilement horizontal', async ({ page }) => {
  const evil = JSON.parse(JSON.stringify(REPORTS.body));
  evil.reports[0].name = '<img src=x onerror="window.__pwn=1">Apt';
  evil.reports[0].inspector = '<b id="pwn">Eve</b>';
  await bootInsp(page, [MGR, { ...REPORTS, body: evil }], { pinToken: 'tok', hash: '#/reports' });
  await expect(page.getByTestId('report-4')).toContainText('<b id="pwn">Eve</b>');
  expect(await page.locator('#pwn').count()).toBe(0);
  expect(await page.evaluate(() => (window as any).__pwn)).toBeUndefined();
  const w = await noHorizontalScroll(page);
  expect(w.scrollWidth).toBeLessThanOrEqual(w.clientWidth);
});
