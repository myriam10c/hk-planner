import { test, expect } from '@playwright/test';

// Unit-style tests for the pure laundry helpers exposed as globals by app.js.
// They run in the browser context so the real implementation is exercised.
//
// Fast local loop:
//   python3 -m http.server 8888
//   HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/laundry.spec.ts --project=desktop

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof (window as any).laundryBucket === 'function'
      && Array.isArray((window as any).LAUNDRY_ITEMS),
    null,
    { timeout: 10_000 },
  );
});

test('LAUNDRY_ITEMS is the frozen list of six, in order', async ({ page }) => {
  const items = await page.evaluate(() => (window as any).LAUNDRY_ITEMS);
  expect(items.map((i: any) => i.key)).toEqual([
    'pillowcases', 'bed_sheets', 'duvet_covers', 'small_towels', 'large_towels', 'bath_mats',
  ]);
  expect(items.map((i: any) => i.label)).toEqual([
    'Pillowcases', 'Bed sheets', 'Duvet covers', 'Small towels', 'Large towels', 'Bath mats',
  ]);
});

test('laundryZero / laundryTotal / laundrySum', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      zero: w.laundryZero(),
      total: w.laundryTotal({ pillowcases: 2, bed_sheets: 3, bath_mats: 1 }),
      totalOfNull: w.laundryTotal(null),
      sum: w.laundrySum([
        { pillowcases: 2, bed_sheets: 1 },
        { pillowcases: 3, bath_mats: 4 },
      ]),
    };
  });
  expect(r.zero).toEqual({
    pillowcases: 0, bed_sheets: 0, duvet_covers: 0,
    small_towels: 0, large_towels: 0, bath_mats: 0,
  });
  expect(r.total).toBe(6);
  expect(r.totalOfNull).toBe(0);
  expect(r.sum.pillowcases).toBe(5);
  expect(r.sum.bed_sheets).toBe(1);
  expect(r.sum.bath_mats).toBe(4);
  expect(r.sum.duvet_covers).toBe(0);
});

test('laundryParseCounts rejects empty, decimal, negative and oversized values', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    const full = (over: any) => Object.assign({
      pillowcases: 1, bed_sheets: 1, duvet_covers: 1,
      small_towels: 1, large_towels: 1, bath_mats: 1,
    }, over);
    return {
      valid: w.laundryParseCounts(full({})),
      zeroIsValid: w.laundryParseCounts(full({ bath_mats: '0' })),
      empty: w.laundryParseCounts(full({ duvet_covers: '' })),
      missing: w.laundryParseCounts(full({ large_towels: undefined })),
      decimal: w.laundryParseCounts(full({ bed_sheets: '1.5' })),
      text: w.laundryParseCounts(full({ small_towels: 'abc' })),
      negative: w.laundryParseCounts(full({ pillowcases: '-1' })),
      huge: w.laundryParseCounts(full({ bath_mats: '1000' })),
    };
  });
  expect(r.valid.ok).toBe(true);
  expect(r.valid.values.pillowcases).toBe(1);
  // An explicit zero is a real answer, not a missing one.
  expect(r.zeroIsValid.ok).toBe(true);
  expect(r.zeroIsValid.values.bath_mats).toBe(0);
  expect(r.empty).toMatchObject({ ok: false, field: 'duvet_covers', reason: 'empty' });
  expect(r.missing).toMatchObject({ ok: false, field: 'large_towels', reason: 'empty' });
  expect(r.decimal).toMatchObject({ ok: false, field: 'bed_sheets', reason: 'not_integer' });
  expect(r.text).toMatchObject({ ok: false, field: 'small_towels', reason: 'not_integer' });
  expect(r.negative).toMatchObject({ ok: false, field: 'pillowcases', reason: 'negative' });
  expect(r.huge).toMatchObject({ ok: false, field: 'bath_mats', reason: 'too_large' });
});

