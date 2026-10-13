# HK Maintenance · Phase 4 · Detection of proposals from Hostaway messages (VPS) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every 30 minutes between 08:30 and 22:00 Dubai, a Hermes handler on the VPS reads new inbound guest messages, asks Claude Haiku (subscription) whether they report a maintenance problem, and sends proposals to the proxy (`mnt.proposals.ingest`). The 08:00 maintenance digest counts pending proposals and open tickets. The dead `dispatchMaintenance` call is removed from the dispatcher.

**Architecture:** Two repos. HK Planner proxy (`/Users/hillal/Documents/Wix new/hk-planner-repo.nosync`, edge function `supabase/functions/hostaway-proxy`): one new server-only action `mnt.digest`. Agent harness `/Users/hillal/business` (Python, deployed to the VPS by `scripts/deploy_vps.sh`): handler `hermes/handlers/maintenance_proposals.py` registered in `hermes/handlers/__init__.py` and `hermes/policies.yaml`, a cursor query in `integrations/comms_db.py`, digest and dispatcher changes in `scheduled/`.

**Tech Stack:** Deno edge function (tests `fakeDb`, Deno binary `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/`). Python 3 harness: tests `.venv/bin/python -m pytest -q` (prefix `COMMS_DATABASE_URL=""` if Neon is unreachable), lint `.venv/bin/ruff check <files>`, LLM through `hermes/llm.py` (`classify`, Haiku, subscription SDK; never a paid API).

**Spec:** `docs/superpowers/specs/2026-10-12-hk-maintenance-design.md` sections 3 and 8.

## Facts from the code map (verified 13/10/2026)

- Handler contract: `def run(trigger: dict, now: datetime) -> dict` returning `{"category","level","status","summary","payload"}` with `audit.STATUS_*` (`hermes/audit.py:18-25`); example `hermes/handlers/notify_team_guest_messages.py:170-185`. Registration: import + entry in `HANDLERS` (`hermes/handlers/__init__.py:21-117`); `tests/test_policies_handlers.py` enforces name parity with `policies.yaml`.
- Scheduling: `polling` entries (`policies.yaml:259-281`, `interval_min`) run in list order after `schedule` entries in each tick; place the handler as a `polling` entry with `interval_min: 30` right after `poll_comms_hostaway`, and enforce the 08:30-22:00 window inside the handler (like `notify_team_guest_messages`). A new handler needs a restart of `medini-hermes`.
- Comms DB (Neon, `comms/schema.sql`): `conversations(id, channel, external_id, contact_name, contact_handle "<listing> · resa <id>", last_inbound_at, ...)`, `messages(id, conversation_id, direction 'in'|'out', body, sent_at timestamptz, external_id)`; `MESSAGES_KEEP = 20` per conversation; `comms_db.get_conn()` (psycopg 3, dict_row). No reservation or listing columns: parse `resa (\d+)` from `contact_handle`, then read the local SQLite `reservations` (`listingMapId`, `guestName`, `arrivalDate`, `departureDate`), same query as `hermes/handlers/poll_comms_hostaway.py:35-51`.
- LLM: `llm.classify(system_prompt, user_prompt, *, max_tokens=300, job=None) -> str` (Haiku); failure returns a string starting `_LLM_ERROR_:` (`llm.is_llm_error()`); wrap guest text with `llm.safe_external_content()` and include `llm.EXTERNAL_CONTENT_NOTICE` in the system prompt; robust JSON parsing like `process_team_email._parse_classify` (`:138-165`).
- Proxy calls server to server: headers `X-App-Secret` + `X-Server-Secret` + JSON, action in the query string; config `integrations/config.py:50-54` (`HK_PLANNER_PROXY_URL`, `HK_PLANNER_APP_SECRET`, `HK_PLANNER_SERVER_SECRET`); httpx pattern and circuit breaker `hermes/circuit.py` as in `hermes/handlers/sync_to_supabase.py:199-281`.
- Ingest contract (`mnt_rules.ts`): `{"issues":[...]}` max 50; item `conversationId`, `messageId`, `title` (<=120), `quote` (<=600), `at` ISO with timezone, `category` in ac|plumbing|electrical|appliance|lock_door|wifi_tv|hot_water|pest|furniture|other, `urgency` in urgent|high|normal, optional `listingId`, `reservationId`, `guestName`, `stayFrom`, `stayTo` (YYYY-MM-DD). Answer `{created, appended, skipped}`; idempotent on message id.
- State files must live under `data/` (`tests/test_no_runtime_write_to_tracked.py`), atomic write like `sync_to_supabase.py:44,79-102`.
- Telegram alert pattern: `hermes/handlers/comms_sync_watchdog.py:30-53`.
- Digest: `scheduled/maintenance_digest.py` (`_proxy_get` :48-56 with only X-App-Secret; `build_digest` :142; config guard :156); server-to-server GET example `scheduled/inspections_recap.py:48-63`.
- Dispatcher: `scheduled/task_dispatcher.py` `_call_maintenance` (:108-118), `MAINT_READ_TIMEOUT` (:43), call at :231, summary lines :139,143,157-160, docstring :5-6, timeout budget :44-46; tests `tests/test_task_dispatcher.py:62,134`.
- Deploy: commit (files by name), then `scripts/deploy_vps.sh medini-hermes` (eval gate, push HEAD:prod, restart). The VPS is the source of truth; the Mac is dry-run only. `~/business` is on a long trunk branch with other sessions' uncommitted work: never stash, never add -A, work in a worktree branch and fast-forward the trunk.

