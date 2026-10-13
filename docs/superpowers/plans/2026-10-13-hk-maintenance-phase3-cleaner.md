# HK Maintenance · Phase 3 · Cleaner app changes (C4, C8, C12) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the cleaner app `/v3/`: (C4) at step 2 each open ticket of the apartment is a card with « Still there » and « Fixed now » (photo); (C8) a reported problem card says who got it; (C12) the Profile shows « My reports, last 7 days » with a readable status.

**Architecture:** Server: `v3.myDay` returns richer open tickets (status, assignee name, reported day), new action `v3.ticketStill` (comment + push, no status change), `v3.reportProblem` answers with `sentTo`, new read `v3.myReports`. `v3.checkTicket` already exists (photo required, status `to_confirm`, comment « Checked during the cleaning, photo attached. »): the app now calls it. Front: `v3/conv/conversation.js` (step 2 open tickets), `v3/conv/ui.js` + `v3/conv/report.js` (problem card text), `v3/screens/profile.js` (My reports), `v3/practice.js` (simulator mirrors every new action).

**Tech Stack:** Deno edge function `supabase/functions/hostaway-proxy` (`fakeDb`, `jsr:@std/assert@1`, Deno `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/`). Vanilla JS `/v3/` with Playwright projects `v3-mobile`, `v3-desktop` (`tests/v3/*.spec.ts`), plus node unit tests in `tests/v3-node` if the module has them. Port 8890: `lsof -i :8890` first.

**Spec:** `docs/superpowers/specs/2026-10-12-hk-maintenance-design.md` section 7. Mockups: https://claude.ai/artifact/KRkqYiBfxQnws17eNc8KQE boards C4, C8, C12.

## Global Constraints

- Cleaner UI in English, short, readable (cleaners read English as a second language): use exactly the copy below. No em dash (U+2014). Comments in French without accents.
- Every write carries an idempotence key, works offline through the existing v3 queue (`v3/conv/sync.js`, `persist.js`), shows ✓ then ✓✓ like other actions.
- Practice mode (`v3/practice.js`) must simulate every new action so practice never calls the server.
- View-as (read only) mode never shows the new buttons.
- No change to the cleaning flow other than these three points. The step 2 pest question keeps working as today.
- Never edit, format or commit `hr.js`, `styles.css`, `tests/hr.spec.ts`, `tests/laundry.spec.ts`, `sw.js`, `v3/sw.js`. Git: never stash, never `git add -A`, add files by name.

## Review Focus

1. Offline cleaner taps « Fixed now », takes the photo, the action queues and syncs later in order (photo upload before checkTicket), no duplicate on retry.
2. A ticket already `to_confirm` (checked by a previous cleaner) shows « Waiting for check » and no buttons.
3. « Still there » tapped twice: one comment only (same idem).
4. A problem reported while no technician is on duty says « sent to the team ».
5. My reports for a cleaner with no report: « No report this week. ».

---

### Task 1: Server

**Files:**
- Modify: `supabase/functions/hostaway-proxy/v3_myday.ts` (open tickets per apartment gain `status`, `assigneeName` (technician or vendor name or null), `reportedOn` YYYY-MM-DD; include status `to_confirm` now, still exclude resolved/closed/cancelled; pest logic unchanged)
- Modify: `supabase/functions/hostaway-proxy/v3_tickets.ts` (new `ticketStill(sb, me, body)`), `v3_problems.ts` (`reportProblem` response adds `sentTo: string | null` = name of the technician assigned at creation), `index.ts` (route `["v3.ticketStill","POST"]`, `["v3.myReports","GET"]`, same access as `v3.checkTicket`), `v3_idem.ts` + a migration `supabase/migrations/20261013090000_v3_ticket_still.sql` adding event type `ticket_still` to `job_events_event_type_check` (keep every current value: read the latest migration `20261012120000_maintenance_proposals.sql`)
- Create: `supabase/functions/hostaway-proxy/v3_reports.ts` (`myReports(sb, me, nowMs)`), tests `v3_reports_test.ts`, `v3_tickets_test.ts` additions, `v3_myday_test.ts` additions, `v3_problems_test.ts` addition

