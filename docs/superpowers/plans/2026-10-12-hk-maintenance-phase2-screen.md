# HK Maintenance · Phase 2 · Maintenance screen and Semax access · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The manager app gets a Maintenance screen (Proposals / Open / Done, ticket and proposal sheets, new ticket), Semax (role `maintenance`) gets the app with only Maintenance (landing) and Planning, Today's problems block becomes a Maintenance block, and team tasks move to More › Tasks.

**Architecture:** Server: two new actions (`mnt.get` detail, `mnt.photo` upload), Today payload gains a `maintenance` block, the Problems inbox serves team tasks only, Planning actions accept the `maintenance` role. Front: new `manager/screens/maintenance*.js` + `manager/ui/maintenance.css`, shell nav per role, `#/problems` becomes `#/tasks` under More (same module, tasks only), root app cutover redirects `maintenance` too and maps ticket pushes to `#/maintenance?ref=`.

**Tech Stack:** Deno edge function `supabase/functions/hostaway-proxy` (tests `fakeDb` from `v3_fakedb.ts`, `jsr:@std/assert@1`, Deno binary `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno`, run `deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/`). Vanilla JS ES modules under `/manager/`, Playwright projects `mgr-mobile` and `mgr-desktop` (`tests/manager`, helpers `bootMgr`, `me`, `fetchLog` in `tests/manager/helpers.ts`; root app tests in project used by `tests/mgr-cutover.spec.ts`). Port 8890: check `lsof -i :8890` before running.

**Spec:** `docs/superpowers/specs/2026-10-12-hk-maintenance-design.md` sections 5, 6, 8. Mockups: https://claude.ai/artifact/KRkqYiBfxQnws17eNc8KQE (boards 1 to 5). Phase 1 server: `mnt_rules.ts`, `mnt_read.ts` (`mnt.list`, row types `MntProposalRow`, `MntTicketRow`, `MntList`), `mnt_act.ts` (`mnt.act` ops), `mnt_ingest.ts`, routes in `index.ts`.

## Global Constraints

- UI in English. No em dash (U+2014) anywhere. Comments in French without accents, like the surrounding code.
- Guest quotes, titles, guest names, notes and comments are always rendered as text (`esc()` from `manager/ui/dom.js`), never as HTML.
- Every write carries an idempotence key (`newIdem()` from `manager/api.js`), retried with the same key after an uncertain failure (`createGestures()` in `manager/gesture.js`). Author never sent.
- Cached or stale data: no write, toast « Reconnect to make changes. ».
- Role `maintenance` sees exactly two views: Maintenance (landing) and Planning. Any other hash sends it to `#/maintenance`. The server refuses it (403) on every `mgr.*` action except `mgr.planning`, and on the legacy writes it never needs.
- Never auto-cancel a ticket or a proposal. Never invent a cost: an empty cost stays empty.
- Labels via `placeLabel()` (« Apt 1509 · Westwood »).
- Never edit, format or commit `hr.js`, `styles.css`, `tests/hr.spec.ts`, `tests/laundry.spec.ts`, `sw.js`, `v3/sw.js`. Git: never stash, never `git add -A`, add files by name.
- Proxy changes deploy with the front in Task 7 (proxy first, then front).

## Review Focus

1. A Semax session (role maintenance, email) opening `/manager/` lands on Maintenance, sees only Maintenance and Planning, `#/today` or `#/more` typed by hand goes back to `#/maintenance`; a PIN Semax sees « Sign in with your email ».
2. Accepting a proposal another person already handled shows the server message (409) in the sheet and refreshes the list; no duplicate ticket on a double tap (same idem key).
3. A push link to a ticket (`/?mnt=12`) opens `/manager/#/maintenance?ref=MNT-12` with the ticket sheet; an unknown or deleted ticket shows « This ticket was not found. » and the list.
4. Done with a photo on a slow phone: photo upload failure keeps the sheet open with the error and nothing closed; a ticket is never marked done with a photo path that failed to upload.
5. Old links `#/problems?ref=TSK-13` still work (go to `#/tasks?ref=TSK-13`); `#/problems?ref=MNT-12` goes to `#/maintenance?ref=MNT-12`.

