# HK Manager app · Phase 1 (shell + Today) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/manager/`, a new manager-only app (email session only) whose Today screen answers, from one proxy call `mgr.today`, who does what today, what is broken, how the team is doing and whether today's arrivals are ready, with real Assign and Mark done actions whose author comes from the session.

**Architecture:** Proxy side, three new pure-ish modules under `supabase/functions/hostaway-proxy/` (`mgr_rules.ts` for the section 5 status rules, `mgr_today.ts` / `mgr_problems.ts` / `mgr_control.ts` for the four blocks, `mgr_api.ts` to assemble them) behind one route `mgr.today` (role manager, Bearer only), plus a tiny `actor.ts` that makes the session, not the browser, the author of `assignCleaner`, `setDone`, `setCancelled` and `setPostponed` (old app included). Front side, a no-build ES-module app under `manager/` (same approach as `/v3/` and `/inspections/`), reusing `/v3/session.js` and `/v3/proxy-config.js`, with the CSS tokens, fonts, layout, sheet and keyboard of the validated prototype. No service worker for `/manager/` in phase 1: the root `sw.js` skips `/manager/` and Netlify serves it `Cache-Control: no-cache`.

**Tech Stack:** Deno edge function (Supabase), supabase-js service client, Hostaway API via the existing `fetchAllPages`; vanilla JS ES modules, CSS custom properties, Google Fonts (Onest, Fragment Mono); tests with `deno test` on the existing fake DB (`v3_fakedb.ts`) and Playwright on a local static server (`python3 -m http.server 8890`) with `window.fetch` stubbed.

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` (phase 1 of section 9). Validated prototype: `/Users/hillal/Documents/hk-redesign/today-prototype.html`.

## Global Constraints

- Before Task 1, the controller records the base commit: `git rev-parse HEAD` (write the SHA in the task log as `BASE_SHA`). Task 11 needs it.
- Working directory for every command: `/Users/hillal/Documents/Wix new/hk-planner-repo.nosync` (quote the path, it has a space).
- Deno binary: `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno`, always with `--node-modules-dir=none`. Tests run from `supabase/functions/hostaway-proxy` with `deno test --allow-all --node-modules-dir=none <files>`.
- Playwright runs against the working tree: `npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop` (the config's `webServer` starts `python3 -m http.server 8890`). Never against prod, never with real proxy calls.
- Git: never `git add -A`, never `git add .`, never `git stash`. Stage the exact files listed in each task. The tree already carries other people's uncommitted changes (`.gitignore`, `hr.js`, `styles.css`, `sw.js`, `tests/hr.spec.ts`, `tests/laundry.spec.ts`, `v3/sw.js`, and untracked `debug-*.png`, `deno.lock`, `saas/`, older plan and spec docs, `tests/postpone.spec.ts`, `tests/security.spec.ts`, `supabase/migrations/20260812090000_face_towels.sql`): never stage, revert or "tidy" them. Run `git status --short` before Task 1 and keep that list as the baseline. Prod is served from this uncommitted tree.
- Every commit message ends with these two lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK`
- UI text is English. Never an em dash (U+2014) or en dash used as a dash in UI strings: use a comma, a period or " · ". Code comments follow the repo habit (French, no accents needed).
- Status colours (spec section 3), copied verbatim from the prototype tokens: ok `#039855`, warn `#f79009` on `#fef0c7`, bad `#d92d20` on `#fee4e2`, background `#f3f4f7`; dark tokens as in the prototype. Fonts: Onest (text, tabular figures) and Fragment Mono (refs, timestamps). Body text 16 px minimum.
- Dubai time is UTC+4, fixed (no DST). Day boundaries and "HH:MM" displays are Dubai.
- Status rules (spec section 5): Ready = cleaning marked done after the previous checkout and no urgent ticket open; At risk = assigned, not done, arrival within `app_config.mgr_risk_hours` hours (default 6); Blocked = not assigned, or urgent ticket open; owner stay = an arrival; apartment usually cleaned by Elite and not logged yet = amber "Usually Elite · not logged yet" until 14:00 Dubai the day after the cleaning; checkout hour 00:00 in Hostaway = "checkout time not set".
- CSP (`_headers`): `script-src 'self'` (no inline script), styles from `'self'`, inline and `fonts.googleapis.com`, fonts from `fonts.gstatic.com`. Nothing else external.
- Writes sent from `/manager/` never carry an `actor` field: the proxy takes the author from the session.
- `/manager/` access: email session (Bearer) and role `manager` only. Cleaner goes to `/v3/`, any other role to `/`, PIN-only manager gets a "Sign in with your email" screen.
- Client timeout 15 s on every proxy call, then a clear message and a Retry button. Last `mgr.today` cached locally with its time; never a blank screen.

## Review Focus

1. **Checkout time 00:00 in Hostaway** (`checkOutTime` 0 or null): expect "checkout time not set" in the arrival cause and the job line, `--:--` in the time column, and no invented turnaround. Tests: Task 2 (`arrivalStatus`), Task 3 (job `checkout: null`), Task 8 (screen).
2. **Elite logs its jobs the next day around 14:00**: an unassigned cleaning on an apartment usually cleaned by Elite must be amber "Usually Elite · not logged yet" until 14:00 Dubai the next day, red after; Elite's "yesterday" line must say "Not logged yet" before 14:00. Tests: Task 2, Task 3, Task 5, Task 8.
3. **Owner stays**: an `ownerStay` arrival is an arrival ("Owner stay"), an `ownerStay` departure is a cleaning; an `inquiry` is neither. Tests: Task 3.
4. **Manager whose device only has a PIN session**: proxy answers 403 `email sign-in required` to `mgr.today`; the screen says "Sign in with your email" and never calls `mgr.today`. Tests: Task 6 (`mgrAccess`), Task 7 (screen).
5. **Proxy slow or down (07/10 incident)**: after 15 s the client stops waiting, shows "HK Planner is taking too long to answer. Try again." with Retry; with a cache it shows the last Today with "Data from HH:MM"; with Hostaway down the proxy answers 503 with a readable message. Tests: Task 6 (503), Task 9 (timeout, cache, no blank screen).

## File Structure

Proxy (`supabase/functions/hostaway-proxy/`):
- Create `actor.ts` / `actor_test.ts`: `sessionActor(me, bodyActor)`, author of a write.
- Create `mgr_rules.ts` / `mgr_rules_test.ts`: pure rules (reservation normalisation, cleaning key, labels, durations, "usually Elite", `arrivalStatus`, `mgrAccess`, `parseRiskHours`).
- Create `mgr_today.ts` / `mgr_today_test.ts`: `loadCore` (all table reads for Today), `buildJobs`, `buildWho`, `buildArrivals`, `buildTicketsByListing`.
- Create `mgr_problems.ts` / `mgr_problems_test.ts`: problems counts and top 5.
- Create `mgr_control.ts` / `mgr_control_test.ts`: team control block.
- Create `mgr_api.ts` / `mgr_api_test.ts`: `mgrToday` assembles the response.
- Modify `insp_reservations.ts` (+ test): optional `cacheKey`, generic row type.
- Modify `index.ts`: imports, `sessionActor` in four write handlers, route `mgr.today`, `loadMgrReservations`.

Front (`manager/`):
- `index.html`, `ui/theme.js` (classic script, theme before paint), `ui/tokens.css`, `ui/components.css`, `ui/today.css`, `ui/dom.js` (escape, icons, sheet, toast, theme), `api.js` (proxy calls, 15 s timeout), `access.js` (who may enter), `app.js` (boot, router, navigation), `screens/placeholder.js`, `screens/today.js` (controller), `screens/today-view.js` (pure HTML), `today-cache.js`.

Other:
- Modify `sw.js` (skip `/manager/`), `_headers` (no-cache), `playwright.config.ts` (projects `mgr-mobile` 390 px, `mgr-desktop` 1440 px).
- Tests: `tests/manager/helpers.ts`, `fixtures.ts`, `access.spec.ts`, `shell.spec.ts`, `today.spec.ts`, `today-offline.spec.ts`, `today-actions.spec.ts`.

---

### Task 1: Author of writes taken from the session

**Files:**
- Create: `supabase/functions/hostaway-proxy/actor.ts`
- Create: `supabase/functions/hostaway-proxy/actor_test.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (imports at top; `setDone` ~line 1516; `setCancelled` ~line 1534; `setPostponed` ~line 1554; `assignCleaner` ~line 2070)

**Interfaces:**
- Consumes: `SessionUser` from `auth.ts` (`{ cleaner_id: number; name: string; role: string; color: string }`), `currentUser(sb, req)` already imported in `index.ts`.
- Produces: `sessionActor(me: SessionUser | null, bodyActor: unknown): string` and `NO_SESSION_ACTOR = "unknown (no session)"`. Hermes server jobs (`Hermes_AutoAssign`, `Hermes_Brain`, no session, only `X-App-Secret`) keep their name; any other browser value is ignored.

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/actor_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { NO_SESSION_ACTOR, sessionActor } from "./actor.ts";

const ME = { cleaner_id: 9, name: "Harlene", role: "manager", color: "#000" };

Deno.test("session presente : le nom de la session, la valeur du navigateur est ignoree", () => {
  assertEquals(sessionActor(ME, "Manager"), "Harlene");
  assertEquals(sessionActor(ME, "Hermes_AutoAssign"), "Harlene");
  assertEquals(sessionActor(ME, undefined), "Harlene");
});

Deno.test("sans session : seuls les jobs serveur Hermes gardent leur nom", () => {
  assertEquals(sessionActor(null, "Hermes_AutoAssign"), "Hermes_AutoAssign");
  assertEquals(sessionActor(null, "Hermes_Brain"), "Hermes_Brain");
});

Deno.test("sans session : un nom libre du navigateur n'est jamais repris", () => {
  for (const v of ["Manager", "Hillal", "Hermes AutoAssign", "Hermes_", "Hermes_x<script>", "", null, 42]) {
    assertEquals(sessionActor(null, v), NO_SESSION_ACTOR);
  }
});

Deno.test("nom de session vide : traite comme sans session", () => {
  assertEquals(sessionActor({ ...ME, name: "  " }, "Hermes_Brain"), "Hermes_Brain");
  assertEquals(sessionActor({ ...ME, name: "  " }, "Walter"), NO_SESSION_ACTOR);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none actor_test.ts`
Expected: FAIL, `Module not found ".../actor.ts"`.

- [ ] **Step 3: Write minimal implementation**

`supabase/functions/hostaway-proxy/actor.ts`:

```ts
// Auteur d'une ecriture (spec 2026-10-09-hk-manager-app-design.md, section 6,
// « Tracabilite ») : toujours le membre de la session, jamais la valeur envoyee
// par le navigateur (l'ancienne app envoyait « Manager » pour tous les managers).
// Seule exception : les jobs serveur Hermes (auto_assign_elite_cleanings.py,
// executors/ops.py) appellent avec le seul X-App-Secret, sans session ; leur
// nom tient dans un motif ferme, un nom libre ne passe jamais.
import type { SessionUser } from "./auth.ts";

export const NO_SESSION_ACTOR = "unknown (no session)";
const SERVER_ACTOR_RE = /^Hermes_[A-Za-z]{1,40}$/;

export function sessionActor(me: SessionUser | null, bodyActor: unknown): string {
  const name = me && typeof me.name === "string" ? me.name.trim() : "";
  if (name) return name;
  if (typeof bodyActor === "string" && SERVER_ACTOR_RE.test(bodyActor)) return bodyActor;
  return NO_SESSION_ACTOR;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 4 passed | 0 failed`.

- [ ] **Step 5: Wire it into the four write handlers of `index.ts`**

Add the import after the `security_contacts.ts` import line:

```ts
import { sessionActor } from "./actor.ts";
```

In `setDone`, replace:

```ts
      const body = await req.json();
      const { key, done: isDone, actor } = body;
      if (!key || typeof isDone !== "boolean") return jsonResp({ error: "key and done required" }, 400);
```

with:

```ts
      const body = await req.json();
      const { key, done: isDone } = body;
      if (!key || typeof isDone !== "boolean") return jsonResp({ error: "key and done required" }, 400);
      // Auteur pris dans la session (spec manager, section 6), body.actor ignore
      // sauf pour les jobs serveur Hermes sans session.
      const actor = sessionActor(await currentUser(sb, req), body.actor);
```

In `setCancelled`, replace:

```ts
      const { key, cancelled, reason, actor } = body;
```

with:

```ts
      const { key, cancelled, reason } = body;
      const actor = sessionActor(me, body.actor);
```

and in the same handler replace `cancelled_by: actor || "Manager",` with `cancelled_by: actor,`.

In `setPostponed`, replace:

```ts
      const { key, postpone, new_date, original_date, actor } = body;
```

with:

```ts
      const { key, postpone, new_date, original_date } = body;
      const actor = sessionActor(me, body.actor);
```

and in the same handler replace `postponed_by: actor || "Manager",` with `postponed_by: actor,`.

In `assignCleaner`, replace:

```ts
      const { reservation_key, cleaner_id, cleaner_ids, mode, actor, service_type } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
```

with:

```ts
      const { reservation_key, cleaner_id, cleaner_ids, mode, service_type } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      // Auteur pris dans la session (spec manager, section 6), body.actor ignore
      // sauf pour les jobs serveur Hermes sans session.
      const actor = sessionActor(await currentUser(sb, req), body.actor);
```

The rest of each handler keeps using `actor` unchanged.

- [ ] **Step 6: Type-check and verify no browser actor is left in these handlers**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts && grep -n 'actor || "Manager"' index.ts; grep -c "sessionActor" index.ts`
Expected: `deno check` silent (exit 0), the first grep prints nothing, the count prints `5` (import + 4 handlers).

- [ ] **Step 7: Run the whole proxy test suite (regression)**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: all tests pass, 0 failed.

- [ ] **Step 8: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add supabase/functions/hostaway-proxy/actor.ts supabase/functions/hostaway-proxy/actor_test.ts supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: auteur des ecritures pris dans la session (assignCleaner, setDone, setCancelled, setPostponed), Hermes sans session garde son nom

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---

### Task 2: Status rules of section 5 (`mgr_rules.ts`)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_rules.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_rules_test.ts`

**Interfaces:**
- Consumes: `plusDays(date: string, n: number): string` from `v3.ts`.
- Produces (all exported from `mgr_rules.ts`):
  - constants `MGR_DEFAULT_RISK_HOURS = 6`, `MGR_DEFAULT_CHECKIN_HOUR = 15`, `MGR_LOOKBACK_DAYS = 14`, `MGR_ELITE_LOG_HOUR = 14`, `MGR_USUALLY_ELITE_MIN_JOBS = 2`, `MGR_USUALLY_ELITE_WINDOW_DAYS = 60`
  - `type Tone = "ok" | "warn" | "bad" | "idle"`, `type Status = { tone: Tone; word: string; cause: string }`
  - `type MgrReservation = { id: string; listingId: string; guest: string; arrival: string; departure: string; status: string; checkInTime: number | null; checkOutTime: number | null }`
  - `type PrevCleaning = { key: string; checkoutDate: string; checkoutHour: number | null; cleaningDate: string; assignedNames: string[]; done: boolean; started: boolean; cancelled: boolean; usuallyElite: boolean }`
  - `normalizeMgrReservations(raw: any[]): MgrReservation[]`
  - `reservationKey(r: { departure: string; guest: string }): string` (mirror of `keyFor()` in `app.js`: `${checkOut}_${guest||'Guest'}`)
  - `keyDate(key: string): string | null`
  - `hhmm(h: number | null): string | null`, `ddmm(day: string): string`, `dubaiMs(day: string, hour: number): number`, `fmtDur(ms: number): string`, `joinNames(a: string[]): string`, `plural(n: number, word: string): string`
  - `splitListing(row): { apt: string; bld: string }`
  - `byRoleThenName(a: { role: string; name: string }, b: { role: string; name: string }): number`
  - `usuallyEliteListings(rows: Array<{ listing_id: unknown; cleaning_date: unknown }>, day: string): Set<string>`
  - `eliteLogDeadlineMs(cleaningDate: string): number`
  - `arrivalStatus(i: { day: string; nowMs: number; arrivalMs: number; riskHours: number; prev: PrevCleaning | null; urgent: Array<{ id: number; title: string }> }): Status`

Decision recorded here (spec is silent): an assigned, not-done cleaning whose guest arrives in more than `riskHours` is neither Ready, At risk nor Blocked; it gets the neutral tone `idle`, word `Scheduled` (grey bar). An arrival with no checkout in the last 14 days is `Ready` with the cause "No checkout in the last 14 days, apartment empty." unless an urgent ticket is open.

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_rules_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  arrivalStatus, byRoleThenName, dubaiMs, eliteLogDeadlineMs, fmtDur, hhmm, joinNames, keyDate,
  normalizeMgrReservations, plural, reservationKey, splitListing, usuallyEliteListings,
  type PrevCleaning,
} from "./mgr_rules.ts";

const DAY = "2026-10-09";
const at = (dubaiHHMM: string) => Date.parse(DAY + "T" + dubaiHHMM + ":00+04:00");
const ARR_15 = at("15:00");
const P = (o: Partial<PrevCleaning> = {}): PrevCleaning => ({
  key: DAY + "_Ann Lee", checkoutDate: DAY, checkoutHour: 12, cleaningDate: DAY,
  assignedNames: [], done: false, started: false, cancelled: false, usuallyElite: false, ...o,
});
const GAS = { id: 429, title: "Gas not working" };
const st = (prev: PrevCleaning | null, nowMs: number, o: any = {}) =>
  arrivalStatus({ day: DAY, nowMs, arrivalMs: ARR_15, riskHours: 6, prev, urgent: [], ...o });

Deno.test("normalise : guest, heure 00:00 = absente, doublons", () => {
  const raw = [
    { id: 1, listingMapId: 55, guestName: "Ann Lee", arrivalDate: "2026-10-06", departureDate: DAY, status: "confirmed", checkInTime: 15, checkOutTime: 0 },
    { id: 1, listingMapId: 55, guestName: "Ann Lee", arrivalDate: "2026-10-06", departureDate: DAY, status: "confirmed" },
    { id: 2, listingId: 56, guestFirstName: "Bob", guestLastName: "Ray", arrivalDate: DAY, departureDate: "2026-10-12", status: "ownerStay", checkInTime: "16", checkOutTime: 11 },
    { id: 3, arrivalDate: DAY, departureDate: "2026-10-12", status: "confirmed" },
  ];
  assertEquals(normalizeMgrReservations(raw), [
    { id: "1", listingId: "55", guest: "Ann Lee", arrival: "2026-10-06", departure: DAY, status: "confirmed", checkInTime: 15, checkOutTime: null },
    { id: "2", listingId: "56", guest: "Bob Ray", arrival: DAY, departure: "2026-10-12", status: "ownerStay", checkInTime: 16, checkOutTime: 11 },
  ]);
});

Deno.test("cle de menage : miroir de keyFor, Guest par defaut ; date d'une cle", () => {
  assertEquals(reservationKey({ departure: DAY, guest: "Ann Lee" }), "2026-10-09_Ann Lee");
  assertEquals(reservationKey({ departure: DAY, guest: "" }), "2026-10-09_Guest");
  assertEquals(keyDate("2026-10-07_Jo La"), "2026-10-07");
  assertEquals(keyDate("extra_2026-10-09_deep"), "2026-10-09");
  assertEquals(keyDate("nope"), null);
});

Deno.test("formats : heures, durees, noms, pluriels, heure Dubai", () => {
  assertEquals(hhmm(9), "09:00");
  assertEquals(hhmm(null), null);
  assertEquals(fmtDur(3 * 3600_000), "3 h");
  assertEquals(fmtDur(150 * 60_000), "2 h 30");
  assertEquals(fmtDur(65 * 60_000), "1 h 05");
  assertEquals(fmtDur(30 * 60_000), "30 min");
  assertEquals(joinNames(["Faiza"]), "Faiza");
  assertEquals(joinNames(["Faiza", "Pionah"]), "Faiza and Pionah");
  assertEquals(joinNames(["A", "B", "C"]), "A, B and C");
  assertEquals(plural(1, "cleaning"), "1 cleaning");
  assertEquals(plural(0, "cleaning"), "0 cleanings");
  assertEquals(dubaiMs(DAY, 15), Date.parse("2026-10-09T11:00:00Z"));
});

Deno.test("logement : numero et immeuble", () => {
  assertEquals(splitListing({ internal_name: "623 - Azizi Riviera 20" }), { apt: "623", bld: "Azizi Riviera 20" });
  assertEquals(splitListing({ internal_name: "", listing_name: "Nice flat", apt_number: "12" }), { apt: "12", bld: "Nice flat" });
  assertEquals(splitListing(null), { apt: "", bld: "Apartment" });
});

Deno.test("tri : cleaners, puis sous-traitant, puis le reste, par nom", () => {
  const l = [
    { role: "manager", name: "Semax" }, { role: "subcontractor", name: "Elite Cleaning" },
    { role: "cleaner", name: "Pionah" }, { role: "cleaner", name: "Faiza" },
  ];
  assertEquals(l.sort(byRoleThenName).map((x) => x.name), ["Faiza", "Pionah", "Elite Cleaning", "Semax"]);
});

Deno.test("habituellement Elite : au moins 2 jobs dans les 60 jours avant le jour", () => {
  const rows = [
    { listing_id: 3, cleaning_date: "2026-09-20" }, { listing_id: 3, cleaning_date: "2026-09-28" },
    { listing_id: "L4", cleaning_date: "2026-09-21" },
    { listing_id: "L5", cleaning_date: "2026-07-01" }, { listing_id: "L5", cleaning_date: "2026-07-02" },
    { listing_id: "L6", cleaning_date: DAY }, { listing_id: "L6", cleaning_date: DAY },
  ];
  assertEquals([...usuallyEliteListings(rows, DAY)], ["3"]);
  assertEquals(eliteLogDeadlineMs("2026-10-08"), Date.parse("2026-10-09T10:00:00Z"));
});

Deno.test("Ready : menage fait, aucun ticket urgent", () => {
  assertEquals(st(P({ done: true, assignedNames: ["Faiza"] }), at("11:00")),
    { tone: "ok", word: "Ready", cause: "Cleaned by Faiza after the 12:00 checkout." });
  assertEquals(st(P({ done: true, assignedNames: ["Faiza"], checkoutHour: null }), at("11:00")).cause,
    "Cleaned by Faiza after today's checkout (checkout time not set).");
  assertEquals(st(P({ done: true, assignedNames: ["Elite Cleaning"], checkoutDate: "2026-10-05", cleaningDate: "2026-10-05" }), at("11:00")).cause,
    "Cleaned by Elite Cleaning after the 05/10 checkout.");
});

Deno.test("Blocked : ticket urgent, meme menage fait", () => {
  assertEquals(st(P({ done: true, assignedNames: ["Faiza"] }), at("11:00"), { urgent: [GAS] }),
    { tone: "bad", word: "Blocked", cause: "Clean, but urgent ticket open: Gas not working (#429)." });
  assertEquals(st(P(), at("11:00"), { urgent: [GAS] }).cause,
    "No cleaner assigned, and urgent ticket open: Gas not working (#429).");
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("11:00"), { urgent: [GAS] }).cause,
    "Urgent ticket open: Gas not working (#429).");
});

Deno.test("Blocked : non assigne, avec rotation ; heure de depart absente", () => {
  assertEquals(st(P(), at("11:00")),
    { tone: "bad", word: "Blocked", cause: "No cleaner assigned. Checkout 12:00, 3 h turnaround." });
  assertEquals(st(P({ checkoutHour: null }), at("11:00")).cause, "No cleaner assigned. Checkout time not set.");
});

Deno.test("Elite le lendemain : ambre avant 14:00 le lendemain du menage, rouge apres", () => {
  const prev = P({ checkoutDate: "2026-10-08", cleaningDate: "2026-10-08", usuallyElite: true });
  assertEquals(st(prev, Date.parse("2026-10-09T09:59:00Z")), {
    tone: "warn", word: "At risk",
    cause: "Usually Elite · not logged yet. Elite logs its jobs the next day around 14:00.",
  });
  assertEquals(st(prev, Date.parse("2026-10-09T10:00:00Z")),
    { tone: "bad", word: "Blocked", cause: "No cleaner assigned. Checkout 08/10." });
  assertEquals(st(prev, Date.parse("2026-10-09T09:00:00Z"), { urgent: [GAS] }).tone, "bad");
});

Deno.test("At risk : assigne, pas fait, arrivee dans le seuil", () => {
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("11:00")),
    { tone: "warn", word: "At risk", cause: "Not started yet, Faiza. Guest in 4 h, checkout 12:00." });
  assertEquals(st(P({ assignedNames: ["Faiza", "Pionah"], started: true }), at("12:30")).cause,
    "Cleaning in progress, Faiza and Pionah. Guest in 2 h 30, checkout 12:00.");
  assertEquals(st(P({ assignedNames: ["Faiza"], checkoutHour: null }), at("11:00")).cause,
    "Not started yet, Faiza. Guest in 4 h, checkout time not set.");
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("15:30")).cause,
    "Not started yet, Faiza. Guest due now, checkout 12:00.");
});

Deno.test("Scheduled : assigne, arrivee au-dela du seuil ; seuil configurable", () => {
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("06:00")),
    { tone: "idle", word: "Scheduled", cause: "Not cleaned yet, Faiza assigned. Guest in 9 h." });
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("06:00"), { riskHours: 10 }).tone, "warn");
  assertEquals(st(P({ assignedNames: ["Faiza"] }), at("11:00"), { riskHours: 2 }).tone, "idle");
});

