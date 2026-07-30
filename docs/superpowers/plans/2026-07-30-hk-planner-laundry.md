# HK Planner Laundry Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force every cleaning to declare the dirty linen it collected, then give managers day/week totals and a running balance of what sits at the laundry.

**Architecture:** Two new Postgres tables (`laundry_counts`, one row per cleaning; `laundry_movements`, one row per store-level movement) plus a `laundry_balances` view that derives both balances in a single scan. Five new actions on the existing Supabase edge function proxy. On the frontend, `markDone()` gains a blocking sheet, and a new manager-only `laundry` tab renders balances, a day/week totals table, and the movement history. All aggregation for the table happens client-side in pure functions so it can be unit-tested; only the unbounded balance sums live in SQL.

**Tech Stack:** Vanilla JS single file (`app.js`), plain CSS (`styles.css`), Supabase edge function in Deno TypeScript, Postgres migrations, Playwright for tests.

**Spec:** `docs/superpowers/specs/2026-07-30-hk-planner-laundry-design.md`

## Global Constraints

- All user-facing strings are **English**. The app has no working i18n (`T.en` only, `renderLangSelector()` returns `''`). Do not add French to the UI.
- Never use an em dash (`—`) in any string, comment, or commit message. Use a comma, a period, or `·`.
- The six items are fixed, in this order, with these exact keys and labels: `pillowcases`/Pillowcases, `bed_sheets`/Bed sheets, `duvet_covers`/Duvet covers, `small_towels`/Small towels, `large_towels`/Large towels, `bath_mats`/Bath mats.
- The edge function is deployed **only** with `npm run deploy:proxy`. A bare `npx supabase functions deploy` resets `verify_jwt` to true and takes the whole app down with `UNAUTHORIZED_NO_AUTH_HEADER`.
- Manager-only server actions use the existing pattern verbatim: `const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token")); if (me && me.role !== "manager") return jsonResp({ error: "manager role required" }, 403);`. An unauthenticated caller stays allowed. Do not harden this here; it would be inconsistent with `setCancelled` and `setPostponed`.
- `app.js` is a classic script, not a module. Top-level `function foo(){}` lands on `window` automatically, but `const`/`let` do **not**. Any constant a test needs must be explicitly assigned to `window`.
- Never `git stash` or otherwise tidy the working tree. Production is served from this tree.
- Do not commit `deno.lock`, `saas/`, or unrelated untracked files. Stage only the files named in each task.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260730120000_laundry.sql` | New: two tables, constraints, indexes, balance view |
| `supabase/functions/hostaway-proxy/index.ts` | Modify: 5 routes + 5 handlers + one shared validator |
| `app.js` | Modify: laundry constants and pure helpers, cleaner sheet, manager tab |
| `styles.css` | Modify: laundry sheet rows, stepper buttons, balance cards |
| `tests/laundry.spec.ts` | New: unit-style tests of the pure helpers, via `page.evaluate` |
| `sw.js` | Modify at deploy time only: bump `VERSION` |

`app.js` is a 380KB single file by established convention. Keep the laundry code in one contiguous, clearly delimited section rather than restructuring the file.

---

### Task 1: Database schema

**Files:**
- Create: `supabase/migrations/20260730120000_laundry.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `public.laundry_counts` and `public.laundry_movements`, view `public.laundry_balances` returning exactly two rows with `bucket` in (`store`, `laundry`) and the six integer columns.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260730120000_laundry.sql`:

```sql
-- Comptage du linge sale et suivi des mouvements vers la blanchisserie.
-- laundry_counts   : 1 ligne par ménage, saisie par la cleaner avant "Done".
-- laundry_movements: 1 ligne par mouvement au local (sortie, retour, ajustement).
-- Les deux soldes se dérivent de ces deux tables via la vue laundry_balances :
--   dirty_at_store = adjust_store + counts - out
--   at_laundry     = adjust_laundry + out - in
-- Accès via edge function (service_role) ; RLS activé sans policy = anon bloqué.

CREATE TABLE IF NOT EXISTS public.laundry_counts (
  reservation_key  TEXT PRIMARY KEY,
  pillowcases      INTEGER NOT NULL DEFAULT 0 CHECK (pillowcases  BETWEEN 0 AND 999),
  bed_sheets       INTEGER NOT NULL DEFAULT 0 CHECK (bed_sheets   BETWEEN 0 AND 999),
  duvet_covers     INTEGER NOT NULL DEFAULT 0 CHECK (duvet_covers BETWEEN 0 AND 999),
  small_towels     INTEGER NOT NULL DEFAULT 0 CHECK (small_towels BETWEEN 0 AND 999),
  large_towels     INTEGER NOT NULL DEFAULT 0 CHECK (large_towels BETWEEN 0 AND 999),
  bath_mats        INTEGER NOT NULL DEFAULT 0 CHECK (bath_mats    BETWEEN 0 AND 999),
  counted_on       DATE NOT NULL,
  author           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS laundry_counts_counted_on_idx
  ON public.laundry_counts (counted_on);

ALTER TABLE public.laundry_counts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.laundry_counts IS
  'Linge sale déclaré par la cleaner en fin de ménage. reservation_key = keyFor() côté app. counted_on est dérivé du préfixe date de la clé, pas de l''heure de saisie. Accès via edge function service_role.';

CREATE TABLE IF NOT EXISTS public.laundry_movements (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('out','in','adjust_store','adjust_laundry')),
  pillowcases  INTEGER NOT NULL DEFAULT 0 CHECK (abs(pillowcases)  <= 999),
  bed_sheets   INTEGER NOT NULL DEFAULT 0 CHECK (abs(bed_sheets)   <= 999),
  duvet_covers INTEGER NOT NULL DEFAULT 0 CHECK (abs(duvet_covers) <= 999),
  small_towels INTEGER NOT NULL DEFAULT 0 CHECK (abs(small_towels) <= 999),
  large_towels INTEGER NOT NULL DEFAULT 0 CHECK (abs(large_towels) <= 999),
  bath_mats    INTEGER NOT NULL DEFAULT 0 CHECK (abs(bath_mats)    <= 999),
  moved_on     DATE NOT NULL,
  note         TEXT,
  author       TEXT DEFAULT 'Manager',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT laundry_movements_non_negative CHECK (
    kind LIKE 'adjust%' OR (
      pillowcases >= 0 AND bed_sheets >= 0 AND duvet_covers >= 0
      AND small_towels >= 0 AND large_towels >= 0 AND bath_mats >= 0
    )
  )
);

CREATE INDEX IF NOT EXISTS laundry_movements_moved_on_idx
  ON public.laundry_movements (moved_on DESC, id DESC);

ALTER TABLE public.laundry_movements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.laundry_movements IS
  'Mouvements de linge au local. out = ramassé par la blanchisserie, in = rapporté, adjust_store / adjust_laundry = corrections d''inventaire (valeurs négatives autorisées, servent aussi à l''amorçage du stock existant).';

