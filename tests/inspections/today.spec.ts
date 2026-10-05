import { test, expect } from '@playwright/test';
import { bootInsp, fetchLog, noHorizontalScroll } from './helpers';

// Forme reelle de cleanerMe (index.ts) : { status, cleaner: { id, name, color, role } }.
const ME = { status: 200, match: 'action=cleanerMe', body: { status: 'success', cleaner: { id: 3, name: 'Faiza', color: '#abc', role: 'cleaner' } } };
const card = (o: any) => ({ listingId: 'A', name: 'Apt 101 · Tower A', eligibility: { kind: 'checkout', checkOutTime: 12, nextCheckIn: { date: '2026-10-06', time: 15 } },
  daysSince: null, lastInspector: null, missed: 2, openIssue: false, claimedBy: null, claimedByName: null, inProgressBy: null, inProgressById: null, doneToday: null, ...o });
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

const MGR = { status: 200, match: 'action=cleanerMe', body: { status: 'success', cleaner: { id: 1, name: 'Hillal', color: '#abc', role: 'manager' } } };

test('double appui sur "I\'ll take it" : une seule requete claim', async ({ page }) => {
  await bootInsp(page, [ME, TODAY, { status: 200, match: 'action=insp.claim', delay: 300, body: { proposal: { listingId: 'A', claimedBy: 3, claimedByName: 'Faiza' } } }], { pinToken: 'tok' });
  const btn = page.getByRole('button', { name: "I'll take it" }).first();
  await expect(btn).toBeVisible();
  await btn.dblclick();
  await expect(page.getByRole('button', { name: 'Start inspection' })).toBeVisible();
  const log = await fetchLog(page);
  expect(log.filter((l) => l.url.includes('insp.claim')).length).toBe(1);
});

test('409 : message du serveur et liste rechargee', async ({ page }) => {
  const t2 = JSON.parse(JSON.stringify(TODAY.body));
  t2.today[0].claimedBy = 2; t2.today[0].claimedByName = 'Walter';
  t2.today[1].claimedBy = null; t2.today[1].claimedByName = null;
  await bootInsp(page, [ME,
    { ...TODAY, once: true },
    { status: 409, match: 'action=insp.claim', body: { error: 'Already taken by Walter.' } },
    { status: 200, match: 'action=insp.today', body: t2 }], { pinToken: 'tok' });
  await page.getByRole('button', { name: "I'll take it" }).first().click();
  await expect(page.getByText('Already taken by Walter.')).toBeVisible();
  await expect(page.getByText('Taken by Walter', { exact: true })).toBeVisible();
});

