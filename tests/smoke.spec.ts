import { test, expect, Page } from '@playwright/test';

// Smoke tests — fast post-deploy sanity checks that catch the bug classes
// we've actually shipped: CSS cascade regressions, getAllData filter bugs,
// missing JS globals, broken sidebar/table layout.
//
// Run against prod: `npm test`
// Or against any URL: `HK_PLANNER_URL=https://my-preview.netlify.app npm test`

const consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));
});

test.afterEach(async () => {
  // Ignore expected noise — Supabase auth pings, manifest 404s on subdomain, etc.
  const meaningful = consoleErrors.filter(e =>
    !/favicon|manifest|workbox|service[\s-]?worker/i.test(e)
    && !/Failed to load resource/i.test(e)
  );
  expect.soft(meaningful, `Unexpected console errors:\n${meaningful.join('\n')}`).toEqual([]);
});

test('page loads, no JS errors, app shell renders', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // App container exists
  await expect(page.locator('#app')).toBeAttached();
  // Title is set
  await expect(page).toHaveTitle(/HK Planner|Housekeeping|Planner/i);
});

test('global render() ran and exposed expected helpers', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Wait for hydration
  await page.waitForFunction(() => typeof (window as any).render === 'function', null, { timeout: 10_000 });
  const probe = await page.evaluate(() => ({
    render: typeof (window as any).render,
    api: typeof (window as any).api,
    renderPlannerTable: typeof (window as any).renderPlannerTable,
    keyFor: typeof (window as any).keyFor,
    plannerViewMode: typeof (window as any).plannerViewMode,
  }));
  expect(probe.render).toBe('function');
  expect(probe.api).toBe('function');
  expect(probe.renderPlannerTable).toBe('function');
  expect(probe.keyFor).toBe('function');
});

test('planner table view renders 7 columns when toggled', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Table view is desktop-only');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderPlannerTable === 'function');

  // Mock data + force render of the table to avoid auth/data dependency
  const colInfo = await page.evaluate(() => {
    const w = window as any;
    if (typeof w.cleaners !== 'undefined') {
      w.cleaners.length = 0;
      w.cleaners.push({ id: 1, name: 'Test', color: '#888' });
    }
    document.body.classList.add('planner-table-mode');
    const mock = [
      { co: '2026-04-26', guest: 'A', listing: 'JLT 1', listingId: '1', _reservationKey: 'k1' },
      { co: '2026-04-26', guest: 'B', listing: 'JLT 2', listingId: '2', _reservationKey: 'k2' },
    ];
    document.getElementById('app')!.innerHTML =
      '<div class="container"><div class="planner-two-col"><div class="planner-main">'
      + w.renderPlannerTable(mock) + '</div></div></div>';
    const ths = Array.from(document.querySelectorAll('.compact-table thead th'));
    const r1 = document.querySelector('.compact-table tbody tr')!;
    const cells = Array.from(r1.querySelectorAll('td'));
    return {
      headerCount: ths.length,
      cellCount: cells.length,
      headers: ths.map(t => t.textContent?.trim()),
      // All cells should be on the same baseline (same y) — regression check for the
      // `display: -webkit-box` on td bug that stacked guest/property vertically.
      ys: cells.map(td => Math.round(td.getBoundingClientRect().y)),
    };
  });

  expect(colInfo.headerCount).toBe(7);
  expect(colInfo.cellCount).toBe(7);
  expect(colInfo.headers).toEqual(expect.arrayContaining(['Date', 'Guest', 'Property', 'Cleaner', 'Status', 'Actions']));
  // All 7 cells share a single y-coordinate (allow 2px wiggle for sub-pixel rounding)
  const minY = Math.min(...colInfo.ys);
  const maxY = Math.max(...colInfo.ys);
  expect(maxY - minY, `cell ys: ${colInfo.ys.join(',')}`).toBeLessThanOrEqual(2);
});

test('container has a desktop max-width on desktop viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop-only check');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Inject a probe div with class "container" — the cascade matters more than auth state
  const w = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'container';
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  });
  // Regression check: at 1440px viewport, container max-width was leaking to 700px (mobile rule
  // came after desktop @media in source). Should be ≥1000.
  expect(w, `.container width was ${w}px — desktop @media rule may be lost in source order`).toBeGreaterThanOrEqual(1000);
});

test('table row apt-stripping helper does not break table-cell layout (regression)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Desktop-only check');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as any).renderPlannerTable === 'function');

  const result = await page.evaluate(() => {
    const w = window as any;
    if (typeof w.cleaners !== 'undefined') w.cleaners.length = 0;
    document.body.classList.add('planner-table-mode');
    const mock = [{
      co: '2026-04-26',
      guest: 'Very Long Guest Name That Should Wrap',
      listing: 'Very Long Property Name That Definitely Wraps Onto Two Lines',
      listingId: '1',
      _reservationKey: 'k1',
    }];
    document.getElementById('app')!.innerHTML =
      '<div class="container"><div class="planner-two-col"><div class="planner-main">'
      + w.renderPlannerTable(mock) + '</div></div></div>';
    const r1 = document.querySelector('.compact-table tbody tr')!;
    const tds = Array.from(r1.querySelectorAll('td'));
    return tds.map(td => Math.round(td.getBoundingClientRect().y));
  });

  // All <td>s in a single row must share a y-coordinate.
  // The bug we're guarding against: `display: -webkit-box` applied to a <td>
  // breaks `display: table-cell` and stacks cells vertically.
  const distinctYs = new Set(result);
  expect(distinctYs.size, `cells stacked at distinct ys: ${result.join(',')}`).toBe(1);
});