test('laundryMonday snaps to the Monday of the week, laundryAddDays walks days', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      // 2026-07-30 is a Thursday.
      thursday: w.laundryMonday('2026-07-30'),
      // 2026-07-27 is already a Monday.
      monday: w.laundryMonday('2026-07-27'),
      // 2026-08-02 is a Sunday, it belongs to the week starting 2026-07-27.
      sunday: w.laundryMonday('2026-08-02'),
      plusSix: w.laundryAddDays('2026-07-27', 6),
      crossMonth: w.laundryAddDays('2026-07-31', 1),
    };
  });
  expect(r.thursday).toBe('2026-07-27');
  expect(r.monday).toBe('2026-07-27');
  expect(r.sunday).toBe('2026-07-27');
  expect(r.plusSix).toBe('2026-08-02');
  expect(r.crossMonth).toBe('2026-08-01');
});

test('laundryBucket groups by day, sorted, with per-row totals and cleaning counts', async ({ page }) => {
  const rows = await page.evaluate(() => (window as any).laundryBucket([
    { counted_on: '2026-07-02', pillowcases: 2, bed_sheets: 1 },
    { counted_on: '2026-07-01', pillowcases: 4, bath_mats: 1 },
    { counted_on: '2026-07-01', pillowcases: 1 },
  ], 'day', '2026-07-01', '2026-07-31'));
  expect(rows.length).toBe(2);
  expect(rows[0].key).toBe('2026-07-01');
  expect(rows[0].pillowcases).toBe(5);
  expect(rows[0].bath_mats).toBe(1);
  expect(rows[0].cleanings).toBe(2);
  expect(rows[0].total).toBe(6);
  expect(rows[1].key).toBe('2026-07-02');
  expect(rows[1].cleanings).toBe(1);
  expect(rows[1].total).toBe(3);
});

test('laundryBucket drops rows outside the requested range', async ({ page }) => {
  const rows = await page.evaluate(() => (window as any).laundryBucket([
    { counted_on: '2026-06-30', pillowcases: 9 },
    { counted_on: '2026-07-01', pillowcases: 1 },
    { counted_on: '2026-08-01', pillowcases: 9 },
  ], 'day', '2026-07-01', '2026-07-31'));
  expect(rows.length).toBe(1);
  expect(rows[0].pillowcases).toBe(1);
});

test('laundryBucket clips week rows to the selected month', async ({ page }) => {
  // July 2026 starts on a Wednesday, so the first week runs Mon 2026-06-29
  // to Sun 2026-07-05 but must be reported as 07-01 to 07-05 only. Without
  // clipping, browsing month to month would count the same cleanings twice.
  const rows = await page.evaluate(() => (window as any).laundryBucket([
    { counted_on: '2026-07-01', pillowcases: 2 },
    { counted_on: '2026-07-05', pillowcases: 3 },
    { counted_on: '2026-07-06', pillowcases: 7 },
  ], 'week', '2026-07-01', '2026-07-31'));
  expect(rows.length).toBe(2);
  expect(rows[0].key).toBe('2026-06-29');
  expect(rows[0].start).toBe('2026-07-01');
  expect(rows[0].end).toBe('2026-07-05');
  expect(rows[0].pillowcases).toBe(5);
  expect(rows[0].cleanings).toBe(2);
  expect(rows[1].key).toBe('2026-07-06');
  expect(rows[1].start).toBe('2026-07-06');
  expect(rows[1].end).toBe('2026-07-12');
  expect(rows[1].pillowcases).toBe(7);
});

test('laundryParseCounts rejects whitespace-only value as empty', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return w.laundryParseCounts({
      pillowcases: 1, bed_sheets: 1, duvet_covers: '  ',
      small_towels: 1, large_towels: 1, bath_mats: 1,
    });
  });
  // A whitespace-only string is not a declared count; it must be rejected as empty,
  // not silently converted to 0 via Number('  ') === 0.
  expect(r).toMatchObject({ ok: false, field: 'duvet_covers', reason: 'empty' });
});

test('laundryPrefill floors negative balances at zero', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).laundryPrefill({
    pillowcases: 12, bed_sheets: -3, duvet_covers: 0,
  }));
  expect(r.pillowcases).toBe(12);
  expect(r.bed_sheets).toBe(0);
  expect(r.duvet_covers).toBe(0);
  expect(r.bath_mats).toBe(0);
});

