# Cleaning money · done rule, owner only, deploy script · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count a team cleaning only once it is marked done, reserve the Cleaning money screen and the team figures to the owner, and make the VPS deploy script run the test suite before it opens the push.

**Architecture:** The VPS job (`~/business`) reads the done marks through the existing proxy action `getDone` and adds a `not_done` bucket to the team computation. The edge function (`hostaway-proxy`) strips the team figures from every accounting reader for non-owners and tells the front who the owner is; the front hides the row and the screen. The deploy script runs the pre-push hook itself, then pushes with a variable that tells the hook the suite already passed on that commit.

**Tech Stack:** Python 3.11 (pytest, ruff) in `/Users/hillal/business`; Deno edge function, vanilla ES modules and Playwright in `/Users/hillal/Documents/Wix new/hk-planner-repo.nosync`; bash.

**Spec:** `/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/docs/superpowers/specs/2026-11-16-cleaning-money-design.md`, section « Amendements du 17/11/2026 » (A and B). The deploy script change has no spec: it comes from the incident of 17/11/2026 (a `git push` kept open during a 271 s suite got « Connection reset by peer » twice).

## Global Constraints

- Never run a forced recursive directory deletion in any shell command (a hook blocks it and the call never returns). Leave scratch folders in place.
- Implementers do NOT commit, do not stage, do not push, do not deploy. The controller commits named files.
- Never `git stash`, never `git add -A`. Never touch `data/`, `backups/`, `.env`. In hk-planner never touch `hr.js` nor `styles.css`.
- Touch only the files listed in your task.
- No em dash (U+2014) in anything you write: code, comments, UI strings, docs, reports. Use a comma, a period or « · ».
- UI strings in English. Comments follow the language and style of the file you edit.
- hk-planner: the front computes no amount. A value absent from the server is not shown.
- hk-planner: `npx` hangs on this machine. Playwright: `node_modules/.bin/playwright test <files> --project=mgr-mobile --project=mgr-desktop`. Deno, from the repo root, always with `< /dev/null`: `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --no-config --no-lock --cached-only -A <files>`.
- business: one test file at a time, `COMMS_DATABASE_URL="" .venv/bin/python -m pytest tests/<file> -q`; lint `.venv/bin/ruff check <touched files>`. Do not run the whole suite.
- Tests make no network call.

## Review Focus

