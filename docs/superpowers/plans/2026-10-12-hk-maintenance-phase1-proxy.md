# HK Maintenance · Phase 1 · Base and proxy · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server side of the new Maintenance section: a `maintenance_proposals` table fed by a server-only ingest action, and session actions to list proposals and tickets, accept, reject or merge a proposal, create a ticket and move a ticket through its steps. No UI in this phase (phase 2), no detection job (phase 4), no data wipe (phase 5).

**Architecture:** One migration (new table, two columns on `maintenance_tickets`, new `job_events` event types, empty archive tables for phase 5). New proxy modules beside the `mgr_*` ones: `mnt_rules.ts` (pure rules), `mnt_ingest.ts` (server-only ingest), `mnt_read.ts` (`mnt.list`), `mnt_act.ts` (all gestures), wired in `index.ts`. Same conventions as `mgr_problem_act.ts`: author from the session, idempotence key per gesture through `claimEvent` / `recordResult` / `releaseEvent` / `replayResponse` in `v3.ts`, side effects never fail a written gesture.

**Tech Stack:** Supabase Postgres, Deno edge function `supabase/functions/hostaway-proxy`, tests with `v3_fakedb.ts` (`fakeDb`) and `jsr:@std/assert@1`. Deno binary: `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno`; run `deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/` and `deno check --node-modules-dir=none supabase/functions/hostaway-proxy/index.ts`.

**Spec:** `docs/superpowers/specs/2026-10-12-hk-maintenance-design.md` (sections 3, 4, 5, 8, 9 for this phase).

## Global Constraints

- UI and API error strings in English. No em dash (U+2014) anywhere. Code comments in French without accents, like the surrounding code.
- Author of every write comes from the session (`me.name`, `me.cleaner_id`), never from the request body.
- Every session write carries an idempotence key `idem` (validated by `validIdem` in `v3.ts`); a replay of the same key returns the first answer.
- Access for every `mnt.*` session action: email session (Bearer) and role `manager` or `maintenance`; 401 `auth required` without a session, 403 `email sign-in required` for a PIN session, 403 `forbidden` for other roles.
- `mnt.proposals.ingest` is server-only: listed in `SERVER_ONLY_ACTIONS` (X-Server-Secret), never callable with a session.
- Never auto-cancel a ticket or a proposal (Hillal rule of 08/10/2026).
- Never invent a cost: a ticket closed without a cost has `actual_cost` null and no `maintenance_costs` row.
- Proposal categories exactly: `ac`, `plumbing`, `electrical`, `appliance`, `lock_door`, `wifi_tv`, `hot_water`, `pest`, `furniture`, `other`. Urgency exactly: `urgent`, `high`, `normal`. Reject reasons exactly: `not_maintenance`, `already_fixed`, `duplicate`, `other`.
- Ticket priority mapping from urgency: `urgent` -> `urgent`, `high` -> `high`, `normal` -> `medium`.
- Never edit, format or commit `hr.js`, `styles.css`, `tests/hr.spec.ts`, `tests/laundry.spec.ts`, `sw.js`, `v3/sw.js`. Git: never stash, never `git add -A`, add files by name.
- Do not change behaviour of existing actions (`mgr.*`, `v3.*`, legacy) in this phase.

## Review Focus

1. Ingest of the same guest message twice (job retried after a timeout): exactly one proposal, one quote; a second message on the same issue appends a quote to the pending proposal.
2. Accept of a proposal that another manager already accepted or rejected (two phones): 409 « This proposal was already handled. », no second ticket.
3. `done` with an empty or non-numeric cost: ticket resolved, `actual_cost` null, no `maintenance_costs` row; a cost of 0 is a real cost (row with amount 0).
4. A `maintenance` role user (Semax) can call every `mnt.*` session action but still gets 403 on `mgr.today` (unchanged).
5. Listing label of a proposal for a listing absent from `listing_config`: `apt` empty and `bld` « Listing <id> » (same fallback as `mgr_today.ts`), never a crash.

