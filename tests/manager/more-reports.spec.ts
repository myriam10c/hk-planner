import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';

// Snapshot de compta tel que le serveur le passe (valeurs flottantes brutes du job VPS).
const TOTALS = {
  cost_ht: 25705, vat_net: 724.05, cost_ttc: 26990.25, margin_ht: 14485.7, vat_input: 1285.25,
  by_service: { CHC: { count: 139, cost_ht: 25705, margin_ht: 14485.70000000001, revenue_ht: 40190.69999999995 } },
  margin_pct: 36.04241777326596, revenue_ht: 40190.7, vat_output: 2009.3,
  by_bedrooms: { '1BHK': { count: 48, cost_ht: 9360, margin_ht: 6116.08, revenue_ht: 15476.079999999996 }, STUDIO: { count: 91, cost_ht: 16345, margin_ht: 8369.62, revenue_ht: 24714.62 } },
  revenue_ttc: 42200, cleanings_count: 139,
};
const ROWS = [
  { guest: 'Ahmad, Hasan', nights: 13, cost_ht: 155, vat_net: 4.15, revenue_ttc: 250, cleaning_date: '2026-09-01', revenue_status: 'OK' },
  { guest: 'Kofi "K" Adu', nights: 2, cost_ht: 236, vat_net: null, revenue_ttc: 0, cleaning_date: '2026-09-02', revenue_status: 'MISSING_FEE' },
];
const props = (n: number) => Array.from({ length: n }, (_, i) => ({
  listingId: String(100 + i), apt: String(1000 + i), bld: i === 0 ? 'Azizi Riviera 20' : 'Tower ' + i, score: 40 + i, openTickets: i === 0 ? 3 : 0, urgentOpen: i === 0 ? 1 : 0,
}));
const SEP = {
  month: '2026-09',
  months: ['2026-10', '2026-09', '2026-08'],
  accounting: {
    computedAt: '2026-10-11T08:00:00Z', syncedAt: '2026-10-11T08:00:01Z', rowsCount: 139, unmatchedCount: 3,
    totals: TOTALS, rows: ROWS,
    unmatchedResa: [{ key: '2026-09-01_Kofi Adu', date: '2026-09-01', guest: 'Kofi Adu', service: 'CHC' }],
    unmatchedPricing: [],
  },
  ops: {
    avgCleaningTime: 51, totalTimerSessions: 212, openMaintenanceTickets: 17, resolvedThisMonth: 40, avgResolutionHours: 15,
    last7DaysCompletions: [
      { date: '2026-10-05', completions: 4 }, { date: '2026-10-06', completions: 0 }, { date: '2026-10-07', completions: 6 },
      { date: '2026-10-08', completions: 2 }, { date: '2026-10-09', completions: 5 }, { date: '2026-10-10', completions: 3 },
      { date: '2026-10-11', completions: 1 },
    ],
  },
  properties: props(25),
};
const OCT = {
  ...SEP, month: '2026-10', accounting: null,
  ops: { ...SEP.ops, avgCleaningTime: null, avgResolutionHours: null },
};
const READS: FakeRoute[] = [
  { match: 'month=2026-10', status: 200, body: OCT },
  { match: 'action=mgr.reports', status: 200, body: SEP },
];
const FRESH = new Date('2026-10-11T09:00:00Z');
const boot = (page: any, reads: FakeRoute[] = READS, clock = FRESH) =>
  bootMgr(page, [me(MANAGER), ...reads], { email: true, hash: '#/more/reports', clock });

test('compta Elite : totaux tels que stockes, ventilations, non rapproches, horodatage', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  const acc = page.locator('[data-rp="accounting"]');
  const stat = (label: string) => acc.locator('.rp-stat', { has: page.locator('span', { hasText: label }) }).locator('b');
  await expect(stat('Cleanings')).toHaveText('139');
  await expect(stat('Revenue incl. VAT')).toHaveText('AED 42,200.00');
  await expect(stat('Elite cost excl. VAT')).toHaveText('AED 25,705.00');
  await expect(stat('Margin excl. VAT')).toHaveText('AED 14,485.70');
  await expect(stat('Margin rate')).toHaveText('36.0%');
  await expect(stat('VAT net')).toHaveText('AED 724.05');
  await expect(acc.locator('.rp-fresh')).toContainText('Computed 11 Oct 2026, 12:00');
  await expect(acc.getByText('Snapshot is older than 3 hours')).toHaveCount(0);
  // Ventilations : valeurs stockees, aucune marge en % recalculee.
  const svc = acc.locator('[data-rp-break="by_service"]');
  await expect(svc).toContainText('By service');
  await expect(svc.locator('.rp-brow')).toHaveCount(1);
  await expect(svc.locator('.rp-brow').first()).toContainText('CHC');
  await expect(svc.locator('.rp-brow').first()).toContainText('139');
  await expect(svc.locator('.rp-brow').first()).toContainText('AED 40,190.70');
  await expect(svc.locator('.rp-brow').first()).toContainText('AED 14,485.70');
  await expect(acc.locator('[data-rp-break="by_bedrooms"] .rp-brow')).toHaveCount(2);
  await expect(acc.locator('.rp-brow', { hasText: '%' })).toHaveCount(0);
  // Non rapproches : compte stocke, listes repliables.
  await expect(stat('Unmatched')).toHaveText('3');
  const ur = acc.locator('details', { hasText: 'Unmatched reservations (1)' });
  await expect(ur.locator('li').first()).toBeHidden();
  await ur.locator('summary').click();
  await expect(ur.locator('li')).toHaveText(['2026-09-01_Kofi Adu · 2026-09-01 · Kofi Adu · CHC']);
  await expect(acc.locator('details', { hasText: 'Unmatched pricing (0)' })).toHaveCount(1);
});

