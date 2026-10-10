# HK Manager phase 5b · More (HR, Ratings and stats, Maintenance setup, Reports) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four More sections still linking to the old app (HR and leave, Ratings and stats, Maintenance setup, Reports) work inside `/manager/`, with one Elite accounting source (the server snapshot) and manager-only access.

**Architecture:** Same as phase 5a (read it: `docs/superpowers/plans/2026-10-10-hk-manager-phase5a-more.md`). Front: `manager/screens/more-<section>.js` loaded by `manager/screens/more.js` (`renderHr`, `renderPeople`, `renderSetup`, `renderReports`), CSS appended to `manager/ui/more.css`, `manager/api.js`. Proxy: new reads `mgr.*` gated by `mgrAccess(bearerToken(req) !== null, me)`; writes reuse legacy actions, which this plan gates to a manager session (PIN or email) when they are not gated yet, the same way phase 5a gated `deleteCleaner` (`deactivateRefusal` in `mgr_team.ts`) and `updateDisputeStatus` (`disputeAccess` in `disputes.ts`).

**Tech Stack:** Vanilla ES modules, Deno edge function `hostaway-proxy`, deno tests on the fake DB, Playwright `mgr-mobile` / `mgr-desktop`.

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` (section 4 rows More → Team (RH, notes), Maintenance setup, Reports; section 6 « Compta Elite : une seule source, le tarif serveur »). Inventory of the old screens with file:line: `docs/superpowers/plans/2026-10-10-hk-manager-phase5-inventory.md` (sections A2-A4, C, D).

## Global Constraints

- Everything in the Global Constraints of the phase 5a plan applies (English UI, no em dash, manager gating, session author, Dubai dates, front error handling, 390/1440 light/dark, ≥ 44 px, ≥ 16 px, `components.css` classes, no WhatsApp automation, git rules, French comments without accents, ROUTES entries).
- Accounting: numbers shown come from the server only (`cleaning_accounting_cache` snapshot, `subcontractor_pricing`); the front never computes a cost, a margin or a VAT amount, never uses a hard-coded tariff, and shows the snapshot's `computed_at` so a stale snapshot is visible. No number is invented or estimated; a missing value shows « Not available ».
- `hr.js` (root) is served from an UNCOMMITTED working-tree version in prod: never edit, format or commit `hr.js`, `styles.css`, `tests/hr.spec.ts`. The manager HR screens must match the CURRENT working-tree behaviour of `hr.js` (read the file on disk, not `git show`).
- HR owner-only actions (`hrDecideLeave`, `hrDeleteHoliday`, `hrDeleteEmployee`, `hrGetCompensation`, salary fields) stay owner-only server side; the front hides them when `isOwner` is false (from `hrOverview`).
- Legacy actions gated in this plan keep working for the old app (managers there have a PIN or email session token); check each old-app caller in `app.js` still sends through `api()` / `apiWrite()`.

## Review Focus

1. A PIN-only manager or a cleaner calling a newly gated legacy write (vendors, equipment, preventive, costs, accounting reads) gets 403 and nothing is written. Deno tests in Tasks 4 and 5.
2. A leave approval without a drawn signature is refused before sending (front) and by the server; a non-owner manager never sees Approve / Reject. Playwright in Task 1.
3. Reports for a month with no snapshot shows « No accounting snapshot for this month yet. » and no zero totals posing as real numbers. Playwright in Task 5.
4. Ratings for a cleaner with too few reviews shows « Not enough data » instead of an average. Playwright in Task 3.
5. Saving a vendor without specialty shows the server's 400 message, not « Saved ». Playwright in Task 4.

---

### Task 1: HR overview (rules module, parity, overview screen)

**Files:**
- Create: `manager/hr-rules.js` (ES module: copies of the PURE helpers of `hr.js` lines 9-180 on disk: `HR_LEAVE_TYPES`, `HR_DOC_TYPES`, `leaveDays`, `completeMonths`, `accruedAnnualDays`, `sickTiers`, `rangesOverlap`, `gratuityEstimate`, `daysUntil`, `hrSplitHistory`, `hrUpcomingHolidays`, `hrHolidayNameOn`; exported, same names and bodies)
- Create: `manager/screens/more-hr.js`, `manager/ui/signature.js` (signature pad in the shared sheet: canvas, Clear, Cancel, Confirm; `export function askSignature(title) -> Promise<string|null>` resolving a PNG data URL ≤ 100 KB or null)
- Modify: `manager/screens/more.js` (HR row → `#/more/hr`; `parseMoreHash` returns an id for `hr` (cleaner id) and `setup` (tab) as it does for `apartment`; sections `hr`, `people`, `setup`, `reports` added to the known list, each mapped to `render<Hr|People|Setup|Reports>`), `tests/manager/more.spec.ts`
- Test: `tests/manager/hr-rules.spec.ts` (parity), `tests/manager/more-hr.spec.ts`