---

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261012120000_maintenance_proposals.sql`
- Test: none (SQL); verified by the controller when applied in Task 6.

**Content (write exactly this, after reading the CURRENT `job_events_event_type_check` values in prod with `select pg_get_constraintdef(oid) from pg_constraint where conname='job_events_event_type_check'` through the Supabase MCP `execute_sql`, project `dqjnqvbxfwtvrjwnnmns`, read-only, and keeping every existing value):**

```sql
-- Maintenance repensee (spec 2026-10-12) : propositions tirees des messages
-- des guests, validees par Semax ou un manager avant de devenir des tickets.
CREATE TABLE IF NOT EXISTS public.maintenance_proposals (
  id bigserial PRIMARY KEY,
  listing_id text,
  reservation_id text,
  conversation_id text NOT NULL,
  guest_name text,
  stay_from date,
  stay_to date,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('ac','plumbing','electrical','appliance','lock_door','wifi_tv','hot_water','pest','furniture','other')),
  urgency text NOT NULL CHECK (urgency IN ('urgent','high','normal')),
  quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  ticket_id integer REFERENCES public.maintenance_tickets(id) ON DELETE SET NULL,
  open_ticket_id integer,
  decided_by text,
  decided_at timestamptz,
  reject_reason text CHECK (reject_reason IS NULL OR reject_reason IN ('not_maintenance','already_fixed','duplicate','other')),
  reject_note text,
  dedup_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Une seule proposition en attente par conversation et categorie.
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_proposals_pending_dedup
  ON public.maintenance_proposals (dedup_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS maintenance_proposals_status_created ON public.maintenance_proposals (status, created_at DESC);
ALTER TABLE public.maintenance_proposals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.maintenance_tickets ADD COLUMN IF NOT EXISTS proposal_id bigint;
ALTER TABLE public.maintenance_tickets ADD COLUMN IF NOT EXISTS due_on date;

-- Archives pour la remise a zero de la phase 5 (vides ici).
CREATE TABLE IF NOT EXISTS public.archive_maintenance_tickets (LIKE public.maintenance_tickets INCLUDING DEFAULTS);
ALTER TABLE public.archive_maintenance_tickets ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_ticket_comments (LIKE public.ticket_comments INCLUDING DEFAULTS);
ALTER TABLE public.archive_ticket_comments ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_maintenance_costs (LIKE public.maintenance_costs INCLUDING DEFAULTS);
ALTER TABLE public.archive_maintenance_costs ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_ticket_photos (LIKE public.photos INCLUDING DEFAULTS);
ALTER TABLE public.archive_ticket_photos ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_team_tasks (LIKE public.team_tasks INCLUDING DEFAULTS);
ALTER TABLE public.archive_team_tasks ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.archive_maintenance_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_maintenance_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_ticket_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_team_tasks ENABLE ROW LEVEL SECURITY;

-- Deux types d evenement en plus pour la garde d idempotence.
ALTER TABLE public.job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check;
ALTER TABLE public.job_events ADD CONSTRAINT job_events_event_type_check CHECK (event_type IN (
  <every value currently in prod>, 'mnt_act', 'mnt_ingest'));
```

Note: `LIKE ... INCLUDING DEFAULTS` copies serial defaults (they point to the source sequences, harmless because archive rows are inserted with their original ids). `due_on` is the « Due date » of a ticket (a day, Dubai), distinct from `sla_deadline` which stays as is.

- [ ] **Step 1:** Read the prod constraint (read-only SQL) and write the migration with the full value list.
- [ ] **Step 2:** Commit `git commit -m "maintenance: migration propositions, colonnes tickets, archives"`. Do NOT apply it (the controller applies it in Task 6).

---

### Task 2: Pure rules `mnt_rules.ts`

**Files:**
- Create: `supabase/functions/hostaway-proxy/mnt_rules.ts`
- Test: `supabase/functions/hostaway-proxy/mnt_rules_test.ts`

**Interfaces (Produces, exact names):**
```ts
export const MNT_CATEGORIES = ["ac","plumbing","electrical","appliance","lock_door","wifi_tv","hot_water","pest","furniture","other"] as const;
export type MntCategory = typeof MNT_CATEGORIES[number];
export const MNT_URGENCIES = ["urgent","high","normal"] as const;
export type MntUrgency = typeof MNT_URGENCIES[number];
export const MNT_REJECT_REASONS = ["not_maintenance","already_fixed","duplicate","other"] as const;
export const MNT_ROLES = ["manager","maintenance"] as const;
export const MNT_CATEGORY_LABEL: Record<MntCategory, string>; // "AC","Plumbing","Electrical","Appliance","Lock or door","Wi-Fi or TV","Hot water","Pests","Furniture","Other"
export const MNT_TITLE_MAX = 120; export const MNT_TEXT_MAX = 2000; export const MNT_QUOTE_MAX = 600; export const MNT_QUOTES_MAX = 10;
export function mntAccess(hasBearer: boolean, me: { role: string } | null): { ok: true } | { ok: false; status: number; error: string };
// 401 "auth required" / 403 "email sign-in required" / 403 "forbidden", like mgrAccess but MNT_ROLES
export function priorityFor(u: MntUrgency): "urgent" | "high" | "medium";
export function proposalRef(id: number): string; // "PRP-12"
export function dedupKey(conversationId: string, category: MntCategory): string; // conversationId + "|" + category
export function guestInNow(p: { stay_from: string | null; stay_to: string | null }, today: string): boolean; // stay_from <= today <= stay_to (departure day counts)
export type IngestIssue = { conversationId: string; messageId: string; at: string; listingId: string | null; reservationId: string | null;
  guestName: string | null; stayFrom: string | null; stayTo: string | null; title: string; category: MntCategory; urgency: MntUrgency; quote: string };
export function parseIngest(body: any): { issues: IngestIssue[] } | { error: string };
// body = { issues: [...] } max 50 items; required: conversationId, messageId, title (trimmed, cut to MNT_TITLE_MAX), category in MNT_CATEGORIES, urgency in MNT_URGENCIES, quote (trimmed, cut to MNT_QUOTE_MAX), at (ISO date-time); dates YYYY-MM-DD or null; any invalid item -> { error: "Invalid issue N: <field>." } (N 1-based)
export function appendQuote(quotes: Array<{ message_id: string; at: string; text: string }>, q: { message_id: string; at: string; text: string }):
  { quotes: Array<{ message_id: string; at: string; text: string }>; added: boolean };
// no duplicate message_id (added false); keeps the MNT_QUOTES_MAX most recent, sorted by at ascending
```
- [ ] **Step 1: Failing tests** covering: every access case (no session, PIN manager, cleaner, maintenance with Bearer, manager with Bearer); priorityFor 3 values; proposalRef; dedupKey; guestInNow (before, first day, last day, after, null dates -> false); parseIngest (valid batch, 51 items rejected « Too many issues. », unknown category, empty quote, title cut at 120, bad date); appendQuote (duplicate message, 11th quote drops the oldest, sorting).
- [ ] **Step 2: Run** `deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/mnt_rules_test.ts` -> FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: regles pures (acces, categories, ingestion, citations)"`.

---

### Task 3: Ingest `mnt_ingest.ts`

**Files:**
- Create: `supabase/functions/hostaway-proxy/mnt_ingest.ts`
- Test: `supabase/functions/hostaway-proxy/mnt_ingest_test.ts` (uses `fakeDb` from `v3_fakedb.ts`; extend the fake only if an operator is missing, keeping its existing behaviour)

**Interfaces:**
- Consumes: `parseIngest`, `appendQuote`, `dedupKey`, `MNT_*` from Task 2.
- Produces:
```ts
export type IngestDeps = { nowMs?: number; notifyUrgent?: (p: { id: number; title: string; listingId: string | null }) => void };
export async function mntIngest(sb: any, body: any, deps?: IngestDeps):
  Promise<{ status: number; body: { created: number[]; appended: number[]; skipped: number } | { error: string } }>;
```
- Behaviour per issue, in order:
  1. If any proposal (any status) already has a quote with this `messageId` for this `conversationId` and category: skipped (idempotent retry).
  2. Else if a `pending` proposal with `dedup_key = dedupKey(conversationId, category)` exists: append the quote (`appendQuote`), update `updated_at`, raise urgency if the new one is higher (`normal` < `high` < `urgent`); id goes to `appended`.
  3. Else insert a new `pending` proposal with `quotes = [{message_id, at, text}]`, `dedup_key`, and `open_ticket_id` = id of the most recent ticket on the same `listing_id` whose status is in `MGR_OPEN_TICKET_STATUSES` (from `mgr_inbox.ts`) and whose `category` maps to the same category (compare lowercased ticket `category` to the proposal category; null when none or listing null); id goes to `created`. A unique-index conflict on insert (race) falls back to step 2.
  4. A new or upgraded proposal with urgency `urgent` calls `deps.notifyUrgent` once (never for a skipped or a non-upgraded append).
- 400 with the `parseIngest` error for an invalid body; 503 « Could not save proposals. » on a read or write error (log the error), nothing half-written for that issue.
- [ ] **Step 1: Failing tests:** new proposal; same message twice -> one quote, skipped 1; second message same conversation and category -> appended; same conversation, other category -> new proposal; accepted proposal with same dedup key does not block a new pending one; open ticket detection (same listing and category open -> `open_ticket_id`; resolved ticket ignored); urgent notify called once on create and once on upgrade from normal to urgent, not on a second urgent append; invalid body 400.
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: ingestion des propositions (idempotente, citations, ticket deja ouvert)"`.

---

### Task 4: Read `mnt_read.ts` (`mnt.list`)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mnt_read.ts`
- Test: `supabase/functions/hostaway-proxy/mnt_read_test.ts`

**Interfaces:**
- Consumes: `splitListing` (`mgr_rules.ts`), `readAllRows` (`mgr_today.ts`), `MGR_OPEN_TICKET_STATUSES`, `MGR_CLOSED_TICKET_STATUSES` (`mgr_inbox.ts`), `guestInNow`, `proposalRef`, `MNT_CATEGORY_LABEL`, `priorityFor` (Task 2), `todayDubai` (`v3.ts`).
- Produces:
```ts
export type MntQuery = { tab: "proposals" | "open" | "done"; filter: "all" | "mine" | "urgent" | "unassigned"; q: string; rejected: boolean };
export function parseMntQuery(p: URLSearchParams): MntQuery | { error: string }; // defaults tab=proposals, filter=all, q="", rejected=false
export type MntProposalRow = { id: number; ref: string; listingId: string | null; apt: string; bld: string; title: string;
  category: string; categoryLabel: string; urgency: string; guestName: string | null; stayFrom: string | null; stayTo: string | null;
  guestInNow: boolean; quotes: Array<{ message_id: string; at: string; text: string }>; conversationId: string; reservationId: string | null;
  openTicket: { id: number; ref: string; title: string } | null; status: string; rejectReason: string | null; decidedBy: string | null;
  decidedAt: string | null; createdAt: string; updatedAt: string };
export type MntTicketRow = { id: number; ref: string; listingId: string | null; apt: string; bld: string; title: string; category: string | null;
  priority: string; status: string; stage: "todo" | "in_progress" | "waiting_parts" | "to_confirm" | "done"; origin: "guest_message" | "cleaner_report" | "inspection" | "manual";
  assignee: { kind: "member" | "vendor"; id: number; name: string } | null; dueOn: string | null; createdAt: string; startedAt: string | null;
  resolvedAt: string | null; resolvedBy: string | null; resolutionNotes: string | null; actualCost: number | null; proposalId: number | null };
export type MntList = { tab: MntQuery["tab"]; counts: { proposals: number; open: number; urgent: number; unassigned: number; mine: number };
  proposals: MntProposalRow[]; tickets: MntTicketRow[]; team: Array<{ id: number; name: string; role: string }>; vendors: Array<{ id: number; name: string }> };
export async function mntList(sb: any, me: { cleaner_id: number; name: string }, q: MntQuery, o?: { nowMs?: number }):
  Promise<{ status: number; body: MntList | { error: string } }>;
```
- Rules:
  - `proposals` tab: status `pending`, sorted urgent first then `updated_at` desc; with `rejected=true`: status `rejected` or `merged` decided in the last 30 days, `decided_at` desc.
  - `open` tab: tickets with status in `MGR_OPEN_TICKET_STATUSES`; `stage`: `open`/`assigned` -> `todo`, `in_progress` -> `in_progress`, `waiting_parts` -> `waiting_parts`, `to_confirm` -> `to_confirm`; sorted by priority (urgent, high, medium, low) then `created_at` asc.
  - `done` tab: status in `MGR_CLOSED_TICKET_STATUSES` except `cancelled`, `resolved_at` in the last 30 days, `resolved_at` desc; `resolvedBy` = actor name of the most recent `cleaning_log` row with `reservation_key = "ticket_<id>"` and event `mnt_ticket.done` (written by Task 5's `v3Log`; read `v3Log` in `v3.ts` for the exact column names), else null.
  - `origin`: source `guest_message` -> `guest_message`; `hk_planner_v3` -> `cleaner_report`; `inspection` -> `inspection`; anything else -> `manual`.
  - Filters on `open`: `mine` = assigned_technician_id = me.cleaner_id; `urgent` = priority urgent; `unassigned` = no technician and no vendor. `q` matches apartment number or building (case-insensitive) on every tab.
  - `counts` always computed on the full open set and pending proposals, independent of the tab and filter.
  - Listing label: `splitListing(listing_config row)`, fallback `{ apt: "", bld: "Listing " + id }` when the listing is unknown, `{ apt: "", bld: "" }` when listing_id is null.
  - `team`: active cleaners with role in `manager`, `maintenance`; `vendors`: active vendors. Paged reads with `readAllRows` (stable order) for tickets and proposals.
  - Read error -> 503 « Maintenance is unavailable right now. Try again. »
- [ ] **Step 1: Failing tests** for each tab, each filter, `q`, counts, stage and origin mapping, unknown listing fallback, rejected list 30 days window, Dubai day for « guest in now ».
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: lecture mnt.list (propositions, tickets ouverts, faits)"`.

---

### Task 5: Gestures `mnt_act.ts`

**Files:**
- Create: `supabase/functions/hostaway-proxy/mnt_act.ts`
- Test: `supabase/functions/hostaway-proxy/mnt_act_test.ts`

**Interfaces:**
- Consumes: Task 2 rules; `claimEvent`, `recordResult`, `releaseEvent`, `replayResponse`, `validIdem`, `v3Log`, `todayDubai`, `plusDays` (`v3.ts`); `MGR_OPEN_TICKET_STATUSES`, `MGR_TICKET_ASSIGNEE_ROLES` (`mgr_inbox.ts`). Read `mgr_problem_act.ts` first and follow its order exactly: validation, key, replay, state check, write, release on failed write, side effects after.
- Produces:
```ts
export const MNT_ACT_EVENT = "mnt_act" as const;
export type MntActDeps = { nowMs?: number; notifyAssignee?: (t: { ticketId: number; memberId: number; title: string; urgent: boolean }) => void };
export async function mntAct(sb: any, me: SessionUser, body: any, deps?: MntActDeps): Promise<ActionResult>;
```
- `body.op` and fields (all with `idem`):
  - `proposal.accept`: `{ proposalId, title, listingId, category, urgency, memberId | vendorId | null, note }` -> proposal must be `pending` else 409 « This proposal was already handled. »; insert ticket `{ listing_id, title, description: note || null, category, priority: priorityFor(urgency), status: assignee ? "assigned" : "open", source: "guest_message", source_ref: "proposal:" + id, proposal_id: id, reported_by: me.name, assigned_technician_id | assigned_vendor_id }`; one `ticket_comments` row per quote `{ ticket_id, author: "Guest", comment: quote.text }` in order; proposal -> `accepted`, `ticket_id`, `decided_by: me.name`, `decided_at`. Result `{ ok: true, ticketId, ref: "MNT-<id>" }`. Assignee memberId must be an active cleaner with role in `MGR_TICKET_ASSIGNEE_ROLES`, vendorId an active vendor, else 400 « Invalid person. » / « Invalid vendor. ». Title required (« Write a title first. »), cut to 120.
  - `proposal.reject`: `{ proposalId, reason, note }` -> pending only (409 as above); reason in `MNT_REJECT_REASONS` else 400 « Choose a reason. »; `other` needs a note (« Write why. »).
  - `proposal.merge`: `{ proposalId, ticketId }` -> pending only; ticket must be open (status in `MGR_OPEN_TICKET_STATUSES`) else 409 « This ticket is closed. Reopen it first. »; one comment per quote (author « Guest »); proposal -> `merged`, `ticket_id`.
  - `ticket.create`: `{ title, listingId, category, urgency, memberId | vendorId | null, note }` -> same insert as accept with `source: "manual"`, no proposal.
  - `ticket.start` -> status `in_progress`, `started_at` now (only from todo stages or `waiting_parts`; from closed -> 409 « This ticket is closed. Reopen it first. »).
  - `ticket.waiting_parts`: `{ note }` optional -> status `waiting_parts`, note as comment if given.
  - `ticket.done`: `{ note, photoPath, cost }` -> status `resolved`, `resolved_at` now, `resolution_notes` note or null, `resolution_photo_path` or null, `actual_cost` = number when `cost` is a finite number >= 0 (0 allowed), else null; when a cost is set insert `maintenance_costs { ticket_id, listing_id, category, description: title, amount, vendor_id: assigned_vendor_id, date: todayDubai }`. Cost not numeric but non-empty -> 400 « Cost must be a number. ».
  - `ticket.reopen` -> closed tickets only; status `assigned` if someone is assigned else `open`, `resolved_at` null.
  - `ticket.assign`: `{ memberId | vendorId | unassign: true }` -> like `mgr_problem_act` assign (status `assigned`/`open` when in a todo stage, unchanged otherwise); `notifyAssignee` for a new member.
  - `ticket.due`: `{ date | null }` -> `due_on`, date today..today+60 (Dubai), « Invalid date. » / « The date cannot be in the past. » / « The date is too far ahead. ».
  - `ticket.comment`: `{ text }` -> `ticket_comments { author: me.name }`, required (« Write a comment first. »).
  - Every ticket write sets `last_update` now and logs `v3Log` with `reservation_key: "ticket_" + id`, event `mnt_<op>`, actor me.
  - Unknown op -> 400 « Unknown action. »; unknown proposal or ticket -> 404 « Not found. ».
- [ ] **Step 1: Failing tests** for every op (happy path and each error message above), Review Focus items 2 and 3, replay of the same `idem` returning the first answer without a second write, author always `me.name` even if the body carries `author`, `notifyAssignee` called on assign and accept with a member, never on unassign.
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4: Run** -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: gestes (valider, rejeter, fusionner, creer, etapes, assigner, echeance, commentaire)"`.

---

### Task 6: Routes in `index.ts`, then apply and deploy (controller deploys)

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (imports, ROUTES list next to the `mgr.*` entries, `SERVER_ONLY_ACTIONS`, handlers next to `mgr.problem.act`)
- Test: `supabase/functions/hostaway-proxy/mnt_routes_test.ts` (source assertions like `v3_day_extras_test.ts` does on index.ts: each action present in ROUTES with the right method, `mnt.proposals.ingest` in `SERVER_ONLY_ACTIONS`, each session handler calls `mntAccess(bearerToken(req) !== null, me)` before reading the body)

**Interfaces:**
- Routes: `["mnt.list","GET"]`, `["mnt.act","POST"]`, `["mnt.proposals.ingest","POST"]`.
- `mnt.list`: `currentUser`, `mntAccess`, `parseMntQuery(url.searchParams)` (400 on error), `mntList(sb, me, q)`.
- `mnt.act`: `currentUser`, `mntAccess`, JSON body (400 « invalid json body »), `mntAct(sb, me, body, { notifyAssignee })` where `notifyAssignee` sends the existing assignment push (reuse the push helper used for ticket assignment in `v3_tickets.ts`, title « New ticket: <title> » or « Urgent: <title> », body « Assigned to you. Open HK Planner to see the details. »), wrapped in `keepAlive(...)` and never failing the gesture.
- `mnt.proposals.ingest`: server secret already checked by the `SERVER_ONLY_ACTIONS` gate; `mntIngest(sb, body, { notifyUrgent })` where `notifyUrgent` pushes to active `maintenance` and `manager` members: title « Urgent from a guest: <title> », body « <apt label> · Open HK Planner to review it. », bypassing quiet hours like urgent cleaner reports.
- [ ] **Step 1: Failing test** `mnt_routes_test.ts`. **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** whole proxy suite and `deno check` -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: routes mnt.list, mnt.act, mnt.proposals.ingest"`.
- [ ] **Step 6 (controller):** apply the migration with Supabase MCP `apply_migration` (name `maintenance_proposals`), verify the table and constraint; check prod proxy == main HEAD before deploy; fast-forward main; `./deploy-proxy.sh`; prod checks: `mnt.list` without session -> 401, with the app secret only -> 401, `mnt.proposals.ingest` without server secret -> 401/403, `getCleaners` still 200.
