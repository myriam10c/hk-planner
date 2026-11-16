import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, OWNER, noHorizontalScroll, type FakeRoute } from './helpers';

// Snapshot de novembre tel que le serveur le rend : le front ne calcule aucun montant.
const TEAM = {
  cleanings_count: 56, matched_count: 54, unmatched_count: 2, missing_fee_count: 3, shared_with_elite_count: 7,
  revenue_ttc: 13500, revenue_ht: 12857.14, vat_output: 642.86, cleaner_jobs: 74, cleaner_days: 37, per_cleaner_day: 2,
  by_cleaner: [
    { id: 18, name: 'Annet', cleanings: 27, days_worked: 13, per_day: 2.08, revenue_ht: 4700 },
    { id: 4, name: 'Fauzia <b>x</b>', cleanings: 23, days_worked: 12, per_day: 1.92, revenue_ht: 4100.5 },
  ],
};
const TOTALS = { cleanings_count: 78, revenue_ht: 22095.44, cost_ht: 14890, margin_ht: 7205.44, team: TEAM, potential_profit_ht: 20062.58 };
const NOV = {
  month: '2026-11',
  months: ['2026-11', '2026-10', '2026-09'],
  accounting: { computedAt: '2026-11-16T08:00:00Z', totals: TOTALS },
};
const OCT = { ...NOV, month: '2026-10', accounting: null };
const READS: FakeRoute[] = [
  { match: 'month=2026-10', status: 200, body: OCT },
  { match: 'action=mgr.reports', status: 200, body: NOV },
];
const FRESH = new Date('2026-11-16T09:00:00Z');
const withTeam = (team: any) => ({ ...NOV, accounting: { ...NOV.accounting, totals: { ...TOTALS, team } } });
const boot = (page: any, reads: FakeRoute[] = READS, clock = FRESH) =>
  bootMgr(page, [me(OWNER), ...reads], { email: true, hash: '#/more/money', clock });
const stat = (page: any, k: string) => page.locator('[data-mn="summary"] [data-mn-stat="' + k + '"]');

test('les trois chiffres, leurs sous-lignes, la note et l horodatage', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Cleaning money', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  const team = stat(page, 'team');
  await expect(team.locator('.mn-label')).toHaveText('Team revenue');
  await expect(team.locator('.mn-value')).toHaveText('AED 12,857.14');
  await expect(team.locator('.mn-sub')).toHaveText('56 cleanings done by your team');
  const elite = stat(page, 'elite');
  await expect(elite.locator('.mn-label')).toHaveText('Kept on Elite');
  await expect(elite.locator('.mn-value')).toHaveText('AED 7,205.44');
  await expect(elite.locator('.mn-sub')).toHaveText('78 cleanings · revenue AED 22,095.44 · Elite cost AED 14,890.00');
  const pot = stat(page, 'potential');
  await expect(pot.locator('.mn-label')).toHaveText('Potential profit');
  await expect(pot.locator('.mn-value')).toHaveText('AED 20,062.58');
  await expect(pot.locator('.mn-sub')).toHaveText('Team revenue + kept on Elite');
  await expect(page.locator('p.mn-note')).toHaveText('All amounts exclude VAT. Before variable costs: OTA commission, products, laundry, salaries.');
  await expect(page.locator('p.rp-fresh')).toContainText('Computed 16 Nov 2026, 12:00');
  await expect(page.getByText('Snapshot is older than 3 hours')).toHaveCount(0);
});

test('bloc equipe : moyenne, lignes par personne, nom echappe', async ({ page }) => {
  await boot(page);
  const sec = page.locator('[data-mn="team"]');
  await expect(sec.getByRole('heading', { name: 'Your team' })).toBeVisible();
  await expect(sec.locator('p.mn-avg')).toHaveText('Average: 2.0 cleanings per cleaner per day worked');
  const rows = sec.locator('.mn-person');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Annet');
  await expect(rows.nth(0)).toContainText('27 cleanings · 13 days · 2.1 per day');
  await expect(rows.nth(0)).toContainText('AED 4,700.00');
  await expect(rows.nth(1)).toContainText('Fauzia <b>x</b>');
  await expect(sec.locator('.mn-person b')).toHaveCount(0);
});