test('compta : valeur absente = Not available, jamais 0', async ({ page }) => {
  const t = { ...TOTALS } as any;
  delete t.vat_net; t.margin_pct = null;
  await boot(page, [{ match: 'action=mgr.reports', status: 200, body: { ...SEP, accounting: { ...SEP.accounting, totals: t, unmatchedCount: null } } }]);
  const acc = page.locator('[data-rp="accounting"]');
  const stat = (label: string) => acc.locator('.rp-stat', { has: page.locator('span', { hasText: label }) }).locator('b');
  await expect(stat('VAT net')).toHaveText('Not available');
  await expect(stat('Margin rate')).toHaveText('Not available');
  await expect(stat('Unmatched')).toHaveText('Not available');
  await expect(stat('Cleanings')).toHaveText('139');
});

test('snapshot de plus de 3 heures : pastille d avertissement', async ({ page }) => {
  await boot(page, READS, new Date('2026-10-11T11:30:00Z'));
  await expect(page.locator('[data-rp="accounting"]').getByText('Snapshot is older than 3 hours')).toBeVisible();
});

test('sans snapshot : message, pas de chiffre ; mois choisi recharge avec month=', async ({ page }) => {
  await boot(page);
  await expect(page.locator('[data-rp="accounting"] .rp-stat').first()).toBeVisible();
  const sel = page.getByLabel('Month');
  await expect(sel).toHaveValue('2026-09');
  await expect(sel.locator('option')).toHaveText(['October 2026', 'September 2026', 'August 2026']);
  await sel.selectOption('2026-10');
  const acc = page.locator('[data-rp="accounting"]');
  await expect(acc.getByText('No accounting snapshot for this month yet.')).toBeVisible();
  await expect(acc.locator('.rp-stat')).toHaveCount(0);
  await expect(acc.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
  const urls = (await fetchLog(page)).map((l) => l.url).filter((u) => u.includes('mgr.reports'));
  expect(urls[0]).not.toContain('month=');
  expect(urls[1]).toContain('month=2026-10');
  // Operations sans chrono ni resolution ce mois : Not available.
  const ops = page.locator('[data-rp="ops"]');
  await expect(ops.locator('.rp-stat', { hasText: 'Average cleaning time' }).locator('b')).toHaveText('Not available');
  await expect(ops.locator('.rp-stat', { hasText: 'Average resolution' }).locator('b')).toHaveText('Not available');
});

test('Download CSV : lignes du snapshot telles quelles, colonnes dans l ordre stocke', async ({ page }) => {
  await boot(page);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-rp="accounting"]').getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe('elite_accounting_2026-09.csv');
  const bytes = fs.readFileSync((await dl.path())!);
  // BOM UTF-8 en tete (Excel), puis les valeurs telles quelles.
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const text = bytes.toString('utf8');
  expect(text).toBe('\ufeff' + [
    'guest,nights,cost_ht,vat_net,revenue_ttc,cleaning_date,revenue_status',
    '"Ahmad, Hasan",13,155,4.15,250,2026-09-01,OK',
    '"Kofi ""K"" Adu",2,236,,0,2026-09-02,MISSING_FEE',
  ].join('\n'));
});

test('operations : indicateurs et 7 derniers jours', async ({ page }) => {
  await boot(page);
  const ops = page.locator('[data-rp="ops"]');
  const stat = (label: string) => ops.locator('.rp-stat', { has: page.locator('span', { hasText: label }) }).locator('b');
  await expect(stat('Average cleaning time')).toHaveText('51 min');
  await expect(stat('Timer sessions')).toHaveText('212');
  await expect(stat('Open tickets')).toHaveText('17');
  await expect(stat('Resolved in September 2026')).toHaveText('40');
  await expect(stat('Average resolution')).toHaveText('15 h');
  await expect(ops.locator('.rp-day')).toHaveCount(7);
  await expect(ops.locator('.rp-day').nth(2)).toContainText('6');
  await expect(ops.locator('.rp-day').nth(6)).toContainText('Sun');
});

