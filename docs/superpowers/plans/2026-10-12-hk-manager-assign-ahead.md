# HK Manager · Assign ahead (Today day switch + Planning bulk assign) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it fast to assign cleanings for tomorrow and the coming days. (A) Today's « Who does what » block gets a day switch (Today, Tomorrow, then the next 5 days) with the same one-tap Assign it has for today. (B) Planning gets a Select mode: pick several cleanings, assign them to one person in one go.

**Architecture:** Front only, no proxy change. Days other than today in Today are read from `mgr.planning` (already returns the week's jobs with `assigned`, `state`, `cancelled`, `days[].off`, `people[].assignable`, `people[].slot`); writes use the existing `assignCleaner` action (`{ reservation_key, cleaner_ids, mode: 'set', service_type, idem }`) exactly like `manager/screens/planning.js` `assignTo`. Bulk assign sends one `assignCleaner` per selected cleaning, sequentially, each with its own idempotence key via `createGestures()` (`manager/gesture.js`).

**Tech Stack:** Vanilla JS ES modules under `/manager/`, Playwright projects `mgr-mobile` and `mgr-desktop` (`tests/manager`, fixtures in `tests/manager/fixtures.ts` and `tests/manager/planning-fixtures.ts`, helpers in `tests/manager/helpers.ts`; local server port 8890, check `lsof -i :8890` first).

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` (sections 4 Today, 9.3 Planning). Request from Hillal 12/10/2026: « faciliter l'assignation pour le lendemain ou jour à venir », options A and B chosen.

## Global Constraints

- UI in English. No em dash (U+2014) anywhere (UI strings, comments, test names). Comments in French without accents, like the surrounding code.
- No proxy change: `git diff --stat <base>..HEAD -- supabase` must stay empty.
- Never edit, format or commit `hr.js`, `styles.css`, `tests/hr.spec.ts`, `tests/laundry.spec.ts`, `sw.js`, `v3/sw.js`. Git: never `git stash`, never `git add -A`; add files by name.
- Writes never send an author; every write carries an idempotence key through `createGestures().run(sig, (idem) => post(action, { ...body, idem }))`.
- Read-only rules stay: cached or stale data (no fresh server answer) means no write, toast « Reconnect to make changes. ».
- A person on leave that day (`days[].off`) cannot be picked (disabled, sub-label « On leave »), same rule as the existing Planning assign sheet.
- Done or cancelled cleanings are never offered for assignment.
- Listing labels always via `placeLabel()` (« Apt 1509 · Westwood »).

## Review Focus

1. Day switch on a day of next week (Today is Sunday, Tomorrow is Monday of the next Planning week): the right week is fetched (`weekStartOf(day)`), and switching back to Today shows today's block unchanged, no extra `mgr.today` call needed.
2. Fast switching between days: an older `mgr.planning` answer arriving after a newer one must not paint over the selected day (sequence guard like `st.seq` in planning.js).
3. Bulk assign partial failure: 3 selected, the 2nd write fails → the toast says how many were assigned and which apartment failed with the server message; the planning reloads; nothing is retried silently.
4. Bulk Undo puts back each cleaning's previous `assigned` list (not an empty list for all).
5. Select mode on phone (one day at a time) and desktop (7-day grid): tapping a card toggles it instead of opening the detail sheet; leaving Select mode (Cancel, week change) clears the selection.

---

### Task 1: Today, day switch on « Who does what » (option A)

**Files:**
- Modify: `manager/screens/today.js` (state `st.day`, fetch of `mgr.planning` for other days, writes)
- Modify: `manager/screens/today-view.js` (day chips in the « Who does what » header, render of another day's block, picker for another day)
- Possibly modify: `manager/ui/today.css` or the CSS file Today already uses (read `manager/index.html` to find it) for the chip row
- Test: `tests/manager/today-days.spec.ts` (new); add fixtures for `mgr.planning` reuse from `tests/manager/planning-fixtures.ts`

**Interfaces:**
- Consumes: `get('mgr.planning', { start })` → `MgrPlanning` (see `supabase/functions/hostaway-proxy/mgr_planning.ts` type: `days[{date, holiday, off}]`, `jobs[{key, kind, listingId, apt, bld, date, checkout, next, assigned, serviceType, state, cancelled, tone, word, postponedFrom}]`, `people[{id, name, role, slot, assignable}]`). Helpers from `manager/screens/planning-rules.js`: `weekStartOf`, `jobsOn`, `dayShort`, `namesOf`, `initials`, `nextLine` (planning's `next` shape). `addDays`, `dubaiToday` from `manager/ui/dom.js`.
- Behaviour:
  - Chip row in the « Who does what » section header: `Today`, `Tomorrow`, then the next 5 days as `dayShort(date)` (« Wed 15 »). Buttons with `data-wday="<YYYY-MM-DD>"`, `aria-pressed` on the selected one. Horizontal scroll on phone, no page horizontal scroll.
  - Today selected: current block exactly as now (no behaviour change, existing tests stay green).
  - Another day selected: the block title becomes « Who does what, Tue 14 » (dayShort), it shows that day's non-cancelled cleanings from `mgr.planning`: first « Not assigned » (cleanings with `assigned.length === 0` and `state !== 'done'`), each row with `placeLabel`, checkout time if any, `nextLine`, and an `Assign` button; then one group per person with their cleanings that day (people from `data.people`, role label like today). Loading state « Loading Tue 14… », error state with Retry (same wording style as Planning). Empty day: « No cleaning planned for Tue 14. ».
  - Assign on another day opens a picker sheet like `pickerSheet` (one tap = assign that person, `mode: 'set'`, `cleaner_ids: [id]`, `service_type: job.serviceType || 'CHC'`), sub-label « N jobs that day » counted on that day, people on leave that day disabled with « On leave ». After success: toast « Apt X · Bld assigned to Name » with Undo (restores previous `assigned`), then reload that week's planning (and keep the selected day). Readonly: if the planning data for that day is not a fresh server answer → refuse with « Reconnect to make changes. ».
  - Cache: keep fetched weeks in memory for the screen's life only (no localStorage). Sequence guard so a late answer for another day does not repaint the current one.
  - The rest of Today (strip, arrivals, problems, control) always stays on today.
- [ ] **Step 1: Failing tests** (`tests/manager/today-days.spec.ts`, both projects): chips shown with Today pressed; tap Tomorrow → `mgr.planning` requested with the right `start` (include a case where tomorrow is in the next week), block shows tomorrow's unassigned cleaning with placeLabel and Assign; Assign → picker, person on leave disabled; pick → `assignCleaner` posted with `reservation_key`, `cleaner_ids:[id]`, `mode:'set'`, an `idem`, no author; toast with Undo; Undo posts the previous list; back to Today shows today's block; late answer guard (delay the first planning response, switch day, first response must not paint); planning error shows Retry.
- [ ] **Step 2: Run** `npx playwright test tests/manager/today-days.spec.ts --project=mgr-mobile --project=mgr-desktop` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole `tests/manager` on both projects → PASS.
- [ ] **Step 5: Commit** `git commit -m "manager: Today, assigner les menages des jours suivants (Tomorrow et 5 jours)"`.

---

### Task 2: Planning, Select mode and bulk assign (option B)

**Files:**
- Modify: `manager/screens/planning.js` (selection state, bulk write, undo)
- Modify: `manager/screens/planning-view.js` (Select button, selected card look, bottom action bar, bulk assign sheet)
- Modify: the Planning CSS (find it from `manager/index.html` / existing `pl-` classes)
- Test: `tests/manager/planning-bulk.spec.ts` (new), fixtures from `tests/manager/planning-fixtures.ts`

**Interfaces:**
- Consumes: Planning state `st` and `write()` / `gestures` in `planning.js`; `V.screenHtml(s)`; `assignSheet` pattern for the people list.
- Behaviour:
  - Header button « Select » (hidden when read-only). In Select mode: the button reads « Cancel »; tapping a card (`data-job`) toggles its selection instead of opening the sheet (card gets `aria-pressed="true"` and a visible selected style); done and cancelled cards are not selectable (tap does nothing, they look dimmed). On the phone day view a link « Select all unassigned » selects that day's unassigned, not done, not cancelled cleanings; on desktop the same link selects them for the whole week.
  - Sticky bottom bar while at least one is selected: « N selected » + `Assign` (primary) + `Clear`.
  - `Assign` opens a sheet « Assign N cleanings » listing assignable people; one tap on a person assigns all selected to that person (`mode:'set'`, `cleaner_ids:[id]`, each job's own `service_type`). A person on leave on any selected day is disabled with « On leave Tue 14 » (first such day).
  - Writes: sequential `assignCleaner` calls, each through `gestures.run` with its own signature; stop at nothing, collect failures. Then: all ok → toast « N cleanings assigned to Name » with Undo; some failed → toast « K of N assigned to Name. Not assigned: Apt X · Bld (server message). » (no Undo for the failed ones; Undo restores the successful ones). Undo: one `assignCleaner` per successful job back to its own previous `assigned` list. Leave Select mode, clear selection, reload the week.
  - Week change or leaving the screen clears the selection and Select mode.
- [ ] **Step 1: Failing tests** (`tests/manager/planning-bulk.spec.ts`, both projects): Select toggles mode; card tap selects (no sheet opens); done/cancelled not selectable; « Select all unassigned » picks the right cards; bar count; Assign sheet with leave-disabled person; pick → N `assignCleaner` posts with distinct `idem`, right keys and service types; success toast and Undo posts previous lists per job; partial failure (route one key to 500 with `{error:"..."}`) gives the K of N toast naming the apartment; Cancel clears; read-only (stale cache) hides Select.
- [ ] **Step 2: Run** `npx playwright test tests/manager/planning-bulk.spec.ts --project=mgr-mobile --project=mgr-desktop` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole `tests/manager` on both projects → PASS.
- [ ] **Step 5: Commit** `git commit -m "manager: Planning, selection de plusieurs menages et assignation groupee"`.

---

### Task 3: Deploy and verify (controller)

- [ ] Fast-forward main (sw.js stamp patch), `./deploy-front.sh` (check `git diff --stat <base>..HEAD -- supabase` empty).
- [ ] Prod checks: served `/manager/screens/today.js` contains `data-wday` handling, `/manager/screens/planning.js` the bulk code; served `hr.js` still the uncommitted version.
- [ ] Report to Hillal in French.
