# HK Manager app · Phase 2 (Problems) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Problems screen of `/manager/`: one triage inbox (maintenance tickets, inspection tickets, cleaner reports, Hermes team tasks) with filters, search, pages, a detail panel with photos, comments and history, and the Linear-style gestures Assign / Schedule / Close (+ Undo) / Comment, on desktop keyboard and phone swipe, all written through one idempotent proxy action whose author is the session; Today's problems block uses the same panel.

**Architecture:** Proxy side, a pure rules module `mgr_inbox.ts` (refs, priority, sources, due dates, ranking, filters, counts) feeds three actions behind the phase 1 access rule (`mgrAccess`, manager + email session): `mgr.problems` (list, in `mgr_problems.ts`, which also feeds Today's block), `mgr.problem.get` (`mgr_problem_get.ts`) and `mgr.problem.act` (`mgr_problem_act.ts`, idempotency through `job_events` like v3 and inspections, one new event type). Front side, a shared panel controller `manager/problem-panel.js` with pure views `manager/screens/problem-view.js`, used by Today and by the new screen `manager/screens/problems.js` (+ `problems-view.js`, `ui/swipe.js`, `ui/problems.css`). The old root app gets a "New manager app" link in More.

**Tech Stack:** Deno edge function (Supabase), supabase-js service client; vanilla JS ES modules, CSS custom properties; tests with `deno test` on the existing fake DB (`v3_fakedb.ts`) and Playwright on a local static server (port 8890) with `window.fetch` stubbed.

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` (sections 3, 4, 6, 9.2). Phase 1 plan (base and conventions): `docs/superpowers/plans/2026-10-09-hk-manager-phase1-today.md`.

## Global Constraints

- **Worktree.** Before Task 1 the controller runs, once:
  ```bash
  MAIN="/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
  WT="/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
  git -C "$MAIN" rev-parse main            # write it in the task log as BASE_SHA (Task 12 needs it)
  git -C "$MAIN" status --short            # write it in the task log as BASELINE (Task 12 compares)
  git -C "$MAIN" worktree add -b mgr-phase2 "$WT" main
  git -C "$MAIN" config --get core.bare    # must print false (known trap: a worktree can flip it; fix with git -C "$MAIN" config core.bare false)
  ln -s "$MAIN/node_modules" "$WT/node_modules"
  ```
  Every task works in `/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2` (quote it, it has a space). The `node_modules` symlink and any `deno.lock` that Deno creates are untracked: never stage them.
- **Port 8890.** Playwright's `webServer` reuses any server already on 8890 (`reuseExistingServer: true`); a server started from the main checkout would make the tests run against the wrong tree. Before any Playwright run: `lsof -nP -iTCP:8890 -sTCP:LISTEN`. Empty, or a `python3` whose cwd (`lsof -p <pid> | grep cwd`) is the worktree: go. Anything else: stop and report, do not kill someone else's server.
- Deno binary: `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno`, always with `--node-modules-dir=none`. Proxy tests run from `supabase/functions/hostaway-proxy` with `deno test --allow-all --node-modules-dir=none <files>`.
- Playwright (manager): `npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`. Root-app test (Task 11): `HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/manager-link.spec.ts --project=desktop --project=mobile`. Never against prod, never with real proxy calls.
- **Git.** Never `git add -A`, never `git add .`, never `git stash`. Stage exactly the files listed in each task. In the main checkout, `sw.js` and `v3/sw.js` carry uncommitted VERSION stamps and `hr.js`, `styles.css`, `.gitignore`, `tests/hr.spec.ts`, `tests/laundry.spec.ts` carry other people's edits: never stage, revert or tidy them (prod is served from that tree). No task of this plan touches those files.
- **Commit messages** end with exactly this one trailer line, and nothing else after it:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- UI text in English. Never an em dash or en dash used as a dash in UI strings: comma, period or " · ". Code comments in French without accents (repo habit).
- One reference format everywhere: `MNT-<ticket id>` and `TSK-<team task id>` (uppercase, hyphen). No `INS-` and no `RPT-` (see Decisions 1).
- Fragment Mono for references and timestamps, Onest for text, body ≥ 16 px, tokens of `manager/ui/tokens.css` only (no new colours). Status tones: `bad` red, `warn` amber, `ok` green, `idle` grey.
- Writes sent from `/manager/` never carry `actor`, `author` or `reported_by`: the proxy takes the author from the session (`me.name`, `me.cleaner_id`).
- Every write from `/manager/` carries an idempotency key `idem` matching `^[A-Za-z0-9_-]{8,80}$`, one new key per user gesture.
- Access to `mgr.problems`, `mgr.problem.get`, `mgr.problem.act`: `mgrAccess(bearerToken(req) !== null, me)` (401 without session, 403 `email sign-in required` on PIN, 403 `forbidden` for non-managers).
- Dubai time is UTC+4, fixed. A due date chosen as a day means 23:59:59 Dubai of that day.
- Client timeout 15 s on every proxy call (existing `manager/api.js`), server error messages shown as they are, buttons disabled while a write is in flight, read-only when the data on screen is stale (same rule as Today: not fresh, or not today's Dubai day).
- No new dependency, no build step, CSP unchanged (`script-src 'self'`, no inline script).
- Migrations are applied only in Task 12, through the Supabase MCP `apply_migration`, after Hillal's go.

## Review Focus

1. **The same problem twice.** Hermes `dispatchMaintenance` copies every unassigned ticket into a team task (`team_tasks.source_ref = 'maint:<ticket id>'`; 104 open copies in prod, 35 of them for tickets already resolved or cancelled). Expected: one row per ticket, copies never listed nor counted (Problems, Today counts, Team control overdue), shown inside the ticket detail, closed with the ticket and reopened by its Undo. Tests: Task 2 (`buildInbox` hides copies), Task 3 (Today counts, control overdue), Task 5 (detail `mirror`), Task 7 (close and reopen move the copy).
2. **Double tap or retry on a bad network.** Same `idem` replayed returns the stored answer with one write; a key claimed but never finished answers 409 `Still processing. Retry.`; a write that fails releases its key; a double click on Close sends one request. Tests: Task 6 (replay, pending key, release), Task 8 (double click on Close problem).
3. **Postgres timestamps with an offset** (`2026-10-09T10:59:59+04:00`, `...+00:00`) compared as strings with `toISOString()` output (phase 1 bug in `mgr_problems.ts` and `mgr_control.ts`). Expected: overdue computed in time with `Date.parse`. Tests: Task 2 (`isOverdue`), Task 3 (Team control overdue with a `+04:00` value).
4. **Stale data on screen** (network down with a cached Today or Problems list, or a cache from another day). Expected: banner "Data from HH:MM", no write possible, "Reconnect to make changes." in the panel, no comment box. Tests: Task 8 (Today panel read-only), Task 9 (Problems cache read-only).
5. **Swipe misfires on a phone.** A vertical scroll, a short drag, or a drag starting at the screen edge (iOS / Android back gesture) must not close anything; a real left swipe closes with Undo and the click that follows the swipe must not open the detail; a right swipe only opens the Assign choice. Tests: Task 10.

## File Structure

Proxy (`supabase/functions/hostaway-proxy/`):
- Create `mgr_inbox.ts` / `mgr_inbox_test.ts`: pure rules of the inbox (refs, priorities, sources, due dates, today index, row builders, ranking, filters, search, counts, apartments, query parsing).
- Modify `mgr_today.ts` (+ test): `readAllRows` (explicit pagination), `listingMap`, `peopleMap`, paginated reads in `loadCore`, open ticket statuses from `mgr_inbox.ts`.
- Rewrite `mgr_problems.ts` / `mgr_problems_test.ts`: inbox reads, Today's problems block on the shared inbox, `mgr.problems` list.
- Modify `mgr_control.ts` (+ test): overdue team tasks with `isOverdue`, copies excluded, paginated read.
- Modify `mgr_rules.ts` (+ test, + `mgr_today_test.ts`): arrival cause says `(MNT-429)`.
- Create `mgr_problem_get.ts` / `mgr_problem_get_test.ts`: detail (signed photos, comments, history, copy, assignee options).
- Create `mgr_problem_act.ts` / `mgr_problem_act_test.ts`: assign, schedule, comment, close, reopen.
- Modify `v3_idem.ts`, `v3_idem_test.ts`, `v3_problems_test.ts`: event type `mgr_problem_act`.
- Modify `index.ts`: session author for `updateTicket` and `completePreventive`; routes `mgr.problems`, `mgr.problem.get`, `mgr.problem.act`.
- Create `supabase/migrations/20261010090000_mgr_problem_events.sql`.

Front (`manager/`):
- Modify `api.js` (`newIdem`), `ui/dom.js` (date helpers, sheet helpers, badge event), `today-cache.js` (keyed cache), `app.js` (Problems route, nav badge), `index.html` (stylesheet), `screens/today.js`, `screens/today-view.js`, `ui/components.css`.
- Create `problem-panel.js`, `screens/problem-view.js`, `screens/problems.js`, `screens/problems-view.js`, `ui/swipe.js`, `ui/problems.css`.

Root app: modify `app.js` (More link). Tests: `tests/manager/problem-fixtures.ts`, `today-problems.spec.ts`, `problems.spec.ts`, `problems-keys.spec.ts`; modify `helpers.ts`, `fixtures.ts`, `today.spec.ts`, `shell.spec.ts`; create `tests/manager-link.spec.ts`.

---

### Task 1: Idempotency event type for manager gestures, session author on ticket writes

**Files:**
- Create: `supabase/migrations/20261010090000_mgr_problem_events.sql`
- Modify: `supabase/functions/hostaway-proxy/v3_idem.ts` (`V3_EVENT_TYPES`, ~line 14)
- Modify: `supabase/functions/hostaway-proxy/v3_idem_test.ts` (~lines 43-48)
- Modify: `supabase/functions/hostaway-proxy/v3_problems_test.ts` (~lines 67-73)
- Modify: `supabase/functions/hostaway-proxy/index.ts` (`updateTicket` ~line 2582, `completePreventive` ~line 2722)

**Interfaces:**
- Consumes: `sessionActor(me, bodyActor)` from `actor.ts`, `currentUser(sb, req)` (already imported in `index.ts`).
- Produces: `"mgr_problem_act"` is a valid `V3EventType` for `claimEvent` (used by Task 6). The migration file is applied in Task 12.

- [ ] **Step 1: Write the failing tests**

In `v3_idem_test.ts`, replace:

```ts
  assertEquals(V3_EVENT_TYPES.length, 13);
  assertEquals([...V3_EVENT_TYPES], [
    "start_job", "tick", "upload_photo", "finish_job", "report_problem", "check_ticket",
    "delete_photo", "add_problem_photo", "set_problem_note", "upload_voice",
    "set_problem_voice", "update_problem", "delete_problem",
  ]);
});
```

with:

```ts
  assertEquals(V3_EVENT_TYPES.length, 14);
  assertEquals([...V3_EVENT_TYPES], [
    "start_job", "tick", "upload_photo", "finish_job", "report_problem", "check_ticket",
    "delete_photo", "add_problem_photo", "set_problem_note", "upload_voice",
    "set_problem_voice", "update_problem", "delete_problem", "mgr_problem_act",
  ]);
});