// ============ Mark-done gate ============
//
// Marking a cleaning done is now only reachable through the laundry sheet, so a
// regression here stops the whole team from closing any cleaning. These drive
// the real functions: app.js is a classic script, so its top-level `function`
// declarations land on window and can be stubbed, while its `let` state cannot
// be read directly. Done-state is therefore observed through the confirm
// button's label, which is derived from it.

async function stubNetwork(page: any) {
  await page.evaluate(() => {
    const w = window as any;
    w.api = async () => ({});
    w.apiWrite = async () => ({ status: 'ok' });
  });
}

// Opens the sheet and returns its confirm label, which reveals done-state:
// "Save count" when already done, "Confirm & mark done" when not.
async function confirmLabelFor(page: any, key: string) {
  return page.evaluate(async (k: string) => {
    const w = window as any;
    await w.openLaundrySheet(k);
    const btn = document.getElementById('laundryConfirm');
    const label = btn ? btn.textContent : null;
    w.closeLaundrySheet();
    return label;
  }, key);
}

async function fillAndSubmit(page: any, value: string) {
  return page.evaluate(async (v: string) => {
    const w = window as any;
    w.LAUNDRY_ITEMS.forEach((it: any) => {
      const inp = document.getElementById('lq_' + it.key) as HTMLInputElement | null;
      if (inp) inp.value = v;
    });
    w.syncLaundryConfirm();
    const btn = document.getElementById('laundryConfirm') as HTMLButtonElement | null;
    const wasEnabled = !!btn && !btn.disabled;
    await w.submitLaundrySheet();
    return wasEnabled;
  }, value);
}

test('pressing Done opens the sheet instead of marking the cleaning done', async ({ page }) => {
  await stubNetwork(page);
  const key = '2026-07-30_Gate Open';
  const opened = await page.evaluate(async (k: string) => {
    const w = window as any;
    await w.markDone(k);
    const el = document.getElementById('laundrySheet');
    return !!(el && el.querySelector('#laundryConfirm'));
  }, key);
  expect(opened).toBe(true);
  // Nothing was marked done: the sheet is still offering to do it.
  expect(await confirmLabelFor(page, key)).toBe('Confirm & mark done');
});

test('the confirm button stays disabled until all six fields have a value', async ({ page }) => {
  await stubNetwork(page);
  const key = '2026-07-30_Gate Disabled';
  const states = await page.evaluate(async (k: string) => {
    const w = window as any;
    await w.openLaundrySheet(k);
    const btn = () => document.getElementById('laundryConfirm') as HTMLButtonElement;
    const out: boolean[] = [];
    // Fill five of the six, then check, then fill the last one.
    w.LAUNDRY_ITEMS.slice(0, 5).forEach((it: any) => {
      (document.getElementById('lq_' + it.key) as HTMLInputElement).value = '3';
    });
    w.syncLaundryConfirm();
    out.push(btn().disabled);
    const last = w.LAUNDRY_ITEMS[5];
    // An explicit zero is a real answer and must enable the button.
    (document.getElementById('lq_' + last.key) as HTMLInputElement).value = '0';
    w.syncLaundryConfirm();
    out.push(btn().disabled);
    w.closeLaundrySheet();
    return out;
  }, key);
  expect(states).toEqual([true, false]);
});

test('confirming a correction on an already-done cleaning does not un-mark it', async ({ page }) => {
  await stubNetwork(page);
  const key = '2026-07-30_Gate Correction';
  // Mark it done through the bulk bypass, the same path bulkMarkDoneSelected uses.
  await page.evaluate(async (k: string) => {
    await (window as any).markDone(k, { skipLaundry: true });
  }, key);
  expect(await confirmLabelFor(page, key)).toBe('Save count');

  // Reopen and save a correction. markDone is a toggle, so an unguarded
  // hand-off here would silently revert the cleaning to not-done.
  await page.evaluate(async (k: string) => { await (window as any).openLaundrySheet(k); }, key);
  expect(await fillAndSubmit(page, '4')).toBe(true);

  expect(await confirmLabelFor(page, key)).toBe('Save count');
});