CREATE OR REPLACE VIEW public.laundry_balances
WITH (security_invoker = on) AS
WITH c AS (
  SELECT
    COALESCE(SUM(pillowcases), 0)::BIGINT  AS pillowcases,
    COALESCE(SUM(bed_sheets), 0)::BIGINT   AS bed_sheets,
    COALESCE(SUM(duvet_covers), 0)::BIGINT AS duvet_covers,
    COALESCE(SUM(small_towels), 0)::BIGINT AS small_towels,
    COALESCE(SUM(large_towels), 0)::BIGINT AS large_towels,
    COALESCE(SUM(bath_mats), 0)::BIGINT    AS bath_mats
  FROM public.laundry_counts
),
m AS (
  SELECT
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_bath_mats,
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_bath_mats,
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_bath_mats,
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_bath_mats
  FROM public.laundry_movements
)
SELECT 'store'::TEXT AS bucket,
  c.pillowcases  + m.as_pillowcases  - m.out_pillowcases  AS pillowcases,
  c.bed_sheets   + m.as_bed_sheets   - m.out_bed_sheets   AS bed_sheets,
  c.duvet_covers + m.as_duvet_covers - m.out_duvet_covers AS duvet_covers,
  c.small_towels + m.as_small_towels - m.out_small_towels AS small_towels,
  c.large_towels + m.as_large_towels - m.out_large_towels AS large_towels,
  c.bath_mats    + m.as_bath_mats    - m.out_bath_mats    AS bath_mats
FROM c CROSS JOIN m
UNION ALL
SELECT 'laundry'::TEXT,
  m.al_pillowcases  + m.out_pillowcases  - m.in_pillowcases,
  m.al_bed_sheets   + m.out_bed_sheets   - m.in_bed_sheets,
  m.al_duvet_covers + m.out_duvet_covers - m.in_duvet_covers,
  m.al_small_towels + m.out_small_towels - m.in_small_towels,
  m.al_large_towels + m.out_large_towels - m.in_large_towels,
  m.al_bath_mats    + m.out_bath_mats    - m.in_bath_mats
FROM c CROSS JOIN m;

COMMENT ON VIEW public.laundry_balances IS
  'Deux lignes : bucket=store (linge sale au local) et bucket=laundry (linge chez le prestataire). Recalculée à chaque lecture, pas de cache.';
```

- [ ] **Step 2: Apply the migration to Supabase**

The project ref is `dqjnqvbxfwtvrjwnnmns` (see `supabase/config.toml`). Apply the file above through the Supabase MCP `apply_migration` tool with name `laundry`, or via the SQL editor. This is purely additive: two new tables and one new view, no change to existing objects.

- [ ] **Step 3: Verify the schema landed**

Run this SQL and confirm it returns two rows, `laundry` and `store`, with every column at `0`:

```sql
SELECT * FROM public.laundry_balances ORDER BY bucket;
```

Then confirm the guard rails bite. Each of these must fail:

```sql
INSERT INTO public.laundry_movements (kind, moved_on) VALUES ('nope', current_date);
INSERT INTO public.laundry_movements (kind, pillowcases, moved_on) VALUES ('out', -5, current_date);
```

And this must succeed, since negatives are the whole point of an adjustment:

```sql
INSERT INTO public.laundry_movements (kind, pillowcases, moved_on) VALUES ('adjust_store', -5, current_date);
SELECT bucket, pillowcases FROM public.laundry_balances ORDER BY bucket;  -- store must read -5
DELETE FROM public.laundry_movements WHERE kind = 'adjust_store' AND pillowcases = -5;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260730120000_laundry.sql
git commit -m "feat(laundry): tables de comptage du linge et vue des soldes"
```

---

### Task 2: Pure helpers in app.js

Client-side aggregation and validation, written first because everything else consumes it. These functions are pure, so they carry the only real test cycle in this plan.

**Files:**
- Modify: `app.js` (new section, insert immediately before the `// ============ RENDER ============` banner near line 3043)
- Create: `tests/laundry.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all reachable on `window`:
  - `LAUNDRY_ITEMS: {key:string,label:string}[]` (6 entries, explicitly assigned to `window`)
  - `laundryZero(): Record<string,number>`
  - `laundryTotal(row): number`
  - `laundrySum(rows): Record<string,number>`
  - `laundryParseCounts(values): {ok:true,values} | {ok:false,field:string,reason:string}`
  - `laundryMonday(dateStr): string`
  - `laundryAddDays(dateStr, n): string`
  - `laundryBucket(counts, granularity, monthStart, monthEnd): Row[]` where `Row` is the six item keys plus `key`, `start`, `end`, `cleanings`, `total`
  - `laundryPrefill(storeBalance): Record<string,number>`

- [ ] **Step 1: Write the failing test**

Create `tests/laundry.spec.ts`:

```typescript
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