**Interfaces:**
- `v3.ticketStill` body `{ idem, ticketId, jobId }`: ticket must be open (not resolved/closed/cancelled) else 409 « This problem is already closed. »; inserts `ticket_comments { ticket_id, author: me.name, comment: "Still there during the cleaning." }`; pushes the assigned technician (non urgent, title « Still broken: <title> », body « <me.name> checked it during the cleaning. », url `APP_URL + "/?mnt=" + id`); result `{ ok: true }`. Idempotent (event `ticket_still`).
- `v3.myReports` -> `{ reports: Array<{ id: number; title: string; place: string; listingLabel: string; reportedOn: string; status: "with_tech" | "in_progress" | "waiting_parts" | "to_confirm" | "fixed" | "open"; techName: string | null }> }`: tickets with `source = "hk_planner_v3"` and `reported_by = me.name` created in the last 7 Dubai days, newest first; status mapping: assigned -> with_tech, open -> open, in_progress, waiting_parts, to_confirm as is, resolved/closed -> fixed, cancelled excluded.
- [ ] **Step 1: Failing tests.** **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** whole proxy suite + deno check -> PASS.
- [ ] **Step 5: Commit** `git commit -m "v3: tickets ouverts detailles, still there, mes signalements, destinataire du signalement"`.

---

### Task 2: Cleaner app

**Files:**
- Modify: `v3/conv/conversation.js` (step 2: replace the « Open problems here: ... » line by ticket cards), `v3/conv/ui.js` (render ticket cards, problem card text), `v3/conv/report.js` (report text line), `v3/conv/sync.js` / `persist.js` if new queued action types are needed, `v3/screens/profile.js` (My reports), `v3/practice.js` (simulate `v3.ticketStill`, `v3.checkTicket`, `v3.myReports`, `sentTo`), CSS in `v3/conv.css` or `v3/styles/cleaner.css` (match the screen's look)
- Test: `tests/v3/maintenance-cleaner.spec.ts`

**Copy and behaviour:**
- C4, step 2, before the walls question, one app bubble: « Open problems here. Is it still there? » then one card per open ticket: title (e.g. « AC · Bedroom »), sub-line « Reported <Sat 10> · <Semax is on it | waiting parts | nobody yet> », buttons « Still there » (outlined red) and « Fixed now 📷 » (teal). Status `to_confirm`: sub-line « Waiting for check », no buttons. Pest tickets keep the existing pest question and get no card.
  - « Still there »: card shows « ✓ Still there » and the button row disappears; queues `v3.ticketStill`.
  - « Fixed now »: opens the viewfinder titled « <title> · fixed » with « Take a photo of it »; after the first photo and « Done », the card shows « ✓ Fixed, photo sent »; queues the photo upload (existing upload with `ticketId`) then `v3.checkTicket { ticketId, photoId }` (read `checkTicket` for the exact body).
  - The cards do not block the flow: the walls question follows; an unanswered card stays answerable until the report is sent.
- C8: problem card line « <place> · sent to <name> · <n> photos » when `sentTo` is known, « <place> · sent to the team » when the server answered without a name, and today's « team notified » wording replaced everywhere; while not yet synced: « <place> · saved, sending… ». The WhatsApp report text keeps its current format.
- C12: Profile, after the name, section « My reports, last 7 days »: rows « <title> » / « <listingLabel> · <today | Sat 10> » with a status word on the right: with_tech « With <techName> » (or « With the team »), open « Not assigned yet », in_progress « In progress », waiting_parts « Waiting parts », to_confirm « Checked, waiting », fixed « Fixed ». Empty: « No report this week. ». Loaded with `v3.myReports` when the profile opens; offline: « Reports load when you are online. ».
- [ ] **Step 1: Failing tests** (Review Focus 1 to 5, view-as shows no buttons, practice mode makes no server call).
- [ ] **Step 2: Run** `npx playwright test tests/v3 --project=v3-mobile --project=v3-desktop` -> FAIL. **Step 3: Implement.** **Step 4:** all `tests/v3` both projects + `tests/v3-node` (if present, `node --test tests/v3-node`) -> PASS.
- [ ] **Step 5: Commit** `git commit -m "v3: tickets ouverts a verifier, destinataire du signalement, mes signalements"`.

---

### Task 3: Deploy and verify (controller)

- [ ] Apply the migration (Supabase MCP `apply_migration`), verify the constraint; check prod proxy == main HEAD; fast-forward main; `./deploy-proxy.sh`; `./deploy-front.sh`.
- [ ] Prod checks: `v3.ticketStill` and `v3.myReports` without session -> 401; served `/v3/conv/conversation.js` contains « Is it still there? »; `hr.js` still the uncommitted version.
