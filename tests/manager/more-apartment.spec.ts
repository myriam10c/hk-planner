import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll, type FakeRoute } from './helpers';
import { isMobile, openJob, PLAN, PNOW } from './planning-fixtures';
import { detailTask, listBody } from './problem-fixtures';

// Reponses au format de supabase/functions/hostaway-proxy/mgr_apartment.ts.
const LIST_BODY = {
  listings: [
    { id: 'L1', apt: '308', bld: 'Binghatti Lavender', excluded: false },
    { id: 'L2', apt: '404', bld: 'Elysee 1', excluded: true },
    { id: 'L3', apt: '905', bld: 'Tower New', excluded: false },
  ],
};
const LINEN = { pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2, total: 22 };
const CLEANINGS = [
  { date: '2026-10-12', guest: 'Bo Ray', by: [], done: false, cancelled: false, linen: null, extra: null },
  { date: '2026-10-08', guest: 'Owner', by: ['Faiza'], done: false, cancelled: false, linen: null, extra: 'Deep clean' },
  { date: '2026-10-06', guest: 'Ann Lee', by: ['Faiza'], done: true, cancelled: false, linen: LINEN, extra: null },
  { date: '2026-10-01', guest: 'Cy Doe', by: [], done: false, cancelled: true, linen: null, extra: null },
];
const SHEET = {
  listing: { id: 'L1', apt: '308', bld: 'Binghatti Lavender' },
  health: { score: 62, openTickets: 3, urgentOpen: 1, overdueService: 1, ratingPenalty: 5 },
  cleanings: null,
  tickets: {
    open: [
      { ref: 'MNT-429', title: 'Gas not working', priority: 'urgent', createdAt: '2026-10-01T08:00:00Z', assignee: null },
      { ref: 'MNT-430', title: 'AC noisy', priority: 'normal', createdAt: '2026-09-20T08:00:00Z', assignee: 'Vendor CoolFix' },
    ],
    recent: [{ ref: 'MNT-400', title: 'Leak fixed', resolvedAt: '2026-09-02T08:00:00Z' }],
  },
  inspections: [
    { id: 71, finishedAt: '2026-10-08T06:40:00Z', inspector: 'Walter', result: 'clean', issues: 0 },
    { id: 69, finishedAt: '2026-09-20T06:40:00Z', inspector: 'Semax', result: 'maintenance', issues: 2 },
  ],
  security: {
    building: 'Binghatti Lavender',
    groups: [{ units: ['308', '309'], phone: '+971 50 111 2222', emails: ['sec@bl.test'], portal: 'https://portal.bl.test', notes: ['Gate code at desk'] }],
  },
  unavailable: [],
  generatedAt: '2026-10-09T07:00:00.000Z',
};
const EMPTY = {
  ...SHEET, listing: { id: 'L3', apt: '905', bld: 'Tower New' },
  health: { score: 100, openTickets: 0, urgentOpen: 0, overdueService: 0, ratingPenalty: 0 },
  cleanings: null, tickets: { open: [], recent: [] }, inspections: [], security: null,
};
const LIST: FakeRoute = { match: 'action=mgr.apartments', status: 200, body: LIST_BODY };
const ONE = (body: any = SHEET): FakeRoute => ({ match: 'action=mgr.apartment&', status: 200, body });
// Second appel de la fiche : declare avant ONE (la premiere route qui correspond gagne).
const CL = (cleanings: any[] = CLEANINGS, extra: any = {}, delay = 0): FakeRoute =>
  ({ match: 'part=cleanings', status: 200, delay, body: { listing: SHEET.listing, cleanings, unavailable: [], generatedAt: SHEET.generatedAt, ...extra } });
const boot = (page: any, hash: string, routes: FakeRoute[]) => bootMgr(page, [me(MANAGER), ...routes], { email: true, hash, clock: PNOW });

test('recherche : filtre par numero et par immeuble, pastille Excluded, lien vers la fiche', async ({ page }) => {
  await boot(page, '#/more/apartment', [LIST]);
  await expect(page.getByRole('heading', { name: 'Apartment', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'More', exact: true }).first()).toHaveAttribute('href', '#/more');
  const rows = page.locator('main .ap-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Apt 308 · Binghatti Lavender');
  await expect(rows.nth(1).locator('.pill')).toHaveText('Excluded');
  await expect(rows.nth(0).locator('.pill')).toHaveCount(0);
  const q = page.getByLabel('Search apartment or building');
  await q.fill('905');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Tower New');
  await q.fill('elysée');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Apt 404');
  await q.fill('zzz');
  await expect(rows).toHaveCount(0);
  await expect(page.locator('main')).toContainText('No apartment matches.');
  await q.fill('binghatti');
  await expect(rows.first()).toHaveAttribute('href', '#/more/apartment/L1');
});