test('sante des logements : pire en premier, 20 puis Show all, lien vers la fiche', async ({ page }) => {
  await boot(page);
  const pr = page.locator('[data-rp="properties"]');
  await expect(pr.locator('a.rp-prop')).toHaveCount(20);
  const first = pr.locator('a.rp-prop').first();
  await expect(first).toHaveAttribute('href', '#/more/apartment/100');
  await expect(first).toContainText('1000 · Azizi Riviera 20');
  await expect(first).toContainText('40');
  await expect(first).toContainText('3 open · 1 urgent');
  await pr.getByRole('button', { name: 'Show all (25)' }).click();
  await expect(pr.locator('a.rp-prop')).toHaveCount(25);
  await first.click();
  await expect(page).toHaveURL(/#\/more\/apartment\/100$/);
});

test('exports : telechargement authentifie du mois, erreur serveur affichee', async ({ page }) => {
  await boot(page, [
    { match: 'action=exportMaintenanceCsv', status: 403, body: { error: 'Only managers can do this.' } },
    { match: 'action=exportCleaningsCsv', status: 200, body: null, raw: 'checkout_date,guest_name\n2026-09-01,A\n' },
    ...READS,
  ]);
  const ex = page.locator('[data-rp="exports"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), ex.getByRole('button', { name: 'Cleanings CSV' }).click()]);
  expect(dl.suggestedFilename()).toBe('cleanings_2026-09.csv');
  expect(fs.readFileSync((await dl.path())!, 'utf8')).toBe('checkout_date,guest_name\n2026-09-01,A\n');
  const call = (await fetchLog(page)).find((l) => l.url.includes('exportCleaningsCsv'))!;
  expect(call.url).toContain('month=2026-09');
  expect(call.headers['Authorization']).toMatch(/^Bearer /);
  expect(call.headers['X-App-Secret']).toBeTruthy();
  await ex.getByRole('button', { name: 'Maintenance CSV' }).click();
  await expect(ex.getByRole('alert')).toHaveText('Only managers can do this.');
  await expect(ex.getByRole('button', { name: 'Maintenance CSV' })).toBeEnabled();
});

test('export : un corps qui n arrive jamais est coupe par le delai, message et bouton libre', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), ...READS], { email: true, hash: '#/more/reports', clock: FRESH, timeoutMs: 600 });
  const ex = page.locator('[data-rp="exports"]');
  await expect(ex.getByRole('button', { name: 'Cleanings CSV' })).toBeVisible();
  // En-tetes tout de suite, corps qui ne vient jamais.
  await page.evaluate(() => {
    const orig = window.fetch;
    window.fetch = ((u: any, i: any) => String(u).includes('exportCleaningsCsv')
      ? Promise.resolve({ ok: true, status: 200, blob: () => new Promise(() => {}), json: () => Promise.resolve({}) } as any)
      : orig(u, i)) as any;
  });
  await ex.getByRole('button', { name: 'Cleanings CSV' }).click();
  await expect(ex.getByRole('alert')).toContainText('taking too long');
  await expect(ex.getByRole('button', { name: 'Cleanings CSV' })).toBeEnabled();
});

test('rapports d inspection : lien', async ({ page }) => {
  await boot(page);
  await expect(page.getByRole('link', { name: 'Open inspection reports' })).toHaveAttribute('href', '#/inspections/reports');
});

test('lecture en echec : message du serveur et Retry', async ({ page }) => {
  await boot(page, [{ match: 'action=mgr.reports', status: 503, body: { error: 'Reports are unavailable right now. Try again.' }, once: true }, ...READS]);
  await expect(page.locator('main').getByText('Reports are unavailable right now. Try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-rp="accounting"] .rp-stat').first()).toBeVisible();
});

test('le hub mene a l ecran', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), ...READS], { email: true, hash: '#/more', clock: FRESH });
  await page.locator('main a.more-row', { hasText: 'Reports' }).click();
  await expect(page).toHaveURL(/#\/more\/reports$/);
  await expect(page.locator('[data-rp="accounting"]')).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('sans defilement horizontal, cibles de 44 px, texte de 16 px (' + scheme + ')', async ({ page }) => {
      await boot(page);
      await expect(page.locator('[data-rp="accounting"] .rp-stat').first()).toBeVisible();
      for (const d of await page.locator('main details summary').all()) await d.click();
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      for (const b of await page.locator('main button:not([disabled]), main a, main summary, main select').all()) {
        const box = await b.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      for (const sel of ['.rp-stat span', '.rp-fresh', '.rp-brow', '.rp-prop']) {
        expect(await page.locator(sel).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
      }
    });
  });
}