test('laundryPrefill floors negative balances at zero', async ({ page }) => {
  const r = await page.evaluate(() => (window as any).laundryPrefill({
    pillowcases: 12, bed_sheets: -3, duvet_covers: 0,
  }));
  expect(r.pillowcases).toBe(12);
  expect(r.bed_sheets).toBe(0);
  expect(r.duvet_covers).toBe(0);
  expect(r.bath_mats).toBe(0);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
python3 -m http.server 8888 &
HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/laundry.spec.ts --project=desktop
```

Expected: every test fails in `beforeEach` on the `waitForFunction` timeout, because `window.laundryBucket` does not exist yet.

If Chromium is missing, run `npm run test:install` first.

- [ ] **Step 3: Implement the helpers**

In `app.js`, immediately before the `// ============ RENDER ============` banner, insert:

```javascript
// ============ LAUNDRY: constants + pure helpers ============
// Fixed list. Adding an item means a migration plus a proxy change, by design.
const LAUNDRY_ITEMS=[
  {key:'pillowcases',label:'Pillowcases'},
  {key:'bed_sheets',label:'Bed sheets'},
  {key:'duvet_covers',label:'Duvet covers'},
  {key:'small_towels',label:'Small towels'},
  {key:'large_towels',label:'Large towels'},
  {key:'bath_mats',label:'Bath mats'},
];
// const is lexical, so it never lands on window on its own. Tests need it.
window.LAUNDRY_ITEMS=LAUNDRY_ITEMS;

function laundryZero(){const o={};LAUNDRY_ITEMS.forEach(i=>{o[i.key]=0;});return o;}

function laundryTotal(row){return LAUNDRY_ITEMS.reduce((s,i)=>s+(Number(row&&row[i.key])||0),0);}

function laundrySum(rows){
  const o=laundryZero();
  (rows||[]).forEach(r=>{LAUNDRY_ITEMS.forEach(i=>{o[i.key]+=Number(r&&r[i.key])||0;});});
  return o;
}

// Empty is checked before Number(), because Number('') is 0 and that would turn
// a forgotten field into a declared zero.
function laundryParseCounts(values){
  const out=laundryZero();
  for(const it of LAUNDRY_ITEMS){
    const raw=values?values[it.key]:undefined;
    if(raw===''||raw===null||raw===undefined)return{ok:false,field:it.key,reason:'empty'};
    const n=Number(raw);
    if(!Number.isInteger(n))return{ok:false,field:it.key,reason:'not_integer'};
    if(n<0)return{ok:false,field:it.key,reason:'negative'};
    if(n>999)return{ok:false,field:it.key,reason:'too_large'};
    out[it.key]=n;
  }
  return{ok:true,values:out};
}

// UTC throughout: these are calendar dates, never instants. Using local time
// would shift a day for anyone whose device is not on Dubai time.
function laundryAddDays(dateStr,n){
  const d=new Date(dateStr+'T00:00:00Z');
  d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}

function laundryMonday(dateStr){
  const d=new Date(dateStr+'T00:00:00Z');
  const dow=(d.getUTCDay()+6)%7; // 0 = Monday
  d.setUTCDate(d.getUTCDate()-dow);
  return d.toISOString().slice(0,10);
}

// Week rows stay clipped to [monthStart, monthEnd] so that browsing month to
// month never counts the same cleaning twice.
function laundryBucket(counts,granularity,monthStart,monthEnd){
  const groups=new Map();
  (counts||[]).forEach(c=>{
    const day=c&&c.counted_on;
    if(!day||day<monthStart||day>monthEnd)return;
    let gk,gStart,gEnd;
    if(granularity==='week'){
      gk=laundryMonday(day);
      const gWeekEnd=laundryAddDays(gk,6);
      gStart=gk<monthStart?monthStart:gk;
      gEnd=gWeekEnd>monthEnd?monthEnd:gWeekEnd;
    }else{
      gk=day;gStart=day;gEnd=day;
    }
    if(!groups.has(gk))groups.set(gk,{key:gk,start:gStart,end:gEnd,cleanings:0,items:laundryZero()});
    const g=groups.get(gk);
    g.cleanings++;
    LAUNDRY_ITEMS.forEach(i=>{g.items[i.key]+=Number(c[i.key])||0;});
  });
  return Array.from(groups.values())
    .sort((a,b)=>a.key<b.key?-1:(a.key>b.key?1:0))
    .map(g=>Object.assign({},g.items,{
      key:g.key,start:g.start,end:g.end,
      cleanings:g.cleanings,total:laundryTotal(g.items),
    }));
}

function laundryPrefill(storeBalance){
  const o={};
  LAUNDRY_ITEMS.forEach(i=>{
    const n=Number(storeBalance&&storeBalance[i.key])||0;
    o[i.key]=n>0?n:0;
  });
  return o;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/laundry.spec.ts --project=desktop
```

Expected: 8 passed. Fix the implementation, not the test, on any failure.

- [ ] **Step 5: Commit**

```bash
git add app.js tests/laundry.spec.ts
git commit -m "feat(laundry): helpers purs de comptage et d'agregation par jour et semaine"
```

---

### Task 3: Proxy actions

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (ROUTES around line 470, handlers after the `setPostponed` block near line 760)

**Interfaces:**
- Consumes: tables and view from Task 1.
- Produces five HTTP actions:
  - `POST saveLaundryCount` body `{reservation_key, pillowcases, bed_sheets, duvet_covers, small_towels, large_towels, bath_mats, author}` returns `{status:"success"}`
  - `GET getLaundryCount?key=` returns `{count: Row|null}`
  - `GET getLaundrySummary?start=&end=` returns `{counts: Row[], balances:{store:Row|null, laundry:Row|null}}`

    **Deliberate deviation from the spec.** The spec gives this action a third parameter, `granularity`, and has the server emit day or week rows. This plan drops it: the server returns one raw row per cleaning for the month, and `laundryBucket` from Task 2 does the day and week grouping in the browser. A month of cleanings is at most a few hundred small rows, so the payload argument is weak, and the grouping is where the real logic lives, in particular the week-clipping rule that stops a cross-month week being counted twice. In the browser that logic is covered by the Playwright helper tests. In Deno it would have no test at all, since this repo has no server-side test runner. Testability wins. Balances stay server-side because they sum unbounded history and genuinely cannot be shipped to the client.
  - `GET getLaundryMovements?limit=` returns `{movements: Row[]}`
  - `POST addLaundryMovement` body `{kind, ...six ints, moved_on, note, author}` returns `{status:"success", movement: Row}`

- [ ] **Step 1: Register the routes**

In the `ROUTES` array, after the `// ===== Logs =====` group, add:

```typescript
  // ===== Laundry =====
  ["saveLaundryCount", "POST"],
  ["getLaundryCount", "GET"],
  ["getLaundrySummary", "GET"],
  ["getLaundryMovements", "GET"],
  ["addLaundryMovement", "POST"],
```

- [ ] **Step 2: Add the shared validator**

Next to the other module-level helpers, near `addLog` around line 264:

```typescript
const LAUNDRY_FIELDS = [
  "pillowcases", "bed_sheets", "duvet_covers",
  "small_towels", "large_towels", "bath_mats",
] as const;

// Returns {values} or {error}. allowNegative is true only for adjustments,
// which is how an inventory correction can walk a balance back down.
function readLaundryQty(body: Record<string, any>, allowNegative: boolean) {
  const values: Record<string, number> = {};
  for (const f of LAUNDRY_FIELDS) {
    const n = Number(body[f]);
    if (!Number.isInteger(n)) return { error: `${f} must be an integer` };
    if (!allowNegative && n < 0) return { error: `${f} must be >= 0` };
    if (Math.abs(n) > 999) return { error: `${f} is out of range` };
    values[f] = n;
  }
  return { values };
}
```

- [ ] **Step 3: Add the handlers**

Immediately after the closing brace of the `setPostponed` block:

```typescript
    // ==================== LAUNDRY ====================
    // Comptage du linge sale déclaré en fin de ménage. Ouvert aux cleaners,
    // même règle que addNote : c'est un fait du ménage, pas un privilège.
    if (action === "saveLaundryCount" && req.method === "POST") {
      const body = await req.json();
      const { reservation_key, author } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      const q = readLaundryQty(body, false);
      if (q.error) return jsonResp({ error: q.error }, 400);
      // counted_on vient du préfixe date de la clé, pas de l'heure de saisie :
      // un ménage du 12 validé à 1h du matin le 13 reste imputé au 12.
      const m = String(reservation_key).match(/^(\d{4}-\d{2}-\d{2})_/);
      const counted_on = m ? m[1] : new Date().toISOString().slice(0, 10);
      const { error } = await sb.from("laundry_counts").upsert({
        reservation_key,
        ...q.values,
        counted_on,
        author: author || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "reservation_key" });
      if (error) throw error;
      await addLog(sb, reservation_key, "laundry_counted", author, q.values);
      return jsonResp({ status: "success" });
    }

    if (action === "getLaundryCount" && req.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key) return jsonResp({ error: "key required" }, 400);
      const { data, error } = await sb.from("laundry_counts")
        .select("*").eq("reservation_key", key).maybeSingle();
      if (error) throw error;
      return jsonResp({ count: data || null });
    }

    // Les comptages du mois descendent bruts (le client agrège), mais les
    // soldes passent par la vue : ils somment tout l'historique, ce qui grossit
    // sans limite et n'a rien à faire dans le navigateur.
    if (action === "getLaundrySummary" && req.method === "GET") {
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (!start || !end) return jsonResp({ error: "start and end required" }, 400);
      const { data: counts, error: e1 } = await sb.from("laundry_counts")
        .select(["reservation_key", "counted_on", ...LAUNDRY_FIELDS].join(","))
        .gte("counted_on", start).lte("counted_on", end);
      if (e1) throw e1;
      const { data: bal, error: e2 } = await sb.from("laundry_balances").select("*");
      if (e2) throw e2;
      const byBucket: Record<string, any> = {};
      for (const row of bal || []) byBucket[row.bucket] = row;
      return jsonResp({
        counts: counts || [],
        balances: { store: byBucket.store || null, laundry: byBucket.laundry || null },
      });
    }

    if (action === "getLaundryMovements" && req.method === "GET") {
      const raw = Number(url.searchParams.get("limit"));
      const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, 200) : 50;
      const { data, error } = await sb.from("laundry_movements")
        .select("*")
        .order("moved_on", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return jsonResp({ movements: data || [] });
    }

    // Manager-only, même règle que setCancelled / setPostponed : ce chiffre est
    // la référence opposée à la blanchisserie, il ne s'écrit pas depuis un compte cleaner.
    if (action === "addLaundryMovement" && req.method === "POST") {
      const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
      if (me && me.role !== "manager") return jsonResp({ error: "manager role required" }, 403);
      const body = await req.json();
      const { kind, moved_on, note, author } = body;
      if (!["out", "in", "adjust_store", "adjust_laundry"].includes(kind)) {
        return jsonResp({ error: "invalid kind" }, 400);
      }
      if (!moved_on || !/^\d{4}-\d{2}-\d{2}$/.test(String(moved_on))) {
        return jsonResp({ error: "moved_on required (YYYY-MM-DD)" }, 400);
      }
      const q = readLaundryQty(body, String(kind).startsWith("adjust_"));
      if (q.error) return jsonResp({ error: q.error }, 400);
      const { data, error } = await sb.from("laundry_movements").insert({
        kind, ...q.values, moved_on,
        note: note || null,
        author: author || "Manager",
      }).select().single();
      if (error) throw error;
      return jsonResp({ status: "success", movement: data });
    }
```

- [ ] **Step 4: Type-check locally**

```bash
npx deno check supabase/functions/hostaway-proxy/index.ts
```

Expected: no errors. Fix any before deploying.

- [ ] **Step 5: Deploy the proxy**

```bash
npm run deploy:proxy
```

Never use a bare `npx supabase functions deploy`, it flips `verify_jwt` back to true and takes down the entire app.

- [ ] **Step 6: Verify the endpoints against the deployed function**

Read the app secret out of `app.js` (`const APP_SECRET=` near the API constant) and export it as `SECRET`, then:

```bash
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'

# 1. Empty balances, both buckets present.
curl -sS "$BASE?action=getLaundrySummary&start=2026-07-01&end=2026-07-31" -H "X-App-Secret: $SECRET"

# 2. Reject a bad payload (missing fields are not integers).
curl -sS -X POST "$BASE?action=saveLaundryCount" -H "X-App-Secret: $SECRET" \
  -H 'Content-Type: application/json' -d '{"reservation_key":"2026-07-30_TEST"}'

# 3. Accept a valid one.
curl -sS -X POST "$BASE?action=saveLaundryCount" -H "X-App-Secret: $SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"reservation_key":"2026-07-30_TEST","pillowcases":4,"bed_sheets":2,"duvet_covers":1,"small_towels":3,"large_towels":2,"bath_mats":1,"author":"curl"}'

# 4. Read it back and confirm counted_on was derived as 2026-07-30.
curl -sS "$BASE?action=getLaundryCount&key=2026-07-30_TEST" -H "X-App-Secret: $SECRET"

# 5. Store balance must now show pillowcases 4.
curl -sS "$BASE?action=getLaundrySummary&start=2026-07-01&end=2026-07-31" -H "X-App-Secret: $SECRET"

# 6. Movement in, then confirm the store balance drops back to 0 and laundry rises to 4.
curl -sS -X POST "$BASE?action=addLaundryMovement" -H "X-App-Secret: $SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"out","pillowcases":4,"bed_sheets":2,"duvet_covers":1,"small_towels":3,"large_towels":2,"bath_mats":1,"moved_on":"2026-07-30","note":"curl test","author":"curl"}'
curl -sS "$BASE?action=getLaundrySummary&start=2026-07-01&end=2026-07-31" -H "X-App-Secret: $SECRET"

# 7. Reject an unknown kind.
curl -sS -X POST "$BASE?action=addLaundryMovement" -H "X-App-Secret: $SECRET" \
  -H 'Content-Type: application/json' -d '{"kind":"nope","moved_on":"2026-07-30"}'
```

Expected: 2 and 7 return 400 with a field name, the rest return success, and step 6 leaves `store` at 0 and `laundry` at the amounts sent.

- [ ] **Step 7: Clean up the test rows**

```sql
DELETE FROM public.laundry_counts WHERE reservation_key = '2026-07-30_TEST';
DELETE FROM public.laundry_movements WHERE author = 'curl';
```

Confirm `SELECT * FROM public.laundry_balances` is back to all zeros.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(laundry): actions proxy de comptage, soldes et mouvements"
```

---

### Task 4: Blocking laundry sheet on the cleaner side

**Files:**
- Modify: `app.js` (`markDone` around line 1513, laundry section from Task 2, card detail around line 3499)
- Modify: `styles.css` (append at end of file)

**Interfaces:**
- Consumes: `LAUNDRY_ITEMS`, `laundryParseCounts`, `laundryPrefill` from Task 2; `saveLaundryCount` and `getLaundryCount` from Task 3.
- Produces:
  - `laundryCountCache: Record<string, Row>` module state
  - `openLaundrySheet(key)`, `closeLaundrySheet()`, `laundryStep(itemKey, delta)`, `submitLaundrySheet()`
  - `markDone(key, opts)` where `opts.skipLaundry === true` bypasses the sheet

- [ ] **Step 1: Gate markDone behind the sheet**

Change the signature at line 1513 and add the guard as the first thing that happens on the transition to done:

```javascript
async function markDone(key,opts){
  if(savingDone)return;
  const nw=!done[key];
  // Marking done always goes through the laundry sheet. The sheet calls back
  // with skipLaundry once the count is saved. Bulk mark-done opts out on
  // purpose: it is a manager catch-up tool, and 20 sheets in a row is unusable.
  if(nw&&!(opts&&opts.skipLaundry)){openLaundrySheet(key);return;}
  // ... rest of the existing body, unchanged
```

Then in `bulkMarkDoneSelected` at line 491, pass the bypass:

```javascript
  for(const k of keys){ if(!done[k]) await markDone(k,{skipLaundry:true}); }
```

Leave every other call site alone. The delegated `data-action="markDone"` handler passes only `data-arg0`, so `opts` arrives undefined and the sheet opens, which is what we want for all card and row paths including the `#doneYes` confirmation overlay at line 1963.

- [ ] **Step 2: Add the sheet to the laundry section of app.js**

Append to the laundry section created in Task 2:

```javascript
// ============ LAUNDRY: cleaner sheet ============
let laundryCountCache={};
let laundrySheetKey=null;

async function openLaundrySheet(key){
  laundrySheetKey=key;
  renderLaundrySheet();
  // Prefill from an earlier submission so a correction never starts from blank.
  if(laundryCountCache[key]===undefined){
    try{
      const r=await api('getLaundryCount',{params:{key}});
      laundryCountCache[key]=(r&&r.count)||null;
    }catch(e){laundryCountCache[key]=null;}
    if(laundrySheetKey===key)renderLaundrySheet();
  }
}

function closeLaundrySheet(){laundrySheetKey=null;renderLaundrySheet();}

// The delegated click handler walks up to the nearest [data-action], so a click
// on an input inside the box resolves to the overlay. Guard on the actual click
// target, exactly like __closeExtraModalBackdrop at app.js:123. Putting
// data-stop-propagation on the box does nothing: that attribute is only read on
// the element that carries data-action.
function __closeLaundrySheetBackdrop(e){ if(e.target.classList.contains('modal-overlay'))closeLaundrySheet(); }

function renderLaundrySheet(){
  let el=document.getElementById('laundrySheet');
  if(!el){el=document.createElement('div');el.id='laundrySheet';document.body.appendChild(el);}
  if(!laundrySheetKey){el.innerHTML='';return;}
  const key=laundrySheetKey;
  const prev=laundryCountCache[key];
  const res=(RESERVATIONS||[]).find(r=>keyFor(r)===key);
  const where=res?(res.listing||res.guest||''):'';
  el.innerHTML='<div class="modal-overlay" data-action="__closeLaundrySheetBackdrop" data-pass-event="1">'+
    '<div class="modal-box laundry-box">'+
      '<div class="laundry-title">Laundry collected</div>'+
      (where?'<div class="laundry-sub">'+esc(where)+'</div>':'')+
      '<div class="laundry-rows">'+
      LAUNDRY_ITEMS.map(it=>{
        const v=prev&&prev[it.key]!=null?String(prev[it.key]):'';
        return '<div class="laundry-row">'+
          '<label class="laundry-label" for="lq_'+it.key+'">'+it.label+'</label>'+
          '<button type="button" class="laundry-step" data-action="laundryStep" data-arg0="lq_'+it.key+'" data-arg1="-1" aria-label="Less '+it.label+'">&minus;</button>'+
          '<input class="laundry-input" id="lq_'+it.key+'" type="text" inputmode="numeric" pattern="[0-9]*" value="'+v+'" autocomplete="off">'+
          '<button type="button" class="laundry-step" data-action="laundryStep" data-arg0="lq_'+it.key+'" data-arg1="1" aria-label="More '+it.label+'">+</button>'+
        '</div>';
      }).join('')+
      '</div>'+
      '<div class="laundry-error" id="laundryError"></div>'+
      '<div class="laundry-actions">'+
        '<button class="btn-secondary" data-action="closeLaundrySheet">Cancel</button>'+
        '<button class="btn-success" id="laundryConfirm" data-action="submitLaundrySheet" disabled>Confirm &amp; mark done</button>'+
      '</div>'+
    '</div></div>';
  el.querySelectorAll('.laundry-input').forEach(inp=>{
    // Select on focus so a typed digit replaces the value instead of appending.
    inp.addEventListener('focus',()=>inp.select());
    inp.addEventListener('input',syncLaundryConfirm);
  });
  syncLaundryConfirm();
}

function readLaundrySheetValues(){
  const out={};
  LAUNDRY_ITEMS.forEach(it=>{
    const inp=document.getElementById('lq_'+it.key);
    out[it.key]=inp?inp.value.trim():'';
  });
  return out;
}

// The button stays dead until all six fields hold a value. An explicit zero is
// a real answer, a blank field is not, and that distinction is the only thing
// that makes these numbers worth anything against the laundry provider.
function syncLaundryConfirm(){
  const btn=document.getElementById('laundryConfirm');
  if(!btn)return;
  const parsed=laundryParseCounts(readLaundrySheetValues());
  btn.disabled=!parsed.ok;
}

// Takes the full input id, not the item key, so the cleaner sheet (lq_ prefix)
// and the manager movement form (lm_ prefix) can share one stepper without
// their inputs ever colliding on a duplicate DOM id.
function laundryStep(inputId,delta){
  const inp=document.getElementById(inputId);
  if(!inp)return;
  const cur=inp.value.trim()===''?0:Number(inp.value);
  const next=(Number.isInteger(cur)?cur:0)+Number(delta);
  inp.value=String(next<0?0:(next>999?999:next));
  syncLaundryConfirm();
}

async function submitLaundrySheet(){
  const key=laundrySheetKey;
  if(!key)return;
  const parsed=laundryParseCounts(readLaundrySheetValues());
  const errEl=document.getElementById('laundryError');
  if(!parsed.ok){if(errEl)errEl.textContent='Check the '+parsed.field.replace(/_/g,' ')+' field.';return;}
  const btn=document.getElementById('laundryConfirm');
  if(btn){btn.disabled=true;btn.textContent='Saving...';}
  try{
    await apiWrite('saveLaundryCount',{body:Object.assign({
      reservation_key:key,
      author:cleanerMode?cleanerMode.name:'Manager',
    },parsed.values)});
  }catch(e){
    if(errEl)errEl.textContent='Could not save the laundry count. Try again.';
    if(btn){btn.disabled=false;btn.textContent='Confirm & mark done';}
    return;
  }
  laundryCountCache[key]=Object.assign({reservation_key:key},parsed.values);
  closeLaundrySheet();
  // Only now does the existing done flow run, with its 5s undo toast.
  markDone(key,{skipLaundry:true});
}
```

Two behaviours of the delegated handler at `app.js:52-79` that this code relies on, both verified: it forwards `data-arg0` through `data-arg9` in order, and it coerces each one, so `data-arg1="-1"` arrives as the number `-1`, not the string. `data-arg0="pillowcases"` stays a string because it does not match the numeric pattern. Do not add a `Number()` call around `delta`, it is already a number.

- [ ] **Step 3: Add the Laundry button to the card detail**

At line 3499, next to the existing Mark done / Undo buttons in `renderCardDetail`, add:

```javascript
  h += '<button class="btn-secondary" data-action="openLaundrySheet" data-arg0="'+esc(k)+'">'+icon('clipboard',14)+' Laundry</button>';
```

This is what lets anyone reopen the sheet prefilled to fix a wrong count after the fact.

- [ ] **Step 4: Add the styles**

Append to `styles.css`:

```css
/* ============ LAUNDRY SHEET ============ */
.laundry-box { max-width: 420px; width: 100%; }
.laundry-title { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
.laundry-sub { font-size: 13px; opacity: 0.65; margin-bottom: 14px; }
.laundry-rows { display: flex; flex-direction: column; gap: 10px; }
.laundry-row { display: grid; grid-template-columns: 1fr auto 64px auto; align-items: center; gap: 8px; }
.laundry-label { font-size: 14px; }
.laundry-step {
  width: 38px; height: 38px; border-radius: 10px; font-size: 20px; line-height: 1;
  border: 1px solid var(--border, #d4d4d8); background: var(--card, #fff); cursor: pointer;
}
.laundry-step:active { transform: scale(0.94); }
.laundry-input {
  width: 64px; height: 38px; text-align: center; font-size: 17px; font-weight: 600;
  border-radius: 10px; border: 1px solid var(--border, #d4d4d8); background: var(--card, #fff);
}
.laundry-error { min-height: 18px; font-size: 13px; color: #dc2626; margin-top: 8px; }
.laundry-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; }
.laundry-actions button { flex: 1; padding: 12px; font-size: 15px; }
```

- [ ] **Step 5: Verify in the browser**

Serve locally and drive the real UI:

```bash
python3 -m http.server 8888
```

Open `http://localhost:8888`, then check each of these by hand:

1. Clicking Done on any planner card opens the sheet and the card does **not** flip to done behind it.
2. With five fields filled, Confirm is greyed out. Filling the sixth enables it.
3. Typing `0` in a field counts as filled.
4. The plus and minus buttons change the value and never go below 0 or above 999.
5. Focusing a field with a value selects it, so typing `7` gives `7` and not `47`.
6. Confirm saves, closes the sheet, and the usual undo toast appears.
7. Pressing Undo then Done again reopens the sheet with the saved values prefilled.
8. Cancel closes the sheet and leaves the card untouched.

- [ ] **Step 6: Re-run the helper tests**

```bash
HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/laundry.spec.ts --project=desktop
HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/smoke.spec.ts --project=desktop
```

Expected: all pass. The smoke suite catches console errors and missing globals, which is exactly the risk when editing a 380KB file.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css
git commit -m "feat(laundry): saisie obligatoire du linge avant de marquer un menage termine"
```

---

### Task 5: Manager tab, balances, movement forms and history

**Files:**
- Modify: `app.js` (`setTab` line 2930, `render()` switch line 3050, `renderMoreMenu` items line 2938, laundry section)
- Modify: `styles.css`

**Interfaces:**
- Consumes: Task 2 helpers, `getLaundrySummary` / `getLaundryMovements` / `addLaundryMovement` from Task 3.
- Produces: `renderLaundry()`, `loadLaundry()`, `openLaundryMoveForm(kind)`, `submitLaundryMove()`, and state `laundryData`, `laundryMoves`, `laundryLoading`, `laundryMonthOffset`.

- [ ] **Step 1: Wire the tab**

The bottom nav already carries five slots (planner, dashboard, maintenance, hermes, More) and a sixth would crowd it on a phone, so Laundry goes into the More sheet. It is the first entry there, which is the closest thing to the spec's "placed after Maintenance" given Maintenance sits in the bottom nav. In `renderMoreMenu` at `app.js:2938`, add as the first entry of `items`:

```javascript
    {id:'laundry',icon:icon('clipboard',22),label:'Laundry',color:'#0ea5e9'},
```

`setTab` at `app.js:2930` is a single line. Append the load trigger to its end, keeping the existing body intact:

```javascript
function setTab(t){if(t==='__more'){openMoreMenu();return;}currentTab=t;render();if(t==='dashboard'){if(!dashData)loadDashMonth();if(!dashKPIs)loadDashKPIs();}if(t==='maintenance')ensureMtFresh();if(t==='laundry'&&laundryData===null&&!laundryLoading)loadLaundry();}
```

In `render()`, next to the other tab dispatches around line 3050:

```javascript
  if(currentTab==='laundry'){if(cleanerMode&&cleanerMode.role!=='manager'){currentTab='planner';}else return renderLaundry();}
```

- [ ] **Step 2: Add state and loader**

```javascript
// ============ LAUNDRY: manager tab ============
let laundryData=null;      // {counts:[], balances:{store,laundry}}
let laundryMoves=null;     // recent movements
let laundryLoading=false;
let laundryMonthOffset=0;  // 0 = current month
let laundryGranularity='day';
let laundryMoveKind=null;  // open form, or null

function laundryMonthRange(){
  const now=new Date();
  const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+laundryMonthOffset,1));
  const start=d.toISOString().slice(0,10);
  const endD=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));
  return{start,end:endD.toISOString().slice(0,10),
    label:MONTH_NAMES[d.getUTCMonth()]+' '+d.getUTCFullYear()};
}