test('bulk mark-done bypasses the sheet entirely', async ({ page }) => {
  await stubNetwork(page);
  const key = '2026-07-30_Gate Bulk';
  const sheetShown = await page.evaluate(async (k: string) => {
    const w = window as any;
    await w.markDone(k, { skipLaundry: true });
    const el = document.getElementById('laundrySheet');
    return !!(el && el.querySelector('#laundryConfirm'));
  }, key);
  expect(sheetShown).toBe(false);
  expect(await confirmLabelFor(page, key)).toBe('Save count');
});

test('a late prefill does not wipe what the cleaner already typed', async ({ page }) => {
  await stubNetwork(page);
  const typed = await page.evaluate(async () => {
    const w = window as any;
    const key = '2026-07-30_Gate Slow Net';
    // getLaundryCount resolves only after the cleaner has started typing.
    w.api = (action: string) => action === 'getLaundryCount'
      ? new Promise(res => setTimeout(() => res({ count: { pillowcases: 9, bed_sheets: 9, duvet_covers: 9, small_towels: 9, large_towels: 9, bath_mats: 9 } }), 150))
      : Promise.resolve({});
    const pending = w.openLaundrySheet(key);
    (document.getElementById('lq_pillowcases') as HTMLInputElement).value = '7';
    w.syncLaundryConfirm();
    await pending;
    const v = (document.getElementById('lq_pillowcases') as HTMLInputElement).value;
    w.closeLaundrySheet();
    return v;
  });
  expect(typed).toBe('7');
});

test('Escape clears the sheet state, not just its markup', async ({ page }) => {
  await stubNetwork(page);
  const stillOpen = await page.evaluate(async () => {
    const w = window as any;
    await w.openLaundrySheet('2026-07-30_Gate Esc');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    // A stale laundrySheetKey would let a later render repaint the dismissed sheet.
    w.renderLaundrySheet();
    const el = document.getElementById('laundrySheet');
    return !!(el && el.querySelector('#laundryConfirm'));
  });
  expect(stillOpen).toBe(false);
});

test('laundryStep rounds a stray decimal instead of discarding it', async ({ page }) => {
  const v = await page.evaluate(() => {
    const w = window as any;
    const inp = document.createElement('input');
    inp.id = 'lq_pillowcases_steptest';
    document.body.appendChild(inp);
    inp.value = '2.5';
    w.laundryStep('lq_pillowcases_steptest', 1);
    const out = inp.value;
    inp.remove();
    return out;
  });
  expect(v).toBe('4');
});

// ============ Manager tab: movement form ============
//
// openLaundryMoveForm now renders the form into #laundryMoveForm (body-level).
// Tests call openLaundryMoveForm() directly (patching render to noop to avoid
// currentTab dependency) and then query #laundryMoveForm in the DOM.

test('laundryMonthRange returns first and last day of the current month', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).laundryMonthRange());
  // YYYY-MM-DD format
  expect(r.start).toMatch(/^\d{4}-\d{2}-01$/);
  expect(r.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // start and end share the same year-month prefix
  expect(r.start.slice(0, 7)).toBe(r.end.slice(0, 7));
  // end must be the real last day of the month (not just any day or equal to start)
  const [year, month] = r.start.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  expect(Number(r.end.slice(8, 10))).toBe(lastDay);
  // label is non-empty
  expect(r.label.length).toBeGreaterThan(0);
});

test('renderLaundryMoveForm includes lmDate and six lm_ inputs for pickup', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    w.render = () => {};
    w.openLaundryMoveForm('out');
    const container = document.getElementById('laundryMoveForm');
    if (!container) return { hasDate: false, itemInputCount: 0 };
    const inputIds = Array.from(container.querySelectorAll('input[id]')).map((el: any) => el.id);
    return {
      hasDate: !!container.querySelector('#lmDate'),
      itemInputCount: inputIds.filter((id: string) => id.startsWith('lm_')).length,
    };
  });
  expect(r.hasDate).toBe(true);
  expect(r.itemInputCount).toBe(6);
});

test('renderLaundryMoveForm includes bucket selector for adjust', async ({ page }) => {
  const hasBucket = await page.evaluate(() => {
    const w = window as any;
    w.render = () => {};
    w.openLaundryMoveForm('adjust');
    const container = document.getElementById('laundryMoveForm');
    return !!(container && container.querySelector('#lmBucket'));
  });
  expect(hasBucket).toBe(true);
});

