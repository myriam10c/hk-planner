import { test, expect } from '@playwright/test';
import { bootInsp, fetchLog } from './helpers';

const MGR = { status: 200, match: 'action=cleanerMe', body: { cleaner: { cleaner_id: 2, name: 'Walter', role: 'manager' } } };
const OVERVIEW = { status: 200, match: 'action=insp.overview', body: { coveragePct: 33, inspectedThisMonth: 12, rows: [
  { listingId: 'C', name: 'Apt 303 · Tower C', excluded: false, lastAt: null, lastInspector: null, daysSince: null, color: 'red', openIssues: 0, missed: 2 },
  { listingId: 'B', name: 'Apt 202 · Tower B', excluded: false, lastAt: '2026-09-25T06:00:00Z', lastInspector: 'Faiza', daysSince: 11, color: 'green', openIssues: 1, missed: 0 },
  { listingId: 'X', name: 'Apt 999 · Gone', excluded: true, lastAt: null, lastInspector: null, daysSince: null, color: 'red', openIssues: 0, missed: 0 },
] } };
const HISTORY = { status: 200, match: 'action=insp.history', body: { listingId: 'B', name: 'Apt 202 · Tower B', inspections: [
  { id: 2, inspector: 'Faiza', startedAt: '2026-09-25T05:30:00Z', finishedAt: '2026-09-25T06:00:00Z', eligibility: 'checkout', generalNote: 'Good overall',
    items: [{ zone: 'ac', label: 'AC', status: 'not_ok', note: 'Leak', outcome: 'maintenance', fixNote: null, ticket: { id: 50, status: 'open', title: 'AC: Leak' },
      photos: [{ kind: 'issue', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }] }] }] } };

test('parc : couverture, lignes, historique', async ({ page }) => {
  await bootInsp(page, [MGR, OVERVIEW, HISTORY], { pinToken: 'tok', hash: '#/fleet' });
  await expect(page.getByText('33% of apartments inspected in the last 30 days')).toBeVisible();
  await expect(page.getByText('Never inspected')).toBeVisible();
  await expect(page.getByText('1 open issue')).toBeVisible();
  await expect(page.getByText('Excluded', { exact: true })).toBeVisible();
  await page.getByText('Apt 202 · Tower B').click();
  await expect(page.getByText('Ticket #50 · open')).toBeVisible();
  await expect(page.getByText('Good overall')).toBeVisible();
  await expect(page.getByText('25 Sep 2026 · Faiza · Checkout')).toBeVisible();
});

test('manager : exclure un logement', async ({ page }) => {
  await bootInsp(page, [MGR, OVERVIEW, { status: 200, match: 'action=insp.setExcluded', body: { listingId: 'C', excluded: true } }], { pinToken: 'tok', hash: '#/fleet' });
  await page.getByTestId('row-C').getByRole('button', { name: 'Exclude from inspections' }).click();
  await expect(page.getByTestId('row-C').getByText('Excluded')).toBeVisible();
  const log = await fetchLog(page);
  expect(log.filter((l) => l.url.includes('insp.setExcluded') && JSON.parse(l.body).excluded === true)).toHaveLength(1);
});

test('cleaner : pas de bouton exclure', async ({ page }) => {
  const me = { status: 200, match: 'action=cleanerMe', body: { cleaner: { cleaner_id: 3, name: 'Faiza', role: 'cleaner' } } };
  await bootInsp(page, [me, OVERVIEW], { pinToken: 'tok', hash: '#/fleet' });
  await expect(page.getByText('Never inspected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exclude from inspections' })).toHaveCount(0);
});

test('historique : photo en grand', async ({ page }) => {
  await bootInsp(page, [MGR, HISTORY], { pinToken: 'tok', hash: '#/history/B' });
  await page.getByRole('button', { name: 'Open photo' }).click();
  await expect(page.locator('dialog.photo[open]')).toBeVisible();
});

test('parc : la recherche ne reprend pas le focus apres Exclude', async ({ page }) => {
  await bootInsp(page, [MGR, OVERVIEW, { status: 200, match: 'action=insp.setExcluded', body: { listingId: 'C', excluded: true } }], { pinToken: 'tok', hash: '#/fleet' });
  await page.locator('#fq').fill('Apt');
  await page.getByTestId('row-C').getByRole('button', { name: 'Exclude from inspections' }).click();
  await expect(page.getByTestId('row-C').getByText('Excluded')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement && (document.activeElement as HTMLElement).id)).not.toBe('fq');
});

test('parc : saisie lettre par lettre garde la valeur et le focus', async ({ page }) => {
  await bootInsp(page, [MGR, OVERVIEW], { pinToken: 'tok', hash: '#/fleet' });
  await page.locator('#fq').click();
  await page.locator('#fq').pressSequentially('Apt 3');
  await expect(page.locator('#fq')).toHaveValue('Apt 3');
  await expect(page.locator('#fq')).toBeFocused();
});

// Erreur de chargement : Retry relance la lecture de l'entree (Loading… pendant ce temps),
// un double appui n'envoie qu'une requete. Refus 403 : Back a la place de Retry.
const count = async (page: any, action: string) => (await fetchLog(page)).filter((l) => l.url.includes('action=' + action)).length;

test('parc : erreur de chargement, Retry recharge (Loading…), double appui = une requete', async ({ page }) => {
  await bootInsp(page, [MGR, { status: 500, match: 'action=insp.overview', body: { error: 'Server error' }, once: true }, { ...OVERVIEW, delay: 800 }],
    { pinToken: 'tok', hash: '#/fleet' });
  await expect(page.getByText('Server error')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).dblclick();
  await expect(page.getByText('Loading…')).toBeVisible();
  await expect(page.getByText('Never inspected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  expect(await count(page, 'insp.overview')).toBe(2);
});

test('parc : refus 403, Back et pas de Retry', async ({ page }) => {
  await bootInsp(page, [MGR, { status: 403, match: 'action=insp.overview', body: { error: 'forbidden' } }], { pinToken: 'tok', hash: '#/fleet' });
  await expect(page.getByText('forbidden')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/inspections\/#\/$/);
});

test('historique : erreur de chargement, Retry recharge (Loading…), double appui = une requete', async ({ page }) => {
  await bootInsp(page, [MGR, { status: 500, match: 'action=insp.history', body: { error: 'Server error' }, once: true }, { ...HISTORY, delay: 800 }],
    { pinToken: 'tok', hash: '#/history/B' });
  await expect(page.getByText('Server error')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).dblclick();
  await expect(page.getByText('Loading…')).toBeVisible();
  await expect(page.getByText('Good overall')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  expect(await count(page, 'insp.history')).toBe(2);
});

test('historique : refus 403, Back et pas de Retry', async ({ page }) => {
  await bootInsp(page, [MGR, { status: 403, match: 'action=insp.history', body: { error: 'forbidden' } }], { pinToken: 'tok', hash: '#/history/B' });
  await expect(page.getByText('forbidden')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/#\/fleet$/);
});