async function loadLaundry(){
  laundryLoading=true;render();
  const {start,end}=laundryMonthRange();
  try{
    const [sum,mv]=await Promise.all([
      api('getLaundrySummary',{params:{start,end}}),
      api('getLaundryMovements',{params:{limit:30}}),
    ]);
    laundryData=sum||{counts:[],balances:{store:null,laundry:null}};
    laundryMoves=(mv&&mv.movements)||[];
  }catch(e){
    laundryData={counts:[],balances:{store:null,laundry:null},error:true};
    laundryMoves=[];
  }
  laundryLoading=false;render();
}

function changeLaundryMonth(dir){laundryMonthOffset+=dir;laundryData=null;loadLaundry();}
function setLaundryGranularity(g){laundryGranularity=g;render();}
```

- [ ] **Step 3: Render balances and history**

```javascript
function laundryBalanceCard(title,bal,tone){
  const b=bal||laundryZero();
  return '<div class="laundry-bal '+tone+'">'+
    '<div class="laundry-bal-title">'+title+'</div>'+
    '<div class="laundry-bal-total">'+laundryTotal(b)+'</div>'+
    '<div class="laundry-bal-items">'+
      LAUNDRY_ITEMS.map(i=>'<span><em>'+i.label+'</em><strong>'+(Number(b[i.key])||0)+'</strong></span>').join('')+
    '</div></div>';
}

