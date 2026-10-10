# HK Manager phase 5a · More (hub, Settings, Team, Reviews, Apartment) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The More entry of `/manager/` becomes a real hub with four working sections (Settings, Team, Reviews, Apartment sheet); the other four (HR, Ratings and stats, Maintenance setup, Reports) stay links to the current app until phase 5b.

**Architecture:** Same as phases 1-4. Front: one ES module per screen under `manager/screens/`, sub-routes `#/more/<section>[/<id>]`, `manager/api.js` (15 s timeout, throws `ApiError`). Proxy: new read actions `mgr.*` in focused modules `mgr_*.ts` gated by `mgrAccess(bearerToken(req) !== null, me)` (email session + role manager, see `index.ts` `mgr.today`); writes reuse existing actions when they are already manager-gated, otherwise a new gated `mgr.*` write. Author of every write = session (`sessionActor`), never a browser field.

**Tech Stack:** Vanilla ES modules (no build), Deno edge function `hostaway-proxy` (Supabase), deno tests on the fake DB used by `mgr_*_test.ts`, Playwright projects `mgr-mobile` / `mgr-desktop`.

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` (section 4 rows « More → … », section 6 Architecture and Traçabilité, section 7 errors, section 9 phase 5). Inventory of the old screens (file:line of every old render function and proxy action): `docs/superpowers/plans/2026-10-10-hk-manager-phase5-inventory.md`.

## Global Constraints

- UI in English. No em dash (U+2014) in any UI string, comment or test name.
- Managers only: every new `mgr.*` action starts with `mgrAccess(bearerToken(req) !== null, me)` and returns its `{error, status}` when refused (401 no session, 403 not a manager / PIN only).
- Author of writes from the session (`sessionActor(me, body.actor)` from `actor.ts`); a browser-sent author (`updated_by`, `actor`, `author`) is ignored.
- Dubai dates (`todayDubai()`), never `new Date().toISOString().slice(0,10)` for a business day.
- Front errors: server message shown as is, button disabled while sending, Retry on read failure (spec section 7). Writes use an idempotency key only where the reused action already supports one; no offline queue.
- Phone (390 px) and desktop (1440 px), light and dark, no horizontal scroll, tap targets ≥ 44 px, body text ≥ 16 px. Reuse `manager/ui/components.css` classes (`card`, `btn`, `pill`, `sheet`, `top`, `ph`) and tokens; new CSS goes in `manager/ui/more.css` (linked in `manager/index.html`).
- Old app keeps working: legacy actions keep their current contract for old callers unless a task says otherwise.
- No WhatsApp automation: a WhatsApp action is at most a manual `wa.me` link the manager taps.
- Git: never `git stash`, never `git add -A`; add files by name. Comments in French without accents, like the surrounding code.
- Proxy route table `ROUTES` in `index.ts` gets every new action with its method.

## Review Focus

1. A manager signed in with a PIN only, or a cleaner session, calling any new `mgr.*` action gets 403, never data. Deno test in each proxy task.
2. Reviews: the dispute status written by the new screen records the session name in `updated_by`, and the old app's hard-coded `'walter'` is ignored too. Deno test in Task 4.
3. Settings: an inspection target outside 0-50 or not an integer is refused with a clear message and nothing is written. Deno test in Task 2.
4. Apartment sheet with no data at all (new listing: no cleaning, no ticket, no inspection, building absent from security contacts) renders every section with an empty state, no crash. Deno + Playwright in Task 5.
5. Team: deactivating a member asks for confirmation and the member disappears from the list only after the server confirms; a server refusal (e.g. system row) shows the server message. Playwright in Task 3.

---

### Task 1: More hub and sub-routing (front)

**Files:**
- Create: `manager/screens/more.js`, `manager/ui/more.css`
- Modify: `manager/app.js` (SCREENS `more`), `manager/index.html` (link `more.css` after `inspections.css`), `manager/screens/placeholder.js` (drop the `more` entry text that says everything stays in the current app; keep a generic fallback)
- Modify: `tests/manager/shell.spec.ts` (More is no longer a placeholder)
- Test: `tests/manager/more.spec.ts`

**Interfaces:**
- Produces: `export function parseMoreHash(hash) -> { section: '' | 'settings' | 'team' | 'reviews' | 'apartment', id: string | null }` (unknown section → `''`; `id` only for `apartment`, decoded); `export async function renderMore(ctx)` which, for a section, dynamically imports `/manager/screens/more-<section>.js` and calls `render<Section>(ctx, id)` (`renderSettings`, `renderTeam`, `renderReviews`, `renderApartment`). Module missing or failing to load → card « Could not load this section. » with Retry (`location.reload()`) and « Open the current app » (`/?legacy=1`). Tasks 2-5 create those modules.
- Hub (section `''`): header « More », then a list of 8 rows (button-like links, ≥ 44 px, icon optional) in this order with a one-line description:
  - Team · « Accounts, roles and invitations » → `#/more/team`
  - Apartment · « One sheet per apartment: cleanings, linen, tickets, inspections, security contacts » → `#/more/apartment`
  - Reviews · « Review disputes » → `#/more/reviews`
  - Settings · « Autopilot, notifications, inspection target, checklists » → `#/more/settings`
  - HR and leave · « In the current app for now » → `/?legacy=1`
  - Ratings and stats · « In the current app for now » → `/?legacy=1`
  - Maintenance setup · « In the current app for now » → `/?legacy=1`
  - Reports · « In the current app for now » → `/?legacy=1`
  The four legacy rows carry a small « Current app » pill. Footer: the theme toggle button already used elsewhere (`data-theme-toggle`) and « Signed in as <name> ».