**Interfaces:**
- Parity test: load `/hr.js` in a blank page (`page.addScriptTag`) next to `import('/manager/hr-rules.js')` and compare outputs of every helper on a table of inputs (leap year, end before start, hire date in the future, opening balance, sick tiers 0/15/16/45/90/91 days, gratuity < 1 year, 1-5 years, > 5 years with unpaid days, holidays sorted and limited). Any drift fails.
- `#/more/hr` reads `hrOverview` (GET; response `{employees, pending, upcoming, taken, today, isOwner, documents, expiring, history, holidays}`; read the handler at `index.ts` `action === "hrOverview"` for exact fields). Sections in the order of the current `hr.js` `renderHRManager`: Pending requests (only if any) with Approve / Reject for the owner (Approve asks a signature through `askSignature`, then `hrDecideLeave {id, decision:'approved', note, manager_signature}`; Reject asks an optional note, no signature), Away today, Documents expiring (≤ 60 days, days left), Team (name, job title, annual balance from `accruedAnnualDays` minus taken annual days, « On leave » pill), Not set up yet (staff without an HR record, link to their sheet), Public holidays (all upcoming, add form date + name → `hrSaveHoliday`, delete for owner → `hrDeleteHoliday`). Each team row links to `#/more/hr/<cleanerId>` (Task 2 renders it; until then the id route shows the overview).
- « Download form » on a request → `hrLeaveForm?id=` then open the returned signed URL in a new tab.

- [ ] **Step 1: Failing tests** (parity + screen: sections order, empty pending hidden, owner vs non-owner buttons, approve without signature does not post, approve with signature posts `manager_signature` starting `data:image/png`, add holiday posts and refreshes, server 403 message shown).
- [ ] **Step 2: Run** `npx playwright test tests/manager/hr-rules.spec.ts tests/manager/more-hr.spec.ts --project=mgr-mobile --project=mgr-desktop` (after `lsof -i :8890`) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/manager` on both projects → PASS.
- [ ] **Step 5: Commit** `git commit -m "manager: More HR, vue d ensemble (demandes, absents, documents, equipe, feries)"` (files by name; never `hr.js`).

---

### Task 2: HR employee sheet

**Files:**
- Modify: `manager/screens/more-hr.js` (id route `#/more/hr/<cleanerId>`)
- Test: `tests/manager/more-hr-detail.spec.ts`

**Interfaces:**
- Data from the same `hrOverview` payload (employee row, taken, documents, history) plus `hrGetCompensation?cleaner_id=` for the owner only. Sections as in the current `hr.js` `renderHRDetail`: Balances (annual accrued / taken / left, sick tiers used from `sickTiers`), Employee record (hire date, end date, job title, nationality, opening annual days and date, notes → `hrSaveEmployee`), Book leave (type, start, end, reason, days computed with `leaveDays` and the holiday names in range; employee signature through `askSignature`; → `hrSubmitLeave` with `cleaner_id`), Leave history (cancel → `hrCancelLeave {id}` with confirm; Download form), Documents (list with expiry and days left; add / edit / delete → `hrSaveDocument` / `hrDeleteDocument`), Compensation (owner only: show `hrGetCompensation`, edit salary fields through `hrSaveEmployee` re-posting the full record exactly like `hrSaveComp` in `hr.js` does, with its anti-race guard: refuse to save if the record changed since load), Delete HR record (owner only, confirm) → `hrDeleteEmployee`.
- Subcontractors have no HR record: their sheet says « Subcontractors have no HR record. »

- [ ] **Step 1: Failing tests** (balances numbers from fixtures through the rules module; save record posts the fields; book leave without signature does not post; with signature posts days computed server side (front shows its own count only as a preview); cancel asks confirm; document add/delete; compensation hidden for non-owner and shown for owner; subcontractor message).
- [ ] **Step 2: Run → FAIL. Step 3: Implement. Step 4: Run `tests/manager` both projects → PASS.**
- [ ] **Step 5: Commit** `git commit -m "manager: More HR, fiche employe (soldes, dossier, conges, documents, remuneration)"`.

---