---

### Task 1: Server, ticket detail `mnt.get` and photo upload `mnt.photo`

**Files:**
- Create: `supabase/functions/hostaway-proxy/mnt_get.ts`, `mnt_get_test.ts`
- Modify: `supabase/functions/hostaway-proxy/v3_photos.ts` only if needed to reuse the upload with another role list (keep v3 behaviour identical), `index.ts` (routes `["mnt.get","GET"]`, `["mnt.photo","POST"]`, handlers with `mntAccess`), `mnt_routes_test.ts`
- Modify: `mnt_read.ts`: `MntList` gains `listings: Array<{ id: string; apt: string; bld: string }>` (every `listing_config` row via `listingMap`, sorted by bld then apt) for the apartment selects; test in `mnt_read_test.ts`
- Modify: `index.ts` push URLs: `notifyMntAssignee` url `APP_URL + "/?mnt=" + ticketId`, `notifyMntUrgent` url `APP_URL + "/?prp=" + proposalId` (find `MNT_PUSH_URL`)

**Interfaces:**
```ts
// mnt.get?ref=MNT-12 | PRP-5
export type MntHistoryItem = { at: string; who: string; kind: "guest" | "comment" | "event"; text: string; photoUrl: string | null };
export type MntTicketDetail = MntTicketRow & { description: string | null; history: MntHistoryItem[];
  photos: Array<{ url: string; at: string }>; resolutionPhotoUrl: string | null; proposal: MntProposalRow | null };
export type MntProposalDetail = MntProposalRow & { sameListingOpen: Array<{ id: number; ref: string; title: string; category: string | null }> };
export async function mntGet(sb: any, ref: string, o?: { nowMs?: number; signUrl?: (path: string) => Promise<string | null> }):
  Promise<{ status: number; body: { kind: "ticket"; ticket: MntTicketDetail } | { kind: "proposal"; proposal: MntProposalDetail } | { error: string } }>;
```
- `history` merges, sorted by `at` ascending: ticket comments (author « Guest » -> kind `guest`, else `comment`), `cleaning_log` rows for `ticket_<id>` with events `mnt_*` turned into readable lines (« created the ticket », « started », « set waiting parts », « closed the ticket », « reopened », « assigned to <name> », « set due date <dd/mm> », « unassigned »), and `photos` rows with `ticket_id`.
- Signed URLs (1 hour) through `signUrl` (in index.ts: `sb.storage.from("cleaning-photos").createSignedUrl(path, 3600)`); a signing failure gives `null`, never an error.
- Unknown ref -> 404 « Not found. »; bad ref -> 400 « Invalid reference. »; read error -> 503 « Maintenance is unavailable right now. Try again. ».
- `mnt.photo`: multipart `{ idem, file, ticketId }`, roles manager or maintenance with email session (`mntAccess`), same type and size limits and storage path rules as `v3.uploadPhoto`, ticket must exist (404 « Not found. »), returns `{ photoId, path }`; the `photos` row carries `ticket_id`.
- [ ] **Step 1: Failing tests** (`mnt_get_test.ts`: ticket with quotes, comments, log events, photos in order; proposal with same-listing open tickets; 404/400; signing failure gives null. `mnt_routes_test.ts`: routes and access present.)
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** whole proxy suite + `deno check index.ts` -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: detail mnt.get, photo mnt.photo, liens des notifications"`.

---

### Task 2: Server, Semax access, Today block, Problems inbox becomes tasks only

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (`mgr.planning` access, `setCancelled`/`setPostponed` role check), `mgr_rules.ts` (new `planningAccess(hasBearer, me)` allowing `manager` and `maintenance`), `mgr_api.ts` + `mgr_today.ts` or a new `mgr_today_mnt.ts` (Today `maintenance` block), `mgr_inbox.ts` / `mgr_problems.ts` (tasks only), `mgr_problem_get.ts`, `mgr_problem_act.ts` (refuse MNT refs)
- Test: `mgr_rules_test.ts`, `mgr_api_test.ts`, `mgr_problems_test.ts`, `mgr_problem_get_test.ts`, `mgr_problem_act_test.ts`, a new `mgr_today_mnt_test.ts`