- Each section screen shows a « More » back link (`#/more`) in its header; Tasks 2-5 follow this.

- [ ] **Step 1: Failing tests** (`tests/manager/more.spec.ts`, use `bootMgr`, `MANAGER`, `me`, `noHorizontalScroll` from `./helpers`): hub shows the 8 rows in order with the hrefs above; nav « More » has `aria-current`; `#/more/zzz` shows the hub; `#/more/team` with the module route aborted (`page.route('**/manager/screens/more-team.js', r => r.abort())`) shows « Could not load this section. » with Retry and a link to `/?legacy=1`; unit checks of `parseMoreHash` through `page.evaluate(import(...))`: `'#/more'` → `{section:'', id:null}`, `'#/more/apartment/123'` → `{section:'apartment', id:'123'}`, `'#/more/team/9'` → `{section:'team', id:null}`, `'#/more/apartment/%E0'` (bad encoding) → `{section:'apartment', id:null}`; no horizontal scroll at both sizes, light and dark.
- [ ] **Step 2: Run, expect FAIL**: `npx playwright test tests/manager/more.spec.ts --project=mgr-mobile --project=mgr-desktop` (check `lsof -i :8890` first).
- [ ] **Step 3: Implement** `more.js`, `more.css`, wire `SCREENS.more = ['/manager/screens/more.js', 'renderMore']`, update `shell.spec.ts` (remove the `more` placeholder row; assert the hub heading « More » instead).
- [ ] **Step 4: Run** `npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop` → all PASS.
- [ ] **Step 5: Commit** `git add manager/screens/more.js manager/ui/more.css manager/app.js manager/index.html manager/screens/placeholder.js tests/manager/more.spec.ts tests/manager/shell.spec.ts` then `git commit -m "manager: More, page d accueil et sous-routes"`.

---

### Task 2: Settings (proxy `mgr.settings`, `mgr.settings.set`, `mgr.autopilot.run`; screen)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_settings.ts`, `mgr_settings_test.ts`, `supabase/functions/hostaway-proxy/autopilot.ts`, `autopilot_test.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (ROUTES + handlers; legacy `runAutopilot` handler calls the extracted function)
- Create: `manager/screens/more-settings.js`, `manager/push.js`
- Test: `tests/manager/more-settings.spec.ts`

