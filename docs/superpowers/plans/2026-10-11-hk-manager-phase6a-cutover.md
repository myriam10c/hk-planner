# HK Manager phase 6a · Cutover (managers land on /manager/) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manager signed in with email who opens HK Planner (`/`, home screen icon, push notification) lands on `/manager/`; the old app stays reachable for 30 days with `/?legacy=1`, with a banner saying when it goes away. Phase 6b (removal of the old manager screens, from 10/11/2026) is a separate plan.

**Architecture:** Reuse the existing cleaner cutover in `app.js` (`V3_CUTOVER_DATE`, `maybeGoV3`, `v3LegacyChosen`, `?legacy=1|0` in sessionStorage, 30 s anti-loop guard, decision only after a server-verified role and never on an auth screen, never offline). Add the manager branch next to it. Deep links: a team-task push (`/?task=<id>`) maps to `/manager/#/problems?ref=TSK-<id>`, so Problems must open an item from `?ref=` in its hash.

**Tech Stack:** Vanilla JS (root `app.js` classic script, `/manager/` ES modules), Playwright (`chromium`/root projects for `app.js`, `mgr-mobile`/`mgr-desktop`).

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` section 9 phase 6 (« les managers arrivent sur `/manager/` ; ancienne app en secours via `/?legacy=1` pendant 30 jours ; puis retrait des écrans manager de `app.js` et du code mort »), section 6 Accès (« managers seulement, session email obligatoire »).

## Global Constraints

- UI in English. No em dash (U+2014) in UI strings, comments or test names.
- Redirect only a session whose role was confirmed by the server during this page load (`cleanerLogin` / `cleanerMe`), never from localStorage alone, never offline, never on an auth screen (login, Create your account, account setup), never twice within 30 s (reuse the anti-loop key pattern), never when `?legacy=1` was chosen in this tab.
- Only role `manager` with an EMAIL session (Bearer / `authAccessToken`) is redirected. A manager on a PIN session stays in the old app and sees a banner to sign in with email; cleaners keep their existing /v3/ cutover unchanged; subcontractor, maintenance, system never redirected.
- Cutover date constant `MGR_CUTOVER_DATE = '2026-10-11'` (Dubai day), legacy end date constant `MGR_LEGACY_UNTIL = '2026-11-10'` shown in banners as « 10 November 2026 ».
- `hr.js`, `styles.css`, `tests/hr.spec.ts`, `tests/laundry.spec.ts` have uncommitted prod changes in the main tree: never edit, format or commit them. `app.js` has no uncommitted changes: it may be edited.
- Git: never `git stash`, never `git add -A`; add files by name. Comments in French without accents.

## Review Focus

1. A manager on a PIN session is never sent to `/manager/` (which would only show « Sign in with your email »): banner instead. Playwright in Task 2.
2. Redirect loop: `/manager/` sends an un-allowed session back to `/`; the second redirect within 30 s must not happen. Playwright in Task 2.
3. `?legacy=1` keeps the old app for the whole tab, including reloads; `?legacy=0` restores the redirect. Playwright in Task 2.
4. A cleaner keeps going to `/v3/` exactly as before (existing `tests/v3-cutover.spec.ts` green, untouched).
5. `#/problems?ref=TSK-12` for a closed or unknown item shows a clear message, not a blank panel. Playwright in Task 1.

---

### Task 1: Problems opens an item from the hash (`#/problems?ref=`)

**Files:**
- Modify: `manager/screens/problems.js` (read `ref` from the hash query on render; open the detail panel for that ref through the same path a click uses; when the ref is not in the loaded list, fetch it with `mgr.problem.get?ref=` and open it; unknown → toast « This problem was not found. It may be closed. » and the list stays)
- Modify: `manager/screens/more-apartment.js` (ticket refs on the sheet become links `#/problems?ref=<ref>`; phase 5a left them as plain text)
- Test: `tests/manager/problems-deeplink.spec.ts`

**Interfaces:**
- Hash format `#/problems?ref=<REF>` where REF is the stable id used by `mgr.problems` (`MNT-429`, `TSK-13`, `INS-467`, `RPT-…`). After opening, the shell keeps `#/problems?ref=<REF>` while the panel is open and goes back to `#/problems` when it closes (use `history.replaceState`, no extra `hashchange`). Read how `manager/app.js` `currentView()` parses `#/problems?…` (it splits on `/` and `?`), and how `problem-panel.js` / `problem-view.js` open a panel.

