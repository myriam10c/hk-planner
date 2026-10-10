import { test, expect } from '@playwright/test';

// Parite : manager/hr-rules.js doit rendre exactement ce que rendent les helpers purs
// de hr.js (racine) sur la meme table d'entrees. Toute derive fait echouer le test.
// Les deux sont charges dans une page vide du meme serveur.

const CASES: Record<string, any[][]> = {
  leaveDays: [
    ['2026-08-10', '2026-08-10'], ['2026-08-10', '2026-08-20'], ['2028-02-27', '2028-03-01'],
    ['2027-02-27', '2027-03-01'], ['2026-12-30', '2027-01-02'], ['2026-08-20', '2026-08-10'],
    ['nope', '2026-08-10'], ['', ''],
  ],
  completeMonths: [
    ['2026-01-15', '2026-02-14'], ['2026-01-15', '2026-02-15'], ['2028-01-31', '2028-02-29'],
    ['2024-02-29', '2025-02-28'], ['2026-05-01', '2026-01-01'], ['bad', '2026-01-01'],
    ['2020-03-10', '2026-10-11'],
  ],
  accruedAnnualDays: [
    ['2026-05-01', '2026-10-11', 0, null], ['2026-01-01', '2026-10-11', 0, null],
    ['2025-01-01', '2026-10-11', 0, null], ['2027-01-01', '2026-10-11', 0, null],
    ['2023-03-01', '2026-10-11', 12.5, '2026-01-01'], ['2026-08-01', '2026-10-11', 7, '2026-09-01'],
    ['2024-02-29', '2028-02-29', '3', null], ['2025-04-15', '2026-10-11', undefined, undefined],
  ],
  sickTiers: [[0], [15], [16], [45], [90], [91], [-3], ['20'], [null]],
  rangesOverlap: [
    ['2026-10-01', '2026-10-05', '2026-10-05', '2026-10-09'], ['2026-10-01', '2026-10-05', '2026-10-06', '2026-10-09'],
    ['2026-10-10', '2026-10-11', '2026-10-11', '2026-10-11'], ['2026-10-12', '2026-10-15', '2026-10-11', '2026-10-11'],
  ],
  gratuityEstimate: [
    ['2026-01-01', '2026-10-11', 3000, 0], ['2023-01-01', '2026-10-11', 3000, 0],
    ['2018-01-01', '2026-10-11', 3000, 40], ['2000-01-01', '2026-10-11', 3000, 0],
    ['2026-10-11', '2026-01-01', 3000, 0], ['2023-01-01', '2026-10-11', 0, 0],
    ['2024-02-29', '2028-02-29', '4500', '10'],
  ],
  daysUntil: [
    ['2026-12-10', '2026-10-11'], ['2026-10-01', '2026-10-11'], ['', '2026-10-11'],
    [null, '2026-10-11'], ['bad', '2026-10-11'], ['2028-03-01', '2028-02-28'],
  ],
};

const ROWS = [
  { id: 1, cleaner_id: 5, status: 'pending', start_date: '2026-10-20', end_date: '2026-10-22' },
  { id: 2, cleaner_id: 5, status: 'approved', start_date: '2026-10-01', end_date: '2026-10-12' },
  { id: 3, cleaner_id: 5, status: 'approved', start_date: '2026-09-01', end_date: '2026-09-03' },
  { id: 4, cleaner_id: 5, status: 'rejected', start_date: '2026-11-01', end_date: '2026-11-02' },
  { id: 5, cleaner_id: 6, status: 'pending', start_date: '2026-10-15', end_date: '2026-10-16' },
  { id: 6, cleaner_id: '5', status: 'cancelled', start_date: '2026-08-01', end_date: '2026-08-01' },
];
const HOLIDAYS = [
  { id: 1, holiday_date: '2027-03-20', name: 'Eid Al Fitr' },
  { id: 2, holiday_date: '2026-12-02', name: 'National Day' },
  { id: 3, holiday_date: '2026-10-01', name: 'Past' },
  { id: 4, holiday_date: '2026-10-11', name: 'Today' },
  null,
  { id: 5, holiday_date: '2027-01-01', name: 'New Year' },
];

test('hr-rules.js rend les memes sorties que hr.js sur toute la table', async ({ page }) => {
  await page.route('**/hr-parity.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>parity</title>' }));
  await page.goto('/hr-parity.html');
  await page.addScriptTag({ url: '/hr.js' });
  const out = await page.evaluate(async ({ cases, rows, holidays }) => {
    const m: any = await import('/manager/hr-rules.js' as any);
    const w = window as any;
    const res: Array<{ fn: string; args: any; legacy: any; mine: any }> = [];
    const run = (fn: string, args: any[]) => {
      const call = (f: any) => { try { return JSON.stringify(f(...args)); } catch (e: any) { return 'THROW ' + e.message; } };
      res.push({ fn, args, legacy: call(w[fn]), mine: call(m[fn]) });
    };
    for (const fn of Object.keys(cases)) for (const args of cases[fn]) run(fn, args);
    for (const today of ['2026-10-11', '2026-10-21', '2026-12-31']) {
      for (const cid of [5, '5', 6, 99]) run('hrSplitHistory', [rows, cid, today]);
      for (const limit of [undefined, 2, 999]) run('hrUpcomingHolidays', [holidays, today, limit]);
    }
    run('hrSplitHistory', [null, 5, '2026-10-11']);
    run('hrUpcomingHolidays', [null, '2026-10-11', 5]);
    for (const day of ['2026-12-02', '2026-12-03', '']) run('hrHolidayNameOn', [holidays, day]);
    run('hrHolidayNameOn', [undefined, '2026-12-02']);
    run('daysUntil', ['2026-12-10']);
    res.push({ fn: 'HR_LEAVE_TYPES', args: [], legacy: JSON.stringify(w.HR_LEAVE_TYPES), mine: JSON.stringify(m.HR_LEAVE_TYPES) });
    res.push({ fn: 'HR_DOC_TYPES', args: [], legacy: JSON.stringify(w.HR_DOC_TYPES), mine: JSON.stringify(m.HR_DOC_TYPES) });
    const names = ['leaveDays', 'completeMonths', 'accruedAnnualDays', 'sickTiers', 'rangesOverlap', 'gratuityEstimate',
      'daysUntil', 'hrSplitHistory', 'hrUpcomingHolidays', 'hrHolidayNameOn'];
    const missing = names.filter((n) => typeof m[n] !== 'function' || typeof w[n] !== 'function');
    return { res, missing };
  }, { cases: CASES, rows: ROWS, holidays: HOLIDAYS });
  expect(out.missing).toEqual([]);
  expect(out.res.length).toBeGreaterThan(60);
  for (const r of out.res) {
    expect(r.legacy, r.fn + ' ' + JSON.stringify(r.args)).not.toBeUndefined();
    expect(r.mine, r.fn + ' ' + JSON.stringify(r.args)).toBe(r.legacy);
  }
  // Valeurs de reference : la table exerce bien les paliers attendus.
  const pick = (fn: string, args: any[]) => out.res.find((r) => r.fn === fn && JSON.stringify(r.args) === JSON.stringify(args))!.mine;
  expect(JSON.parse(pick('sickTiers', [91]))).toEqual({ full: 15, half: 30, unpaid: 45, used: 91, remaining: 0 });
  expect(JSON.parse(pick('leaveDays', ['2028-02-27', '2028-03-01']))).toBe(4);
  expect(JSON.parse(pick('gratuityEstimate', ['2026-01-01', '2026-10-11', 3000, 0])).amount).toBe(0);
});
