import { test, expect } from '@playwright/test';
import { bootInsp, fetchLog, noHorizontalScroll } from './helpers';

// Forme reelle de cleanerMe (index.ts) : { status, cleaner: { id, name, color, role } }.
const ME = { status: 200, match: 'action=cleanerMe', body: { status: 'success', cleaner: { id: 3, name: 'Faiza', color: '#abc', role: 'cleaner' } } };
const card = (o: any) => ({ listingId: 'A', name: 'Apt 101 · Tower A', eligibility: { kind: 'checkout', checkOutTime: 12, nextCheckIn: { date: '2026-10-06', time: 15 } },
  daysSince: null, lastInspector: null, missed: 2, openIssue: false, claimedBy: null, claimedByName: null, inProgressBy: null, ...o });
const TODAY = { status: 200, match: 'action=insp.today', body: { day: '2026-10-06', target: 4, cachedAt: null,
  today: [card({}), card({ listingId: 'B', name: 'Apt 202 · Tower B', eligibility: { kind: 'vacant', nextArrival: '2026-10-10' }, daysSince: 35, lastInspector: 'Walter', missed: 0, claimedBy: 2, claimedByName: 'Walter' })],
  also: [card({ listingId: 'C', name: 'Apt 303 · Tower C', eligibility: { kind: 'vacant', nextArrival: null }, daysSince: 5, lastInspector: 'Harlene', missed: 0 })] } };

test('liste du jour : raisons, retard, badges, prise en charge', async ({ page }) => {
  await bootInsp(page, [ME, TODAY, { status: 200, match: 'action=insp.claim', body: { proposal: { listingId: 'A', claimedBy: 3, claimedByName: 'Faiza' } } }], { pinToken: 'tok' });
  await expect(page.getByText('Apt 101 · Tower A')).toBeVisible();
  await expect(page.getByText('Checkout 12:00 → Check-in 15:00')).toBeVisible();
  await expect(page.getByText('Never inspected')).toBeVisible();
  await expect(page.getByText('Missed 2×')).toBeVisible();
  await expect(page.getByText('Vacant · next arrival 10 Oct')).toBeVisible();
  await expect(page.getByText('Last inspected 35 days ago by Walter')).toBeVisible();
  await expect(page.getByText('Taken by Walter')).toBeVisible();
  await page.getByRole('button', { name: "I'll take it" }).first().click();
  await expect(page.getByRole('button', { name: 'Start inspection' })).toBeVisible();
  const log = await fetchLog(page);
  expect(log.some((l) => l.url.includes('insp.claim') && JSON.parse(l.body).listingId === 'A')).toBe(true);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('Hostaway indisponible : message et inspection ad hoc possible', async ({ page }) => {
  await bootInsp(page, [ME, { status: 503, match: 'action=insp.today', body: { error: 'Bookings are unavailable right now. Try again in a few minutes.' } }], { pinToken: 'tok' });
  await expect(page.getByText('Bookings are unavailable right now.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect another apartment' })).toBeVisible();
});

test('cache : bandeau de fraicheur', async ({ page }) => {
  const t = JSON.parse(JSON.stringify(TODAY)); t.body.cachedAt = '2026-10-06T05:12:00Z';
  await bootInsp(page, [ME, t], { pinToken: 'tok' });
  await expect(page.getByText('Bookings data from 09:12')).toBeVisible();
});

test('sans session : invitation a se connecter', async ({ page }) => {
  await bootInsp(page, [], {});
  await expect(page.getByText('Please sign in')).toBeVisible();
});