**Interfaces:**
- `mgr.settings` GET → `{ autopilot: boolean, inspectionTarget: number, excludedCount: number, templates: Array<{ id: number|string, name: string, items: number }>, push: { vapidPublicKey: string|null } }`.
  - `autopilot` from `app_config.auto_send_cleaners` (`'true'` → true; missing → true, same default as the legacy handler).
  - `inspectionTarget` read with the same rule as `readTarget` in `insp_read.ts` (default 4, valid 0-50): import and reuse it, do not re-implement.
  - `excludedCount` = count of `listing_config` rows with `inspection_excluded = true`.
  - `templates` from `checklist_templates` (read the table shape; `items` = length of its items/steps array, 0 if absent).
  - `vapidPublicKey` from the same source as the `getVapidPublicKey` action (reuse its helper).
- `mgr.settings.set` POST `{ key: 'autopilot' | 'inspectionTarget', value }` → `{ ok: true, settings: <same as mgr.settings> }`. `autopilot` value must be boolean; `inspectionTarget` must be an integer 0-50 (`400 { error: 'Inspection target must be a whole number from 0 to 50.' }`); unknown key → 400 `'Unknown setting.'`. Writes `app_config` (`auto_send_cleaners` as `'true'|'false'`, `inspections_daily_target` as the number string) with `updated_at`. Log one `cleaning_log` row `{ action: 'setting_changed', actor: sessionActor(me, null), details: { key, value } }` (check `cleaning_log` columns; if `reservation_key` is NOT NULL use `'settings'`).
- `autopilot.ts`: `export async function runAutopilot(sb, day: string): Promise<{ checkouts, alreadyAssigned, newlyAssigned, autoSendEnabled, notified }>` = the body of the legacy `runAutopilot` handler moved as is, except the business day is the `day` argument instead of the UTC date. Legacy handler becomes `return jsonResp({ status: 'success', ...(await runAutopilot(sb, todayDubai())) })` (keep its exact response fields). Deno test: on a fake DB with two cleaners (one on approved leave that day) and three checkouts, the leave cleaner gets nothing and the day used is the one passed in.
- `mgr.autopilot.run` POST `{}` → same object as `runAutopilot(sb, todayDubai())`; author not needed (assignments written by the function as today; if it writes an `actor`/`assigned_by`, pass `sessionActor(me, null)` instead of any literal; report what you found).
- `manager/push.js`: `export async function pushState() -> 'unsupported' | 'denied' | 'on' | 'off'`, `export async function enablePush(vapidPublicKey)`, `export async function disablePush()`, `export async function testPush()`. Uses the root service worker `/sw.js` (scope `/`, it already handles `push` events: check): `navigator.serviceWorker.getRegistration('/')` or register `/sw.js` if none; subscribe with the VAPID key; save with the existing `savePushSubscription` (read its body shape in `index.ts`), remove with `deletePushSubscription`, test with `pushTest` (manager session sends to own devices). Read the old app's `togglePushNotifications` / `subscribePush` / `sendPushTest` in `app.js` (~3504-3530) for the exact payloads; do not import `app.js`.
- Screen `#/more/settings` (`renderSettings(ctx)` in `more-settings.js`), sections as cards:
  1. Autopilot: switch « Send cleaners their jobs automatically » bound to `autopilot`; button « Run autopilot now » → `mgr.autopilot.run`, result listed: « N new assignments, M already assigned », then one row per notified cleaner with an `<a href="<waLink>" target="_blank" rel="noopener">Send on WhatsApp</a>` (manual tap, no auto-open).
  2. Notifications: state line (« On for this device » / « Off » / « Blocked in the browser settings » / « Not supported on this device »), button Turn on / Turn off, « Send a test » when on. Quiet hours note « Quiet hours 22:00 to 08:30 Dubai time. »
  3. Inspections: number input « Daily inspection target » (0-50) with Save; line « N apartments excluded from inspections » with link « Manage exclusions » → `#/inspections/fleet`.
  4. Checklists (read only): list `name · N steps`.
  Every write disables its control while sending and shows the server error message inline on failure; success toast « Saved ».