test('submitLaundryMove rejects a non-integer field and does not call apiWrite', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const w = window as any;
    let apiWriteCalled = false;
    w.apiWrite = async () => { apiWriteCalled = true; return { status: 'ok' }; };
    w.api = async () => ({});
    w.render = () => {};
    w.openLaundryMoveForm('in');
    // Set a bad value
    const inp = document.getElementById('lm_pillowcases') as HTMLInputElement | null;
    if (inp) inp.value = '1.5';
    await w.submitLaundryMove();
    const el = document.getElementById('laundryError');
    return { errText: el ? el.textContent : '', apiWriteCalled };
  });
  expect(result.errText).toMatch(/pillowcases/i);
  expect(result.apiWriteCalled).toBe(false);
});

test('submitLaundryMove rejects a negative value for a non-adjust kind and does not call apiWrite', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const w = window as any;
    let apiWriteCalled = false;
    w.apiWrite = async () => { apiWriteCalled = true; return { status: 'ok' }; };
    w.api = async () => ({});
    w.render = () => {};
    w.openLaundryMoveForm('out');
    const inp = document.getElementById('lm_pillowcases') as HTMLInputElement | null;
    if (inp) inp.value = '-1';
    await w.submitLaundryMove();
    const el = document.getElementById('laundryError');
    return { errText: el ? el.textContent : '', apiWriteCalled };
  });
  expect(result.errText).toMatch(/pillowcases/i);
  expect(result.apiWriteCalled).toBe(false);
});

test('submitLaundryMove accepts a negative value for the adjust kind', async ({ page }) => {
  const saved = await page.evaluate(async () => {
    const w = window as any;
    w.apiWrite = async (_action: string, opts: any) => {
      (window as any)._lastBody = opts && opts.body;
      return { status: 'ok' };
    };
    // loadLaundry (called after save) needs api stubbed.
    w.api = async () => ({ counts: [], balances: { store: null, laundry: null }, movements: [] });
    w.render = () => {};
    w.openLaundryMoveForm('adjust');
    w.LAUNDRY_ITEMS.forEach((it: any) => {
      const inp = document.getElementById('lm_' + it.key) as HTMLInputElement | null;
      if (inp) inp.value = it.key === 'pillowcases' ? '-5' : '0';
    });
    await w.submitLaundryMove();
    return (window as any)._lastBody;
  });
  expect(saved).toBeTruthy();
  expect(saved.pillowcases).toBe(-5);
});

test('closeLaundryMoveForm clears the form from a re-render', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as any;
    w.render = () => {};
    w.openLaundryMoveForm('in');
    const container = document.getElementById('laundryMoveForm');
    const hasDateBefore = !!(container && container.querySelector('#lmDate'));
    w.closeLaundryMoveForm();
    const hasDateAfter = !!(container && container.querySelector('#lmDate'));
    return { hasDateBefore, hasDateAfter };
  });
  expect(result.hasDateBefore).toBe(true);
  expect(result.hasDateAfter).toBe(false);
});

test('Escape key clears laundryMoveKind so a re-render shows no form', async ({ page }) => {
  const result = await page.evaluate(() => {
    const w = window as any;
    w.render = () => {};
    w.openLaundryMoveForm('in');
    const container = document.getElementById('laundryMoveForm');
    const openBefore = !!(container && container.querySelector('#lmDate'));
    // Fire Escape: the handler reads laundryMoveKind (module let) and calls closeLaundryMoveForm.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const openAfter = !!(container && container.querySelector('#lmDate'));
    return { openBefore, openAfter };
  });
  expect(result.openBefore).toBe(true);
  expect(result.openAfter).toBe(false);
});