Deno.test("la migration 20261010090000 autorise exactement V3_EVENT_TYPES", async () => {
  const sql = await Deno.readTextFile(new URL("../../migrations/20261010090000_mgr_problem_events.sql", import.meta.url));
  const listed = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assertEquals(listed, [...V3_EVENT_TYPES].sort());
});
```

In `v3_problems_test.ts`, replace:

```ts
Deno.test("V3_EVENT_TYPES suit la contrainte CHECK de la migration 20261005120000", () => {
  assertEquals([...V3_EVENT_TYPES].sort(), [
    "add_problem_photo", "check_ticket", "delete_photo", "delete_problem", "finish_job",
    "report_problem", "set_problem_note", "set_problem_voice", "start_job", "tick",
    "update_problem", "upload_photo", "upload_voice",
  ]);
});
```

with:

```ts
Deno.test("V3_EVENT_TYPES suit la contrainte CHECK de la migration 20261010090000", () => {
  assertEquals([...V3_EVENT_TYPES].sort(), [
    "add_problem_photo", "check_ticket", "delete_photo", "delete_problem", "finish_job",
    "mgr_problem_act", "report_problem", "set_problem_note", "set_problem_voice", "start_job", "tick",
    "update_problem", "upload_photo", "upload_voice",
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none v3_idem_test.ts v3_problems_test.ts`
Expected: FAIL (length 13 vs 14, and `NotFound` reading the migration file).

- [ ] **Step 3: Write the migration and extend the list**

`supabase/migrations/20261010090000_mgr_problem_events.sql`:

```sql
-- App manager /manager/, phase 2 (Problems). Les gestes de tri (assign, schedule,
-- close, reopen, comment) passent par la meme garde d idempotence que v3 et
-- inspections : job_events.idem_key unique. Un seul type d evenement en plus.
-- Applique par le MCP Supabase (apply_migration) avant le deploiement du proxy.
ALTER TABLE public.job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check;
ALTER TABLE public.job_events ADD CONSTRAINT job_events_event_type_check CHECK (event_type IN (
  'start_job','tick','upload_photo','finish_job','report_problem','check_ticket',
  'delete_photo','add_problem_photo','set_problem_note','upload_voice',
  'set_problem_voice','update_problem','delete_problem','mgr_problem_act'));
```

In `v3_idem.ts`, replace:

```ts
  "set_problem_voice", "update_problem", "delete_problem",
] as const;
```

with:

```ts
  "set_problem_voice", "update_problem", "delete_problem",
  // App manager, phase 2 (mgr_problem_act.ts), migration 20261010090000.
  "mgr_problem_act",
] as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: same command as Step 2.
Expected: `ok`, 0 failed.

- [ ] **Step 5: Session author on `updateTicket` and `completePreventive` (deferred from phase 1)**

In `index.ts`, in `updateTicket`, replace:

```ts
      const { id, status: newStatus, assigned_vendor_id, assigned_technician_id, resolution_notes, resolution_photo, actual_cost, actor } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
```

with:

```ts
      const { id, status: newStatus, assigned_vendor_id, assigned_technician_id, resolution_notes, resolution_photo, actual_cost } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      // Auteur pris dans la session (spec manager, section 6), body.actor ignore
      // sauf pour les jobs serveur Hermes sans session.
      const actor = sessionActor(await currentUser(sb, req), body.actor);
```

In `completePreventive`, replace:

```ts
      const { id, actual_cost, notes, actor } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
```

with:

```ts
      const { id, actual_cost, notes } = body;
      if (!id) return jsonResp({ error: "id required" }, 400);
      const actor = sessionActor(await currentUser(sb, req), body.actor);
```

The rest of both handlers keeps using `actor` unchanged.

- [ ] **Step 6: Type-check and count**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts && grep -c "sessionActor" index.ts && grep -n "actual_cost, actor\|notes, actor" index.ts`
Expected: check silent, count `7` (import + 6 handlers), last grep prints nothing.

- [ ] **Step 7: Full proxy suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: 0 failed.

- [ ] **Step 8: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add supabase/migrations/20261010090000_mgr_problem_events.sql supabase/functions/hostaway-proxy/v3_idem.ts supabase/functions/hostaway-proxy/v3_idem_test.ts supabase/functions/hostaway-proxy/v3_problems_test.ts supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: type d evenement mgr_problem_act (migration), auteur de updateTicket et completePreventive pris dans la session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Inbox rules (`mgr_inbox.ts`) and one ref format in Today's arrival cause

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_inbox.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_inbox_test.ts`
- Modify: `supabase/functions/hostaway-proxy/mgr_rules.ts` (`arrivalStatus`, line `const tk = ...`)
- Modify: `supabase/functions/hostaway-proxy/mgr_rules_test.ts` (lines 91, 93, 95, 140)
- Modify: `supabase/functions/hostaway-proxy/mgr_today_test.ts` (line 95)

**Interfaces:**
- Consumes: `dubaiDay(iso)`, `INSP_VALID_STATUSES` (`insp_rules.ts`); `ddmm`, `dubaiMs`, `hhmm`, `MGR_DEFAULT_CHECKIN_HOUR`, `MgrReservation`, `Tone` (`mgr_rules.ts`); `plusDays` (`v3.ts`).
- Produces (used by Tasks 3 to 7):
  - constants `MGR_OPEN_TICKET_STATUSES = ["open","assigned","in_progress","waiting_parts","to_confirm"]`, `MGR_CLOSED_TICKET_STATUSES = ["resolved","closed","cancelled"]`, `MGR_OPEN_TASK_STATUSES = ["open","in_progress"]`, `MGR_CLOSED_TASK_STATUSES = ["done","cancelled"]`, `MGR_CLEANER_REPORT_SOURCE = "hk_planner_v3"`, `MGR_INSPECTION_SOURCE = "inspection"`, `MGR_MIRROR_PREFIX = "maint:"`, `MGR_TICKET_ASSIGNEE_ROLES = ["manager","maintenance","cleaner"]`, `MGR_TASK_ASSIGNEE_ROLES = ["manager","maintenance"]`, `MGR_PAGE_DEFAULT = 50`, `MGR_PAGE_MAX = 200`, `MGR_SCHEDULE_MAX_DAYS = 365`.
  - types `InboxKind`, `InboxSource`, `InboxPriority`, `InboxAssignee`, `InboxRow`, `RawTicket`, `RawTask`, `TodayIdx`, `InboxCtx`, `InboxQuery`, `InboxCounts`.
  - `problemRef(kind, id): string`, `parseRef(ref): {kind,id} | null`, `normPriority(p): InboxPriority`, `priorityLabel(p)`, `priorityTone(p)`, `ticketSource(source): InboxSource`, `isOverdue(iso, nowMs): boolean`, `dueIsoFor(day): string`, `mirrorTicketId(sourceRef): number | null`, `todayFromBoard(jobs, arrivals): TodayIdx`, `todayFromReservations(res, day): TodayIdx`, `ticketRow(t, ctx): InboxRow`, `taskRow(t, ctx): InboxRow`, `buildInbox(tickets, tasks, ctx): InboxRow[]` (ranked), `rankRows(rows)`, `filterRows(rows, q, meId)`, `inboxCounts(rows, meId): InboxCounts`, `apartmentsOf(rows)`, `parseInboxQuery(params: URLSearchParams): {ok:true,q} | {ok:false,error}`.

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_inbox_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  apartmentsOf, buildInbox, dueIsoFor, filterRows, inboxCounts, isOverdue, mirrorTicketId, normPriority,
  parseInboxQuery, parseRef, priorityTone, problemRef, rankRows, taskRow, ticketRow, todayFromBoard,
  todayFromReservations, type InboxCtx, type RawTask, type RawTicket,
} from "./mgr_inbox.ts";

const NOW = Date.parse("2026-10-09T07:00:00Z"); // 11:00 Dubai
const CTX: InboxCtx = {
  nowMs: NOW,
  listings: { L1: { apt: "308", bld: "Binghatti Lavender" }, L2: { apt: "103", bld: "Damac Reva" } },
  people: { "7": { name: "Semax" }, "8": { name: "Walter" }, "5": { name: "Ismaël" } },
  vendors: { "3": { name: "CoolFix" } },
  today: { arrivals: { L1: { owner: false, time: "15:00" } }, checkouts: { L2: { time: null } } },
};
const TK = (o: Partial<RawTicket>): RawTicket => ({
  id: 1, listing_id: null, title: "T", priority: "medium", status: "open", source: "manual",
  assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-10-01T08:00:00Z",
  sla_deadline: null, resolved_at: null, ...o,
});
const TS = (o: Partial<RawTask>): RawTask => ({
  id: 1, title: "Task", priority: "normal", status: "open", listing_id: null, assigned_cleaner_id: null,
  due_at: null, created_at: "2026-10-01T08:00:00Z", completed_at: null, source_ref: null, ...o,
});

Deno.test("references : un format, MNT-429 et TSK-13, saisie tolerante", () => {
  assertEquals(problemRef("MNT", 429), "MNT-429");
  assertEquals(parseRef("MNT-429"), { kind: "MNT", id: 429 });
  assertEquals(parseRef(" tsk-13 "), { kind: "TSK", id: 13 });
  for (const bad of ["MNT-0", "INS-4", "RPT-2", "MNT429", "MNT-", "", null, 42, "MNT-1e3"]) {
    assertEquals(parseRef(bad), null);
  }
});

Deno.test("priorites : medium (tickets) et normal (taches) sont le meme niveau, meme ton", () => {
  assertEquals(["urgent", "HIGH", "medium", "normal", "low", "", null, "weird"].map(normPriority),
    ["urgent", "high", "normal", "normal", "low", "normal", "normal", "normal"]);
  assertEquals((["urgent", "high", "normal", "low"] as const).map(priorityTone), ["bad", "warn", "idle", "idle"]);
});

Deno.test("echeance : Date.parse, quel que soit le format Postgres ; fin de journee Dubai", () => {
  assertEquals(isOverdue("2026-10-09T06:59:59+00:00", NOW), true);
  assertEquals(isOverdue("2026-10-09T10:59:59+04:00", NOW), true);
  assertEquals(isOverdue("2026-10-09T07:00:01Z", NOW), false);
  assertEquals(isOverdue("not a date", NOW), false);
  assertEquals(isOverdue(null, NOW), false);
  assertEquals(dueIsoFor("2026-10-12"), "2026-10-12T19:59:59.000Z");
});

Deno.test("ligne ticket : source, lieu, raison, technicien ou prestataire, statut a confirmer, clos", () => {
  const a = ticketRow(TK({ id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent", created_at: "2026-07-09T08:00:00Z" }), CTX);
  assertEquals(a, {
    ref: "MNT-429", kind: "MNT", id: 429, source: "Maintenance", priority: "urgent", label: "Urgent", tone: "bad",
    title: "Gas not working", status: "open", closed: false, listingId: "L1", apt: "308", bld: "Binghatti Lavender",
    assignee: null, createdAt: "2026-07-09T08:00:00Z", since: "09/07", dueAt: null, due: null, overdue: false, todayBoost: 0,
    why: "A guest arrives today at 15:00. Open since 09/07, no technician assigned.",
  });
  const b = ticketRow(TK({ id: 501, listing_id: "L2", source: "inspection", status: "to_confirm", assigned_vendor_id: 3, sla_deadline: "2026-10-08T19:59:59+00:00" }), CTX);
  assertEquals([b.source, b.assignee, b.due, b.overdue, b.todayBoost, b.why], [
    "Inspection", { kind: "vendor", id: 3, name: "CoolFix" }, "08/10", true, 1,
    "Checkout today, checkout time not set. Open since 01/10, sent to vendor CoolFix. Checked by a cleaner, to confirm and close.",
  ]);
  const c = ticketRow(TK({ id: 500, source: "hk_planner_v3", assigned_technician_id: 99, title: "  " }), CTX);
  assertEquals([c.source, c.title, c.assignee, c.apt, c.bld, c.todayBoost],
    ["Cleaner report", "Ticket", { kind: "member", id: 99, name: "Member 99" }, "", "", 2]);
  const d = ticketRow(TK({ id: 300, status: "resolved", resolved_at: "2026-10-08T09:00:00Z", sla_deadline: "2026-01-01T00:00:00Z" }), CTX);
  assertEquals([d.closed, d.overdue, d.why], [true, false, "Closed on 08/10."]);
});

Deno.test("ligne tache : assignee, retard, echeance, ouverte depuis, close", () => {
  const a = taskRow(TS({ id: 13, title: "AC not cooling", priority: "urgent", assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00+00:00" }), CTX);
  assertEquals([a.ref, a.source, a.tone, a.overdue, a.due, a.why],
    ["TSK-13", "Team task", "bad", true, "15/05", "Assigned to Semax, overdue since 15/05."]);
  const b = taskRow(TS({ id: 14, listing_id: "L1", due_at: "2026-12-01T08:00:00Z" }), CTX);
  assertEquals(b.why, "A guest arrives today at 15:00. Unassigned, due 01/12.");
  const c = taskRow(TS({ id: 15 }), CTX);
  assertEquals([c.why, c.tone, c.label], ["Unassigned, open since 01/10.", "idle", "Normal"]);
  const d = taskRow(TS({ id: 16, status: "done", completed_at: "2026-10-08T06:00:00Z" }), CTX);
  assertEquals([d.closed, d.why], [true, "Closed on 08/10."]);
});

Deno.test("boite : ouverts seulement, copies maint:<id> des tickets jamais en double", () => {
  assertEquals([mirrorTicketId("maint:429"), mirrorTicketId("review:3"), mirrorTicketId(null), mirrorTicketId("maint:x")],
    [429, null, null, null]);
  const rows = buildInbox(
    [TK({ id: 429, priority: "urgent" }), TK({ id: 430, status: "waiting_parts" }), TK({ id: 300, status: "resolved" }), TK({ id: 301, status: "cancelled" })],
    [TS({ id: 17, source_ref: "maint:429" }), TS({ id: 18, status: "in_progress" }), TS({ id: 19, status: "done" })],
    CTX,
  );
  assertEquals(rows.map((r) => r.ref), ["MNT-429", "MNT-430", "TSK-18"]);
});

Deno.test("tri stable : urgence, ce qui touche aujourd'hui, le plus ancien, MNT avant TSK, id", () => {
  const rows = [
    ticketRow(TK({ id: 2, priority: "high", created_at: "2026-06-01T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 3, priority: "high", listing_id: "L2", created_at: "2026-10-05T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 4, priority: "urgent", created_at: "2026-10-08T08:00:00Z" }), CTX),
    taskRow(TS({ id: 4, priority: "high", due_at: "2026-06-01T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 1, priority: "high", created_at: "2026-06-01T08:00:00Z" }), CTX),
    ticketRow(TK({ id: 5, priority: "low", created_at: "garbage" }), CTX),
    ticketRow(TK({ id: 6, priority: "low", created_at: "2026-01-01T08:00:00Z" }), CTX),
  ];
  const once = rankRows(rows).map((r) => r.ref);
  assertEquals(once, ["MNT-4", "MNT-3", "MNT-1", "MNT-2", "TSK-4", "MNT-6", "MNT-5"]);
  assertEquals(rankRows(rows.slice().reverse()).map((r) => r.ref), once);
});

const ROWS = rankRows([
  ticketRow(TK({ id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent" }), CTX),
  ticketRow(TK({ id: 501, listing_id: "L2", title: "Lamp broken", source: "inspection", assigned_technician_id: 8 }), CTX),
  ticketRow(TK({ id: 500, title: "Shower leaking", source: "hk_planner_v3", assigned_vendor_id: 3 }), CTX),
  taskRow(TS({ id: 13, title: "AC not cooling", priority: "urgent", assigned_cleaner_id: 5, listing_id: "L1", due_at: "2026-05-15T08:00:00Z" }), CTX),
  taskRow(TS({ id: 14, title: "Buy light bulbs" }), CTX),
]);
const Q = (o: Record<string, unknown> = {}) =>
  ({ urgent: false, mine: false, unassigned: false, listingId: null, source: null, q: "", offset: 0, limit: 50, ...o }) as any;

Deno.test("filtres Urgent, Mine, Unassigned, Apartment, Source, combinables", () => {
  const refs = (o: any, me = 8) => filterRows(ROWS, Q(o), me).map((r) => r.ref);
  assertEquals(ROWS.map((r) => r.ref), ["TSK-13", "MNT-429", "MNT-501", "MNT-500", "TSK-14"]);
  assertEquals(refs({ urgent: true }), ["TSK-13", "MNT-429"]);
  assertEquals(refs({ mine: true }), ["MNT-501"]);
  assertEquals(refs({ mine: true }, 5), ["TSK-13"]);
  assertEquals(refs({ unassigned: true }), ["MNT-429", "TSK-14"]);
  assertEquals(refs({ listingId: "L1" }), ["TSK-13", "MNT-429"]);
  assertEquals(refs({ source: "Cleaner report" }), ["MNT-500"]);
  assertEquals(refs({ urgent: true, unassigned: true }), ["MNT-429"]);
});

Deno.test("recherche : ref, titre, logement (apt 308), personne, sans accents ni casse", () => {
  const s = (q: string) => filterRows(ROWS, Q({ q }), 8).map((r) => r.ref);
  assertEquals(s("mnt-429"), ["MNT-429"]);
  assertEquals(s("apt 308"), ["TSK-13", "MNT-429"]);
  assertEquals(s("BINGHATTI gas"), ["MNT-429"]);
  assertEquals(s("ismael"), ["TSK-13"]);
  assertEquals(s("coolfix"), ["MNT-500"]);
  assertEquals(s("unassigned"), ["MNT-429", "TSK-14"]);
  assertEquals(s("zzz"), []);
});

Deno.test("compteurs sur toute la boite, logements tries par nombre", () => {
  assertEquals(inboxCounts(ROWS, 8), {
    open: 5, urgent: 2, mine: 1, unassigned: 2, overdue: 1,
    bySource: { Maintenance: 1, Inspection: 1, "Cleaner report": 1, "Team task": 2 },
  });
  assertEquals(apartmentsOf(ROWS), [
    { listingId: "L1", apt: "308", bld: "Binghatti Lavender", n: 2 },
    { listingId: "L2", apt: "103", bld: "Damac Reva", n: 1 },
  ]);
});

Deno.test("parametres de mgr.problems : defauts, bornes, source inconnue refusee", () => {
  const p = (s: string) => parseInboxQuery(new URLSearchParams(s));
  assertEquals(p(""), { ok: true, q: Q() });
  assertEquals(p("urgent=1&mine=1&unassigned=0&listingId=L1&source=task&q=%20gas%20&offset=50&limit=0"),
    { ok: true, q: Q({ urgent: true, mine: true, listingId: "L1", source: "Team task", q: "gas", offset: 50, limit: 0 }) });
  assertEquals(p("source=rpt"), { ok: false, error: "Unknown source." });
  assertEquals(p("offset=-1"), { ok: false, error: "Invalid offset." });
  assertEquals(p("limit=201"), { ok: false, error: "Invalid limit." });
  assertEquals(p("limit=abc"), { ok: false, error: "Invalid limit." });
});

Deno.test("aujourd'hui depuis Hostaway : arrivees (proprietaire compris), departs, inquiry ignoree", () => {
  const R = (o: any) => ({
    id: "1", listingId: "L1", guest: "G", arrival: "2026-10-01", departure: "2026-10-05", status: "confirmed",
    checkInTime: 16, checkOutTime: 11, ...o,
  });
  const t = todayFromReservations([
    R({ id: "1", listingId: "L1", arrival: "2026-10-09" }),
    R({ id: "2", listingId: "L2", departure: "2026-10-09", checkOutTime: null }),
    R({ id: "3", listingId: "L3", arrival: "2026-10-09", status: "ownerStay", checkInTime: null }),
    R({ id: "4", listingId: "L4", arrival: "2026-10-09", status: "inquiry" }),
  ], "2026-10-09");
  assertEquals(t, {
    arrivals: { L1: { owner: false, time: "16:00" }, L3: { owner: true, time: "15:00" } },
    checkouts: { L2: { time: null } },
  });
  assertEquals(todayFromBoard([
    { kind: "checkout", listingId: "L5", postponedFrom: "2026-10-07", checkout: null },
    { kind: "extra", listingId: "L6", postponedFrom: null, checkout: null },
  ], []), { arrivals: {}, checkouts: {} });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_inbox_test.ts`
Expected: FAIL, `Module not found ".../mgr_inbox.ts"`.

- [ ] **Step 3: Write the implementation**

`supabase/functions/hostaway-proxy/mgr_inbox.ts`:

```ts
// Boite Problems de l'app manager (spec 2026-10-09-hk-manager-app-design.md,
// sections 3, 4 et 6) : regles pures, aucune base, aucun reseau. Les lectures
// vivent dans mgr_problems.ts, la fiche dans mgr_problem_get.ts, les gestes dans
// mgr_problem_act.ts. Un seul format de reference : MNT-<id ticket>, TSK-<id tache>.
// Les constats d'inspection envoyes en maintenance et les signalements cleaner v3
// sont deja des tickets (source inspection / hk_planner_v3) : MNT avec un badge.
import { dubaiDay, INSP_VALID_STATUSES } from "./insp_rules.ts";
import { ddmm, dubaiMs, hhmm, MGR_DEFAULT_CHECKIN_HOUR, type MgrReservation, type Tone } from "./mgr_rules.ts";
import { plusDays } from "./v3.ts";

// Statuts ouverts d'un ticket : la liste « open » de l'ecran Maintenance actuel
// (getMaintenanceTickets). to_confirm = verifie par une cleaner, reste a clore.
export const MGR_OPEN_TICKET_STATUSES = ["open", "assigned", "in_progress", "waiting_parts", "to_confirm"];
export const MGR_CLOSED_TICKET_STATUSES = ["resolved", "closed", "cancelled"];
export const MGR_OPEN_TASK_STATUSES = ["open", "in_progress"];
export const MGR_CLOSED_TASK_STATUSES = ["done", "cancelled"];
export const MGR_CLEANER_REPORT_SOURCE = "hk_planner_v3";
export const MGR_INSPECTION_SOURCE = "inspection";
// dispatchMaintenance (Hermes) recopie chaque ticket non assigne en tache d'equipe
// avec source_ref « maint:<id> » : le ticket est le probleme, la copie n'est jamais listee.
export const MGR_MIRROR_PREFIX = "maint:";
export const MGR_TICKET_ASSIGNEE_ROLES = ["manager", "maintenance", "cleaner"];
export const MGR_TASK_ASSIGNEE_ROLES = ["manager", "maintenance"];
export const MGR_PAGE_DEFAULT = 50;
export const MGR_PAGE_MAX = 200;
export const MGR_SCHEDULE_MAX_DAYS = 365;

export type InboxKind = "MNT" | "TSK";
export type InboxSource = "Maintenance" | "Inspection" | "Cleaner report" | "Team task";
export type InboxPriority = "urgent" | "high" | "normal" | "low";
export type InboxAssignee = { kind: "member" | "vendor"; id: number; name: string };
export type InboxRow = {
  ref: string; kind: InboxKind; id: number; source: InboxSource;
  priority: InboxPriority; label: string; tone: Tone;
  title: string; status: string; closed: boolean;
  listingId: string | null; apt: string; bld: string;
  assignee: InboxAssignee | null;
  createdAt: string; since: string;
  dueAt: string | null; due: string | null; overdue: boolean;
  todayBoost: 0 | 1 | 2;   // 0 arrivee aujourd'hui, 1 depart aujourd'hui, 2 rien
  why: string;
};
export type RawTicket = {
  id: number | string; listing_id: string | null; title: string | null; priority: string | null; status: string | null;
  source: string | null; assigned_technician_id: number | null; assigned_vendor_id: number | null;
  created_at: string | null; sla_deadline: string | null; resolved_at?: string | null;
};
export type RawTask = {
  id: number | string; title: string | null; priority: string | null; status: string | null; listing_id: string | null;
  assigned_cleaner_id: number | null; due_at: string | null; created_at: string | null;
  completed_at?: string | null; source_ref: string | null;
};
export type TodayIdx = {
  arrivals: Record<string, { owner: boolean; time: string }>;
  checkouts: Record<string, { time: string | null }>;
};
export type InboxCtx = {
  nowMs: number;
  listings: Record<string, { apt: string; bld: string }>;
  people: Record<string, { name: string }>;
  vendors: Record<string, { name: string }>;
  today: TodayIdx;
};
export type InboxQuery = {
  urgent: boolean; mine: boolean; unassigned: boolean; listingId: string | null; source: InboxSource | null;
  q: string; offset: number; limit: number;
};
export type InboxCounts = {
  open: number; urgent: number; mine: number; unassigned: number; overdue: number;
  bySource: Record<InboxSource, number>;
};

const LABEL: Record<InboxPriority, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };
const TONE: Record<InboxPriority, Tone> = { urgent: "bad", high: "warn", normal: "idle", low: "idle" };
const RANK: Record<InboxPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_NOTE: Record<string, string> = {
  in_progress: " Work in progress.",
  waiting_parts: " Waiting for parts.",
  to_confirm: " Checked by a cleaner, to confirm and close.",
};
const SOURCE_PARAM: Record<string, InboxSource> = {
  maintenance: "Maintenance", inspection: "Inspection", cleaner: "Cleaner report", task: "Team task",
};

export function problemRef(kind: InboxKind, id: number): string {
  return kind + "-" + id;
}
export function parseRef(ref: unknown): { kind: InboxKind; id: number } | null {
  if (typeof ref !== "string") return null;
  const m = ref.trim().toUpperCase().match(/^(MNT|TSK)-(\d{1,9})$/);
  if (!m) return null;
  const id = Number(m[2]);
  return id > 0 ? { kind: m[1] as InboxKind, id } : null;
}
export function normPriority(p: unknown): InboxPriority {
  const s = String(p ?? "").trim().toLowerCase();
  return s === "urgent" || s === "high" || s === "low" ? s : "normal";
}
export function priorityLabel(p: InboxPriority): string { return LABEL[p]; }
export function priorityTone(p: InboxPriority): Tone { return TONE[p]; }
export function ticketSource(source: unknown): InboxSource {
  const s = String(source ?? "");
  return s === MGR_INSPECTION_SOURCE ? "Inspection" : s === MGR_CLEANER_REPORT_SOURCE ? "Cleaner report" : "Maintenance";
}
// Comparaison en temps, jamais en chaines : Postgres rend « +00:00 », toISOString « Z ».
export function isOverdue(iso: string | null | undefined, nowMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) && t < nowMs;
}
function dayOf(iso: unknown): string | null {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? dubaiDay(new Date(t).toISOString()) : null;
}
const dd = (iso: unknown): string | null => {
  const d = dayOf(iso);
  return d ? ddmm(d) : null;
};
// Echeance d'un jour choisi : 23:59:59 heure de Dubai.
export function dueIsoFor(day: string): string {
  return new Date(dubaiMs(plusDays(day, 1), 0) - 1000).toISOString();
}
export function mirrorTicketId(sourceRef: unknown): number | null {
  const m = String(sourceRef ?? "").match(/^maint:(\d+)$/);
  return m ? Number(m[1]) : null;
}

export function todayFromBoard(
  jobs: Array<{ kind: string; listingId: string; postponedFrom: string | null; checkout: string | null }>,
  arrivals: Array<{ listingId: string; kind: string; time: string }>,
): TodayIdx {
  const out: TodayIdx = { arrivals: {}, checkouts: {} };
  for (const a of arrivals) {
    const cur = out.arrivals[a.listingId];
    if (!cur || a.time < cur.time) out.arrivals[a.listingId] = { owner: a.kind === "Owner stay", time: a.time };
  }
  for (const j of jobs) {
    if (j.kind !== "checkout" || j.postponedFrom || out.checkouts[j.listingId]) continue;
    out.checkouts[j.listingId] = { time: j.checkout };
  }
  return out;
}
export function todayFromReservations(res: MgrReservation[], day: string): TodayIdx {
  const arrivals: Array<{ listingId: string; kind: string; time: string }> = [];
  const jobs: Array<{ kind: string; listingId: string; postponedFrom: string | null; checkout: string | null }> = [];
  for (const r of res) {
    if (!INSP_VALID_STATUSES.includes(r.status)) continue;
    if (r.arrival === day) {
      arrivals.push({ listingId: r.listingId, kind: r.status === "ownerStay" ? "Owner stay" : "Guest", time: hhmm(r.checkInTime ?? MGR_DEFAULT_CHECKIN_HOUR)! });
    }
    if (r.departure === day) jobs.push({ kind: "checkout", listingId: r.listingId, postponedFrom: null, checkout: hhmm(r.checkOutTime) });
  }
  return todayFromBoard(jobs, arrivals);
}

function todayNote(lid: string | null, t: TodayIdx): { boost: 0 | 1 | 2; text: string } {
  if (!lid) return { boost: 2, text: "" };
  const a = t.arrivals[lid];
  if (a) return { boost: 0, text: (a.owner ? "The owner arrives" : "A guest arrives") + " today at " + a.time + ". " };
  const c = t.checkouts[lid];
  if (c) return { boost: 1, text: (c.time ? "Checkout today at " + c.time : "Checkout today, checkout time not set") + ". " };
  return { boost: 2, text: "" };
}
function place(lid: string | null, c: InboxCtx): { apt: string; bld: string } {
  const l = lid ? c.listings[lid] : undefined;
  return { apt: l?.apt ?? "", bld: l?.bld ?? "" };
}
function memberOf(id: unknown, c: InboxCtx): InboxAssignee | null {
  if (id === null || id === undefined) return null;
  const n = Number(id);
  return { kind: "member", id: n, name: c.people[String(n)]?.name || "Member " + n };
}
function vendorOf(id: unknown, c: InboxCtx): InboxAssignee | null {
  if (id === null || id === undefined) return null;
  const n = Number(id);
  return { kind: "vendor", id: n, name: c.vendors[String(n)]?.name || "Vendor " + n };
}
const NO_TODAY = { boost: 2 as const, text: "" };

export function ticketRow(t: RawTicket, c: InboxCtx): InboxRow {
  const id = Number(t.id);
  const lid = t.listing_id ? String(t.listing_id) : null;
  const priority = normPriority(t.priority);
  const status = String(t.status ?? "open");
  const closed = MGR_CLOSED_TICKET_STATUSES.includes(status);
  const n = closed ? NO_TODAY : todayNote(lid, c.today);
  const assignee = memberOf(t.assigned_technician_id, c) ?? vendorOf(t.assigned_vendor_id, c);
  const createdAt = String(t.created_at ?? "");
  const dueAt = t.sla_deadline ? String(t.sla_deadline) : null;
  const who = assignee?.kind === "member" ? ", assigned to " + assignee.name + "."
    : assignee ? ", sent to vendor " + assignee.name + "." : ", no technician assigned.";
  const why = closed
    ? "Closed" + (dd(t.resolved_at) ? " on " + dd(t.resolved_at) : "") + "."
    : n.text + "Open since " + (dd(createdAt) ?? "?") + who + (STATUS_NOTE[status] ?? "");
  return {
    ref: problemRef("MNT", id), kind: "MNT", id, source: ticketSource(t.source),
    priority, label: LABEL[priority], tone: TONE[priority],
    title: String(t.title ?? "").trim() || "Ticket", status, closed,
    listingId: lid, ...place(lid, c), assignee,
    createdAt, since: dd(createdAt) ?? "", dueAt, due: dd(dueAt), overdue: !closed && isOverdue(dueAt, c.nowMs),
    todayBoost: n.boost, why,
  };
}

export function taskRow(t: RawTask, c: InboxCtx): InboxRow {
  const id = Number(t.id);
  const lid = t.listing_id ? String(t.listing_id) : null;
  const priority = normPriority(t.priority);
  const status = String(t.status ?? "open");
  const closed = MGR_CLOSED_TASK_STATUSES.includes(status);
  const n = closed ? NO_TODAY : todayNote(lid, c.today);
  const assignee = memberOf(t.assigned_cleaner_id, c);
  const createdAt = String(t.created_at ?? "");
  const dueAt = t.due_at ? String(t.due_at) : null;
  const overdue = !closed && isOverdue(dueAt, c.nowMs);
  const why = closed
    ? "Closed" + (dd(t.completed_at) ? " on " + dd(t.completed_at) : "") + "."
    : n.text + (assignee ? "Assigned to " + assignee.name : "Unassigned") +
      (overdue ? ", overdue since " + (dd(dueAt) ?? "?") : dueAt ? ", due " + (dd(dueAt) ?? "?") : ", open since " + (dd(createdAt) ?? "?")) + ".";
  return {
    ref: problemRef("TSK", id), kind: "TSK", id, source: "Team task",
    priority, label: LABEL[priority], tone: TONE[priority],
    title: String(t.title ?? "").trim() || "Task", status, closed,
    listingId: lid, ...place(lid, c), assignee,
    createdAt, since: dd(createdAt) ?? "", dueAt, due: dd(dueAt), overdue, todayBoost: n.boost, why,
  };
}

// Ordre total et stable : urgence, puis ce qui touche aujourd'hui (arrivee, puis
// depart), puis le plus ancien (taches : echeance, sinon creation ; tickets :
// creation), puis MNT avant TSK, puis id. Meme ordre pour Today et Problems.
export function rankRows(rows: InboxRow[]): InboxRow[] {
  const key = (r: InboxRow) => {
    const t = Date.parse(r.kind === "TSK" ? (r.dueAt ?? r.createdAt) : r.createdAt);
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  return rows.slice().sort((a, b) =>
    RANK[a.priority] - RANK[b.priority] || a.todayBoost - b.todayBoost || key(a) - key(b) ||
    (a.kind === b.kind ? 0 : a.kind === "MNT" ? -1 : 1) || a.id - b.id);
}

export function buildInbox(tickets: RawTicket[], tasks: RawTask[], c: InboxCtx): InboxRow[] {
  const rows: InboxRow[] = [];
  for (const t of tickets) if (MGR_OPEN_TICKET_STATUSES.includes(String(t.status ?? "open"))) rows.push(ticketRow(t, c));
  for (const t of tasks) {
    if (!MGR_OPEN_TASK_STATUSES.includes(String(t.status ?? "open"))) continue;
    if (mirrorTicketId(t.source_ref) !== null) continue;
    rows.push(taskRow(t, c));
  }
  return rankRows(rows);
}

const isMine = (r: InboxRow, meId: number) => r.assignee?.kind === "member" && r.assignee.id === meId;
const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function matches(r: InboxRow, q: string): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold([
    r.ref, r.title, r.apt ? "apt " + r.apt : "", r.bld, r.source, r.label,
    r.assignee ? r.assignee.name : "unassigned",
  ].join(" "));
  return words.every((w) => hay.includes(w));
}
export function filterRows(rows: InboxRow[], f: InboxQuery, meId: number): InboxRow[] {
  return rows.filter((r) =>
    (!f.urgent || r.priority === "urgent") && (!f.mine || isMine(r, meId)) && (!f.unassigned || !r.assignee) &&
    (!f.listingId || r.listingId === f.listingId) && (!f.source || r.source === f.source) && matches(r, f.q));
}
export function inboxCounts(rows: InboxRow[], meId: number): InboxCounts {
  const bySource: Record<InboxSource, number> = { Maintenance: 0, Inspection: 0, "Cleaner report": 0, "Team task": 0 };
  for (const r of rows) bySource[r.source]++;
  return {
    open: rows.length, urgent: rows.filter((r) => r.priority === "urgent").length,
    mine: rows.filter((r) => isMine(r, meId)).length, unassigned: rows.filter((r) => !r.assignee).length,
    overdue: rows.filter((r) => r.overdue).length, bySource,
  };
}
export function apartmentsOf(rows: InboxRow[]): Array<{ listingId: string; apt: string; bld: string; n: number }> {
  const m = new Map<string, { listingId: string; apt: string; bld: string; n: number }>();
  for (const r of rows) {
    if (!r.listingId) continue;
    const e = m.get(r.listingId) ?? { listingId: r.listingId, apt: r.apt, bld: r.bld, n: 0 };
    e.n++;
    m.set(r.listingId, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || (a.apt + " " + a.bld).localeCompare(b.apt + " " + b.bld));
}

export function parseInboxQuery(p: URLSearchParams): { ok: true; q: InboxQuery } | { ok: false; error: string } {
  const src = p.get("source") ?? "";
  if (src && !Object.prototype.hasOwnProperty.call(SOURCE_PARAM, src)) return { ok: false, error: "Unknown source." };
  const offset = p.has("offset") ? Number(p.get("offset")) : 0;
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, error: "Invalid offset." };
  const limit = p.has("limit") ? Number(p.get("limit")) : MGR_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 0 || limit > MGR_PAGE_MAX) return { ok: false, error: "Invalid limit." };
  return {
    ok: true,
    q: {
      urgent: p.get("urgent") === "1", mine: p.get("mine") === "1", unassigned: p.get("unassigned") === "1",
      listingId: p.get("listingId") || null, source: src ? SOURCE_PARAM[src] : null,
      q: (p.get("q") ?? "").trim().slice(0, 100), offset, limit,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 12 passed | 0 failed`.

- [ ] **Step 5: Arrival cause uses the same ref (`MNT-429`, phase 1 said `(#429)`)**

In `mgr_rules_test.ts` and `mgr_today_test.ts`, replace every `Gas not working (#429)` with `Gas not working (MNT-429)` (4 occurrences in `mgr_rules_test.ts`, 1 in `mgr_today_test.ts`). Run:

`cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_rules_test.ts mgr_today_test.ts`
Expected: FAIL on those 5 assertions.

Then in `mgr_rules.ts`, replace:

```ts
  const tk = u ? u.title + " (#" + u.id + ")" : "";
```

with:

```ts
  // Meme format que problemRef (mgr_inbox.ts) : une seule reference partout.
  const tk = u ? u.title + " (MNT-" + u.id + ")" : "";
```

Run the same command. Expected: 0 failed.

- [ ] **Step 6: Full proxy suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: 0 failed.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add supabase/functions/hostaway-proxy/mgr_inbox.ts supabase/functions/hostaway-proxy/mgr_inbox_test.ts supabase/functions/hostaway-proxy/mgr_rules.ts supabase/functions/hostaway-proxy/mgr_rules_test.ts supabase/functions/hostaway-proxy/mgr_today_test.ts
git commit -m "proxy: regles de la boite Problems (references MNT/TSK, priorites, echeances en temps, tri, filtres, recherche), cause d arrivee en MNT-429

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Inbox reads, Today's problems block on the shared inbox, explicit pagination

**Files:**
- Modify: `supabase/functions/hostaway-proxy/mgr_today.ts` (imports, `MGR_OPEN_TICKET_STATUSES` line 12, `readOrThrow` neighbourhood, `loadCore` reads and maps)
- Modify: `supabase/functions/hostaway-proxy/mgr_today_test.ts` (append two tests)
- Rewrite: `supabase/functions/hostaway-proxy/mgr_problems.ts`
- Rewrite: `supabase/functions/hostaway-proxy/mgr_problems_test.ts`
- Modify: `supabase/functions/hostaway-proxy/mgr_control.ts` (imports, open tasks read, overdue loop)
- Modify: `supabase/functions/hostaway-proxy/mgr_control_test.ts` (append one test)

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:
  - `mgr_today.ts`: `readAllRows(build: (from: number, to: number) => any, what: string, page = MGR_READ_PAGE): Promise<any[]>` (throws `"[mgr] <what>: <message>"` on error, and above `MGR_READ_MAX = 20000` rows), `listingMap(rows): Record<string,{apt,bld}>`, `peopleMap(rows): Record<string, MgrPerson>`; `MGR_OPEN_TICKET_STATUSES` re-exported from `mgr_inbox.ts`.
  - `mgr_problems.ts`: `MGR_TICKET_COLS`, `MGR_TASK_COLS`, `type RawVendor`, `type InboxRaw`, `loadInboxRaw(sb): Promise<InboxRaw>`, `vendorNames(vs)`, `type MgrProblemCounts = { urgent, ticketsOpen, ticketsUrgent, ticketsNoTech, teamTasksOpen, teamTasksOverdue, inspectionTicketsOpen, cleanerReportsOpen }`, `type MgrProblems = { counts: MgrProblemCounts; top: InboxRow[] }`, `todayCounts(rows)`, `loadProblems(sb, core, jobs, arrivals): Promise<MgrProblems>` (same signature as phase 1, `mgr_api.ts` unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `mgr_today_test.ts` (and add `readAllRows` to its import from `./mgr_today.ts`):

```ts
Deno.test("lectures paginees : au-dela de 1000 lignes rien n'est perdu", async () => {
  const many = Array.from({ length: 1205 }, (_, i) => ({ listing_id: "X" + i, internal_name: (i + 1) + " - Tower" }));
  const sb = fakeDb({ listing_config: many }, { maxRows: 1000 });
  const c = await loadCore(sb, { day: DAY, nowMs: AT_11, riskHours: 6, reservations: [] });
  assertEquals(Object.keys(c.listings).length, 1205);
  assertEquals(c.listings["X1204"], { apt: "1205", bld: "Tower" });
});

Deno.test("readAllRows : pages explicites, erreur levee avec le nom de la table", async () => {
  const sb = fakeDb({ t: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] }, { maxRows: 2 });
  const rows = await readAllRows((a, b) => sb.from("t").select("id").order("id").range(a, b), "t", 2);
  assertEquals(rows.map((r) => r.id), [1, 2, 3, 4, 5]);
  sb.fail["t.select"] = { message: "boom" };
  let msg = "";
  try { await readAllRows((a, b) => sb.from("t").select("id").range(a, b), "t", 2); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "[mgr] t: boom");
});
```

Replace the whole content of `mgr_problems_test.ts` with:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadProblems } from "./mgr_problems.ts";
import type { MgrCore } from "./mgr_today.ts";

export const DAY = "2026-10-09";
export const NOW = Date.parse("2026-10-09T07:00:00Z");
export const core: MgrCore = {
  day: DAY, nowMs: NOW, riskHours: 6, reservations: [],
  listings: { L1: { apt: "103", bld: "Damac Reva" }, L2: { apt: "2609", bld: "Nobles by Tiger" }, L3: { apt: "1607", bld: "Central Park JVC" } },
  people: {
    "7": { id: 7, name: "Semax", role: "manager", active: true },
    "8": { id: 8, name: "Walter", role: "manager", active: true },
  },
  tickets: [], eliteListings: new Set(), postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras: [],
};
const arrivals = [{ listingId: "L1", kind: "Guest", time: "15:00" }] as any[];
const jobs = [{ listingId: "L2", kind: "checkout", postponedFrom: null, checkout: "12:00" }] as any[];
const TK = (id: number, listing_id: string | null, title: string, priority: string, created_at: string, o: any = {}) => ({
  id, listing_id, title, priority, status: "open", source: "whatsapp", assigned_technician_id: null, assigned_vendor_id: null,
  created_at, sla_deadline: null, resolved_at: null, ...o,
});
export const db = () => fakeDb({
  maintenance_tickets: [
    TK(429, "L1", "Gas not working", "urgent", "2026-07-09T08:00:00Z"),
    TK(411, "L2", "Bathroom drainage clogged", "urgent", "2026-06-14T08:00:00Z"),
    TK(440, "L3", "Cockroaches reported by guest", "high", "2026-07-15T08:00:00Z", { assigned_vendor_id: 3, status: "assigned" }),
    TK(106, "L3", "Balcony drain blocked", "low", "2026-04-27T08:00:00Z", { assigned_technician_id: 7, status: "assigned" }),
    TK(500, null, "Shower leaking", "medium", "2026-09-01T08:00:00Z", { source: "hk_planner_v3" }),
    TK(501, "L2", "Bedroom: lamp broken", "medium", "2026-10-07T08:00:00Z", { source: "inspection" }),
    TK(502, "L1", "Door handle loose", "high", "2026-10-01T08:00:00Z", { status: "to_confirm" }),
    TK(300, "L1", "Old fixed thing", "urgent", "2026-05-01T08:00:00Z", { status: "resolved" }),
  ],
  team_tasks: [
    { id: 13, title: "AC not cooling", priority: "urgent", status: "open", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00+00:00", created_at: "2026-05-14T08:00:00Z", source_ref: null },
    { id: 14, title: "Buy light bulbs", priority: "normal", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: null, created_at: "2026-10-01T08:00:00Z", source_ref: null },
    { id: 15, title: "Check smoke detector", priority: "low", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: "2026-12-01T08:00:00Z", created_at: "2026-10-01T08:00:00Z", source_ref: null },
    { id: 16, title: "Closed one", priority: "urgent", status: "done", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-01T08:00:00Z", created_at: "2026-05-01T08:00:00Z", source_ref: null },
    { id: 17, title: "🔧 Gas not working", priority: "urgent", status: "open", listing_id: "L1", assigned_cleaner_id: 7, due_at: "2026-07-12T08:00:00Z", created_at: "2026-07-09T09:00:00Z", source_ref: "maint:429" },
    { id: 18, title: "Call owner", priority: "high", status: "in_progress", listing_id: null, assigned_cleaner_id: 8, due_at: null, created_at: "2026-10-05T08:00:00Z", source_ref: null },
  ],
  vendors: [{ id: 3, name: "CoolFix", specialty: "AC", is_active: true }, { id: 2, name: "Old Co", specialty: "", is_active: false }],
  listing_config: [
    { listing_id: "L1", internal_name: "103 - Damac Reva" }, { listing_id: "L2", internal_name: "2609 - Nobles by Tiger" },
    { listing_id: "L3", internal_name: "1607 - Central Park JVC" },
  ],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 4, name: "Faiza", role: "cleaner", is_active: true }, { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 11, name: "Medini CEO Agent", role: "system", is_active: true }, { id: 9, name: "Old Tech", role: "maintenance", is_active: false },
  ],
});

Deno.test("Today, top 5 : urgence, ce qui touche aujourd'hui, le plus ancien ; copie maint:429 jamais listee", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.top.map((x) => x.ref), ["MNT-429", "MNT-411", "TSK-13", "MNT-502", "MNT-440"]);
  assertEquals(p.top[0], {
    ref: "MNT-429", kind: "MNT", id: 429, source: "Maintenance", priority: "urgent", label: "Urgent", tone: "bad",
    title: "Gas not working", status: "open", closed: false, listingId: "L1", apt: "103", bld: "Damac Reva",
    assignee: null, createdAt: "2026-07-09T08:00:00Z", since: "09/07", dueAt: null, due: null, overdue: false, todayBoost: 0,
    why: "A guest arrives today at 15:00. Open since 09/07, no technician assigned.",
  });
  assertEquals(p.top[1].why, "Checkout today at 12:00. Open since 14/06, no technician assigned.");
  assertEquals([p.top[2].source, p.top[2].why, p.top[2].tone], ["Team task", "Assigned to Semax, overdue since 15/05.", "bad"]);
  assertEquals(p.top[3].why, "A guest arrives today at 15:00. Open since 01/10, no technician assigned. Checked by a cleaner, to confirm and close.");
  assertEquals([p.top[4].tone, p.top[4].why], ["warn", "Open since 15/07, sent to vendor CoolFix."]);
});

Deno.test("Today, compteurs : copies exclues, sources inspection et cleaner, retards en temps", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.counts, {
    urgent: 3, ticketsOpen: 7, ticketsUrgent: 2, ticketsNoTech: 5, teamTasksOpen: 4, teamTasksOverdue: 1,
    inspectionTicketsOpen: 1, cleanerReportsOpen: 1,
  });
});

Deno.test("lecture team_tasks en erreur : leve", async () => {
  const sb = db();
  sb.fail["team_tasks.select"] = { message: "boom" };
  let msg = "";
  try { await loadProblems(sb, core, jobs, arrivals); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "[mgr] team_tasks: boom");
});
```

Append to `mgr_control_test.ts`:

```ts
Deno.test("taches en retard : copies maint:<id> exclues, in_progress comprises, horodatage +04:00 compare en temps", async () => {
  const sb = db();
  sb.tables.team_tasks.push(
    { id: 30, status: "open", assigned_cleaner_id: 7, due_at: "2026-05-01T08:00:00Z", source_ref: "maint:429" },
    { id: 31, status: "in_progress", assigned_cleaner_id: 6, due_at: "2026-10-09T10:59:59+04:00" },
  );
  const c = await loadControl(sb, core("2026-10-09T07:00:00Z"));
  assertEquals(c.overdue, { total: 4, rows: [{ name: "Semax", n: 2 }, { name: "Hillal", n: 1 }, { name: "Unassigned", n: 1 }] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_today_test.ts mgr_problems_test.ts mgr_control_test.ts`
Expected: FAIL (`readAllRows` not exported; 1000 listings instead of 1205; old `MgrProblem` shape and counts; control total 3).

- [ ] **Step 3: `mgr_today.ts`: pagination helpers and paginated reads**

At the top of `mgr_today.ts`, add after the existing imports:

```ts
import { MGR_OPEN_TICKET_STATUSES } from "./mgr_inbox.ts";
```

Replace:

```ts
export const MGR_OPEN_TICKET_STATUSES = ["open", "assigned", "in_progress"];
```

with:

```ts
// Liste unique (mgr_inbox.ts) : Today, Problems et l'ecran Maintenance actuel disent la meme chose.
export { MGR_OPEN_TICKET_STATUSES };
```

After the `readOrThrow` function, add:

```ts
export const MGR_READ_PAGE = 1000;
export const MGR_READ_MAX = 20000;
// PostgREST plafonne une lecture a 1000 lignes sans le dire : on pagine
// explicitement (ordre stable obligatoire dans build), et au-dela de MGR_READ_MAX
// on leve plutot que de calculer sur une table tronquee.
export async function readAllRows(
  build: (from: number, to: number) => any, what: string, page = MGR_READ_PAGE,
): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += page) {
    const rows = readOrThrow(await build(from, from + page - 1), what);
    out.push(...rows);
    if (rows.length < page) return out;
    if (out.length >= MGR_READ_MAX) throw new Error("[mgr] " + what + ": more than " + MGR_READ_MAX + " rows");
  }
}

export function listingMap(rows: any[]): Record<string, { apt: string; bld: string }> {
  return Object.fromEntries(rows.map((l: any) => [String(l.listing_id), splitListing(l)]));
}
export function peopleMap(rows: any[]): Record<string, MgrPerson> {
  return Object.fromEntries(rows.map((p: any) => [String(p.id), {
    id: Number(p.id), name: String(p.name ?? ""), role: String(p.role ?? ""), active: p.is_active !== false,
  }]));
}
```

In `loadCore`, replace:

```ts
    all(sb.from("listing_config").select("listing_id, internal_name, listing_name, apt_number"), "listing_config"),
    all(sb.from("cleaners").select("id, name, role, is_active"), "cleaners"),
    all(sb.from("maintenance_tickets")
      .select("id, listing_id, title, priority, status, assigned_technician_id, assigned_vendor_id, created_at, source")
      .in("status", MGR_OPEN_TICKET_STATUSES), "maintenance_tickets"),
```

with:

```ts
    readAllRows((a: number, b: number) => sb.from("listing_config")
      .select("listing_id, internal_name, listing_name, apt_number").order("listing_id").range(a, b), "listing_config"),
    readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, is_active").order("id").range(a, b), "cleaners"),
    readAllRows((a: number, b: number) => sb.from("maintenance_tickets")
      .select("id, listing_id, title, priority, status, assigned_technician_id, assigned_vendor_id, created_at, source")
      .in("status", MGR_OPEN_TICKET_STATUSES).order("id").range(a, b), "maintenance_tickets"),
```

and replace:

```ts
    listings: Object.fromEntries(listings.map((l: any) => [String(l.listing_id), splitListing(l)])),
    people: Object.fromEntries(people.map((p: any) => [String(p.id), {
      id: Number(p.id), name: String(p.name ?? ""), role: String(p.role ?? ""), active: p.is_active !== false,
    }])),
```

with:

```ts
    listings: listingMap(listings),
    people: peopleMap(people),
```

- [ ] **Step 4: Rewrite `mgr_problems.ts`**

Replace the whole file with:

```ts
// Boite Problems : lecture des tables (tickets et taches d'equipe ouverts,
// prestataires) et bloc « Open problems » de Today. Les regles (references,
// priorites, tri, filtres) vivent dans mgr_inbox.ts ; la meme boite sert Today
// (5 premiers) et l'ecran Problems (mgr.problems, ajoute par la tache 4).
import {
  buildInbox, MGR_OPEN_TASK_STATUSES, MGR_OPEN_TICKET_STATUSES, todayFromBoard,
  type InboxRow, type RawTask, type RawTicket,
} from "./mgr_inbox.ts";
import { readAllRows, type MgrArrival, type MgrCore, type MgrJob } from "./mgr_today.ts";

export const MGR_TICKET_COLS =
  "id, listing_id, title, priority, status, source, assigned_technician_id, assigned_vendor_id, created_at, sla_deadline, resolved_at";
export const MGR_TASK_COLS =
  "id, title, priority, status, listing_id, assigned_cleaner_id, due_at, created_at, completed_at, source_ref";

export type RawVendor = { id: number; name: string | null; specialty: string | null; is_active: boolean | null };
export type InboxRaw = { tickets: RawTicket[]; tasks: RawTask[]; vendors: RawVendor[] };

export async function loadInboxRaw(sb: any): Promise<InboxRaw> {
  const [tickets, tasks, vendors] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("maintenance_tickets").select(MGR_TICKET_COLS)
      .in("status", MGR_OPEN_TICKET_STATUSES).order("id").range(a, b), "maintenance_tickets"),
    readAllRows((a: number, b: number) => sb.from("team_tasks").select(MGR_TASK_COLS)
      .in("status", MGR_OPEN_TASK_STATUSES).order("id").range(a, b), "team_tasks"),
    readAllRows((a: number, b: number) => sb.from("vendors").select("id, name, specialty, is_active").order("id").range(a, b), "vendors"),
  ]);
  return { tickets, tasks, vendors };
}

export function vendorNames(vs: RawVendor[]): Record<string, { name: string }> {
  return Object.fromEntries(vs.map((v) => [String(v.id), { name: String(v.name ?? "").trim() || "Vendor " + v.id }]));
}

export type MgrProblemCounts = {
  urgent: number; ticketsOpen: number; ticketsUrgent: number; ticketsNoTech: number;
  teamTasksOpen: number; teamTasksOverdue: number; inspectionTicketsOpen: number; cleanerReportsOpen: number;
};
export type MgrProblems = { counts: MgrProblemCounts; top: InboxRow[] };

export function todayCounts(rows: InboxRow[]): MgrProblemCounts {
  const mnt = rows.filter((r) => r.kind === "MNT");
  const tsk = rows.filter((r) => r.kind === "TSK");
  return {
    urgent: rows.filter((r) => r.priority === "urgent").length,
    ticketsOpen: mnt.length,
    ticketsUrgent: mnt.filter((r) => r.priority === "urgent").length,
    ticketsNoTech: mnt.filter((r) => !r.assignee).length,
    teamTasksOpen: tsk.length,
    teamTasksOverdue: tsk.filter((r) => r.overdue).length,
    inspectionTicketsOpen: mnt.filter((r) => r.source === "Inspection").length,
    cleanerReportsOpen: mnt.filter((r) => r.source === "Cleaner report").length,
  };
}

export async function loadProblems(sb: any, c: MgrCore, jobs: MgrJob[], arrivals: MgrArrival[]): Promise<MgrProblems> {
  const raw = await loadInboxRaw(sb);
  const rows = buildInbox(raw.tickets, raw.tasks, {
    nowMs: c.nowMs, listings: c.listings, people: c.people, vendors: vendorNames(raw.vendors),
    today: todayFromBoard(jobs, arrivals),
  });
  return { counts: todayCounts(rows), top: rows.slice(0, 5) };
}
```

- [ ] **Step 5: `mgr_control.ts`: overdue in time, copies excluded, paginated read**

Add to the imports of `mgr_control.ts`:

```ts
import { isOverdue, MGR_OPEN_TASK_STATUSES, mirrorTicketId } from "./mgr_inbox.ts";
```

and change the `mgr_today.ts` import line to:

```ts
import { byKeys, readAllRows, readOrThrow, type MgrCore } from "./mgr_today.ts";
```

Replace:

```ts
    q(sb.from("team_tasks").select("id, assigned_cleaner_id, due_at").eq("status", "open"), "team_tasks"),
```

with:

```ts
    readAllRows((a: number, b: number) => sb.from("team_tasks").select("id, assigned_cleaner_id, due_at, source_ref")
      .in("status", MGR_OPEN_TASK_STATUSES).order("id").range(a, b), "team_tasks"),
```

Replace:

```ts
  const nowIso = iso(c.nowMs);
  const od = new Map<string, number>();
  for (const t of openTasks) {
    if (!t.due_at || String(t.due_at) >= nowIso) continue;
```

with:

```ts
  // Copies Hermes des tickets (maint:<id>) exclues : meme regle que la boite Problems.
  const od = new Map<string, number>();
  for (const t of openTasks) {
    if (mirrorTicketId(t.source_ref) !== null || !isOverdue(t.due_at, c.nowMs)) continue;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: same command as Step 2, then the full suite:
`cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts`
Expected: 0 failed, check silent.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add supabase/functions/hostaway-proxy/mgr_today.ts supabase/functions/hostaway-proxy/mgr_today_test.ts supabase/functions/hostaway-proxy/mgr_problems.ts supabase/functions/hostaway-proxy/mgr_problems_test.ts supabase/functions/hostaway-proxy/mgr_control.ts supabase/functions/hostaway-proxy/mgr_control_test.ts
git commit -m "proxy: bloc Problems de Today sur la boite commune (copies maint exclues, sources, statuts ouverts unifies), lectures paginees, retards en temps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Proxy action `mgr.problems` (list, filters, pages)

**Files:**
- Modify: `supabase/functions/hostaway-proxy/mgr_problems.ts` (append)
- Modify: `supabase/functions/hostaway-proxy/mgr_problems_test.ts` (append)
- Modify: `supabase/functions/hostaway-proxy/index.ts` (imports, `ROUTES`, route block after `mgr.today`)

**Interfaces:**
- Consumes: Task 2 (`filterRows`, `inboxCounts`, `apartmentsOf`, `todayFromReservations`, `parseInboxQuery`, `MGR_TICKET_ASSIGNEE_ROLES`, `MGR_TASK_ASSIGNEE_ROLES`, types), Task 3 (`loadInboxRaw`, `vendorNames`, `readAllRows`, `listingMap`, `peopleMap`, `MgrPerson`), `loadMgrReservations(sb, day)` in `index.ts`, `mgrAccess`.
- Produces:
  - `type AssigneeOption = { id: number; name: string; role: string; takesTasks: boolean }`, `type VendorOption = { id: number; name: string; specialty: string }`, `assigneeOptions(people)`, `vendorOptions(vs)`, `loadRefs(sb): Promise<{ listings; people }>` (used by Task 5).
  - `mgrProblems(sb, o: { day; nowMs; me: SessionUser; query: InboxQuery; loadReservations }): Promise<{ status: 200; body: MgrProblemsList }>`.
  - Response `MgrProblemsList` (consumed by the front, Task 9): `{ day, generatedAt, bookingsCachedAt, bookingsUnavailable, me: {id,name}, counts: InboxCounts, apartments: [{listingId,apt,bld,n}], total, offset, limit, rows: InboxRow[], assignees: AssigneeOption[], vendors: VendorOption[] }`.
  - Route `GET ?action=mgr.problems&urgent=1&mine=1&unassigned=1&listingId=..&source=maintenance|inspection|cleaner|task&q=..&offset=0&limit=50`.

- [ ] **Step 1: Write the failing test**

Append to `mgr_problems_test.ts` (and add `mgrProblems` to its import from `./mgr_problems.ts`):

```ts
const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "#000" };
const RESV = [
  { id: "r1", listingId: "L1", guest: "G", arrival: DAY, departure: "2026-10-12", status: "confirmed", checkInTime: 15, checkOutTime: 11 },
  { id: "r2", listingId: "L2", guest: "H", arrival: "2026-10-05", departure: DAY, status: "confirmed", checkInTime: 15, checkOutTime: 12 },
];
const Q = (o: Record<string, unknown> = {}) =>
  ({ urgent: false, mine: false, unassigned: false, listingId: null, source: null, q: "", offset: 0, limit: 50, ...o }) as any;
const list = (sb: any, o: Record<string, unknown> = {}, load: any = async () => ({ reservations: RESV, cachedAt: null })) =>
  mgrProblems(sb, { day: DAY, nowMs: NOW, me: ME, query: Q(o), loadReservations: load });

Deno.test("mgr.problems : meme tri que Today, compteurs globaux, logements, options d'affectation", async () => {
  const r = await list(db());
  assertEquals(r.status, 200);
  const b: any = r.body;
  assertEquals(Object.keys(b).sort(), [
    "apartments", "assignees", "bookingsCachedAt", "bookingsUnavailable", "counts", "day", "generatedAt", "limit", "me",
    "offset", "rows", "total", "vendors",
  ]);
  assertEquals(b.rows.map((x: any) => x.ref), [
    "MNT-429", "MNT-411", "TSK-13", "MNT-502", "MNT-440", "TSK-18", "MNT-501", "MNT-500", "TSK-14", "MNT-106", "TSK-15",
  ]);
  assertEquals([b.total, b.offset, b.limit, b.bookingsUnavailable, b.bookingsCachedAt, b.me], [11, 0, 50, false, null, { id: 8, name: "Walter" }]);
  assertEquals(b.counts, {
    open: 11, urgent: 3, mine: 1, unassigned: 7, overdue: 1,
    bySource: { Maintenance: 5, Inspection: 1, "Cleaner report": 1, "Team task": 4 },
  });
  assertEquals(b.apartments, [
    { listingId: "L1", apt: "103", bld: "Damac Reva", n: 2 },
    { listingId: "L3", apt: "1607", bld: "Central Park JVC", n: 2 },
    { listingId: "L2", apt: "2609", bld: "Nobles by Tiger", n: 2 },
  ]);
  assertEquals(b.assignees, [
    { id: 7, name: "Semax", role: "manager", takesTasks: true },
    { id: 8, name: "Walter", role: "manager", takesTasks: true },
    { id: 4, name: "Faiza", role: "cleaner", takesTasks: false },
  ]);
  assertEquals(b.vendors, [{ id: 3, name: "CoolFix", specialty: "AC" }]);
});

Deno.test("mgr.problems : filtres et pages ; total apres filtre, compteurs avant filtre", async () => {
  const b: any = (await list(db(), { urgent: true, offset: 1, limit: 1 })).body;
  assertEquals([b.total, b.rows.map((x: any) => x.ref), b.counts.open], [3, ["MNT-411"], 11]);
  const m: any = (await list(db(), { mine: true })).body;
  assertEquals(m.rows.map((x: any) => x.ref), ["TSK-18"]);
  const z: any = (await list(db(), { limit: 0 })).body;
  assertEquals([z.rows, z.total, z.counts.urgent], [[], 11, 3]);
});

Deno.test("mgr.problems : Hostaway indisponible, liste servie sans le coup de pouce du jour", async () => {
  const b: any = (await list(db(), {}, async () => { throw new Error("down"); })).body;
  assertEquals(b.bookingsUnavailable, true);
  assertEquals(b.rows.slice(0, 3).map((x: any) => x.ref), ["TSK-13", "MNT-411", "MNT-429"]);
});
```

Seed check: unassigned = MNT-429, 411, 500, 501, 502, TSK-14, TSK-15 (7); Maintenance (source `whatsapp`) = MNT-429, 411, 440, 106, 502 (5); mine (Walter, 8) = TSK-18.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_problems_test.ts`
Expected: FAIL, `mgrProblems` is not exported.

- [ ] **Step 3: Write the implementation**

In `mgr_problems.ts`, replace the two `import` statements at the top of the file (from `./mgr_inbox.ts` and `./mgr_today.ts`) with:

```ts
import type { SessionUser } from "./auth.ts";
import type { MgrReservation } from "./mgr_rules.ts";
import {
  apartmentsOf, buildInbox, filterRows, inboxCounts, MGR_OPEN_TASK_STATUSES, MGR_OPEN_TICKET_STATUSES,
  MGR_TASK_ASSIGNEE_ROLES, MGR_TICKET_ASSIGNEE_ROLES, todayFromBoard, todayFromReservations,
  type InboxCounts, type InboxQuery, type InboxRow, type RawTask, type RawTicket, type TodayIdx,
} from "./mgr_inbox.ts";
import {
  listingMap, peopleMap, readAllRows, type MgrArrival, type MgrCore, type MgrJob, type MgrPerson,
} from "./mgr_today.ts";
```

and append:

```ts
export type AssigneeOption = { id: number; name: string; role: string; takesTasks: boolean };
export type VendorOption = { id: number; name: string; specialty: string };
const ROLE_ORDER: Record<string, number> = { manager: 0, maintenance: 1, cleaner: 2 };

export function assigneeOptions(people: Record<string, MgrPerson>): AssigneeOption[] {
  return Object.values(people)
    .filter((p) => p.active && MGR_TICKET_ASSIGNEE_ROLES.includes(p.role))
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, role: p.role, takesTasks: MGR_TASK_ASSIGNEE_ROLES.includes(p.role) }));
}
export function vendorOptions(vs: RawVendor[]): VendorOption[] {
  return vs.filter((v) => v.is_active !== false)
    .map((v) => ({ id: Number(v.id), name: String(v.name ?? "").trim() || "Vendor " + v.id, specialty: String(v.specialty ?? "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
export async function loadRefs(sb: any): Promise<{ listings: Record<string, { apt: string; bld: string }>; people: Record<string, MgrPerson> }> {
  const [l, p] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("listing_config")
      .select("listing_id, internal_name, listing_name, apt_number").order("listing_id").range(a, b), "listing_config"),
    readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, is_active").order("id").range(a, b), "cleaners"),
  ]);
  return { listings: listingMap(l), people: peopleMap(p) };
}

export type MgrProblemsList = {
  day: string; generatedAt: string; bookingsCachedAt: string | null; bookingsUnavailable: boolean;
  me: { id: number; name: string };
  counts: InboxCounts; apartments: Array<{ listingId: string; apt: string; bld: string; n: number }>;
  total: number; offset: number; limit: number; rows: InboxRow[];
  assignees: AssigneeOption[]; vendors: VendorOption[];
};

// Action mgr.problems. Hostaway (cache mgr:res:<jour>) ne sert qu'a remonter ce
// qui touche une arrivee ou un depart du jour : s'il manque, la liste est servie
// quand meme, triee sans ce coup de pouce, et le front le signale.
export async function mgrProblems(sb: any, o: {
  day: string; nowMs: number; me: SessionUser; query: InboxQuery;
  loadReservations: (day: string) => Promise<{ reservations: MgrReservation[]; cachedAt: string | null }>;
}): Promise<{ status: 200; body: MgrProblemsList }> {
  const [booked, raw, refs] = await Promise.all([
    o.loadReservations(o.day).then((r) => ({ ok: true as const, r }), () => ({ ok: false as const, r: null })),
    loadInboxRaw(sb),
    loadRefs(sb),
  ]);
  const today: TodayIdx = booked.ok ? todayFromReservations(booked.r.reservations, o.day) : { arrivals: {}, checkouts: {} };
  const all = buildInbox(raw.tickets, raw.tasks, {
    nowMs: o.nowMs, listings: refs.listings, people: refs.people, vendors: vendorNames(raw.vendors), today,
  });
  const rows = filterRows(all, o.query, o.me.cleaner_id);
  return {
    status: 200,
    body: {
      day: o.day, generatedAt: new Date(o.nowMs).toISOString(),
      bookingsCachedAt: booked.ok ? booked.r.cachedAt : null, bookingsUnavailable: !booked.ok,
      me: { id: o.me.cleaner_id, name: o.me.name },
      counts: inboxCounts(all, o.me.cleaner_id), apartments: apartmentsOf(all),
      total: rows.length, offset: o.query.offset, limit: o.query.limit,
      rows: rows.slice(o.query.offset, o.query.offset + o.query.limit),
      assignees: assigneeOptions(refs.people), vendors: vendorOptions(raw.vendors),
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok`, 0 failed.

- [ ] **Step 5: Route in `index.ts`**

Imports: add

```ts
import { parseInboxQuery } from "./mgr_inbox.ts";
```

and change `import { mgrToday } from "./mgr_api.ts";` to keep it and add below:

```ts
import { mgrProblems } from "./mgr_problems.ts";
```

In `ROUTES`, replace `["mgr.today", "GET"],` with:

```ts
  ["mgr.today", "GET"], ["mgr.problems", "GET"], ["mgr.problem.get", "GET"], ["mgr.problem.act", "POST"],
```

(`mgr.problem.get` and `mgr.problem.act` are registered now and answered by Tasks 5 and 6; until then they fall through to `Unknown action` 400, never deployed in between.)

Right after the `mgr.today` block (after its closing `}`), add:

```ts
    // Boite Problems : liste filtree et paginee. Memes regles d'acces que Today.
    if (action === "mgr.problems") {
      const me = await currentUser(sb, req);
      const acc = mgrAccess(bearerToken(req) !== null, me);
      if (!acc.ok) return jsonResp({ error: acc.error }, acc.status);
      const pq = parseInboxQuery(url.searchParams);
      if (!pq.ok) return jsonResp({ error: pq.error }, 400);
      const r = await mgrProblems(sb, {
        day: todayDubai(), nowMs: Date.now(), me: me!, query: pq.q,
        loadReservations: (d) => loadMgrReservations(sb, d),
      });
      return jsonResp(r.body, r.status);
    }
```

- [ ] **Step 6: Type-check and full suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: check silent, 0 failed.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add supabase/functions/hostaway-proxy/mgr_problems.ts supabase/functions/hostaway-proxy/mgr_problems_test.ts supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: action mgr.problems (liste triee, filtres Urgent/Mine/Unassigned/logement/source, recherche, pages, options d affectation)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Proxy action `mgr.problem.get` (detail)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_problem_get.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_problem_get_test.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (import, route block after `mgr.problems`)

**Interfaces:**
- Consumes: Task 2 (`parseRef`, `problemRef`, `ticketRow`, `taskRow`, `MGR_OPEN_TASK_STATUSES`, `InboxCtx`), Task 3 (`readAllRows`), Task 4 (`loadRefs`, `assigneeOptions`, `vendorOptions`, `vendorNames`), `V3_PHOTO_BUCKET` (`"cleaning-photos"`, same bucket as the old app's `PHOTO_BUCKET`), `ddmm` (`mgr_rules.ts`).
- Produces:
  - `mgrProblemGet(sb, o: { ref: string; nowMs: number }): Promise<ActionResult>`; 400 `Unknown problem reference.`, 404 `<REF> not found.`.
  - Response `ProblemDetail` (consumed by the front, Task 8): `{ problem: InboxRow, description: string, category: string|null, reportedBy: string|null, photos: [{url,label}], photosError: string|null, comments: [{author,text,at,photo}], history: [{at,text}], mirror: {ref,status,assignee}|null, assignees: AssigneeOption[], vendors: VendorOption[] }`.
  - `signPaths(sb, paths): Promise<Record<string,string> | null>`, `logText(row): string`.
  - Route `GET ?action=mgr.problem.get&ref=MNT-429`.

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_problem_get_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrProblemGet } from "./mgr_problem_get.ts";

const NOW = Date.parse("2026-10-09T07:00:00Z");
const sb = () => fakeDb({
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "Gas not working", description: "Stove does not light.", category: "gas", priority: "urgent",
      status: "open", source: "whatsapp", source_ref: null, reported_by: "Faiza", assigned_technician_id: null, assigned_vendor_id: null,
      created_at: "2026-07-09T08:00:00Z", sla_deadline: null, photo_path: "v3/p1.jpg", resolution_photo_path: null },
    { id: 501, listing_id: "L1", title: "Bedroom: lamp", description: "Lamp broken", category: "general", priority: "medium",
      status: "open", source: "inspection", source_ref: "inspection:6:bedrooms", reported_by: "Hillal",
      created_at: "2026-10-07T08:00:00Z", photo_path: "inspections/6/bedrooms/a.jpg" },
    { id: 300, listing_id: "L1", title: "Old fixed thing", priority: "urgent", status: "resolved", source: "manual", reported_by: null,
      created_at: "2026-05-01T08:00:00Z", resolved_at: "2026-10-08T09:00:00Z", resolution_notes: "Fixed" },
  ],
  listing_config: [{ listing_id: "L1", internal_name: "308 - Binghatti Lavender" }],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 4, name: "Faiza", role: "cleaner", is_active: true }, { id: 11, name: "Medini CEO Agent", role: "system", is_active: true },
  ],
  vendors: [{ id: 3, name: "CoolFix", specialty: "AC", is_active: true }, { id: 2, name: "Old Co", specialty: "", is_active: false }],
  ticket_comments: [
    { id: 2, ticket_id: 429, author: "Walter", comment: "Called the gas company.", created_at: "2026-10-08T06:00:00Z", photo_path: "c/2.jpg" },
    { id: 1, ticket_id: 429, author: null, comment: "Seen by guest", created_at: "2026-07-09T09:00:00Z", photo_path: null },
    { id: 3, ticket_id: 999, author: "X", comment: "other", created_at: "2026-07-09T09:00:00Z", photo_path: null },
  ],
  cleaning_log: [
    { id: 1, reservation_key: "ticket_429", action: "problem_assigned", actor: "Walter", details: { to: "Semax", kind: "member" }, created_at: "2026-10-08T05:00:00Z" },
    { id: 2, reservation_key: "ticket_429", action: "problem_assigned", actor: "Walter", details: { to: null, kind: null }, created_at: "2026-10-08T05:30:00Z" },
    { id: 3, reservation_key: "ticket_430", action: "problem_closed", actor: "X", details: {}, created_at: "2026-10-08T05:30:00Z" },
  ],
  photos: [
    { id: 1, storage_path: "v3/p1.jpg", ticket_id: 429, kind: "photo" },
    { id: 2, storage_path: "v3/p2.jpg", ticket_id: 429, kind: "photo" },
    { id: 3, storage_path: "v3/voice.m4a", ticket_id: 429, kind: "voice" },
  ],
  inspection_photos: [
    { id: 1, inspection_id: 6, zone: "bedrooms", kind: "issue", storage_path: "inspections/6/bedrooms/a.jpg" },
    { id: 2, inspection_id: 6, zone: "bedrooms", kind: "issue", storage_path: "inspections/6/bedrooms/b.jpg" },
    { id: 3, inspection_id: 6, zone: "kitchen", kind: "issue", storage_path: "inspections/6/kitchen/c.jpg" },
  ],
  team_tasks: [
    { id: 17, title: "Gas not working", status: "open", assigned_cleaner_id: 7, source_ref: "maint:429", priority: "urgent", created_at: "2026-07-10T08:00:00Z" },
    { id: 13, title: "AC not cooling", description: "Check the AC", category: "maintenance", priority: "urgent", status: "open",
      listing_id: null, assigned_cleaner_id: 7, created_by_cleaner_id: 11, due_at: "2026-05-15T08:00:00Z",
      created_at: "2026-05-14T08:00:00Z", source_ref: null },
  ],
  team_task_comments: [{ id: 1, task_id: 13, cleaner_id: 8, body: "On it", created_at: "2026-05-16T08:00:00Z" }],
});

Deno.test("fiche MNT : photos signees en un lot sans doublon ni vocal, commentaires dans l'ordre, historique, copie TSK", async () => {
  const db = sb();
  const r = await mgrProblemGet(db, { ref: "mnt-429", nowMs: NOW });
  assertEquals(r.status, 200);
  const d: any = r.body;
  assertEquals([d.problem.ref, d.problem.apt, d.description, d.category, d.reportedBy],
    ["MNT-429", "308", "Stove does not light.", "gas", "Faiza"]);
  assertEquals(d.photos, [
    { url: "https://signed.test/v3/p1.jpg?exp=3600", label: "Reported" },
    { url: "https://signed.test/v3/p2.jpg?exp=3600", label: "Cleaner photo" },
  ]);
  assertEquals(db.storage.signBatches.length, 1);
  assertEquals(db.storage.signBatches[0].bucket, "cleaning-photos");
  assertEquals(d.comments, [
    { author: "Unknown", text: "Seen by guest", at: "2026-07-09T09:00:00Z", photo: null },
    { author: "Walter", text: "Called the gas company.", at: "2026-10-08T06:00:00Z", photo: "https://signed.test/c/2.jpg?exp=3600" },
  ]);
  assertEquals(d.history, [
    { at: "2026-07-09T08:00:00Z", text: "Reported by Faiza" },
    { at: "2026-10-08T05:00:00Z", text: "Assigned to Semax by Walter" },
    { at: "2026-10-08T05:30:00Z", text: "Unassigned by Walter" },
  ]);
  assertEquals(d.mirror, { ref: "TSK-17", status: "open", assignee: "Semax" });
  assertEquals(d.assignees.map((a: any) => a.name), ["Semax", "Walter", "Faiza"]);
  assertEquals(d.vendors, [{ id: 3, name: "CoolFix", specialty: "AC" }]);
  assertEquals(d.photosError, null);
});

Deno.test("fiche MNT d'inspection : photos de la zone, sans doublon avec la photo du ticket", async () => {
  const d: any = (await mgrProblemGet(sb(), { ref: "MNT-501", nowMs: NOW })).body;
  assertEquals(d.problem.source, "Inspection");
  assertEquals(d.photos.map((p: any) => p.label + " " + p.url), [
    "Reported https://signed.test/inspections/6/bedrooms/a.jpg?exp=3600",
    "Inspection https://signed.test/inspections/6/bedrooms/b.jpg?exp=3600",
  ]);
  assertEquals(d.mirror, null);
});

Deno.test("fiche d'un ticket clos ailleurs : closed, Closed dans l'historique faute de journal", async () => {
  const d: any = (await mgrProblemGet(sb(), { ref: "MNT-300", nowMs: NOW })).body;
  assertEquals([d.problem.closed, d.problem.why], [true, "Closed on 08/10."]);
  assertEquals(d.history, [{ at: "2026-05-01T08:00:00Z", text: "Reported" }, { at: "2026-10-08T09:00:00Z", text: "Closed" }]);
});

Deno.test("fiche TSK : commentaires au nom du membre, cree par, pas de prestataires", async () => {
  const d: any = (await mgrProblemGet(sb(), { ref: "TSK-13", nowMs: NOW })).body;
  assertEquals([d.problem.ref, d.problem.overdue, d.description, d.category, d.reportedBy],
    ["TSK-13", true, "Check the AC", "maintenance", "Medini CEO Agent"]);
  assertEquals(d.comments, [{ author: "Walter", text: "On it", at: "2026-05-16T08:00:00Z", photo: null }]);
  assertEquals(d.history, [{ at: "2026-05-14T08:00:00Z", text: "Created by Medini CEO Agent" }]);
  assertEquals([d.vendors, d.mirror, d.photos], [[], null, []]);
});

Deno.test("fiche : reference inconnue 400, absente 404, photos non signees signalees", async () => {
  assertEquals(await mgrProblemGet(sb(), { ref: "INS-4", nowMs: NOW }), { status: 400, body: { error: "Unknown problem reference." } });
  assertEquals(await mgrProblemGet(sb(), { ref: "MNT-9999", nowMs: NOW }), { status: 404, body: { error: "MNT-9999 not found." } });
  const db = sb();
  db.fail["storage.sign"] = { message: "down" };
  const d: any = (await mgrProblemGet(db, { ref: "MNT-429", nowMs: NOW })).body;
  assertEquals([d.photos, d.photosError, d.comments[1].photo], [[], "Photos could not be loaded.", null]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_problem_get_test.ts`
Expected: FAIL, `Module not found ".../mgr_problem_get.ts"`.

- [ ] **Step 3: Write the implementation**

`supabase/functions/hostaway-proxy/mgr_problem_get.ts`:

```ts
// Fiche d'un probleme de la boite (spec 2026-10-09, section 4) : photos signees,
// commentaires, historique, copie Hermes, personnes et prestataires a qui
// l'affecter. Aucun appel Hostaway : la fiche ne depend que de la base.
import { V3_PHOTO_BUCKET, type ActionResult } from "./v3.ts";
import { ddmm } from "./mgr_rules.ts";
import { MGR_OPEN_TASK_STATUSES, parseRef, problemRef, taskRow, ticketRow, type InboxCtx } from "./mgr_inbox.ts";
import { assigneeOptions, loadRefs, vendorNames, vendorOptions } from "./mgr_problems.ts";
import { readAllRows } from "./mgr_today.ts";

export const MGR_SIGN_SECONDS = 3600;

// Un seul lot de signature par fiche. Rend null si la signature echoue (la fiche
// s'affiche quand meme, sans photos, avec un message).
export async function signPaths(sb: any, paths: string[]): Promise<Record<string, string> | null> {
  const uniq = [...new Set(paths.filter((p) => p && !/^(https?:|data:)/i.test(p)))];
  if (!uniq.length) return {};
  const { data, error } = await sb.storage.from(V3_PHOTO_BUCKET).createSignedUrls(uniq, MGR_SIGN_SECONDS);
  if (error || !Array.isArray(data)) return null;
  const out: Record<string, string> = {};
  for (const d of data) if (d && d.signedUrl && !d.error) out[String(d.path)] = String(d.signedUrl);
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function logText(l: { action?: unknown; actor?: unknown; details?: any }): string {
  const by = l.actor ? " by " + String(l.actor) : "";
  const d = l.details && typeof l.details === "object" ? l.details : {};
  switch (String(l.action ?? "")) {
    case "ticket_created": return "Ticket created" + by;
    case "ticket_updated": return "Updated" + (d.status ? " to " + String(d.status).replace(/_/g, " ") : "") + by;
    case "ticket_checked": return "Checked during a cleaning" + by;
    case "problem_assigned": return (d.to ? "Assigned to " + String(d.to) : "Unassigned") + by;
    case "problem_scheduled": return (d.date ? "Due date set to " + ddmm(String(d.date)) : "Due date removed") + by;
    case "problem_closed": return "Closed" + by + (d.note ? ": " + String(d.note) : "");
    case "problem_reopened": return "Reopened" + by;
    default: return cap(String(l.action ?? "update").replace(/_/g, " ")) + by;
  }
}

type Item = { at: string; text: string };
function byTime(xs: Item[]): Item[] {
  return xs.map((x, i) => ({ x, i, t: Date.parse(x.at) }))
    .sort((a, b) => (Number.isFinite(a.t) ? a.t : Infinity) - (Number.isFinite(b.t) ? b.t : Infinity) || a.i - b.i)
    .map((e) => e.x);
}
const byId = (xs: any[]) => xs.slice().sort((a, b) => Number(a.id) - Number(b.id));
const byCreated = (xs: any[]) => xs.slice().sort((a, b) =>
  (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || Number(a.id) - Number(b.id));

async function ticketDetail(sb: any, t: any, ctx: InboxCtx, logs: any[], nameOf: (id: unknown) => string | null) {
  const id = Number(t.id);
  const m = String(t.source_ref ?? "").match(/^inspection:(\d+):(.+)$/);
  const [comments, shots, insp, mirrors] = await Promise.all([
    readAllRows((a: number, b: number) => sb.from("ticket_comments").select("id, author, comment, created_at, photo_path")
      .eq("ticket_id", id).order("id").range(a, b), "ticket_comments"),
    readAllRows((a: number, b: number) => sb.from("photos").select("id, storage_path, kind")
      .eq("ticket_id", id).order("id").range(a, b), "photos"),
    m ? readAllRows((a: number, b: number) => sb.from("inspection_photos").select("id, kind, storage_path")
      .eq("inspection_id", Number(m[1])).eq("zone", m[2]).order("id").range(a, b), "inspection_photos") : Promise.resolve([]),
    readAllRows((a: number, b: number) => sb.from("team_tasks").select("id, status, assigned_cleaner_id")
      .eq("source_ref", "maint:" + id).order("id").range(a, b), "team_tasks"),
  ]);
  const want: Array<{ path: string; label: string }> = [];
  const seen = new Set<string>();
  const add = (path: unknown, label: string) => {
    const s = String(path ?? "").trim();
    if (!s || seen.has(s) || /^data:/i.test(s)) return;
    seen.add(s);
    want.push({ path: s, label });
  };
  add(t.photo_path, "Reported");
  for (const s of byId(shots)) if (s.kind !== "voice") add(s.storage_path, "Cleaner photo");
  for (const s of byId(insp)) add(s.storage_path, s.kind === "after" ? "After the fix" : "Inspection");
  add(t.resolution_photo_path, "After the fix");
  const cs = byCreated(comments);
  const signed = await signPaths(sb, [...want.map((w) => w.path), ...cs.map((c: any) => String(c.photo_path ?? ""))]);
  const urlOf = (p: unknown): string | null => {
    const s = String(p ?? "").trim();
    if (!s) return null;
    if (/^https?:/i.test(s)) return s;
    return signed ? signed[s] ?? null : null;
  };
  const problem = ticketRow(t, ctx);
  const history: Item[] = [];
  if (!logs.some((l) => l.action === "ticket_created")) {
    history.push({ at: String(t.created_at ?? ""), text: "Reported" + (t.reported_by ? " by " + t.reported_by : "") });
  }
  for (const l of logs) history.push({ at: String(l.created_at ?? ""), text: logText(l) });
  const closedAt = t.resolved_at ?? t.closed_at;
  if (problem.closed && closedAt && !logs.some((l) => l.action === "problem_closed")) history.push({ at: String(closedAt), text: "Closed" });
  const mir = mirrors.find((x: any) => MGR_OPEN_TASK_STATUSES.includes(String(x.status))) ?? mirrors[0] ?? null;
  return {
    problem, description: String(t.description ?? "").trim(), category: t.category ?? null, reportedBy: t.reported_by ?? null,
    photos: want.map((w) => ({ url: urlOf(w.path), label: w.label })).filter((x) => x.url) as Array<{ url: string; label: string }>,
    photosError: signed === null ? "Photos could not be loaded." : null,
    comments: cs.map((c: any) => ({
      author: String(c.author ?? "").trim() || "Unknown", text: String(c.comment ?? ""), at: String(c.created_at ?? ""), photo: urlOf(c.photo_path),
    })),
    history: byTime(history),
    mirror: mir ? { ref: problemRef("TSK", Number(mir.id)), status: String(mir.status ?? ""), assignee: nameOf(mir.assigned_cleaner_id) } : null,
  };
}

async function taskDetail(sb: any, t: any, ctx: InboxCtx, logs: any[], nameOf: (id: unknown) => string | null) {
  const id = Number(t.id);
  const comments = await readAllRows((a: number, b: number) => sb.from("team_task_comments")
    .select("id, cleaner_id, body, created_at").eq("task_id", id).order("id").range(a, b), "team_task_comments");
  const problem = taskRow(t, ctx);
  const creator = nameOf(t.created_by_cleaner_id);
  const history: Item[] = [{ at: String(t.created_at ?? ""), text: "Created" + (creator ? " by " + creator : "") }];
  for (const l of logs) history.push({ at: String(l.created_at ?? ""), text: logText(l) });
  if (problem.closed && t.completed_at && !logs.some((l) => l.action === "problem_closed")) {
    const who = nameOf(t.completed_by_cleaner_id);
    history.push({ at: String(t.completed_at), text: "Closed" + (who ? " by " + who : "") });
  }
  return {
    problem, description: String(t.description ?? "").trim(), category: t.category ?? null, reportedBy: creator,
    photos: [], photosError: null,
    comments: byCreated(comments).map((c: any) => ({
      author: nameOf(c.cleaner_id) ?? "Unknown", text: String(c.body ?? ""), at: String(c.created_at ?? ""), photo: null,
    })),
    history: byTime(history), mirror: null,
  };
}

export async function mgrProblemGet(sb: any, o: { ref: string; nowMs: number }): Promise<ActionResult> {
  const p = parseRef(o.ref);
  if (!p) return { status: 400, body: { error: "Unknown problem reference." } };
  const ref = problemRef(p.kind, p.id);
  const { data: row, error } = await sb.from(p.kind === "MNT" ? "maintenance_tickets" : "team_tasks")
    .select("*").eq("id", p.id).maybeSingle();
  if (error) throw error;
  if (!row) return { status: 404, body: { error: ref + " not found." } };
  const key = (p.kind === "MNT" ? "ticket_" : "task_") + p.id;
  const [refs, vendors, logs] = await Promise.all([
    loadRefs(sb),
    readAllRows((a: number, b: number) => sb.from("vendors").select("id, name, specialty, is_active").order("id").range(a, b), "vendors"),
    readAllRows((a: number, b: number) => sb.from("cleaning_log").select("id, action, actor, details, created_at")
      .eq("reservation_key", key).order("id").range(a, b), "cleaning_log"),
  ]);
  const ctx: InboxCtx = {
    nowMs: o.nowMs, listings: refs.listings, people: refs.people, vendors: vendorNames(vendors),
    today: { arrivals: {}, checkouts: {} },
  };
  const nameOf = (id: unknown): string | null =>
    id === null || id === undefined ? null : refs.people[String(id)]?.name || "Member " + id;
  const detail = p.kind === "MNT"
    ? await ticketDetail(sb, row, ctx, byId(logs), nameOf)
    : await taskDetail(sb, row, ctx, byId(logs), nameOf);
  return {
    status: 200,
    body: { ...detail, assignees: assigneeOptions(refs.people), vendors: p.kind === "MNT" ? vendorOptions(vendors) : [] },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Route in `index.ts`**

Add the import:

```ts
import { mgrProblemGet } from "./mgr_problem_get.ts";
```

After the `mgr.problems` block, add:

```ts
    if (action === "mgr.problem.get") {
      const me = await currentUser(sb, req);
      const acc = mgrAccess(bearerToken(req) !== null, me);
      if (!acc.ok) return jsonResp({ error: acc.error }, acc.status);
      const r = await mgrProblemGet(sb, { ref: url.searchParams.get("ref") ?? "", nowMs: Date.now() });
      return jsonResp(r.body, r.status);
    }
```

- [ ] **Step 6: Type-check and full suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: check silent, 0 failed.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add supabase/functions/hostaway-proxy/mgr_problem_get.ts supabase/functions/hostaway-proxy/mgr_problem_get_test.ts supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: action mgr.problem.get (photos signees en un lot, commentaires, historique, copie Hermes, personnes et prestataires)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Proxy action `mgr.problem.act`: assign, schedule, comment

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_problem_act.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_problem_act_test.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (import, route block after `mgr.problem.get`)

**Interfaces:**
- Consumes: Task 1 (`"mgr_problem_act"` event type), Task 2 (`parseRef`, `problemRef`, `dueIsoFor`, status and role constants), Task 3 (`readAllRows`), `claimEvent`, `replayResponse`, `recordResult`, `releaseEvent`, `v3Log`, `validIdem`, `todayDubai`, `plusDays` (`v3.ts`), `sansEchec` (`v3_photos.ts`), `setFixSchedule(sb, me, {inspectionId, zone, date, slot}, now)` (`insp_write.ts`), `notifyAssignee` and `keepAlive` (`index.ts`).
- Produces:
  - `mgrProblemAct(sb, me: SessionUser, body, deps?: { nowMs?: number; notifyTask?: (task) => void }): Promise<ActionResult>`.
  - Request body (front, Task 8): `{ ref, verb, idem }` plus `memberId` | `vendorId` | `unassign: true` (assign), `date: "YYYY-MM-DD" | null` (schedule), `text` (comment), `note` (close, Task 7).
  - Success body `{ status: "success", ref, verb, ... }` with `assignee` (assign), `dueAt` (schedule), `comment: {author,text,at}` (comment), `closed: true` (close), `state` (reopen).
  - Errors (400): `Unknown problem reference.`, `Unknown action.`, `idem required`, `Choose a person or a vendor.`, `Choose a person or a vendor, not both.`, `Invalid person.`, `Invalid vendor.`, `This person cannot take tickets.`, `This person cannot take team tasks.`, `Team tasks go to a team member, not a vendor.`, `This vendor is not active.`, `Invalid date.`, `The date cannot be in the past.`, `The date is too far ahead.`, `Write a comment first.`; 404 `<REF> not found.`; 409 `<REF> is closed. Reopen it first.`, `Still processing. Retry.`.
  - Logs in `cleaning_log`, key `ticket_<id>` or `task_<id>`, actions `problem_assigned {to, kind}`, `problem_scheduled {date}` (read by `logText`, Task 5).
  - Exported helpers `parseAct(body, today)` and `stateRefusal(verb, closed, ref)` (extended by Task 7).

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_problem_act_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrProblemAct } from "./mgr_problem_act.ts";

export const NOW = Date.parse("2026-10-09T07:00:00Z"); // 11:00 Dubai
export const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "#000" };
export const seed = () => fakeDb({
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent", status: "open", source: "whatsapp",
      assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-07-09T08:00:00Z", sla_deadline: null, resolution_notes: null },
    { id: 430, listing_id: "L1", title: "Leak", priority: "high", status: "in_progress", source: "whatsapp",
      assigned_technician_id: 7, assigned_vendor_id: null, created_at: "2026-08-01T08:00:00Z", resolution_notes: null },
    { id: 501, listing_id: "L1", title: "Bedroom: lamp", priority: "medium", status: "open", source: "inspection",
      source_ref: "inspection:6:bedrooms", description: "Lamp broken", assigned_technician_id: null, assigned_vendor_id: null },
    { id: 300, listing_id: "L1", title: "Old", priority: "urgent", status: "resolved", source: "manual",
      assigned_technician_id: null, assigned_vendor_id: null, resolved_at: "2026-10-01T08:00:00Z", resolution_notes: "Fixed" },
  ],
  team_tasks: [
    { id: 13, title: "AC", status: "open", assigned_cleaner_id: 7, due_at: null, source_ref: null },
    { id: 17, title: "Gas not working", status: "open", assigned_cleaner_id: 7, source_ref: "maint:429" },
    { id: 19, title: "Done one", status: "done", completed_at: "2026-10-01T08:00:00Z", completed_by_cleaner_id: 8, source_ref: null },
  ],
  cleaners: [
    { id: 7, name: "Semax", role: "manager", is_active: true }, { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 4, name: "Faiza", role: "cleaner", is_active: true }, { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 9, name: "Gone", role: "maintenance", is_active: false },
  ],
  vendors: [{ id: 3, name: "CoolFix", is_active: true }, { id: 2, name: "Old Co", is_active: false }],
  inspections: [{ id: 6, listing_id: "L1", inspector_id: 5, inspection_date: "2026-10-07", finished_at: "2026-10-07T09:00:00Z" }],
  inspection_items: [{ id: 1, inspection_id: 6, zone: "bedrooms", status: "not_ok", outcome: "maintenance", ticket_id: 501,
    fix_scheduled_for: null, fix_scheduled_slot: null }],
  job_events: [], cleaning_log: [], ticket_comments: [], team_task_comments: [],
});
let n = 0;
export const act = (sb: any, body: any, deps: any = {}) =>
  mgrProblemAct(sb, ME, { idem: "idem-test-" + (++n), ...body }, { nowMs: NOW, ...deps });
const ticket = (sb: any, id: number) => sb.tables.maintenance_tickets.find((x: any) => x.id === id);
const task = (sb: any, id: number) => sb.tables.team_tasks.find((x: any) => x.id === id);

Deno.test("assign MNT : membre de l'equipe, statut assigned, journal et cle au nom de la session", async () => {
  const sb = seed();
  const r = await act(sb, { ref: "MNT-429", verb: "assign", memberId: 7, actor: "Manager" });
  assertEquals(r, { status: 200, body: { status: "success", ref: "MNT-429", verb: "assign", assignee: { kind: "member", id: 7, name: "Semax" } } });
  const t = ticket(sb, 429);
  assertEquals([t.assigned_technician_id, t.assigned_vendor_id, t.status, t.last_update], [7, null, "assigned", "2026-10-09T07:00:00.000Z"]);
  assertEquals(sb.tables.cleaning_log.map((l: any) => [l.reservation_key, l.action, l.actor, l.details]),
    [["ticket_429", "problem_assigned", "Walter", { to: "Semax", kind: "member" }]]);
  assertEquals(sb.tables.job_events.map((e: any) => [e.event_type, e.job_id, e.cleaner_id]), [["mgr_problem_act", "MNT-429", 8]]);
});

Deno.test("assign MNT : prestataire, puis retrait ; un ticket en cours garde son statut", async () => {
  const sb = seed();
  assertEquals((await act(sb, { ref: "MNT-429", verb: "assign", vendorId: 3 })).body.assignee, { kind: "vendor", id: 3, name: "CoolFix" });
  const t = ticket(sb, 429);
  assertEquals([t.assigned_technician_id, t.assigned_vendor_id, t.status], [null, 3, "assigned"]);
  assertEquals((await act(sb, { ref: "MNT-429", verb: "assign", unassign: true })).body.assignee, null);
  assertEquals([t.assigned_vendor_id, t.status], [null, "open"]);
  await act(sb, { ref: "MNT-430", verb: "assign", memberId: 4 });
  assertEquals([ticket(sb, 430).assigned_technician_id, ticket(sb, 430).status], [4, "in_progress"]);
});

Deno.test("refus avant toute ecriture : personne, role, prestataire, tache vers prestataire, saisie", async () => {
  const sb = seed();
  const err = async (b: any) => (await act(sb, b)).body.error;
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: 9 }), "This person cannot take tickets.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: 12 }), "This person cannot take tickets.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", vendorId: 2 }), "This vendor is not active.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", memberId: 4 }), "This person cannot take team tasks.");
  assertEquals(await err({ ref: "TSK-13", verb: "assign", vendorId: 3 }), "Team tasks go to a team member, not a vendor.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign" }), "Choose a person or a vendor.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: 7, vendorId: 3 }), "Choose a person or a vendor, not both.");
  assertEquals(await err({ ref: "MNT-429", verb: "assign", memberId: "abc" }), "Invalid person.");
  assertEquals(await err({ ref: "INS-4", verb: "assign", memberId: 7 }), "Unknown problem reference.");
  assertEquals(await err({ ref: "MNT-429", verb: "explode" }), "Unknown action.");
  assertEquals((await mgrProblemAct(sb, ME, { ref: "MNT-429", verb: "assign", memberId: 7, idem: "x" }, { nowMs: NOW })).body.error, "idem required");
  assertEquals(await act(sb, { ref: "MNT-9999", verb: "assign", memberId: 7 }), { status: 404, body: { error: "MNT-9999 not found." } });
  assertEquals(sb.writes.length, 0);
});

Deno.test("assign TSK : manager, notification au nouvel assigne seulement", async () => {
  const sb = seed();
  const sent: number[] = [];
  const deps = { notifyTask: (t: any) => { sent.push(t.id); } };
  await act(sb, { ref: "TSK-13", verb: "assign", memberId: 8 }, deps);
  await act(sb, { ref: "TSK-13", verb: "assign", memberId: 8 }, deps);
  await act(sb, { ref: "TSK-13", verb: "assign", unassign: true }, deps);
  assertEquals(sent, [13]);
  assertEquals(task(sb, 13).assigned_cleaner_id, null);
});

Deno.test("idempotence : meme cle, meme reponse, une seule ecriture ; cle posee sans resultat = 409", async () => {
  const sb = seed();
  const body = { ref: "MNT-429", verb: "assign", memberId: 7, idem: "idem-replay-1" };
  const a = await mgrProblemAct(sb, ME, body, { nowMs: NOW });
  const b = await mgrProblemAct(sb, ME, body, { nowMs: NOW });
  assertEquals(b, a);
  assertEquals(sb.tables.cleaning_log.length, 1);
  sb.tables.job_events.push({ id: 77, idem_key: "idem-pending-1", event_type: "mgr_problem_act", result: null });
  assertEquals(await mgrProblemAct(sb, ME, { ...body, idem: "idem-pending-1" }, { nowMs: NOW }),
    { status: 409, body: { error: "Still processing. Retry." } });
});

Deno.test("ecriture ratee : la cle est liberee, l'erreur remonte", async () => {
  const sb = seed();
  sb.fail["maintenance_tickets.update"] = { message: "db down" };
  let msg = "";
  try { await act(sb, { ref: "MNT-429", verb: "assign", memberId: 7 }); } catch (e) { msg = (e as any).message; }
  assertEquals(msg, "db down");
  assertEquals(sb.tables.job_events.length, 0);
});

Deno.test("schedule : fin de journee Dubai, TSK due_at, retrait, passe et trop loin refuses", async () => {
  const sb = seed();
  assertEquals((await act(sb, { ref: "MNT-429", verb: "schedule", date: "2026-10-12" })).body,
    { status: "success", ref: "MNT-429", verb: "schedule", dueAt: "2026-10-12T19:59:59.000Z" });
  assertEquals(ticket(sb, 429).sla_deadline, "2026-10-12T19:59:59.000Z");
  await act(sb, { ref: "TSK-13", verb: "schedule", date: "2026-10-09" });
  assertEquals(task(sb, 13).due_at, "2026-10-09T19:59:59.000Z");
  await act(sb, { ref: "TSK-13", verb: "schedule", date: null });
  assertEquals(task(sb, 13).due_at, null);
  const err = async (date: unknown) => (await act(sb, { ref: "MNT-429", verb: "schedule", date })).body.error;
  assertEquals(await err("2026-10-08"), "The date cannot be in the past.");
  assertEquals(await err("2027-10-10"), "The date is too far ahead.");
  assertEquals(await err("2026-02-30"), "Invalid date.");
  assertEquals(sb.tables.cleaning_log.map((l: any) => [l.reservation_key, l.action, l.details]), [
    ["ticket_429", "problem_scheduled", { date: "2026-10-12" }],
    ["task_13", "problem_scheduled", { date: "2026-10-09" }],
    ["task_13", "problem_scheduled", { date: null }],
  ]);
});

Deno.test("schedule d'un ticket d'inspection : la date de rectification de la zone suit", async () => {
  const sb = seed();
  await act(sb, { ref: "MNT-501", verb: "schedule", date: "2026-10-14" });
  const it = sb.tables.inspection_items[0];
  assertEquals([it.fix_scheduled_for, it.fix_scheduled_slot], ["2026-10-14", null]);
  assertEquals(ticket(sb, 501).description, "Lamp broken\n\nFix date: 14 Oct 2026");
});

Deno.test("assign et schedule refuses sur un probleme clos, la cle est liberee ; comment accepte", async () => {
  const sb = seed();
  assertEquals(await act(sb, { ref: "MNT-300", verb: "assign", memberId: 7 }), { status: 409, body: { error: "MNT-300 is closed. Reopen it first." } });
  assertEquals((await act(sb, { ref: "TSK-19", verb: "schedule", date: "2026-10-10" })).body.error, "TSK-19 is closed. Reopen it first.");
  assertEquals(sb.tables.job_events.length, 0);
  assertEquals((await act(sb, { ref: "MNT-300", verb: "comment", text: "Checked again" })).status, 200);
});

Deno.test("comment : auteur de la session, texte borne, vide refuse", async () => {
  const sb = seed();
  const r = await act(sb, { ref: "MNT-429", verb: "comment", text: "  Called the gas company.  ", author: "Hillal" });
  assertEquals(r.body.comment, { author: "Walter", text: "Called the gas company.", at: "2026-10-09T07:00:00.000Z" });
  assertEquals(sb.tables.ticket_comments.map((c: any) => [c.ticket_id, c.author, c.comment]), [[429, "Walter", "Called the gas company."]]);
  await act(sb, { ref: "TSK-13", verb: "comment", text: "x".repeat(2500) });
  assertEquals(sb.tables.team_task_comments.map((c: any) => [c.task_id, c.cleaner_id, c.body.length]), [[13, 8, 2000]]);
  assertEquals((await act(sb, { ref: "MNT-429", verb: "comment", text: "   " })).body.error, "Write a comment first.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_problem_act_test.ts`
Expected: FAIL, `Module not found ".../mgr_problem_act.ts"`.

- [ ] **Step 3: Write the implementation**

`supabase/functions/hostaway-proxy/mgr_problem_act.ts`:

```ts
// Gestes de la boite Problems (spec 2026-10-09-hk-manager-app-design.md, sections
// 3 et 6). Auteur toujours pris dans la session (me), jamais dans le corps.
// Idempotence par cle, meme convention que v3 et inspections (job_events) :
// validation, puis cle, puis rejeu, puis etat du probleme, puis ecriture ;
// une ecriture ratee libere la cle, les effets secondaires (journal, copie
// Hermes, notification) ne font jamais echouer un geste deja ecrit.
import type { SessionUser } from "./auth.ts";
import {
  claimEvent, plusDays, recordResult, releaseEvent, replayResponse, todayDubai, v3Log, validIdem,
  type ActionResult,
} from "./v3.ts";
import { sansEchec } from "./v3_photos.ts";
import { setFixSchedule } from "./insp_write.ts";
import {
  dueIsoFor, MGR_CLOSED_TASK_STATUSES, MGR_CLOSED_TICKET_STATUSES, MGR_INSPECTION_SOURCE, MGR_MIRROR_PREFIX,
  MGR_OPEN_TASK_STATUSES, MGR_OPEN_TICKET_STATUSES, MGR_SCHEDULE_MAX_DAYS, MGR_TASK_ASSIGNEE_ROLES,
  MGR_TICKET_ASSIGNEE_ROLES, parseRef, problemRef, type InboxAssignee, type InboxKind,
} from "./mgr_inbox.ts";
import { readAllRows } from "./mgr_today.ts";

export const MGR_ACT_EVENT = "mgr_problem_act" as const;
export const MGR_TEXT_MAX = 2000;

export type ActDeps = { nowMs?: number; notifyTask?: (task: any) => void };
export type Act =
  | { verb: "assign"; memberId: number | null; vendorId: number | null }
  | { verb: "schedule"; date: string | null }
  | { verb: "comment"; text: string };
type Target = { kind: InboxKind; id: number; ref: string; row: any; logKey: string };
type Done = { result: Record<string, unknown>; after: Array<[string, () => Promise<unknown>]> };
type Ctx = { sb: any; me: SessionUser; t: Target; nowMs: number; nowIso: string; deps: ActDeps };

const bad = (status: number, error: string): ActionResult => ({ status, body: { error } });
const has = (v: unknown) => v !== undefined && v !== null && v !== "";
function validDay(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(d + "T00:00:00Z");
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === d;
}
function cleanText(v: unknown): string {
  return typeof v === "string" ? v.trim().slice(0, MGR_TEXT_MAX) : "";
}
function posInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseAct(body: any, today: string): Act | { error: string } {
  const verb = String(body?.verb ?? "");
  if (verb === "assign") {
    if (body?.unassign === true) return { verb, memberId: null, vendorId: null };
    if (has(body?.memberId) && has(body?.vendorId)) return { error: "Choose a person or a vendor, not both." };
    if (has(body?.memberId)) {
      const n = posInt(body.memberId);
      return n ? { verb, memberId: n, vendorId: null } : { error: "Invalid person." };
    }
    if (has(body?.vendorId)) {
      const n = posInt(body.vendorId);
      return n ? { verb, memberId: null, vendorId: n } : { error: "Invalid vendor." };
    }
    return { error: "Choose a person or a vendor." };
  }
  if (verb === "schedule") {
    if (!has(body?.date)) return { verb, date: null };
    const d = String(body.date);
    if (!validDay(d)) return { error: "Invalid date." };
    if (d < today) return { error: "The date cannot be in the past." };
    if (d > plusDays(today, MGR_SCHEDULE_MAX_DAYS)) return { error: "The date is too far ahead." };
    return { verb, date: d };
  }
  if (verb === "comment") {
    const text = cleanText(body?.text);
    return text ? { verb, text } : { error: "Write a comment first." };
  }
  return { error: "Unknown action." };
}

// Etat du probleme au moment du geste, lu apres la cle : un rejeu rend son
// resultat memorise meme si le probleme a change entre-temps.
export function stateRefusal(verb: string, closed: boolean, ref: string): string | null {
  if (closed && (verb === "assign" || verb === "schedule")) return ref + " is closed. Reopen it first.";
  return null;
}

async function assigneeName(sb: any, kind: InboxKind, a: { memberId: number | null; vendorId: number | null }):
  Promise<{ name: string | null } | ActionResult> {
  if (a.memberId !== null) {
    const { data: c, error } = await sb.from("cleaners").select("id, name, role, is_active").eq("id", a.memberId).maybeSingle();
    if (error) throw error;
    const roles = kind === "MNT" ? MGR_TICKET_ASSIGNEE_ROLES : MGR_TASK_ASSIGNEE_ROLES;
    if (!c || c.is_active === false || !roles.includes(String(c.role ?? ""))) {
      return bad(400, kind === "MNT" ? "This person cannot take tickets." : "This person cannot take team tasks.");
    }
    return { name: String(c.name ?? "").trim() || "Member " + a.memberId };
  }
  if (a.vendorId !== null) {
    if (kind === "TSK") return bad(400, "Team tasks go to a team member, not a vendor.");
    const { data: v, error } = await sb.from("vendors").select("id, name, is_active").eq("id", a.vendorId).maybeSingle();
    if (error) throw error;
    if (!v || v.is_active === false) return bad(400, "This vendor is not active.");
    return { name: String(v.name ?? "").trim() || "Vendor " + a.vendorId };
  }
  return { name: null };
}

async function doAssign(c: Ctx, a: { memberId: number | null; vendorId: number | null }, who: string | null): Promise<Done> {
  const { sb, t } = c;
  const after: Done["after"] = [];
  if (t.kind === "MNT") {
    const st = String(t.row.status ?? "open");
    const taken = a.memberId !== null || a.vendorId !== null;
    // open et assigned suivent l'affectation ; in_progress, waiting_parts et to_confirm restent.
    const status = st === "open" || st === "assigned" ? (taken ? "assigned" : "open") : st;
    const { error } = await sb.from("maintenance_tickets").update({
      assigned_technician_id: a.memberId, assigned_vendor_id: a.vendorId, status, last_update: c.nowIso,
    }).eq("id", t.id);
    if (error) throw error;
  } else {
    const { data: task, error } = await sb.from("team_tasks").update({ assigned_cleaner_id: a.memberId })
      .eq("id", t.id).select().single();
    if (error) throw error;
    const notify = c.deps.notifyTask;
    if (a.memberId !== null && Number(t.row.assigned_cleaner_id) !== a.memberId && notify) {
      after.push(["notification de " + t.ref, async () => notify(task)]);
    }
  }
  const assignee: InboxAssignee | null = a.memberId !== null ? { kind: "member", id: a.memberId, name: who ?? "" }
    : a.vendorId !== null ? { kind: "vendor", id: a.vendorId, name: who ?? "" } : null;
  after.unshift(["journal de " + t.ref, () =>
    v3Log(sb, t.logKey, "problem_assigned", c.me.name, { to: who, kind: assignee ? assignee.kind : null })]);
  return { result: { assignee }, after };
}

async function doSchedule(c: Ctx, a: { date: string | null }): Promise<Done> {
  const { sb, t } = c;
  const due = a.date ? dueIsoFor(a.date) : null;
  const after: Done["after"] = [];
  if (t.kind === "MNT") {
    const { error } = await sb.from("maintenance_tickets").update({ sla_deadline: due, last_update: c.nowIso }).eq("id", t.id);
    if (error) throw error;
    if (String(t.row.source ?? "") === MGR_INSPECTION_SOURCE) {
      // La date de rectification de la zone (ecran Inspections) suit la meme date.
      after.push(["date de rectification de " + t.ref, async () => {
        const { data: items, error: e } = await sb.from("inspection_items").select("inspection_id, zone, outcome").eq("ticket_id", t.id);
        if (e) throw e;
        for (const it of items ?? []) {
          if (it.outcome !== "maintenance") continue;
          const r = await setFixSchedule(sb, c.me, { inspectionId: it.inspection_id, zone: it.zone, date: a.date, slot: null }, c.nowMs);
          if (r.status !== 200) throw new Error(String(r.body.error ?? "fix date refused"));
        }
      }]);
    }
  } else {
    const { error } = await sb.from("team_tasks").update({ due_at: due }).eq("id", t.id);
    if (error) throw error;
  }
  after.unshift(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_scheduled", c.me.name, { date: a.date })]);
  return { result: { dueAt: due }, after };
}

async function doComment(c: Ctx, a: { text: string }): Promise<Done> {
  const { sb, t } = c;
  const ins = t.kind === "MNT"
    ? sb.from("ticket_comments").insert({ ticket_id: t.id, author: c.me.name, comment: a.text })
    : sb.from("team_task_comments").insert({ task_id: t.id, cleaner_id: c.me.cleaner_id, body: a.text });
  const { data, error } = await ins.select("id, created_at").single();
  if (error) throw error;
  return { result: { comment: { author: c.me.name, text: a.text, at: data?.created_at ? String(data.created_at) : c.nowIso } }, after: [] };
}

const WRITERS: Record<string, (c: Ctx, a: any, who: string | null) => Promise<Done>> = {
  assign: doAssign, schedule: doSchedule, comment: doComment,
};

export async function mgrProblemAct(sb: any, me: SessionUser, body: any, deps: ActDeps = {}): Promise<ActionResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const p = parseRef(body?.ref);
  if (!p) return bad(400, "Unknown problem reference.");
  const ref = problemRef(p.kind, p.id);
  const a = parseAct(body, todayDubai(nowMs));
  if ("error" in a) return bad(400, a.error);
  if (!validIdem(body?.idem)) return bad(400, "idem required");
  const idem = String(body.idem);
  const { data: row, error } = await sb.from(p.kind === "MNT" ? "maintenance_tickets" : "team_tasks")
    .select("*").eq("id", p.id).maybeSingle();
  if (error) throw error;
  if (!row) return bad(404, ref + " not found.");
  let who: string | null = null;
  if (a.verb === "assign") {
    const w = await assigneeName(sb, p.kind, a);
    if ("status" in w) return w;
    who = w.name;
  }
  const claim = await claimEvent(sb, idem, MGR_ACT_EVENT, ref, me.cleaner_id, { ...a });
  const replay = replayResponse(claim);
  if (replay) return replay;
  const closed = (p.kind === "MNT" ? MGR_CLOSED_TICKET_STATUSES : MGR_CLOSED_TASK_STATUSES).includes(String(row.status ?? ""));
  const refusal = stateRefusal(a.verb, closed, ref);
  if (refusal) {
    await releaseEvent(sb, idem);
    return bad(409, refusal);
  }
  const t: Target = { kind: p.kind, id: p.id, ref, row, logKey: (p.kind === "MNT" ? "ticket_" : "task_") + p.id };
  const c: Ctx = { sb, me, t, nowMs, nowIso: new Date(nowMs).toISOString(), deps };
  let done: Done;
  try {
    done = await WRITERS[a.verb](c, a, who);
  } catch (e) {
    await releaseEvent(sb, idem);
    throw e;
  }
  const result = { status: "success", ref, verb: a.verb, ...done.result };
  await sansEchec("resultat non memorise pour " + idem, () => recordResult(sb, idem, result));
  for (const [what, fn] of done.after) await sansEchec(what, fn);
  return { status: 200, body: result };
}
```

(`MGR_MIRROR_PREFIX`, `MGR_OPEN_TASK_STATUSES`, `MGR_OPEN_TICKET_STATUSES` and `readAllRows` are imported now and used by Task 7.)

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 10 passed | 0 failed`.

- [ ] **Step 5: Route in `index.ts`**

Add the import:

```ts
import { mgrProblemAct } from "./mgr_problem_act.ts";
```

After the `mgr.problem.get` block, add:

```ts
    // Gestes Assign / Schedule / Close / Reopen / Comment. Auteur pris dans la
    // session, cle d'idempotence obligatoire, nouvel assigne d'une tache notifie
    // comme updateTeamTask.
    if (action === "mgr.problem.act") {
      const me = await currentUser(sb, req);
      const acc = mgrAccess(bearerToken(req) !== null, me);
      if (!acc.ok) return jsonResp({ error: acc.error }, acc.status);
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return jsonResp({ error: "invalid json body" }, 400);
      const r = await mgrProblemAct(sb, me!, body, {
        notifyTask: (t) => keepAlive(notifyAssignee(sb, t).catch((e) => console.warn("[notifyAssignee mgr]", e))),
      });
      return jsonResp(r.body, r.status);
    }
```

- [ ] **Step 6: Type-check and full suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: check silent, 0 failed.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add supabase/functions/hostaway-proxy/mgr_problem_act.ts supabase/functions/hostaway-proxy/mgr_problem_act_test.ts supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: action mgr.problem.act (assign technicien/prestataire/membre, schedule, comment), auteur de la session, idempotence job_events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `mgr.problem.act`: close and reopen (Undo), Hermes copies

**Files:**
- Modify: `supabase/functions/hostaway-proxy/mgr_problem_act.ts` (`Act` type, `parseAct`, `stateRefusal`, `WRITERS`, two new writers)
- Modify: `supabase/functions/hostaway-proxy/mgr_problem_act_test.ts` (append)

**Interfaces:**
- Consumes: Task 6 (everything in `mgr_problem_act.ts`), Task 3 (`readAllRows`).
- Produces:
  - Verb `close` with optional `note` → ticket `status: "resolved"`, `resolved_at`, `resolution_notes` (if note), comment with the note, open copies `maint:<id>` set `done`; task `status: "done"`, `completed_at`, `completed_by_cleaner_id`, note as a task comment. Log `problem_closed {from, notes, mirrors, note}` (tickets) or `{from, note}` (tasks). Body `{..., closed: true}`; 409 `<REF> is already closed.`
  - Verb `reopen` → previous status from the last `problem_closed` log (else `assigned` if a technician or vendor is set, `open` otherwise; tasks `open`), clears `resolved_at` / `closed_at` / `completed_*`, restores `resolution_notes` and the copies. Log `problem_reopened {to}`. Body `{..., state}`; 409 `<REF> is not closed.`

- [ ] **Step 1: Write the failing test**

Append to `mgr_problem_act_test.ts`:

```ts
Deno.test("close MNT : resolved, note, copie TSK fermee, journal avec l'etat d'avant ; deux fois = 409", async () => {
  const sb = seed();
  const r = await act(sb, { ref: "MNT-429", verb: "close", note: "Replaced the valve" });
  assertEquals(r.body, { status: "success", ref: "MNT-429", verb: "close", closed: true });
  const t = ticket(sb, 429);
  assertEquals([t.status, t.resolved_at, t.resolution_notes], ["resolved", "2026-10-09T07:00:00.000Z", "Replaced the valve"]);
  assertEquals([task(sb, 17).status, task(sb, 17).completed_by_cleaner_id], ["done", 8]);
  assertEquals(sb.tables.ticket_comments.map((c: any) => [c.author, c.comment]), [["Walter", "Replaced the valve"]]);
  assertEquals(sb.tables.cleaning_log.map((l: any) => [l.action, l.actor, l.details]),
    [["problem_closed", "Walter", { from: "open", notes: null, mirrors: [17], note: "Replaced the valve" }]]);
  assertEquals(await act(sb, { ref: "MNT-429", verb: "close" }), { status: 409, body: { error: "MNT-429 is already closed." } });
});

Deno.test("reopen (Undo) : statut, note et copie TSK d'avant le close ; deux fois = 409", async () => {
  const sb = seed();
  await act(sb, { ref: "MNT-430", verb: "close" });
  assertEquals((await act(sb, { ref: "MNT-430", verb: "reopen" })).body,
    { status: "success", ref: "MNT-430", verb: "reopen", state: "in_progress" });
  assertEquals([ticket(sb, 430).status, ticket(sb, 430).resolved_at, ticket(sb, 430).closed_at], ["in_progress", null, null]);
  await act(sb, { ref: "MNT-429", verb: "close", note: "x" });
  await act(sb, { ref: "MNT-429", verb: "reopen" });
  const m = task(sb, 17);
  assertEquals([ticket(sb, 429).status, ticket(sb, 429).resolution_notes, m.status, m.completed_at, m.completed_by_cleaner_id],
    ["open", null, "open", null, null]);
  assertEquals((await act(sb, { ref: "MNT-429", verb: "reopen" })).body.error, "MNT-429 is not closed.");
});

Deno.test("reopen d'un ticket clos ailleurs (sans journal) : assigned s'il a un technicien, sinon open", async () => {
  const sb = seed();
  sb.tables.maintenance_tickets.push({ id: 302, title: "x", status: "resolved", assigned_technician_id: 7, resolution_notes: "old" });
  await act(sb, { ref: "MNT-300", verb: "reopen" });
  await act(sb, { ref: "MNT-302", verb: "reopen" });
  assertEquals(ticket(sb, 300).status, "open");
  assertEquals([ticket(sb, 302).status, ticket(sb, 302).resolution_notes], ["assigned", "old"]);
});

Deno.test("close et reopen TSK : done par la session, note en commentaire, retour a in_progress", async () => {
  const sb = seed();
  task(sb, 13).status = "in_progress";
  await act(sb, { ref: "TSK-13", verb: "close", note: "Done by phone" });
  const t = task(sb, 13);
  assertEquals([t.status, t.completed_at, t.completed_by_cleaner_id], ["done", "2026-10-09T07:00:00.000Z", 8]);
  assertEquals(sb.tables.team_task_comments.map((c: any) => [c.task_id, c.cleaner_id, c.body]), [[13, 8, "Done by phone"]]);
  await act(sb, { ref: "TSK-13", verb: "reopen" });
  assertEquals([t.status, t.completed_at, t.completed_by_cleaner_id], ["in_progress", null, null]);
});

Deno.test("close : copie TSK en echec, le ticket reste clos et la reponse est un succes", async () => {
  const sb = seed();
  sb.fail["team_tasks.update"] = { message: "boom" };
  assertEquals((await act(sb, { ref: "MNT-429", verb: "close" })).status, 200);
  assertEquals(ticket(sb, 429).status, "resolved");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_problem_act_test.ts`
Expected: FAIL, `Unknown action.` for `close` and `reopen`.

- [ ] **Step 3: Write the implementation**

In `mgr_problem_act.ts`, replace:

```ts
  | { verb: "comment"; text: string };
```

with:

```ts
  | { verb: "comment"; text: string }
  | { verb: "close"; note: string }
  | { verb: "reopen" };
```

Replace (end of `parseAct`):

```ts
    return text ? { verb, text } : { error: "Write a comment first." };
  }
  return { error: "Unknown action." };
}
```

with:

```ts
    return text ? { verb, text } : { error: "Write a comment first." };
  }
  if (verb === "close") return { verb, note: cleanText(body?.note) };
  if (verb === "reopen") return { verb };
  return { error: "Unknown action." };
}
```

Replace `stateRefusal`:

```ts
export function stateRefusal(verb: string, closed: boolean, ref: string): string | null {
  if (closed && (verb === "assign" || verb === "schedule")) return ref + " is closed. Reopen it first.";
  return null;
}
```

with:

```ts
export function stateRefusal(verb: string, closed: boolean, ref: string): string | null {
  if (closed && (verb === "assign" || verb === "schedule")) return ref + " is closed. Reopen it first.";
  if (closed && verb === "close") return ref + " is already closed.";
  if (!closed && verb === "reopen") return ref + " is not closed.";
  return null;
}
```

Before `const WRITERS`, add:

```ts
async function doClose(c: Ctx, a: { note: string }): Promise<Done> {
  const { sb, t } = c;
  const from = String(t.row.status ?? "open");
  const after: Done["after"] = [];
  if (t.kind === "MNT") {
    // Copies Hermes encore ouvertes : lues avant l'ecriture, fermees apres (effet secondaire).
    const mirrors = (await readAllRows((x: number, y: number) => sb.from("team_tasks").select("id, status")
      .eq("source_ref", MGR_MIRROR_PREFIX + t.id).order("id").range(x, y), "team_tasks"))
      .filter((m: any) => MGR_OPEN_TASK_STATUSES.includes(String(m.status ?? ""))).map((m: any) => Number(m.id));
    const { error } = await sb.from("maintenance_tickets").update({
      status: "resolved", resolved_at: c.nowIso, last_update: c.nowIso, ...(a.note ? { resolution_notes: a.note } : {}),
    }).eq("id", t.id);
    if (error) throw error;
    after.push(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_closed", c.me.name, {
      from, notes: t.row.resolution_notes ?? null, mirrors, note: a.note || null,
    })]);
    if (mirrors.length) {
      after.push(["copies Hermes de " + t.ref, async () => {
        const { error: e } = await sb.from("team_tasks")
          .update({ status: "done", completed_at: c.nowIso, completed_by_cleaner_id: c.me.cleaner_id }).in("id", mirrors);
        if (e) throw e;
      }]);
    }
    if (a.note) {
      after.push(["note de " + t.ref, async () => {
        const { error: e } = await sb.from("ticket_comments").insert({ ticket_id: t.id, author: c.me.name, comment: a.note });
        if (e) throw e;
      }]);
    }
  } else {
    const { error } = await sb.from("team_tasks")
      .update({ status: "done", completed_at: c.nowIso, completed_by_cleaner_id: c.me.cleaner_id }).eq("id", t.id);
    if (error) throw error;
    after.push(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_closed", c.me.name, { from, note: a.note || null })]);
    if (a.note) {
      after.push(["note de " + t.ref, async () => {
        const { error: e } = await sb.from("team_task_comments").insert({ task_id: t.id, cleaner_id: c.me.cleaner_id, body: a.note });
        if (e) throw e;
      }]);
    }
  }
  return { result: { closed: true }, after };
}

// Undo de Close : l'etat d'avant vient du dernier journal problem_closed. Sans
// journal (probleme clos ailleurs), retour a assigned ou open.
async function doReopen(c: Ctx): Promise<Done> {
  const { sb, t } = c;
  const logs = await readAllRows((x: number, y: number) => sb.from("cleaning_log").select("id, details, created_at")
    .eq("reservation_key", t.logKey).eq("action", "problem_closed").order("id").range(x, y), "cleaning_log");
  const last = logs.slice().sort((x: any, y: any) =>
    (Date.parse(y.created_at) - Date.parse(x.created_at)) || (Number(y.id) - Number(x.id)))[0] ?? null;
  const d = last && last.details && typeof last.details === "object" ? last.details : null;
  const after: Done["after"] = [];
  let state: string;
  if (t.kind === "MNT") {
    const fallback = t.row.assigned_technician_id != null || t.row.assigned_vendor_id != null ? "assigned" : "open";
    state = d && MGR_OPEN_TICKET_STATUSES.includes(String(d.from)) ? String(d.from) : fallback;
    const { error } = await sb.from("maintenance_tickets").update({
      status: state, resolved_at: null, closed_at: null, last_update: c.nowIso,
      ...(d ? { resolution_notes: d.notes ?? null } : {}),
    }).eq("id", t.id);
    if (error) throw error;
    const mirrors = d && Array.isArray(d.mirrors)
      ? d.mirrors.map(Number).filter((n: number) => Number.isInteger(n) && n > 0) : [];
    if (mirrors.length) {
      after.push(["copies Hermes de " + t.ref, async () => {
        const { error: e } = await sb.from("team_tasks")
          .update({ status: "open", completed_at: null, completed_by_cleaner_id: null }).in("id", mirrors).eq("status", "done");
        if (e) throw e;
      }]);
    }
  } else {
    state = d && MGR_OPEN_TASK_STATUSES.includes(String(d.from)) ? String(d.from) : "open";
    const { error } = await sb.from("team_tasks")
      .update({ status: state, completed_at: null, completed_by_cleaner_id: null }).eq("id", t.id);
    if (error) throw error;
  }
  after.unshift(["journal de " + t.ref, () => v3Log(sb, t.logKey, "problem_reopened", c.me.name, { to: state })]);
  return { result: { state }, after };
}
```

Replace:

```ts
const WRITERS: Record<string, (c: Ctx, a: any, who: string | null) => Promise<Done>> = {
  assign: doAssign, schedule: doSchedule, comment: doComment,
};
```

with:

```ts
const WRITERS: Record<string, (c: Ctx, a: any, who: string | null) => Promise<Done>> = {
  assign: doAssign, schedule: doSchedule, comment: doComment, close: doClose, reopen: doReopen,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 15 passed | 0 failed`.

- [ ] **Step 5: Full suite and type-check**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts`
Expected: 0 failed, check silent.

- [ ] **Step 6: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add supabase/functions/hostaway-proxy/mgr_problem_act.ts supabase/functions/hostaway-proxy/mgr_problem_act_test.ts
git commit -m "proxy: mgr.problem.act close et reopen (Undo : etat, note et copies Hermes restaures depuis le journal)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Front: shared problem panel, Today's problems block actionable

**Files:**
- Modify: `manager/api.js` (append `newIdem`)
- Modify: `manager/ui/dom.js` (append date and sheet helpers, `announceBadge`)
- Create: `manager/screens/problem-view.js`
- Create: `manager/problem-panel.js`
- Create: `manager/ui/problems.css`
- Modify: `manager/index.html` (stylesheet link)
- Modify: `manager/screens/today.js` (imports, panel, `prob` click, leave)
- Modify: `manager/screens/today-view.js` (footer counts, remove `problemSheet`)
- Create: `tests/manager/problem-fixtures.ts`
- Create: `tests/manager/today-problems.spec.ts`
- Modify: `tests/manager/helpers.ts` (image stub for signed URLs)
- Modify: `tests/manager/fixtures.ts` (problems block, `(MNT-429)` cause)
- Modify: `tests/manager/today.spec.ts` (cause text, remove the read-only problem test)

**Interfaces:**
- Consumes: `get`, `post` (`api.js`), `openSheet`, `closeSheet`, `sheetIsOpen`, `toast`, `esc`, `I`, `placeLabel`, `dubaiTime` (`dom.js`), Task 5 detail shape, Task 6/7 act body and answers.
- Produces:
  - `api.js`: `newIdem(): string` (`mgr-` + 32 hex).
  - `dom.js`: `dubaiToday(ms): "YYYY-MM-DD"`, `addDays(day, n)`, `ddmm(day)`, `sheetBusy(on)`, `sheetError(msg)`, `announceBadge(n)` (dispatches `mgr:badge` with `detail.problems`).
  - `problem-panel.js`: `createProblemPanel({ readOnly: () => boolean, onChange: () => void, handleAccess: (e) => boolean })` returning `{ open(ref, row), assign(ref, row), schedule(ref, row), close(ref, row), current(): string | null, dispose() }`.
  - Panel DOM contract: every panel sheet carries `data-panel="<REF>"` on `.sheet-h`; buttons `data-pact` = `assign | schedule | close | reopen | comment | pick | vendor | unassign | date | date-input | clear-date | back | retry`; comment box `#pComment`, date input `#pDate`; footer buttons "Assign", "Schedule", "Close problem" (or "Reopen" when closed), read-only line `.ro-note`.
  - Toasts: `<REF> assigned to <name>`, `<REF> sent to <vendor>`, `<REF> unassigned`, `<REF> due dd/mm`, `<REF> has no due date now`, `Comment added`, `<REF> closed` (with Undo), `<REF> reopened`.

- [ ] **Step 1: Test fixtures and helpers**

`tests/manager/problem-fixtures.ts`:

```ts
// Reponses mgr.problem.get et mgr.problems au format de
// supabase/functions/hostaway-proxy/mgr_problem_get.ts et mgr_problems.ts.
export const ROW = (o: any = {}) => ({
  ref: 'MNT-429', kind: 'MNT', id: 429, source: 'Maintenance', priority: 'urgent', label: 'Urgent', tone: 'bad',
  title: 'Gas not working', status: 'open', closed: false, listingId: 'L1', apt: '308', bld: 'Binghatti Lavender',
  assignee: null, createdAt: '2026-07-09T08:00:00Z', since: '09/07', dueAt: null, due: null, overdue: false, todayBoost: 0,
  why: 'A guest arrives today at 15:00. Open since 09/07, no technician assigned.', ...o,
});
export const ROW_TSK = ROW({
  ref: 'TSK-13', kind: 'TSK', id: 13, source: 'Team task', title: 'AC not cooling', listingId: 'L1', apt: '308',
  bld: 'Binghatti Lavender', assignee: { kind: 'member', id: 7, name: 'Semax' }, createdAt: '2026-05-14T08:00:00Z',
  since: '14/05', dueAt: '2026-05-15T08:00:00Z', due: '15/05', overdue: true, todayBoost: 0,
  why: 'A guest arrives today at 15:00. Assigned to Semax, overdue since 15/05.',
});
export const ROW_INS = ROW({
  ref: 'MNT-501', id: 501, source: 'Inspection', priority: 'normal', label: 'Normal', tone: 'idle', title: 'Bedroom: lamp broken',
  status: 'assigned', listingId: 'L2', apt: '103', bld: 'Damac Reva', assignee: { kind: 'member', id: 8, name: 'Walter' },
  createdAt: '2026-10-07T08:00:00Z', since: '07/10', dueAt: '2026-10-12T19:59:59.000Z', due: '12/10', todayBoost: 1,
  why: 'Checkout today at 12:00. Open since 07/10, assigned to Walter.',
});
export const ASSIGNEES = [
  { id: 7, name: 'Semax', role: 'manager', takesTasks: true }, { id: 8, name: 'Walter', role: 'manager', takesTasks: true },
  { id: 4, name: 'Faiza', role: 'cleaner', takesTasks: false },
];
export function detailBody(over: any = {}) {
  return JSON.parse(JSON.stringify({
    problem: ROW(), description: 'Guest says the stove does not light.', category: 'gas', reportedBy: 'Faiza',
    photos: [{ url: 'https://signed.test/v3/p1.jpg', label: 'Reported' }], photosError: null,
    comments: [{ author: 'Walter', text: 'Called the gas company.', at: '2026-10-08T06:00:00Z', photo: null }],
    history: [{ at: '2026-07-09T08:00:00Z', text: 'Reported by Faiza' }],
    mirror: { ref: 'TSK-17', status: 'open', assignee: 'Semax' },
    assignees: ASSIGNEES, vendors: [{ id: 3, name: 'CoolFix', specialty: 'AC' }],
    ...over,
  }));
}
export const detailTsk = () => detailBody({ problem: ROW_TSK, mirror: null, vendors: [], photos: [], description: 'Check the AC' });
export const ACT_OK = (o: any = {}) => ({ status: 'success', ...o });
export function listBody(over: any = {}) {
  return JSON.parse(JSON.stringify({
    day: '2026-10-09', generatedAt: '2026-10-09T07:00:00.000Z', bookingsCachedAt: null, bookingsUnavailable: false,
    me: { id: 8, name: 'Walter' },
    counts: { open: 3, urgent: 2, mine: 1, unassigned: 1, overdue: 1, bySource: { Maintenance: 1, Inspection: 1, 'Cleaner report': 0, 'Team task': 1 } },
    apartments: [{ listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', n: 2 }, { listingId: 'L2', apt: '103', bld: 'Damac Reva', n: 1 }],
    total: 3, offset: 0, limit: 50, rows: [ROW(), ROW_TSK, ROW_INS],
    assignees: ASSIGNEES, vendors: [{ id: 3, name: 'CoolFix', specialty: 'AC' }],
    ...over,
  }));
}
export function manyRows(n: number, start: number) {
  return Array.from({ length: n }, (_, i) => ROW({ ref: 'MNT-' + (start + i), id: start + i, title: 'Problem ' + (start + i), priority: 'low', label: 'Low', tone: 'idle' }));
}
```

In `tests/manager/helpers.ts`, after the line `export const me = ...`, add:

```ts
// Image d'un pixel servie a la place des URL signees du stockage (aucun appel reseau).
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
```

and in `bootMgr`, right after the `fonts.googleapis.com` route line, add:

```ts
  await page.route('https://signed.test/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') }));
```

In `tests/manager/fixtures.ts`, add at the top `import { ROW, ROW_TSK } from './problem-fixtures';`, then replace the whole `problems: { ... },` block of `todayBody` with:

```ts
    problems: {
      counts: { urgent: 21, ticketsOpen: 70, ticketsUrgent: 19, ticketsNoTech: 69, teamTasksOpen: 135, teamTasksOverdue: 19, inspectionTicketsOpen: 11, cleanerReportsOpen: 0 },
      top: [ROW(), ROW_TSK],
    },
```

and replace `Gas not working (#429).` with `Gas not working (MNT-429).` (one occurrence). In `tests/manager/today.spec.ts`, replace `Gas not working (#429).` with `Gas not working (MNT-429).` and delete the whole test `test('probleme : fiche en lecture seule avec lien vers l app actuelle', ...)` (9 lines, from `test('probleme : fiche` to its closing `});`).

- [ ] **Step 2: Write the failing Playwright test**

`tests/manager/today-problems.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW, todayBody } from './fixtures';
import { ACT_OK, detailBody } from './problem-fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const DETAIL = (body: any = detailBody()) => ({ match: 'action=mgr.problem.get', status: 200, body });
const ACT = (status = 200, body: any = ACT_OK(), delay = 0) => ({ match: 'action=mgr.problem.act', status, body, delay });
const acts = async (page: any) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problem.act')).map((l) => JSON.parse(l.body));
const openGas = (page: any) => page.locator('.prob', { hasText: 'Gas not working' }).click();

test('fiche d un probleme depuis Today : photos, commentaires, historique, copie TSK, gestes', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL()], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.locator('.sub')).toHaveText('MNT-429 · Maintenance · Apt 308 · Binghatti Lavender');
  await expect(sheet.getByRole('img', { name: 'Reported' })).toBeVisible();
  await expect(sheet).toContainText('Called the gas company.');
  await expect(sheet).toContainText('Reported by Faiza');
  await expect(sheet).toContainText('Also tracked as team task TSK-17 (Semax). It closes with this ticket.');
  for (const n of ['Assign', 'Schedule', 'Close problem']) await expect(sheet.getByRole('button', { name: n, exact: true })).toBeVisible();
  expect((await fetchLog(page)).find((l) => l.url.includes('action=mgr.problem.get'))!.url).toContain('ref=MNT-429');
});

test('Assign depuis la fiche : une cle par geste, sans actor, Today et fiche recharges', async ({ page }) => {
  const assigned = detailBody({ problem: { ...detailBody().problem, status: 'assigned', assignee: { kind: 'member', id: 7, name: 'Semax' } } });
  await bootMgr(page, [me(MANAGER), TODAY(), { ...DETAIL(), once: true }, ACT(), DETAIL(assigned)], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(sheet.getByRole('heading', { name: 'Assign MNT-429' })).toBeVisible();
  await expect(sheet.locator('[data-pact="vendor"]')).toContainText('CoolFix');
  await sheet.locator('[data-pact="pick"][data-id="7"]').click();
  await expect(page.locator('#toast')).toContainText('MNT-429 assigned to Semax');
  const a = await acts(page);
  expect(a).toEqual([{ ref: 'MNT-429', verb: 'assign', memberId: 7, idem: expect.stringMatching(/^mgr-[A-Za-z0-9]{8,}$/) }]);
  await expect(sheet.locator('.pfacts')).toContainText('Semax');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length).toBe(2);
});

test('Close avec note puis Undo : close puis reopen, deux cles differentes', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), ACT()], { email: true, clock: NOW });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await sheet.locator('#pComment').fill('Replaced the valve');
  await sheet.getByRole('button', { name: 'Close problem' }).click();
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#toast')).toContainText('MNT-429 reopened');
  const a = await acts(page);
  expect(a.map((x) => [x.verb, x.note])).toEqual([['close', 'Replaced the valve'], ['reopen', undefined]]);
  expect(a[0].idem).not.toBe(a[1].idem);
});

test('double clic sur Close problem : une seule ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), ACT(200, ACT_OK(), 400)], { email: true, clock: NOW });
  await openGas(page);
  await page.locator('#sheet').getByRole('button', { name: 'Close problem' }).dblclick();
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  expect((await acts(page)).length).toBe(1);
});

test('refus du serveur : message tel quel dans la fiche, boutons rendus', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), DETAIL(), ACT(409, { error: 'MNT-429 is already closed.' })], { email: true, clock: NOW });
  await openGas(page);
  await page.locator('#sheet').getByRole('button', { name: 'Close problem' }).click();
  await expect(page.locator('#sheet .sheet-err')).toHaveText('MNT-429 is already closed.');
  await expect(page.locator('#sheet').getByRole('button', { name: 'Close problem' })).toBeEnabled();
});

test('fiche indisponible : message et Retry dans la fiche', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { ...DETAIL(), status: 500, body: { error: 'Internal error' }, once: true }, DETAIL()], { email: true, clock: NOW });
  await openGas(page);
  await expect(page.locator('#sheet .sheet-err')).toHaveText('Internal error');
  await page.locator('#sheet').getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#sheet').getByRole('button', { name: 'Assign', exact: true })).toBeVisible();
});

test('Today en cache (reseau coupe) : fiche en lecture seule, aucun geste', async ({ page }) => {
  const cache = { v: 1, owner: 'u-test', savedAt: Date.parse('2026-10-09T05:42:00Z'), data: todayBody() };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 0, body: null, fail: true }, DETAIL()], { email: true, clock: NOW, cache });
  await openGas(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.locator('.ro-note')).toHaveText('Reconnect to make changes.');
  await expect(sheet.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  await expect(sheet.locator('#pComment')).toHaveCount(0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (port check first, see Global Constraints): `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && npx playwright test tests/manager/today-problems.spec.ts --project=mgr-desktop`
Expected: FAIL (the old read-only sheet, no `.sub` with the ref, no Assign button).

- [ ] **Step 4: `api.js` and `dom.js` helpers**

Append to `manager/api.js`:

```js
// Cle d'idempotence d'un geste (meme format que v3 et inspections, validIdem
// cote proxy : [A-Za-z0-9_-]{8,80}). Une cle neuve par geste de l'utilisateur.
export function newIdem() {
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && typeof c.randomUUID === 'function') return 'mgr-' + c.randomUUID().replace(/-/g, '');
  return 'mgr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
```

Append to `manager/ui/dom.js`:

```js
// Jour calendaire de Dubai (AAAA-MM-JJ) d'un instant.
export function dubaiToday(ms) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: '2-digit', month: '2-digit', year: 'numeric' })
    .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day;
}
export function addDays(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function ddmm(day) { return day ? day.slice(8, 10) + '/' + day.slice(5, 7) : ''; }

// Boutons du panneau desactives pendant une ecriture, erreur du serveur en tete du panneau.
export function sheetBusy(on) {
  document.querySelectorAll('#sheet button:not([data-close])').forEach((b) => { b.disabled = on; });
}
export function sheetError(msg) {
  const body = document.querySelector('#sheet .sheet-b');
  if (!body) return;
  let el = body.querySelector('.sheet-err');
  if (!el) {
    el = document.createElement('p');
    el.className = 'sheet-err';
    el.setAttribute('role', 'alert');
    body.prepend(el);
  }
  el.textContent = msg;
}

// Nombre de problemes urgents ouverts, pour la pastille de la navigation (app.js).
export function announceBadge(n) {
  document.dispatchEvent(new CustomEvent('mgr:badge', { detail: { problems: Number(n) || 0 } }));
}
```

- [ ] **Step 5: Views of the panel**

`manager/screens/problem-view.js`:

```js
// Fiche d'un probleme et choix Assign / Schedule : HTML pur a partir de la reponse
// mgr.problem.get. Aucun appel reseau ici. Chaque panneau porte data-panel="<REF>"
// pour que problem-panel.js sache quel probleme est affiche.
import { addDays, ddmm, dubaiTime, esc, I, placeLabel } from '/manager/ui/dom.js';

const RO_LINE = 'Reconnect to make changes.';
const STATUS = {
  open: 'Open', assigned: 'Assigned', in_progress: 'In progress', waiting_parts: 'Waiting for parts', to_confirm: 'To confirm',
  resolved: 'Closed', closed: 'Closed', cancelled: 'Cancelled', done: 'Closed',
};
const ROLE = { manager: 'Manager', maintenance: 'Maintenance', cleaner: 'Cleaner' };

function initials(n) {
  return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
function head(ref, title, sub) {
  return '<div class="sheet-h" data-panel="' + esc(ref) + '"><div><h2 id="sheetTitle">' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
function when(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return ddmm(new Date(t + 4 * 3600000).toISOString().slice(0, 10)) + ' ' + dubaiTime(iso);
}
export function subLine(p) { return [p.ref, p.source, placeLabel(p)].filter(Boolean).join(' · '); }

export function loadingSheet(ref, row) {
  return head(ref, row ? row.title : ref, row ? subLine(row) : ref)
    + '<div class="sheet-b"><p class="boot" role="status">Loading…</p></div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-close>Close</button></div>';
}
export function errorSheet(ref, row, msg) {
  return head(ref, row ? row.title : ref, row ? subLine(row) : ref)
    + '<div class="sheet-b"><p class="sheet-err" role="alert">' + esc(msg) + '</p></div>'
    + '<div class="sheet-f"><button class="btn primary" type="button" data-pact="retry">Retry</button>'
    + '<button class="btn" type="button" data-close>Close</button></div>';
}

function who(a) { return a ? (a.kind === 'vendor' ? 'Vendor ' + a.name : a.name) : ''; }

export function detailSheet(d, ro) {
  const p = d.problem;
  let b = '<div class="statusbox ' + p.tone + '"><span class="bar ' + p.tone + '"></span><div><span class="st ' + p.tone + '">'
    + esc(p.label) + '</span><p>' + esc(p.why) + '</p></div></div>';
  b += '<dl class="pfacts"><dt>Status</dt><dd>' + esc(STATUS[p.status] || p.status) + '</dd>'
    + '<dt>' + (p.kind === 'MNT' ? 'Technician' : 'Assigned to') + '</dt><dd>'
    + (p.assignee ? esc(who(p.assignee)) : '<span class="st bad">Nobody</span>') + '</dd>'
    + '<dt>Due</dt><dd' + (p.overdue ? ' class="st bad"' : '') + '>' + esc(p.due ? (p.overdue ? 'Overdue since ' : '') + p.due : 'No date') + '</dd>'
    + (d.reportedBy ? '<dt>Reported by</dt><dd>' + esc(d.reportedBy) + '</dd>' : '')
    + (d.category ? '<dt>Category</dt><dd>' + esc(d.category) + '</dd>' : '') + '</dl>';
  if (d.description) b += '<div class="blk"><h3>Description</h3><p class="pdesc">' + esc(d.description) + '</p></div>';
  if (d.photos.length) {
    b += '<div class="blk"><h3>Photos</h3><div class="pphotos">' + d.photos.map((ph) => '<a href="' + esc(ph.url)
      + '" target="_blank" rel="noopener"><img src="' + esc(ph.url) + '" alt="' + esc(ph.label) + '" loading="lazy"><span>'
      + esc(ph.label) + '</span></a>').join('') + '</div></div>';
  } else if (d.photosError) {
    b += '<div class="blk"><h3>Photos</h3><div class="empty">' + esc(d.photosError) + '</div></div>';
  }
  if (d.mirror) {
    b += '<div class="note">Also tracked as team task <span class="mono">' + esc(d.mirror.ref) + '</span>'
      + (d.mirror.assignee ? ' (' + esc(d.mirror.assignee) + ')' : '') + '. It closes with this ticket.</div>';
  }
  b += '<div class="blk"><h3>Comments</h3>' + (d.comments.length ? '<ul class="pcomments">' + d.comments.map((c) =>
    '<li><b>' + esc(c.author) + '</b> <span class="mono t3">' + esc(when(c.at)) + '</span><p>' + esc(c.text) + '</p>'
    + (c.photo ? '<a href="' + esc(c.photo) + '" target="_blank" rel="noopener"><img src="' + esc(c.photo) + '" alt="Comment photo" loading="lazy"></a>' : '')
    + '</li>').join('') + '</ul>' : '<div class="empty">No comment yet.</div>');
  if (!ro) {
    b += '<label class="plabel" for="pComment">Comment, or note for Close</label>'
      + '<textarea id="pComment" class="ptext" rows="3" maxlength="2000"></textarea>'
      + '<div><button class="btn sm" type="button" data-pact="comment">Comment</button></div>';
  }
  b += '</div>';
  b += '<div class="blk"><h3>History</h3><ul class="phist">' + d.history.map((h) =>
    '<li><span class="mono">' + esc(when(h.at)) + '</span><span>' + esc(h.text) + '</span></li>').join('') + '</ul></div>';
  let f;
  if (ro) f = '<p class="ro-note" role="status">' + RO_LINE + '</p><button class="btn" type="button" data-close>Close</button>';
  else if (p.closed) f = '<button class="btn primary" type="button" data-pact="reopen">Reopen</button><button class="btn" type="button" data-close>Close</button>';
  else {
    f = '<button class="btn primary" type="button" data-pact="assign" aria-keyshortcuts="A">Assign</button>'
      + '<button class="btn" type="button" data-pact="schedule" aria-keyshortcuts="S">Schedule</button>'
      + '<button class="btn" type="button" data-pact="close" aria-keyshortcuts="C">Close problem</button>';
  }
  return head(p.ref, p.title, subLine(p)) + '<div class="sheet-b">' + b + '</div><div class="sheet-f">' + f + '</div>';
}

export function assignSheet(d, ro) {
  const p = d.problem;
  const cur = p.assignee;
  const people = d.assignees.filter((a) => p.kind === 'MNT' || a.takesTasks);
  let b;
  if (ro) b = '<p class="ro-note" role="status">' + RO_LINE + '</p>';
  else {
    b = '<div class="pick">' + people.map((a) => {
      const on = cur && cur.kind === 'member' && cur.id === a.id;
      return '<button type="button" data-pact="pick" data-id="' + a.id + '"' + (on ? ' aria-current="true"' : '') + '>'
        + '<span class="av" aria-hidden="true">' + esc(initials(a.name)) + '</span><span><b>' + esc(a.name) + '</b><small>'
        + esc(ROLE[a.role] || a.role) + '</small></span></button>';
    }).join('') + '</div>';
    if (p.kind === 'MNT' && d.vendors.length) {
      b += '<h3 class="psub">Or a vendor</h3><div class="pick">' + d.vendors.map((v) => {
        const on = cur && cur.kind === 'vendor' && cur.id === v.id;
        return '<button type="button" data-pact="vendor" data-id="' + v.id + '"' + (on ? ' aria-current="true"' : '') + '>'
          + '<span class="av" aria-hidden="true">' + esc(initials(v.name)) + '</span><span><b>' + esc(v.name) + '</b><small>'
          + esc(v.specialty || 'Vendor') + '</small></span></button>';
      }).join('') + '</div>';
    }
    if (cur) b += '<div><button class="btn sm" type="button" data-pact="unassign">Unassign</button></div>';
  }
  return head(p.ref, 'Assign ' + p.ref, p.title) + '<div class="sheet-b">' + b + '</div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-pact="back">Back</button></div>';
}

export function scheduleSheet(d, today, ro) {
  const p = d.problem;
  const opts = [['Today', today], ['Tomorrow', addDays(today, 1)], ['In 3 days', addDays(today, 3)], ['Next week', addDays(today, 7)]];
  let b;
  if (ro) b = '<p class="ro-note" role="status">' + RO_LINE + '</p>';
  else {
    b = '<div class="pdates">' + opts.map(([l, day]) => '<button class="btn" type="button" data-pact="date" data-date="' + day + '">'
      + esc(l) + ' <span class="mono">' + ddmm(day) + '</span></button>').join('') + '</div>'
      + '<label class="plabel" for="pDate">Another date</label><div class="pinline"><input id="pDate" type="date" min="' + today
      + '" max="' + addDays(today, 365) + '"><button class="btn" type="button" data-pact="date-input">Set date</button></div>'
      + (p.dueAt ? '<div><button class="btn sm" type="button" data-pact="clear-date">Remove the date</button></div>' : '');
  }
  return head(p.ref, 'Schedule ' + p.ref, p.title + (p.due ? ' · due ' + p.due : '')) + '<div class="sheet-b">' + b + '</div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-pact="back">Back</button></div>';
}
```

- [ ] **Step 6: Panel controller**

`manager/problem-panel.js`:

```js
// Fiche d'un probleme (MNT ou TSK) et ses gestes, partagee par Today et Problems.
// Lecture : mgr.problem.get. Gestes : mgr.problem.act, une cle d'idempotence par
// geste, jamais d'auteur envoye (le proxy le prend dans la session).
import { get, newIdem, post } from '/manager/api.js';
import { closeSheet, ddmm, dubaiToday, openSheet, sheetBusy, sheetError, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { assignSheet, detailSheet, errorSheet, loadingSheet, scheduleSheet } from '/manager/screens/problem-view.js';

const RO_LINE = 'Reconnect to make changes.';

export function createProblemPanel(opts) {
  const st = { busy: false, row: null, detail: null, view: 'detail', origin: 'detail', seq: 0 };
  const ro = () => !!opts.readOnly();

  // Probleme affiche dans le panneau (marqueur data-panel), null si le panneau montre autre chose.
  function shownRef() {
    const el = sheetIsOpen() ? document.querySelector('#sheet [data-panel]') : null;
    return el ? el.getAttribute('data-panel') : null;
  }
  const held = (ref) => shownRef() === ref;
  const cached = (ref) => (st.detail && st.detail.problem.ref === ref ? st.detail : null);

  function show(view) {
    st.view = view;
    if (view === 'assign') openSheet(assignSheet(st.detail, ro()));
    else if (view === 'schedule') openSheet(scheduleSheet(st.detail, dubaiToday(Date.now()), ro()));
    else openSheet(detailSheet(st.detail, ro()));
  }

  async function load(ref, view) {
    const mine = ++st.seq;
    st.view = view;
    if (!cached(ref) || !held(ref)) openSheet(loadingSheet(ref, st.row));
    try {
      const d = await get('mgr.problem.get', { ref });
      if (mine !== st.seq || !held(ref)) return;
      st.detail = d;
      show(view);
    } catch (e) {
      if (mine !== st.seq) return;
      if (opts.handleAccess(e)) return;
      if (held(ref)) openSheet(errorSheet(ref, st.row, e.message)); else toast(e.message);
    }
  }

  async function act(ref, verb, extra, done) {
    if (st.busy) { toast('Saving, wait a second.'); return; }
    if (ro()) { toast(RO_LINE); return; }
    st.busy = true;
    if (held(ref)) sheetBusy(true);
    try {
      await post('mgr.problem.act', { ref, verb, idem: newIdem(), ...extra });
    } catch (e) {
      st.busy = false;
      if (held(ref)) sheetBusy(false);
      if (opts.handleAccess(e)) return;
      if (held(ref)) sheetError(e.message); else toast(e.message);
      return;
    }
    st.busy = false;
    if (held(ref)) sheetBusy(false);
    done();
    opts.onChange();
  }

  // Apres Assign ou Schedule : retour a la fiche si on en venait, sinon le panneau se ferme.
  function edited(ref, msg) {
    toast(msg);
    if (!held(ref)) return;
    if (st.origin === 'quick') closeSheet(); else load(ref, 'detail');
  }
  function noteFor(ref) {
    const t = held(ref) ? document.getElementById('pComment') : null;
    return t ? t.value.trim() : '';
  }
  function close(ref, row) {
    if (row) st.row = row;
    const note = noteFor(ref);
    return act(ref, 'close', note ? { note } : {}, () => {
      if (held(ref)) closeSheet();
      toast(ref + ' closed', () => reopen(ref));
    });
  }
  function reopen(ref) {
    return act(ref, 'reopen', {}, () => {
      toast(ref + ' reopened');
      if (held(ref)) load(ref, 'detail');
    });
  }
  function quick(ref, row, view) {
    if (ro()) { toast(RO_LINE); return; }
    if (row) st.row = row;
    if (held(ref) && cached(ref)) { st.origin = 'detail'; show(view); return; }
    st.origin = 'quick';
    st.detail = null;
    load(ref, view);
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('#sheet [data-pact]') : null;
    const ref = el ? shownRef() : null;
    if (!el || !ref) return;
    const k = el.getAttribute('data-pact');
    if (k === 'retry') { load(ref, st.view); return; }
    if (k === 'back') { if (st.origin === 'quick') closeSheet(); else show('detail'); return; }
    const d = cached(ref);
    if (!d) return;
    if (k === 'assign' || k === 'schedule') { st.origin = 'detail'; show(k); return; }
    if (k === 'pick') {
      const id = Number(el.getAttribute('data-id'));
      const p = d.assignees.find((a) => a.id === id);
      act(ref, 'assign', { memberId: id }, () => edited(ref, ref + ' assigned to ' + (p ? p.name : 'Member ' + id)));
      return;
    }
    if (k === 'vendor') {
      const id = Number(el.getAttribute('data-id'));
      const v = d.vendors.find((x) => x.id === id);
      act(ref, 'assign', { vendorId: id }, () => edited(ref, ref + ' sent to ' + (v ? v.name : 'Vendor ' + id)));
      return;
    }
    if (k === 'unassign') { act(ref, 'assign', { unassign: true }, () => edited(ref, ref + ' unassigned')); return; }
    if (k === 'date' || k === 'date-input') {
      const inp = document.getElementById('pDate');
      const day = k === 'date' ? el.getAttribute('data-date') : (inp ? inp.value : '');
      if (!day) { sheetError('Choose a date.'); return; }
      act(ref, 'schedule', { date: day }, () => edited(ref, ref + ' due ' + ddmm(day)));
      return;
    }
    if (k === 'clear-date') { act(ref, 'schedule', { date: null }, () => edited(ref, ref + ' has no due date now')); return; }
    if (k === 'comment') {
      const text = noteFor(ref);
      if (!text) { sheetError('Write a comment first.'); return; }
      act(ref, 'comment', { text }, () => { toast('Comment added'); if (held(ref)) load(ref, 'detail'); });
      return;
    }
    if (k === 'close') { close(ref, st.row); return; }
    if (k === 'reopen') reopen(ref);
  }

  document.addEventListener('click', onClick);
  return {
    open(ref, row) { st.row = row || null; st.origin = 'detail'; st.detail = null; load(ref, 'detail'); },
    assign(ref, row) { quick(ref, row, 'assign'); },
    schedule(ref, row) { quick(ref, row, 'schedule'); },
    close(ref, row) { return close(ref, row); },
    current: shownRef,
    dispose() { document.removeEventListener('click', onClick); },
  };
}
```

- [ ] **Step 7: Styles and stylesheet link**

`manager/ui/problems.css`:

```css
/* Problems : fiche d'un probleme (spec 2026-10-09, sections 3 et 4). Tokens de tokens.css seulement. */
.pfacts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px var(--s4);margin:0}
.pfacts dt{color:var(--ink-3)}
.pfacts dd{margin:0;font-weight:500;overflow-wrap:anywhere}
.pdesc{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.pphotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:var(--s2)}
.pphotos a{display:flex;flex-direction:column;gap:2px;text-decoration:none;color:var(--ink-3);font-size:13px}
.pphotos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r-sm);background:var(--sunk)}
.pcomments,.phist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--s2)}
.pcomments p{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.pcomments img{max-width:160px;border-radius:var(--r-sm);margin-top:4px}
.phist li{display:grid;grid-template-columns:auto minmax(0,1fr);gap:var(--s3);font-size:15px}
.t3{color:var(--ink-3)}
.plabel{display:block;font-size:14px;color:var(--ink-2);margin-top:var(--s3)}
.ptext{width:100%;border:1px solid var(--line-2);border-radius:var(--r-md);background:var(--surface);color:var(--ink);font:inherit;font-size:16px;padding:var(--s2) var(--s3);margin:4px 0 var(--s2);resize:vertical}
.pdates{display:flex;flex-wrap:wrap;gap:var(--s2)}
.pinline{display:flex;gap:var(--s2);flex-wrap:wrap}
.pinline input{min-height:40px;border:1px solid var(--line-2);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:16px;padding:0 var(--s2)}
.psub{font-size:15px;margin:var(--s3) 0 var(--s2);color:var(--ink-2)}
```

In `manager/index.html`, after `<link rel="stylesheet" href="/manager/ui/today.css">`, add:

```html
<link rel="stylesheet" href="/manager/ui/problems.css">
```

- [ ] **Step 8: Today uses the panel**

In `manager/screens/today.js`, replace:

```js
import { arrivalSheet, boardHtml, jobSheet, pickerSheet, problemSheet } from '/manager/screens/today-view.js';
```

with:

```js
import { arrivalSheet, boardHtml, jobSheet, pickerSheet } from '/manager/screens/today-view.js';
import { createProblemPanel } from '/manager/problem-panel.js';
```

Replace:

```js
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) { st.sheetKey = null; openSheet(problemSheet(p)); }
```

with:

```js
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) { st.sheetKey = null; panel.open(p.ref, p); }
```

Replace:

```js
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  });
```

with:

```js
  // Fiche et gestes des problemes : meme panneau que l'ecran Problems.
  const panel = createProblemPanel({ readOnly, onChange: () => refresh(), handleAccess });
  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    panel.dispose();
  });
```

In `manager/screens/today-view.js`, replace:

```js
  h += '<div class="sec-foot"><span class="t3">' + c.inspectionFindingsOpen + ' inspection findings not turned into tickets. Cleaner reports open: '
    + c.cleanerReportsOpen + '.</span><a class="link" href="#/problems">All problems</a></div>';
```

with:

```js
  h += '<div class="sec-foot"><span class="t3">Including ' + c.inspectionTicketsOpen + ' from inspections and '
    + c.cleanerReportsOpen + ' cleaner reports.</span><a class="link" href="#/problems">All problems</a></div>';
```

and delete the whole `export function problemSheet(p) { ... }` function (6 lines).

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed (new spec plus phase 1 specs).

- [ ] **Step 10: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add manager/api.js manager/ui/dom.js manager/screens/problem-view.js manager/problem-panel.js manager/ui/problems.css manager/index.html manager/screens/today.js manager/screens/today-view.js tests/manager/problem-fixtures.ts tests/manager/today-problems.spec.ts tests/manager/helpers.ts tests/manager/fixtures.ts tests/manager/today.spec.ts
git commit -m "manager: fiche probleme partagee (photos, commentaires, historique, Assign, Schedule, Close avec Undo, Comment), branchee sur Today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Front: Problems screen (list, chips, search, apartment, pages, stale cache, nav badge)

**Files:**
- Modify: `manager/today-cache.js` (keyed cache)
- Create: `manager/screens/problems-view.js`
- Create: `manager/screens/problems.js`
- Modify: `manager/app.js` (screens map, nav badge)
- Modify: `manager/screens/today.js` (announce the badge)
- Modify: `manager/ui/problems.css` (append list styles)
- Modify: `manager/ui/components.css` (append `.nbadge`)
- Modify: `tests/manager/helpers.ts` (`storage` option)
- Modify: `tests/manager/shell.spec.ts` (Problems is no longer a placeholder)
- Create: `tests/manager/problems.spec.ts`

**Interfaces:**
- Consumes: Task 4 list response, Task 8 panel and helpers.
- Produces:
  - `today-cache.js`: `saveCache(key, data, savedAt)`, `loadCache(key, valid: (data) => boolean)`, `clearCache(key)`; `saveToday`, `loadToday`, `clearToday` unchanged in behaviour.
  - `problems.js`: `renderProblems(ctx)`, `queryOf(f, offset)`, `hasFilter(f)`, `PROBLEMS_CACHE = 'mgrProblemsCache'`, `PAGE = 50`.
  - DOM contract for Task 10: list container `#pList`, rows `button.prow[data-row][data-ref]`, search `#pSearch`, chips `#pChips` (`[data-chip=urgent|mine|unassigned]`, `[data-src=''|maintenance|inspection|cleaner|task]`, `[data-apt-open]`), apartment sheet buttons `[data-apt]`, `[data-more]`, `[data-clear]`, `[data-retry]`; in `renderProblems` the functions `paint()`, `refresh()`, `rowOf(ref)`, state `st.rows`, `st.focusRef`, the `panel` object and the listener block quoted in Task 10.
  - Nav: `a[href="#/problems"] .nbadge` shows the urgent count (hidden at 0, `99+` above 99).

- [ ] **Step 1: Test helper and failing tests**

In `tests/manager/helpers.ts`, change the `opts` type of `bootMgr` to add `storage?: Record<string, string>`:

```ts
  opts: { email?: boolean; pin?: string; hash?: string; timeoutMs?: number; cache?: { savedAt: number; data: any }; clock?: Date; storage?: Record<string, string> } = {},
```

inside the seeded block, after `if (cfg.cache) localStorage.setItem('mgrTodayCache', JSON.stringify(cfg.cache));`, add:

```ts
        if (cfg.storage) for (const k of Object.keys(cfg.storage)) localStorage.setItem(k, cfg.storage[k]);
```

and in the argument object passed to `addInitScript`, replace `cache: opts.cache || null, timeoutMs: opts.timeoutMs || 0,` with `cache: opts.cache || null, timeoutMs: opts.timeoutMs || 0, storage: opts.storage || null,`.

In `tests/manager/shell.spec.ts`, delete the line `  ['problems', 'Problems', '/?legacy=1'],` from `LINKS`.

`tests/manager/problems.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { NOW, todayBody } from './fixtures';
import { detailBody, listBody, manyRows, ROW } from './problem-fixtures';

const LIST = (body: any = listBody()) => ({ match: 'action=mgr.problems', status: 200, body });
const lists = async (page: any) => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problems')).map((l) => l.url);
const navOf = (page: any, info: any) => (info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar'));

test('liste de tri : ordre du serveur, ref en Fragment Mono, logement, source, echeance ; pastille des urgents', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), LIST()], { email: true, clock: NOW, hash: '#/problems' });
  const rows = page.locator('.prow');
  await expect(rows).toHaveCount(3);
  await expect(rows.locator('.pref')).toHaveText(['MNT-429', 'TSK-13', 'MNT-501']);
  expect(await rows.first().locator('.pref').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Fragment Mono');
  await expect(rows.nth(0)).toContainText('Apt 308 · Binghatti Lavender');
  await expect(rows.nth(0)).toContainText('Unassigned');
  await expect(rows.nth(1)).toContainText('Overdue 15/05');
  await expect(rows.nth(2)).toContainText('Inspection');
  await expect(rows.nth(2)).toContainText('Due 12/10');
  await expect(navOf(page, info).locator('a[href="#/problems"] .nbadge')).toHaveText('2');
  const u = (await lists(page))[0];
  expect(u).toContain('offset=0');
  expect(u).toContain('limit=50');
});

test('Today annonce le nombre d urgents dans la navigation', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 200, body: todayBody() }], { email: true, clock: NOW });
  await expect(navOf(page, info).locator('a[href="#/problems"] .nbadge')).toHaveText('21');
});

test('puces : Urgent, source, logement ; chaque changement relit la liste avec ses filtres', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST()], { email: true, clock: NOW, hash: '#/problems' });
  await expect(page.locator('.prow')).toHaveCount(3);
  await page.locator('#pChips [data-chip="urgent"]').click();
  await expect(page.locator('#pChips [data-chip="urgent"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pChips [data-src="task"]').click();
  await page.locator('#pChips [data-apt-open]').click();
  await expect(page.locator('#sheet')).toContainText('Apartments with open problems');
  await page.locator('#sheet [data-apt="L1"]').click();
  await expect.poll(async () => (await lists(page)).pop() || '').toContain('listingId=L1');
  const u = (await lists(page)).pop()!;
  expect(u).toContain('urgent=1');
  expect(u).toContain('source=task');
  expect(u).not.toContain('mine=1');
  await expect(page.locator('#pChips [data-apt-open]')).toHaveText('Apt 308 · Binghatti Lavender');
});

test('recherche : une seule lecture apres la frappe, q dans la requete, Clear filters', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...LIST(), once: true }, LIST(listBody({ rows: [], total: 0 }))], { email: true, clock: NOW, hash: '#/problems' });
  await expect(page.locator('.prow')).toHaveCount(3);
  await page.locator('#pSearch').pressSequentially('gas', { delay: 30 });
  await expect(page.locator('#pList')).toContainText('Nothing matches these filters.');
  const l = await lists(page);
  expect(l.length).toBe(2);
  expect(l[1]).toContain('q=gas');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('#pSearch')).toHaveValue('');
});

test('pages de 50 : Load more demande offset=50 et ajoute a la suite', async ({ page }) => {
  const first = listBody({ rows: manyRows(50, 1000), total: 60 });
  const second = listBody({ rows: manyRows(10, 1050), total: 60, offset: 50 });
  await bootMgr(page, [me(MANAGER), { match: 'offset=50', status: 200, body: second }, LIST(first)], { email: true, clock: NOW, hash: '#/problems' });
  await expect(page.locator('.prow')).toHaveCount(50);
  await expect(page.locator('.pfoot')).toContainText('50 of 60');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.locator('.prow')).toHaveCount(60);
  await expect(page.locator('.prow').last().locator('.pref')).toHaveText('MNT-1059');
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
});

test('reseau coupe avec la derniere liste en cache : bandeau Data from, lecture seule', async ({ page }) => {
  const cache = JSON.stringify({ v: 1, owner: 'u-test', savedAt: Date.parse('2026-10-09T05:42:00Z'), data: listBody() });
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.problems', status: 0, body: null, fail: true },
    { match: 'action=mgr.problem.get', status: 200, body: detailBody() }],
  { email: true, clock: NOW, hash: '#/problems', storage: { mgrProblemsCache: cache } });
  await expect(page.locator('.banner.warn')).toContainText('Data from 09:42. No connection. Try again.');
  await expect(page.locator('.prow')).toHaveCount(3);
  await page.locator('.prow').first().click();
  await expect(page.locator('#sheet .ro-note')).toHaveText('Reconnect to make changes.');
});

test('rien d ouvert : message simple, sans bouton', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), LIST(listBody({ rows: [], total: 0 }))], { email: true, clock: NOW, hash: '#/problems' });
  await expect(page.locator('#pList')).toContainText('Nothing open.');
  await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('aucun defilement horizontal, titres longs (' + scheme + ')', async ({ page }) => {
      const long = listBody({ rows: [ROW({ title: 'Water leaking under the kitchen sink near the dishwasher '.repeat(3) }), ...listBody().rows.slice(1)] });
      await bootMgr(page, [me(MANAGER), LIST(long)], { email: true, clock: NOW, hash: '#/problems' });
      await expect(page.locator('.prow')).toHaveCount(3);
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && npx playwright test tests/manager/problems.spec.ts --project=mgr-desktop`
Expected: FAIL (Problems is still the placeholder, no `.prow`).

- [ ] **Step 3: Keyed cache**

Replace the whole content of `manager/today-cache.js` with:

```js
// Dernieres donnees recues (Today, liste Problems), gardees sur l'appareil avec
// leur heure et leur proprietaire (spec section 7) : jamais d'ecran blanc quand le
// reseau ou le proxy tombe, jamais les donnees d'un autre compte sur un appareil
// partage. Lecture seule.
const KEY = 'mgrTodayCache';

// Proprietaire = utilisateur de la session email stockee par supabase-js
// (hkAuthSession). Une session stale la garde aussi (refresh token). Inconnu
// (PIN seul, stockage vide) : null, et le cache n'est alors jamais montre.
export function currentOwner() {
  try {
    const s = JSON.parse(localStorage.getItem('hkAuthSession') || 'null');
    const u = s && s.user;
    const id = u && (u.id || u.email);
    return id ? String(id) : null;
  } catch (e) { return null; }
}

export function saveCache(key, data, savedAt) {
  const owner = currentOwner();
  if (!owner) return;
  try { localStorage.setItem(key, JSON.stringify({ v: 1, savedAt, owner, data })); } catch (e) { /* quota ou stockage bloque */ }
}
export function clearCache(key) {
  try { localStorage.removeItem(key); } catch (e) { /* stockage bloque */ }
}
export function loadCache(key, valid) {
  try {
    const o = JSON.parse(localStorage.getItem(key) || 'null');
    if (!o || o.v !== 1 || typeof o.savedAt !== 'number' || !o.data || !valid(o.data)) return null;
    const owner = currentOwner();
    return owner && o.owner === owner ? o : null;
  } catch (e) { return null; }
}

export function saveToday(data, savedAt) { saveCache(KEY, data, savedAt); }
export function clearToday() { clearCache(KEY); }
export function loadToday() { return loadCache(KEY, (d) => !!(d.who && d.arrivals)); }
```

- [ ] **Step 4: List views**

`manager/screens/problems-view.js`:

```js
// Ecran Problems : HTML pur (en-tete, puces, lignes, choix du logement). Aucun appel reseau.
import { esc, I, placeLabel } from '/manager/ui/dom.js';

export const SOURCES = [['', 'All'], ['maintenance', 'Maintenance'], ['inspection', 'Inspection'], ['cleaner', 'Cleaner report'], ['task', 'Team task']];

export function problemsShell() {
  return '<header class="top"><div><h1>Problems</h1><div class="asof" id="pAsof" hidden></div></div>'
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></header>'
    + '<div class="psearch"><label class="sr" for="pSearch">Search problems</label>'
    + '<input id="pSearch" type="search" placeholder="Search ref, apartment, title or person" autocomplete="off" aria-keyshortcuts="/"></div>'
    + '<div id="pBanner"></div><div id="pChips" class="pchips"></div><div id="pList"></div>';
}

export function chipsHtml(data, f) {
  const c = data.counts;
  const chip = (key, label, n) => '<button class="chip" type="button" data-chip="' + key + '" aria-pressed="' + (f[key] ? 'true' : 'false') + '">'
    + esc(label) + ' <span class="tnum">' + n + '</span></button>';
  const apt = f.listingId ? data.apartments.find((a) => a.listingId === f.listingId) : null;
  let h = '<div class="chiprow" role="group" aria-label="Filters">' + chip('urgent', 'Urgent', c.urgent) + chip('mine', 'Mine', c.mine)
    + chip('unassigned', 'Unassigned', c.unassigned)
    + '<button class="chip" type="button" data-apt-open aria-pressed="' + (f.listingId ? 'true' : 'false') + '">'
    + esc(apt ? placeLabel(apt) : 'Apartment') + '</button></div>';
  h += '<div class="chiprow" role="group" aria-label="Source">' + SOURCES.map(([k, label]) => {
    const n = k ? c.bySource[label] : c.open;
    return '<button class="chip" type="button" data-src="' + k + '" aria-pressed="' + ((f.source || '') === k ? 'true' : 'false') + '">'
      + esc(label) + ' <span class="tnum">' + n + '</span></button>';
  }).join('') + '</div>';
  return h;
}

function sideDue(r) {
  if (r.overdue) return '<span class="pdue bad">Overdue ' + esc(r.due) + '</span>';
  if (r.due) return '<span class="pdue">Due ' + esc(r.due) + '</span>';
  return '<span class="pdue t3">Since ' + esc(r.since) + '</span>';
}
export function rowHtml(r) {
  const who = r.assignee ? (r.assignee.kind === 'vendor' ? 'Vendor ' : '') + r.assignee.name : 'Unassigned';
  return '<button class="prow" type="button" data-row data-ref="' + esc(r.ref) + '" aria-keyshortcuts="Enter A S C">'
    + '<span class="bar ' + r.tone + '"></span>'
    + '<span class="pmain"><span class="pl1"><span class="mono pref">' + esc(r.ref) + '</span><span class="pill ' + r.tone + '">'
    + esc(r.label) + '</span><span class="psrc">' + esc(r.source) + '</span></span>'
    + '<span class="pttl">' + esc(r.title) + '</span>'
    + (r.apt || r.bld ? '<span class="pwhere">' + esc(placeLabel(r)) + '</span>' : '') + '</span>'
    + '<span class="pside"><span class="pwho' + (r.assignee ? '' : ' none') + '">' + esc(who) + '</span>' + sideDue(r) + '</span></button>';
}

export function listHtml(st, filtered) {
  if (!st.data) {
    if (st.error) {
      return '<div class="err-card" role="alert"><p>' + esc(st.error.message) + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>';
    }
    return '<p class="boot" role="status">Loading problems…</p>';
  }
  if (!st.rows.length) {
    return '<div class="ph"><p>' + (filtered ? 'Nothing matches these filters.' : 'Nothing open.') + '</p>'
      + (filtered ? '<button class="btn" type="button" data-clear>Clear filters</button>' : '') + '</div>';
  }
  const more = st.rows.length < st.data.total;
  return '<section class="card plist" aria-label="Problems">' + st.rows.map(rowHtml).join('') + '</section>'
    + '<div class="pfoot"><span class="t3 tnum">' + st.rows.length + ' of ' + st.data.total + '</span>'
    + (more ? '<button class="btn" type="button" data-more' + (st.more ? ' disabled' : '') + '>' + (st.more ? 'Loading…' : 'Load more') + '</button>' : '')
    + '</div>';
}

export function apartmentSheet(apts, current) {
  return '<div class="sheet-h"><div><h2 id="sheetTitle">Apartment</h2><div class="sub">Apartments with open problems</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>'
    + '<div class="sheet-b"><div class="pick"><button type="button" data-apt=""' + (!current ? ' aria-current="true"' : '') + '><span><b>All apartments</b></span></button>'
    + apts.map((a) => '<button type="button" data-apt="' + esc(a.listingId) + '"' + (current === a.listingId ? ' aria-current="true"' : '') + '><span><b>'
      + esc(placeLabel(a)) + '</b><small>' + a.n + ' open</small></span></button>').join('')
    + '</div></div><div class="sheet-f"><button class="btn" type="button" data-close>Cancel</button></div>';
}
```

- [ ] **Step 5: Screen controller**

`manager/screens/problems.js`:

```js
// Ecran Problems (spec 2026-10-09, sections 3 et 4) : une boite de tri pour les
// tickets (maintenance, inspections, signalements cleaner) et les taches d'equipe.
// Puces de filtre, recherche, pages de 50, fiche et gestes partages avec Today.
import { get } from '/manager/api.js';
import { clearCache, loadCache, saveCache } from '/manager/today-cache.js';
import { announceBadge, closeSheet, dubaiTime, dubaiToday, esc, openSheet, toast } from '/manager/ui/dom.js';
import { createProblemPanel } from '/manager/problem-panel.js';
import { apartmentSheet, chipsHtml, listHtml, problemsShell } from '/manager/screens/problems-view.js';

export const PROBLEMS_CACHE = 'mgrProblemsCache';
export const PAGE = 50;
const SEARCH_DELAY_MS = 250;
const NO_FILTER = { urgent: false, mine: false, unassigned: false, listingId: null, source: null, q: '' };

export function queryOf(f, offset) {
  const p = { offset: String(offset), limit: String(PAGE) };
  if (f.urgent) p.urgent = '1';
  if (f.mine) p.mine = '1';
  if (f.unassigned) p.unassigned = '1';
  if (f.listingId) p.listingId = f.listingId;
  if (f.source) p.source = f.source;
  if (f.q) p.q = f.q;
  return p;
}
export function hasFilter(f) { return !!(f.urgent || f.mine || f.unassigned || f.listingId || f.source || f.q); }

export async function renderProblems(ctx) {
  const main = ctx.main;
  const st = { data: null, rows: [], fresh: false, loading: true, error: null, savedAt: 0, f: { ...NO_FILTER }, seq: 0, more: false, typing: null, focusRef: null };
  const cached = loadCache(PROBLEMS_CACHE, (d) => Array.isArray(d.rows) && !!d.counts);
  if (cached && (!ctx.me || (cached.data.me && cached.data.me.id === ctx.me.id))) {
    st.data = cached.data;
    st.rows = cached.data.rows;
    st.savedAt = cached.savedAt;
  }

  // Donnees en cache, en echec, ou d'un autre jour : aucune ecriture possible.
  function readOnly() { return !st.fresh || !st.data || st.data.day !== dubaiToday(Date.now()); }
  function handleAccess(e) {
    if (e.kind === 'auth' || e.kind === 'forbidden') clearCache(PROBLEMS_CACHE);
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }
  const panel = createProblemPanel({ readOnly, onChange: () => refresh(), handleAccess });

  main.innerHTML = problemsShell();
  const $ = (id) => document.getElementById(id);
  const search = $('pSearch');

  function banner() {
    if (!st.data) return '';
    let h = '';
    if (!st.fresh) {
      const when = dubaiTime(new Date(st.savedAt).toISOString());
      const note = st.data.day !== dubaiToday(Date.now()) ? ' Not today\'s data.' : '';
      if (st.error) {
        h += '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message) + esc(note)
          + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
      } else if (st.loading) {
        h += '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.' + esc(note) + '</span></div>';
      }
    }
    if (st.fresh && st.data.bookingsUnavailable) {
      h += '<div class="banner warn" role="status"><span>Bookings are unavailable right now, so today\'s arrivals do not move problems up the list.</span></div>';
    }
    return h;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    const asof = $('pAsof');
    asof.hidden = !st.data;
    asof.textContent = st.data ? 'Data as of ' + dubaiTime(st.data.generatedAt) : '';
    asof.classList.toggle('stale', !!st.data && !st.fresh);
    $('pBanner').innerHTML = banner();
    $('pChips').innerHTML = st.data ? chipsHtml(st.data, st.f) : '';
    $('pList').innerHTML = listHtml(st, hasFilter(st.f));
  }

  async function refresh() {
    const mine = ++st.seq;
    st.loading = true;
    st.error = null;
    paint();
    const f = { ...st.f };
    try {
      const d = await get('mgr.problems', queryOf(f, 0));
      if (mine !== st.seq) return;
      st.data = d;
      st.rows = d.rows;
      st.fresh = true;
      st.savedAt = Date.now();
      if (!hasFilter(f)) saveCache(PROBLEMS_CACHE, d, st.savedAt);
      announceBadge(d.counts.urgent);
    } catch (e) {
      if (mine !== st.seq) return;
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    paint();
  }

  async function loadMore() {
    if (st.more || !st.data) return;
    const mine = st.seq;
    st.more = true;
    paint();
    try {
      const d = await get('mgr.problems', queryOf(st.f, st.rows.length));
      if (mine === st.seq) {
        st.rows = st.rows.concat(d.rows);
        st.data = { ...d, rows: st.rows };
      }
    } catch (e) {
      if (!handleAccess(e)) toast(e.message);
    }
    st.more = false;
    paint();
  }

  function rowOf(ref) { return st.rows.find((r) => r.ref === ref) || null; }
  function setFilter(fn) { fn(st.f); refresh(); }

  function onClick(e) {
    const el = e.target && e.target.closest
      ? e.target.closest('[data-chip],[data-src],[data-apt-open],[data-apt],[data-more],[data-retry],[data-clear],[data-row]') : null;
    if (!el || !ctx.isCurrent()) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (el.hasAttribute('data-more')) { loadMore(); return; }
    if (el.hasAttribute('data-clear')) { search.value = ''; setFilter((f) => Object.assign(f, NO_FILTER)); return; }
    if (el.hasAttribute('data-chip')) {
      const k = el.getAttribute('data-chip');
      if (k === 'urgent' || k === 'mine' || k === 'unassigned') setFilter((f) => { f[k] = !f[k]; });
      return;
    }
    if (el.hasAttribute('data-src')) { const v = el.getAttribute('data-src') || null; setFilter((f) => { f.source = v; }); return; }
    if (el.hasAttribute('data-apt-open')) { if (st.data) openSheet(apartmentSheet(st.data.apartments, st.f.listingId)); return; }
    if (el.hasAttribute('data-apt')) { const v = el.getAttribute('data-apt') || null; closeSheet(); setFilter((f) => { f.listingId = v; }); return; }
    const ref = el.getAttribute('data-ref');
    st.focusRef = ref;
    panel.open(ref, rowOf(ref));
  }

  function onInput() {
    clearTimeout(st.typing);
    st.typing = setTimeout(() => {
      const q = search.value.trim();
      if (q === st.f.q) return;
      st.f.q = q;
      refresh();
    }, SEARCH_DELAY_MS);
  }

  document.addEventListener('click', onClick);
  search.addEventListener('input', onInput);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    search.removeEventListener('input', onInput);
    clearTimeout(st.typing);
    panel.dispose();
  });
  await refresh();
}
```

- [ ] **Step 6: Shell route and nav badge**

In `manager/app.js`:

Replace:

```js
const main = document.getElementById('main');
let me = null;
```

with:

```js
// Ecrans livres : module et fonction de rendu. Les autres restent provisoires.
const SCREENS = {
  today: ['/manager/screens/today.js', 'renderToday'],
  problems: ['/manager/screens/problems.js', 'renderProblems'],
};
const main = document.getElementById('main');
let me = null;
// Problemes urgents ouverts, annonces par Today et Problems (evenement mgr:badge).
let urgent = 0;
```

Replace the body of `renderNav`:

```js
function renderNav(view) {
  const link = (cls, v, inner) => '<a class="' + cls + '" href="#/' + v.id + '"' + (view === v.id ? ' aria-current="page"' : '') + '>' + inner + '</a>';
  document.getElementById('sideNav').innerHTML = VIEWS.map((v) => link('navlink', v, I[v.id] + '<span>' + v.label + '</span>')).join('');
  document.getElementById('tabbar').innerHTML = VIEWS.map((v) => link('tab', v, '<span class="tab-wrap">' + I[v.id] + '</span>' + v.label)).join('');
  document.getElementById('sideFoot').textContent = me ? 'Signed in as ' + me.name : 'Offline';
}
```

with:

```js
function badge(id) {
  if (id !== 'problems' || urgent <= 0) return '';
  return '<span class="nbadge" aria-label="' + urgent + ' urgent">' + (urgent > 99 ? '99+' : urgent) + '</span>';
}

function renderNav(view) {
  const link = (cls, v, inner) => '<a class="' + cls + '" href="#/' + v.id + '"' + (view === v.id ? ' aria-current="page"' : '') + '>' + inner + '</a>';
  document.getElementById('sideNav').innerHTML = VIEWS.map((v) => link('navlink', v, I[v.id] + '<span>' + v.label + '</span>' + badge(v.id))).join('');
  document.getElementById('tabbar').innerHTML = VIEWS.map((v) => link('tab', v, '<span class="tab-wrap">' + I[v.id] + badge(v.id) + '</span>' + v.label)).join('');
  document.getElementById('sideFoot').textContent = me ? 'Signed in as ' + me.name : 'Offline';
}
```

Replace in `route()`:

```js
  if (view === 'today') {
    let mod = null;
    try { mod = await import('/manager/screens/today.js'); } catch (e) { mod = null; }
    if (mine !== seq) return;
    if (mod && typeof mod.renderToday === 'function') { await mod.renderToday(ctx); return; }
  }
```

with:

```js
  const screen = SCREENS[view];
  if (screen) {
    let mod = null;
    try { mod = await import(screen[0]); } catch (e) { mod = null; }
    if (mine !== seq) return;
    if (mod && typeof mod[screen[1]] === 'function') { await mod[screen[1]](ctx); return; }
  }
```

Replace `startShell`:

```js
function startShell() {
  if (!listening) { listening = true; window.addEventListener('hashchange', route); }
  return route();
}
```

with:

```js
function startShell() {
  if (!listening) {
    listening = true;
    window.addEventListener('hashchange', route);
    document.addEventListener('mgr:badge', (e) => {
      const n = Math.max(0, Number(e.detail && e.detail.problems) || 0);
      if (n === urgent) return;
      urgent = n;
      renderNav(currentView());
    });
  }
  return route();
}
```

In `manager/screens/today.js`, add `announceBadge` to the `dom.js` import:

```js
import { announceBadge, closeSheet, dubaiTime, esc, openSheet, placeLabel, sheetIsOpen, toast } from '/manager/ui/dom.js';
```

and in `refresh()`, replace `      saveToday(d, st.savedAt);` with:

```js
      saveToday(d, st.savedAt);
      announceBadge(d.problems.counts.urgent);
```

- [ ] **Step 7: Styles**

Append to `manager/ui/components.css`:

```css
/* Pastille des problemes urgents dans la navigation. */
.nbadge{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--bad);color:var(--surface);font-size:12px;font-weight:700;font-variant-numeric:tabular-nums;margin-left:auto}
.tab .nbadge{position:absolute;top:-6px;right:-14px;margin:0}
```

Append to `manager/ui/problems.css`:

```css
/* Liste de tri (Linear) : une ligne par probleme, ref en Fragment Mono, ton de priorite. */
.asof[hidden]{display:none}
.psearch{margin:0 0 var(--s3)}
.psearch input{width:100%;min-height:44px;border:1px solid var(--line-2);border-radius:12px;background:var(--surface);color:var(--ink);font:inherit;font-size:16px;padding:0 var(--s3)}
.pchips{display:flex;flex-direction:column;gap:var(--s2);margin-bottom:var(--s3);min-width:0}
.chiprow{display:flex;gap:var(--s2);overflow-x:auto;scrollbar-width:none;padding-bottom:2px;min-width:0}
.chiprow::-webkit-scrollbar{display:none}
.chip{flex:none;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink-2);font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.chip[aria-pressed="true"]{background:var(--accent-tint);border-color:var(--accent);color:var(--accent)}
.plist{display:block}
.prow{display:grid;grid-template-columns:4px minmax(0,1fr);gap:var(--s1) var(--s3);width:100%;padding:var(--s3) var(--s4);border:0;border-top:1px solid var(--line);background:var(--surface);text-align:left;cursor:pointer;font:inherit;color:inherit;touch-action:pan-y;transition:transform .2s var(--ease-out),background-color .15s var(--ease-out)}
.prow:first-child{border-top:0}
.prow:hover,.prow:focus-visible{background:var(--surface-2)}
.prow .bar{grid-row:span 2}
.pmain{min-width:0;display:flex;flex-direction:column;gap:2px}
.pl1{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;font-size:14px;color:var(--ink-3)}
.pref{color:var(--ink-2)}
.pttl{font-weight:600;font-size:17px;line-height:1.3;overflow-wrap:anywhere}
.pwhere{font-size:15px;color:var(--ink-2)}
.pside{display:flex;gap:var(--s3);font-size:14px;color:var(--ink-2);flex-wrap:wrap;min-width:0}
.pwho.none{color:var(--bad-ink)}
.pdue.bad{color:var(--bad-ink);font-weight:600}
.pfoot{display:flex;align-items:center;justify-content:space-between;gap:var(--s3);padding:var(--s3) 0}
@media (min-width:960px){
  .prow{grid-template-columns:4px minmax(0,1fr) 220px;align-items:center}
  .prow .bar{grid-row:auto}
  .pside{flex-direction:column;align-items:flex-end;gap:2px}
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed.

- [ ] **Step 9: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add manager/today-cache.js manager/screens/problems-view.js manager/screens/problems.js manager/app.js manager/screens/today.js manager/ui/problems.css manager/ui/components.css tests/manager/helpers.ts tests/manager/shell.spec.ts tests/manager/problems.spec.ts
git commit -m "manager: ecran Problems (liste de tri, puces Urgent/Mine/Unassigned/logement/source, recherche, pages, cache lecture seule, pastille des urgents)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Front: keyboard triage on desktop, swipe on phone

**Files:**
- Create: `manager/ui/swipe.js`
- Modify: `manager/screens/problems.js` (imports, `paint`, keyboard, swipe, listener block)
- Modify: `manager/ui/problems.css` (append swipe states)
- Create: `tests/manager/problems-keys.spec.ts`

**Interfaces:**
- Consumes: Task 9 DOM contract and `renderProblems` internals, Task 8 panel (`open`, `assign`, `schedule`, `close`, `current`), `sheetIsOpen` (`dom.js`).
- Produces: `swipe.js`: `SWIPE_MIN_PX = 80`, `EDGE_PX = 24`, `swipeIntent(dx, dy, startX, width): 'close' | 'assign' | null`, `attachSwipe(root, { enabled: () => boolean, onSwipe: (ref, intent) => void }): () => void`. Keys: `j`/`ArrowDown` next row, `k`/`ArrowUp` previous, `Enter` opens (native button), `a` Assign, `s` Schedule, `c` Close (with Undo), `Escape` closes the panel (existing `initSheet`), `/` focuses search; ignored while typing or with a modifier.

- [ ] **Step 1: Write the failing test**

`tests/manager/problems-keys.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW } from './fixtures';
import { ACT_OK, detailBody, detailTsk, listBody } from './problem-fixtures';

const ROUTES = () => [
  me(MANAGER),
  { match: 'action=mgr.problems', status: 200, body: listBody() },
  { match: 'ref=TSK-13', status: 200, body: detailTsk() },
  { match: 'action=mgr.problem.get', status: 200, body: detailBody() },
  { match: 'action=mgr.problem.act', status: 200, body: ACT_OK() },
];
const acts = async (page: any) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.problem.act')).map((l) => JSON.parse(l.body));

test('clavier : j/k et fleches, Entree, Echap, A, S, C avec Undo, / pour chercher', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-desktop', 'clavier : ordinateur');
  await bootMgr(page, ROUTES(), { email: true, clock: NOW, hash: '#/problems' });
  const rows = page.locator('.prow');
  await expect(rows).toHaveCount(3);
  await page.keyboard.press('j');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('j');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press('k');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('Enter');
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(rows.nth(0)).toBeFocused();
  await page.keyboard.press('a');
  await expect(sheet.getByRole('heading', { name: 'Assign MNT-429' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('s');
  await expect(sheet.getByRole('heading', { name: 'Schedule MNT-429' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await acts(page)).map((a) => a.verb)).toEqual(['close', 'reopen']);
  await page.keyboard.press('/');
  await expect(page.locator('#pSearch')).toBeFocused();
  await page.keyboard.type('cas');
  await page.waitForTimeout(400);
  expect((await acts(page)).length).toBe(2);
});

test('clavier dans la fiche ouverte : C ferme ce probleme-la', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-desktop', 'clavier : ordinateur');
  await bootMgr(page, ROUTES(), { email: true, clock: NOW, hash: '#/problems' });
  await page.locator('.prow').nth(1).click();
  await expect(page.locator('#sheet').getByRole('heading', { name: 'AC not cooling' })).toBeVisible();
  await page.locator('#sheet .sheet-h').click();
  await page.keyboard.press('c');
  await expect(page.locator('#toast')).toContainText('TSK-13 closed');
  expect((await acts(page)).map((a) => [a.ref, a.verb])).toEqual([['TSK-13', 'close']]);
});

async function swipe(page: any, nth: number, dx: number, o: { startX?: number; tap?: boolean; dy?: number } = {}) {
  await page.locator('.prow').nth(nth).evaluate((el: Element, a: any) => {
    const r = el.getBoundingClientRect();
    const x0 = a.startX ?? r.left + r.width / 2;
    const y0 = r.top + r.height / 2;
    const ev = (type: string, x: number, y: number) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y,
    }));
    ev('pointerdown', x0, y0);
    for (let i = 1; i <= 6; i++) ev('pointermove', x0 + (a.dx * i) / 6, y0 + ((a.dy || 0) * i) / 6);
    ev('pointerup', x0 + a.dx, y0 + (a.dy || 0));
    if (a.tap) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x0 + a.dx, clientY: y0 }));
  }, { dx, ...o });
}