- [ ] **Step 1: Failing tests**: ref in the loaded list opens its panel on load; ref not in the list but returned by `mgr.problem.get` opens; 404 from `mgr.problem.get` shows the toast and the list; closing the panel leaves `#/problems`; apartment sheet ticket link has `href="#/problems?ref=MNT-…"`.
- [ ] **Step 2: Run** `npx playwright test tests/manager/problems-deeplink.spec.ts --project=mgr-mobile --project=mgr-desktop` (after `lsof -i :8890`) → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole `tests/manager` on both projects → PASS.
- [ ] **Step 5: Commit** `git commit -m "manager: Problems s ouvre sur un element depuis le lien (#/problems?ref=)"`.

---

### Task 2: Manager cutover in the old app

**Files:**
- Modify: `app.js` (next to the cleaner cutover block ~561-620 and `mgrAppLink` ~3268)
- Test: `tests/mgr-cutover.spec.ts` (new, modelled on `tests/v3-cutover.spec.ts`; read it and `playwright.config.ts` to pick the right project and helpers)

**Interfaces:**
- Constants: `MGR_CUTOVER_DATE='2026-10-11'`, `MGR_LEGACY_UNTIL='2026-11-10'`, `MGR_CUTOVER_PATH='/manager/'`, `MGR_REDIRECT_KEY='hkMgrRedirectAt'`. The legacy choice reuses the same per-tab flag as the cleaner cutover (`?legacy=1|0`, `V3_LEGACY_KEY`): one escape hatch for everyone.
- Pure function `mgrCutoverDue(role, isEmailSession, dubaiDate, legacy)` → true only for `role==='manager' && isEmailSession && !legacy && dubaiDate >= MGR_CUTOVER_DATE`. Unit-tested from the page like `v3CutoverDue`.
- `maybeGoManager()` called at the same points as `maybeGoV3()` (after `cleanerLogin` success, after `cleanerMe` confirms, on boot), with the same guards (auth screen, offline, server-confirmed role, anti-loop 30 s). Target URL: `/manager/` plus, if the current URL has `?task=<id>` (team-task push), `#/problems?ref=TSK-<id>`. Uses `location.replace`.
- Banners in the old app (manager view only), above the main content, dismissible for the tab:
  - Legacy mode with an email session: « You are using the old manager app. It will be removed on 10 November 2026. » + button « Open the new app » → `/manager/` (and clear the legacy flag: navigate to `/?legacy=0` which redirects, or set it in code; pick the one the existing flag handling supports).
  - PIN session manager: « The new manager app needs your email sign-in. » + button « Set up email sign-in » that opens the existing account setup / link email flow (`openAccountSetup` or the Settings panel used by `needsAccountSetup()`; read it) and, if the manager already has an email, « Sign out and sign in with email ». Pick the path the existing code supports; do not invent a new auth flow.
- `mgrAppLink()` in the old More menu keeps pointing to `/manager/`.

- [ ] **Step 1: Failing tests**: email manager on `/` is sent to `/manager/`; with `?task=12` to `/manager/#/problems?ref=TSK-12`; `?legacy=1` stays (and after reload), banner text and date shown; `?legacy=0` redirects again; PIN manager not redirected and sees the PIN banner; cleaner still goes to `/v3/` (leave `tests/v3-cutover.spec.ts` as is and run it); subcontractor and maintenance never redirected; offline (`context.setOffline(true)` after load or `navigator.onLine` false) no redirect; loop guard: a second redirect within 30 s does not happen; auth screen: no redirect; date before cutover: no redirect (mock the clock).
- [ ] **Step 2: Run → FAIL** (`npx playwright test tests/mgr-cutover.spec.ts` with the project the v3 cutover spec uses).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/mgr-cutover.spec.ts`, `tests/v3-cutover.spec.ts`, `tests/manager-link.spec.ts`, `tests/smoke.spec.ts`, `tests/team-invite.spec.ts`, `tests/auth.spec.ts`, `tests/push.spec.ts` → PASS (any failure pre-existing at base must be shown failing at base too, in the report).
- [ ] **Step 5: Commit** `git commit -m "app: bascule des managers vers /manager/ (session email, ?legacy=1 jusqu au 10/11, bandeaux)"`.

---

### Task 3: Deploy and verify (controller)

- [ ] Fast-forward main (sw.js stamp patch), `./deploy-front.sh` (no proxy change: check `git diff --stat <base>..HEAD -- supabase` empty).
- [ ] Prod checks: `/app.js` contains `MGR_CUTOVER_DATE`, `/manager/screens/problems.js` served.
- [ ] Memory: phase 6a done, 6b (removal) due from 2026-11-10 with its checklist (old Dashboard + `generateInvoice` with the hard-coded Elite tariff: ask Hillal whether the invoice is still used; dead legacy actions `getPropertyHeatmap`/`addFeedback`/`getFeedback` on `guest_feedback.listing_id`; manager screens of `app.js`; `/inspections/` standalone if nothing links to it).
- [ ] Report to Hillal: what managers will see, how to get the old app (`/?legacy=1`), PIN managers must sign in with email.
