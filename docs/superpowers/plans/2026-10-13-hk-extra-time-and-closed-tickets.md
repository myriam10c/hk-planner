# HK Planner · Extra cleaning time + edits on closed tickets · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) An extra cleaning can carry an optional dedicated time, shown wherever the extra appears. (B) A closed maintenance ticket can get a comment, corrected closing details (note, cost) and a photo without being reopened.

**Architecture:** (A) column `extra_cleanings.cleaning_time` (time, nullable); the legacy write actions `addExtraCleaning` / `updateExtraCleaning` accept it; readers (`mgr.planning`, `mgr.today` jobs, `v3.myDay`, the legacy extras list) return it; fronts show it. (B) `mnt.act`: `ticket.comment` allowed on closed tickets, new op `ticket.edit_closed` (note, cost replacement), `mnt.photo` allowed on closed tickets; the Maintenance ticket sheet and Done rows get the buttons.

**Tech Stack:** Deno edge function `supabase/functions/hostaway-proxy` (tests `fakeDb`, Deno `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/`). Fronts: manager app `/manager/` (Playwright `mgr-mobile`, `mgr-desktop`), cleaner app `/v3/` (Playwright `v3-mobile`, `v3-desktop`, node tests `node --test tests/v3-node/*.test.js`), legacy root `app.js` only if it lists extras. Port 8890: `lsof -i :8890` first.

**Requests (13/10/2026):** team: « for extra cleaning, please see if we can add dedicated timing »; Ismael: « if I want to update a completed raised ticket, I don't have that option or access ». Approved designs in conversation.

## Global Constraints

- UI in English. No em dash (U+2014). Comments in French without accents.
- Extra time is optional; without a time every screen behaves exactly as today.
- Time format: stored `HH:MM` (Dubai local, no timezone), input `<input type="time">`, shown `14:00` in manager screens and « 2 PM » / « 2:30 PM » in the cleaner app (same style as the cleaner app's guest times).
- Closed-ticket edits: author from the session, idem on every write, cost never counted twice (a new cost REPLACES the ticket's cost rows like `ticket.done` does), never invent a cost (empty cost keeps the current cost), the ticket stays closed.
- Access unchanged: maintenance actions for manager and maintenance roles; extra writes as today.
- Never edit, format or commit `hr.js`, `styles.css`, `tests/hr.spec.ts`, `tests/laundry.spec.ts`, `sw.js`, `v3/sw.js`. Git: never stash, never `git add -A`, add files by name.

## Review Focus

1. An extra without time still shows « Extra » and sorts as today on Planning, Today and the cleaner app.
2. Editing an extra to clear its time removes it everywhere (null, not « 00:00 »).
3. Edit closing details with cost 80 on a ticket closed with 50 gives exactly one cost row of 80; with an empty cost leaves 50 untouched.
4. A comment on a closed ticket does not change its status, resolved_at or Done row.
5. A cleaner app cached with an old front against the new server still works (extra rows without the time field handled).

---

### Task 1: Server, extra time

**Files:** migration `supabase/migrations/20261013200000_extra_cleaning_time.sql` (`ALTER TABLE public.extra_cleanings ADD COLUMN IF NOT EXISTS cleaning_time time;`); `index.ts` (`addExtraCleaning`, `updateExtraCleaning`: accept `cleaning_time` `HH:MM` or null/empty, 400 « Invalid time. » otherwise; the extras list action returns it); `mgr_planning.ts` (`PlanExtra.cleaningTime: string | null`, job `checkout`-like time for extras so cards sort by time: extras with time sort among the day's jobs by that time, without time stay where they are today), `mgr_today.ts` (job of kind extra gets `extraTime: string | null`), `mgr_extra.ts` if it builds rows, `v3_myday.ts` (extra stop gets `time: "HH:MM" | null`); tests next to each.
- [ ] Failing tests -> implement -> whole proxy suite + `deno check index.ts` -> commit `extras: heure dediee cote serveur`.

### Task 2: Fronts, extra time

**Files:** `manager/screens/planning-view.js` + `planning.js` (Add/Edit extra form field « Time (optional) » next to Date, sent as `cleaning_time`; card and job sheet show the time; sort), `manager/screens/today-view.js` (row time column shows `14:00` with small « extra » instead of « Extra / clean » when a time exists; job sheet sub-line « Extra cleaning, today at 14:00 »), `v3/` (My day row sub-line « Extra cleaning at 2 PM » when time; conversation first bubble « <apt> · extra cleaning at 2 PM »; practice simulator passes it), root `app.js` only if its extras list shows extras (add the time, no new form there); tests in `tests/manager/planning-extras.spec.ts`, `tests/manager/today*.spec.ts`, `tests/v3/*` or `tests/v3-node`.
- [ ] Failing tests -> implement -> `tests/manager` both projects, `tests/v3` both projects, node tests -> commit `extras: heure dediee dans Planning, Today et l'app cleaner`.

### Task 3: Server, closed tickets

**Files:** `mnt_act.ts` (`ticket.comment` allowed whatever the status; new op `ticket.edit_closed` `{ note?, cost? }` only on closed tickets (`isClosed`), else 409 « This ticket is not closed. »; note replaces `resolution_notes` when provided (empty string clears it); cost: same parsing as done (plain decimal >= 0), when provided REPLACES the ticket's `maintenance_costs` rows and `actual_cost` (insert new, delete old by id, like done), when absent leaves cost untouched; logs `mnt_ticket.edit_closed`), `mnt_get.ts` history line « edited the closing details », `mnt_get.ts`/index.ts `mnt.photo` accepts closed tickets (check; the photo appears in history and photos), tests.
- [ ] Failing tests (Review Focus 3, 4) -> implement -> suite + deno check -> commit `maintenance: commentaire, details de cloture et photo sur un ticket ferme`.

### Task 4: Front, closed tickets

**Files:** `manager/screens/maintenance.js`, `maintenance-view.js`, CSS: ticket sheet of a done ticket shows « Reopen » plus « Comment », « Edit closing details », « Add photo »; Edit closing details sheet prefilled with the current note and cost (« Cost (AED), optional »; leaving cost empty keeps the current cost, a hint says so), « Save »; Add photo reuses the shrink + `mnt.photo` upload then refreshes the sheet; Done tab rows get an « Edit » button opening the ticket sheet; tests `tests/manager/maintenance-ticket.spec.ts`.
- [ ] Failing tests -> implement -> `tests/manager` both projects -> commit `maintenance: modifier un ticket ferme sans le rouvrir`.

### Task 5: Deploy (controller)

- [ ] Apply migration; prod proxy == main HEAD; fast-forward main (sw stamp patches); `./deploy-proxy.sh`; `./deploy-front.sh`; prod checks.