test('glisser : gauche ferme avec Undo, droite ouvre Assign ; court, vertical ou depuis le bord : rien', async ({ page }, info) => {
  test.skip(info.project.name !== 'mgr-mobile', 'glisser : telephone');
  await bootMgr(page, ROUTES(), { email: true, clock: NOW, hash: '#/problems' });
  await expect(page.locator('.prow')).toHaveCount(3);
  const intent = await page.evaluate(async () => {
    const m = await import('/manager/ui/swipe.js');
    return [m.swipeIntent(-100, -80, 200, 390), m.swipeIntent(-100, 10, 10, 390), m.swipeIntent(-40, 0, 200, 390), m.swipeIntent(-100, 10, 200, 390), m.swipeIntent(100, 10, 200, 390)];
  });
  expect(intent).toEqual([null, null, null, 'close', 'assign']);
  await swipe(page, 0, -40);
  await swipe(page, 0, -150, { startX: 10 });
  await swipe(page, 0, -120, { dy: 200 });
  expect((await acts(page)).length).toBe(0);
  await swipe(page, 0, -150, { tap: true });
  await expect(page.locator('#toast')).toContainText('MNT-429 closed');
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'true');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await acts(page)).map((a) => a.verb)).toEqual(['close', 'reopen']);
  await swipe(page, 1, 150, { tap: true });
  await expect(page.locator('#sheet').getByRole('heading', { name: 'Assign TSK-13' })).toBeVisible();
  expect((await acts(page)).length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && npx playwright test tests/manager/problems-keys.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (`j` does nothing, `/manager/ui/swipe.js` missing).

- [ ] **Step 3: Swipe module**

`manager/ui/swipe.js`:

```js
// Glisser une ligne sur telephone (spec section 3) : gauche = Close (Undo dans le
// toast), droite = Assign (ouvre le choix ; rien n'est ecrit sans un second geste).
// Le geste ne part qu'au-dela de SWIPE_MIN_PX, nettement horizontal, et jamais
// depuis les bords de l'ecran (geste retour d'iOS et d'Android). Le clic que le
// navigateur envoie apres un geste est absorbe : il n'ouvre pas la fiche.
export const SWIPE_MIN_PX = 80;
export const EDGE_PX = 24;
const MUTE_MS = 400;

export function swipeIntent(dx, dy, startX, width) {
  if (startX < EDGE_PX || startX > width - EDGE_PX) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < 2 * Math.abs(dy)) return null;
  return dx < 0 ? 'close' : 'assign';
}

export function attachSwipe(root, opts) {
  let g = null;
  let mute = false;
  let muteTimer = null;
  function stop() {
    if (g) {
      g.el.style.transform = '';
      g.el.classList.remove('swiping', 'swipe-close', 'swipe-assign');
    }
    g = null;
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', stop);
  }
  function down(e) {
    if (!opts.enabled() || e.isPrimary === false) return;
    const el = e.target && e.target.closest ? e.target.closest('[data-row]') : null;
    if (!el || !root.contains(el)) return;
    stop();
    g = { el, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', stop);
  }
  function move(e) {
    if (!g || e.pointerId !== g.id) return;
    g.dx = e.clientX - g.x;
    g.dy = e.clientY - g.y;
    if (Math.abs(g.dx) > 8 && Math.abs(g.dx) > 2 * Math.abs(g.dy)) {
      g.el.classList.add('swiping');
      g.el.classList.toggle('swipe-close', g.dx < 0);
      g.el.classList.toggle('swipe-assign', g.dx > 0);
      g.el.style.transform = 'translateX(' + Math.round(g.dx) + 'px)';
    }
  }
  function up(e) {
    if (!g || e.pointerId !== g.id) return;
    const intent = swipeIntent(g.dx, g.dy, g.x, window.innerWidth);
    const ref = g.el.getAttribute('data-ref');
    stop();
    if (!intent) return;
    mute = true;
    clearTimeout(muteTimer);
    muteTimer = setTimeout(() => { mute = false; }, MUTE_MS);
    opts.onSwipe(ref, intent);
  }
  function click(e) {
    if (!mute) return;
    mute = false;
    e.preventDefault();
    e.stopPropagation();
  }
  root.addEventListener('pointerdown', down);
  root.addEventListener('click', click, true);
  return () => {
    stop();
    clearTimeout(muteTimer);
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('click', click, true);
  };
}
```

- [ ] **Step 4: Wire keyboard and swipe into `problems.js`**

Replace the `dom.js` import line with:

```js
import { announceBadge, closeSheet, dubaiTime, dubaiToday, esc, openSheet, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { attachSwipe } from '/manager/ui/swipe.js';
```

In `paint()`, replace:

```js
    $('pList').innerHTML = listHtml(st, hasFilter(st.f));
  }
```

with:

```js
    $('pList').innerHTML = listHtml(st, hasFilter(st.f));
    restoreFocus();
  }

  // Apres un rendu, le focus revient sur la ligne suivie (celle d'apres un Close),
  // jamais vole a la recherche ni au panneau.
  function restoreFocus() {
    if (!st.focusRef || sheetIsOpen()) return;
    const a = document.activeElement;
    if (a && a !== document.body && !(a.closest && a.closest('#pList'))) return;
    const all = Array.from(document.querySelectorAll('#pList [data-row]'));
    const el = all.find((x) => x.getAttribute('data-ref') === st.focusRef) || all[0];
    if (el) el.focus();
  }
```

Replace the listener block:

```js
  document.addEventListener('click', onClick);
  search.addEventListener('input', onInput);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    search.removeEventListener('input', onInput);
    clearTimeout(st.typing);
    panel.dispose();
  });
  await refresh();
}
```

with:

```js
  function typing(t) {
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }
  function rowEls() { return Array.from(document.querySelectorAll('#pList [data-row]')); }
  function focusedRow() {
    const a = document.activeElement;
    return a && a.closest ? a.closest('#pList [data-row]') : null;
  }
  function nextRef(ref) {
    const i = st.rows.findIndex((r) => r.ref === ref);
    const n = st.rows[i + 1] || st.rows[i - 1];
    return n ? n.ref : null;
  }
  // Clavier (ordinateur) : j/k et fleches, Entree (bouton natif), A, S, C, /.
  function onKey(e) {
    if (!ctx.isCurrent() || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const k = e.key;
    if (k === '/') {
      if (sheetIsOpen()) return;
      e.preventDefault();
      search.focus();
      return;
    }
    const open = panel.current();
    if (sheetIsOpen() && !open) return;
    const l = k.length === 1 ? k.toLowerCase() : k;
    if (l === 'a' || l === 's' || l === 'c') {
      const fr = focusedRow();
      const ref = open || (fr && fr.getAttribute('data-ref'));
      if (!ref) return;
      e.preventDefault();
      const row = rowOf(ref);
      if (l === 'a') panel.assign(ref, row);
      else if (l === 's') panel.schedule(ref, row);
      else { st.focusRef = nextRef(ref); panel.close(ref, row); }
      return;
    }
    if (sheetIsOpen()) return;
    if (k === 'ArrowDown' || k === 'j' || k === 'ArrowUp' || k === 'k') {
      const all = rowEls();
      if (!all.length) return;
      e.preventDefault();
      const cur = focusedRow();
      const down = k === 'ArrowDown' || k === 'j';
      const i = cur ? all.indexOf(cur) : -1;
      const next = cur ? all[Math.max(0, Math.min(all.length - 1, i + (down ? 1 : -1)))] : all[0];
      next.focus();
      st.focusRef = next.getAttribute('data-ref');
    }
  }
  // Glisser (telephone, moins de 960 px) : gauche Close, droite Assign.
  const detachSwipe = attachSwipe($('pList'), {
    enabled: () => window.matchMedia('(max-width: 959px)').matches,
    onSwipe: (ref, intent) => {
      const row = rowOf(ref);
      if (!row) return;
      if (intent === 'close') { st.focusRef = nextRef(ref); panel.close(ref, row); } else panel.assign(ref, row);
    },
  });

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  search.addEventListener('input', onInput);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    search.removeEventListener('input', onInput);
    clearTimeout(st.typing);
    detachSwipe();
    panel.dispose();
  });
  await refresh();
}
```

Append to `manager/ui/problems.css`:

```css
/* Glisser une ligne (telephone) : la ligne suit le doigt, la couleur annonce le geste. */
.prow.swiping{transition:none}
.prow.swipe-close{background:var(--bad-tint)}
.prow.swipe-assign{background:var(--accent-tint)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed (desktop-only and mobile-only tests are skipped on the other project).

- [ ] **Step 6: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add manager/ui/swipe.js manager/screens/problems.js manager/ui/problems.css tests/manager/problems-keys.spec.ts
git commit -m "manager: tri au clavier (j/k, fleches, Entree, A, S, C, /) et glisser sur telephone (gauche Close avec Undo, droite Assign)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Old app: "New manager app" link in More (managers only)

**Files:**
- Modify: `app.js` (root; new function before `renderMoreMenu` ~line 3251, grid template inside it)
- Create: `tests/manager-link.spec.ts`

**Interfaces:**
- Consumes: root `cleanerMode` (null in the manager view), `icon(name, size)`, `renderMoreMenu()`.
- Produces: `#moreMenu a[data-mgr-app][href="/manager/"]` with text "New manager app", only in the manager view.

- [ ] **Step 1: Write the failing test**

`tests/manager-link.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Lien « New manager app » dans More de l'ancienne app : vue manager seulement.
// Tourne contre l'arbre de travail :
//   HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/manager-link.spec.ts --project=desktop --project=mobile
// Reseau bouchonne (window.fetch remplace avant app.js), /manager/ servi par une
// page de remplacement : aucune ecriture, aucun appel a la prod.

type FakeRoute = { match: string; status: number; body: any };
const WALTER = { id: 8, name: 'Walter', color: '#e94560', role: 'manager' };
const SEMAX = { id: 7, name: 'Semax', color: '#7c3aed', role: 'maintenance' };
const SESSION = {
  access_token: 'jwt-test-token', refresh_token: 'refresh-test', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800,
  user: { id: 'u1', email: 'walter@example.com', aud: 'authenticated', role: 'authenticated' },
};

function routesFor(member: any): FakeRoute[] {
  return [
    { match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: member } },
    { match: 'action=getCleaners', status: 200, body: { status: 'success', cleaners: [{ ...member, email: 'x@example.com' }] } },
    { match: 'action=checkouts', status: 200, body: { status: 'success', reservations: [] } },
    {
      match: 'action=getAllData', status: 200,
      body: {
        status: 'success', done: {}, assignments: {}, cleaners: [{ ...member, email: 'x@example.com' }], templates: [],
        listingPrices: {}, timers: {}, cancelled: {}, postponed: {}, extraCleanings: [], leaves: [], holidays: [],
      },
    },
    { match: 'action=', status: 200, body: { status: 'success' } },
  ];
}

async function boot(page: any, member: any) {
  await page.route(/\/manager\/(\?.*)?$/, (r: any) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>MANAGER STUB</title><h1>MANAGER STUB</h1>' }));
  await page.addInitScript((cfg: any) => {
    try {
      localStorage.setItem('hkAuthSession', JSON.stringify(cfg.session));
      localStorage.setItem('onboardingSeen', '1');
      localStorage.setItem('hkInspAnnounceShown', '9');
    } catch (e) { /* ignore */ }
    const real = window.fetch.bind(window);
    window.fetch = ((input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      for (const r of cfg.routes) {
        if (url.indexOf(r.match) !== -1) {
          return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } }));
        }
      }
      if (url.indexOf(location.origin) === 0 || url.charAt(0) === '/') return real(input, init);
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }) as any;
  }, { routes: routesFor(member), session: SESSION });
  await page.goto('/', { waitUntil: 'commit' });
}

test('manager : More montre New manager app, qui ouvre /manager/', async ({ page }) => {
  await boot(page, WALTER);
  await page.locator('.bottom-nav [data-arg0="__more"]').click();
  const link = page.locator('#moreMenu a[data-mgr-app]');
  await expect(link).toHaveText('New manager app');
  await expect(link).toHaveAttribute('href', '/manager/');
  await link.click();
  await expect(page).toHaveURL(/\/manager\/$/);
  await expect(page.locator('h1')).toHaveText('MANAGER STUB');
});

test('maintenance : ni More ni lien vers /manager/', async ({ page }) => {
  await boot(page, SEMAX);
  await expect(page.locator('.bottom-nav')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.bottom-nav [data-arg0="__more"]')).toHaveCount(0);
  await expect(page.locator('a[href="/manager/"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/manager-link.spec.ts --project=desktop --project=mobile`
Expected: the manager test FAILS (no `a[data-mgr-app]`), the maintenance test passes.

- [ ] **Step 3: Write the implementation**

In root `app.js`, replace:

```js
function renderMoreMenu(){
```

with:

```js
// Lien vers la nouvelle app manager /manager/ (spec 2026-10-09, phase 2) : vue
// manager seulement (pas de cleanerMode). Simple lien, l'ancienne app reste.
function mgrAppLink(){
  if(cleanerMode) return '';
  return '<a class="more-item" href="/manager/" data-mgr-app style="text-decoration:none;color:inherit">'+
    '<span class="more-icon" style="background:#0a6fd620;color:#0a6fd6">'+icon('sparkles',22)+'</span>'+
    '<span class="more-label">New manager app</span></a>';
}
function renderMoreMenu(){
```

and inside `renderMoreMenu`, replace:

```js
          <span class="more-label">${i.label}</span>
        </button>`).join('')}
      </div>