test('liste vide : message ; singulier des compteurs', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam({ ...TEAM, by_cleaner: [], cleanings_count: 1, missing_fee_count: 1, unmatched_count: 1, shared_with_elite_count: 1 }) }]);
  await expect(page.locator('[data-mn="team"]').getByText('No team cleanings this month.')).toBeVisible();
  await expect(stat(page, 'team').locator('.mn-sub')).toHaveText('1 cleaning done by your team');
  await expect(page.locator('ul.mn-flags li')).toHaveText([
    '1 team cleaning with no cleaning fee on the booking.',
    '1 team cleaning not matched to a booking, revenue not counted.',
    '1 cleaning with both Elite and a team member, counted as Elite.',
  ]);
});

test('alertes : trois li avec 3, 2 et 7 ; aucun ul quand tout est a zero', async ({ page }) => {
  await boot(page);
  await expect(page.locator('ul.mn-flags li')).toHaveText([
    '3 team cleanings with no cleaning fee on the booking.',
    '2 team cleanings not matched to a booking, revenue not counted.',
    '7 cleanings with both Elite and a team member, counted as Elite.',
  ]);
});

test('alertes a zero : aucun ul.mn-flags', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam({ ...TEAM, missing_fee_count: 0, unmatched_count: 0, shared_with_elite_count: 0 }) }]);
  await expect(stat(page, 'team').locator('.mn-value')).toHaveText('AED 12,857.14');
  await expect(page.locator('ul.mn-flags')).toHaveCount(0);
});

test('snapshot sans team ni potential : Not available, bloc elite normal', async ({ page }) => {
  const totals: any = { ...TOTALS };
  delete totals.team; delete totals.potential_profit_ht;
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: { ...NOV, accounting: { ...NOV.accounting, totals } } }]);
  await expect(stat(page, 'team').locator('.mn-value')).toHaveText('Not available');
  await expect(stat(page, 'team').getByText('Not available')).toHaveCount(1);
  await expect(stat(page, 'team').locator('.mn-sub')).toHaveText('');
  await expect(stat(page, 'potential').locator('.mn-sub')).toHaveText('Team revenue + kept on Elite');
  await expect(stat(page, 'potential').locator('.mn-value')).toHaveText('Not available');
  await expect(stat(page, 'elite').locator('.mn-value')).toHaveText('AED 7,205.44');
  await expect(page.locator('[data-mn="team"]').getByText('Team figures are not available for this month.')).toBeVisible();
});

test('sans snapshot : message, aucun chiffre ; changement de mois recharge avec month=', async ({ page }) => {
  await boot(page);
  await expect(stat(page, 'team').locator('.mn-value')).toBeVisible();
  const sel = page.locator('select[data-mn-month]');
  await expect(sel).toHaveValue('2026-11');
  await expect(sel.locator('option')).toHaveText(['November 2026', 'October 2026', 'September 2026']);
  await sel.selectOption('2026-10');
  await expect(page.getByText('No snapshot for this month yet.')).toBeVisible();
  await expect(page.locator('[data-mn-stat]')).toHaveCount(0);
  const urls = (await fetchLog(page)).map((l) => l.url).filter((u) => u.includes('mgr.reports'));
  expect(urls[0]).not.toContain('month=');
  expect(urls[1]).toContain('month=2026-10');
});

test('snapshot de plus de 3 heures : pastille d avertissement', async ({ page }) => {
  await boot(page, READS, new Date('2026-11-16T12:00:00Z'));
  await expect(page.getByText('Snapshot is older than 3 hours')).toBeVisible();
});

test('sans defilement horizontal avec un grand montant et un long nom', async ({ page }) => {
  const long = 'Abcdefghij'.repeat(4);
  const team = { ...TEAM, revenue_ht: 1234567.89, by_cleaner: [{ id: 1, name: long, cleanings: 5, days_worked: 3, per_day: 1.67, revenue_ht: 1234567.89 }] };
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam(team) }]);
  await expect(stat(page, 'team').locator('.mn-value')).toHaveText('AED 1,234,567.89');
  await expect(page.locator('.mn-person').first()).toContainText(long);
  const s = await noHorizontalScroll(page);
  expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
});

test('lecture en echec : message du serveur et Retry', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 503, body: { error: 'Reports are unavailable right now. Try again.' }, once: true }, ...READS]);
  await expect(page.locator('main').getByText('Reports are unavailable right now. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(stat(page, 'team').locator('.mn-value')).toBeVisible();
});