**Interfaces:**
- `planningAccess` = `mgrAccess` with roles `manager`, `maintenance`. Used by `mgr.planning`. `setCancelled` and `setPostponed` accept `me.role` in (`manager`, `maintenance`) with the same error otherwise.
- Today payload: new field `maintenance: { counts: { proposals: number; proposalsUrgent: number; open: number; urgent: number; unassigned: number }; top: MntTicketRow[] }` (top 5 open tickets: urgent first, then high, then oldest), computed from the same rules as `mnt.list` (reuse `mnt_read.ts` helpers, do not duplicate the stage/origin mapping). `strip`, `who`, `arrivals`, `control`, `ticketsByListing` unchanged. The old `problems` field stays in the payload but now carries team tasks only (for the badge and backward compatibility).
- Inbox: `buildInbox` serves team tasks only; `inboxCounts`/`todayCounts` ticket counts become 0; source filter values for tickets are ignored (no 400). `mgr.problem.get` and `mgr.problem.act` with an `MNT-` ref -> 409 « Open it in Maintenance. ».
- [ ] **Step 1: Failing tests** for each point (maintenance role allowed on `mgr.planning`, refused on `mgr.today`; `setCancelled` with maintenance passes; Today `maintenance` block counts and top order; inbox has no MNT rows; MNT ref refused).
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** whole proxy suite -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: acces Semax au planning, bloc Maintenance de Today, Problems limite aux taches"`.

---

### Task 3: Front shell, roles, navigation, old links, root app cutover