```

with:

```js
          <span class="more-label">${i.label}</span>
        </button>`).join('')}
        ${mgrAppLink()}
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: 4 passed (2 tests × 2 projects).

- [ ] **Step 5: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git add app.js tests/manager-link.spec.ts
git commit -m "app: lien New manager app dans More (vue manager seulement) vers /manager/

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Merge into main, migration, deploy, verify in prod

**Files:** none created. Fast-forwards `main`, applies the migration, deploys `supabase/functions/hostaway-proxy` and the main working tree to Netlify.

**Interfaces:**
- Consumes: `BASE_SHA` and `BASELINE` recorded before Task 1; `./deploy-proxy.sh` (project `dqjnqvbxfwtvrjwnnmns`, token `~/.supabase/access-token`); `./deploy-front.sh` (Netlify site `stunning-kleicha-f61101`, stamps `sw.js` and `v3/sw.js`); Supabase MCP `apply_migration` and `execute_sql`.
- Produces: `mgr.problems`, `mgr.problem.get`, `mgr.problem.act` live; `/manager/#/problems` live; "New manager app" in the old app.

Migration, proxy deploy and front deploy act on prod: per `~/CLAUDE.md` (actions vers l'exterieur se confirment d'abord), get Hillal's go before Steps 4, 6 and 8 unless he already gave it for this plan.