- [ ] **Step 1: Deno failing tests** `mgr_settings_test.ts` (shape, defaults, 403 for PIN/cleaner via `mgrAccess` path if tested at handler level otherwise test the pure validators `parseSettingSet(body)`; target -1, 51, 4.5, '7' rejected; 0 and 50 accepted; unknown key; autopilot non-boolean) and `autopilot_test.ts`. Run with deno: `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/mgr_settings_test.ts supabase/functions/hostaway-proxy/autopilot_test.ts` → FAIL.
- [ ] **Step 2: Implement proxy**, run those tests plus the whole proxy suite (`... deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/`) → PASS.
- [ ] **Step 3: Playwright failing tests** `tests/manager/more-settings.spec.ts` with fake `mgr.settings`, `mgr.settings.set`, `mgr.autopilot.run`: switch toggles and posts `{key:'autopilot', value:false}`; target 51 shows the server 400 message (fake returns it) and the input keeps its value; run autopilot lists two cleaners with `wa.me` links and does not navigate; « Manage exclusions » href; checklists list; push section shows « Not supported on this device » when `PushManager` is absent (delete `window.PushManager` in an init script) and never throws.
- [ ] **Step 4: Implement front**, run `npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop` → PASS.
- [ ] **Step 5: Commit** (files by name) `git commit -m "manager: More Settings (autopilot date de Dubai, notifications, objectif d inspections, checklists)"`.

---

### Task 3: Team (proxy `mgr.team`; screen)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_team.ts`, `mgr_team_test.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (ROUTES + handler)
- Create: `manager/screens/more-team.js`
- Test: `tests/manager/more-team.spec.ts`

**Interfaces:**
- `mgr.team` GET → `{ members: Array<{ id, name, role, color, phone, email: string|null, active: boolean, hasPin: boolean, hasAccount: boolean, isOwner: boolean, system: boolean }> }`, active members first then inactive (last 90 days of deactivation if a date exists, else all inactive), sorted by role (manager, cleaner, subcontractor, maintenance) then name. `hasPin` from the column that holds the PIN hash today (find it: the 2026-09-12 hotfix removed `pin_hash` from reads; check the table and `auth.ts`), never the hash itself. `hasAccount` = linked Auth user (email present and linked; read how `auth.ts` decides). `system` = `role === 'system'` rows are excluded from the list entirely.
- Writes reuse existing manager-gated actions (they already check the session role): `saveCleaner` (name, phone, color, role; roles offered: manager, cleaner, subcontractor, maintenance), `inviteCleaner` (Add and invite, Resend invite), `deleteCleaner` (Deactivate). The front calls them through `manager/api.js` `post`, which throws on `{error}`.
- Screen `#/more/team`: list grouped by role with a colored dot, name, role pill, email or « No email », small badges « PIN » (hasPin), « Account » (hasAccount), « Owner » (isOwner). Button « Add member » opens the shared sheet (`openSheet` from `manager/ui/dom.js`) with name, email (optional), phone, role, color; « Add and invite » when an email is given (calls `inviteCleaner`), « Add with PIN only » otherwise (calls `saveCleaner`; PIN field 3-8 digits required in that case). Tapping a member opens the sheet with the same fields prefilled (Save → `saveCleaner` with id), « Resend invite » if an email exists, and « Deactivate » (confirm step in the sheet: « Deactivate <name>? They will be signed out. » with Confirm / Cancel). The member leaves the list only after the server confirms. Inactive members in a collapsed « Inactive » group, read only.

- [ ] **Step 1: Deno failing test** `mgr_team_test.ts`: shape, `hasPin` true/false without exposing any hash field, system rows absent, order, inactive group, 403 path for non-manager (test the access helper the handler uses).
- [ ] **Step 2: Implement proxy**, deno tests PASS (focused, then whole proxy suite).
- [ ] **Step 3: Playwright failing tests** `tests/manager/more-team.spec.ts`: list and badges; add with email posts `inviteCleaner` with the right body; add without email requires a PIN and posts `saveCleaner`; edit role to subcontractor posts `saveCleaner` with `id` and `role`; deactivate asks confirmation, posts `deleteCleaner {id}`, member removed after success; a 403 `{error:'Only managers can do this.'}` on deactivate keeps the member and shows that message; no horizontal scroll.
- [ ] **Step 4: Implement front**, run `tests/manager` on both projects → PASS.
- [ ] **Step 5: Commit** `git commit -m "manager: More Team (comptes, roles, invitations, PIN reel)"`.