test('fiche : en-tete, sante et ses parts, menages, tickets, inspections, contacts securite', async ({ page }) => {
  await boot(page, '#/more/apartment/L1', [LIST, CL(), ONE()]);
  await expect(page.getByRole('heading', { name: 'Apt 308 · Binghatti Lavender', exact: true })).toBeVisible();
  const urls = (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.apartment&')).map((l) => l.url);
  expect(urls[0]).toContain('listingId=L1');
  expect(urls[0]).not.toContain('part=');
  expect(urls[1]).toContain('part=cleanings');
  const health = page.locator('main [data-sec="health"]');
  await expect(health.locator('.ap-score')).toHaveText('62');
  await expect(health).toContainText('3 open tickets');
  await expect(health).toContainText('1 urgent or high');
  await expect(health).toContainText('1 overdue service');
  await expect(health).toContainText('Rating -5');

  const cl = page.locator('main [data-sec="cleanings"] .ap-item');
  await expect(cl).toHaveCount(4);
  await expect(cl.nth(0)).toContainText('Bo Ray');
  await expect(cl.nth(0)).toContainText('Unassigned');
  await expect(cl.nth(1)).toContainText('Deep clean');
  await expect(cl.nth(2)).toContainText('Faiza');
  await expect(cl.nth(2).locator('.pill')).toHaveText('Done');
  await expect(cl.nth(2)).toContainText('Linen 22');
  await expect(cl.nth(3).locator('.pill')).toHaveText('Cancelled');
  await expect(cl.nth(3)).not.toContainText('Unassigned');

  const open = page.locator('main [data-sec="open"] .ap-item');
  await expect(open).toHaveCount(2);
  await expect(open.nth(0)).toContainText('MNT-429');
  await expect(open.nth(0)).toContainText('Gas not working');
  await expect(open.nth(0)).toContainText('Urgent');
  await expect(open.nth(0)).toContainText('Unassigned');
  await expect(open.nth(1)).toContainText('Vendor CoolFix');
  await expect(page.locator('main [data-sec="recent"] .ap-item')).toContainText('MNT-400');
  await expect(page.locator('main [data-sec="recent"]')).toContainText('02/09');

  const ins = page.locator('main [data-sec="inspections"]');
  await expect(ins.locator('.ap-item')).toHaveCount(2);
  await expect(ins.locator('.ap-item').nth(0)).toContainText('Clean');
  await expect(ins.locator('.ap-item').nth(1)).toContainText('Maintenance');
  await expect(ins.locator('.ap-item').nth(1)).toContainText('2 issues');
  await expect(ins.getByRole('link', { name: 'Inspection history' })).toHaveAttribute('href', '#/inspections/history/L1');

  const sec = page.locator('main [data-sec="security"]');
  await expect(sec).toContainText('Binghatti Lavender');
  await expect(sec.getByRole('link', { name: 'sec@bl.test' })).toHaveAttribute('href', 'mailto:sec@bl.test');
  await expect(sec.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+971501112222');
  await expect(sec).toContainText('Gate code at desk');
  await expect(sec.getByRole('link', { name: 'Portal passwords and all buildings' })).toHaveAttribute('href', '#/more/security?q=Binghatti%20Lavender');
});

test('logement sans donnees : les quatre etats vides', async ({ page }) => {
  await boot(page, '#/more/apartment/L3', [LIST, CL([]), ONE(EMPTY)]);
  await expect(page.getByRole('heading', { name: 'Apt 905 · Tower New', exact: true })).toBeVisible();
  await expect(page.locator('main [data-sec="health"] .ap-score')).toHaveText('100');
  await expect(page.locator('main')).toContainText('No cleaning in the last 30 days.');
  await expect(page.locator('main')).toContainText('No open ticket.');
  await expect(page.locator('main')).toContainText('No inspection yet.');
  await expect(page.locator('main')).toContainText('No security contact for this building.');
});

test('source indisponible : la section le dit au lieu de l etat vide', async ({ page }) => {
  await boot(page, '#/more/apartment/L1', [LIST, CL([], { unavailable: ['cleanings'] }), ONE(EMPTY)]);
  await expect(page.locator('main [data-sec="cleanings"]')).toContainText('Could not load cleanings right now.');
  await expect(page.locator('main [data-sec="cleanings"]')).not.toContainText('No cleaning in the last 30 days.');
});

test('menages : la fiche s affiche tout de suite, « Loading cleanings... » puis les menages', async ({ page }) => {
  await boot(page, '#/more/apartment/L1', [LIST, CL(CLEANINGS, {}, 1200), ONE()]);
  await expect(page.locator('main [data-sec="open"] .ap-item').first()).toContainText('MNT-429');
  await expect(page.locator('main [data-sec="cleanings"]')).toContainText('Loading cleanings...');
  await expect(page.locator('main [data-sec="security"]')).toBeVisible();
  await expect(page.locator('main [data-sec="cleanings"] .ap-item')).toHaveCount(4);
  await expect(page.locator('main [data-sec="cleanings"]')).not.toContainText('Loading cleanings...');
});

test('menages : echec du second appel, Retry propre a la section sans toucher le reste', async ({ page }) => {
  await boot(page, '#/more/apartment/L1', [LIST,
    { match: 'part=cleanings', status: 502, body: { error: 'Hostaway is slow' }, once: true }, CL(), ONE()]);
  const sec = page.locator('main [data-sec="cleanings"]');
  await expect(sec).toContainText('Hostaway is slow');
  await expect(page.locator('main [data-sec="open"] .ap-item').first()).toContainText('MNT-429');
  await sec.getByRole('button', { name: 'Retry' }).click();
  await expect(sec.locator('.ap-item')).toHaveCount(4);
  const urls = (await fetchLog(page)).map((l) => l.url).filter((u) => u.includes('action=mgr.apartment&'));
  expect(urls.filter((u) => !u.includes('part=')).length).toBe(1);
  expect(urls.filter((u) => u.includes('part=cleanings')).length).toBe(2);
});

test('erreur du serveur affichee telle quelle, Retry relit la fiche', async ({ page }) => {
  await boot(page, '#/more/apartment/L9', [LIST,
    { match: 'action=mgr.apartment&', status: 404, body: { error: 'Apartment not found' }, once: true }, CL(), ONE()]);
  await expect(page.locator('main [role="alert"]')).toHaveText('Apartment not found');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Apt 308 · Binghatti Lavender', exact: true })).toBeVisible();
});

test('Planning : la fiche d un menage renvoie a la fiche logement', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: '#/planning', clock: PNOW });
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  await expect(page.locator('#sheet').getByRole('link', { name: 'Apartment sheet' })).toHaveAttribute('href', '#/more/apartment/L1');
});