- [ ] **Step 1: Full verification in the worktree**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" && HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/manager-link.spec.ts tests/v3-cutover.spec.ts --project=desktop --project=mobile
```
Expected: 0 failed everywhere. Then stop the 8890 server started by Playwright if it is still listening (it serves the worktree; the next run must serve main).

- [ ] **Step 2: Check the branch touches none of the files other people are editing**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git diff --name-only "$BASE_SHA" mgr-phase2 | grep -E '^(sw\.js|v3/sw\.js|hr\.js|styles\.css|\.gitignore|tests/hr\.spec\.ts|tests/laundry\.spec\.ts)$'
git merge-base --is-ancestor main mgr-phase2 && echo FF-OK
```
Expected: the grep prints nothing; `FF-OK`. Otherwise STOP and report.

- [ ] **Step 3: Fast-forward main (never stash)**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
P=$(mktemp -d)/sw.patch
git diff sw.js > "$P"
git checkout -- sw.js
git merge --ff-only mgr-phase2
git apply "$P"
git reset -q sw.js
git status --short
git log --oneline -1
```
Expected: `git status --short` equals `BASELINE` exactly (same `M` and `??` lines, `sw.js` still modified); HEAD is the last commit of Task 11. If `git apply` fails, STOP: the patch file `$P` still holds the stamp, report its path to Hillal.

Then re-run the manager suite from main (port 8890 must be free or served from main):
`cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed.