---

### Task 4: Reviews disputes (proxy gate and author; screen)

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (`getDisputes` ~4329, `updateDisputeStatus`)
- Create: `supabase/functions/hostaway-proxy/disputes.ts`, `disputes_test.ts` (move the pure parts: status enum validation and the update payload builder)
- Create: `manager/screens/more-reviews.js`
- Test: `tests/manager/more-reviews.spec.ts`

**Interfaces:**
- `updateDisputeStatus`: requires a session whose role is manager (`currentUser`; 401 without session, 403 otherwise) for every caller, old app included (old app managers have a PIN or email session token, so they keep working). `updated_by` = `sessionActor(me, null)`; the body's `updated_by` is ignored. Validation unchanged (`dispute_status` in `todo, submitted, removed, rejected, not_disputable`; `reply_posted` boolean). Response unchanged.
- `getDisputes`: requires a session (any team role allowed today? keep it to manager, the only caller is the manager Reviews tab); response unchanged.
- `disputes.ts`: `export const DISPUTE_STATUSES`, `export function buildDisputeUpdate(body, actor: string, nowIso: string) -> { ok: true, patch } | { ok: false, error }`.
- Screen `#/more/reviews`: filter chips To do · Submitted · Removed · Rejected · Not disputable · All (counts on chips; All excludes nothing). Card per review: stars, listing name, reviewer, date, public review text (English translation `public_review_en` when present, original under « Original » toggle), and when `dispute` exists: ground, confidence, quote, angle, evidence list, template text with « Copy », public reply with « Copy », status buttons (Submitted, Removed, Rejected, Not disputable, back to To do) and a « Reply posted » switch. Buttons disable while sending; server error shown on the card. Note line under the template: « Airbnb allows two removal requests per review. »

- [ ] **Step 1: Deno failing tests** `disputes_test.ts`: invalid status, non-boolean reply_posted, empty body, author from argument even when body has `updated_by:'walter'`.
- [ ] **Step 2: Implement proxy**, deno tests PASS (whole proxy suite too).
- [ ] **Step 3: Playwright failing tests** `tests/manager/more-reviews.spec.ts`: chips filter and counts; copy buttons write to clipboard (grant permissions or check `navigator.clipboard.writeText` called via init-script spy); status change posts `{review_id, dispute_status}` without `updated_by`; server 404 « review not analyzed yet » shown on the card and status unchanged.
- [ ] **Step 4: Implement front**; also update the old app: in `app.js` `setDisputeStatus` / `toggleReplyPosted` (~6455-6470) remove `updated_by:'walter'` (server ignores it anyway) and make them show the server error instead of the success toast when `r.error` is set. Run `tests/manager` both projects and `npx playwright test tests/smoke.spec.ts` → PASS.
- [ ] **Step 5: Commit** `git commit -m "manager: More Reviews (litiges d avis, auteur de session, acces manager)"`.

---

### Task 5: Apartment sheet (proxy `mgr.apartments`, `mgr.apartment`; screen)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_apartment.ts`, `mgr_apartment_test.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (ROUTES + handlers)
- Create: `manager/screens/more-apartment.js`
- Test: `tests/manager/more-apartment.spec.ts`
- Modify (links in): `manager/screens/planning-view.js`, `manager/screens/problem-view.js` (apartment name links to `#/more/apartment/<listingId>` where a listing id is known)