test('manager : Release et Assign, sous-traitants et inactifs exclus', async ({ page }) => {
  await bootInsp(page, [MGR, TODAY,
    { status: 200, match: 'action=insp.unclaim', body: { proposal: { listingId: 'B', claimedBy: null, claimedByName: null } } },
    { status: 200, match: 'action=getCleaners', body: { status: 'success', cleaners: [
      { id: 2, name: 'Walter', role: 'maintenance', is_active: true },
      { id: 3, name: 'Faiza', role: 'cleaner', is_active: true },
      { id: 4, name: 'SubCo', role: 'subcontractor', is_active: true },
      { id: 5, name: 'Gone', role: 'cleaner', is_active: false }] } },
    { status: 200, match: 'action=insp.assign', body: { proposal: { listingId: 'A', claimedBy: 3, claimedByName: 'Faiza' } } }], { pinToken: 'tok' });
  await expect(page.getByText('Taken by Walter')).toBeVisible();
  await page.getByRole('button', { name: 'Release' }).click();
  await expect(page.getByText('Taken by Walter')).toHaveCount(0);
  let log = await fetchLog(page);
  expect(log.some((l) => l.url.includes('insp.unclaim') && JSON.parse(l.body).listingId === 'B')).toBe(true);
  await page.getByRole('button', { name: 'Assign' }).first().click();
  await expect(page.getByRole('button', { name: 'Faiza' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Walter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'SubCo' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gone' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Faiza' }).click();
  await expect(page.getByText('Taken by Faiza').first()).toBeVisible();
  log = await fetchLog(page);
  const a = log.find((l) => l.url.includes('insp.assign'));
  expect(JSON.parse(a!.body)).toEqual({ listingId: 'A', cleanerId: 3 });
});

test('echappement HTML du nom de logement', async ({ page }) => {
  const t = JSON.parse(JSON.stringify(TODAY.body));
  t.today[0].name = '<img src=x onerror="window.__xss=1">';
  await bootInsp(page, [ME, { ...TODAY, body: t }], { pinToken: 'tok' });
  await expect(page.getByText('<img src=x onerror="window.__xss=1">')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('Inspect another apartment : liste, exclus masques, navigation ad hoc', async ({ page }) => {
  await bootInsp(page, [ME, TODAY, { status: 200, match: 'action=insp.overview', body: { coveragePct: 50, inspectedThisMonth: 3, rows: [
    { listingId: 'X1', name: 'Apt 900 · Tower X', excluded: false },
    { listingId: 'X2', name: 'Apt 901 · Tower Y', excluded: true }] } }], { pinToken: 'tok' });
  await page.getByRole('button', { name: 'Inspect another apartment' }).click();
  await expect(page.getByRole('button', { name: 'Apt 900 · Tower X' })).toBeVisible();
  await expect(page.getByText('Apt 901 · Tower Y')).toHaveCount(0);
  await page.getByRole('button', { name: 'Apt 900 · Tower X' }).click();
  await expect(page).toHaveURL(/#\/inspect\/X1\?e=adhoc$/);
});

test('erreur reseau au boot : Retry, pas "Please sign in"', async ({ page }) => {
  await bootInsp(page, [{ status: 500, match: 'action=cleanerMe', body: { error: 'boom' } }], { pinToken: 'tok' });
  await expect(page.getByText('Could not load. Check your connection and try again.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByText('Please sign in')).toHaveCount(0);
});

test('reprise : l\'auteur voit Resume inspection, un autre voit In progress by', async ({ page }) => {
  const t = JSON.parse(JSON.stringify(TODAY.body));
  t.today[0].inProgressBy = 'Faiza'; t.today[0].inProgressById = 3; t.today[0].claimedBy = 3; t.today[0].claimedByName = 'Faiza';
  await bootInsp(page, [ME, { ...TODAY, body: t }], { pinToken: 'tok' });
  await page.getByRole('button', { name: 'Resume inspection' }).click();
  await expect(page).toHaveURL(/#\/inspect\/A\?e=checkout/);
});

test('reprise : un autre utilisateur voit In progress by Faiza', async ({ page }) => {
  const t = JSON.parse(JSON.stringify(TODAY.body));
  t.today[0].inProgressBy = 'Faiza'; t.today[0].inProgressById = 3;
  await bootInsp(page, [MGR, { ...TODAY, body: t }], { pinToken: 'tok' });
  await expect(page.getByText('In progress by Faiza')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume inspection' })).toHaveCount(0);
});

test('carte terminee : Done by, sans bouton de prise en charge', async ({ page }) => {
  const t = JSON.parse(JSON.stringify(TODAY.body));
  t.today = [card({ doneToday: { by: 'Walter', at: '2026-10-06T06:42:00Z' }, daysSince: 0, lastInspector: 'Walter' })];
  t.also = [];
  await bootInsp(page, [ME, { ...TODAY, body: t }], { pinToken: 'tok' });
  await expect(page.getByText('Done by Walter at 10:42')).toBeVisible();
  await expect(page.getByRole('button', { name: "I'll take it" })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start inspection' })).toHaveCount(0);
});

test('en-tete : lien retour vers HK Planner', async ({ page }) => {
  await bootInsp(page, [ME, TODAY], { pinToken: 'tok' });
  await expect(page.getByRole('link', { name: 'Back to HK Planner' })).toHaveAttribute('href', '/');
});

test('date de prochaine arrivee en septembre : Sep', async ({ page }) => {
  const t = JSON.parse(JSON.stringify(TODAY.body));
  t.today = [card({ eligibility: { kind: 'vacant', nextArrival: '2026-09-10' } })]; t.also = [];
  await bootInsp(page, [ME, { ...TODAY, body: t }], { pinToken: 'tok' });
  await expect(page.getByText('Vacant · next arrival 10 Sep', { exact: true })).toBeVisible();
});

test('session stale : ecran Retry et non "Please sign in"', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hkAuthSession', JSON.stringify({ access_token: 'x', refresh_token: 'r', expires_at: 1 }));
      Object.defineProperty(navigator, 'onLine', { get: () => false });
    } catch (e) { /* stockage indisponible */ }
  });
  await bootInsp(page, [ME, TODAY], {});
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByText('Please sign in')).toHaveCount(0);
});