### Task 3: Ratings and stats (proxy `mgr.people`; screen)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_people.ts`, `mgr_people_test.ts`, `supabase/functions/hostaway-proxy/kpis.ts`, `kpis_test.ts`
- Modify: `index.ts` (ROUTES + handler; legacy `getDashboardKPIs` calls the extracted function)
- Create: `manager/screens/more-people.js`; Modify `manager/screens/more.js` (row « Ratings and stats » → `#/more/people`)
- Test: `tests/manager/more-people.spec.ts`

**Interfaces:**
- `kpis.ts`: `export async function dashboardKpis(sb, month: string, today: string)` = the body of the legacy `getDashboardKPIs` handler moved as is (response fields unchanged), business day from `today` (Dubai) where it used the UTC date. Legacy handler returns `{status:'success', kpis: await dashboardKpis(...)}` exactly as before.
- `mgr.people` GET `?month=YYYY-MM` (default current Dubai month; invalid → 400 `'month must be YYYY-MM'`) → `{ month, ratings: { computedAt: string|null, syncedAt: string|null, unmatched: number, people: Array<{ id, name, role, avgAll: number|null, avg90: number|null, count: number, enoughData: boolean, recent: Array<{ date, listingName, guest, score }> /* last 10 */ }> }, performance: Array<{ id, name, role, cleanings: number, avgMinutes: number|null, fastest: number|null, slowest: number|null, timed: number }> }`. Ratings from `getCleanerRatings`' table (`payload_json.cleaners[cid]`), names from `cleaners` (active and inactive so old ratings keep a name), performance from `dashboardKpis(...).cleanerPerformance`. `enoughData` false → averages null.
- Screen `#/more/people`: month picker (prev / next), per person card: name, role pill, 90-day and all-time cleanliness average (« Not enough data » when `enoughData` false), review count, cleanings this month, average / fastest / slowest time (minutes, « No timer » when `timed` is 0), « Recent reviews » expandable list. Freshness line « Ratings computed <date time Dubai> ». English only.

- [ ] **Step 1: Deno failing tests** (`kpis_test.ts`: same output as the old body on a fake DB, Dubai day at 01:00; `mgr_people_test.ts`: shape, not enough data, inactive names, month validation, access).
- [ ] **Step 2: Implement proxy, whole proxy suite PASS + `deno check index.ts`.**
- [ ] **Step 3: Playwright failing tests, Step 4: implement front, `tests/manager` both projects PASS.**
- [ ] **Step 5: Commit** `git commit -m "manager: More notes et stats (mgr.people, KPIs extraits, anglais)"`.

---

### Task 4: Maintenance setup (gates, `mgr.setup`; screen)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_setup.ts`, `mgr_setup_test.ts`
- Modify: `index.ts` (gate `saveVendor`, `deleteVendor`, `saveEquipment`, `savePreventiveMaintenance`, `completePreventive`, `addMaintenanceCost` to a manager session, PIN or email, before any write, through one exported helper `setupAccess(me)` in `mgr_setup.ts`; `addMaintenanceCost` records the author from the session if the table has an author column, else nothing; ROUTES + `mgr.setup` handler)
- Modify: `app.js` old callers of those actions (~3047-3083): use `apiWrite` and show the server message instead of « Saved » on error (same pattern as phase 5a Task 4 / final fix item 8)
- Create: `manager/screens/more-setup.js`; Modify `manager/screens/more.js` (row « Maintenance setup » → `#/more/setup`, optional tab id `vendors|equipment|preventive|costs`)
- Test: `tests/manager/more-setup.spec.ts`

**Interfaces:**
- `mgr.setup` GET `?month=YYYY-MM` → `{ vendors: Vendor[], equipment: Equipment[], schedules: Schedule[], costs: Cost[] /* month */, listings: Array<{id, apt, bld}>, month }` (columns as the legacy getters return them; listings from the same helper as `mgr.apartments`). Equipment and schedules carry `listingLabel` (apt · building) resolved server side so no « Unknown ».
- Screen tabs Vendors · Equipment · Preventive · Costs. Vendors: list, add / edit (name, phone, email, specialty required, hourly rate, notes) → `saveVendor` (with `id` on edit), delete with confirm → `deleteVendor`. Equipment: list by apartment, add / edit including install date, warranty until, service interval days, condition → `saveEquipment`. Preventive: list with next due, add / edit → `savePreventiveMaintenance`, « Mark done » with actual cost and notes → `completePreventive`. Costs: month picker, list and total of the month (sum of server amounts, display only), add cost (apartment, category, description, amount, vendor, date) → `addMaintenanceCost`. Every save shows the server message on error and refreshes from `mgr.setup` on success.