function renderLaundry(){
  const r=laundryMonthRange();
  let h='<div class="header"><div class="header-top"><h1>Laundry</h1>'+
    '<div style="flex:1"></div>'+
    '<button class="icon-btn" data-action="loadLaundry" title="Refresh">'+icon('refresh',18)+'</button>'+
    '</div></div>';
  h+='<div class="container">';
  if(laundryLoading&&laundryData===null){
    h+='<div style="text-align:center;padding:40px;color:var(--text3)">Loading…</div>';
    h+='</div>'+renderBottomNav();
    document.getElementById('app').innerHTML=h;
    return;
  }
  const bal=(laundryData&&laundryData.balances)||{};
  const noMovementsEver=(laundryMoves||[]).length===0;
  if(noMovementsEver){
    h+='<div class="laundry-onboard">'+
      '<strong>Start with what you already have.</strong> '+
      'Record the dirty linen sitting at the store right now, and what is still at the laundry, '+
      'so both balances start from the truth. Use Adjust.'+
      '</div>';
  }
  h+='<div class="laundry-bals">'+
    laundryBalanceCard('Dirty at store',bal.store,'warn')+
    laundryBalanceCard('At laundry',bal.laundry,'info')+
    '</div>';
  h+='<div class="laundry-cta">'+
    '<button class="btn-success" data-action="openLaundryMoveForm" data-arg0="out">Pickup</button>'+
    '<button class="btn-primary" data-action="openLaundryMoveForm" data-arg0="in">Return</button>'+
    '<button class="btn-secondary" data-action="openLaundryMoveForm" data-arg0="adjust">Adjust</button>'+
    '</div>';

  h+=renderLaundryTable(r);   // Task 6 fills this in

  h+='<h3 class="laundry-h3">Recent movements</h3>';
  if(!laundryMoves||!laundryMoves.length){
    h+='<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px">No movement recorded yet.</div>';
  }else{
    h+='<div style="overflow-x:auto"><table class="laundry-table"><thead><tr>'+
      '<th>Date</th><th>Type</th>'+LAUNDRY_ITEMS.map(i=>'<th>'+i.label+'</th>').join('')+
      '<th>Total</th><th>By</th><th>Note</th></tr></thead><tbody>';
    laundryMoves.forEach(m=>{
      const label={out:'Pickup',in:'Return',adjust_store:'Adjust store',adjust_laundry:'Adjust laundry'}[m.kind]||m.kind;
      h+='<tr><td>'+esc(m.moved_on||'')+'</td><td>'+label+'</td>'+
        LAUNDRY_ITEMS.map(i=>'<td>'+(Number(m[i.key])||0)+'</td>').join('')+
        '<td><strong>'+laundryTotal(m)+'</strong></td>'+
        '<td>'+esc(m.author||'')+'</td><td>'+esc(m.note||'')+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }
  h+=renderLaundryMoveForm();
  h+='</div>'+renderBottomNav();
  document.getElementById('app').innerHTML=h;
}
```

This ending is copied verbatim from `renderMaintenance()` and `renderHermes()`: build a string, close the `.container` div, append `renderBottomNav()`, then assign to `#app`. There is no `setContent` helper in this codebase, do not create one.

Three class names used above exist and are styled: `header`, `header-top`, `container`, `icon-btn`, `btn-primary`, `btn-secondary`, `btn-success`. Three that look plausible do **not** exist and must not be used: `.page`, `.table-wrap`, `.data-table`. The last one is used elsewhere in `app.js` but has zero matching CSS, which is why this plan defines its own `.laundry-table` in Step 6 rather than inheriting a phantom.

- [ ] **Step 4: Render the movement form**

```javascript
function openLaundryMoveForm(kind){laundryMoveKind=kind;render();}
function closeLaundryMoveForm(){laundryMoveKind=null;render();}
function __closeLaundryMoveBackdrop(e){ if(e.target.classList.contains('modal-overlay'))closeLaundryMoveForm(); }

function renderLaundryMoveForm(){
  if(!laundryMoveKind)return '';
  const kind=laundryMoveKind;
  const isAdjust=kind==='adjust';
  const title={out:'Laundry pickup',in:'Laundry return',adjust:'Adjust balance'}[kind];
  const bal=(laundryData&&laundryData.balances)||{};
  // A pickup opens on the current store balance, so the common case is one tap.
  const pre=kind==='out'?laundryPrefill(bal.store):null;
  const today=new Date().toISOString().slice(0,10);
  return '<div class="modal-overlay" data-action="__closeLaundryMoveBackdrop" data-pass-event="1">'+
    '<div class="modal-box laundry-box">'+
    '<div class="laundry-title">'+title+'</div>'+
    (isAdjust?'<div class="laundry-row-full"><label>Which balance</label>'+
      '<select id="lmBucket"><option value="adjust_store">Dirty at store</option>'+
      '<option value="adjust_laundry">At laundry</option></select></div>':'')+
    '<div class="laundry-row-full"><label for="lmDate">Date</label>'+
      '<input id="lmDate" type="date" value="'+today+'"></div>'+
    '<div class="laundry-rows">'+
      LAUNDRY_ITEMS.map(it=>'<div class="laundry-row">'+
        '<label class="laundry-label" for="lm_'+it.key+'">'+it.label+'</label>'+
        '<button type="button" class="laundry-step" data-action="laundryStep" data-arg0="lm_'+it.key+'" data-arg1="-1">&minus;</button>'+
        '<input class="laundry-input" id="lm_'+it.key+'" type="text" inputmode="numeric" value="'+(pre?pre[it.key]:'')+'" autocomplete="off">'+
        '<button type="button" class="laundry-step" data-action="laundryStep" data-arg0="lm_'+it.key+'" data-arg1="1">+</button>'+
      '</div>').join('')+
    '</div>'+
    '<div class="laundry-row-full"><label for="lmNote">Note</label>'+
      '<input id="lmNote" type="text" placeholder="optional"></div>'+
    '<div class="laundry-error" id="laundryError"></div>'+
    '<div class="laundry-actions">'+
      '<button class="btn-secondary" data-action="closeLaundryMoveForm">Cancel</button>'+
      '<button class="btn-success" data-action="submitLaundryMove">Save</button>'+
    '</div></div></div>';
}

async function submitLaundryMove(){
  const kind=laundryMoveKind;
  if(!kind)return;
  const errEl=document.getElementById('laundryError');
  const bucketEl=document.getElementById('lmBucket');
  const realKind=kind==='adjust'?(bucketEl?bucketEl.value:'adjust_store'):kind;
  const values={};
  let bad=null;
  LAUNDRY_ITEMS.forEach(it=>{
    const el=document.getElementById('lm_'+it.key);
    const raw=el?el.value.trim():'';
    // Adjustments accept negatives, so this cannot reuse laundryParseCounts.
    const n=raw===''?0:Number(raw);
    if(!Number.isInteger(n)||Math.abs(n)>999){bad=bad||it.key;return;}
    if(n<0&&realKind.indexOf('adjust')!==0){bad=bad||it.key;return;}
    values[it.key]=n;
  });
  if(bad){if(errEl)errEl.textContent='Check the '+bad.replace(/_/g,' ')+' field.';return;}
  const dateEl=document.getElementById('lmDate');
  const noteEl=document.getElementById('lmNote');
  try{
    await apiWrite('addLaundryMovement',{body:Object.assign({
      kind:realKind,
      moved_on:dateEl?dateEl.value:new Date().toISOString().slice(0,10),
      note:noteEl?noteEl.value:'',
      author:cleanerMode?cleanerMode.name:'Manager',
    },values)});
  }catch(e){
    if(errEl)errEl.textContent=(e&&e.message)||'Could not save.';
    return;
  }
  laundryMoveKind=null;
  laundryData=null;
  loadLaundry();
}
```

- [ ] **Step 5: Add the styles**

```css
/* ============ LAUNDRY TAB ============ */
.laundry-onboard { padding: 12px 14px; border-radius: 12px; background: #fef9c3; color: #713f12; font-size: 14px; margin-bottom: 14px; }
.laundry-bals { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.laundry-bal { padding: 14px; border-radius: 14px; border: 1px solid var(--border, #e4e4e7); }
.laundry-bal.warn { background: #fff7ed; border-color: #fed7aa; }
.laundry-bal.info { background: #eff6ff; border-color: #bfdbfe; }
.laundry-bal-title { font-size: 13px; font-weight: 600; opacity: 0.7; }
.laundry-bal-total { font-size: 30px; font-weight: 800; line-height: 1.1; margin: 2px 0 8px; }
.laundry-bal-items { display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
.laundry-bal-items span { display: flex; justify-content: space-between; }
.laundry-bal-items em { font-style: normal; opacity: 0.7; }
.laundry-cta { display: flex; gap: 8px; margin-bottom: 18px; }
.laundry-cta button { flex: 1; padding: 11px; }
.laundry-h3 { margin: 22px 0 8px; font-size: 15px; }
.laundry-row-full { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; }
.laundry-row-full label { font-size: 13px; opacity: 0.7; }
.laundry-row-full input, .laundry-row-full select {
  height: 40px; border-radius: 10px; padding: 0 10px;
  border: 1px solid var(--border, #d4d4d8); background: var(--card, #fff);
}
@media (max-width: 640px) {
  .laundry-bals { grid-template-columns: 1fr; }
  .laundry-cta { flex-wrap: wrap; }
}
```

- [ ] **Step 6: Verify in the browser**

With the local server running, in manager mode:

1. The More menu shows Laundry, and the tab opens without console errors.
2. Both balance cards render at 0 with the onboarding banner visible.
3. Adjust with `store` selected and pillowcases 10 makes `Dirty at store` read 10.
4. Pickup opens prefilled at 10, saving it moves the 10 to `At laundry` and `Dirty at store` returns to 0.
5. Return with pillowcases 8 leaves `At laundry` at 2.
6. Editing the pickup down to 6 before saving leaves 4 at the store.
7. The movement history lists every entry, newest first.
8. Logged in with a cleaner PIN, the Laundry tab is not reachable, and a direct `setTab('laundry')` from the console bounces back to the planner.

Then clean up the test rows with `DELETE FROM public.laundry_movements WHERE author IN ('Manager','curl');` and confirm the balances are back to zero.

- [ ] **Step 7: Commit**

```bash
git add app.js styles.css
git commit -m "feat(laundry): onglet manager avec soldes, mouvements et historique"
```

---

### Task 6: Day and week totals table

**Files:**
- Modify: `app.js` (`renderLaundryTable`, referenced by Task 5)
- Modify: `styles.css`

**Interfaces:**
- Consumes: `laundryBucket`, `laundryTotal`, `laundrySum`, `LAUNDRY_ITEMS`, `laundryData`, `laundryGranularity`, `laundryMonthOffset`, `changeLaundryMonth`, `setLaundryGranularity`.
- Produces: `renderLaundryTable(range): string`.

- [ ] **Step 1: Implement the table**

```javascript
function renderLaundryTable(range){
  const counts=(laundryData&&laundryData.counts)||[];
  const rows=laundryBucket(counts,laundryGranularity,range.start,range.end);
  const totals=laundrySum(rows);
  // month-selector and dash-tabs are the exact classes the Dashboard uses for
  // month navigation and sub-tab switching. Reused verbatim so this tab does not
  // grow a second visual language.
  let h='<div class="month-selector">'+
      '<button data-action="changeLaundryMonth" data-arg0="-1" aria-label="Previous month">&lsaquo;</button>'+
      '<h3>'+esc(range.label)+'</h3>'+
      '<button data-action="changeLaundryMonth" data-arg0="1" aria-label="Next month">&rsaquo;</button>'+
    '</div>'+
    '<div class="dash-tabs">'+
      '<button class="dash-tab'+(laundryGranularity==='day'?' active':'')+'" data-action="setLaundryGranularity" data-arg0="day">Day</button>'+
      '<button class="dash-tab'+(laundryGranularity==='week'?' active':'')+'" data-action="setLaundryGranularity" data-arg0="week">Week</button>'+
    '</div>';
  if(!rows.length){
    return h+'<div style="text-align:center;padding:30px;color:var(--text3);font-size:13px">No laundry counted this month.</div>';
  }
  h+='<div style="overflow-x:auto"><table class="laundry-table"><thead><tr><th>'+
    (laundryGranularity==='week'?'Week':'Day')+'</th>'+
    LAUNDRY_ITEMS.map(i=>'<th>'+i.label+'</th>').join('')+
    '<th>Total</th><th>Cleanings</th></tr></thead><tbody>';
  rows.forEach(r=>{
    const label=laundryGranularity==='week'?(r.start+' to '+r.end):r.key;
    h+='<tr><td>'+esc(label)+'</td>'+
      LAUNDRY_ITEMS.map(i=>'<td>'+r[i.key]+'</td>').join('')+
      '<td><strong>'+r.total+'</strong></td><td>'+r.cleanings+'</td></tr>';
  });
  h+='</tbody><tfoot><tr><td><strong>Total</strong></td>'+
    LAUNDRY_ITEMS.map(i=>'<td><strong>'+totals[i.key]+'</strong></td>').join('')+
    '<td><strong>'+laundryTotal(totals)+'</strong></td>'+
    '<td><strong>'+rows.reduce((s,r)=>s+r.cleanings,0)+'</strong></td>'+
    '</tr></tfoot></table></div>';
  return h;
}
```

`range.label` must therefore read like `July 2026`. Build it in `laundryMonthRange()` as `MONTH_NAMES[m]+' '+y`, matching `renderDashboard()` at `app.js:3795`.

- [ ] **Step 2: Add the table styles**

`.laundry-table` is used by both this table and the movement history in Task 5. Append to `styles.css`:

```css
.laundry-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 560px; }
.laundry-table th, .laundry-table td { padding: 8px 10px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--border); }
.laundry-table th:first-child, .laundry-table td:first-child { text-align: left; }
.laundry-table thead th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--text3); font-weight: 700; }
.laundry-table tbody tr:hover { background: var(--bg); }
.laundry-table tfoot td { border-top: 2px solid var(--border); border-bottom: none; padding-top: 10px; }
```

The `min-width` plus the `overflow-x:auto` wrapper is the pattern already used for every wide table in this app: the table scrolls inside its own box instead of pushing the page sideways on a phone.

- [ ] **Step 3: Verify against real data**

1. Mark two cleanings done on the same day with known counts. The Day row for that date shows the sum and `Cleanings` reads 2.
2. Switch to Week. The two cleanings collapse into one row labelled with the Monday-to-Sunday range clipped to the month.
3. Navigate to the previous month. The table empties and the month label updates.
4. Confirm the footer totals match the column sums.
5. Confirm the first week row of a month starting mid-week is labelled from the 1st, not from the previous month's Monday.

- [ ] **Step 4: Re-run the test suites**

```bash
HK_PLANNER_URL=http://localhost:8888 npx playwright test --project=desktop
```

Expected: all suites pass, including the existing smoke and helpers specs.

- [ ] **Step 5: Commit**

```bash
git add app.js styles.css
git commit -m "feat(laundry): tableau des totaux par jour et par semaine"
```

---

### Task 7: Preview deploy, acceptance, production

**Files:**
- Modify: `sw.js` (`VERSION` at line 9)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing in code, a live feature.

- [ ] **Step 1: Deploy a preview**

```bash
netlify link --name stunning-kleicha-f61101
netlify deploy --dir .
```

Note the preview URL that `netlify deploy` prints. Do **not** pass `--prod` at this step. Production changes the daily gesture of every cleaner and needs an explicit go-ahead.

- [ ] **Step 2: Run the suites against the preview**

```bash
HK_PLANNER_URL=<preview-url> npx playwright test
```

Expected: desktop and mobile projects both green.

- [ ] **Step 3: Walk the acceptance list on the preview, on a phone viewport**

These are the ten scenarios from the spec. Each must pass before production is even discussed.

1. Done opens the sheet and marks nothing until confirmed.
2. Confirm stays disabled with five of six fields filled.
3. A complete entry saves the count and then marks the cleaning done.
4. Undo, then Done again, reopens the sheet prefilled.
5. The Day table shows the right total and cleaning count for a known day.
6. Week groups Monday to Sunday, clipped to the month.
7. A pickup prefilled at the balance, saved as is, zeroes `Dirty at store`.
8. A pickup edited downwards leaves the remainder at the store.
9. A return smaller than the pickup leaves a positive `At laundry`.
10. A cleaner logged in by PIN gets a 403 from `addLaundryMovement`. Test it with curl and a cleaner token, not just by hiding the tab.

- [ ] **Step 4: Seed the real opening balances**

Still on the preview, using Adjust: enter the dirty linen actually sitting at the store today, and what is actually at the laundry and not yet returned. These write to the same production database, so they are real from this moment on.

- [ ] **Step 5: Bump the service worker version and ship**

Only after explicit approval. Set `VERSION` in `sw.js` to `v-<YYYYMMDD>-<HHMM>-<short-sha>`, matching the existing format, then:

```bash
git add sw.js
git commit -m "chore: stamp sw VERSION for laundry release"
netlify deploy --prod --dir .
```

Skipping the version bump leaves returning users on the cached old `app.js`, which is the single most common way a deploy of this app appears to do nothing.

- [ ] **Step 6: Verify production**

```bash
npx playwright test
```

Expected: green against the production URL. Then load the app and confirm the Laundry tab and the sheet are live.

---

## Notes for the implementer

- The app has no build step. `app.js` is served as written, so a syntax error takes the whole app down. Run the smoke suite after every edit to that file.
- `RESERVATIONS`, `keyFor`, `esc`, `icon`, `api`, `apiWrite`, `toast`, `cleanerMode` and `done` are existing globals. Read their definitions before use rather than assuming signatures.
- `api(action, opts)` takes `opts.params` for query strings and `opts.body` for POST payloads. `apiWrite` is the same thing but throws when the response carries an `error` field. Use `apiWrite` for every write.
- Cleanings marked done before this ships have no count row. The `Cleanings` column will read low for the first days. That is expected and documented in the spec, not a bug to chase.