- [ ] **Step 4: Apply the migration (after Hillal's go)**

Supabase MCP `apply_migration`, project `dqjnqvbxfwtvrjwnnmns`, name `mgr_problem_events`, query = the full content of `supabase/migrations/20261010090000_mgr_problem_events.sql`. Then verify with `execute_sql`:

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'job_events_event_type_check';
```
Expected: the definition lists the 13 previous types and `mgr_problem_act`. (The migration only widens the CHECK; the deployed proxy keeps working before Step 6.)

- [ ] **Step 5: Check the deployed proxy is the base commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
D=$(mktemp -d); mkdir -p "$D/dl" "$D/base"
(cd "$D/dl" && SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" npx -y supabase@2 functions download hostaway-proxy --project-ref dqjnqvbxfwtvrjwnnmns)
git archive "$BASE_SHA" supabase/functions/hostaway-proxy | tar -x -C "$D/base"
DL=$(dirname "$(find "$D/dl" -name index.ts -path '*hostaway-proxy*' | head -1)")
diff -r -x '*_test.ts' -x 'v3_fakedb.ts' "$D/base/supabase/functions/hostaway-proxy" "$DL"
```
Expected: no output, or only `Only in .../base/...` lines for files `index.ts` does not import. Any content difference or `Only in <download>` line: STOP and report (prod runs code that is not in `BASE_SHA`; deploying would erase it).

- [ ] **Step 6: Deploy the proxy (after Hillal's go)**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && ./deploy-proxy.sh`
Expected: `✓ Deployed.`

- [ ] **Step 7: Verify the deployed proxy is HEAD and answers**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
D=$(mktemp -d); mkdir -p "$D/dl" "$D/head"
(cd "$D/dl" && SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" npx -y supabase@2 functions download hostaway-proxy --project-ref dqjnqvbxfwtvrjwnnmns)
git archive HEAD supabase/functions/hostaway-proxy | tar -x -C "$D/head"
DL=$(dirname "$(find "$D/dl" -name index.ts -path '*hostaway-proxy*' | head -1)")
diff -r -x '*_test.ts' -x 'v3_fakedb.ts' "$D/head/supabase/functions/hostaway-proxy" "$DL"
for f in "$D/head/supabase/functions/hostaway-proxy/"mgr_inbox.ts "$D/head/supabase/functions/hostaway-proxy/"mgr_problem_act.ts; do cmp "$f" "$DL/$(basename "$f")" && echo "same $(basename "$f")"; done
SECRET=$(sed -n "s/^export const APP_SECRET = '\(.*\)';/\1/p" v3/proxy-config.js)
B="https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy"
curl -sS -o /dev/null -w "%{http_code}\n" "$B?action=mgr.problems" -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w "%{http_code}\n" "$B?action=mgr.problem.get&ref=MNT-1" -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w "%{http_code}\n" "$B?action=mgr.problem.act" -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w "%{http_code}\n" "$B?action=getCleaners" -H "X-App-Secret: $SECRET"
```
Expected: `diff` prints nothing (or only `Only in .../head/...` for unimported files); both `same ...` lines; `401`, `401`, `405` (GET on a POST action), `200`.

- [ ] **Step 8: Deploy the front (after Hillal's go)**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && git status --short` (must equal `BASELINE`), then `./deploy-front.sh`.
Expected: `✓ Deployed.` The script stamps `sw.js` and `v3/sw.js`; leave the stamp uncommitted (both files carry other uncommitted hunks), as before this plan.

- [ ] **Step 9: Verify the front in prod (read only)**

```bash
curl -sSI https://stunning-kleicha-f61101.netlify.app/manager/screens/problems.js | grep -iE "^HTTP|cache-control"
curl -sS https://stunning-kleicha-f61101.netlify.app/manager/screens/problems.js | head -2
curl -sS https://stunning-kleicha-f61101.netlify.app/manager/app.js | grep -c "renderProblems"
curl -sS https://stunning-kleicha-f61101.netlify.app/app.js | grep -c "New manager app"
```
Expected: `HTTP/2 200`, `cache-control: no-cache`; the file starts with `// Ecran Problems`; counts `1` and `1`.

- [ ] **Step 10: Real-data check with Hillal (spec section 8, read only)**

Cross-check counts with SQL (`execute_sql`, read only):

```sql
select
  (select count(*) from maintenance_tickets where status in ('open','assigned','in_progress','waiting_parts','to_confirm')) as tickets_open,
  (select count(*) from maintenance_tickets where status in ('open','assigned','in_progress','waiting_parts','to_confirm') and priority = 'urgent') as tickets_urgent,
  (select count(*) from team_tasks where status in ('open','in_progress') and coalesce(source_ref,'') !~ '^maint:[0-9]+$') as tasks_open,
  (select count(*) from team_tasks where status in ('open','in_progress') and coalesce(source_ref,'') !~ '^maint:[0-9]+$' and priority = 'urgent') as tasks_urgent;
```

Ask Hillal to open `https://stunning-kleicha-f61101.netlify.app/manager/#/problems` signed in with his email, on phone and on desktop, and check:
- chip "All" = `tickets_open + tasks_open`; chip "Urgent" and the nav badge = `tickets_urgent + tasks_urgent`;
- no team task titled like a ticket (copies hidden); a ticket that has a Hermes copy shows "Also tracked as team task TSK-…" in its detail;
- a ticket from an inspection shows the "Inspection" badge and the zone photos;
- the old app's More shows "New manager app";
- Today's arrival causes say `(MNT-…)`.

If Hillal makes a real gesture himself (for example Assign then Undo), check its trace:

```sql
select action, actor, details, created_at from cleaning_log
where action like 'problem_%' and created_at > now() - interval '1 day' order by created_at desc limit 10;
select event_type, job_id, cleaner_id, result is not null as done from job_events
where event_type = 'mgr_problem_act' and created_at > now() - interval '1 day' order by created_at desc limit 10;
```
Expected: actor = his name, never `Manager`; one `job_events` row per gesture, `done = true`. Do not make writes yourself in prod.

- [ ] **Step 11: Report and clean up**

Report to Hillal (French): what is live, the links, what was checked in prod and what was not, the decisions below, and the next phase (Planning). After his validation only, remove the worktree:

```bash
rm "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2/node_modules"
git -C "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2" status --short   # only untracked deno.lock files may remain: delete them
git -C "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" worktree remove "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase2"
git -C "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" branch -d mgr-phase2
git -C "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" config --get core.bare   # must print false
```

---

## Decisions taken where the spec is silent (for Hillal's review)

1. **No `INS-` and no `RPT-` reference.** Every inspection finding sent to maintenance is already a ticket (`source = 'inspection'`, 11 open), and an unfinished inspection's findings are drafts (finishing refuses a not-OK zone without an outcome; 0 such rows in prod). Cleaner reports from `/v3/` are tickets too (`source = 'hk_planner_v3'`). They appear as `MNT-<id>` with a source badge "Inspection" or "Cleaner report", so one ticket has one reference everywhere (list, detail, Today's arrival cause). End-of-cleaning reports (`cleaning_reports`) are not problems: the problems they mention are already tickets.
2. **Hermes copies of tickets** (`team_tasks.source_ref = 'maint:<id>'`, 104 open, 35 of them for tickets already closed) are never listed nor counted (Problems, Today's counts, Team control overdue). The ticket detail shows the copy; Close on the ticket also closes its open copy, Undo reopens it. The 35 stale copies are not cleaned up in bulk (separate decision). Effect: Team control "Overdue team tasks" drops sharply (Semax's count was mostly copies).
3. **One list of open ticket statuses everywhere**: open, assigned, in_progress, waiting_parts, to_confirm (the current Maintenance screen's list). Today's "Blocked" rule now also sees urgent tickets in waiting_parts or to_confirm (none in prod today).
4. **Schedule on a ticket writes `sla_deadline`** (tickets have no other due column; it is the date Hermes already copies to its tasks). A chosen day means 23:59:59 Dubai; past dates refused, at most 365 days ahead. On an inspection ticket, the zone's fix date in Inspections follows the same date.
5. **Close** = `resolved` (tickets) or `done` (tasks); the optional note goes into the resolution note and into the comments. **Undo = Reopen**: it restores the previous status, note and Hermes copy from the close entry in the log; a problem closed elsewhere (no log entry) reopens as "assigned" if it has a technician or vendor, otherwise "open".
6. **Who can be assigned**: tickets to active managers, maintenance accounts and cleaners (Semax has the manager role; no maintenance account is active) or to an active vendor (none today, the vendor section stays hidden); team tasks to managers and maintenance. Unassign is an explicit button. A newly assigned team task sends the existing Telegram and push notification (same as the old app); tickets send none (same as the old app).
7. **Priority**: "medium" (tickets) and "normal" (tasks) are the same level, labelled "Normal", grey. High amber, urgent red, low grey. Today's medium tickets turn from amber to grey.
8. **Swipe kept** (the spec asks for it), with guards: left = Close with Undo, right = opens the Assign choice (no write without a second tap); at least 80 px and clearly horizontal; never from the 24 px screen edges (back gesture); the click after a swipe never opens the detail; buttons in the detail stay available. Phone widths only (< 960 px).
9. **Keyboard**: j/k and arrows move, Enter opens, A / S / C act on the focused row or the open detail, Esc closes, `/` jumps to search; keys are ignored while typing.
10. **The detail never calls Hostaway**: the "A guest arrives today" line shows in the list and on Today, not in the detail. If Hostaway is down, the list still loads, sorted without the "today" boost, with a banner.
11. **Nav badge** = urgent open problems, refreshed when Today or Problems loads (no extra call from other screens).
12. **List**: pages of 50 with "Load more"; chip counts cover the whole inbox; search covers ref, title, apartment ("apt 308"), building, person, source, priority, accents and case ignored. Filters reset when leaving the screen.
13. **Read-only when stale**: the last unfiltered list is kept on the device per account; on a network failure it shows with "Data from HH:MM" and no gesture is possible.
14. **Idempotency** reuses `job_events` with one new event type `mgr_problem_act`: one migration widening the CHECK constraint, applied before the proxy.
15. **Session author** is extended to the old app's `updateTicket` and `completePreventive`. `addTicketComment` and `createTicket` in the old app still take the browser's value (outside this phase).
16. **Old app link**: "New manager app" in More, manager view only, a plain link to `/manager/`.