- [ ] **Step 1: Deno failing tests** (`setupAccess`: no session → 403, cleaner → 403, maintenance role → 403 (all current staff who use setup are managers), subcontractor → 403, manager PIN session → allowed; `mgr.setup` shape, labels, month validation).
- [ ] **Step 2: Implement proxy + old app change; Deno suite PASS; `npx playwright test tests/smoke.spec.ts` PASS.**
- [ ] **Step 3: Playwright failing tests (incl. vendor without specialty shows the 400 message), Step 4: implement front, `tests/manager` PASS.**
- [ ] **Step 5: Commit** `git commit -m "manager: More configuration maintenance (prestataires, equipements, preventif, couts, acces manager)"`.

---

### Task 5: Reports (single Elite accounting, ops, properties, exports)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_reports.ts`, `mgr_reports_test.ts`
- Modify: `index.ts` (ROUTES + `mgr.reports`; gate `getCleaningAccounting`, `listCleaningAccountingMonths`, `exportCleaningsCsv`, `exportMaintenanceCsv` to a manager session, PIN or email, through `reportsAccess(me)`)
- Create: `manager/screens/more-reports.js`; Modify `manager/screens/more.js` (row « Reports » → `#/more/reports`)
- Test: `tests/manager/more-reports.spec.ts`

**Interfaces:**
- `mgr.reports` GET `?month=YYYY-MM` → `{ month, months: string[] /* months with a snapshot, newest first */, accounting: null | { computedAt, syncedAt, rowsCount, unmatchedCount, totals: <totals_json as stored>, rows: <payload_json.rows as stored>, unmatchedResa: <payload_json.unmatched_resa>, unmatchedPricing: <payload_json.unmatched_pricing> }, ops: <dashboardKpis(month) from Task 3>, properties: Array<{ listingId, apt, bld, score, openTickets, urgentOpen }> /* healthScore from mgr_apartment.ts for every listing, worst first; read inputs in batched queries, not one query per listing */ }`. The accounting object is passed through as stored: no recomputation server side either.
- Screen `#/more/reports`, month picker over `months`, sections:
  1. Elite accounting: totals (cleanings, revenue TTC, cost HT, margin HT, margin %, VAT net) exactly as in `totals`, breakdown by service and by bedrooms when present, unmatched counts with the lists collapsible, line « Computed <Dubai date time> »; if the snapshot is older than 3 hours, a warning pill « Snapshot is older than 3 hours ». No snapshot → « No accounting snapshot for this month yet. ». Button « Download CSV » builds a CSV client side from `rows` (columns = the row keys in their stored order, values as stored).
  2. Operations: KPIs from `ops` (average cleaning time, timer sessions, open tickets, resolved this month, average resolution hours, last 7 days completions as a simple bar row).
  3. Properties: health ranking (worst first, 20 shown, « Show all »), each row links to `#/more/apartment/<listingId>`.
  4. Exports: « Cleanings CSV » and « Maintenance CSV » for the month: authenticated `fetch` with the same headers as `manager/api.js` (export a `download(action, params, filename)` helper from `manager/api.js`), saved through a Blob link; server error shown.
  5. Inspection reports: link « Open inspection reports » → `#/inspections/reports`.
- Number formatting: AED with 2 decimals for money (`Intl.NumberFormat('en-AE')`), percentages with 1 decimal; values that are null or missing → « Not available ».

- [ ] **Step 1: Deno failing tests** (shape, pass-through of totals/rows unchanged, no snapshot → `accounting:null`, months order, properties batched and worst first, `reportsAccess`, month validation).
- [ ] **Step 2: Implement proxy; old app Subs and exports still work for a manager session (check `app.js` callers send through `api()`); Deno suite PASS.**
- [ ] **Step 3: Playwright failing tests** (totals displayed verbatim from fixture, stale warning, no-snapshot message, CSV download content, export error shown, property row link). **Step 4: implement front, `tests/manager` PASS.**
- [ ] **Step 5: Commit** `git commit -m "manager: More rapports (compta Elite unique depuis le snapshot serveur, operations, sante des logements, exports)"`.

---

### Task 6: Deploy and verify (controller)

- [ ] Rebase on main if main moved; fast-forward merge with the `sw.js` stamp patch.
- [ ] Proxy: prod == main before (download + diff), deploy, prod == HEAD after.
- [ ] Front deploy; check new files 200; newly gated actions → 401/403 without session; `getCleaners` 200.
- [ ] Memory update; report to Hillal, including that the old app's Dashboard and invoice still use the hard-coded Elite tariff until phase 6 removes those screens (phase 6 must port the invoice from the snapshot rows if Hillal still uses it).