test('Tasks : la fiche d une tache renvoie a la fiche logement', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.problems', status: 200, body: listBody() },
    { match: 'action=mgr.problem.get', status: 200, body: detailTask() }, LIST, CL(), ONE()], { email: true, clock: PNOW, hash: '#/tasks' });
  await page.locator('.prow').first().click();
  const link = page.locator('#sheet').getByRole('link', { name: 'Apartment sheet' });
  await expect(link).toHaveAttribute('href', '#/more/apartment/L1');
  await link.click();
  await expect(page.getByRole('heading', { name: 'Apt 308 · Binghatti Lavender', exact: true })).toBeVisible();
  await expect(page.locator('#sheet.on')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test('telephone ' + scheme + ' : aucun defilement horizontal, cibles de 44 px', async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 390, height: 800 });
    await boot(page, '#/more/apartment/L1', [LIST, CL(), ONE()]);
    await expect(page.locator('main [data-sec="security"]')).toBeVisible();
    let s = await noHorizontalScroll(page);
    expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    for (const el of await page.locator('main a, main button').all()) {
      if (!(await el.isVisible())) continue;
      expect((await el.boundingBox())!.height, await el.evaluate((n) => n.outerHTML.slice(0, 90))).toBeGreaterThanOrEqual(43.99);
    }
    await page.goto('/manager/#/more/apartment');
    await expect(page.locator('main .ap-row').first()).toBeVisible();
    s = await noHorizontalScroll(page);
    expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('main .ap-row')!).backgroundColor);
    const lum = await page.evaluate((c) => { const m = c.match(/\d+/g)!.map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; }, bg);
    if (scheme === 'dark') expect(lum).toBeLessThan(0.3); else expect(lum).toBeGreaterThan(0.7);
  });
}

test('fiche logement : les references de tickets sont des liens vers Maintenance', async ({ page }) => {
  await boot(page, '#/more/apartment/L1', [LIST, CL(), ONE()]);
  const link = page.locator('main [data-sec="open"]').getByRole('link', { name: 'MNT-429' });
  await expect(link).toHaveAttribute('href', '#/maintenance?ref=MNT-429');
  await expect(page.locator('main [data-sec="recent"]').getByRole('link', { name: 'MNT-400' })).toHaveAttribute('href', '#/maintenance?ref=MNT-400');
});