test('lien Elite invoice check vers Reports', async ({ page }) => {
  await boot(page);
  await expect(page.locator('a.btn[href="#/more/reports"]')).toHaveText('Elite invoice check');
});

test('computedAt absent ou illisible : Computed: Not available, pas de pastille', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: { ...NOV, accounting: { totals: TOTALS } } }]);
  await expect(page.locator('p.rp-fresh')).toContainText('Computed: Not available');
  await expect(page.getByText('Snapshot is older than 3 hours')).toHaveCount(0);
});

const SKIP_TXT = ' not counted: no checkout that day, or booking already counted.';

const QUIET = { ...TEAM, missing_fee_count: 0, unmatched_count: 0, shared_with_elite_count: 0 };
const bootTeam = (page: any, team: any) => boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam(team) }]);

test('alerte des affectations non comptees : singulier', async ({ page }) => {
  await bootTeam(page, { ...QUIET, skipped_count: 1 });
  await expect(page.locator('ul.mn-flags li')).toHaveText(['1 team assignment' + SKIP_TXT]);
});

test('alerte des affectations non comptees : pluriel', async ({ page }) => {
  await bootTeam(page, { ...QUIET, skipped_count: 4 });
  await expect(page.locator('ul.mn-flags li')).toHaveText(['4 team assignments' + SKIP_TXT]);
});

test('alerte des affectations non comptees : absente a 0', async ({ page }) => {
  await bootTeam(page, { ...QUIET, skipped_count: 0 });
  await expect(stat(page, 'team').locator('.mn-value')).toHaveText('AED 12,857.14');
  await expect(page.locator('ul.mn-flags')).toHaveCount(0);
});

test('alerte des affectations non comptees : absente sans la cle', async ({ page }) => {
  await bootTeam(page, QUIET);
  await expect(stat(page, 'team').locator('.mn-value')).toHaveText('AED 12,857.14');
  await expect(page.locator('ul.mn-flags')).toHaveCount(0);
});

test('singulier : un cleaner avec un menage et un jour', async ({ page }) => {
  const team = { ...TEAM, by_cleaner: [{ id: 4, name: 'Fauzia', cleanings: 1, days_worked: 1, per_day: 1, revenue_ht: 100 }] };
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam(team) }]);
  await expect(page.locator('.mn-person').first()).toContainText('1 cleaning · 1 day · 1.0 per day');
});

test('singulier : sous-ligne Elite avec un seul menage', async ({ page }) => {
  const body = { ...NOV, accounting: { ...NOV.accounting, totals: { ...TOTALS, cleanings_count: 1 } } };
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body }]);
  await expect(stat(page, 'elite').locator('.mn-sub')).toContainText('1 cleaning ·');
  await expect(stat(page, 'elite').locator('.mn-sub')).not.toContainText('1 cleanings');
});

test('non owner : message, aucune lecture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), ...READS], { email: true, hash: '#/more/money', clock: FRESH });
  await expect(page.locator('[data-mn="owner-only"]')).toHaveText('Only the owner can see this screen.');
  await expect(page.getByRole('heading', { name: 'Cleaning money', exact: true })).toBeVisible();
  await expect(page.locator('[data-mn="summary"]')).toHaveCount(0);
  const urls = (await fetchLog(page)).map((l) => l.url);
  expect(urls.filter((u) => u.includes('action=mgr.reports'))).toEqual([]);
});

test('alerte not done : singulier', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam({ ...TEAM, not_done_count: 1 }) }]);
  await expect(page.locator('.mn-flags li').first()).toHaveText('1 team cleaning not marked done, not counted.');
});

test('alerte not done : pluriel', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam({ ...TEAM, not_done_count: 4 }) }]);
  await expect(page.locator('.mn-flags li').first()).toHaveText('4 team cleanings not marked done, not counted.');
});

test('alerte not done : absente a 0', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam({ ...TEAM, not_done_count: 0 }) }]);
  await expect(page.locator('[data-mn="summary"]')).toBeVisible();
  await expect(page.getByText('not marked done')).toHaveCount(0);
});

test('alerte not done : absente sans la cle', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: withTeam({ ...TEAM }) }]);
  await expect(page.locator('[data-mn="summary"]')).toBeVisible();
  await expect(page.getByText('not marked done')).toHaveCount(0);
});
