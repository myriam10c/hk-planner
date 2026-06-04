import { test, expect } from '@playwright/test';

// Unit-style regression tests for the pure helper functions exposed as globals
// by app.js. These guard bug classes we care about: HTML escaping (XSS), CSV
// quoting, time/date formatting, and building-name normalization.
//
// They run in the browser context (page.evaluate) so the real, deployed
// implementations are exercised — no duplication of logic in the test.
//
// Run against prod: `npm test`
// Or against any URL: `HK_PLANNER_URL=https://my-preview.netlify.app npm test`

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof (window as any).esc === 'function'
      && typeof (window as any).csvCell === 'function'
      && typeof (window as any).getBuildingName === 'function',
    null,
    { timeout: 10_000 },
  );
});

test('esc() escapes all five HTML-sensitive characters', async ({ page }) => {
  const out = await page.evaluate(() =>
    (window as any).esc(`<img src=x onerror="alert('&')">`),
  );
  // No raw angle brackets, quotes or ampersands survive.
  expect(out).not.toMatch(/[<>]/);
  expect(out).toContain('&lt;img');
  expect(out).toContain('&gt;');
  expect(out).toContain('&quot;');
  expect(out).toContain('&#39;');
  // Ampersand must be escaped first so it doesn't double-encode the entities.
  expect(out).toContain('&amp;');
  expect(out).not.toContain('&amp;lt;');
});

test('csvCell() quotes only when needed and doubles inner quotes', async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).csvCell;
    return {
      plain: f('hello'),
      empty: f(null),
      comma: f('a,b'),
      quote: f('say "hi"'),
      newline: f('line1\nline2'),
    };
  });
  expect(r.plain).toBe('hello');
  expect(r.empty).toBe('');
  expect(r.comma).toBe('"a,b"');
  expect(r.quote).toBe('"say ""hi"""');
  expect(r.newline).toBe('"line1\nline2"');
});

test('formatTime() pads hours and treats 0/null as empty', async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).formatTime;
    return { nine: f(9), two: f(14), zero: f(0), nil: f(null) };
  });
  expect(r.nine).toBe('09:00');
  expect(r.two).toBe('14:00');
  expect(r.zero).toBeNull();
  expect(r.nil).toBeNull();
});

test('formatDate() returns "Ddd D Mmm" shape', async ({ page }) => {
  const out = await page.evaluate(() => (window as any).formatDate('2026-04-26'));
  expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/);
});

test('getBuildingName() normalizes known buildings and strips unit numbers', async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).getBuildingName;
    return {
      riviera: f('315 - Azizi Riviera 33'),
      act: f('A1 - Act One Residence'),
      elysee: f('g8 - elysee 3'),
      // 'Act 2' must normalize like the spelled-out variants — guards the fix
      // for the trailing-unit-number strip running before the 'act 2' rule.
      act2: f('506 | Act 2'),
      unknown: f('12 - Some New Tower 4'),
      empty: f(''),
    };
  });
  expect(r.riviera).toBe('Azizi Riviera');
  expect(r.act).toBe('Act One Act Two');
  expect(r.elysee).toBe('Elysée');
  expect(r.act2).toBe('Act One Act Two');
  // Unknown building: prefix + trailing unit number stripped, name preserved.
  expect(r.unknown).toBe('Some New Tower');
  expect(r.empty).toBe('Other');
});

test('classifyMt() returns a {category, priority} pair', async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).classifyMt;
    return { typed: f('AC not cooling, urgent'), blank: f('') };
  });
  expect(r.typed).toHaveProperty('category');
  expect(r.typed).toHaveProperty('priority');
  expect(typeof r.typed.category).toBe('string');
  expect(typeof r.typed.priority).toBe('string');
  // Empty input falls back to defaults.
  expect(r.blank).toEqual({ category: 'general', priority: 'medium' });
});

test('classifyMt() short keywords match as words, not substrings', async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).classifyMt;
    return {
      // "ac" must classify cooling issues...
      acReal: f('AC not cooling in bedroom').category,
      // ...but NOT trigger on "ac" buried in unrelated words.
      replace: f('replace the light bulb in the hallway').category,
      cracked: f('cracked tile near the entrance').category,
      // word-boundary keeps real matches working
      tap: f('kitchen tap dripping').category,
      rat: f('rat seen in the kitchen').category,
    };
  });
  expect(r.acReal).toBe('ac');
  // "replace" contains the substring "ac" but must NOT be misclassified as ac.
  expect(r.replace).not.toBe('ac');
  // "cracked" contains "ac" but must resolve to structural (tile/crack), not ac.
  expect(r.cracked).toBe('structural');
  expect(r.tap).toBe('plumbing');
  expect(r.rat).toBe('pest');
});

test('localYMD() uses local date components (not UTC)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const f = (window as any).localYMD;
    // A fixed local date — must serialize to its LOCAL Y-M-D regardless of TZ,
    // unlike toISOString() which would shift it in UTC+ timezones.
    const d = new Date(2026, 0, 15, 1, 30); // 15 Jan 2026, 01:30 local
    const today = (window as any).todayLocal();
    const now = new Date();
    const expectedToday =
      now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    return { fixed: f(d), today, expectedToday };
  });
  expect(r.fixed).toBe('2026-01-15');
  expect(r.today).toBe(r.expectedToday);
});