Deno.test("annule, reporte, aucun depart connu", () => {
  assertEquals(st(P({ cancelled: true }), at("11:00")).cause, "Cleaning cancelled in HK Planner after the 12:00 checkout.");
  assertEquals(st(P({ cleaningDate: "2026-10-10", assignedNames: ["Faiza"] }), at("11:00")),
    { tone: "bad", word: "Blocked", cause: "Cleaning postponed to 10/10." });
  assertEquals(st(null, at("11:00")),
    { tone: "ok", word: "Ready", cause: "No checkout in the last 14 days, apartment empty." });
  assertEquals(st(null, at("11:00"), { urgent: [GAS] }),
    { tone: "bad", word: "Blocked", cause: "Urgent ticket open: Gas not working (#429)." });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_rules_test.ts`
Expected: FAIL, `Module not found ".../mgr_rules.ts"`.

- [ ] **Step 3: Write minimal implementation**

`supabase/functions/hostaway-proxy/mgr_rules.ts`:

```ts
// Regles pures de l'app manager /manager/ (spec 2026-10-09-hk-manager-app-design.md,
// section 5). Aucune base, aucun reseau : tout ce qui decide d'un statut vit ici.
import { plusDays } from "./v3.ts";

export const MGR_DEFAULT_RISK_HOURS = 6;
// Heure d'arrivee supposee quand Hostaway n'en donne pas (check-in standard).
export const MGR_DEFAULT_CHECKIN_HOUR = 15;
// Fenetre des departs lus dans Hostaway pour retrouver le menage precedent.
export const MGR_LOOKBACK_DAYS = 14;
// Elite saisit ses jobs le lendemain vers 14:00 Dubai (Hermes auto-assign + done).
export const MGR_ELITE_LOG_HOUR = 14;
export const MGR_USUALLY_ELITE_MIN_JOBS = 2;
export const MGR_USUALLY_ELITE_WINDOW_DAYS = 60;

const H = 3600_000;
const DUBAI_OFFSET_MS = 4 * H;

export type Tone = "ok" | "warn" | "bad" | "idle";
export type Status = { tone: Tone; word: string; cause: string };
export type MgrReservation = {
  id: string; listingId: string; guest: string; arrival: string; departure: string; status: string;
  checkInTime: number | null; checkOutTime: number | null;
};
export type PrevCleaning = {
  key: string;
  checkoutDate: string;          // depart du sejour precedent
  checkoutHour: number | null;   // heure Hostaway, null = 00:00 / absente
  cleaningDate: string;          // checkoutDate, ou cleaning_postponed.new_date
  assignedNames: string[];
  done: boolean; started: boolean; cancelled: boolean;
  usuallyElite: boolean;
};

// Hostaway rend des heures entieres ; 0 (minuit) veut dire « non renseignee ».
const heure = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 24 ? Math.floor(n) : null;
};

export function normalizeMgrReservations(raw: any[]): MgrReservation[] {
  const seen = new Set<string>();
  const out: MgrReservation[] = [];
  for (const r of raw ?? []) {
    const listingId = String(r?.listingMapId ?? r?.listingId ?? "");
    if (!listingId || !r?.arrivalDate || !r?.departureDate) continue;
    const id = r?.id != null ? String(r.id) : listingId + "|" + r.arrivalDate + "|" + r.departureDate;
    if (seen.has(id)) continue;
    seen.add(id);
    // Meme calcul que buildCheckoutsPayload (index.ts) : la cle de menage en depend.
    const guest = String(r?.guestName || ((r?.guestFirstName || "") + " " + (r?.guestLastName || "")).trim() || "");
    out.push({
      id, listingId, guest, arrival: String(r.arrivalDate), departure: String(r.departureDate),
      status: String(r.status ?? ""), checkInTime: heure(r.checkInTime), checkOutTime: heure(r.checkOutTime),
    });
  }
  return out;
}

// Miroir de keyFor() dans app.js : `${checkOut}_${guest||'Guest'}`.
export function reservationKey(r: { departure: string; guest: string }): string {
  return r.departure + "_" + (r.guest || "Guest");
}

export function keyDate(key: string): string | null {
  const m = String(key || "").match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}

export function hhmm(h: number | null): string | null {
  return h == null ? null : String(h).padStart(2, "0") + ":00";
}
export function ddmm(day: string): string {
  return String(day).slice(8, 10) + "/" + String(day).slice(5, 7);
}
// Instant UTC de « day a hour:00 » heure de Dubai.
export function dubaiMs(day: string, hour: number): number {
  return Date.parse(day + "T00:00:00Z") + hour * H - DUBAI_OFFSET_MS;
}
export function fmtDur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? h + " h" + (r ? " " + String(r).padStart(2, "0") : "") : r + " min";
}
export function joinNames(a: string[]): string {
  if (a.length <= 1) return a[0] ?? "";
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}
export function plural(n: number, word: string): string {
  return n + " " + word + (n === 1 ? "" : "s");
}

// Meme lecture que listingLabel (insp_rules.ts), en deux morceaux.
export function splitListing(
  row: { internal_name?: string | null; listing_name?: string | null; apt_number?: string | null } | null | undefined,
): { apt: string; bld: string } {
  const s = String(row?.internal_name ?? "").trim();
  const m = s.match(/^([A-Za-z]*\d[A-Za-z0-9]*)(?:\s*[-|·]\s*|\s+)(.+)$/);
  if (m) return { apt: m[1], bld: m[2].trim() };
  return { apt: String(row?.apt_number ?? "").trim(), bld: s || String(row?.listing_name ?? "").trim() || "Apartment" };
}

const ROLE_ORDER: Record<string, number> = { cleaner: 0, subcontractor: 1 };
export function byRoleThenName(a: { role: string; name: string }, b: { role: string; name: string }): number {
  return (ROLE_ORDER[a.role] ?? 2) - (ROLE_ORDER[b.role] ?? 2) || a.name.localeCompare(b.name);
}

// Lignes de cleaning_accounting_cache.payload_json.rows : une ligne par job Elite.
export function usuallyEliteListings(rows: Array<{ listing_id: unknown; cleaning_date: unknown }>, day: string): Set<string> {
  const from = plusDays(day, -MGR_USUALLY_ELITE_WINDOW_DAYS);
  const n: Record<string, number> = {};
  for (const r of rows ?? []) {
    const d = String(r?.cleaning_date ?? "");
    const lid = r?.listing_id == null ? "" : String(r.listing_id);
    if (!lid || d < from || d >= day) continue;
    n[lid] = (n[lid] ?? 0) + 1;
  }
  return new Set(Object.keys(n).filter((k) => n[k] >= MGR_USUALLY_ELITE_MIN_JOBS));
}

export function eliteLogDeadlineMs(cleaningDate: string): number {
  return dubaiMs(plusDays(cleaningDate, 1), MGR_ELITE_LOG_HOUR);
}