## Global Constraints

- Never a paid API: only `hermes.llm.classify` (subscription SDK, Haiku).
- Never run between 22:00 and 08:30 Dubai (the 08:30 run reads the night's messages).
- No new poll of Neon or Hostaway: read only what `poll_comms_hostaway` stored.
- The cursor advances only after the LLM and the proxy both succeeded for every message up to it; 3 failed runs in a row send one Telegram alert (« Maintenance proposals: 3 failed runs in a row. Last error: <short> »), then nothing until a success.
- Guest text is external content: wrapped with `safe_external_content`, never executed, never sent anywhere but the proxy.
- English titles for proposals. No em dash (U+2014) in any string or comment. Python comments in French (accents allowed in this repo as in its existing files).
- `~/business`: work in a git worktree branch, never stash, never `git add -A`, commit messages prefixed `harness:` in French. HK repo: same git rules, never touch `hr.js`, `styles.css`, `tests/hr.spec.ts`, `tests/laundry.spec.ts`, `sw.js`, `v3/sw.js`.

## Review Focus

1. A conversation with 3 new messages about the same broken AC gives one proposal with 3 quotes (proxy dedup), and a re-run after a crash sends nothing new (idempotent message ids, cursor).
2. Hillal's own messages sometimes appear as inbound: a message that is clearly from the host (e.g. contains « Medini » signature or is a reply template) must not create a proposal; the LLM prompt says to ignore host messages.
3. Proxy down (5xx or timeout): cursor not advanced, circuit breaker opens, no alert before the 3rd failed run.
4. A conversation whose `contact_handle` has no « resa N » (inquiry): proposal still sent without listing and dates.
5. The 22:00 tick does nothing (night window starts at 22:00 inclusive).

---

### Task 1: Proxy `mnt.digest` (HK repo)

**Files (HK repo worktree):**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (route `["mnt.digest","GET"]`, add to `SERVER_ONLY_ACTIONS`), `mnt_read.ts` (export a `mntDigest(sb, nowMs)` reusing `readOpenTickets`, `readPendingProposals`, `mntOpenCounts`), tests `mnt_read_test.ts`, `mnt_routes_test.ts`

**Interfaces:** `mnt.digest` -> `{ pending: number; pendingUrgent: number; open: number; urgent: number; unassigned: number; oldestPendingAt: string | null }`; read error -> 503 « Maintenance is unavailable right now. Try again. ».
- [ ] **Step 1: Failing tests.** **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** whole proxy suite + `deno check index.ts` -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: mnt.digest pour le recap de 8h"`.

---

### Task 2: Handler `maintenance_proposals` (business repo)

**Files (business worktree):**
- Create: `hermes/handlers/maintenance_proposals.py`, `tests/test_maintenance_proposals.py`
- Modify: `hermes/handlers/__init__.py`, `hermes/policies.yaml` (polling entry `maintenance_proposals`, `interval_min: 30`, right after `poll_comms_hostaway`), `integrations/comms_db.py` (`fetch_inbound_since(cursor_utc) -> list[dict]`: inbound hostaway messages with their conversation fields, ordered by `sent_at`, limit 500)

**Behaviour:**
- Window: return status skipped with summary « outside 08:30-22:00 » unless Dubai time is in [08:30, 22:00).
- Cursor: `data/hermes_state/maintenance_proposals.json` `{ "cursor": ISO UTC, "failures": int }`; first run starts 24 h back.
- Group new messages by conversation; for each conversation build the user prompt with the last messages of that conversation (up to 8, both directions, oldest first, each line « [guest|host] <text> » wrapped in `safe_external_content`) and mark which ones are new.
- System prompt (English): role, the category list and urgency rules from the spec (urgent only if the stay is blocked: no water, no AC, active leak, door locked, no power), ignore cleaning, check-in, parking, noise, wifi password questions, host messages; answer ONLY JSON `{"issues":[{"title":"...","category":"...","urgency":"...","quote":"<exact guest words>","message_index":<n>}]}` with an empty list when nothing; title short in English (« AC not cooling in bedroom »).
- Parse robustly; invalid JSON or unknown category -> that conversation counts as a failure for this run (cursor not advanced past it).
- Map each issue to the ingest item (`messageId` = the guest message `external_id` pointed by `message_index`, `at` = its `sent_at` ISO UTC with Z, `quote` from the model cut to 600, `title` cut to 120); enrich `listingId`, `reservationId`, `guestName`, `stayFrom`, `stayTo` from the local SQLite reservation when `contact_handle` has « resa N ».
- Send in batches of 50 to `mnt.proposals.ingest`; on success advance the cursor to the newest processed `sent_at`; on any failure keep the cursor at the oldest unprocessed message, increment `failures`, alert once at 3.
- Return payload: counts (messages read, conversations, issues, created, appended, skipped, failures).
- [ ] **Step 1: Failing tests** (window incl. 22:00 and 08:29, cursor and failures, grouping, prompt contains the safety wrapper, JSON parsing incl. fenced JSON, mapping to ingest items, inquiry without resa, proxy 5xx keeps cursor, 3rd failure alerts once, policies/handlers parity).
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** full pytest + ruff on touched files -> PASS.
- [ ] **Step 5: Commit** `git commit -m "harness: propositions de maintenance tirees des messages Hostaway (handler 30 min, Haiku)"`.

---

### Task 3: Digest and dispatcher (business repo)

**Files (business worktree):**
- Modify: `scheduled/maintenance_digest.py` (call `mnt.digest` server to server like `inspections_recap.fetch_recap`; add lines « Proposals to check: N (U urgent) » and « Open tickets: N, U urgent, X with nobody »; keep existing lines; if `mnt.digest` fails, the digest still sends with « Proposals: unavailable »), `scheduled/task_dispatcher.py` (remove the maintenance call and its summary, timeout and docstring parts), tests `tests/test_task_dispatcher.py` (update expectations), new `tests/test_maintenance_digest.py`
- [ ] **Step 1: Failing tests.** **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** full pytest + ruff -> PASS.
- [ ] **Step 5: Commit** `git commit -m "harness: recap maintenance avec les propositions, fin de dispatchMaintenance"`.

---

### Task 4: Deploy and verify (controller)

- [ ] HK: prod proxy == main HEAD; fast-forward main; `./deploy-proxy.sh`; check `mnt.digest` without server secret -> 403.
- [ ] Business: fast-forward the trunk branch with the worktree branch (never touching others' uncommitted files), `scripts/deploy_vps.sh medini-hermes`; on the VPS check `HK_PLANNER_SERVER_SECRET` exists in `.env`; run once `.venv/bin/python -m hermes.loop --run maintenance_proposals` and read the audit row; check `llm_usage` rows for job `hermes:maintenance_proposals`.