**Interfaces:**
- `mgr.apartments` GET → `{ listings: Array<{ id: string, apt: string, bld: string, excluded: boolean }> }` from the same listing source as `mgr.planning` `listings` (reuse its helper: `splitListing` and the listing table it reads).
- `mgr.apartment` GET `?listingId=` → 400 `'listingId required'` if absent, 404 `'Apartment not found'` if unknown, else:
  ```
  { listing: { id, apt, bld },
    health: { score: number, openTickets: number, urgentOpen: number, overdueService: number, ratingPenalty: number },
    cleanings: Array<{ date, guest: string|null, by: string[], done: boolean, cancelled: boolean, linen: LaundryRow|null }>,   // last 30 days and next 7, newest first
    tickets: { open: Array<{ ref, title, priority, createdAt, assignee: string|null }>, recent: Array<{ ref, title, resolvedAt }> },  // recent = resolved last 90 days, max 10
    inspections: Array<{ id, finishedAt, inspector, result: 'clean'|'fixed'|'maintenance', issues: number }>,  // last 5
    security: { building: string, groups: Array<{ units: string[], phone: string|null, emails: string[], portal: string|null, notes: string[] }> } | null,
    generatedAt }
  ```
  Sources, reuse don't re-implement: health = the formula of the legacy `getPropertyHealth` handler (`index.ts` ~2826) moved into `mgr_apartment.ts` as `export function healthScore(...)` and the legacy handler calls it (one definition); cleanings from the same tables and helpers `mgr.planning` uses (`reservationKey`, done/assignments/cancelled/postponed, `laundryRow`), bookings from `loadCheckoutsCached` passed in by `index.ts` like `mgr.planning`; tickets with the same `MNT-<id>` ref format as `mgr.problems`; inspections from the tables `insp.history` reads (reuse its query helper if exported, else read `insp_read.ts` and call the exported function); security from `security_contacts_doc` through the existing `security_contacts.ts` reader, matched on building name case- and accent-insensitively, `portalPassword` NOT included (the sheet shows a link « Open Security in the current app » for passwords). Missing data in any source → that section empty, never a 500.
- Screen: `#/more/apartment` = search field (« Search apartment or building ») and list (apt · building, excluded pill); `#/more/apartment/<id>` = sheet: header « Apt X · Building » with « More » back link, health score with its parts, sections Cleanings (date, who, done/cancelled pill, linen counts compact), Open tickets (link to `#/problems?ref=<ref>` if Problems supports opening by ref, else plain), Recent tickets, Inspections (link « Inspection history » → `#/inspections/history/<id>`), Security contacts. Each section has its empty state (« No cleaning in the last 30 days. », « No open ticket. », « No inspection yet. », « No security contact for this building. »).

- [ ] **Step 1: Deno failing tests** `mgr_apartment_test.ts`: full sheet on fake data; brand-new listing with no data (every section empty, health 100); unknown listing 404; health formula equals the legacy one on the same inputs (legacy handler now calls `healthScore`); security match ignores case and accents and never contains `portalPassword`.
- [ ] **Step 2: Implement proxy**, deno PASS (whole suite).
- [ ] **Step 3: Playwright failing tests** `tests/manager/more-apartment.spec.ts`: search filters by apt and building; sheet renders all sections; empty listing shows the four empty states; Planning job row and Problem detail link to the sheet; no horizontal scroll, light and dark.
- [ ] **Step 4: Implement front**, run `tests/manager` both projects → PASS.
- [ ] **Step 5: Commit** `git commit -m "manager: More fiche logement (menages, linge, tickets, inspections, contacts securite, sante unique)"`.

---

### Task 6: Deploy and verify (controller)

- [ ] Merge into `main` (fast-forward, `sw.js` stamp patch as in phases 2-4).
- [ ] Proxy: verify prod == base with `supabase functions download` + `diff -rq`, then `./deploy-proxy.sh`, then verify prod == HEAD.
- [ ] Front: `./deploy-front.sh`.
- [ ] Prod checks without a session: `mgr.settings`, `mgr.team`, `mgr.apartments`, `mgr.apartment` → 401; `updateDisputeStatus` without session → 401; `runAutopilot` legacy still answers for a manager (do not run it in prod: check route exists via 405 on wrong method); new front files 200 no-cache.
- [ ] Memory update and report to Hillal with what to test.