- Done marks unreadable (proxy down, wrong shape): the job must push nothing and keep the previous snapshot, never push zeros. Test in Task 1.
- A stale assignment (no checkout that day) that is also not marked done must stay in « not counted: no checkout », never be shown as « not marked done ». Test in Task 1.
- `done=None` (rule off) versus `done=set()` (nothing done): two different results. Test in Task 1.
- A manager who is not the owner, with an old cached front or calling the API directly, gets no team figure from any reader. Tests in Task 2.
- The pre-push hook run from inside another pre-push (the suite runs the hook's own tests): it must not inherit `GIT_*`, not clobber the outer log, not skip by accident. Tests in Task 3.

---

### Task 1: Done rule in the accounting job (business)

Work from `/Users/hillal/business`.

**Files:**
- Modify: `hermes/handlers/sync_cleaning_accounting.py`
- Test: `tests/test_sync_cleaning_accounting.py`

**Interfaces:**
- Consumes: proxy action `getDone` (GET, header `X-App-Secret`), response `{"status": "success", "done": {"<key>": true, ...}}`.
- Produces (read by Task 2 through the snapshot): `totals_json.team.not_done_count: int`, `payload_json.team_not_done: list[{"key", "guest", "date", "cleaner_ids"}]`.

- [ ] **Step 1: Write the failing tests** in `tests/test_sync_cleaning_accounting.py`, reusing the helpers and fixtures of `test_team_stale_assignment_is_skipped` and `test_two_team_keys_same_booking_counted_once`:
  - `test_team_not_done_is_not_counted`: two team keys in 2026-11 (`2026-11-05_Alice Martin` cleaner 4, `2026-11-06_Bob Durand` cleaner 10), each with a booking departing that day and `cleaningFee` 210, `today="2026-11-30"`, `done={"2026-11-05_Alice Martin"}`. Assert `totals["cleanings_count"] == 1`, `matched_count == 1`, `not_done_count == 1`, `skipped_count == 0`, `revenue_ttc == 210.0`, `revenue_ht == 200.0`, `out["not_done"] == [{"key": "2026-11-06_Bob Durand", "guest": "Bob Durand", "date": "2026-11-06", "cleaner_ids": [10]}]`, `[c["id"] for c in totals["by_cleaner"]] == [4]`.
  - `test_team_done_none_disables_the_rule`: same data, `done=None`: `cleanings_count == 2`, `not_done_count == 0`, `out["not_done"] == []`.
  - `test_team_not_done_does_not_take_the_booking`: two keys of the same day that resolve to the same booking; the first in sorted order is not in `done`, the second is. Assert `matched_count == 1`, the counted row has `resa_key` equal to the second key, `not_done_count == 1`, `skipped_count == 0`.
  - `test_team_unknown_guest_follows_done`: a key whose guest name matches no booking. Not in `done`: `not_done_count == 1`, `unmatched_count == 0`, `cleanings_count == 0`. In `done`: `unmatched_count == 1`, `cleanings_count == 1`, `not_done_count == 0`.
  - `test_team_stale_key_stays_skipped_when_not_done`: guest known, no departure that day, key not in `done`: one `skipped` item with reason `no_checkout`, `not_done_count == 0`.
  - `test_team_already_counted_stays_skipped_when_not_done`: the booking id is in `taken_resa_ids`, key not in `done`: one `skipped` item with reason `already_counted`, `not_done_count == 0`.
  - `test_compute_month_carries_not_done_and_leaves_elite_alone`: one Elite key and one team key, both with a booking departing that day, `done=set()`: `len(data["rows"]) == 1` (Elite row still there), `len(data["team_not_done"]) == 1`, `data["totals"]["team"]["not_done_count"] == 1`, `data["totals"]["team"]["revenue_ht"] == 0.0`.
  - `test_fetch_done_keeps_true_keys`: `httpx.get` patched to return `{"status": "success", "done": {"a": True, "b": False, "c": True}}`: result `{"a", "c"}`; the URL ends with `?action=getDone` and the headers carry `X-App-Secret`.
  - `test_fetch_done_raises_on_bad_shape`: `{"status": "success"}` raises `RuntimeError`; `{"done": []}` raises `RuntimeError`.
  - `test_run_pushes_nothing_when_done_marks_unavailable`: `_config`, `_fetch_assignments`, `_fetch_pricing`, `_fetch_cleaners` patched, `_fetch_done` raising `RuntimeError("boom")`, `_push_to_supabase` recording its calls: result `status == audit.STATUS_FAILED`, `level == "yellow"`, summary contains `marques done indisponibles`, zero push call.
  - `test_run_passes_done_to_the_month`: fetches patched (`_fetch_done` returns `set()`), `_build_resa_index` patched to an index with one team booking and a matching team key in the assignments, `_push_to_supabase` capturing `data`: every captured `data["team_not_done"]` exists and the month of the key has one item.
  - `test_push_payload_carries_team_not_done`: `httpx.post` patched to capture `json`: `json["payload_json"]["team_not_done"] == data["team_not_done"]`.

- [ ] **Step 2: Run them, they fail.** `COMMS_DATABASE_URL="" .venv/bin/python -m pytest tests/test_sync_cleaning_accounting.py -q`. Expected: the new tests fail (unknown `done` argument, missing `_fetch_done`).

- [ ] **Step 3: Implement** in `hermes/handlers/sync_cleaning_accounting.py`:
  - `_fetch_done(url: str, secret: str) -> set[str]`: GET `f"{url}?action=getDone"`, header `X-App-Secret`, timeout 60.0, `raise_for_status()`, `RuntimeError` when `done` is not a dict, returns the keys whose value is `True`. No fallback, no retry.
  - `_compute_team(month, assignments, cleaners, by_norm, today=None, taken_resa_ids=None, done: set[str] | None = None)`: `done=None` leaves today's behaviour exactly as it is. With a set, a key not in `done` is appended to `not_done` as `{"key", "guest", "date", "cleaner_ids"}` (guest = the guest part of the key) at two points only: where it would have been appended to `unmatched`, and where it would have taken the booking (after the `taken` check, before `taken.add`). Returns `{"rows", "unmatched", "skipped", "not_done", "totals"}`; `totals` gains `"not_done_count": len(not_done)`.
  - `_compute_month(..., cleaners=None, today=None, done: set[str] | None = None)`: passes `done` to `_compute_team`, returns `"team_not_done"` next to `"team_skipped"`. The Elite loop never looks at `done`.
  - `_push_to_supabase`: `payload_json` gains `"team_not_done": data["team_not_done"]`.
  - `run`: after the cleaners fetch, `done = _fetch_done(url, secret)` inside a `try`; on any exception, log it and return at once `{"category": "hermes_internal", "level": "yellow", "status": audit.STATUS_FAILED, "summary": f"{HANDLER_NAME} : marques done indisponibles, rien poussé", "payload": {"error": str(e)[:200]}}`, with no computation and no push. Otherwise pass `done` to `_compute_month`.
  - Update the module docstring (sources list: add `menage_done` read by proxy `getDone`) and the docstrings of the changed functions with the rule and its order.

- [ ] **Step 4: Run the file and lint.** Same pytest command: all tests pass (the 27 existing ones unchanged, except an assertion that lists the keys returned by `_compute_team`, which may gain `"not_done"`). `.venv/bin/ruff check hermes/handlers/sync_cleaning_accounting.py tests/test_sync_cleaning_accounting.py`: clean.

- [ ] **Step 5: Report.** No commit.

---

### Task 2: Owner only, and the not-done line on the screen (hk-planner)

Work from `/Users/hillal/Documents/Wix new/hk-planner-repo.nosync`.

**Files:**
- Modify: `supabase/functions/hostaway-proxy/mgr_reports.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (four handlers only: `mgr.reports`, `cleanerMe`, `getCleaningAccounting`, `listCleaningAccountingMonths`)
- Modify: `manager/app.js` (the line that builds `me`), `manager/screens/more.js`, `manager/screens/more-money.js`
- Test: `supabase/functions/hostaway-proxy/mgr_reports_test.ts`, `tests/manager/helpers.ts`, `tests/manager/more.spec.ts`, `tests/manager/more-money.spec.ts`

**Interfaces:**
- Consumes: `team.not_done_count` (Task 1).
- Produces, in `mgr_reports.ts`:
  - `export const OWNER_ONLY_TOTALS = ["team", "potential_profit_ht"] as const;`
  - `export const OWNER_ONLY_PAYLOAD = ["team_rows", "team_unmatched", "team_skipped", "team_not_done"] as const;`
  - `export function withoutOwnerOnly(value: unknown, keys: readonly string[], isOwner: boolean): unknown`
  - `export async function isOwnerMember(sb: any, cleanerId: unknown): Promise<boolean>`
  - `export async function mgrReports(sb: any, month: string, o: { today: string; isOwner: boolean }): Promise<MgrReports>`
- Produces, in the `cleanerMe` response: `cleaner.isOwner: boolean` (absent when the read of the member row fails).

- [ ] **Step 1: Write the failing Deno tests** in `mgr_reports_test.ts` (the shared `OPTS` gains `isOwner: true` so the existing tests keep their meaning):
  - `withoutOwnerOnly: owner gets the same object`: `withoutOwnerOnly(t, OWNER_ONLY_TOTALS, true) === t`.
  - `withoutOwnerOnly: non owner loses the keys, keeps the rest, input untouched`: `t = { margin_ht: 10, team: { revenue_ht: 5 }, potential_profit_ht: 15 }` gives `{ margin_ht: 10 }` and `t` still has `team` and `potential_profit_ht`.
  - `withoutOwnerOnly: null, array and string returned as they are for a non owner`.
  - `mgr.reports: non owner gets the Elite totals without team nor potential_profit_ht`: a snapshot whose `totals_json` holds `margin_ht`, `team` and `potential_profit_ht`; with `isOwner: false` the response totals have `margin_ht` and neither `team` nor `potential_profit_ht`; with `isOwner: true` both are there.
  - `isOwnerMember: true only for is_owner true`: member with `is_owner: true` gives `true`; `is_owner: false` gives `false`; unknown id gives `false`; a read that errors or throws gives `false`.

- [ ] **Step 2: Run them, they fail.** Deno command of Global Constraints on `supabase/functions/hostaway-proxy/mgr_reports_test.ts`.

- [ ] **Step 3: Implement the proxy part.**
  - `withoutOwnerOnly`: owner, or a value that is not a plain object (null, array, primitive): the value itself. Otherwise a shallow copy without `keys`. Never mutates.
  - `isOwnerMember`: reads `cleaners.is_owner` by `id` with `maybeSingle()`; `true` only when there is no error and `is_owner === true`; everything else, exceptions included, is `false`.
  - `mgrReports`: `accounting.totals` goes through `withoutOwnerOnly(totals, OWNER_ONLY_TOTALS, o.isOwner)`; nothing else changes.
  - `index.ts`, `mgr.reports`: after the access check, `isOwner = await isOwnerMember(sb, me.cleaner_id)`, passed to `mgrReports`.
  - `index.ts`, `getCleaningAccounting`: keep the user returned by `currentUser`, compute `isOwner` the same way, answer with the row where `totals_json` went through `OWNER_ONLY_TOTALS` and `payload_json` through `OWNER_ONLY_PAYLOAD`.
  - `index.ts`, `listCleaningAccountingMonths`: same, `totals_json` of every month through `OWNER_ONLY_TOTALS`.
  - `index.ts`, `cleanerMe`: the existing read of `email, share_location` also selects `is_owner`, and sets `me.isOwner = emailRow.is_owner === true` in the same block as `email` and `shareLocation`.
  - `index.ts` cannot be loaded by a test (it calls `Deno.serve`): say so in your report and list the four edited places with their line numbers.

- [ ] **Step 4: Run the Deno tests.** `mgr_reports_test.ts` and `auth_test.ts` pass.

- [ ] **Step 5: Write the failing Playwright tests.**
  - `tests/manager/helpers.ts`: `export const OWNER = { id: 6, name: 'Hillal', color: '#0a84ff', role: 'manager', email: 'owner@example.com', isOwner: true };` (`MANAGER` stays without `isOwner`).
  - `tests/manager/more.spec.ts`: booted as `MANAGER`, the hub has 12 rows and none is titled `Cleaning money`; booted as `OWNER`, 13 rows and the first is `Cleaning money` with its description and `#/more/money`. Adapt the existing count assertions accordingly.
  - `tests/manager/more-money.spec.ts`: the existing tests boot as `OWNER`. New tests: `non owner : message, aucune lecture` (`MANAGER` on `#/more/money`: `[data-mn="owner-only"]` has the text `Only the owner can see this screen.`, no `[data-mn="summary"]`, and `fetchLog` holds no call containing `action=mgr.reports`); `alerte not done : singulier` (`not_done_count: 1`: the first `li` of `.mn-flags` reads exactly `1 team cleaning not marked done, not counted.`); `alerte not done : pluriel` (`not_done_count: 4`: `4 team cleanings not marked done, not counted.`); `alerte not done : absente a 0 et sans la cle`.

- [ ] **Step 6: Run them, they fail.** Playwright command of Global Constraints on the two spec files.

- [ ] **Step 7: Implement the front part.**
  - `manager/app.js`: `me` gains `isOwner: cleaner.isOwner === true`.
  - `manager/screens/more.js`: the `Cleaning money` entry of `ROWS` gains `ownerOnly: true`; `hub(ctx)` renders only the rows that are not `ownerOnly` or for which `ctx.me && ctx.me.isOwner` is true.
  - `manager/screens/more-money.js`: at the top of `renderMoney(ctx)`, when `ctx.me && ctx.me.isOwner` is not true, paint the existing header followed by `<div class="ph" data-mn="owner-only"><p role="alert">Only the owner can see this screen.</p></div>` and return without any `get`. In `flags(team)`, a new first item built like the others from `team.not_done_count` with `1 team cleaning not marked done, not counted.` and ` team cleanings not marked done, not counted.`.

- [ ] **Step 8: Run the manager tests.** `node_modules/.bin/playwright test tests/manager/more.spec.ts tests/manager/more-money.spec.ts tests/manager/more-reports.spec.ts --project=mgr-mobile --project=mgr-desktop`: all pass.

- [ ] **Step 9: Report.** No commit.

---

### Task 3: The deploy script runs the suite before it opens the push (business)

Work from `/Users/hillal/business`.

**Files:**
- Modify: `.githooks/pre-push`, `scripts/deploy_vps.sh`, `CLAUDE.md` (one sentence of the line « Déployer » in the VPS section)
- Create: `tests/test_deploy_prepush.py`

**Interfaces:**
- Produces: environment variable `PREPUSH_VERIFIED_SHA` (a full commit sha) read by the hook; environment variable `PREPUSH_LOG` (path of the pytest log, default `/tmp/prepush_pytest.log`).

- [ ] **Step 1: Write the failing tests** in `tests/test_deploy_prepush.py`. A helper builds a temporary git repository (`git init`, a user name and email, one commit), copies the real `.githooks/pre-push` into it, and writes an executable stub `.venv/bin/python` (a bash script that appends a line to the file named by `$STUB_MARKER`, prints `1 passed`, and exits with `${STUB_EXIT:-0}`). Every subprocess runs with an environment stripped of all `GIT_*` variables (same reason as in `tests/test_find_orphans.py`), with `PREPUSH_LOG` inside `tmp_path`, and with `PREPUSH_VERIFIED_SHA` set or removed explicitly by each test.
  - `test_hook_skips_suite_when_head_is_verified`: `PREPUSH_VERIFIED_SHA` = the sha of HEAD: return code 0, the marker file does not exist, stderr contains `pas relancée`.
  - `test_hook_runs_suite_when_sha_is_another_commit`: `PREPUSH_VERIFIED_SHA` = forty zeros: marker exists, return code 0.
  - `test_hook_runs_suite_without_the_variable`: marker exists, return code 0.
  - `test_hook_refuses_push_when_suite_fails`: `STUB_EXIT=1`: return code 1, stderr contains `push refusé`.
  - `test_hook_writes_its_log_where_asked`: after a run, the `PREPUSH_LOG` file exists and contains `1 passed`.
  - `test_deploy_script_runs_suite_before_push`: in the text of `scripts/deploy_vps.sh`, the first occurrence of `.githooks/pre-push` comes before the occurrence of `git push "$REMOTE" HEAD:prod`, and the line holding that push also holds `PREPUSH_VERIFIED_SHA=`.
  - `test_scripts_parse`: `bash -n` returns 0 on `.githooks/pre-push` and on `scripts/deploy_vps.sh`.

- [ ] **Step 2: Run them, they fail.** `COMMS_DATABASE_URL="" .venv/bin/python -m pytest tests/test_deploy_prepush.py -q`.

- [ ] **Step 3: Implement.**
  - `.githooks/pre-push`: the log path becomes `LOG="${PREPUSH_LOG:-/tmp/prepush_pytest.log}"` everywhere; before the suite, when `PREPUSH_VERIFIED_SHA` is not empty and equals `git rev-parse HEAD`, print `pre-push : suite déjà passée sur ce commit, pas relancée.` on stderr and exit 0. Otherwise the behaviour stays the same (same pytest command, same refusal message). The start message loses its duration: `pre-push : suite de tests…`.
  - `scripts/deploy_vps.sh`: after the uncommitted-files warning and before the push, run the hook itself with the variable removed (`env -u PREPUSH_VERIFIED_SHA .githooks/pre-push`); if it fails, print `Déploiement refusé : la suite de tests échoue.` on stderr and exit 1. Then the push line becomes `push_out=$(PREPUSH_VERIFIED_SHA="$(git rev-parse HEAD)" git push "$REMOTE" HEAD:prod 2>&1) || push_status=$?`. The message `lancement de la suite de tests (pre-push), 15 à 60 s…` becomes `suite de tests avant d'ouvrir le push…`. The header comment says: evals gate, then the test suite, then the push, and why (a push left open during the suite had its connection reset on 17/11/2026). `--force-evals` still skips the evals gate only.
  - `CLAUDE.md`, VPS section, line « Déployer » : `(= porte d'évals, puis `git push vps HEAD:prod`, refusé si l'arbre du VPS est sale)` becomes `(= porte d'évals, puis suite de tests, puis `git push vps HEAD:prod`, refusé si l'arbre du VPS est sale ; la suite tourne avant l'ouverture du push)`. Nothing else in that file.

- [ ] **Step 4: Run the file and lint.** Same pytest command: all pass. `.venv/bin/ruff check tests/test_deploy_prepush.py`: clean. `bash -n` on both scripts.

- [ ] **Step 5: Report.** No commit, no push, do not run `scripts/deploy_vps.sh`.