**Files:**
- Modify: `manager/access.js` (allow `maintenance`), `manager/app.js` (`me` keeps `role`; `VIEWS` and `SCREENS` per role; view `maintenance` with module `/manager/screens/maintenance.js` export `renderMaintenance`; view `tasks` with the existing problems module; nav for manager: Today, Planning, Maintenance, Inspections, More; nav for maintenance: Maintenance, Planning; landing `today` for manager, `maintenance` for maintenance; hash outside the role's views -> its landing; `#/problems` -> `#/tasks` keeping the query, except `ref=MNT-` -> `#/maintenance?ref=MNT-`; badge on Maintenance = pending proposals count from an event `mgr:mntbadge`), `manager/ui/dom.js` (icon `maintenance`, stroke wrench), `manager/screens/problems.js` (title « Tasks », hash `#/tasks`, no ticket chips), `manager/screens/more.js` (entry « Tasks » linking `#/tasks`), `manager/screens/more-apartment.js` (ticket links `#/maintenance?ref=MNT-<id>`), `manager/screens/placeholder.js` if it lists views, root `app.js` (`mgrCutoverDue` and `maybeGoManager` and `mgrBannerKind` accept `maintenance`; `mgrCutoverTarget` maps `?mnt=<id>` -> `/manager/#/maintenance?ref=MNT-<id>`, `?prp=<id>` -> `/manager/#/maintenance?ref=PRP-<id>`, `?task=<id>` -> `/manager/#/tasks?ref=TSK-<id>`)
- Create: `manager/screens/maintenance.js` stub exporting `renderMaintenance(ctx)` that renders the header « Maintenance » and « Loading… » (Task 4 replaces it)
- Test: `tests/manager/access.spec.ts` (maintenance now allowed), `tests/manager/shell.spec.ts` (nav per role, redirects), `tests/manager/problems*.spec.ts` (renamed route), `tests/manager/more-apartment.spec.ts`, `tests/mgr-cutover.spec.ts` (maintenance redirected, new query params)

- [ ] **Step 1: Failing tests** for Review Focus 1 and 5 and the cutover params.
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** all `tests/manager` on both projects and `tests/mgr-cutover.spec.ts`, `tests/v3-cutover.spec.ts`, `tests/auth.spec.ts` -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: acces Semax, navigation par role, Tasks dans More, anciens liens"`.

---

### Task 4: Maintenance screen, lists and proposal sheet

**Files:**
- Create: `manager/screens/maintenance.js` (replace the stub), `manager/screens/maintenance-view.js` (pure HTML builders), `manager/ui/maintenance.css` (linked in `manager/index.html`, prefix `mt-`)
- Test: `tests/manager/maintenance.spec.ts`, fixtures `tests/manager/maintenance-fixtures.ts`

**Interfaces and behaviour (mockups 1, 2, 3, 5):**
- Header « Maintenance », « Data as of HH:MM », button « + New ticket ».
- Segmented tabs « Proposals » (red badge with pending count when > 0), « Open · N », « Done ». Hash `#/maintenance?tab=open` keeps the tab; default tab: Proposals when pending > 0, else Open.
- Proposals tab: helper line « Found by Claude in Hostaway guest messages. Check, then create a ticket or reject. »; card per proposal: pills « Urgent » / « High » when not normal, « Guest in now », time (HH:MM today, « Yesterday », else dd/mm), title, `placeLabel · categoryLabel`, last quote in a quote box with « Guest, <dd> to <dd Mon> · Open in Hostaway » (link `https://dashboard.hostaway.com/v3/messages/inbox/<conversationId>` opened in a new tab, rel noopener), buttons « Create ticket » (primary) and « Reject », or when `openTicket` is set « Add to MNT-n » (primary) and « More » (opens the proposal sheet with Create ticket and Reject). Link « See rejected » at the end lists rejected and merged proposals of the last 30 days (`rejected=1`), read only, with reason and who.
- Create ticket sheet (mockup 2): quotes, Title (prefilled), Apartment (select of `mnt.list.listings`, sorted by building then apartment; prefilled), Category select (`MNT_CATEGORY_LABEL` labels), Urgency segmented (Urgent, High, Normal), « Who follows it » chips (team members from `mnt.list.team`, default the active `maintenance` member if any, else the first; plus « Vendor » opening a vendor select, and « Nobody yet »), Note, buttons « Create ticket » / « Back ». Sends `mnt.act` `proposal.accept`. Success: toast « MNT-n created », list refresh, sheet closed.
- Reject sheet: reason chips « Not maintenance », « Already fixed », « Duplicate », « Other » (Other shows a required note), « Reject » / « Back ». Sends `proposal.reject`.
- Add to MNT-n: one tap sends `proposal.merge`, toast « Added to MNT-n ».
- Open tab (mockup 3): filter chips « Mine · n », « Urgent · n », « Unassigned · n » (toggle, one at a time), search input « Search apartment »; groups « To do », « In progress », « Waiting parts », « To confirm » with rows: colour bar by priority, title, ref (mono), place, line « <Priority> · <due or age> · <origin badge> » (origin badges « Guest message », « Cleaner report », « Inspection », « Manual »). Tap opens the ticket sheet (Task 5).
- Done tab (mockup 5): « Last 30 days · N tickets », rows with title, ref, place, « Done by <name>, <day> · AED <cost> » (cost omitted when null, never 0 invented), resolution note in quotes, « Reopen » button (sends `ticket.reopen`).
- `#/maintenance?ref=PRP-5` opens the proposal sheet from `mnt.get`; unknown -> toast « This proposal was not found. ».
- Data: `get('mnt.list', { tab, filter, q, rejected })`; keep last list per tab in memory; on leave remove listeners; `ctx.isCurrent()` before painting; read-only when stale; announce badge count with `mgr:mntbadge`.
- [ ] **Step 1: Failing tests** (tabs and default tab, proposal card content incl. escaped quote with `<b>` shown as text, Open in Hostaway link, create flow posts `proposal.accept` with idem and edited fields, reject with Other requires a note, merge, 409 shown in the sheet then refresh (Review Focus 2), double tap sends one key, Open filters and search params, Done row without cost shows no AED, See rejected, deep link PRP).
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** all `tests/manager` both projects -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: ecran Proposals, Open, Done et validation des propositions"`.

---

### Task 5: Ticket sheet and gestures, new ticket

**Files:**
- Modify: `manager/screens/maintenance.js`, `manager/screens/maintenance-view.js`, `manager/ui/maintenance.css`
- Modify: `manager/api.js` (add `upload(action, formData)` multipart helper with the same headers, timeout 60 s, ApiError kinds)
- Test: `tests/manager/maintenance-ticket.spec.ts`

**Behaviour (mockup 4):**
- Ticket sheet from `mnt.get?ref=MNT-n`: ref and origin line, title, place, category; step bar « Created », « Assigned », « In progress », « Done » (current step outlined); facts: Urgency, Who follows it, Guest (from the linked proposal: « In now, until <day> » or dates), Due; History list (time, who, text; guest quotes in a quote style; photos as thumbnails opening full size); buttons by stage: todo -> « Start » (primary) + « Waiting parts »; in_progress -> « Done » (primary) + « Waiting parts »; waiting_parts -> « Start » + « Done »; to_confirm -> « Done » (« Confirm fixed ») + « Reopen as still broken » (sends `ticket.start`); then « Comment », « Reassign », « Due date » for every open stage.
- Done sheet: note textarea, « Add photo » (file input accept image/*, capture environment), cost input (« Cost (AED), optional », inputmode decimal), « Mark done » / « Back ». Photo: `upload('mnt.photo', { idem, file, ticketId })` first; on failure stay in the sheet with the error (Review Focus 4); then `mnt.act` `ticket.done` with `photoPath`, `note`, `cost` (empty -> not sent).
- Waiting parts sheet: optional note. Comment sheet: required text. Reassign sheet: team chips + vendors + « Nobody » (`ticket.assign`). Due date sheet: date input min today, « Clear date ».
- « + New ticket » sheet: Title, Apartment, Category, Urgency, Who follows it, Note -> `ticket.create`.
- Every gesture: idem via `createGestures`, sheet buttons disabled while sending, server error shown in the sheet, toast with the result, list refresh, deep link `#/maintenance?ref=MNT-n` kept in the hash while the sheet is open (replaceState), back to `#/maintenance` on close; unknown ref -> toast « This ticket was not found. » (Review Focus 3).
- [ ] **Step 1: Failing tests** (each stage's buttons, start, waiting parts with note, done without cost sends no cost, done with cost « 120 », done with photo calls upload then act with the returned path, photo upload failure keeps the sheet and sends no act, comment, reassign to vendor, due date, new ticket, deep link MNT and not found, html in comments shown as text).
- [ ] **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** all `tests/manager` both projects -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: fiche ticket, etapes, photo de cloture, nouveau ticket"`.

---

### Task 6: Today Maintenance block

**Files:**
- Modify: `manager/screens/today-view.js` (replace `problemsHtml` with `maintenanceHtml`), `manager/screens/today.js` (rows open `#/maintenance?ref=MNT-n`; badge from `maintenance.counts.proposals` via `mgr:mntbadge`), `manager/ui/today.css` if needed
- Test: `tests/manager/today-problems.spec.ts` (rewrite as Today Maintenance), `tests/manager/fixtures.ts` (`maintenance` field in `todayBody()`)

**Behaviour:** section « Maintenance » with counts « N proposals to check » (link `#/maintenance`), « N urgent tickets », « N with nobody »; top 5 open tickets rows (bar colour by priority, title, ref, place, stage word) linking `#/maintenance?ref=MNT-n`; footer link « Open maintenance ». Empty: « Nothing open. ».
- [ ] **Step 1: Failing tests.** **Step 2: Run** -> FAIL. **Step 3: Implement.** **Step 4:** all `tests/manager` both projects -> PASS.
- [ ] **Step 5: Commit** `git commit -m "maintenance: bloc Maintenance dans Today"`.

---

### Task 7: Deploy and verify (controller)

- [ ] Check prod proxy == main HEAD; fast-forward main (sw.js stamp patch); `./deploy-proxy.sh`; then `./deploy-front.sh`.
- [ ] Prod checks: `mnt.get` and `mnt.photo` without session -> 401; `mgr.planning` without session -> 401; served `/manager/screens/maintenance.js` 200; served `hr.js` still the uncommitted version.