// ============ double-submit protection ============
// A second call to submitLaundryMove while the first is in flight must not
// write a second movement. Verified by patching apiWrite to count invocations.
test('submitLaundryMove is re-entrant-safe, second call while first is in flight writes only once', async ({ page }) => {
  const writeCount = await page.evaluate(async () => {
    const w = window as any;
    let count = 0;
    // apiWrite resolves after a tick so the second call arrives while the first awaits.
    w.apiWrite = async (_action: string, _opts: any) => {
      count++;
      await new Promise(r => setTimeout(r, 10));
      return { status: 'ok' };
    };
    w.api = async () => ({ counts: [], balances: { store: null, laundry: null }, movements: [] });
    w.render = () => {};
    w.openLaundryMoveForm('in');
    // Fill all fields with valid values.
    w.LAUNDRY_ITEMS.forEach((it: any) => {
      const inp = document.getElementById('lm_' + it.key) as HTMLInputElement | null;
      if (inp) inp.value = '1';
    });
    // Fire two submits without awaiting the first.
    const p1 = w.submitLaundryMove();
    const p2 = w.submitLaundryMove();
    await Promise.all([p1, p2]);
    return count;
  });
  expect(writeCount).toBe(1);
});

// ============ background render does not destroy typed input ============
// The form lives in #laundryMoveForm (body-level), not inside #app.
// A full render() call must therefore leave typed values intact.
test('a full render() while the movement form is open does not destroy typed input', async ({ page }) => {
  const valueAfterRender = await page.evaluate(async () => {
    const w = window as any;
    // Stub network so render/loadLaundry do not throw.
    w.api = async () => ({ counts: [], balances: { store: null, laundry: null }, movements: [] });
    w.apiWrite = async () => ({ status: 'ok' });
    // Open the form via openLaundryMoveForm (uses real renderLaundryMoveForm).
    // Do NOT patch render here: we need real render() for the test to be meaningful.
    w.openLaundryMoveForm('in');
    // Type a value into the first field.
    const inp = document.getElementById('lm_pillowcases') as HTMLInputElement | null;
    if (inp) inp.value = '77';
    // Now call render() as the background timer would. This must NOT wipe the form.
    w.render();
    // Read the value back.
    const inp2 = document.getElementById('lm_pillowcases') as HTMLInputElement | null;
    return inp2 ? inp2.value : null;
  });
  expect(valueAfterRender).toBe('77');
});

// ============ renderLaundryTable: totals table ============
//
// laundryData and laundryGranularity are module-level `let`s, unreachable from
// test code. We load them via the real load path: stub api() to return a known
// payload, call setTab('laundry') to trigger loadLaundry(), wait for the DOM
// to reflect the data, then assert on #app.

async function stubLaundryApi(page: any, counts: any[]) {
  await page.evaluate((c: any[]) => {
    const w = window as any;
    w.api = async (action: string) => {
      if (action === 'getLaundrySummary') return { counts: c, balances: { store: null, laundry: null } };
      if (action === 'getLaundryMovements') return { movements: [] };
      return {};
    };
  }, counts);
}