function checkoutPhrase(p: PrevCleaning, day: string): string {
  if (p.checkoutDate !== day) return "checkout " + ddmm(p.checkoutDate);
  return p.checkoutHour == null ? "checkout time not set" : "checkout " + hhmm(p.checkoutHour);
}
function afterPhrase(p: PrevCleaning, day: string): string {
  if (p.checkoutDate !== day) return "the " + ddmm(p.checkoutDate) + " checkout";
  return p.checkoutHour == null ? "today's checkout (checkout time not set)" : "the " + hhmm(p.checkoutHour) + " checkout";
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function arrivalStatus(i: {
  day: string; nowMs: number; arrivalMs: number; riskHours: number;
  prev: PrevCleaning | null; urgent: Array<{ id: number; title: string }>;
}): Status {
  const u = i.urgent[0];
  const tk = u ? u.title + " (#" + u.id + ")" : "";
  const p = i.prev;
  if (!p) {
    if (u) return { tone: "bad", word: "Blocked", cause: "Urgent ticket open: " + tk + "." };
    return { tone: "ok", word: "Ready", cause: "No checkout in the last " + MGR_LOOKBACK_DAYS + " days, apartment empty." };
  }
  if (p.done) {
    if (u) return { tone: "bad", word: "Blocked", cause: "Clean, but urgent ticket open: " + tk + "." };
    return {
      tone: "ok", word: "Ready",
      cause: "Cleaned" + (p.assignedNames.length ? " by " + joinNames(p.assignedNames) : "") + " after " + afterPhrase(p, i.day) + ".",
    };
  }
  const extra = u ? " Urgent ticket open: " + tk + "." : "";
  if (p.cancelled) return { tone: "bad", word: "Blocked", cause: "Cleaning cancelled in HK Planner after " + afterPhrase(p, i.day) + "." + extra };
  if (p.cleaningDate > i.day) return { tone: "bad", word: "Blocked", cause: "Cleaning postponed to " + ddmm(p.cleaningDate) + "." + extra };
  if (!p.assignedNames.length) {
    if (u) return { tone: "bad", word: "Blocked", cause: "No cleaner assigned, and urgent ticket open: " + tk + "." };
    if (p.usuallyElite && i.nowMs < eliteLogDeadlineMs(p.cleaningDate)) {
      return {
        tone: "warn", word: "At risk",
        cause: "Usually Elite · not logged yet. Elite logs its jobs the next day around " + hhmm(MGR_ELITE_LOG_HOUR) + ".",
      };
    }
    const turn = p.checkoutDate === i.day && p.checkoutHour != null
      ? ", " + fmtDur(i.arrivalMs - dubaiMs(i.day, p.checkoutHour)) + " turnaround" : "";
    return { tone: "bad", word: "Blocked", cause: "No cleaner assigned. " + cap(checkoutPhrase(p, i.day)) + turn + "." };
  }
  if (u) return { tone: "bad", word: "Blocked", cause: "Urgent ticket open: " + tk + "." };
  const left = i.arrivalMs - i.nowMs;
  const who = joinNames(p.assignedNames);
  if (left <= i.riskHours * H) {
    const guest = left > 0 ? "Guest in " + fmtDur(left) : "Guest due now";
    return {
      tone: "warn", word: "At risk",
      cause: (p.started ? "Cleaning in progress, " : "Not started yet, ") + who + ". " + guest + ", " + checkoutPhrase(p, i.day) + ".",
    };
  }
  return { tone: "idle", word: "Scheduled", cause: "Not cleaned yet, " + who + " assigned. Guest in " + fmtDur(left) + "." };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 13 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add supabase/functions/hostaway-proxy/mgr_rules.ts supabase/functions/hostaway-proxy/mgr_rules_test.ts
git commit -m "manager: regles de statut des arrivees (section 5 de la spec), Elite le lendemain, heure de depart absente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---
### Task 3: Today core: table reads, cleanings, "Who does what", arrivals (`mgr_today.ts`)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_today.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_today_test.ts`

**Interfaces:**
- Consumes (Task 2): `MgrReservation`, `PrevCleaning`, `Tone`, `arrivalStatus`, `byRoleThenName`, `ddmm`, `dubaiMs`, `eliteLogDeadlineMs`, `hhmm`, `MGR_DEFAULT_CHECKIN_HOUR`, `MGR_LOOKBACK_DAYS`, `MGR_USUALLY_ELITE_WINDOW_DAYS`, `reservationKey`, `splitListing`, `usuallyEliteListings`. From `insp_rules.ts`: `INSP_VALID_STATUSES` (`new, modified, confirmed, ownerStay, reserved`), `dubaiDay(iso)`. From `v3.ts`: `plusDays`.
- Produces (exported from `mgr_today.ts`):
  - `MGR_OPEN_TICKET_STATUSES = ["open", "assigned", "in_progress"]`
  - `readOrThrow(res: any, what: string): any[]`, `byKeys(sb: any, table: string, cols: string, keys: string[]): Promise<any[]>` (reads by `reservation_key` in chunks of 100)
  - `type MgrPerson = { id: number; name: string; role: string; active: boolean }`
  - `type MgrTicket = { id: number; listingId: string; title: string; priority: string; status: string; techId: number | null; vendorId: number | null; createdAt: string; source: string }`
  - `type MgrCore = { day: string; nowMs: number; riskHours: number; reservations: MgrReservation[]; listings: Record<string, { apt: string; bld: string }>; people: Record<string, MgrPerson>; tickets: MgrTicket[]; eliteListings: Set<string>; postponed: Record<string, string>; assignments: Record<string, Array<{ cleanerId: number; serviceType: string }>>; done: Set<string>; started: Set<string>; cancelled: Set<string>; extras: Array<{ key: string; listingId: string; label: string }> }`
  - `loadCore(sb: any, a: { day: string; nowMs: number; riskHours: number; reservations: MgrReservation[] }): Promise<MgrCore>`
  - `type MgrNext = { date: string; time: string | null; sameDay: boolean; owner: boolean }`
  - `type MgrJob = { key: string; kind: "checkout" | "extra"; listingId: string; apt: string; bld: string; checkout: string | null; checkoutDate: string; postponedFrom: string | null; next: MgrNext | null; assigned: number[]; serviceType: string | null; state: "done" | "in_progress" | "not_started"; tone: Tone; word: string }`
  - `buildJobs(c: MgrCore): MgrJob[]`
  - `type MgrWho = { jobs: MgrJob[]; people: Array<{ id: number; name: string; role: string; keys: string[] }>; unassigned: string[]; technicians: Array<{ id: number; name: string; open: number; oldest: { id: number; title: string; since: string } | null }> }`
  - `buildWho(c: MgrCore, jobs: MgrJob[]): MgrWho`
  - `type MgrArrival = { id: string; listingId: string; apt: string; bld: string; time: string; timeSet: boolean; kind: "Guest" | "Owner stay"; tone: Tone; word: string; cause: string; prevKey: string | null; prevCheckout: { date: string; time: string | null } | null; cleaners: string[]; assigned: number[]; serviceType: string | null; done: boolean }`
  - `type MgrArrivals = { counts: Record<Tone, number>; rows: MgrArrival[] }`
  - `buildArrivals(c: MgrCore): MgrArrivals`
  - `type MgrTicketLite = { id: number; title: string; priority: string; since: string; tech: string | null }`
  - `buildTicketsByListing(c: MgrCore): Record<string, MgrTicketLite[]>`

Where the data comes from: Hostaway reservations (passed in, Task 6 loads them: departures of the last 14 days and arrivals of the next 14 days), `extra_cleanings` (today), `cleaning_postponed`, `cleaning_assignments`, `menage_done`, `cleaning_timer`, `cleaning_cancelled` (by cleaning key), `listing_config`, `cleaners`, open `maintenance_tickets`, and `cleaning_accounting_cache.payload_json.rows` (one row per Elite job, with `listing_id` and `cleaning_date`) for "usually Elite".

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_today_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { buildArrivals, buildJobs, buildTicketsByListing, buildWho, loadCore } from "./mgr_today.ts";

const DAY = "2026-10-09";
const AT_11 = Date.parse("2026-10-09T07:00:00Z");   // 11:00 Dubai
const AT_1430 = Date.parse("2026-10-09T10:30:00Z"); // 14:30 Dubai
const R = (id: string, listingId: string, guest: string, arrival: string, departure: string, o: any = {}) =>
  ({ id, listingId, guest, arrival, departure, status: "confirmed", checkInTime: 15, checkOutTime: 12, ...o });

const RES = [
  R("1", "L1", "Ann Lee", "2026-10-06", DAY),                                  // depart du jour, non assigne
  R("2", "L1", "Bob Ray", DAY, "2026-10-12"),                                  // arrivee du jour
  R("3", "L2", "Cy Doe", "2026-10-07", DAY, { checkOutTime: null }),           // depart 00:00 dans Hostaway
  R("4", "L2", "Di Fox", DAY, "2026-10-11"),
  R("5", "L3", "Ed Gu", "2026-10-04", "2026-10-08"),                           // Elite, saisi demain
  R("6", "L3", "Owner", DAY, "2026-10-15", { status: "ownerStay", checkInTime: 16 }),
  R("7", "L4", "Fa Ho", "2026-10-01", "2026-10-05"),                           // fait par Elite
  R("8", "L4", "Gi Io", DAY, "2026-10-13"),
  R("9", "L5", "Ha Ju", "2026-10-06", DAY),                                    // menage annule
  R("10", "L6", "In Ka", DAY, "2026-10-10", { status: "inquiry" }),           // pas une arrivee
  R("11", "L7", "Jo La", "2026-10-03", "2026-10-07"),                          // reporte au jour
  R("12", "L9", "Lu Mo", "2026-10-05", DAY),                                   // Elite habituel, depart du jour
];

const seed = () => fakeDb({
  listing_config: [
    { listing_id: "L1", internal_name: "101 - Tower A" }, { listing_id: "L2", internal_name: "202 - Tower B" },
    { listing_id: "L3", internal_name: "303 - Tower C" }, { listing_id: "L4", internal_name: "404 - Tower D" },
    { listing_id: "L5", internal_name: "505 - Tower E" }, { listing_id: "L7", internal_name: "707 - Tower G" },
    { listing_id: "L8", internal_name: "808 - Tower H" }, { listing_id: "L9", internal_name: "909 - Tower J" },
  ],
  cleaners: [
    { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 10, name: "Pionah", role: "cleaner", is_active: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 7, name: "Semax", role: "manager", is_active: true },
    { id: 11, name: "Medini CEO Agent", role: "system", is_active: true },
  ],
  cleaning_assignments: [
    { reservation_key: "2026-10-09_Cy Doe", cleaner_id: 4, service_type: "CHC" },
    { reservation_key: "2026-10-05_Fa Ho", cleaner_id: 12, service_type: "CHC" },
  ],
  menage_done: [{ reservation_key: "2026-10-05_Fa Ho", done: true }],
  cleaning_cancelled: [{ reservation_key: "2026-10-09_Ha Ju" }],
  cleaning_postponed: [{ reservation_key: "2026-10-07_Jo La", original_date: "2026-10-07", new_date: DAY }],
  extra_cleanings: [{ reservation_key: "extra_2026-10-09_deep", listing_id: "L8", cleaning_date: DAY, label: "Deep clean", status: "pending" }],
  maintenance_tickets: [
    { id: 429, listing_id: "L1", title: "Gas not working", priority: "urgent", status: "open", assigned_technician_id: null, assigned_vendor_id: null, created_at: "2026-07-09T08:00:00Z", source: "manual" },
    { id: 106, listing_id: "L4", title: "Balcony drain blocked", priority: "low", status: "assigned", assigned_technician_id: 7, assigned_vendor_id: null, created_at: "2026-04-27T08:00:00Z", source: "manual" },
    { id: 300, listing_id: "L4", title: "Old fixed thing", priority: "urgent", status: "resolved", created_at: "2026-05-01T08:00:00Z" },
  ],
  cleaning_accounting_cache: [{ month: "2026-09", payload_json: { rows: [
    { listing_id: "L3", cleaning_date: "2026-09-20" }, { listing_id: "L3", cleaning_date: "2026-09-28" },
    { listing_id: "L9", cleaning_date: "2026-09-22" }, { listing_id: "L9", cleaning_date: "2026-10-01" },
    { listing_id: "L4", cleaning_date: "2026-09-21" },
  ] } }],
});

const core = (nowMs: number) => loadCore(seed(), { day: DAY, nowMs, riskHours: 6, reservations: RES });

Deno.test("menages du jour : departs, report, extra ; annule et inquiry exclus ; heure 00:00 non inventee", async () => {
  const jobs = buildJobs(await core(AT_11));
  assertEquals(jobs.map((j) => j.key), [
    "2026-10-09_Ann Lee", "2026-10-09_Lu Mo", "2026-10-09_Cy Doe", "2026-10-07_Jo La", "extra_2026-10-09_deep",
  ]);
  const by = Object.fromEntries(jobs.map((j) => [j.key, j]));
  assertEquals(by["2026-10-09_Ann Lee"].checkout, "12:00");
  assertEquals(by["2026-10-09_Ann Lee"].next, { date: DAY, time: "15:00", sameDay: true, owner: false });
  assertEquals([by["2026-10-09_Ann Lee"].tone, by["2026-10-09_Ann Lee"].word], ["bad", "Unassigned"]);
  assertEquals(by["2026-10-09_Cy Doe"].checkout, null);
  assertEquals(by["2026-10-09_Cy Doe"].assigned, [4]);
  assertEquals([by["2026-10-09_Cy Doe"].tone, by["2026-10-09_Cy Doe"].word], ["warn", "Not started"]);
  assertEquals([by["2026-10-09_Lu Mo"].tone, by["2026-10-09_Lu Mo"].word], ["warn", "Usually Elite · not logged yet"]);
  assertEquals(by["2026-10-07_Jo La"].postponedFrom, "2026-10-07");
  assertEquals(by["2026-10-07_Jo La"].checkout, null);
  assertEquals(by["extra_2026-10-09_deep"].kind, "extra");
});

Deno.test("Who does what : personnes, non assignes (arrivee du jour d'abord), techniciens", async () => {
  const c = await core(AT_11);
  const who = buildWho(c, buildJobs(c));
  assertEquals(who.people, [
    { id: 4, name: "Faiza", role: "cleaner", keys: ["2026-10-09_Cy Doe"] },
    { id: 10, name: "Pionah", role: "cleaner", keys: [] },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", keys: [] },
  ]);
  assertEquals(who.unassigned, ["2026-10-09_Ann Lee", "2026-10-09_Lu Mo", "2026-10-07_Jo La", "extra_2026-10-09_deep"]);
  assertEquals(who.technicians, [{ id: 7, name: "Semax", open: 1, oldest: { id: 106, title: "Balcony drain blocked", since: "27/04" } }]);
});

Deno.test("arrivees a 11:00 : bloque, a risque (00:00), pret, sejour proprietaire Elite pas encore saisi", async () => {
  const a = buildArrivals(await core(AT_11));
  assertEquals(a.rows.map((r) => [r.apt, r.time, r.kind, r.tone, r.cause]), [
    ["101", "15:00", "Guest", "bad", "No cleaner assigned, and urgent ticket open: Gas not working (#429)."],
    ["202", "15:00", "Guest", "warn", "Not started yet, Faiza. Guest in 4 h, checkout time not set."],
    ["404", "15:00", "Guest", "ok", "Cleaned by Elite Cleaning after the 05/10 checkout."],
    ["303", "16:00", "Owner stay", "warn", "Usually Elite · not logged yet. Elite logs its jobs the next day around 14:00."],
  ]);
  assertEquals(a.counts, { ok: 1, warn: 2, bad: 1, idle: 0 });
  const l2 = a.rows[1];
  assertEquals([l2.prevKey, l2.prevCheckout, l2.assigned, l2.serviceType, l2.cleaners],
    ["2026-10-09_Cy Doe", { date: DAY, time: null }, [4], "CHC", ["Faiza"]]);
});

Deno.test("arrivees a 14:30 : Elite pas saisi passe au rouge", async () => {
  const a = buildArrivals(await core(AT_1430));
  const l3 = a.rows.find((r) => r.apt === "303")!;
  assertEquals([l3.tone, l3.cause], ["bad", "No cleaner assigned. Checkout 08/10."]);
});

Deno.test("tickets ouverts par logement, urgents d'abord", async () => {
  const t = buildTicketsByListing(await core(AT_11));
  assertEquals(t, {
    L1: [{ id: 429, title: "Gas not working", priority: "urgent", since: "09/07", tech: null }],
    L4: [{ id: 106, title: "Balcony drain blocked", priority: "low", since: "27/04", tech: "Semax" }],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_today_test.ts`
Expected: FAIL, `Module not found ".../mgr_today.ts"`.

- [ ] **Step 3: Write minimal implementation**

`supabase/functions/hostaway-proxy/mgr_today.ts`:

```ts
// Today de l'app manager : lecture des tables, blocs « Who does what today » et
// « Ready for today's arrivals » (spec 2026-10-09-hk-manager-app-design.md,
// sections 4 et 5). Les regles de statut vivent dans mgr_rules.ts.
import { plusDays } from "./v3.ts";
import { dubaiDay, INSP_VALID_STATUSES } from "./insp_rules.ts";
import {
  arrivalStatus, byRoleThenName, ddmm, dubaiMs, eliteLogDeadlineMs, hhmm, MGR_DEFAULT_CHECKIN_HOUR,
  MGR_LOOKBACK_DAYS, MGR_USUALLY_ELITE_WINDOW_DAYS, reservationKey, splitListing, usuallyEliteListings,
  type MgrReservation, type PrevCleaning, type Tone,
} from "./mgr_rules.ts";

export const MGR_OPEN_TICKET_STATUSES = ["open", "assigned", "in_progress"];

export type MgrPerson = { id: number; name: string; role: string; active: boolean };
export type MgrTicket = {
  id: number; listingId: string; title: string; priority: string; status: string;
  techId: number | null; vendorId: number | null; createdAt: string; source: string;
};
export type MgrCore = {
  day: string; nowMs: number; riskHours: number;
  reservations: MgrReservation[];
  listings: Record<string, { apt: string; bld: string }>;
  people: Record<string, MgrPerson>;
  tickets: MgrTicket[];
  eliteListings: Set<string>;
  postponed: Record<string, string>;
  assignments: Record<string, Array<{ cleanerId: number; serviceType: string }>>;
  done: Set<string>; started: Set<string>; cancelled: Set<string>;
  extras: Array<{ key: string; listingId: string; label: string }>;
};

// Une lecture ratee leve : Today ne doit jamais afficher un « Ready » calcule
// sur une table manquante. L'appelant rend une erreur, le front garde son cache.
export function readOrThrow(res: any, what: string): any[] {
  if (res?.error) throw new Error("[mgr] " + what + ": " + (res.error.message ?? "read failed"));
  return res?.data ?? [];
}

export async function byKeys(sb: any, table: string, cols: string, keys: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    out.push(...readOrThrow(await sb.from(table).select(cols).in("reservation_key", keys.slice(i, i + 100)), table));
  }
  return out;
}

function monthsBack(day: string, days: number): string[] {
  const out = new Set<string>();
  for (let d = plusDays(day, -days); d <= day; d = plusDays(d, 1)) out.add(d.slice(0, 7));
  return [...out];
}

export async function loadCore(
  sb: any, a: { day: string; nowMs: number; riskHours: number; reservations: MgrReservation[] },
): Promise<MgrCore> {
  const day = a.day;
  const reservations = a.reservations.filter((r) => INSP_VALID_STATUSES.includes(r.status));
  const from = plusDays(day, -MGR_LOOKBACK_DAYS);
  const extras = readOrThrow(
    await sb.from("extra_cleanings").select("reservation_key, listing_id, label, status").eq("cleaning_date", day),
    "extra_cleanings",
  ).filter((e: any) => e.status !== "cancelled" && e.reservation_key)
    .map((e: any) => ({ key: String(e.reservation_key), listingId: String(e.listing_id ?? ""), label: String(e.label ?? "Extra cleaning") }));
  const keys = [...new Set([
    ...reservations.filter((r) => r.departure >= from && r.departure <= day).map(reservationKey),
    ...extras.map((e: { key: string }) => e.key),
  ])];
  const all = (p: any, what: string) => p.then((r: any) => readOrThrow(r, what));
  const [post, asg, done, timers, canc, listings, people, tickets, acc] = await Promise.all([
    byKeys(sb, "cleaning_postponed", "reservation_key, new_date", keys),
    byKeys(sb, "cleaning_assignments", "reservation_key, cleaner_id, service_type", keys),
    byKeys(sb, "menage_done", "reservation_key, done", keys),
    byKeys(sb, "cleaning_timer", "reservation_key, started_at, finished_at", keys),
    byKeys(sb, "cleaning_cancelled", "reservation_key", keys),
    all(sb.from("listing_config").select("listing_id, internal_name, listing_name, apt_number"), "listing_config"),
    all(sb.from("cleaners").select("id, name, role, is_active"), "cleaners"),
    all(sb.from("maintenance_tickets")
      .select("id, listing_id, title, priority, status, assigned_technician_id, assigned_vendor_id, created_at, source")
      .in("status", MGR_OPEN_TICKET_STATUSES), "maintenance_tickets"),
    all(sb.from("cleaning_accounting_cache").select("month, payload_json")
      .in("month", monthsBack(day, MGR_USUALLY_ELITE_WINDOW_DAYS)), "cleaning_accounting_cache"),
  ]);
  const core: MgrCore = {
    day, nowMs: a.nowMs, riskHours: a.riskHours, reservations,
    listings: Object.fromEntries(listings.map((l: any) => [String(l.listing_id), splitListing(l)])),
    people: Object.fromEntries(people.map((p: any) => [String(p.id), {
      id: Number(p.id), name: String(p.name ?? ""), role: String(p.role ?? ""), active: p.is_active !== false,
    }])),
    tickets: tickets.map((t: any) => ({
      id: Number(t.id), listingId: t.listing_id == null ? "" : String(t.listing_id), title: String(t.title ?? "Ticket"),
      priority: String(t.priority ?? "medium"), status: String(t.status ?? "open"),
      techId: t.assigned_technician_id ?? null, vendorId: t.assigned_vendor_id ?? null,
      createdAt: String(t.created_at ?? ""), source: String(t.source ?? ""),
    })),
    eliteListings: usuallyEliteListings(
      acc.flatMap((r: any) => Array.isArray(r?.payload_json?.rows) ? r.payload_json.rows : []), day),
    postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras,
  };
  for (const p of post) if (p.new_date) core.postponed[String(p.reservation_key)] = String(p.new_date);
  for (const r of asg) {
    (core.assignments[String(r.reservation_key)] ??= []).push({ cleanerId: Number(r.cleaner_id), serviceType: String(r.service_type || "CHC") });
  }
  for (const r of done) if (r.done === true) core.done.add(String(r.reservation_key));
  for (const t of timers) if (t.started_at && !t.finished_at) core.started.add(String(t.reservation_key));
  for (const x of canc) core.cancelled.add(String(x.reservation_key));
  return core;
}

export type MgrNext = { date: string; time: string | null; sameDay: boolean; owner: boolean };
export type MgrJob = {
  key: string; kind: "checkout" | "extra"; listingId: string; apt: string; bld: string;
  checkout: string | null; checkoutDate: string; postponedFrom: string | null;
  next: MgrNext | null;
  assigned: number[]; serviceType: string | null;
  state: "done" | "in_progress" | "not_started";
  tone: Tone; word: string;
};

const place = (c: MgrCore, listingId: string) => c.listings[listingId] ?? { apt: "", bld: "Listing " + listingId };

function nextStay(c: MgrCore, listingId: string, fromDate: string, excludeId: string): MgrNext | null {
  let best: MgrReservation | null = null;
  for (const r of c.reservations) {
    if (r.listingId !== listingId || r.id === excludeId || r.arrival < fromDate) continue;
    if (!best || r.arrival < best.arrival) best = r;
  }
  return best ? { date: best.arrival, time: hhmm(best.checkInTime), sameDay: best.arrival === c.day, owner: best.status === "ownerStay" } : null;
}

function makeJob(
  c: MgrCore, key: string, kind: "checkout" | "extra", listingId: string,
  checkoutDate: string, checkoutHour: number | null, next: MgrNext | null,
): MgrJob {
  const l = place(c, listingId);
  const rows = c.assignments[key] ?? [];
  const assigned = rows.map((r) => r.cleanerId);
  const done = c.done.has(key);
  const state = done ? "done" : c.started.has(key) ? "in_progress" : "not_started";
  const arrMs = next && next.sameDay
    ? dubaiMs(c.day, next.time ? Number(next.time.slice(0, 2)) : MGR_DEFAULT_CHECKIN_HOUR) : null;
  const risk = arrMs != null && arrMs - c.nowMs <= c.riskHours * 3600_000;
  let tone: Tone, word: string;
  if (done) { tone = "ok"; word = "Done"; }
  else if (!assigned.length) {
    const elite = c.eliteListings.has(listingId) && c.nowMs < eliteLogDeadlineMs(c.day);
    tone = elite ? "warn" : "bad";
    word = elite ? "Usually Elite · not logged yet" : "Unassigned";
  } else {
    tone = risk ? "warn" : "idle";
    word = state === "in_progress" ? "In progress" : "Not started";
  }
  return {
    key, kind, listingId, apt: l.apt, bld: l.bld,
    checkout: checkoutDate === c.day ? hhmm(checkoutHour) : null, checkoutDate,
    postponedFrom: checkoutDate !== c.day ? checkoutDate : null,
    next, assigned, serviceType: rows[0]?.serviceType ?? null, state, tone, word,
  };
}

export function buildJobs(c: MgrCore): MgrJob[] {
  const from = plusDays(c.day, -MGR_LOOKBACK_DAYS);
  const seen = new Set<string>();
  const jobs: MgrJob[] = [];
  for (const r of c.reservations) {
    if (r.departure < from || r.departure > c.day) continue;
    const key = reservationKey(r);
    if (seen.has(key) || c.cancelled.has(key) || (c.postponed[key] ?? r.departure) !== c.day) continue;
    seen.add(key);
    jobs.push(makeJob(c, key, "checkout", r.listingId, r.departure, r.checkOutTime, nextStay(c, r.listingId, c.day, r.id)));
  }
  for (const e of c.extras) {
    if (seen.has(e.key) || c.cancelled.has(e.key)) continue;
    seen.add(e.key);
    jobs.push(makeJob(c, e.key, "extra", e.listingId, c.day, null, nextStay(c, e.listingId, c.day, "")));
  }
  return jobs.sort((a, b) =>
    (a.checkout ?? "99").localeCompare(b.checkout ?? "99") || (a.apt + a.bld).localeCompare(b.apt + b.bld));
}

export type MgrWho = {
  jobs: MgrJob[];
  people: Array<{ id: number; name: string; role: string; keys: string[] }>;
  unassigned: string[];
  technicians: Array<{ id: number; name: string; open: number; oldest: { id: number; title: string; since: string } | null }>;
};

const since = (iso: string) => (iso ? ddmm(dubaiDay(iso)) : "");

export function buildWho(c: MgrCore, jobs: MgrJob[]): MgrWho {
  const map = new Map<number, { id: number; name: string; role: string; keys: string[] }>();
  const add = (id: number) => {
    if (!map.has(id)) {
      const p = c.people[String(id)];
      map.set(id, { id, name: p?.name || "Member " + id, role: p?.role || "unknown", keys: [] });
    }
    return map.get(id)!;
  };
  for (const p of Object.values(c.people)) {
    if (p.active && (p.role === "cleaner" || p.role === "subcontractor")) add(p.id);
  }
  for (const j of jobs) for (const id of j.assigned) add(id).keys.push(j.key);
  const people = [...map.values()].sort(byRoleThenName);
  const unassigned = jobs.filter((j) => !j.assigned.length)
    .sort((a, b) =>
      Number(a.state === "done") - Number(b.state === "done") ||
      Number(!a.next?.sameDay) - Number(!b.next?.sameDay) ||
      (a.checkout ?? "99").localeCompare(b.checkout ?? "99"))
    .map((j) => j.key);
  const tech = new Map<number, MgrWho["technicians"][number]>();
  for (const t of [...c.tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (t.techId == null) continue;
    const e = tech.get(t.techId) ?? { id: t.techId, name: c.people[String(t.techId)]?.name || "Member " + t.techId, open: 0, oldest: null };
    e.open++;
    if (!e.oldest) e.oldest = { id: t.id, title: t.title, since: since(t.createdAt) };
    tech.set(t.techId, e);
  }
  return { jobs, people, unassigned, technicians: [...tech.values()].sort((a, b) => b.open - a.open) };
}

export type MgrArrival = {
  id: string; listingId: string; apt: string; bld: string;
  time: string; timeSet: boolean; kind: "Guest" | "Owner stay";
  tone: Tone; word: string; cause: string;
  prevKey: string | null; prevCheckout: { date: string; time: string | null } | null;
  cleaners: string[]; assigned: number[]; serviceType: string | null; done: boolean;
};
export type MgrArrivals = { counts: Record<Tone, number>; rows: MgrArrival[] };
const SEVERITY: Record<Tone, number> = { bad: 0, warn: 1, idle: 2, ok: 3 };

export function buildArrivals(c: MgrCore): MgrArrivals {
  const rows: MgrArrival[] = [];
  for (const a of c.reservations) {
    if (a.arrival !== c.day) continue;
    let prev: MgrReservation | null = null;
    for (const r of c.reservations) {
      if (r.listingId !== a.listingId || r.id === a.id || r.departure > a.arrival) continue;
      if (!prev || r.departure > prev.departure) prev = r;
    }
    const l = place(c, a.listingId);
    const hour = a.checkInTime ?? MGR_DEFAULT_CHECKIN_HOUR;
    let pc: PrevCleaning | null = null;
    let assigned: number[] = [];
    let serviceType: string | null = null;
    if (prev) {
      const key = reservationKey(prev);
      const asg = c.assignments[key] ?? [];
      assigned = asg.map((x) => x.cleanerId);
      serviceType = asg[0]?.serviceType ?? null;
      pc = {
        key, checkoutDate: prev.departure, checkoutHour: prev.checkOutTime,
        cleaningDate: c.postponed[key] ?? prev.departure,
        assignedNames: assigned.map((id) => c.people[String(id)]?.name || "Member " + id),
        done: c.done.has(key), started: c.started.has(key), cancelled: c.cancelled.has(key),
        usuallyElite: c.eliteListings.has(a.listingId),
      };
    }
    const urgent = c.tickets.filter((t) => t.listingId === a.listingId && t.priority === "urgent")
      .map((t) => ({ id: t.id, title: t.title }));
    const st = arrivalStatus({ day: c.day, nowMs: c.nowMs, arrivalMs: dubaiMs(c.day, hour), riskHours: c.riskHours, prev: pc, urgent });
    rows.push({
      id: a.id, listingId: a.listingId, apt: l.apt, bld: l.bld,
      time: hhmm(hour)!, timeSet: a.checkInTime != null, kind: a.status === "ownerStay" ? "Owner stay" : "Guest",
      ...st,
      prevKey: pc ? pc.key : null,
      prevCheckout: prev ? { date: prev.departure, time: hhmm(prev.checkOutTime) } : null,
      cleaners: pc ? pc.assignedNames : [], assigned, serviceType, done: pc ? pc.done : false,
    });
  }
  rows.sort((x, y) => x.time.localeCompare(y.time) || SEVERITY[x.tone] - SEVERITY[y.tone] || x.apt.localeCompare(y.apt));
  const counts: Record<Tone, number> = { ok: 0, warn: 0, bad: 0, idle: 0 };
  for (const r of rows) counts[r.tone]++;
  return { counts, rows };
}

export type MgrTicketLite = { id: number; title: string; priority: string; since: string; tech: string | null };
const PRIO: Record<string, number> = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3 };

export function buildTicketsByListing(c: MgrCore): Record<string, MgrTicketLite[]> {
  const out: Record<string, MgrTicketLite[]> = {};
  const sorted = [...c.tickets].sort((a, b) =>
    (PRIO[a.priority] ?? 2) - (PRIO[b.priority] ?? 2) || a.createdAt.localeCompare(b.createdAt));
  for (const t of sorted) {
    if (!t.listingId) continue;
    (out[t.listingId] ??= []).push({
      id: t.id, title: t.title, priority: t.priority, since: since(t.createdAt),
      tech: t.techId != null ? (c.people[String(t.techId)]?.name ?? null) : null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add supabase/functions/hostaway-proxy/mgr_today.ts supabase/functions/hostaway-proxy/mgr_today_test.ts
git commit -m "manager: menages du jour, qui fait quoi et arrivees du jour sur les tables existantes (reports, extras, annulations, Elite)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---

### Task 4: Open problems block (`mgr_problems.ts`)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_problems.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_problems_test.ts`

**Interfaces:**
- Consumes: `MgrCore`, `MgrJob`, `MgrArrival`, `readOrThrow` (Task 3); `ddmm`, `Tone` (Task 2); `dubaiDay` (`insp_rules.ts`).
- Produces:
  - `MGR_CLEANER_REPORT_SOURCE = "hk_planner_v3"` (source of v3 cleaner reports in `maintenance_tickets`, see `v3_tickets.ts`)
  - `type MgrProblem = { ref: string; source: "Maintenance" | "Team task"; priority: string; label: string; title: string; listingId: string | null; apt: string; bld: string; why: string; tone: Tone }` (`ref` = `MNT-<id>` or `TSK-<id>`, the stable ids of spec section 6)
  - `type MgrProblems = { counts: { ticketsOpen: number; ticketsUrgent: number; ticketsNoTech: number; teamTasksOpen: number; teamTasksOverdue: number; inspectionFindingsOpen: number; cleanerReportsOpen: number }; top: MgrProblem[] }`
  - `loadProblems(sb: any, c: MgrCore, jobs: MgrJob[], arrivals: MgrArrival[]): Promise<MgrProblems>`

Ranking: priority (urgent, high, medium/normal, low), then "touches today" (arrival today on the apartment, then checkout today, then nothing), then oldest first (`due_at` for team tasks, `created_at` for tickets). Phase 1 shows the top 5 read-only (Assign / Schedule / Close arrive with Problems, phase 2).

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_problems_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadProblems } from "./mgr_problems.ts";
import type { MgrCore, MgrTicket } from "./mgr_today.ts";

const DAY = "2026-10-09";
const T = (id: number, listingId: string, title: string, priority: string, createdAt: string, o: Partial<MgrTicket> = {}): MgrTicket =>
  ({ id, listingId, title, priority, status: "open", techId: null, vendorId: null, createdAt, source: "manual", ...o });

const core: MgrCore = {
  day: DAY, nowMs: Date.parse("2026-10-09T07:00:00Z"), riskHours: 6, reservations: [],
  listings: { L1: { apt: "103", bld: "Damac Reva" }, L2: { apt: "2609", bld: "Nobles by Tiger" }, L3: { apt: "1607", bld: "Central Park JVC" } },
  people: { "7": { id: 7, name: "Semax", role: "manager", active: true } },
  tickets: [
    T(429, "L1", "Gas not working", "urgent", "2026-07-09T08:00:00Z"),
    T(411, "L2", "Bathroom drainage clogged", "urgent", "2026-06-14T08:00:00Z"),
    T(440, "L3", "Cockroaches reported by guest", "high", "2026-07-15T08:00:00Z"),
    T(106, "L3", "Balcony drain blocked", "low", "2026-04-27T08:00:00Z", { techId: 7 }),
    T(500, "", "Shower leaking", "medium", "2026-09-01T08:00:00Z", { source: "hk_planner_v3" }),
  ],
  eliteListings: new Set(), postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras: [],
};
const arrivals = [{ listingId: "L1", kind: "Guest", time: "15:00" }] as any[];
const jobs = [{ listingId: "L2", kind: "checkout", postponedFrom: null, checkout: "12:00" }] as any[];
const db = () => fakeDb({
  team_tasks: [
    { id: 13, title: "AC not cooling", priority: "urgent", status: "open", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00Z", created_at: "2026-05-14T08:00:00Z" },
    { id: 14, title: "Buy light bulbs", priority: "normal", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: null, created_at: "2026-10-01T08:00:00Z" },
    { id: 15, title: "Check smoke detector", priority: "low", status: "open", listing_id: null, assigned_cleaner_id: null, due_at: "2026-12-01T08:00:00Z", created_at: "2026-10-01T08:00:00Z" },
    { id: 16, title: "Closed one", priority: "urgent", status: "done", listing_id: null, assigned_cleaner_id: 7, due_at: "2026-05-01T08:00:00Z", created_at: "2026-05-01T08:00:00Z" },
  ],
  inspection_items: [
    { id: 1, status: "not_ok", outcome: null }, { id: 2, status: "not_ok", outcome: null },
    { id: 3, status: "not_ok", outcome: "maintenance" }, { id: 4, status: "ok", outcome: null },
  ],
});

Deno.test("top 5 : urgence, puis ce qui touche aujourd'hui, puis le plus ancien", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.top.map((x) => x.ref), ["MNT-429", "MNT-411", "TSK-13", "MNT-440", "MNT-500"]);
  assertEquals(p.top[0], {
    ref: "MNT-429", source: "Maintenance", priority: "urgent", label: "Urgent", title: "Gas not working",
    listingId: "L1", apt: "103", bld: "Damac Reva",
    why: "A guest arrives today at 15:00. Open since 09/07, no technician assigned.", tone: "bad",
  });
  assertEquals(p.top[1].why, "Checkout today at 12:00. Open since 14/06, no technician assigned.");
  assertEquals([p.top[2].source, p.top[2].why, p.top[2].tone], ["Team task", "Assigned to Semax, overdue since 15/05.", "bad"]);
  assertEquals([p.top[3].tone, p.top[4].tone, p.top[4].apt, p.top[4].bld], ["warn", "warn", "", ""]);
});

Deno.test("compteurs : tickets, urgents, sans technicien, taches, retards, constats, signalements cleaner", async () => {
  const p = await loadProblems(db(), core, jobs, arrivals);
  assertEquals(p.counts, {
    ticketsOpen: 5, ticketsUrgent: 2, ticketsNoTech: 4, teamTasksOpen: 3, teamTasksOverdue: 1,
    inspectionFindingsOpen: 2, cleanerReportsOpen: 1,
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_problems_test.ts`
Expected: FAIL, `Module not found ".../mgr_problems.ts"`.

- [ ] **Step 3: Write minimal implementation**

`supabase/functions/hostaway-proxy/mgr_problems.ts`:

```ts
// Bloc « Open problems » de Today : compteurs et 5 premiers elements, en lecture
// seule en phase 1 (le tri Assign / Schedule / Close arrive avec Problems, phase 2).
// Identifiants stables par source (spec section 6) : MNT-<id>, TSK-<id>.
import { dubaiDay } from "./insp_rules.ts";
import { ddmm, type Tone } from "./mgr_rules.ts";
import { readOrThrow, type MgrArrival, type MgrCore, type MgrJob } from "./mgr_today.ts";

export const MGR_CLEANER_REPORT_SOURCE = "hk_planner_v3";

export type MgrProblem = {
  ref: string; source: "Maintenance" | "Team task"; priority: string; label: string; title: string;
  listingId: string | null; apt: string; bld: string; why: string; tone: Tone;
};
export type MgrProblems = {
  counts: {
    ticketsOpen: number; ticketsUrgent: number; ticketsNoTech: number; teamTasksOpen: number;
    teamTasksOverdue: number; inspectionFindingsOpen: number; cleanerReportsOpen: number;
  };
  top: MgrProblem[];
};

const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, normal: 2, low: 3 };
const label = (p: string) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : "Normal");
const tone = (p: string): Tone => (p === "urgent" ? "bad" : p === "high" || p === "medium" ? "warn" : "idle");
const since = (iso: unknown) => (iso ? ddmm(dubaiDay(String(iso))) : "?");

export async function loadProblems(sb: any, c: MgrCore, jobs: MgrJob[], arrivals: MgrArrival[]): Promise<MgrProblems> {
  const tasks = readOrThrow(
    await sb.from("team_tasks")
      .select("id, title, priority, status, listing_id, assigned_cleaner_id, due_at, created_at").eq("status", "open"),
    "team_tasks",
  );
  const findings = readOrThrow(
    await sb.from("inspection_items").select("id, status, outcome").eq("status", "not_ok").is("outcome", null),
    "inspection_items",
  );
  const nowIso = new Date(c.nowMs).toISOString();
  const arrBy = new Map(arrivals.map((a) => [a.listingId, a]));
  const coBy = new Map(jobs.filter((j) => j.kind === "checkout" && !j.postponedFrom).map((j) => [j.listingId, j]));
  const where = (lid: string | null) => {
    const l = lid ? c.listings[lid] : undefined;
    return { apt: l?.apt ?? "", bld: l?.bld ?? "" };
  };
  const today = (lid: string | null): { boost: number; text: string } => {
    if (!lid) return { boost: 2, text: "" };
    const a = arrBy.get(lid);
    if (a) return { boost: 0, text: (a.kind === "Owner stay" ? "The owner arrives" : "A guest arrives") + " today at " + a.time + ". " };
    const j = coBy.get(lid);
    if (j) return { boost: 1, text: (j.checkout ? "Checkout today at " + j.checkout : "Checkout today, checkout time not set") + ". " };
    return { boost: 2, text: "" };
  };
  const nameOf = (id: unknown) => (id == null ? null : c.people[String(id)]?.name ?? "Member " + id);
  const items: Array<{ p: MgrProblem; r: number; b: number; t: string }> = [];
  for (const t of c.tickets) {
    const lid = t.listingId || null;
    const n = today(lid);
    const tech = nameOf(t.techId);
    items.push({
      p: {
        ref: "MNT-" + t.id, source: "Maintenance", priority: t.priority, label: label(t.priority), title: t.title,
        listingId: lid, ...where(lid),
        why: n.text + "Open since " + since(t.createdAt) +
          (tech ? ", assigned to " + tech + "." : t.vendorId != null ? ", sent to a vendor." : ", no technician assigned."),
        tone: tone(t.priority),
      },
      r: RANK[t.priority] ?? 2, b: n.boost, t: t.createdAt,
    });
  }
  for (const t of tasks) {
    const lid = t.listing_id ? String(t.listing_id) : null;
    const prio = String(t.priority ?? "normal");
    const n = today(lid);
    const who = nameOf(t.assigned_cleaner_id);
    const overdue = !!t.due_at && String(t.due_at) < nowIso;
    items.push({
      p: {
        ref: "TSK-" + t.id, source: "Team task", priority: prio, label: label(prio), title: String(t.title ?? "Task"),
        listingId: lid, ...where(lid),
        why: n.text + (who ? "Assigned to " + who : "Unassigned") +
          (overdue ? ", overdue since " + since(t.due_at) : t.due_at ? ", due " + since(t.due_at) : ", open since " + since(t.created_at)) + ".",
        tone: tone(prio),
      },
      r: RANK[prio] ?? 2, b: n.boost, t: String(t.due_at ?? t.created_at ?? ""),
    });
  }
  items.sort((x, y) => x.r - y.r || x.b - y.b || x.t.localeCompare(y.t));
  return {
    counts: {
      ticketsOpen: c.tickets.length,
      ticketsUrgent: c.tickets.filter((t) => t.priority === "urgent").length,
      ticketsNoTech: c.tickets.filter((t) => t.techId == null && t.vendorId == null).length,
      teamTasksOpen: tasks.length,
      teamTasksOverdue: tasks.filter((t: any) => t.due_at && String(t.due_at) < nowIso).length,
      inspectionFindingsOpen: findings.length,
      cleanerReportsOpen: c.tickets.filter((t) => t.source === MGR_CLEANER_REPORT_SOURCE).length,
    },
    top: items.slice(0, 5).map((x) => x.p),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 3 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add supabase/functions/hostaway-proxy/mgr_problems.ts supabase/functions/hostaway-proxy/mgr_problems_test.ts
git commit -m "manager: bloc Open problems (compteurs, 5 premiers, identifiants MNT et TSK)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---

### Task 5: Team control block (`mgr_control.ts`)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_control.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_control_test.ts`

**Interfaces:**
- Consumes: `MgrCore`, `readOrThrow`, `byKeys` (Task 3); `byRoleThenName`, `ddmm`, `dubaiMs`, `eliteLogDeadlineMs`, `hhmm`, `joinNames`, `keyDate`, `MGR_ELITE_LOG_HOUR`, `plural` (Task 2); `dubaiDay` (`insp_rules.ts`); `plusDays` (`v3.ts`).
- Produces:
  - `MGR_LINEN_WINDOW_DAYS = 7`
  - `type MgrControl = { inspections: { proposed: number; claimed: number; done: number; unfinished: Array<{ apt: string; bld: string; inspector: string; date: string }> }; linen: { window: string; rows: Array<{ name: string; missing: number; total: number }> }; overdue: { total: number; rows: Array<{ name: string; n: number }> }; yesterday: { date: string; rows: Array<{ name: string; text: string }> } }`
  - `loadControl(sb: any, c: MgrCore): Promise<MgrControl>`

Rules: inspections today from `inspection_proposals` (proposal_date = today) and `inspections` (finished today); "started, never finished" = `finished_at` null and `inspection_date` before today, last 7 days. Missing linen = cleanings marked done whose key date is in the last 7 days (today excluded) without a `laundry_counts` row, per assignee. Overdue = open `team_tasks` with `due_at` before now, per assignee ("Unassigned" when none). Yesterday = per cleaner / subcontractor: cleanings done and linen counts on yesterday's keys; Elite before 14:00 today: "Not logged yet"; per manager / maintenance: inspections finished and team tasks closed yesterday, idle ones grouped in one line; then one "Maintenance" line with tickets resolved yesterday.

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_control_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { loadControl } from "./mgr_control.ts";
import type { MgrCore } from "./mgr_today.ts";

const DAY = "2026-10-09";
const P = (id: number, name: string, role: string) => ({ id, name, role, active: true });
const core = (nowIso: string): MgrCore => ({
  day: DAY, nowMs: Date.parse(nowIso), riskHours: 6, reservations: [],
  listings: { L1: { apt: "414", bld: "Azizi Riviera 11" }, L2: { apt: "421", bld: "Elysee 1" } },
  people: {
    "4": P(4, "Faiza", "cleaner"), "10": P(10, "Pionah", "cleaner"), "12": P(12, "Elite Cleaning", "subcontractor"),
    "5": P(5, "Ismaël", "manager"), "6": P(6, "Hillal", "manager"), "7": P(7, "Semax", "manager"),
    "11": P(11, "Medini CEO Agent", "system"),
  },
  tickets: [], eliteListings: new Set(), postponed: {}, assignments: {}, done: new Set(), started: new Set(), cancelled: new Set(), extras: [],
});
const db = () => fakeDb({
  inspection_proposals: [
    { proposal_date: DAY, listing_id: "L1", claimed_by: 5 }, { proposal_date: DAY, listing_id: "L2", claimed_by: null },
    { proposal_date: "2026-10-08", listing_id: "L1", claimed_by: null },
  ],
  inspections: [
    { id: 1, listing_id: "L1", inspector_id: 6, inspection_date: "2026-10-05", finished_at: null },
    { id: 2, listing_id: "L2", inspector_id: 5, inspection_date: "2026-10-08", finished_at: "2026-10-08T09:00:00Z" },
    { id: 3, listing_id: "L2", inspector_id: 5, inspection_date: DAY, finished_at: "2026-10-09T05:00:00Z" },
    { id: 4, listing_id: "L1", inspector_id: 5, inspection_date: DAY, finished_at: null },
  ],
  menage_done: [
    { reservation_key: "2026-10-08_A", done: true, updated_at: "2026-10-08T12:00:00Z" },
    { reservation_key: "2026-10-08_B", done: true, updated_at: "2026-10-08T13:00:00Z" },
    { reservation_key: "2026-10-05_C", done: true, updated_at: "2026-10-06T10:00:00Z" },
    { reservation_key: "2026-10-09_D", done: true, updated_at: "2026-10-09T05:00:00Z" },
    { reservation_key: "2026-09-20_E", done: true, updated_at: "2026-09-21T10:00:00Z" },
    { reservation_key: "2026-10-07_F", done: false, updated_at: "2026-10-07T10:00:00Z" },
  ],
  cleaning_assignments: [
    { reservation_key: "2026-10-08_A", cleaner_id: 4 }, { reservation_key: "2026-10-08_B", cleaner_id: 4 },
    { reservation_key: "2026-10-08_B", cleaner_id: 10 }, { reservation_key: "2026-10-05_C", cleaner_id: 12 },
    { reservation_key: "2026-10-09_D", cleaner_id: 4 },
  ],
  laundry_counts: [{ reservation_key: "2026-10-08_A" }],
  team_tasks: [
    { id: 13, status: "open", assigned_cleaner_id: 7, due_at: "2026-05-15T08:00:00Z" },
    { id: 14, status: "open", assigned_cleaner_id: 7, due_at: "2026-10-01T08:00:00Z" },
    { id: 15, status: "open", assigned_cleaner_id: null, due_at: "2026-10-02T08:00:00Z" },
    { id: 16, status: "open", assigned_cleaner_id: 6, due_at: "2026-12-01T08:00:00Z" },
    { id: 20, status: "done", completed_by_cleaner_id: 6, completed_at: "2026-10-08T06:00:00Z" },
    { id: 21, status: "done", completed_by_cleaner_id: 6, completed_at: "2026-10-09T06:00:00Z" },
  ],
  maintenance_tickets: [
    { id: 1, resolved_at: "2026-10-08T09:00:00Z" }, { id: 2, resolved_at: "2026-10-09T05:00:00Z" },
  ],
});

Deno.test("inspections du jour et inspections jamais finies", async () => {
  const c = await loadControl(db(), core("2026-10-09T07:00:00Z"));
  assertEquals(c.inspections, {
    proposed: 2, claimed: 1, done: 1,
    unfinished: [{ apt: "414", bld: "Azizi Riviera 11", inspector: "Hillal", date: "05/10" }],
  });
});

Deno.test("linge manquant sur 7 jours (aujourd'hui exclu) et taches en retard", async () => {
  const c = await loadControl(db(), core("2026-10-09T07:00:00Z"));
  assertEquals(c.linen, { window: "last 7 days", rows: [
    { name: "Elite Cleaning", missing: 1, total: 1 }, { name: "Faiza", missing: 1, total: 2 }, { name: "Pionah", missing: 1, total: 1 },
  ] });
  assertEquals(c.overdue, { total: 3, rows: [{ name: "Semax", n: 2 }, { name: "Unassigned", n: 1 }] });
});

Deno.test("hier, a 11:00 : Elite pas encore saisi, managers actifs puis inactifs groupes, maintenance", async () => {
  const c = await loadControl(db(), core("2026-10-09T07:00:00Z"));
  assertEquals(c.yesterday, { date: "08/10", rows: [
    { name: "Faiza", text: "2 cleanings done, 1 linen count." },
    { name: "Pionah", text: "1 cleaning done, 0 linen counts." },
    { name: "Elite Cleaning", text: "Not logged yet. Elite logs its jobs around 14:00 the next day." },
    { name: "Hillal", text: "0 inspections done, 1 team task closed." },
    { name: "Ismaël", text: "1 inspection done, 0 team tasks closed." },
    { name: "Semax", text: "No inspection and no team task closed." },
    { name: "Maintenance", text: "1 ticket resolved." },
  ] });
});

Deno.test("hier, a 14:30 : Elite sans job saisi", async () => {
  const c = await loadControl(db(), core("2026-10-09T10:30:00Z"));
  assertEquals(c.yesterday.rows[2], { name: "Elite Cleaning", text: "No cleaning marked done." });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_control_test.ts`
Expected: FAIL, `Module not found ".../mgr_control.ts"`.

- [ ] **Step 3: Write minimal implementation**

`supabase/functions/hostaway-proxy/mgr_control.ts`:

```ts
// Bloc « Team control » de Today : inspections, linge manquant, taches en
// retard, ce que chacun a fait hier (spec 2026-10-09, sections 2 et 4).
import { plusDays } from "./v3.ts";
import { dubaiDay } from "./insp_rules.ts";
import {
  byRoleThenName, ddmm, dubaiMs, eliteLogDeadlineMs, hhmm, joinNames, keyDate, MGR_ELITE_LOG_HOUR, plural,
} from "./mgr_rules.ts";
import { byKeys, readOrThrow, type MgrCore } from "./mgr_today.ts";

export const MGR_LINEN_WINDOW_DAYS = 7;

export type MgrControl = {
  inspections: { proposed: number; claimed: number; done: number; unfinished: Array<{ apt: string; bld: string; inspector: string; date: string }> };
  linen: { window: string; rows: Array<{ name: string; missing: number; total: number }> };
  overdue: { total: number; rows: Array<{ name: string; n: number }> };
  yesterday: { date: string; rows: Array<{ name: string; text: string }> };
};

export async function loadControl(sb: any, c: MgrCore): Promise<MgrControl> {
  const day = c.day, y = plusDays(day, -1), from = plusDays(day, -MGR_LINEN_WINDOW_DAYS);
  const iso = (ms: number) => new Date(ms).toISOString();
  const q = (p: any, what: string) => p.then((r: any) => readOrThrow(r, what));
  const [props, insps, doneRows, openTasks, closedTasks, resolved] = await Promise.all([
    q(sb.from("inspection_proposals").select("listing_id, claimed_by").eq("proposal_date", day), "inspection_proposals"),
    q(sb.from("inspections").select("id, listing_id, inspector_id, inspection_date, finished_at").gte("inspection_date", from), "inspections"),
    q(sb.from("menage_done").select("reservation_key, done, updated_at").eq("done", true).gte("updated_at", iso(dubaiMs(from, 0))), "menage_done"),
    q(sb.from("team_tasks").select("id, assigned_cleaner_id, due_at").eq("status", "open"), "team_tasks"),
    q(sb.from("team_tasks").select("id, completed_by_cleaner_id, completed_at").eq("status", "done").gte("completed_at", iso(dubaiMs(y, 0))), "team_tasks"),
    q(sb.from("maintenance_tickets").select("id, resolved_at").gte("resolved_at", iso(dubaiMs(y, 0))), "maintenance_tickets"),
  ]);
  const nm = (id: unknown) => c.people[String(id)]?.name ?? "Member " + id;
  const where = (lid: unknown) => c.listings[String(lid)] ?? { apt: "", bld: "Listing " + lid };

  const doneKeys = [...new Set<string>(doneRows.map((r: any) => String(r.reservation_key)))].filter((k) => {
    const d = keyDate(k);
    return !!d && d >= from && d <= y;
  });
  const [asg, linen] = await Promise.all([
    byKeys(sb, "cleaning_assignments", "reservation_key, cleaner_id", doneKeys),
    byKeys(sb, "laundry_counts", "reservation_key", doneKeys),
  ]);
  const counted = new Set(linen.map((r: any) => String(r.reservation_key)));
  const per = new Map<number, { total: number; missing: number; y: number; yLinen: number }>();
  for (const a of asg) {
    const id = Number(a.cleaner_id), k = String(a.reservation_key);
    const e = per.get(id) ?? { total: 0, missing: 0, y: 0, yLinen: 0 };
    e.total++;
    if (!counted.has(k)) e.missing++;
    if (keyDate(k) === y) { e.y++; if (counted.has(k)) e.yLinen++; }
    per.set(id, e);
  }

  const inspections = {
    proposed: props.length,
    claimed: props.filter((p: any) => p.claimed_by != null).length,
    done: insps.filter((i: any) => i.inspection_date === day && i.finished_at).length,
    unfinished: insps.filter((i: any) => !i.finished_at && i.inspection_date < day)
      .map((i: any) => ({ ...where(i.listing_id), inspector: nm(i.inspector_id), date: ddmm(i.inspection_date) })),
  };

  const nowIso = iso(c.nowMs);
  const od = new Map<string, number>();
  for (const t of openTasks) {
    if (!t.due_at || String(t.due_at) >= nowIso) continue;
    const k = t.assigned_cleaner_id == null ? "Unassigned" : nm(t.assigned_cleaner_id);
    od.set(k, (od.get(k) ?? 0) + 1);
  }
  const overdueRows = [...od.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  const rows: Array<{ name: string; text: string }> = [];
  const idle: string[] = [];
  const team = Object.values(c.people).filter((p) => p.active && p.role !== "system").sort(byRoleThenName);
  for (const p of team) {
    if (p.role === "cleaner" || p.role === "subcontractor") {
      const e = per.get(p.id);
      if (e && e.y) rows.push({ name: p.name, text: plural(e.y, "cleaning") + " done, " + plural(e.yLinen, "linen count") + "." });
      else if (p.role === "subcontractor" && c.nowMs < eliteLogDeadlineMs(y)) {
        rows.push({ name: p.name, text: "Not logged yet. Elite logs its jobs around " + hhmm(MGR_ELITE_LOG_HOUR) + " the next day." });
      } else rows.push({ name: p.name, text: "No cleaning marked done." });
      continue;
    }
    const nIns = insps.filter((i: any) => Number(i.inspector_id) === p.id && i.inspection_date === y && i.finished_at).length;
    const nTasks = closedTasks.filter((t: any) =>
      Number(t.completed_by_cleaner_id) === p.id && t.completed_at && dubaiDay(String(t.completed_at)) === y).length;
    if (nIns || nTasks) rows.push({ name: p.name, text: plural(nIns, "inspection") + " done, " + plural(nTasks, "team task") + " closed." });
    else idle.push(p.name);
  }
  if (idle.length) rows.push({ name: joinNames(idle), text: "No inspection and no team task closed." });
  const nRes = resolved.filter((t: any) => t.resolved_at && dubaiDay(String(t.resolved_at)) === y).length;
  rows.push({ name: "Maintenance", text: plural(nRes, "ticket") + " resolved." });

  return {
    inspections,
    linen: {
      window: "last " + MGR_LINEN_WINDOW_DAYS + " days",
      rows: [...per.entries()].map(([id, e]) => ({ name: nm(id), missing: e.missing, total: e.total }))
        .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name)),
    },
    overdue: { total: overdueRows.reduce((s, r) => s + r.n, 0), rows: overdueRows },
    yesterday: { date: ddmm(y), rows },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok | 4 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add supabase/functions/hostaway-proxy/mgr_control.ts supabase/functions/hostaway-proxy/mgr_control_test.ts
git commit -m "manager: bloc Team control (inspections, linge manquant, retards, hier par personne, Elite saisi le lendemain)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---
### Task 6: Proxy action `mgr.today` (assembly, access, Hostaway cache, route)

**Files:**
- Modify: `supabase/functions/hostaway-proxy/mgr_rules.ts` (append `mgrAccess`, `parseRiskHours`)
- Modify: `supabase/functions/hostaway-proxy/mgr_rules_test.ts` (append tests)
- Modify: `supabase/functions/hostaway-proxy/insp_reservations.ts` (optional `cacheKey`, generic row type)
- Modify: `supabase/functions/hostaway-proxy/insp_reservations_test.ts` (append one test)
- Create: `supabase/functions/hostaway-proxy/mgr_api.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_api_test.ts`
- Modify: `supabase/functions/hostaway-proxy/index.ts` (imports, `ROUTES`, `loadMgrReservations`, route block before `// ==================== INSPECTIONS ====================`)

**Interfaces:**
- Consumes: Tasks 2 to 5 (`loadCore`, `buildJobs`, `buildWho`, `buildArrivals`, `buildTicketsByListing`, `loadProblems`, `loadControl`, `normalizeMgrReservations`, `byRoleThenName`, `MGR_DEFAULT_RISK_HOURS`, `MGR_LOOKBACK_DAYS`); `currentUser`, `bearerToken` (`auth.ts`, already imported in `index.ts`); `getAccessToken`, `fetchAllPages`, `API_BASE`, `todayDubai`, `plusDays`, `jsonResp` in `index.ts`.
- Produces:
  - `type MgrAccess = { ok: true } | { ok: false; status: number; error: string }`
  - `mgrAccess(hasBearer: boolean, me: { role: string } | null): MgrAccess` (401 `auth required` without a valid session; 403 `email sign-in required` for a PIN session; 403 `forbidden` for a non-manager)
  - `parseRiskHours(v: unknown): number` (number in ]0, 24], else 6)
  - `loadReservationsCached<T = InspReservation>(sb, day, deps: { fetchHostaway: (day) => Promise<T[]>; now?; waitUntil?; cacheKey?: string })`
  - `type MgrToday = { day: string; generatedAt: string; bookingsCachedAt: string | null; riskHours: number; me: { id: number; name: string }; strip: { cleanings: number; unassigned: number; arrivals: number; notReady: number }; who: MgrWho; problems: MgrProblems; control: MgrControl; arrivals: MgrArrivals; assignable: Array<{ id: number; name: string; role: string }>; ticketsByListing: Record<string, MgrTicketLite[]> }`
  - `mgrToday(sb: any, o: { day: string; nowMs: number; me: SessionUser; loadReservations: (day: string) => Promise<{ reservations: MgrReservation[]; cachedAt: string | null }> }): Promise<{ status: number; body: MgrToday | { error: string } }>`
  - HTTP: `GET ?action=mgr.today` with `X-App-Secret` and `Authorization: Bearer <jwt>` returns `MgrToday` (200), `{error}` with 401 / 403 / 503.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/hostaway-proxy/mgr_rules_test.ts`:

```ts
import { mgrAccess, parseRiskHours } from "./mgr_rules.ts";

Deno.test("acces manager : session email obligatoire, role manager seulement", () => {
  assertEquals(mgrAccess(false, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mgrAccess(true, null), { ok: false, status: 401, error: "auth required" });
  assertEquals(mgrAccess(false, { role: "manager" }), { ok: false, status: 403, error: "email sign-in required" });
  assertEquals(mgrAccess(true, { role: "cleaner" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mgrAccess(true, { role: "maintenance" }), { ok: false, status: 403, error: "forbidden" });
  assertEquals(mgrAccess(true, { role: "manager" }), { ok: true });
});

Deno.test("seuil a risque : app_config.mgr_risk_hours, defaut 6", () => {
  assertEquals(parseRiskHours("3"), 3);
  assertEquals(parseRiskHours("2.5"), 2.5);
  for (const v of [null, undefined, "", "abc", "0", "-1", "25"]) assertEquals(parseRiskHours(v), 6);
});
```

Append to `supabase/functions/hostaway-proxy/insp_reservations_test.ts`:

```ts
Deno.test("cacheKey : instantane separe, celui d'Inspections intact", async () => {
  _resetInflightForTests();
  const sb = seed(1);
  const out = await loadReservationsCached(sb, DAY, { cacheKey: "mgr:res:" + DAY, fetchHostaway: async () => [R("mgr")], now: () => NOW });
  assertEquals(out, { reservations: [R("mgr")], cachedAt: null });
  assertEquals(cached(sb).payload, { reservations: [R("old")] });
  assertEquals(sb.tables.proxy_cache.find((r: any) => r.key === "mgr:res:" + DAY).payload, { reservations: [R("mgr")] });
});
```

Create `supabase/functions/hostaway-proxy/mgr_api_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrToday } from "./mgr_api.ts";

const DAY = "2026-10-09";
const NOW = Date.parse("2026-10-09T07:00:00Z");
const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "#000" };
const R = (id: string, guest: string, arrival: string, departure: string) =>
  ({ id, listingId: "L1", guest, arrival, departure, status: "confirmed", checkInTime: 15, checkOutTime: 12 });
const RES = [R("1", "Ann Lee", "2026-10-06", DAY), R("2", "Bob Ray", DAY, "2026-10-12")];
const db = (cfg: any[] = []) => fakeDb({
  app_config: cfg,
  listing_config: [{ listing_id: "L1", internal_name: "308 - Binghatti Lavender" }],
  cleaners: [
    { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 99, name: "Gone", role: "cleaner", is_active: false },
  ],
});
const load = async () => ({ reservations: RES, cachedAt: null });

Deno.test("mgr.today : reponse complete, seuil lu dans app_config", async () => {
  const r = await mgrToday(db([{ key: "mgr_risk_hours", value: "3" }]), { day: DAY, nowMs: NOW, me: ME, loadReservations: load });
  assertEquals(r.status, 200);
  const b: any = r.body;
  assertEquals(Object.keys(b).sort(), [
    "arrivals", "assignable", "bookingsCachedAt", "control", "day", "generatedAt", "me", "problems",
    "riskHours", "strip", "ticketsByListing", "who",
  ]);
  assertEquals([b.day, b.generatedAt, b.riskHours, b.bookingsCachedAt], [DAY, "2026-10-09T07:00:00.000Z", 3, null]);
  assertEquals(b.me, { id: 8, name: "Walter" });
  assertEquals(b.strip, { cleanings: 1, unassigned: 1, arrivals: 1, notReady: 1 });
  assertEquals(b.assignable, [{ id: 4, name: "Faiza", role: "cleaner" }, { id: 12, name: "Elite Cleaning", role: "subcontractor" }]);
  assertEquals(b.arrivals.rows[0].cause, "No cleaner assigned. Checkout 12:00, 3 h turnaround.");
});

Deno.test("mgr.today : seuil invalide, defaut 6 ; Hostaway en cache de secours signale", async () => {
  const r = await mgrToday(db([{ key: "mgr_risk_hours", value: "abc" }]), {
    day: DAY, nowMs: NOW, me: ME, loadReservations: async () => ({ reservations: RES, cachedAt: "2026-10-09T06:12:00Z" }),
  });
  assertEquals([(r.body as any).riskHours, (r.body as any).bookingsCachedAt], [6, "2026-10-09T06:12:00Z"]);
});

Deno.test("mgr.today : Hostaway indisponible sans cache, 503 avec message lisible", async () => {
  const r = await mgrToday(db(), {
    day: DAY, nowMs: NOW, me: ME,
    loadReservations: async () => { throw new Error("Bookings are unavailable right now. Try again in a few minutes."); },
  });
  assertEquals(r, { status: 503, body: { error: "Bookings are unavailable right now. Try again in a few minutes." } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_rules_test.ts insp_reservations_test.ts mgr_api_test.ts`
Expected: FAIL: `mgrAccess` / `parseRiskHours` not exported, `cacheKey` ignored (the new insp test fails on the payload of `insp:res:`), `mgr_api.ts` not found.

- [ ] **Step 3: Implement**

Append to `supabase/functions/hostaway-proxy/mgr_rules.ts`:

```ts
// Acces a mgr.today (spec section 6) : managers seulement, session email
// obligatoire. hasBearer = un en-tete Authorization: Bearer est present ; s'il
// est invalide, currentUser rend null (401), jamais un repli sur le PIN.
export type MgrAccess = { ok: true } | { ok: false; status: number; error: string };
export function mgrAccess(hasBearer: boolean, me: { role: string } | null): MgrAccess {
  if (!me) return { ok: false, status: 401, error: "auth required" };
  if (!hasBearer) return { ok: false, status: 403, error: "email sign-in required" };
  if (me.role !== "manager") return { ok: false, status: 403, error: "forbidden" };
  return { ok: true };
}

export function parseRiskHours(v: unknown): number {
  if (v === null || v === undefined || v === "") return MGR_DEFAULT_RISK_HOURS;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= 24 ? n : MGR_DEFAULT_RISK_HOURS;
}
```

In `supabase/functions/hostaway-proxy/insp_reservations.ts`, replace:

```ts
export async function loadReservationsCached(
  sb: any, day: string,
  deps: {
    fetchHostaway: (day: string) => Promise<InspReservation[]>;
    now?: () => number;
    waitUntil?: (p: Promise<unknown>) => void;
  },
): Promise<{ reservations: InspReservation[]; cachedAt: string | null }> {
  const now = deps.now ?? Date.now;
  const key = "insp:res:" + day;
```

with:

```ts
export async function loadReservationsCached<T = InspReservation>(
  sb: any, day: string,
  deps: {
    fetchHostaway: (day: string) => Promise<T[]>;
    now?: () => number;
    waitUntil?: (p: Promise<unknown>) => void;
    // Cle proxy_cache. Defaut : celle d'Inspections. L'app manager garde son propre
    // instantane (guest et fenetre de 14 jours en plus) sous mgr:res:<day>.
    cacheKey?: string;
  },
): Promise<{ reservations: T[]; cachedAt: string | null }> {
  const now = deps.now ?? Date.now;
  const key = deps.cacheKey ?? "insp:res:" + day;
```

Create `supabase/functions/hostaway-proxy/mgr_api.ts`:

```ts
// Action mgr.today : un seul appel qui rend les 4 blocs de Today deja calcules
// (spec 2026-10-09-hk-manager-app-design.md, section 6).
import type { SessionUser } from "./auth.ts";
import { byRoleThenName, parseRiskHours, type MgrReservation } from "./mgr_rules.ts";
import {
  buildArrivals, buildJobs, buildTicketsByListing, buildWho, loadCore,
  type MgrArrivals, type MgrTicketLite, type MgrWho,
} from "./mgr_today.ts";
import { loadProblems, type MgrProblems } from "./mgr_problems.ts";
import { loadControl, type MgrControl } from "./mgr_control.ts";

export type MgrToday = {
  day: string; generatedAt: string; bookingsCachedAt: string | null; riskHours: number;
  me: { id: number; name: string };
  strip: { cleanings: number; unassigned: number; arrivals: number; notReady: number };
  who: MgrWho; problems: MgrProblems; control: MgrControl; arrivals: MgrArrivals;
  assignable: Array<{ id: number; name: string; role: string }>;
  ticketsByListing: Record<string, MgrTicketLite[]>;
};

export async function mgrToday(sb: any, o: {
  day: string; nowMs: number; me: SessionUser;
  loadReservations: (day: string) => Promise<{ reservations: MgrReservation[]; cachedAt: string | null }>;
}): Promise<{ status: number; body: MgrToday | { error: string } }> {
  let loaded: { reservations: MgrReservation[]; cachedAt: string | null };
  try {
    loaded = await o.loadReservations(o.day);
  } catch (e) {
    return { status: 503, body: { error: (e as Error).message } };
  }
  const cfg = await sb.from("app_config").select("value").eq("key", "mgr_risk_hours").maybeSingle();
  const riskHours = parseRiskHours(cfg?.data?.value);
  const core = await loadCore(sb, { day: o.day, nowMs: o.nowMs, riskHours, reservations: loaded.reservations });
  const jobs = buildJobs(core);
  const who = buildWho(core, jobs);
  const arrivals = buildArrivals(core);
  const [problems, control] = await Promise.all([loadProblems(sb, core, jobs, arrivals.rows), loadControl(sb, core)]);
  const assignable = Object.values(core.people)
    .filter((p) => p.active && (p.role === "cleaner" || p.role === "subcontractor"))
    .sort(byRoleThenName)
    .map((p) => ({ id: p.id, name: p.name, role: p.role }));
  return {
    status: 200,
    body: {
      day: o.day, generatedAt: new Date(o.nowMs).toISOString(), bookingsCachedAt: loaded.cachedAt, riskHours,
      me: { id: o.me.cleaner_id, name: o.me.name },
      strip: {
        cleanings: jobs.length,
        unassigned: jobs.filter((j) => !j.assigned.length && j.state !== "done").length,
        arrivals: arrivals.rows.length,
        notReady: arrivals.rows.filter((a) => a.tone !== "ok").length,
      },
      who, problems, control, arrivals, assignable,
      ticketsByListing: buildTicketsByListing(core),
    },
  };
}
```

In `supabase/functions/hostaway-proxy/index.ts`:

1. After the line `import { sessionActor } from "./actor.ts";` add:

```ts
import { mgrAccess, MGR_LOOKBACK_DAYS, normalizeMgrReservations, type MgrReservation } from "./mgr_rules.ts";
import { mgrToday } from "./mgr_api.ts";
```

2. After the function `loadInspReservations` (ends just before `async function fetchAllPages`), add:

```ts
// Reservations de l'app manager : departs des 14 derniers jours (menage precedent
// de chaque arrivee) et arrivees des 14 prochains jours (prochain guest de chaque
// menage). Meme cache au chaud qu'Inspections, sous sa propre cle.
async function loadMgrReservations(sb: any, day: string): Promise<{ reservations: MgrReservation[]; cachedAt: string | null }> {
  return loadReservationsCached<MgrReservation>(sb, day, {
    cacheKey: "mgr:res:" + day,
    fetchHostaway: async (d) => {
      const token = await getAccessToken();
      const h = { "Authorization": "Bearer " + token, "Content-Type": "application/json" };
      const [deps, arrs] = await Promise.all([
        fetchAllPages(API_BASE + "/reservations?departureStartDate=" + plusDays(d, -MGR_LOOKBACK_DAYS) + "&departureEndDate=" + d, h),
        fetchAllPages(API_BASE + "/reservations?arrivalStartDate=" + d + "&arrivalEndDate=" + plusDays(d, MGR_LOOKBACK_DAYS), h),
      ]);
      return normalizeMgrReservations([...deps, ...arrs]);
    },
    waitUntil: (p) => { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch (_e) { /* best effort */ } },
  });
}
```

3. In `ROUTES`, right after the line `["insp.setFixSchedule", "POST"],` add:

```ts
  // ===== App manager /manager/ (spec 2026-10-09) =====
  ["mgr.today", "GET"],
```

4. Right before the line `    // ==================== INSPECTIONS ====================`, add:

```ts
    // ==================== MANAGER (/manager/) ====================
    // Today en un appel. Session email obligatoire (Bearer), role manager.
    if (action === "mgr.today") {
      const me = await currentUser(sb, req);
      const acc = mgrAccess(bearerToken(req) !== null, me);
      if (!acc.ok) return jsonResp({ error: acc.error }, acc.status);
      const r = await mgrToday(sb, {
        day: todayDubai(), nowMs: Date.now(), me: me!,
        loadReservations: (d) => loadMgrReservations(sb, d),
      });
      return jsonResp(r.body, r.status);
    }

```

- [ ] **Step 4: Run tests and type-check**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_rules_test.ts insp_reservations_test.ts mgr_api_test.ts && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts`
Expected: all pass (mgr_rules 15, insp_reservations previous count + 1, mgr_api 3), `deno check` exit 0.

- [ ] **Step 5: Whole proxy suite (regression)**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add supabase/functions/hostaway-proxy/mgr_rules.ts supabase/functions/hostaway-proxy/mgr_rules_test.ts supabase/functions/hostaway-proxy/insp_reservations.ts supabase/functions/hostaway-proxy/insp_reservations_test.ts supabase/functions/hostaway-proxy/mgr_api.ts supabase/functions/hostaway-proxy/mgr_api_test.ts supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: action mgr.today (4 blocs de Today, managers en session email, cache Hostaway mgr:res, seuil app_config.mgr_risk_hours)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---

### Task 7: `/manager/` shell: access, navigation, placeholders, no service worker

**Files:**
- Create: `manager/index.html`, `manager/ui/theme.js`, `manager/ui/tokens.css`, `manager/ui/components.css`, `manager/ui/dom.js`, `manager/api.js`, `manager/access.js`, `manager/app.js`, `manager/screens/placeholder.js`
- Create: `tests/manager/helpers.ts`, `tests/manager/access.spec.ts`, `tests/manager/shell.spec.ts`
- Modify: `playwright.config.ts` (two projects, ignore `manager/` in `desktop` and `mobile`)
- Modify: `sw.js` (skip `/manager/`), `_headers` (no-cache on `/manager/`)

**Interfaces:**
- Consumes: `/v3/session.js` `getSession(): Promise<{kind:'bearer'|'pin'|'stale', token} | null>`; `/v3/proxy-config.js` `API`, `APP_SECRET`; `/vendor/supabase-js-2.116.0.umd.js`; proxy `cleanerMe` → `{ status, cleaner: { id, name, color, role, email? } | null }`.
- Produces (front modules, used by Tasks 8 to 10):
  - `manager/api.js`: `TIMEOUT_MS = 15000`; `class ApiError extends Error { kind: 'offline'|'timeout'|'auth'|'forbidden'|'server'; status: number }`; `get(action, params?) → Promise<object>`; `post(action, body) → Promise<object>`. Test hook: `window.__MGR_TIMEOUT_MS` overrides the delay.
  - `manager/access.js`: `decideAccess(session, cleaner) → { go: '/' } | { go: '/v3/' } | { screen: 'email' } | { ok: true }`.
  - `manager/ui/dom.js`: `esc(s)`, `I` (icons `today, planning, problems, inspections, more, close, theme`), `aptLabel(o)`, `placeLabel(o)`, `dubaiTime(iso) → 'HH:MM'`, `initSheet()`, `openSheet(html)`, `closeSheet()`, `sheetIsOpen()`, `toast(msg, undo?)`, `toggleTheme()`.
  - `manager/app.js`: router over `#/today #/planning #/problems #/inspections #/more`; screen context `ctx = { me: {id, name} | null, main: HTMLElement, isCurrent(): boolean, onLeave(fn), emailRequired() }`; Today is loaded with `import('/manager/screens/today.js')` and must export `renderToday(ctx): Promise<void>` (absent until Task 8: a placeholder is shown). Sets `window.__mgrReady = true` once booted.
  - `manager/screens/placeholder.js`: `renderPlaceholder(ctx, view)`; links: Planning, Problems, More → `/?legacy=1`; Inspections → `/inspections/`.
  - `tests/manager/helpers.ts`: `bootMgr(page, routes, opts)`, `fetchLog(page)`, `noHorizontalScroll(page)`, `me(member)`, `MANAGER`, `FakeRoute`.

Service worker decision: `/manager/` registers no service worker in phase 1. The root `sw.js` (scope `/`) returns early for `/manager/` like it does for `/v3/`, so module files always come from the network, and `_headers` serves `/manager/` with `Cache-Control: no-cache`. Offline reading relies on the local copy of the last `mgr.today` (Task 9), not on a cached shell.

- [ ] **Step 1: Add the Playwright projects and the test helpers**

In `playwright.config.ts`, change the two `testIgnore` lines of projects `desktop` and `mobile` from:

```ts
      testIgnore: [/v3\//, /v3-node\//, /inspections\//],
```

to:

```ts
      testIgnore: [/v3\//, /v3-node\//, /inspections\//, /manager\//],
```

and add after the `insp-desktop` project:

```ts
    {
      name: 'mgr-mobile',
      testMatch: /manager\/.*\.spec\.ts/,
      use: { ...devices['iPhone 13'], baseURL: V3_URL },
    },
    {
      name: 'mgr-desktop',
      testMatch: /manager\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: V3_URL },
    },
```

(`iPhone 13` is 390 px wide.)

Create `tests/manager/helpers.ts`:

```ts
import type { Page } from '@playwright/test';

// Meme principe que tests/inspections/helpers.ts : window.fetch bouchonne avant
// les modules, journal dans localStorage. « / » et « /v3/ » sont remplaces par
// des pages temoins : on ne verifie ici que les decisions de /manager/.
export type FakeRoute = { match: string; status: number; body: any; delay?: number; once?: boolean; fail?: boolean };

export const MANAGER = { id: 8, name: 'Walter', color: '#e94560', role: 'manager', email: 'walter@example.com' };
export const me = (member: any) => ({ match: 'action=cleanerMe', status: 200, body: { status: 'success', cleaner: member } });

// Session au format ecrit par supabase-js dans hkAuthSession, valide tres loin.
export function emailSession() {
  return {
    access_token: 'jwt-test', refresh_token: 'refresh-test', token_type: 'bearer',
    expires_in: 3600, expires_at: 4102444800, user: { id: 'u-test', email: 'walter@example.com' },
  };
}

export async function bootMgr(
  page: Page,
  routes: FakeRoute[],
  opts: { email?: boolean; pin?: string; hash?: string; timeoutMs?: number; cache?: { savedAt: number; data: any }; clock?: Date } = {},
) {
  await page.route('https://fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route(/\/v3\/(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>V3 STUB</title><h1>V3 STUB</h1>' }));
  await page.route(/:\d+\/(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>ROOT STUB</title><h1>ROOT STUB</h1>' }));
  if (opts.clock) await page.clock.setFixedTime(opts.clock);
  await page.addInitScript((cfg: any) => {
    try {
      if (localStorage.getItem('mgrTestSeeded') !== '1') {
        localStorage.setItem('mgrTestSeeded', '1');
        if (cfg.email) localStorage.setItem('hkAuthSession', JSON.stringify(cfg.email));
        if (cfg.pin) localStorage.setItem('cleanerToken', cfg.pin);
        if (cfg.cache) localStorage.setItem('mgrTodayCache', JSON.stringify(cfg.cache));
      }
    } catch (e) { /* stockage indisponible */ }
    if (cfg.timeoutMs) (window as any).__MGR_TIMEOUT_MS = cfg.timeoutMs;
    (window as any).__logFetch = function (entry: any) {
      try {
        const l = JSON.parse(localStorage.getItem('mgrFetchLog') || '[]');
        l.push(entry);
        localStorage.setItem('mgrFetchLog', JSON.stringify(l.slice(-100)));
      } catch (e) { /* quota */ }
    };
    const real = window.fetch.bind(window);
    const servies = new Set<any>();
    window.fetch = ((input: any, init: any) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/auth/v1/') !== -1) {
        return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
      }
      if (url.indexOf('hostaway-proxy') === -1) return real(input, init);
      (window as any).__logFetch({
        url, body: init && typeof init.body === 'string' ? init.body : '',
        headers: init && init.headers ? JSON.parse(JSON.stringify(init.headers)) : {},
      });
      for (const r of cfg.routes) {
        if (url.indexOf(r.match) === -1 || servies.has(r)) continue;
        if (r.once) servies.add(r);
        if (r.fail) return new Promise((_res, rej) => setTimeout(() => rej(new TypeError('Failed to fetch')), r.delay || 0));
        const make = () => new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
        if (r.delay) return new Promise((res) => setTimeout(() => res(make()), r.delay));
        return Promise.resolve(make());
      }
      return Promise.resolve(new Response(JSON.stringify({ error: 'no fake route' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    }) as any;
  }, {
    routes, email: opts.email ? emailSession() : null, pin: opts.pin || null,
    cache: opts.cache || null, timeoutMs: opts.timeoutMs || 0,
  });
  await page.goto('/manager/' + (opts.hash || ''), { waitUntil: 'domcontentloaded' });
}

export async function fetchLog(page: Page) {
  return await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('mgrFetchLog') || '[]'); } catch (e) { return []; }
  }) as Array<{ url: string; body: string; headers: any }>;
}

export async function noHorizontalScroll(page: Page) {
  return await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/manager/access.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';

const member = (role: string) => ({ ...MANAGER, id: 30, name: 'Member', role });

test('sans session : renvoye vers la connexion', async ({ page }) => {
  await bootMgr(page, []);
  await expect(page.locator('h1')).toHaveText('ROOT STUB');
});

test('cleaner en session email : renvoyee vers /v3/', async ({ page }) => {
  await bootMgr(page, [me(member('cleaner'))], { email: true });
  await expect(page.locator('h1')).toHaveText('V3 STUB');
});

for (const role of ['maintenance', 'subcontractor']) {
  test('role ' + role + ' : renvoye vers l ancienne app', async ({ page }) => {
    await bootMgr(page, [me(member(role))], { email: true });
    await expect(page.locator('h1')).toHaveText('ROOT STUB');
  });
}

test('manager en session PIN seulement : ecran email, aucun appel mgr.today', async ({ page }) => {
  await bootMgr(page, [me(MANAGER)], { pin: 'pin-tok' });
  await expect(page.getByRole('heading', { name: 'Sign in with your email' })).toBeVisible();
  await expect(page.locator('#tabbar a')).toHaveCount(0);
  const log = await fetchLog(page);
  expect(log.some((l) => l.url.includes('action=mgr.today'))).toBe(false);
  expect(log.find((l) => l.url.includes('action=cleanerMe'))!.headers['X-Cleaner-Token']).toBe('pin-tok');
});

test('manager en session email : coquille, en-tete Bearer', async ({ page }) => {
  await bootMgr(page, [me(MANAGER)], { email: true, hash: '#/planning' });
  await expect(page.getByRole('heading', { name: 'Planning' })).toBeVisible();
  const log = await fetchLog(page);
  expect(log.find((l) => l.url.includes('action=cleanerMe'))!.headers['Authorization']).toBe('Bearer jwt-test');
});
```

Create `tests/manager/shell.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me, noHorizontalScroll } from './helpers';

const LINKS: Array<[string, string, string]> = [
  ['planning', 'Planning', '/?legacy=1'],
  ['problems', 'Problems', '/?legacy=1'],
  ['inspections', 'Inspections', '/inspections/'],
  ['more', 'More', '/?legacy=1'],
];

test('navigation : 5 entrees, entree courante marquee, ecrans provisoires avec lien vers l ecran actuel', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER)], { email: true, hash: '#/planning' });
  const nav = info.project.name === 'mgr-desktop' ? page.locator('#sideNav') : page.locator('#tabbar');
  await expect(nav).toBeVisible();
  await expect(nav.locator('a')).toHaveText(['Today', 'Planning', 'Problems', 'Inspections', 'More']);
  for (const [id, title, href] of LINKS) {
    await nav.locator('a[href="#/' + id + '"]').click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(nav.locator('a[href="#/' + id + '"]')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('main .ph a.btn')).toHaveAttribute('href', href);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('aucun defilement horizontal, fond selon le theme (' + scheme + ')', async ({ page }) => {
      await bootMgr(page, [me(MANAGER)], { email: true, hash: '#/more' });
      await expect(page.getByRole('heading', { name: 'More', exact: true })).toBeVisible();
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(10, 11, 14)' : 'rgb(243, 244, 247)');
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    });
  });
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (`/manager/` is a 404 directory listing, no `ROOT STUB`, no headings).

- [ ] **Step 4: Write the shell**

`manager/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f3f4f7">
<title>HK Planner · Manager</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Fragment+Mono&display=swap">
<link rel="stylesheet" href="/manager/ui/tokens.css">
<link rel="stylesheet" href="/manager/ui/components.css">
<link rel="stylesheet" href="/manager/ui/today.css">
<script src="/manager/ui/theme.js"></script>
</head>
<body>
<div class="app">
  <nav class="sidebar" aria-label="Main">
    <div class="brand"><i></i>HK Planner</div>
    <div id="sideNav"></div>
    <div class="side-foot" id="sideFoot"></div>
  </nav>
  <main id="main"><p class="boot" role="status">Loading…</p></main>
</div>
<nav class="tabbar" id="tabbar" aria-label="Main"></nav>
<div class="scrim" id="scrim"></div>
<aside class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" aria-hidden="true">
  <div class="grab"></div>
  <div id="sheetInner" class="sheet-inner"></div>
</aside>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script src="/vendor/supabase-js-2.116.0.umd.js"></script>
<script type="module" src="/manager/app.js"></script>
</body>
</html>
```

`manager/ui/theme.js` (classic script: the CSP forbids inline scripts, and the theme must be set before first paint):

```js
// Theme choisi a la main (bouton de l'en-tete), sinon celui du systeme.
(function () {
  try {
    var t = localStorage.getItem('mgrTheme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* stockage indisponible : theme systeme */ }
}());
```

`manager/ui/tokens.css` (tokens copied verbatim from the validated prototype):

```css
/* HK Planner manager · tokens du prototype Today valide le 09/10/2026 (ADN Flighty).
 * Statuts : vert #039855, ambre #F79009 sur #FEF0C7, rouge #D92D20 sur #FEE4E2. */
:root{
  --bg:#f3f4f7; --surface:#ffffff; --surface-2:#f7f8fa; --sunk:#eceef2;
  --ink:#0c0e13; --ink-2:#454c5a; --ink-3:#6b7282; --line:#e2e5ea; --line-2:#d3d7de;
  --accent:#0a6fd6; --accent-ink:#ffffff; --accent-tint:#e5f1fd;
  --ok:#039855; --ok-ink:#05603a; --ok-tint:#e2f5ea;
  --warn:#f79009; --warn-ink:#93370d; --warn-tint:#fef0c7;
  --bad:#d92d20; --bad-ink:#912018; --bad-tint:#fee4e2;
  --scrim:rgba(10,12,18,.42); --shadow:0 1px 2px rgba(16,20,30,.06),0 8px 28px rgba(16,20,30,.08);
  --focus:#0a6fd6;
  --font-ui:"Onest",system-ui,-apple-system,"Segoe UI",sans-serif;
  --font-mono:"Fragment Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --r-sm:8px; --r-md:12px; --r-lg:18px;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:20px; --s6:24px; --s8:32px; --s10:40px;
  --ease-out:cubic-bezier(.16,1,.3,1); --ease-in:cubic-bezier(.7,0,.84,0);
  --sidebar:232px;
  color-scheme:light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0a0b0e; --surface:#14161b; --surface-2:#1a1d23; --sunk:#202329;
    --ink:#f2f4f7; --ink-2:#b4bac5; --ink-3:#8a919e; --line:#252830; --line-2:#323641;
    --accent:#4ea8ff; --accent-ink:#06121f; --accent-tint:#10243a;
    --ok:#32d583; --ok-ink:#6ce9a6; --ok-tint:#0d2a1d;
    --warn:#fdb022; --warn-ink:#fec84b; --warn-tint:#2e2109;
    --bad:#f97066; --bad-ink:#fda29b; --bad-tint:#33130f;
    --scrim:rgba(0,0,0,.6); --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.45);
    --focus:#4ea8ff; color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --bg:#0a0b0e; --surface:#14161b; --surface-2:#1a1d23; --sunk:#202329;
  --ink:#f2f4f7; --ink-2:#b4bac5; --ink-3:#8a919e; --line:#252830; --line-2:#323641;
  --accent:#4ea8ff; --accent-ink:#06121f; --accent-tint:#10243a;
  --ok:#32d583; --ok-ink:#6ce9a6; --ok-tint:#0d2a1d;
  --warn:#fdb022; --warn-ink:#fec84b; --warn-tint:#2e2109;
  --bad:#f97066; --bad-ink:#fda29b; --bad-tint:#33130f;
  --scrim:rgba(0,0,0,.6); --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.45);
  --focus:#4ea8ff; color-scheme:dark;
}
*{box-sizing:border-box}
html,body{margin:0;overflow-x:clip}
body{background:var(--bg);color:var(--ink);font-family:var(--font-ui);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased;font-feature-settings:"tnum" 1}
button{font:inherit;color:inherit}
.tnum{font-variant-numeric:tabular-nums}
.mono{font-family:var(--font-mono);font-size:14px;letter-spacing:0}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:6px}
@media (prefers-reduced-motion: reduce){
  *{transition-duration:.01ms !important;animation-duration:.01ms !important}
}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
```

`manager/ui/components.css`:

```css
/* Coquille, en-tete, cartes, boutons, pastilles, panneau, toast (prototype Today). */
.app{min-height:100vh;display:block}
.sidebar{display:none}
main{padding:0 16px 112px;max-width:1240px;margin:0 auto}
.boot{color:var(--ink-3);padding:var(--s8) 0}
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:20;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
.tab{background:none;border:0;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0;font-size:12px;font-weight:500;color:var(--ink-3);cursor:pointer;border-radius:10px;white-space:nowrap;text-decoration:none;min-width:0}
.tab svg{width:24px;height:24px}
.tab[aria-current="page"]{color:var(--accent)}
.tab-wrap{position:relative}
.bare .sidebar,.bare .tabbar{display:none !important}
@media (min-width:960px){
  .app{display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr)}
  .bare .app{display:block}
  .tabbar{display:none}
  .sidebar{display:flex;flex-direction:column;gap:var(--s1);position:sticky;top:0;height:100vh;padding:var(--s6) var(--s3);border-right:1px solid var(--line);background:var(--surface)}
  .brand{font-weight:700;font-size:17px;padding:0 var(--s3) var(--s5);display:flex;align-items:center;gap:var(--s2)}
  .brand i{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--accent)}
  .navlink{display:flex;align-items:center;gap:var(--s3);padding:10px var(--s3);border-radius:10px;border:0;background:none;text-align:left;font-size:16px;font-weight:500;color:var(--ink-2);cursor:pointer;width:100%;text-decoration:none}
  .navlink svg{width:20px;height:20px;flex:none}
  .navlink:hover{background:var(--surface-2);color:var(--ink)}
  .navlink[aria-current="page"]{background:var(--accent-tint);color:var(--accent)}
  .side-foot{margin-top:auto;padding:var(--s3);font-size:13px;color:var(--ink-3)}
  main{padding:0 var(--s8) var(--s10)}
}

.top{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s3);padding:calc(var(--s5) + env(safe-area-inset-top)) 0 var(--s4)}
.top h1{margin:0;font-size:34px;line-height:1.1;font-weight:700;letter-spacing:-.02em}
.top .date{color:var(--ink-2);font-size:16px;margin-top:2px}
.asof{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:13px;color:var(--ink-3);margin-top:6px}
.asof::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok)}
.asof.stale::before{background:var(--warn)}
.iconbtn{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;cursor:pointer;flex:none}
.iconbtn:hover{background:var(--surface-2)}
.iconbtn svg{width:20px;height:20px}

section.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;min-width:0}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s3);padding:var(--s4) var(--s4) var(--s2)}
.sec-head h2{margin:0;font-size:20px;line-height:1.25;font-weight:600;letter-spacing:-.01em}
.sec-head .meta{color:var(--ink-3);font-size:14px;white-space:nowrap}
.st{font-weight:600}
.st.ok{color:var(--ok-ink)} .st.warn{color:var(--warn-ink)} .st.bad{color:var(--bad-ink)}
:root:not([data-theme="dark"]) .st.ok{color:var(--ok)}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]) .st.ok{color:var(--ok-ink)} }
.bar{width:4px;border-radius:4px;align-self:stretch;flex:none}
.bar.ok{background:var(--ok)} .bar.warn{background:var(--warn)} .bar.bad{background:var(--bad)} .bar.idle{background:var(--line-2)}
.pill{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}
.pill.ok{background:var(--ok-tint);color:var(--ok-ink)}
.pill.warn{background:var(--warn-tint);color:var(--warn-ink)}
.pill.bad{background:var(--bad-tint);color:var(--bad-ink)}
.pill.idle{background:var(--sunk);color:var(--ink-2)}
.empty{color:var(--ink-3);font-size:15px;padding:2px 0}
.empty.pad{padding:var(--s3) var(--s4)}
.note{color:var(--ink-3);font-size:14px;margin-top:var(--s2)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line-2);background:var(--surface);font-weight:600;font-size:15px;cursor:pointer;white-space:nowrap;text-decoration:none;color:var(--ink);transition:background-color .15s var(--ease-out),transform .1s var(--ease-out)}
.btn:hover{background:var(--surface-2)}
.btn:active{transform:translateY(1px)}
.btn[disabled]{opacity:.55;cursor:default}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{filter:brightness(1.06)}
.btn.sm{min-height:36px;padding:0 12px;font-size:14px}
.link{background:none;border:0;padding:0;color:var(--accent);font-weight:600;cursor:pointer;font-size:15px;text-decoration:none}

.ph{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:var(--s6) var(--s5)}
.ph h2{margin:0 0 var(--s2);font-size:24px}
.ph p{color:var(--ink-2);margin:0 0 var(--s3)}
.banner{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s3);align-items:center;justify-content:space-between;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);padding:var(--s2) var(--s3);margin-bottom:var(--s3);color:var(--ink-2);font-size:15px}
.banner.warn{background:var(--warn-tint);border-color:transparent;color:var(--warn-ink)}
.err-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:var(--s5);display:flex;flex-direction:column;gap:var(--s3);align-items:flex-start}
.err-card p{margin:0;color:var(--ink)}

.scrim{position:fixed;inset:0;background:var(--scrim);opacity:0;pointer-events:none;transition:opacity .2s var(--ease-out);z-index:40}
.scrim.on{opacity:1;pointer-events:auto}
.sheet{position:fixed;z-index:50;background:var(--surface);box-shadow:var(--shadow);display:flex;flex-direction:column;left:0;right:0;bottom:0;max-height:88vh;border-radius:20px 20px 0 0;transform:translateY(104%);transition:transform .32s var(--ease-out);padding-bottom:env(safe-area-inset-bottom);visibility:hidden}
.sheet.on{transform:none;visibility:visible}
.sheet .grab{width:40px;height:5px;border-radius:3px;background:var(--line-2);margin:8px auto 0;flex:none}
.sheet-inner{display:flex;flex-direction:column;min-height:0;flex:1}
.sheet-h{display:flex;align-items:flex-start;gap:var(--s3);padding:var(--s3) var(--s4);border-bottom:1px solid var(--line)}
.sheet-h h2{margin:0;font-size:22px;line-height:1.25;overflow-wrap:anywhere}
.sheet-h .sub{color:var(--ink-2);font-size:15px}
.sheet-h .x{margin-left:auto}
.sheet-b{flex:1;min-height:0;overflow:auto;padding:var(--s4);display:flex;flex-direction:column;gap:var(--s4);overscroll-behavior:contain}
.sheet-f{border-top:1px solid var(--line);padding:var(--s3) var(--s4);display:flex;gap:var(--s2);flex-wrap:wrap}
.sheet-err{margin:0;background:var(--bad-tint);color:var(--bad-ink);border-radius:var(--r-md);padding:var(--s2) var(--s3);font-weight:500}
@media (min-width:960px){
  .sheet{left:auto;top:0;bottom:0;right:0;width:460px;max-height:none;border-radius:0;transform:translateX(104%);border-left:1px solid var(--line)}
  .sheet .grab{display:none}
  .scrim{background:color-mix(in srgb,var(--scrim) 50%,transparent)}
}

.toast{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translate(-50%,16px);opacity:0;z-index:60;background:var(--ink);color:var(--bg);padding:10px 14px;border-radius:12px;font-size:15px;display:flex;gap:var(--s3);align-items:center;transition:opacity .18s var(--ease-out),transform .18s var(--ease-out);max-width:calc(100vw - 32px);pointer-events:none}
.toast.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.toast button{background:none;border:0;color:var(--accent);font-weight:700;cursor:pointer;padding:4px}
:root[data-theme="dark"] .toast button{color:#0a6fd6}
@media (min-width:960px){ .toast{bottom:28px} }
```

Create an empty-but-valid `manager/ui/today.css` now (Task 8 fills it) so the `<link>` does not 404:

```css
/* Ecran Today : rempli a la tache 8. */
```

`manager/ui/dom.js`:

```js
// Briques d'interface communes de /manager/ : echappement, icones, panneau
// (feuille sur telephone, panneau lateral sur ordinateur), toast, theme.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const I = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  planning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  problems: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 10v4M12 17h.01"/></svg>',
  inspections: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6v3H9z"/><path d="M15 5.5h2.5v15h-11v-15H9"/><path d="m9 13 2 2 4-4"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/></svg>',
};

export function aptLabel(o) { return o && o.apt ? 'Apt ' + o.apt : ''; }
export function placeLabel(o) { return [aptLabel(o), o && o.bld].filter(Boolean).join(' · '); }

export function dubaiTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai' });
  } catch (e) { return ''; }
}

const $ = (id) => document.getElementById(id);
let lastFocus = null;

export function sheetIsOpen() {
  const s = $('sheet');
  return !!s && s.classList.contains('on');
}
export function openSheet(html) {
  const sh = $('sheet');
  if (!sheetIsOpen()) lastFocus = document.activeElement;
  $('sheetInner').innerHTML = html;
  sh.classList.add('on');
  sh.setAttribute('aria-hidden', 'false');
  $('scrim').classList.add('on');
  const x = sh.querySelector('.x');
  if (x) x.focus();
}
export function closeSheet() {
  const sh = $('sheet');
  if (!sh || !sheetIsOpen()) return;
  sh.classList.remove('on');
  sh.setAttribute('aria-hidden', 'true');
  $('scrim').classList.remove('on');
  if (lastFocus && document.body.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}
// Une seule fois au demarrage : fermeture (croix, fond, Echap) et focus garde dans le panneau.
export function initSheet() {
  $('scrim').addEventListener('click', closeSheet);
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => {
    if (!sheetIsOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); closeSheet(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.from($('sheet').querySelectorAll('button:not([disabled]), a[href]'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

let toastTimer = null;
export function toast(msg, undo) {
  const el = $('toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button type="button" data-undo>Undo</button>' : '');
  el.classList.add('on');
  if (undo) el.querySelector('[data-undo]').onclick = () => { el.classList.remove('on'); undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), undo ? 6000 : 3000);
}

export function toggleTheme() {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme');
  const dark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('mgrTheme', next); } catch (e) { /* theme non garde */ }
}
```

`manager/api.js`:

```js
// Acces au proxy pour /manager/. Memes conventions que /inspections/api.js
// (action en query, X-App-Secret, puis Bearer ou X-Cleaner-Token), plus un delai
// client de 15 s (spec section 7, cas du proxy lent du 07/10) : au-dela, on
// n'attend plus et l'ecran propose Retry.
import { API, APP_SECRET } from '/v3/proxy-config.js';
import { getSession } from '/v3/session.js';

export const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(message, kind, status) { super(message); this.name = 'ApiError'; this.kind = kind; this.status = status; }
}

// Crochet de test : window.__MGR_TIMEOUT_MS raccourcit le delai.
function timeoutMs() {
  const t = Number(typeof window !== 'undefined' ? window.__MGR_TIMEOUT_MS : 0);
  return t > 0 ? t : TIMEOUT_MS;
}

async function headers() {
  const s = await getSession();
  const h = { 'X-App-Secret': APP_SECRET };
  if (s && s.kind === 'bearer') h['Authorization'] = 'Bearer ' + s.token;
  else if (s && s.kind === 'pin') h['X-Cleaner-Token'] = s.token;
  return h;
}

async function send(url, init) {
  const ctrl = new AbortController();
  let timer = null;
  // Course plutot que la seule annulation : un fetch qui ignore le signal ne
  // doit pas tenir l'ecran.
  const late = new Promise((_res, rej) => {
    timer = setTimeout(() => {
      try { ctrl.abort(); } catch (e) { /* deja fini */ }
      rej(new ApiError('HK Planner is taking too long to answer. Try again.', 'timeout', 0));
    }, timeoutMs());
  });
  let res;
  try {
    res = await Promise.race([fetch(url, { ...init, signal: ctrl.signal }), late]);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('No connection. Try again.', 'offline', 0);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new ApiError('Please sign in again.', 'auth', 401);
  if (res.status === 403) throw new ApiError(data.error || 'Not allowed.', 'forbidden', 403);
  if (!res.ok || data.error) throw new ApiError(data.error || ('Error ' + res.status), 'server', res.status);
  return data;
}

export async function get(action, params) {
  let url = API + '?action=' + encodeURIComponent(action);
  for (const k of Object.keys(params || {})) url += '&' + k + '=' + encodeURIComponent(params[k]);
  return send(url, { headers: await headers() });
}

export async function post(action, body) {
  return send(API + '?action=' + encodeURIComponent(action), {
    method: 'POST', headers: { ...(await headers()), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
```

`manager/access.js`:

```js
// Qui entre dans /manager/ (spec section 6) : managers en session email.
// Cleaner -> /v3/ ; subcontractor, maintenance et autres -> ancienne app ;
// manager avec un PIN seulement -> ecran « Sign in with your email ».
export function decideAccess(session, cleaner) {
  if (!session || !cleaner) return { go: '/' };
  if (cleaner.role === 'cleaner') return { go: '/v3/' };
  if (cleaner.role !== 'manager') return { go: '/' };
  if (session.kind !== 'bearer') return { screen: 'email' };
  return { ok: true };
}
```

`manager/screens/placeholder.js`:

```js
// Ecrans des phases suivantes : en attendant, un lien vers l'ecran actuel.
import { esc } from '/manager/ui/dom.js';

const P = {
  today: { title: 'Today', text: 'Today could not be loaded.', href: '#/today', cta: 'Try again' },
  planning: { title: 'Planning', text: 'The week grid comes in a later phase. Until then, plan cleanings in the current app.', href: '/?legacy=1', cta: 'Open planning in the current app' },
  problems: { title: 'Problems', text: 'One inbox for tickets, inspection findings, cleaner reports and team tasks comes in the next phase.', href: '/?legacy=1', cta: 'Open maintenance in the current app' },
  inspections: { title: 'Inspections', text: 'Inspections move into this app in a later phase.', href: '/inspections/', cta: 'Open Inspections' },
  more: { title: 'More', text: 'Team, HR, reviews, reports and settings stay in the current app for now.', href: '/?legacy=1', cta: 'Open the current app' },
};

export function renderPlaceholder(ctx, view) {
  const p = P[view] || P.today;
  ctx.main.innerHTML = '<header class="top"><div><h1>' + esc(p.title) + '</h1></div></header>'
    + '<div class="ph"><p>' + esc(p.text) + '</p><a class="btn primary" href="' + esc(p.href) + '">' + esc(p.cta) + '</a></div>';
}
```

`manager/app.js`:

```js
// App manager /manager/ (spec 2026-10-09-hk-manager-app-design.md) : acces,
// navigation Today · Planning · Problems · Inspections · More, routeur par hash.
import { getSession } from '/v3/session.js';
import { get } from '/manager/api.js';
import { decideAccess } from '/manager/access.js';
import { closeSheet, I, initSheet, toggleTheme } from '/manager/ui/dom.js';
import { renderPlaceholder } from '/manager/screens/placeholder.js';

const VIEWS = [
  { id: 'today', label: 'Today' }, { id: 'planning', label: 'Planning' }, { id: 'problems', label: 'Problems' },
  { id: 'inspections', label: 'Inspections' }, { id: 'more', label: 'More' },
];
const main = document.getElementById('main');
let me = null;
let seq = 0;
let leaving = [];
let listening = false;

function currentView() {
  const v = (location.hash || '#/today').replace(/^#\/?/, '').split(/[/?]/)[0];
  return VIEWS.some((x) => x.id === v) ? v : 'today';
}

function renderNav(view) {
  const link = (cls, v, inner) => '<a class="' + cls + '" href="#/' + v.id + '"' + (view === v.id ? ' aria-current="page"' : '') + '>' + inner + '</a>';
  document.getElementById('sideNav').innerHTML = VIEWS.map((v) => link('navlink', v, I[v.id] + '<span>' + v.label + '</span>')).join('');
  document.getElementById('tabbar').innerHTML = VIEWS.map((v) => link('tab', v, '<span class="tab-wrap">' + I[v.id] + '</span>' + v.label)).join('');
  document.getElementById('sideFoot').textContent = me ? 'Signed in as ' + me.name : 'Offline';
}

function emailRequired() {
  document.body.classList.add('bare');
  document.getElementById('sideNav').innerHTML = '';
  document.getElementById('tabbar').innerHTML = '';
  main.innerHTML = '<div class="ph" style="margin-top:32px"><h2>Sign in with your email</h2>'
    + '<p>The manager app needs your email account. This device is signed in with a PIN.</p>'
    + '<p>Open HK Planner, sign out, then sign in with your email and password.</p>'
    + '<a class="btn primary" href="/?legacy=1">Open HK Planner</a></div>';
}

async function route() {
  const mine = ++seq;
  const old = leaving;
  leaving = [];
  for (const fn of old) { try { fn(); } catch (e) { /* nettoyage best effort */ } }
  closeSheet();
  const view = currentView();
  renderNav(view);
  const ctx = { me, main, isCurrent: () => mine === seq, onLeave: (fn) => { leaving.push(fn); }, emailRequired };
  if (view === 'today') {
    let mod = null;
    try { mod = await import('/manager/screens/today.js'); } catch (e) { mod = null; }
    if (mine !== seq) return;
    if (mod && typeof mod.renderToday === 'function') { await mod.renderToday(ctx); return; }
  }
  renderPlaceholder(ctx, view);
}

function startShell() {
  if (!listening) { listening = true; window.addEventListener('hashchange', route); }
  return route();
}

async function boot() {
  initSheet();
  document.addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-theme-toggle]')) toggleTheme();
  });
  let s = null;
  try { s = await getSession(); } catch (e) { s = null; }
  if (!s) { location.replace('/'); return; }
  // Session email a renouveler sans reseau : la coquille s'ouvre, Today montre son cache.
  if (s.kind === 'stale') { await startShell(); return; }
  let cleaner = null;
  try {
    const r = await get('cleanerMe');
    cleaner = r && r.cleaner;
  } catch (e) {
    if (e.kind === 'auth') { location.replace('/'); return; }
    await startShell();
    return;
  }
  const d = decideAccess(s, cleaner);
  if (d.go) { location.replace(d.go); return; }
  if (d.screen === 'email') { emailRequired(); return; }
  me = { id: cleaner.id, name: cleaner.name };
  await startShell();
}

boot().catch((e) => { console.error('[manager] boot failed', e); }).finally(() => { window.__mgrReady = true; });
```

- [ ] **Step 5: Keep the root service worker away from `/manager/` and serve it uncached**

Edit the working tree `sw.js`: right after the line `  if (url.pathname.indexOf('/v3/') === 0) return;` insert:

```js
  // /manager/ (nouvelle app manager) : aucun service worker en phase 1. Reseau
  // seul, avec les en-tetes no-cache de _headers : jamais de module perime.
  if (url.pathname.indexOf('/manager/') === 0) return;
```

Append to `_headers`:

```
# App manager /manager/ (phase 1) : pas de service worker, jamais de module
# perime dans le cache HTTP.
/manager/
  Cache-Control: no-cache
/manager/*
  Cache-Control: no-cache
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: all `access.spec.ts` and `shell.spec.ts` tests pass on both projects.

- [ ] **Step 7: Commit (only our hunk of `sw.js`: it carries other uncommitted changes)**

`sw.js` already has uncommitted changes that are not ours (VERSION stamp, security-contacts line). Stage only our hunk by applying it to the index:

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
cat > /private/tmp/claude-501/-Users-hillal/53f1183c-ba59-4d8f-a69a-a53171d830fc/scratchpad/sw-manager.patch <<'EOF'
--- a/sw.js
+++ b/sw.js
@@ -42,6 +42,9 @@
   // la racine mettrait en cache les modules de la v3 avant que le sien ne
   // prenne la main, et servirait une version perimee apres un deploiement.
   if (url.pathname.indexOf('/v3/') === 0) return;
+  // /manager/ (nouvelle app manager) : aucun service worker en phase 1. Reseau
+  // seul, avec les en-tetes no-cache de _headers : jamais de module perime.
+  if (url.pathname.indexOf('/manager/') === 0) return;
   // Bypass dynamic API calls
   if (url.hostname.includes('supabase.co')) return;
   if (url.hostname.includes('hostaway.com')) return;
EOF
git apply --cached --check /private/tmp/claude-501/-Users-hillal/53f1183c-ba59-4d8f-a69a-a53171d830fc/scratchpad/sw-manager.patch
git apply --cached /private/tmp/claude-501/-Users-hillal/53f1183c-ba59-4d8f-a69a-a53171d830fc/scratchpad/sw-manager.patch
git diff --cached sw.js
git add manager/index.html manager/ui/theme.js manager/ui/tokens.css manager/ui/components.css manager/ui/today.css manager/ui/dom.js manager/api.js manager/access.js manager/app.js manager/screens/placeholder.js tests/manager/helpers.ts tests/manager/access.spec.ts tests/manager/shell.spec.ts playwright.config.ts _headers
git commit -m "manager: coquille /manager/ (acces managers en session email, navigation, ecrans provisoires), sans service worker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

Expected: `git diff --cached sw.js` shows only the three added lines before the commit; `git diff sw.js` afterwards still shows the VERSION and security-contacts hunks (left uncommitted on purpose).

---
### Task 8: Today screen, read-only (4 blocks, alert, strip, sheets, keyboard)

**Files:**
- Create: `manager/screens/today-view.js`, `manager/screens/today.js`
- Modify: `manager/ui/today.css` (replace the one-line placeholder from Task 7)
- Create: `tests/manager/fixtures.ts`, `tests/manager/today.spec.ts`

**Interfaces:**
- Consumes: `get` (`manager/api.js`), `esc`, `I`, `aptLabel`, `placeLabel`, `dubaiTime`, `openSheet` (`manager/ui/dom.js`), screen `ctx` (Task 7), response `MgrToday` (Task 6).
- Produces:
  - `manager/screens/today-view.js`: `fmtDur(ms)`, `arrivalMs(day, 'HH:MM')`, `boardHtml(data, nowMs, bannerHtml, stale)`, `jobSheet(data, job, nowMs)`, `arrivalSheet(data, arrival, nowMs)`, `problemSheet(problem)`; internal `actionsFoot(key, assigned, done)` and `assignBtn(job)` (Task 10 replaces both); DOM hooks used by Tasks 9 and 10: `[data-open="job"][data-key]`, `[data-open="arr"][data-id]`, `[data-open="prob"][data-ref]`, `[data-retry]`, `[data-nav-row]`.
  - `manager/screens/today.js`: `renderToday(ctx): Promise<void>`.
  - `tests/manager/fixtures.ts`: `DAY`, `NOW` (09/10 11:00 Dubai), `todayBody(over?)`.

Layout (prototype): phone, one column in the order who, problems, control, arrivals (CSS `order`); from 1100 px, two columns (who + control | problems + arrivals); sidebar from 960 px; sheet = bottom sheet on phone, 460 px side panel on desktop. Problem rows are read-only in phase 1 and open a sheet linking to the current app.

- [ ] **Step 1: Write the fixture and the failing tests**

`tests/manager/fixtures.ts`:

```ts
// Reponse mgr.today au format de supabase/functions/hostaway-proxy/mgr_api.ts.
export const DAY = '2026-10-09';
export const NOW = new Date('2026-10-09T07:00:00Z'); // 11:00 Dubai

const J = (o: any) => ({
  kind: 'checkout', checkoutDate: DAY, postponedFrom: null, assigned: [], serviceType: null,
  state: 'not_started', next: null, ...o,
});

export function todayBody(over: any = {}) {
  const base = {
    day: DAY, generatedAt: '2026-10-09T07:00:00.000Z', bookingsCachedAt: null, riskHours: 6,
    me: { id: 8, name: 'Walter' },
    strip: { cleanings: 3, unassigned: 2, arrivals: 4, notReady: 3 },
    who: {
      jobs: [
        J({ key: '2026-10-09_Ann Lee', listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', checkout: '12:00',
          next: { date: DAY, time: '15:00', sameDay: true, owner: false }, tone: 'bad', word: 'Unassigned' }),
        J({ key: '2026-10-09_Lu Mo', listingId: 'L9', apt: '909', bld: 'Bloom Height', checkout: '11:00',
          next: { date: '2026-10-13', time: '15:00', sameDay: false, owner: false }, tone: 'warn', word: 'Usually Elite · not logged yet' }),
        J({ key: '2026-10-09_Cy Doe', listingId: 'L2', apt: '103', bld: 'Damac Reva', checkout: null,
          next: { date: DAY, time: '15:00', sameDay: true, owner: false }, assigned: [4], serviceType: 'CHC', tone: 'warn', word: 'Not started' }),
      ],
      people: [
        { id: 4, name: 'Faiza', role: 'cleaner', keys: ['2026-10-09_Cy Doe'] },
        { id: 10, name: 'Pionah', role: 'cleaner', keys: [] },
        { id: 12, name: 'Elite Cleaning', role: 'subcontractor', keys: [] },
      ],
      unassigned: ['2026-10-09_Ann Lee', '2026-10-09_Lu Mo'],
      technicians: [{ id: 7, name: 'Semax', open: 1, oldest: { id: 106, title: 'Balcony drain blocked', since: '27/04' } }],
    },
    problems: {
      counts: { ticketsOpen: 70, ticketsUrgent: 19, ticketsNoTech: 69, teamTasksOpen: 239, teamTasksOverdue: 113, inspectionFindingsOpen: 2, cleanerReportsOpen: 0 },
      top: [
        { ref: 'MNT-429', source: 'Maintenance', priority: 'urgent', label: 'Urgent', title: 'Gas not working', listingId: 'L1',
          apt: '308', bld: 'Binghatti Lavender', why: 'A guest arrives today at 15:00. Open since 09/07, no technician assigned.', tone: 'bad' },
        { ref: 'TSK-13', source: 'Team task', priority: 'urgent', label: 'Urgent', title: 'AC not cooling', listingId: null,
          apt: '', bld: '', why: 'Assigned to Semax, overdue since 15/05.', tone: 'bad' },
      ],
    },
    control: {
      inspections: { proposed: 4, claimed: 1, done: 0, unfinished: [{ apt: '414', bld: 'Azizi Riviera 11', inspector: 'Hillal', date: '05/10' }] },
      linen: { window: 'last 7 days', rows: [{ name: 'Elite Cleaning', missing: 38, total: 39 }, { name: 'Faiza', missing: 1, total: 10 }] },
      overdue: { total: 113, rows: [{ name: 'Semax', n: 94 }, { name: 'Walter', n: 19 }] },
      yesterday: { date: '08/10', rows: [
        { name: 'Faiza', text: '2 cleanings done, 2 linen counts.' },
        { name: 'Elite Cleaning', text: 'Not logged yet. Elite logs its jobs around 14:00 the next day.' },
        { name: 'Maintenance', text: '0 tickets resolved.' },
      ] },
    },
    arrivals: {
      counts: { ok: 1, warn: 2, bad: 1, idle: 0 },
      rows: [
        { id: '2', listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', time: '15:00', timeSet: true, kind: 'Guest', tone: 'bad', word: 'Blocked',
          cause: 'No cleaner assigned, and urgent ticket open: Gas not working (#429).', prevKey: '2026-10-09_Ann Lee',
          prevCheckout: { date: DAY, time: '12:00' }, cleaners: [], assigned: [], serviceType: null, done: false },
        { id: '4', listingId: 'L2', apt: '103', bld: 'Damac Reva', time: '15:00', timeSet: true, kind: 'Guest', tone: 'warn', word: 'At risk',
          cause: 'Not started yet, Faiza. Guest in 4 h, checkout time not set.', prevKey: '2026-10-09_Cy Doe',
          prevCheckout: { date: DAY, time: null }, cleaners: ['Faiza'], assigned: [4], serviceType: 'CHC', done: false },
        { id: '8', listingId: 'L4', apt: '404', bld: 'Elysee 1', time: '15:00', timeSet: true, kind: 'Guest', tone: 'ok', word: 'Ready',
          cause: 'Cleaned by Elite Cleaning after the 05/10 checkout.', prevKey: '2026-10-05_Fa Ho',
          prevCheckout: { date: '2026-10-05', time: '11:00' }, cleaners: ['Elite Cleaning'], assigned: [12], serviceType: 'CHC', done: true },
        { id: '6', listingId: 'L3', apt: '805', bld: 'Azizi Riviera 39', time: '16:00', timeSet: true, kind: 'Owner stay', tone: 'warn', word: 'At risk',
          cause: 'Usually Elite · not logged yet. Elite logs its jobs the next day around 14:00.', prevKey: '2026-10-08_Ed Gu',
          prevCheckout: { date: '2026-10-08', time: '12:00' }, cleaners: [], assigned: [], serviceType: null, done: false },
      ],
    },
    assignable: [
      { id: 4, name: 'Faiza', role: 'cleaner' }, { id: 10, name: 'Pionah', role: 'cleaner' }, { id: 12, name: 'Elite Cleaning', role: 'subcontractor' },
    ],
    ticketsByListing: { L1: [{ id: 429, title: 'Gas not working', priority: 'urgent', since: '09/07', tech: null }] },
  };
  return { ...JSON.parse(JSON.stringify(base)), ...over };
}
```

`tests/manager/today.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { NOW, todayBody } from './fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('4 blocs, statuts, alerte, aucun defilement horizontal (' + scheme + ')', async ({ page }, info) => {
      await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
      const h = (name: string) => page.getByRole('heading', { name, exact: true });
      await expect(h('Who does what today')).toBeVisible();
      await expect(h('Open problems')).toBeVisible();
      await expect(h('Team control')).toBeVisible();
      await expect(h('Ready for today’s arrivals')).toBeVisible();
      await expect(page.getByText('Data as of 11:00')).toBeVisible();
      await expect(page.locator('.alert')).toContainText('1 arrival blocked');
      await expect(page.locator('.strip')).toContainText('without a cleaner');
      await expect(page.getByText('No cleaner assigned, and urgent ticket open: Gas not working (#429).')).toBeVisible();
      await expect(page.getByText('Not started yet, Faiza. Guest in 4 h, checkout time not set.')).toBeVisible();
      await expect(page.locator('.arr', { hasText: 'Owner stay' })).toContainText('Usually Elite · not logged yet');
      await expect(page.locator('.person.unassigned')).toContainText('Usually Elite · not logged yet');
      const faiza = page.locator('.person', { hasText: 'Faiza' }).first();
      await expect(faiza).toContainText('--:--');
      await expect(faiza).toContainText('checkout time not set');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(10, 11, 14)' : 'rgb(243, 244, 247)');
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
      const y = async (name: string) => (await h(name).boundingBox())!.y;
      if (info.project.name === 'mgr-mobile') {
        expect(await y('Who does what today')).toBeLessThan(await y('Open problems'));
        expect(await y('Open problems')).toBeLessThan(await y('Team control'));
        expect(await y('Team control')).toBeLessThan(await y('Ready for today’s arrivals'));
      } else {
        expect(Math.abs((await y('Who does what today')) - (await y('Open problems')))).toBeLessThan(2);
      }
    });
  });
}

test('mgr.today part avec le Bearer de la session email', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
  const log = await fetchLog(page);
  expect(log.find((l) => l.url.includes('action=mgr.today'))!.headers['Authorization']).toBe('Bearer jwt-test');
});

test('fiche arrivee au clavier : fleches, Entree, Echap rend le focus', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  const rows = page.locator('.arr');
  await expect(rows).toHaveCount(4);
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  const sheet = page.locator('#sheet');
  await expect(sheet).toHaveAttribute('aria-hidden', 'false');
  await expect(sheet.getByRole('heading', { name: 'Apt 103 · Damac Reva' })).toBeVisible();
  await expect(sheet).toContainText('Today, checkout time not set');
  if (info.project.name === 'mgr-desktop') {
    const box = await sheet.boundingBox();
    expect(Math.round(box!.width)).toBe(460);
  }
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(rows.nth(1)).toBeFocused();
});

test('probleme : fiche en lecture seule avec lien vers l app actuelle', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await page.locator('.prob', { hasText: 'Gas not working' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Gas not working' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Open in the current app' })).toHaveAttribute('href', '/?legacy=1');
  await sheet.getByRole('button', { name: 'Close' }).last().click();
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
});

test('erreur du proxy sans donnees : message et Retry, jamais d ecran blanc', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 500, body: { error: 'Internal error' }, once: true }, TODAY()], { email: true, clock: NOW });
  await expect(page.locator('.err-card')).toContainText('Internal error');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'Who does what today' })).toBeVisible();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager/today.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (Today shows the "Today could not be loaded" placeholder, no "Who does what today" heading).

- [ ] **Step 3: Write the Today CSS**

Replace the whole content of `manager/ui/today.css` with:

```css
/* Ecran Today (prototype valide le 09/10/2026). */
.alert{display:flex;gap:var(--s3);align-items:flex-start;background:var(--bad-tint);color:var(--bad-ink);border-radius:var(--r-md);padding:var(--s3) var(--s4);margin-bottom:var(--s5)}
.alert b{color:var(--bad-ink)}
.alert .clock{font-weight:700;font-size:22px;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--bad)}
.alert p{margin:0}

.strip{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--s2);margin-bottom:var(--s5)}
.strip .s{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);padding:var(--s3);min-width:0}
.strip .s b{display:block;font-size:28px;line-height:1.1;font-weight:700;font-variant-numeric:tabular-nums}
.strip .s span{color:var(--ink-2);font-size:14px;line-height:1.3;display:block}
.strip .s.bad b{color:var(--bad)}
@media (max-width:520px){ .strip{grid-template-columns:repeat(2,minmax(0,1fr))} }

.board{display:grid;gap:var(--s5);grid-template-columns:minmax(0,1fr)}
.col{display:contents}
.o1{order:1}.o2{order:2}.o3{order:3}.o4{order:4}
@media (min-width:1100px){
  .board{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
  .col{display:flex;flex-direction:column;gap:var(--s5);min-width:0}
}

.person{border-top:1px solid var(--line);padding:var(--s3) var(--s4) var(--s4)}
.person-h{display:flex;align-items:center;gap:var(--s3);margin-bottom:var(--s2)}
.av{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:15px;background:var(--sunk);color:var(--ink-2);flex:none}
.person-h .nm{font-weight:600;font-size:17px}
.person-h .rl{color:var(--ink-3);font-size:14px}
.person-h .cnt{margin-left:auto;font-weight:700;font-size:22px;font-variant-numeric:tabular-nums}
.jobs{display:flex;flex-direction:column;gap:6px}
.job{display:flex;align-items:center;gap:var(--s3);padding:10px var(--s3);border-radius:10px;background:var(--surface-2);border:1px solid var(--line);cursor:pointer;text-align:left;width:100%;min-width:0}
.job.static{cursor:default}
.job:hover{border-color:var(--line-2)}
.job .tm{font-weight:700;font-size:18px;line-height:1.1;font-variant-numeric:tabular-nums;width:56px;flex:none}
.job .tm small{display:block;font-weight:500;font-size:13px;color:var(--ink-3)}
.job .ap{flex:1;min-width:0}
.job .ap b{display:block;font-weight:600;overflow-wrap:anywhere}
.job .ap span{color:var(--ink-2);font-size:14px}
.linklike{background:none;border:0;padding:0;text-align:left;cursor:pointer;font:inherit;color:inherit}
.unassigned{background:var(--bad-tint)}
.unassigned .person-h .nm{color:var(--bad-ink)}
.unassigned .person-h .cnt{color:var(--bad)}
.unassigned .av{background:var(--bad);color:#fff}
.unassigned .job{background:var(--surface);border-color:color-mix(in srgb,var(--bad) 30%,var(--line))}

.counts{display:flex;flex-wrap:wrap;gap:var(--s2);padding:0 var(--s4) var(--s3)}
.count{display:flex;flex-direction:column;padding:var(--s2) var(--s3);border-radius:var(--r-md);background:var(--surface-2);border:1px solid var(--line);min-width:0;flex:1 1 130px}
.count b{font-size:26px;line-height:1.15;font-weight:700;font-variant-numeric:tabular-nums}
.count span{color:var(--ink-2);font-size:14px}
.prob{display:flex;gap:var(--s3);padding:var(--s3) var(--s4);border:0;border-top:1px solid var(--line);background:none;width:100%;text-align:left;cursor:pointer;font:inherit;color:inherit;min-width:0}
.prob:hover,.prob:focus-visible{background:var(--surface-2)}
.prob .body{flex:1;min-width:0;display:block}
.prob .src{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap;font-size:14px;color:var(--ink-3)}
.prob .ttl{display:block;font-weight:600;font-size:17px;line-height:1.3;margin-top:2px;overflow-wrap:anywhere}
.prob .where{display:block;font-weight:500;font-size:15px;color:var(--ink)}
.prob .why{display:block;color:var(--ink-2);font-size:15px;margin-top:2px}
.sec-foot{border-top:1px solid var(--line);padding:var(--s3) var(--s4);display:flex;justify-content:space-between;align-items:center;gap:var(--s3);flex-wrap:wrap}
.sec-foot .t3{color:var(--ink-3);font-size:14px}

.ctl{border-top:1px solid var(--line);padding:var(--s3) var(--s4)}
.ctl h3{margin:0 0 var(--s2);font-size:16px;font-weight:600}
.kv{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px var(--s3);align-items:baseline}
.kv .k{color:var(--ink-2);overflow-wrap:anywhere}
.kv .k.total{color:var(--ink);font-weight:600}
.kv .v{font-weight:700;font-variant-numeric:tabular-nums;text-align:right}
.kv .of{color:var(--ink-3);font-weight:500}
.num-bad{color:var(--bad)}
.mini{display:flex;flex-direction:column;gap:6px;margin-top:10px}
.mini .it{display:flex;gap:var(--s2);align-items:baseline;justify-content:space-between}
.mini .it > span{min-width:0;overflow-wrap:anywhere}
.mini .sub{color:var(--ink-3);font-size:14px}
.yday{display:flex;flex-direction:column;gap:var(--s2)}
.yday .p{display:grid;grid-template-columns:110px minmax(0,1fr);gap:var(--s3)}
.yday .p b{font-weight:600;overflow-wrap:anywhere}
.yday .p span{color:var(--ink-2);font-size:15px}
@media (max-width:420px){ .yday .p{grid-template-columns:minmax(0,1fr);gap:0} }

.arr{display:flex;gap:var(--s3);padding:var(--s3) var(--s4);border:0;border-top:1px solid var(--line);cursor:pointer;background:none;width:100%;text-align:left;min-width:0;font:inherit;color:inherit}
.arr:hover,.arr:focus-visible{background:var(--surface-2)}
.arr .when{width:96px;flex:none}
.arr .when b{display:block;font-size:28px;line-height:1;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.arr .when span{display:block;font-size:13px;color:var(--ink-3);margin-top:4px}
.arr .body{flex:1;min-width:0}
.arr .apt{display:block;font-weight:600;font-size:17px;line-height:1.3;overflow-wrap:anywhere}
.arr .bld{display:block;color:var(--ink-2);font-size:15px}
.arr .stline{display:block;margin-top:6px;font-size:15px;line-height:1.4}
.arr .cause{color:var(--ink-2)}
.legend{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);padding:0 var(--s4) var(--s3);color:var(--ink-2);font-size:14px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.legend i.ok{background:var(--ok)} .legend i.warn{background:var(--warn)} .legend i.bad{background:var(--bad)} .legend i.idle{background:var(--line-2)}
.rules{border-top:1px solid var(--line);padding:var(--s3) var(--s4) var(--s4);color:var(--ink-2);font-size:15px}
.rules summary{cursor:pointer;font-weight:600;color:var(--ink);list-style:none;display:flex;justify-content:space-between;align-items:center;min-height:32px}
.rules summary::-webkit-details-marker{display:none}
.rules summary::after{content:"+";font-weight:400;color:var(--ink-3);font-size:20px}
.rules[open] summary::after{content:"\2212"}
.rules ul{margin:var(--s2) 0 0;padding-left:20px}
.rules li{margin:4px 0}

.statusbox{border-radius:var(--r-md);padding:var(--s3) var(--s4);display:flex;gap:var(--s3)}
.statusbox.ok{background:var(--ok-tint)} .statusbox.warn{background:var(--warn-tint)} .statusbox.bad{background:var(--bad-tint)} .statusbox.idle{background:var(--sunk)}
.statusbox .st{font-size:18px}
.statusbox p{margin:2px 0 0;color:var(--ink)}
.tl{list-style:none;margin:0;padding:0;position:relative}
.tl li{display:grid;grid-template-columns:64px 16px minmax(0,1fr);gap:var(--s2);align-items:start;padding-bottom:var(--s3);position:relative}
.tl li .tt{font-weight:700;font-variant-numeric:tabular-nums;font-size:17px;text-align:right}
.tl li .dot{width:12px;height:12px;border-radius:50%;margin-top:6px;background:var(--line-2);position:relative;z-index:1;border:2px solid var(--surface)}
.tl li .dot.ok{background:var(--ok)} .tl li .dot.warn{background:var(--warn)} .tl li .dot.bad{background:var(--bad)} .tl li .dot.now{background:var(--accent)}
.tl::before{content:"";position:absolute;left:calc(64px + 8px + 7px);top:10px;bottom:16px;width:2px;background:var(--line)}
.tl li .tx span{display:block;color:var(--ink-2);font-size:15px}
.blk h3{margin:0 0 var(--s2);font-size:15px;font-weight:600;color:var(--ink-2)}
.blk ul{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.blk li{padding:10px var(--s3);border-radius:10px;background:var(--surface-2);border:1px solid var(--line)}
.blk li small{display:block;color:var(--ink-3);font-size:14px}
.pick{display:flex;flex-direction:column;gap:6px}
.pick button{display:flex;align-items:center;gap:var(--s3);padding:12px var(--s3);border-radius:12px;border:1px solid var(--line);background:var(--surface-2);cursor:pointer;text-align:left;width:100%}
.pick button:hover{border-color:var(--accent)}
.pick button[aria-current="true"]{border-color:var(--accent);background:var(--accent-tint)}
.pick button .av{width:32px;height:32px;font-size:14px}
.pick button small{display:block;color:var(--ink-3);font-size:14px}
```

- [ ] **Step 4: Write the pure view**

`manager/screens/today-view.js`:

```js
// Ecran Today : HTML pur construit a partir de la reponse mgr.today. Aucun appel
// reseau ici, aucun calcul de statut : le proxy les rend deja faits.
import { aptLabel, dubaiTime, esc, I, placeLabel } from '/manager/ui/dom.js';

const ROLE = { cleaner: 'Cleaner', subcontractor: 'Subcontractor', manager: 'Manager', maintenance: 'Maintenance' };

export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), r = m % 60;
  return h ? h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : '') : r + ' min';
}
export function arrivalMs(day, time) { return Date.parse(day + 'T' + time + ':00+04:00'); }
function ddmm(day) { return day ? day.slice(8, 10) + '/' + day.slice(5, 7) : ''; }
function longDate(day) {
  return new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
function initials(n) {
  return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
function nameOf(data, id) {
  const p = data.assignable.find((x) => x.id === id) || data.who.people.find((x) => x.id === id);
  return p ? p.name : 'Member ' + id;
}
function namesOf(data, ids) {
  const n = ids.map((id) => nameOf(data, id));
  return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
function jobsByKey(data) {
  const m = {};
  for (const j of data.who.jobs) m[j.key] = j;
  return m;
}

// --- remplaces a la tache 10 (actions reelles) ---
function actionsFoot(key, assigned, done) {
  return '<div class="sheet-f"><button class="btn" type="button" data-close>Close</button></div>';
}
function assignBtn(j) { return ''; }
// --- fin ---

function header(data, banner, stale) {
  return '<header class="top"><div><h1>Today</h1><div class="date">' + esc(longDate(data.day)) + '</div>'
    + '<div class="asof' + (stale ? ' stale' : '') + '">Data as of ' + esc(dubaiTime(data.generatedAt)) + '</div></div>'
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></header>'
    + (banner || '');
}

function alertHtml(data, nowMs) {
  const blocked = data.arrivals.rows.filter((a) => a.tone === 'bad');
  if (!blocked.length) return '';
  const first = blocked[0].time;
  const left = arrivalMs(data.day, first) - nowMs;
  return '<div class="alert" role="alert"><div class="clock">' + esc(first) + '</div><p><b>' + blocked.length + ' arrival'
    + (blocked.length > 1 ? 's' : '') + ' blocked</b>, first guest due at ' + esc(first) + (left > 0 ? ', in ' + fmtDur(left) : '') + '. '
    + esc(blocked.map((a) => placeLabel(a)).join(', ')) + '.</p></div>';
}

function tile(n, label, bad) {
  return '<div class="s' + (bad ? ' bad' : '') + '"><b>' + n + '</b><span>' + esc(label) + '</span></div>';
}
function stripHtml(data) {
  const s = data.strip;
  return '<div class="strip" aria-label="Today in numbers">' + tile(s.cleanings, 'cleanings today', false)
    + tile(s.unassigned, 'without a cleaner', s.unassigned > 0) + tile(s.arrivals, 'arrivals today', false)
    + tile(s.notReady, 'arrivals not ready yet', s.notReady > 0) + '</div>';
}

function coTime(j) { return j.kind === 'extra' ? 'Extra' : (j.checkout || '--:--'); }
function coSmall(j) { return j.kind === 'extra' ? 'clean' : 'out'; }
function nextLine(j) {
  if (!j.next) return 'No guest in the next 14 days';
  const who = j.next.owner ? 'Owner' : 'Guest';
  if (j.next.sameDay) return who + ' arrives ' + (j.next.time || 'today');
  return 'Next ' + who.toLowerCase() + ' ' + ddmm(j.next.date);
}
function jobNotes(j) {
  if (j.postponedFrom) return ' · postponed from ' + ddmm(j.postponedFrom);
  if (j.kind === 'checkout' && !j.checkout) return ' · checkout time not set';
  return '';
}
function jobBtn(j) {
  return '<button class="job" type="button" data-open="job" data-key="' + esc(j.key) + '"><span class="tm">' + esc(coTime(j)) + '<small>' + coSmall(j) + '</small></span>'
    + '<span class="ap"><b>' + esc(placeLabel(j)) + '</b><span><span class="st ' + (j.tone === 'idle' ? '' : j.tone) + '">' + esc(j.word) + '</span> · '
    + esc(nextLine(j) + jobNotes(j)) + '</span></span></button>';
}

function whoHtml(data) {
  const byKey = jobsByKey(data);
  const w = data.who;
  let h = '<section class="card o1" aria-labelledby="h-who"><div class="sec-head"><h2 id="h-who">Who does what today</h2><span class="meta tnum">'
    + w.jobs.length + ' cleaning' + (w.jobs.length === 1 ? '' : 's') + '</span></div>';
  const list = w.unassigned.map((k) => byKey[k]).filter(Boolean);
  if (list.length) {
    h += '<div class="person unassigned"><div class="person-h"><span class="av" aria-hidden="true">!</span><div><div class="nm">Not assigned</div>'
      + '<div class="rl">Same-day arrivals first</div></div><span class="cnt">' + list.length + '</span></div><div class="jobs">';
    for (const j of list) {
      const lead = j.tone === 'warn' ? '<span class="st warn">' + esc(j.word) + '</span> · '
        : j.state === 'done' ? '<span class="st ok">Done</span> · ' : '';
      h += '<div class="job static"><span class="tm">' + esc(coTime(j)) + '<small>' + coSmall(j) + '</small></span>'
        + '<button class="ap linklike" type="button" data-open="job" data-key="' + esc(j.key) + '"><b>' + esc(placeLabel(j)) + '</b><span>'
        + lead + esc(nextLine(j) + jobNotes(j)) + '</span></button>' + assignBtn(j) + '</div>';
    }
    h += '</div>';
    if (list.some((j) => j.tone === 'warn')) {
      h += '<div class="note">Elite Cleaning logs its jobs the next day around 14:00. Lines marked "Usually Elite" may already be covered: confirm with Elite before reassigning.</div>';
    }
    h += '</div>';
  }
  for (const p of w.people) {
    const jobs = p.keys.map((k) => byKey[k]).filter(Boolean);
    h += '<div class="person"><div class="person-h"><span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span><div><div class="nm">' + esc(p.name)
      + '</div><div class="rl">' + esc(ROLE[p.role] || p.role) + '</div></div><span class="cnt">' + jobs.length + '</span></div><div class="jobs">'
      + (jobs.length ? jobs.map(jobBtn).join('') : '<div class="empty">Nothing recorded for today in HK Planner.</div>') + '</div></div>';
  }
  for (const t of w.technicians) {
    h += '<div class="person"><div class="person-h"><span class="av" aria-hidden="true">' + esc(initials(t.name)) + '</span><div><div class="nm">' + esc(t.name)
      + '</div><div class="rl">Maintenance tickets</div></div><span class="cnt">' + t.open + '</span></div>'
      + (t.oldest ? '<div class="empty">Oldest: <span class="mono">MNT-' + t.oldest.id + '</span> ' + esc(t.oldest.title) + ', since ' + esc(t.oldest.since) + '.</div>' : '')
      + '</div>';
  }
  return h + '</section>';
}

function problemsHtml(data) {
  const c = data.problems.counts;
  let h = '<section class="card o2" aria-labelledby="h-prob"><div class="sec-head"><h2 id="h-prob">Open problems</h2><span class="meta">Top 5 by urgency</span></div>'
    + '<div class="counts"><div class="count"><b class="tnum">' + c.ticketsOpen + '</b><span>maintenance tickets, ' + c.ticketsUrgent + ' urgent</span></div>'
    + '<div class="count"><b class="tnum">' + c.ticketsNoTech + '</b><span>tickets with no technician</span></div>'
    + '<div class="count"><b class="tnum">' + c.teamTasksOverdue + '</b><span>team tasks overdue, of ' + c.teamTasksOpen + ' open</span></div></div>';
  if (!data.problems.top.length) h += '<div class="empty pad">Nothing open.</div>';
  h += data.problems.top.map((p) => '<button class="prob" type="button" data-open="prob" data-ref="' + esc(p.ref) + '" data-nav-row>'
    + '<span class="bar ' + p.tone + '"></span><span class="body"><span class="src"><span class="pill ' + p.tone + '">' + esc(p.label) + '</span><span>'
    + esc(p.source) + ' <span class="mono">' + esc(p.ref) + '</span></span></span><span class="ttl">' + esc(p.title) + '</span>'
    + (p.apt || p.bld ? '<span class="where">' + esc(placeLabel(p)) + '</span>' : '') + '<span class="why">' + esc(p.why) + '</span></span></button>').join('');
  h += '<div class="sec-foot"><span class="t3">' + c.inspectionFindingsOpen + ' inspection findings not turned into tickets. Cleaner reports open: '
    + c.cleanerReportsOpen + '.</span><a class="link" href="#/problems">All problems</a></div>';
  return h + '</section>';
}

function controlHtml(data) {
  const c = data.control, ins = c.inspections;
  let h = '<section class="card o3" aria-labelledby="h-ctl"><div class="sec-head"><h2 id="h-ctl">Team control</h2><span class="meta">Yesterday and today</span></div>';
  h += '<div class="ctl"><h3>Inspections today</h3><div class="kv"><span class="k">Proposed</span><span class="v">' + ins.proposed
    + '</span><span class="k">Claimed</span><span class="v">' + ins.claimed + '</span><span class="k">Done</span><span class="v">' + ins.done + '</span></div>';
  if (ins.unfinished.length) {
    h += '<div class="mini"><div class="it"><span>Started, never finished<br><span class="sub">'
      + esc(ins.unfinished.map((u) => placeLabel(u) + ' (' + u.inspector + ', ' + u.date + ')').join(', '))
      + '</span></span><b class="tnum">' + ins.unfinished.length + '</b></div></div>';
  }
  h += '</div>';
  h += '<div class="ctl"><h3>Missing linen counts, ' + esc(c.linen.window) + '</h3>' + (c.linen.rows.length
    ? '<div class="kv">' + c.linen.rows.map((r) => '<span class="k">' + esc(r.name) + '</span><span class="v"><span class="'
      + (r.total && r.missing / r.total > 0.5 ? 'num-bad' : '') + '">' + r.missing + '</span><span class="of"> of ' + r.total + ' cleanings</span></span>').join('') + '</div>'
    : '<div class="empty">No cleaning marked done in this window.</div>') + '</div>';
  h += '<div class="ctl"><h3>Overdue team tasks</h3>' + (c.overdue.total
    ? '<div class="kv">' + c.overdue.rows.map((r) => '<span class="k">' + esc(r.name) + '</span><span class="v">' + r.n + '</span>').join('')
      + '<span class="k total">Total</span><span class="v">' + c.overdue.total + '</span></div>'
    : '<div class="empty">Nothing overdue.</div>') + '</div>';
  h += '<div class="ctl"><h3>What each person did yesterday, ' + esc(c.yesterday.date) + '</h3><div class="yday">'
    + c.yesterday.rows.map((y) => '<div class="p"><b>' + esc(y.name) + '</b><span>' + esc(y.text) + '</span></div>').join('') + '</div></div>';
  return h + '</section>';
}

function arrivalsHtml(data) {
  const a = data.arrivals, n = a.counts;
  let h = '<section class="card o4" aria-labelledby="h-arr"><div class="sec-head"><h2 id="h-arr">Ready for today’s arrivals</h2><span class="meta tnum">'
    + a.rows.length + ' arrival' + (a.rows.length === 1 ? '' : 's') + '</span></div>'
    + '<div class="legend"><span><i class="ok"></i>' + n.ok + ' ready</span><span><i class="warn"></i>' + n.warn + ' at risk</span><span><i class="bad"></i>'
    + n.bad + ' blocked</span>' + (n.idle ? '<span><i class="idle"></i>' + n.idle + ' scheduled</span>' : '') + '</div>';
  if (!a.rows.length) h += '<div class="empty pad">No arrival today.</div>';
  h += a.rows.map((r) => '<button class="arr" type="button" data-open="arr" data-id="' + esc(r.id) + '" data-nav-row><span class="bar ' + r.tone + '"></span>'
    + '<span class="when"><b>' + esc(r.time) + '</b><span>' + esc(r.kind + (r.timeSet ? '' : ', time not set')) + '</span></span>'
    + '<span class="body"><span class="apt">' + esc(aptLabel(r) || r.bld) + '</span><span class="bld">' + esc(r.apt ? r.bld : '') + '</span>'
    + '<span class="stline"><span class="st ' + r.tone + '">' + esc(r.word) + '</span> <span class="cause">' + esc(r.cause) + '</span></span></span></button>').join('');
  h += '<details class="rules"><summary>How status is computed</summary><ul>'
    + '<li><b>Ready</b>: a cleaning was marked done in HK Planner after the previous checkout, and no urgent ticket is open on the apartment.</li>'
    + '<li><b>At risk</b>: a cleaner is assigned but the cleaning is not marked done, and the guest arrives within ' + data.riskHours + ' hours. Also an apartment usually cleaned by Elite whose job is not logged yet (Elite logs the next day around 14:00).</li>'
    + '<li><b>Blocked</b>: no cleaner is assigned, or an urgent maintenance ticket is open on the apartment.</li>'
    + '<li><b>Scheduled</b>: a cleaner is assigned and the guest arrives in more than ' + data.riskHours + ' hours.</li>'
    + '<li>Owner stays count as arrivals. Without a checkout in the last 14 days, there is no cleaning to check.</li></ul></details>';
  return h + '</section>';
}

export function boardHtml(data, nowMs, banner, stale) {
  return header(data, banner, stale) + alertHtml(data, nowMs) + stripHtml(data)
    + '<div class="board"><div class="col">' + whoHtml(data) + controlHtml(data) + '</div><div class="col">'
    + problemsHtml(data) + arrivalsHtml(data) + '</div></div>';
}

function sheetHead(title, sub) {
  return '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
function statusBox(tone, word, text) {
  return '<div class="statusbox ' + tone + '"><span class="bar ' + tone + '"></span><div><span class="st ' + tone + '">' + esc(word) + '</span><p>' + esc(text) + '</p></div></div>';
}
function tlItem(t, tone, title, sub) {
  return '<li><span class="tt">' + esc(t) + '</span><span class="dot ' + (tone || '') + '"></span><span class="tx"><b>' + esc(title) + '</b><span>' + esc(sub) + '</span></span></li>';
}
function ticketsBlk(list) {
  const tk = list || [];
  if (!tk.length) return '<div class="blk"><h3>Open tickets</h3><div class="empty">None on this apartment.</div></div>';
  return '<div class="blk"><h3>Open tickets</h3><ul>' + tk.map((t) => '<li><b>' + esc(t.title) + '</b><small><span class="mono">MNT-' + t.id + '</span> · '
    + esc(t.priority) + ' · since ' + esc(t.since) + ' · ' + (t.tech ? 'assigned to ' + esc(t.tech) : 'no technician') + '</small></li>').join('') + '</ul></div>';
}

export function jobSheet(data, job, nowMs) {
  const arr = data.arrivals.rows.find((a) => a.prevKey === job.key) || null;
  const names = namesOf(data, job.assigned);
  const box = arr ? statusBox(arr.tone, arr.word, arr.cause)
    : statusBox(job.tone, job.word, (job.assigned.length ? 'Assigned to ' + names + '.' : 'No cleaner in HK Planner for this cleaning.') + ' ' + nextLine(job) + '.');
  const nextT = job.next && job.next.sameDay ? (job.next.time || '15:00') : '';
  const tl = '<ul class="tl">'
    + (job.kind === 'extra' ? '' : tlItem(job.checkout || '--:--', 'ok', job.postponedFrom ? 'Checkout ' + ddmm(job.postponedFrom) : 'Checkout',
      job.postponedFrom ? 'Cleaning postponed to today' : job.checkout ? 'Guest leaves' : 'Checkout time not set in Hostaway'))
    + tlItem(dubaiTime(new Date(nowMs).toISOString()), 'now', 'Now',
      job.state === 'done' ? 'Cleaning done' : job.assigned.length ? names + (job.state === 'in_progress' ? ', in progress' : ', not started') : 'Nobody assigned')
    + (nextT ? tlItem(nextT, arr ? arr.tone : job.tone, (job.next.owner ? 'Owner' : 'Guest') + ' arrives', fmtDur(arrivalMs(data.day, nextT) - nowMs) + ' from now')
      : tlItem('', '', 'Next guest', job.next ? ddmm(job.next.date) : 'None in the next 14 days'))
    + '</ul>';
  return sheetHead(placeLabel(job), job.kind === 'extra' ? 'Extra cleaning, today' : 'Checkout cleaning, today')
    + '<div class="sheet-b">' + box + tl
    + '<div class="blk"><h3>Cleaner</h3><div>' + (job.assigned.length ? esc(names) : '<span class="st bad">Nobody</span>') + '</div></div>'
    + ticketsBlk(data.ticketsByListing[job.listingId]) + '</div>'
    + actionsFoot(job.key, job.assigned, job.state === 'done');
}

export function arrivalSheet(data, a, nowMs) {
  const left = arrivalMs(data.day, a.time) - nowMs;
  const pc = a.prevCheckout;
  const prevItem = pc ? tlItem(pc.date === data.day ? (pc.time || '--:--') : ddmm(pc.date), 'ok', 'Previous checkout',
    pc.date === data.day ? (pc.time ? 'Today' : 'Today, checkout time not set') : 'Apartment empty since') : '';
  const tl = '<ul class="tl">' + prevItem
    + tlItem(dubaiTime(new Date(nowMs).toISOString()), 'now', 'Now',
      a.done ? 'Cleaning done' : a.cleaners.length ? a.cleaners.join(' and ') + ', not done yet' : 'Nobody assigned')
    + tlItem(a.time, a.tone, a.kind + ' arrives', left > 0 ? fmtDur(left) + ' from now' : 'Due now') + '</ul>';
  return sheetHead(placeLabel(a), a.kind + ' arriving today at ' + a.time + (a.timeSet ? '' : ' (time not set)'))
    + '<div class="sheet-b">' + statusBox(a.tone, a.word, a.cause) + tl
    + '<div class="blk"><h3>Cleaner</h3><div>' + (a.cleaners.length ? esc(a.cleaners.join(' and ')) : '<span class="st bad">Nobody</span>') + '</div></div>'
    + ticketsBlk(data.ticketsByListing[a.listingId]) + '</div>'
    + (a.prevKey ? actionsFoot(a.prevKey, a.assigned, a.done) : '<div class="sheet-f"><button class="btn" type="button" data-close>Close</button></div>');
}

export function problemSheet(p) {
  return sheetHead(p.title, p.source + ' ' + p.ref + (p.apt || p.bld ? ' · ' + placeLabel(p) : ''))
    + '<div class="sheet-b">' + statusBox(p.tone, p.label, p.why)
    + '<div class="blk"><h3>Next step</h3><div class="empty">Assign, Schedule and Close come with the Problems screen. Until then, handle it in the current app.</div></div></div>'
    + '<div class="sheet-f"><a class="btn primary" href="/?legacy=1">Open in the current app</a><button class="btn" type="button" data-close>Close</button></div>';
}
```

- [ ] **Step 5: Write the controller**

`manager/screens/today.js`:

```js
// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier.
import { get } from '/manager/api.js';
import { esc, openSheet, sheetIsOpen } from '/manager/ui/dom.js';
import { arrivalSheet, boardHtml, jobSheet, problemSheet } from '/manager/screens/today-view.js';

function shellHtml(inner) { return '<header class="top"><div><h1>Today</h1></div></header>' + inner; }

export async function renderToday(ctx) {
  const main = ctx.main;
  const st = { data: null, loading: true, error: null };

  function paint() {
    if (!ctx.isCurrent()) return;
    if (st.data) {
      const banner = st.error
        ? '<div class="banner warn" role="status"><span>Could not refresh. ' + esc(st.error.message) + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>'
        : '';
      main.innerHTML = boardHtml(st.data, Date.now(), banner, !!st.error);
      return;
    }
    if (st.loading) { main.innerHTML = shellHtml('<p class="boot" role="status">Loading today…</p>'); return; }
    main.innerHTML = shellHtml('<div class="err-card" role="alert"><p>' + esc(st.error ? st.error.message : 'Could not load.')
      + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>');
  }

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran.
  function handleAccess(e) {
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  async function refresh() {
    st.loading = true;
    st.error = null;
    paint();
    try {
      st.data = await get('mgr.today');
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
    }
    st.loading = false;
    paint();
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-retry],[data-open]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (!st.data) return;
    const op = el.getAttribute('data-open');
    const now = Date.now();
    if (op === 'job') {
      const j = st.data.who.jobs.find((x) => x.key === el.getAttribute('data-key'));
      if (j) openSheet(jobSheet(st.data, j, now));
    } else if (op === 'arr') {
      const a = st.data.arrivals.rows.find((x) => x.id === el.getAttribute('data-id'));
      if (a) openSheet(arrivalSheet(st.data, a, now));
    } else if (op === 'prob') {
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) openSheet(problemSheet(p));
    }
  }

  // Fleches haut / bas entre les lignes d'un meme bloc (problemes, arrivees).
  function onKey(e) {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || sheetIsOpen()) return;
    const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-nav-row]') : null;
    if (!row) return;
    const all = Array.from(row.closest('section').querySelectorAll('[data-nav-row]'));
    const next = all[all.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  });
  await refresh();
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: all tests in `access`, `shell`, `today` pass on both projects.

- [ ] **Step 7: Visual check against the prototype**

Open `http://localhost:8890/manager/` is not possible without a session; instead run the Today test headed once and compare with `/Users/hillal/Documents/hk-redesign/today-prototype.html` opened side by side at 390 and 1440 px:
`npx playwright test tests/manager/today.spec.ts --project=mgr-desktop --headed --grep "light"`
Expected: same fonts, colours, card layout, alert band, strip and arrival rows as the prototype; the only intended differences are read-only problem rows (no A / S / C buttons) and the neutral "Scheduled" state.

- [ ] **Step 8: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add manager/ui/today.css manager/screens/today-view.js manager/screens/today.js tests/manager/fixtures.ts tests/manager/today.spec.ts
git commit -m "manager: ecran Today (4 blocs, alerte, compteurs, fiches, clavier) branche sur mgr.today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---
### Task 9: Offline and slow proxy: local cache, "Data from HH:MM", 15 s timeout, Retry

**Files:**
- Create: `manager/today-cache.js`
- Modify: `manager/screens/today.js` (full replacement below)
- Create: `tests/manager/today-offline.spec.ts`

**Interfaces:**
- Consumes: `get`, `TIMEOUT_MS`, `ApiError` kinds (`manager/api.js`, Task 7); `boardHtml` (Task 8); `dubaiTime`, `esc` (`ui/dom.js`); `MgrToday.bookingsCachedAt` (Task 6).
- Produces: `manager/today-cache.js` with `saveToday(data, savedAt: number): void` and `loadToday(): { savedAt: number; data: MgrToday } | null` (localStorage key `mgrTodayCache`). `renderToday(ctx)` keeps its signature.

Rules (spec section 7): the last successful `mgr.today` is kept with its time; when a refresh fails (offline, timeout, proxy error) the cached Today stays on screen with a banner "Data from HH:MM. <server or network message>" and Retry; the cache of another manager (different `me.id`) is never shown to a signed-in manager; offline at boot (identity unknown) the cache of this device is shown. When the proxy itself served Hostaway data from its backup copy (`bookingsCachedAt`), a banner says "Bookings data from HH:MM".

- [ ] **Step 1: Write the failing tests**

`tests/manager/today-offline.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { DAY, NOW, todayBody } from './fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const WHO = 'Who does what today';
const CACHE = { savedAt: Date.parse('2026-10-09T05:42:00Z'), data: todayBody({ generatedAt: '2026-10-09T05:42:00.000Z' }) };

test('delai client par defaut : 15 s', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  const t = await page.evaluate(async () => (await import('/manager/api.js')).TIMEOUT_MS);
  expect(t).toBe(15000);
});

test('proxy trop lent : message clair, Retry recharge', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), delay: 3000, once: true }, TODAY()], { email: true, clock: NOW, timeoutMs: 300 });
  await expect(page.locator('.err-card')).toContainText('HK Planner is taking too long to answer. Try again.');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
});

test('reseau coupe avec cache : dernier Today et bandeau Data from', async ({ page }) => {
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache: CACHE });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  await expect(page.locator('.banner.warn')).toContainText('Data from 09:42. No connection. Try again.');
  await expect(page.locator('.banner.warn').getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.locator('.asof')).toHaveClass(/stale/);
});

test('reseau coupe sans cache : jamais d ecran blanc', async ({ page }) => {
  await bootMgr(page, [{ match: 'hostaway-proxy', status: 0, body: null, fail: true }], { email: true, clock: NOW });
  await expect(page.locator('.err-card')).toContainText('No connection. Try again.');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('cache d un autre manager : jamais montre', async ({ page }) => {
  const other = { savedAt: CACHE.savedAt, data: todayBody({ me: { id: 6, name: 'Hillal' } }) };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 0, body: null, fail: true }], { email: true, clock: NOW, cache: other });
  await expect(page.locator('.err-card')).toContainText('No connection. Try again.');
  await expect(page.getByText('Data from', { exact: false })).toHaveCount(0);
});

test('Hostaway en panne cote proxy : 503 lisible sans cache', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.today', status: 503, body: { error: 'Bookings are unavailable right now. Try again in a few minutes.' } }], { email: true, clock: NOW });
  await expect(page.locator('.err-card')).toContainText('Bookings are unavailable right now. Try again in a few minutes.');
});

test('reservations servies depuis la copie du proxy : bandeau Bookings data from', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(todayBody({ bookingsCachedAt: '2026-10-09T06:12:00Z' }))], { email: true, clock: NOW });
  await expect(page.getByText('Bookings data from 10:12', { exact: false })).toBeVisible();
});

test('reussite : Today garde sur l appareil', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY()], { email: true, clock: NOW });
  await expect(page.getByRole('heading', { name: WHO })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mgrTodayCache') || 'null'));
  expect(saved.data.day).toBe(DAY);
  expect(typeof saved.savedAt).toBe('number');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager/today-offline.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL on the cache, "Data from", "Bookings data from" and "saved" tests (the 15 s, slow-proxy, no-cache and 503 tests may already pass thanks to Tasks 7 and 8).

- [ ] **Step 3: Implement**

`manager/today-cache.js`:

```js
// Dernier Today recu, garde sur l'appareil avec son heure (spec section 7) :
// jamais d'ecran blanc quand le reseau ou le proxy tombe. Lecture seule.
const KEY = 'mgrTodayCache';

export function saveToday(data, savedAt) {
  try { localStorage.setItem(KEY, JSON.stringify({ savedAt, data })); } catch (e) { /* quota ou stockage bloque */ }
}

export function loadToday() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    return o && typeof o.savedAt === 'number' && o.data && o.data.who && o.data.arrivals ? o : null;
  } catch (e) { return null; }
}
```

Replace the whole content of `manager/screens/today.js` with:

```js
// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier,
// cache local du dernier Today (spec section 7).
import { get } from '/manager/api.js';
import { loadToday, saveToday } from '/manager/today-cache.js';
import { dubaiTime, esc, openSheet, sheetIsOpen } from '/manager/ui/dom.js';
import { arrivalSheet, boardHtml, jobSheet, problemSheet } from '/manager/screens/today-view.js';

function shellHtml(inner) { return '<header class="top"><div><h1>Today</h1></div></header>' + inner; }

export async function renderToday(ctx) {
  const main = ctx.main;
  const st = { data: null, savedAt: 0, fresh: false, loading: true, error: null };
  const cached = loadToday();
  // Hors ligne au demarrage (ctx.me inconnu) : le cache de l'appareil. Sinon,
  // seulement celui du manager connecte.
  if (cached && (!ctx.me || (cached.data.me && cached.data.me.id === ctx.me.id))) {
    st.data = cached.data;
    st.savedAt = cached.savedAt;
  }

  function banner() {
    let h = '';
    if (st.data && !st.fresh) {
      const when = dubaiTime(new Date(st.savedAt).toISOString());
      if (st.error) {
        h += '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message)
          + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
      } else if (st.loading) {
        h += '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.</span></div>';
      }
    }
    if (st.data && st.data.bookingsCachedAt) {
      h += '<div class="banner warn" role="status"><span>Bookings data from ' + esc(dubaiTime(st.data.bookingsCachedAt))
        + '. Hostaway is not answering, statuses may be late.</span></div>';
    }
    return h;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    if (st.data) { main.innerHTML = boardHtml(st.data, Date.now(), banner(), !st.fresh); return; }
    if (st.loading) { main.innerHTML = shellHtml('<p class="boot" role="status">Loading today…</p>'); return; }
    main.innerHTML = shellHtml('<div class="err-card" role="alert"><p>' + esc(st.error ? st.error.message : 'Could not load.')
      + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>');
  }

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran.
  function handleAccess(e) {
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  async function refresh() {
    st.loading = true;
    st.error = null;
    paint();
    try {
      const d = await get('mgr.today');
      st.data = d;
      st.savedAt = Date.now();
      st.fresh = true;
      saveToday(d, st.savedAt);
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    paint();
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-retry],[data-open]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (!st.data) return;
    const op = el.getAttribute('data-open');
    const now = Date.now();
    if (op === 'job') {
      const j = st.data.who.jobs.find((x) => x.key === el.getAttribute('data-key'));
      if (j) openSheet(jobSheet(st.data, j, now));
    } else if (op === 'arr') {
      const a = st.data.arrivals.rows.find((x) => x.id === el.getAttribute('data-id'));
      if (a) openSheet(arrivalSheet(st.data, a, now));
    } else if (op === 'prob') {
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) openSheet(problemSheet(p));
    }
  }

  function onKey(e) {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || sheetIsOpen()) return;
    const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-nav-row]') : null;
    if (!row) return;
    const all = Array.from(row.closest('section').querySelectorAll('[data-nav-row]'));
    const next = all[all.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  });
  await refresh();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: all manager tests pass (Tasks 7, 8 and 9).

- [ ] **Step 5: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add manager/today-cache.js manager/screens/today.js tests/manager/today-offline.spec.ts
git commit -m "manager: Today hors ligne (cache local, bandeau Data from, delai 15 s et Retry, copie Hostaway du proxy signalee)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---

### Task 10: Real actions from Today: Assign and Mark done

**Files:**
- Modify: `manager/screens/today-view.js` (replace `actionsFoot` and `assignBtn`, append `pickerSheet`)
- Modify: `manager/screens/today.js` (full replacement below)
- Create: `tests/manager/today-actions.spec.ts`

**Interfaces:**
- Consumes: proxy `assignCleaner` (POST `{ reservation_key, cleaner_ids: number[], mode: 'set', service_type }`, 409 with `{error}` when the cleaner is on approved leave) and `setDone` (POST `{ key, done: boolean }`), both now authored from the session (Task 1); `post` (`manager/api.js`); `closeSheet`, `placeLabel`, `toast` (`ui/dom.js`); `MgrJob.serviceType`, `MgrArrival.prevKey / assigned / serviceType`, `MgrToday.assignable` (Task 6).
- Produces: `pickerSheet(data, target)` in `today-view.js` with `target = { key, apt, bld, assigned: number[], serviceType: string | null, sub: string }`; DOM hooks `[data-assign=<key>]`, `[data-pick=<cleanerId>][data-key=<key>]`, `[data-done=<key>][data-val="1"|"0"]`.

Behaviour: Assign replaces the assignee list with the picked person (`mode: 'set'`, same as the prototype's reassign) and keeps the job's service type (default `CHC`). While a write is in flight every action button of the sheet is disabled; a second click sends nothing. A server error (for example the leave block) is shown as-is inside the sheet and the buttons come back. On success the sheet closes, a toast offers Undo for 6 s (Undo restores the previous list or done state), and Today reloads from `mgr.today`. No `actor` field is ever sent.

- [ ] **Step 1: Write the failing tests**

`tests/manager/today-actions.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { NOW, todayBody } from './fixtures';

const TODAY = (body: any = todayBody()) => ({ match: 'action=mgr.today', status: 200, body });
const OK = { status: 'success' };

function assignedBody() {
  const b = todayBody();
  b.who.jobs[0] = { ...b.who.jobs[0], assigned: [4], serviceType: 'CHC', tone: 'warn', word: 'Not started' };
  b.who.unassigned = ['2026-10-09_Lu Mo'];
  b.who.people[0].keys = ['2026-10-09_Cy Doe', '2026-10-09_Ann Lee'];
  return b;
}
const writes = async (page: any, action: string) =>
  (await fetchLog(page)).filter((l) => l.url.includes('action=' + action)).map((l) => JSON.parse(l.body));

test('Assign depuis Today : assignCleaner en mode set, sans actor, Today recharge', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...TODAY(), once: true }, { match: 'action=assignCleaner', status: 200, body: OK }, TODAY(assignedBody())], { email: true, clock: NOW });
  const row = page.locator('.person.unassigned .job', { hasText: 'Apt 308' });
  await row.getByRole('button', { name: 'Assign' }).click();
  const sheet = page.locator('#sheet');
  await expect(sheet.getByRole('heading', { name: 'Assign a cleaner' })).toBeVisible();
  await expect(sheet.locator('[data-pick="4"]')).toContainText('1 job today');
  await sheet.locator('[data-pick="4"]').click();
  await expect(page.locator('#toast')).toContainText('Apt 308 · Binghatti Lavender assigned to Faiza');
  expect(await writes(page, 'assignCleaner')).toEqual([
    { reservation_key: '2026-10-09_Ann Lee', cleaner_ids: [4], mode: 'set', service_type: 'CHC' },
  ]);
  await expect(page.locator('.person.unassigned')).not.toContainText('Apt 308');
  expect((await fetchLog(page)).filter((l) => l.url.includes('action=mgr.today')).length).toBe(2);
});

test('double clic sur la personne : une seule ecriture', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK, delay: 400 }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="10"]').dblclick();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('refus du serveur (conge) : message tel quel dans la fiche, boutons rendus', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 409, body: { error: 'Faiza is on approved leave on 2026-10-09' } }], { email: true, clock: NOW });
  await page.locator('.person.unassigned .job', { hasText: 'Apt 308' }).getByRole('button', { name: 'Assign' }).click();
  await page.locator('#sheet [data-pick="4"]').click();
  await expect(page.locator('#sheet .sheet-err')).toHaveText('Faiza is on approved leave on 2026-10-09');
  await expect(page.locator('#sheet [data-pick="4"]')).toBeEnabled();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
});

test('Reassign depuis une fiche d arrivee garde le type de service', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=assignCleaner', status: 200, body: OK }], { email: true, clock: NOW });
  await page.locator('.arr', { hasText: 'Apt 103' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Reassign' }).click();
  await expect(page.locator('#sheet [data-pick="4"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('#sheet [data-pick="10"]').click();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect(await writes(page, 'assignCleaner')).toEqual([
    { reservation_key: '2026-10-09_Cy Doe', cleaner_ids: [10], mode: 'set', service_type: 'CHC' },
  ]);
});

test('Mark done depuis une arrivee, puis Undo : setDone true puis false, sans actor', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await page.locator('.arr', { hasText: 'Apt 103' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva marked done');
  await page.locator('#toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await writes(page, 'setDone')).length).toBe(2);
  expect(await writes(page, 'setDone')).toEqual([
    { key: '2026-10-09_Cy Doe', done: true }, { key: '2026-10-09_Cy Doe', done: false },
  ]);
});

test('Undo done depuis une arrivee deja prete', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), TODAY(), { match: 'action=setDone', status: 200, body: OK }], { email: true, clock: NOW });
  await page.locator('.arr', { hasText: 'Apt 404' }).click();
  await page.locator('#sheet').getByRole('button', { name: 'Undo done' }).click();
  await expect(page.locator('#toast')).toContainText('back to not done');
  expect(await writes(page, 'setDone')).toEqual([{ key: '2026-10-05_Fa Ho', done: false }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager/today-actions.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL, no `Assign` button in the unassigned list, no `Mark done` in sheets.

- [ ] **Step 3: Implement the view part**

In `manager/screens/today-view.js`, replace:

```js
// --- remplaces a la tache 10 (actions reelles) ---
function actionsFoot(key, assigned, done) {
  return '<div class="sheet-f"><button class="btn" type="button" data-close>Close</button></div>';
}
function assignBtn(j) { return ''; }
// --- fin ---
```

with:

```js
// Actions reelles (assignCleaner, setDone) : branchees dans today.js.
function actionsFoot(key, assigned, done) {
  return '<div class="sheet-f"><button class="btn primary" type="button" data-assign="' + esc(key) + '">' + (assigned.length ? 'Reassign' : 'Assign cleaner') + '</button>'
    + '<button class="btn" type="button" data-done="' + esc(key) + '" data-val="' + (done ? '0' : '1') + '">' + (done ? 'Undo done' : 'Mark done') + '</button>'
    + '<button class="btn" type="button" data-close>Close</button></div>';
}
function assignBtn(j) {
  return j.state === 'done' ? '' : '<button class="btn sm primary" type="button" data-assign="' + esc(j.key) + '">Assign</button>';
}
```

Append to the end of `manager/screens/today-view.js`:

```js
export function pickerSheet(data, t) {
  const count = {};
  for (const p of data.who.people) count[p.id] = p.keys.length;
  const opts = data.assignable.map((p) => {
    const n = count[p.id] || 0;
    const current = t.assigned.length === 1 && t.assigned[0] === p.id;
    return '<button type="button" data-pick="' + p.id + '" data-key="' + esc(t.key) + '"' + (current ? ' aria-current="true"' : '') + '>'
      + '<span class="av" aria-hidden="true">' + esc(initials(p.name)) + '</span><span><b>' + esc(p.name) + '</b><small>'
      + esc(ROLE[p.role] || p.role) + ' · ' + n + ' job' + (n === 1 ? '' : 's') + ' today</small></span></button>';
  }).join('');
  return sheetHead('Assign a cleaner', placeLabel(t) + (t.sub ? ' · ' + t.sub : ''))
    + '<div class="sheet-b"><div class="pick">' + opts + '</div></div>'
    + '<div class="sheet-f"><button class="btn" type="button" data-close>Cancel</button></div>';
}
```

- [ ] **Step 4: Implement the controller part**

Replace the whole content of `manager/screens/today.js` with:

```js
// Ecran Today : un appel mgr.today, rendu, panneaux, navigation au clavier,
// cache local du dernier Today (spec section 7), Assign et Mark done reels.
// Aucune ecriture n'envoie d'actor : le proxy prend l'auteur dans la session.
import { get, post } from '/manager/api.js';
import { loadToday, saveToday } from '/manager/today-cache.js';
import { closeSheet, dubaiTime, esc, openSheet, placeLabel, sheetIsOpen, toast } from '/manager/ui/dom.js';
import { arrivalSheet, boardHtml, jobSheet, pickerSheet, problemSheet } from '/manager/screens/today-view.js';

function shellHtml(inner) { return '<header class="top"><div><h1>Today</h1></div></header>' + inner; }

export async function renderToday(ctx) {
  const main = ctx.main;
  const st = { data: null, savedAt: 0, fresh: false, loading: true, error: null, busy: false };
  const cached = loadToday();
  // Hors ligne au demarrage (ctx.me inconnu) : le cache de l'appareil. Sinon,
  // seulement celui du manager connecte.
  if (cached && (!ctx.me || (cached.data.me && cached.data.me.id === ctx.me.id))) {
    st.data = cached.data;
    st.savedAt = cached.savedAt;
  }

  function banner() {
    let h = '';
    if (st.data && !st.fresh) {
      const when = dubaiTime(new Date(st.savedAt).toISOString());
      if (st.error) {
        h += '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message)
          + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
      } else if (st.loading) {
        h += '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.</span></div>';
      }
    }
    if (st.data && st.data.bookingsCachedAt) {
      h += '<div class="banner warn" role="status"><span>Bookings data from ' + esc(dubaiTime(st.data.bookingsCachedAt))
        + '. Hostaway is not answering, statuses may be late.</span></div>';
    }
    return h;
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    if (st.data) { main.innerHTML = boardHtml(st.data, Date.now(), banner(), !st.fresh); return; }
    if (st.loading) { main.innerHTML = shellHtml('<p class="boot" role="status">Loading today…</p>'); return; }
    main.innerHTML = shellHtml('<div class="err-card" role="alert"><p>' + esc(st.error ? st.error.message : 'Could not load.')
      + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>');
  }

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran.
  function handleAccess(e) {
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  async function refresh() {
    st.loading = true;
    st.error = null;
    paint();
    try {
      const d = await get('mgr.today');
      st.data = d;
      st.savedAt = Date.now();
      st.fresh = true;
      saveToday(d, st.savedAt);
    } catch (e) {
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    paint();
  }

  // Cible d'une ecriture : un menage du jour, ou le menage precedent d'une arrivee.
  function targetFor(key) {
    const j = st.data.who.jobs.find((x) => x.key === key);
    if (j) return { key, apt: j.apt, bld: j.bld, assigned: j.assigned, serviceType: j.serviceType, sub: j.checkout ? 'checkout ' + j.checkout : '' };
    const a = st.data.arrivals.rows.find((x) => x.prevKey === key);
    if (a) return { key, apt: a.apt, bld: a.bld, assigned: a.assigned, serviceType: a.serviceType, sub: a.kind + ' at ' + a.time };
    return null;
  }
  function nameOf(id) {
    const p = st.data.assignable.find((x) => x.id === Number(id));
    return p ? p.name : 'Member ' + id;
  }
  function sheetBusy(on) {
    document.querySelectorAll('#sheet button:not([data-close])').forEach((b) => { b.disabled = on; });
  }
  function sheetError(msg) {
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
  async function undo(fn) {
    try { await fn(); } catch (e) { toast(e.message); }
    refresh();
  }

  async function write(t, call, okMsg, undoCall) {
    if (st.busy) return;
    st.busy = true;
    sheetBusy(true);
    try {
      await call();
    } catch (e) {
      st.busy = false;
      sheetBusy(false);
      if (handleAccess(e)) return;
      sheetError(e.message);
      return;
    }
    st.busy = false;
    closeSheet();
    toast(okMsg, () => undo(undoCall));
    refresh();
  }

  function assign(key, id) {
    const t = targetFor(key);
    if (!t) return;
    const prev = t.assigned.slice();
    const service = t.serviceType || 'CHC';
    return write(t,
      () => post('assignCleaner', { reservation_key: key, cleaner_ids: [Number(id)], mode: 'set', service_type: service }),
      placeLabel(t) + ' assigned to ' + nameOf(id),
      () => post('assignCleaner', { reservation_key: key, cleaner_ids: prev, mode: 'set', service_type: service }));
  }

  function setDone(key, val) {
    const t = targetFor(key);
    if (!t) return;
    return write(t,
      () => post('setDone', { key, done: val }),
      placeLabel(t) + (val ? ' marked done' : ' back to not done'),
      () => post('setDone', { key, done: !val }));
  }

  function onClick(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-retry],[data-open],[data-assign],[data-pick],[data-done]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (!st.data) return;
    if (el.hasAttribute('data-pick')) { assign(el.getAttribute('data-key'), el.getAttribute('data-pick')); return; }
    if (el.hasAttribute('data-assign')) {
      const t = targetFor(el.getAttribute('data-assign'));
      if (t) openSheet(pickerSheet(st.data, t));
      return;
    }
    if (el.hasAttribute('data-done')) { setDone(el.getAttribute('data-done'), el.getAttribute('data-val') === '1'); return; }
    const op = el.getAttribute('data-open');
    const now = Date.now();
    if (op === 'job') {
      const j = st.data.who.jobs.find((x) => x.key === el.getAttribute('data-key'));
      if (j) openSheet(jobSheet(st.data, j, now));
    } else if (op === 'arr') {
      const a = st.data.arrivals.rows.find((x) => x.id === el.getAttribute('data-id'));
      if (a) openSheet(arrivalSheet(st.data, a, now));
    } else if (op === 'prob') {
      const p = st.data.problems.top.find((x) => x.ref === el.getAttribute('data-ref'));
      if (p) openSheet(problemSheet(p));
    }
  }

  function onKey(e) {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || sheetIsOpen()) return;
    const row = document.activeElement && document.activeElement.closest ? document.activeElement.closest('[data-nav-row]') : null;
    if (!row) return;
    const all = Array.from(row.closest('section').querySelectorAll('[data-nav-row]'));
    const next = all[all.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('keydown', onKey);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
  });
  await refresh();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: all manager tests pass (access, shell, today, today-offline, today-actions) on both projects.

- [ ] **Step 6: Regression on the neighbouring suites served from the working tree**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test --project=insp-mobile --project=insp-desktop && HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/v3-cutover.spec.ts --project=desktop`
Expected: same results as before this plan (no new failure). If a test already failed before Task 1, note it in the report, do not fix it here.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git add manager/screens/today-view.js manager/screens/today.js tests/manager/today-actions.spec.ts
git commit -m "manager: Assign et Mark done reels depuis Today (assignCleaner set, setDone, Undo, refus serveur affiche, pas d'actor envoye)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019zYEYjz7mFNz8xqSAErGPK"
```

---

### Task 11: Deploy proxy and front, verify in prod

**Files:** none created. Deploys `supabase/functions/hostaway-proxy` and the working tree to Netlify.

**Interfaces:**
- Consumes: `BASE_SHA` recorded before Task 1; `./deploy-proxy.sh` (project `dqjnqvbxfwtvrjwnnmns`, token in `~/.supabase/access-token`); `./deploy-front.sh` (Netlify site `stunning-kleicha-f61101`, stamps `sw.js` and `v3/sw.js`).
- Produces: `mgr.today` live, `/manager/` live, old app writes authored from the session.

Both deploys act on prod: per `~/CLAUDE.md` ("les actions vers l'exterieur se confirment d'abord"), get Hillal's go before Step 3 and Step 6 unless he already gave it for this plan.

- [ ] **Step 1: Full local verification**

Run:
```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop
```
Expected: 0 failed everywhere.

- [ ] **Step 2: Check that the deployed proxy is the base commit (nobody deployed something outside git)**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
D=/private/tmp/claude-501/-Users-hillal/53f1183c-ba59-4d8f-a69a-a53171d830fc/scratchpad/proxy-check
rm -rf "$D" && mkdir -p "$D/dl" "$D/base"
(cd "$D/dl" && SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" npx -y supabase@2 functions download hostaway-proxy --project-ref dqjnqvbxfwtvrjwnnmns)
git archive "$BASE_SHA" supabase/functions/hostaway-proxy | tar -x -C "$D/base"
DL=$(dirname "$(find "$D/dl" -name index.ts -path '*hostaway-proxy*' | head -1)")
diff -r -x '*_test.ts' -x 'v3_fakedb.ts' "$D/base/supabase/functions/hostaway-proxy" "$DL"
```
Expected: no output, or only `Only in .../base/...` lines for files that `index.ts` does not import. Any content difference or any `Only in <download>` line: STOP and report to Hillal (prod runs code that is not in `BASE_SHA`; deploying would erase it).

- [ ] **Step 3: Deploy the proxy (after Hillal's go)**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && ./deploy-proxy.sh`
Expected: `✓ Deployed.`

- [ ] **Step 4: Verify the deployed proxy is HEAD and answers**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
D=/private/tmp/claude-501/-Users-hillal/53f1183c-ba59-4d8f-a69a-a53171d830fc/scratchpad/proxy-check2
rm -rf "$D" && mkdir -p "$D/dl" "$D/head"
(cd "$D/dl" && SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" npx -y supabase@2 functions download hostaway-proxy --project-ref dqjnqvbxfwtvrjwnnmns)
git archive HEAD supabase/functions/hostaway-proxy | tar -x -C "$D/head"
DL=$(dirname "$(find "$D/dl" -name index.ts -path '*hostaway-proxy*' | head -1)")
diff -r -x '*_test.ts' -x 'v3_fakedb.ts' "$D/head/supabase/functions/hostaway-proxy" "$DL"
SECRET=$(sed -n "s/^export const APP_SECRET = '\(.*\)';/\1/p" v3/proxy-config.js)
curl -sS -o /dev/null -w "%{http_code}\n" "https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy?action=mgr.today" -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w "%{http_code}\n" "https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy?action=getCleaners" -H "X-App-Secret: $SECRET"
```
Expected: `diff` prints nothing (or only `Only in .../head/...` for unimported files); `mgr.today` without session returns `401`; `getCleaners` returns `200` (old app unharmed).

- [ ] **Step 5: Check the working tree before the front deploy**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && git status --short`
Expected: exactly the baseline recorded before Task 1 (see Global Constraints); everything of this plan is committed. Do not stash, revert or add anything: the front deploy ships this tree as it is, which is how prod is served.

- [ ] **Step 6: Deploy the front (after Hillal's go)**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && ./deploy-front.sh`
Expected: `✓ Deployed.` The script stamps `sw.js` and `v3/sw.js`; leave the stamp uncommitted (both files carry other uncommitted hunks), as before this plan.

- [ ] **Step 7: Verify the front in prod (read only)**

```bash
curl -sSI https://stunning-kleicha-f61101.netlify.app/manager/ | grep -iE "^HTTP|cache-control|content-security-policy" 
curl -sS https://stunning-kleicha-f61101.netlify.app/manager/app.js | head -3
curl -sS https://stunning-kleicha-f61101.netlify.app/sw.js | grep -n "/manager/"
```
Expected: `HTTP/2 200`, `cache-control: no-cache`, the CSP header present; `app.js` starts with the `// App manager /manager/` comment; `sw.js` contains the `/manager/` early return.

Then, with Playwright against prod and no session (read only): `/manager/` must land on the sign-in screen of `/`.

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && node -e "
const { chromium } = require('@playwright/test');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('https://stunning-kleicha-f61101.netlify.app/manager/'); await p.waitForURL(/netlify\.app\/(\?.*)?$/, { timeout: 15000 });
  console.log('redirected to', p.url()); await b.close(); })();"
```
Expected: `redirected to https://stunning-kleicha-f61101.netlify.app/`.

- [ ] **Step 8: Real-data check with Hillal (spec section 8, read only)**

Ask Hillal to open `https://stunning-kleicha-f61101.netlify.app/manager/` signed in with his email, on phone and on desktop, and compare with the old app (`/?legacy=1`, Planner of today):
- number of cleanings today and of unassigned ones equals the old Planner;
- every arrival marked Blocked has either no cleaner in the old Planner or an urgent ticket;
- an apartment usually cleaned by Elite shows "Usually Elite · not logged yet" before 14:00;
- a checkout without hour shows `--:--` and "checkout time not set";
- the "Data as of" time is the current Dubai time;
- a second opening of Today (warm cache) shows the board in under 3 s (spec section 6).

Cross-check the counts with SQL (Supabase MCP `execute_sql`, project `dqjnqvbxfwtvrjwnnmns`, read only):

```sql
select count(*) filter (where action in ('assigned','unassigned','marked_done','marked_undone')) as writes_since_deploy,
       count(*) filter (where actor = 'Manager') as still_manager,
       array_agg(distinct actor) as actors
from cleaning_log
where created_at > now() - interval '1 day' and action in ('assigned','unassigned','marked_done','marked_undone');
```
Expected after the first real writes (Hillal's, or Hermes at 14:00): `still_manager` counts only rows older than the deploy; new rows carry a manager's name or `Hermes_AutoAssign` / `Hermes_Brain`, never `Manager`. Report what was verified and what was not (for example the Elite line if no Elite apartment is unassigned today).

- [ ] **Step 9: Report**

Report to Hillal (French): what is live, the links, what was checked in prod, the decisions taken on spec gaps (see "Decisions" below), and the next phase (Problems).

---

## Decisions taken where the spec is silent (for Hillal's review)

1. Assigned but not done with the guest more than `mgr_risk_hours` away: neutral grey "Scheduled" (the spec only defines At risk inside the threshold; the prototype showed amber for both).
2. Arrival with no checkout in the last 14 days: "Ready", cause "No checkout in the last 14 days, apartment empty." (red only with an urgent ticket).
3. "Usually Elite" = at least 2 Elite jobs on the apartment in the 60 days before today, read from `cleaning_accounting_cache` (the only table that links Elite jobs to apartments); the amber state lasts until 14:00 Dubai the day after the cleaning date.
4. Author of writes without session: only `Hermes_<letters>` (Hermes server jobs) keeps its name, anything else becomes "unknown (no session)". Applied to `assignCleaner`, `setDone`, `setCancelled`, `setPostponed`; ticket writes (`updateTicket`, `completePreventive`) move with Problems in phase 2.
5. Arrival without check-in hour: 15:00 assumed for the countdown, labelled "time not set".
6. Problems on Today are read-only in phase 1 (sheet + link to the current app); Assign / Schedule / Close and the A / S / C keys arrive with Problems (phase 2). Keyboard in phase 1: arrows between rows, Enter opens, Escape closes, focus kept in the sheet.
7. Assign from Today replaces the assignee (`mode: 'set'`, like the prototype) and keeps the service type.
8. Accent colour: the prototype's `#0a6fd6` (validated) rather than the spec's `#0099FF`.
9. Technicians in "Who does what" come from `maintenance_tickets.assigned_technician_id` (no hard-coded "Semax on duty").
10. No service worker for `/manager/` in phase 1: root `sw.js` skips `/manager/`, Netlify `no-cache`, offline reading through the local copy of the last Today.