test('renderLaundryTable day view: one row per day with correct per-item counts', async ({ page }) => {
  const counts = [
    { counted_on: '2026-07-10', pillowcases: 2, bed_sheets: 1, duvet_covers: 0, small_towels: 3, large_towels: 0, bath_mats: 1 },
    { counted_on: '2026-07-10', pillowcases: 1, bed_sheets: 2, duvet_covers: 0, small_towels: 0, large_towels: 1, bath_mats: 0 },
    { counted_on: '2026-07-15', pillowcases: 4, bed_sheets: 0, duvet_covers: 1, small_towels: 0, large_towels: 2, bath_mats: 0 },
  ];
  await stubLaundryApi(page, counts);

  // Reset to current month and day granularity, then switch to laundry tab.
  await page.evaluate(() => {
    const w = window as any;
    // Force the month offset to 0 (current month is July 2026 in this session).
    // setLaundryGranularity is on window; laundryMonthOffset cannot be set directly,
    // but changeLaundryMonth can be driven. We reset by switching to the laundry
    // tab so loadLaundry is called fresh; then we switch granularity if needed.
    w.setLaundryGranularity('day');
    w.setTab('laundry');
  });

  // Wait for the totals table to appear (load is async).
  await page.waitForSelector('.laundry-totals', { timeout: 8000 });

  const result = await page.evaluate(() => {
    const table = document.querySelector('.laundry-totals');
    if (!table) return { rows: 0, row0pills: -1, row0cleanings: -1, row1pills: -1 };
    const bodyRows = table.querySelectorAll('tbody tr');
    const cells0 = bodyRows[0] ? Array.from(bodyRows[0].querySelectorAll('td')).map((td: any) => td.textContent.trim()) : [];
    const cells1 = bodyRows[1] ? Array.from(bodyRows[1].querySelectorAll('td')).map((td: any) => td.textContent.trim()) : [];
    return {
      rows: bodyRows.length,
      // cells0[0] = date, cells0[1] = pillowcases, ..., cells0[7] = cleanings
      row0label: cells0[0],
      row0pills: Number(cells0[1]),
      row0beds: Number(cells0[2]),
      row0small: Number(cells0[4]),
      row0large: Number(cells0[5]),
      row0cleanings: Number(cells0[8]),
      row1label: cells1[0],
      row1pills: Number(cells1[1]),
      row1cleanings: Number(cells1[8]),
    };
  });

  expect(result.rows).toBe(2);
  // July 10: two cleanings merged
  expect(result.row0label).toBe('2026-07-10');
  expect(result.row0pills).toBe(3);   // 2 + 1
  expect(result.row0beds).toBe(3);    // 1 + 2
  expect(result.row0small).toBe(3);   // 3 + 0
  expect(result.row0large).toBe(1);   // 0 + 1
  expect(result.row0cleanings).toBe(2);
  // July 15: one cleaning
  expect(result.row1label).toBe('2026-07-15');
  expect(result.row1pills).toBe(4);
  expect(result.row1cleanings).toBe(1);
});

test('renderLaundryTable footer totals equal column sums', async ({ page }) => {
  const counts = [
    { counted_on: '2026-07-05', pillowcases: 3, bed_sheets: 1, duvet_covers: 2, small_towels: 0, large_towels: 1, bath_mats: 1 },
    { counted_on: '2026-07-12', pillowcases: 1, bed_sheets: 2, duvet_covers: 0, small_towels: 4, large_towels: 0, bath_mats: 2 },
  ];
  await stubLaundryApi(page, counts);

  await page.evaluate(() => {
    (window as any).setLaundryGranularity('day');
    (window as any).setTab('laundry');
  });
  await page.waitForSelector('.laundry-totals', { timeout: 8000 });

  const result = await page.evaluate(() => {
    const table = document.querySelector('.laundry-totals');
    if (!table) return null;
    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    const footRow = table.querySelector('tfoot tr');
    if (!footRow) return null;
    // Sum each column (excluding col 0 = label) across body rows.
    const colCount = bodyRows[0] ? bodyRows[0].querySelectorAll('td').length : 0;
    const bodySums: number[] = [];
    for (let c = 1; c < colCount; c++) {
      let s = 0;
      bodyRows.forEach(row => {
        const td = row.querySelectorAll('td')[c];
        s += Number(td ? (td as any).textContent.replace(/[^0-9-]/g, '') : 0);
      });
      bodySums.push(s);
    }
    const footCells = Array.from(footRow.querySelectorAll('td')).slice(1).map((td: any) => Number(td.textContent.replace(/[^0-9-]/g, '')));
    return { bodySums, footCells };
  });

  expect(result).not.toBeNull();
  // Every footer column must match the body column sum.
  result!.footCells.forEach((fv: number, i: number) => {
    expect(fv).toBe(result!.bodySums[i]);
  });
});

test('renderLaundryTable shows empty message and no table when no counts', async ({ page }) => {
  await stubLaundryApi(page, []);

  await page.evaluate(() => {
    (window as any).setLaundryGranularity('day');
    (window as any).setTab('laundry');
  });

  // Wait for loading to finish: month-selector appears once laundryData is set.
  await page.waitForSelector('.month-selector', { timeout: 8000 });

  const result = await page.evaluate(() => {
    const app = document.getElementById('app');
    const hasTable = !!(app && app.querySelector('.laundry-totals'));
    // The empty-state div contains the expected text.
    const bodyText = app ? app.textContent : '';
    return { hasTable, hasEmptyMsg: bodyText.includes('No laundry counted this month.') };
  });

  expect(result.hasTable).toBe(false);
  expect(result.hasEmptyMsg).toBe(true);
});
