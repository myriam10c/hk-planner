# HK Manager app · Phase 3 (Planning) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Planning screen of `/manager/`: the week of cleanings as a 7-day grid on desktop and one day at a time on phone, one colour per person (Faiza, Pionah, Elite, extras), with Assign (one or more people), Mark done / Undo, Cancel / Restore, Postpone / Restore date, the linen count of each cleaning, extra cleanings (add, edit, delete), and approved leaves and public holidays visible, read through one new proxy read `mgr.planning` and written through the existing proxy actions only.

**Architecture:** Proxy side, a pure rules module `mgr_planning_rules.ts` (week bounds, status words, person colour slots, linen rows) feeds one read action `mgr.planning` (`mgr_planning.ts`) behind the phase 1 access rule (`mgrAccess`). It reads the week's departures through the same cached path as the old Planner (`checkouts`, extracted into one function `loadCheckoutsCached` in `index.ts`) and the existing tables by key. Writes reuse the existing actions (`assignCleaner`, `setDone`, `setCancelled`, `setPostponed`, `saveLaundryCount`, `addExtraCleaning`, `updateExtraCleaning`, `deleteExtraCleaning`); the only server changes to them are the session author (spec section 6) and an idempotent `addExtraCleaning` (reservation key derived from the gesture's key, `mgr_extra.ts`). Front side, a new screen `manager/screens/planning.js` (controller) with pure views `planning-view.js` and pure helpers `planning-rules.js`, a shared gesture helper `manager/gesture.js` (one idempotency key per gesture, reused on an uncertain retry), and `ui/planning.css`.

**Tech Stack:** Deno edge function (Supabase), supabase-js service client; vanilla JS ES modules, CSS custom properties; tests with `deno test` on the existing fake DB (`v3_fakedb.ts`) and Playwright on a local static server (port 8890) with `window.fetch` stubbed.

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` (sections 3, 4, 6, 7, 8, 9.3). Phase 2 plan (structure and conventions): `docs/superpowers/plans/2026-10-10-hk-manager-phase2-problems.md`. Phase 1 plan: `docs/superpowers/plans/2026-10-09-hk-manager-phase1-today.md`.

**Usage measured before design (Supabase, read only, 09/09 to 09/10/2026):**
- Who cleans: Elite Cleaning (subcontractor) 149 cleanings (4.8 a day, 30 days out of 31), Faiza 60, Pionah 59. No other cleaner is active. 44 cleanings had 2 or more people assigned (Faiza and Pionah together): multi-assign stays.
- Volume: 7.2 assigned cleanings a day on average, 13 at most; a week of departures from `checkouts` is 53 to 59 reservations. Service type: 100 % `CHC` (no service type picker needed).
- Extras: 9 in 30 days (37 in total), labels mostly "Other". Cancellations: 8 in 30 days, all logged as "Manager". Postponements: 2 in 30 days, and 19 out of 19 since July were exactly +1 day.
- Linen counts: 67 in 30 days; Faiza 48 of her 60 cleanings, Pionah 32 of 59, Elite 7 of 149. 36 of the 67 were entered with author "Manager" (who is unknown today).
- Leaves: approved leaves since August are managers only (Semax, Ismael); none for cleaners. Leaves of all roles are still shown (the spec asks for leaves to be visible).
- `cleaning_log` actors: `assigned` 158 with no actor, 152 `Hermes_AutoAssign`; `cancelled`, `postponed`, `extra_created` all "Manager".
- Schema checked: `extra_cleanings.reservation_key` is UNIQUE, `laundry_counts` PK is `reservation_key`, `cleaning_postponed` PK is `reservation_key`, `cleaning_cancelled.reservation_key` UNIQUE. No migration is needed in this phase.

## Global Constraints

- **Worktree.** Before Task 1 the controller runs, once:
  ```bash
  MAIN="/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
  WT="/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
  git -C "$MAIN" rev-parse main            # write it in the task log as BASE_SHA (Task 10 needs it)
  git -C "$MAIN" status --short            # write it in the task log as BASELINE (Task 10 compares)
  git -C "$MAIN" worktree add -b mgr-phase3 "$WT" main
  git -C "$MAIN" config --get core.bare    # must print false (known trap: a worktree can flip it; fix with git -C "$MAIN" config core.bare false)
  ln -s "$MAIN/node_modules" "$WT/node_modules"
  ```
  Every task works in `/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3` (quote it, it has a space). The `node_modules` symlink and any `deno.lock` that Deno creates are untracked: never stage them.
- **Port 8890.** Playwright's `webServer` reuses any server already on 8890 (`reuseExistingServer: true`); a server started from the main checkout would make the tests run against the wrong tree. Before any Playwright run: `lsof -nP -iTCP:8890 -sTCP:LISTEN`. Empty, or a `python3` whose cwd (`lsof -p <pid> | grep cwd`) is the worktree: go. Anything else: stop and report, do not kill someone else's server.
- Deno binary: `/Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno`, always with `--node-modules-dir=none`. Proxy tests run from `supabase/functions/hostaway-proxy` with `deno test --allow-all --node-modules-dir=none <files>`.
- Playwright (manager): `npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`. Never against prod, never with real proxy calls.
- **Git.** Never `git add -A`, never `git add .`, never `git stash`. Stage exactly the files listed in each task. In the main checkout, `sw.js` and `v3/sw.js` carry uncommitted VERSION stamps and `hr.js`, `styles.css`, `.gitignore`, `tests/hr.spec.ts`, `tests/laundry.spec.ts` carry other people's edits: never stage, revert or tidy them (prod is served from that tree). **No task of this plan touches those files**: leaves are read by the proxy (`leave_requests`), not through `hr.js`; Planning styles live in `manager/ui/planning.css`, never in the root `styles.css`.
- **Commit messages** end with exactly this one trailer line, and nothing else after it:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- UI text in English. Never an em dash or en dash used as a dash in UI strings: comma, period, " · " or the word "to" ("5 to 11 Oct 2026"). Code comments in French without accents (repo habit).
- Fragment Mono for times and references, Onest for text, body ≥ 16 px, tokens of `manager/ui/tokens.css` only. This phase adds exactly five person tokens (`--pc-1`, `--pc-2`, `--pc-3`, `--pc-4`, `--pc-sub`, light and dark) in `tokens.css` (Task 5); no colour literal anywhere else except the existing `#fff` on avatars. Status tones keep their meaning: `bad` red, `warn` amber, `ok` green, `idle` grey.
- Writes sent from `/manager/` never carry `actor`, `author`, `created_by` or `reported_by`: the proxy takes the author from the session (`sessionActor`). Every write action used by Planning goes through `sessionActor` after Task 1.
- Every write from `/manager/` carries an idempotency key `idem` matching `^[A-Za-z0-9_-]{8,80}$`: one new key per user gesture, the same key when the same gesture is replayed after an uncertain failure (timeout, offline, `409 Still processing. Retry.`), exactly as `manager/problem-panel.js` does (helper `manager/gesture.js`, Task 5).
- Access to `mgr.planning`: `mgrAccess(bearerToken(req) !== null, me)` (401 without session, 403 `email sign-in required` on PIN, 403 `forbidden` for non-managers).
- Dubai time is UTC+4, fixed. The week runs Monday to Sunday (Dubai calendar days).
- Client timeout 15 s on every proxy call (existing `manager/api.js`), server error messages shown as they are, buttons disabled while a write is in flight, read-only when the data on screen is stale (not fresh from the server: cache shown after a network failure).
- No new dependency, no build step, CSP unchanged (`script-src 'self'`, no inline script).
- No migration in this phase. The deploy task (Task 10) deploys proxy and front only; Hillal already gave the go for this deploy, no extra stop is needed.

## Review Focus

1. **A cleaning moved across a week boundary.** A checkout of last Sunday postponed to Monday, an extra of August postponed into this week, and a cleaning of this Sunday postponed to next Tuesday. Expected: each cleaning appears once, in the week and day of its effective date, with "From dd/mm"; never in both weeks, never lost. Tests: Task 3 (`2026-10-04_Ha Ju` in, `2026-10-11_Gi Io` out, `extra_2026-08-01_old` in), Task 7 (postpone sends the first original date).
2. **Double tap or retry on a bad network.** Add extra inserts a row: a double click or a replay after a timeout must not create two extras. Expected: one request per click while busy, the same `idem` on a replay after an uncertain failure, and the proxy returns the row already created for that key. Tests: Task 1 (`insertExtraOnce` replay), Task 6 (double click on Save sends one write), Task 7 (same `idem` after "No connection"), Task 9 (double click on Create extra).
3. **Assigning someone on approved leave.** Expected: in the picker that person is greyed "On leave" (still removable if already assigned); the day header says "Faiza off"; if the server refuses anyway (409), its message shows in the panel as is and the buttons come back, the greyed ones stay greyed. Tests: Task 6.
4. **Stale data on screen** (network down with the cached week). Expected: banner "Data from HH:MM" with Retry, no "Add extra", the cleaning panel says "Reconnect to make changes." and offers no gesture. Tests: Task 5.
5. **Postponing past the next guest's check-in.** Expected: the postpone panel warns before ("Next guest checks in Sat 10 at 16:00. The cleaning must be done before."), and a cleaning already moved after the next arrival shows red "Guest arrives first". Tests: Task 2 (`planStatus`), Task 3 (`2026-10-10_Fa Ho`), Task 7 (warning in the panel).

## File Structure

Proxy (`supabase/functions/hostaway-proxy/`):
- Create `mgr_extra.ts` / `mgr_extra_test.ts`: reservation key of an extra from the gesture's key, insert once (replay returns the existing row).
- Create `mgr_planning_rules.ts` / `mgr_planning_rules_test.ts`: week bounds, `start` parsing, Hostaway hour, status word, person slots, linen row, `LAUNDRY_FIELDS` (single source, imported by `index.ts`).
- Create `mgr_planning.ts` / `mgr_planning_test.ts`: the `mgr.planning` read.
- Modify `mgr_today.ts`: export `monthsBack` (already used by Today; Planning reuses it).
- Modify `v3_fakedb.ts`: `extra_cleanings` unique on `reservation_key` (as in Postgres).
- Modify `index.ts`: session author for `saveLaundryCount`, `addExtraCleaning`, `updateExtraCleaning`, `deleteExtraCleaning`; idempotent `addExtraCleaning`; `loadCheckoutsCached` extracted from the `checkouts` route; `LAUNDRY_FIELDS` imported; route `mgr.planning`.

Front (`manager/`):
- Create `gesture.js`, `screens/planning.js`, `screens/planning-view.js`, `screens/planning-rules.js`, `ui/planning.css`.
- Modify `app.js` (Planning route), `index.html` (stylesheet), `ui/dom.js` (chevron icons), `ui/tokens.css` (person colours).

Tests: create `tests/manager/planning-fixtures.ts`, `planning.spec.ts`, `planning-actions.spec.ts`, `planning-changes.spec.ts`, `planning-linen.spec.ts`, `planning-extras.spec.ts`; modify `tests/manager/shell.spec.ts` (Planning is no longer a placeholder).

---

### Task 1: Session author on planning writes, idempotent extra creation

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_extra.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_extra_test.ts`
- Modify: `supabase/functions/hostaway-proxy/v3_fakedb.ts` (`UNIQUE`, ~line 5)
- Modify: `supabase/functions/hostaway-proxy/index.ts` (imports ~line 38, `saveLaundryCount` ~line 1666, `addExtraCleaning` ~line 3771, `updateExtraCleaning` ~line 3821, `deleteExtraCleaning` ~line 3883)

**Interfaces:**
- Consumes: `validIdem(v: unknown): boolean` from `v3.ts`; `sessionActor(me, bodyActor)` from `actor.ts`; `currentUser(sb, req)` (already imported in `index.ts`).
- Produces: `extraReservationKey(date: string, idem: unknown, rand: string): string`; `insertExtraOnce(sb, row): Promise<{ row: any; replay: boolean }>`. `addExtraCleaning` accepts an optional `idem` and answers `{ status: "success", extra, replay }`. Planning (Tasks 8 and 9) relies on: `saveLaundryCount`, `addExtraCleaning`, `updateExtraCleaning`, `deleteExtraCleaning` taking the author from the session and ignoring `author` / `created_by` / `actor` from the body.

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_extra_test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { extraReservationKey, insertExtraOnce } from "./mgr_extra.ts";
import { keyDate } from "./mgr_rules.ts";

Deno.test("cle d'un extra : derivee de la cle d'idempotence, sinon aleatoire", () => {
  const k = extraReservationKey("2026-10-10", "mgr-0123456789abcdef0123456789abcdef", "r4nd0m00");
  assertEquals(k, "extra_2026-10-10_mcdef0123456789abcdef");
  assertEquals(keyDate(k), "2026-10-10");
  assertEquals(extraReservationKey("2026-10-10", "short", "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
  assertEquals(extraReservationKey("2026-10-10", undefined, "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
  assertEquals(extraReservationKey("2026-10-10", "bad key with spaces!!", "r4nd0m00"), "extra_2026-10-10_r4nd0m00");
});

Deno.test("insertExtraOnce : le meme geste rejoue rend la ligne deja creee, sans doublon", async () => {
  const db = fakeDb({ extra_cleanings: [] });
  const row = { reservation_key: "extra_2026-10-10_mabc", listing_id: "L8", cleaning_date: "2026-10-10", status: "pending" };
  const a = await insertExtraOnce(db, row);
  assertEquals(a.replay, false);
  const b = await insertExtraOnce(db, { ...row, notes: "second try" });
  assertEquals(b.replay, true);
  assertEquals(b.row.id, a.row.id);
  assertEquals(db.tables.extra_cleanings.length, 1);
  const c = await insertExtraOnce(db, { ...row, reservation_key: "extra_2026-10-10_other" });
  assertEquals(c.replay, false);
  assertEquals(db.tables.extra_cleanings.length, 2);
});

Deno.test("insertExtraOnce : une autre erreur de la base remonte", async () => {
  const db = fakeDb({ extra_cleanings: [] });
  db.fail["extra_cleanings.insert"] = { code: "23503", message: "listing missing" };
  const e = await assertRejects(() => insertExtraOnce(db, { reservation_key: "extra_2026-10-10_x", listing_id: "L0" }));
  assert(String((e as any).message).includes("listing missing"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_extra_test.ts`
Expected: FAIL (module `./mgr_extra.ts` not found).

- [ ] **Step 3: Write the module and declare the unique key in the fake DB**

`supabase/functions/hostaway-proxy/mgr_extra.ts`:

```ts
// Menages en plus (extra_cleanings) crees depuis l'app manager : la cle
// d'idempotence du geste donne la reservation_key, si bien qu'un geste rejoue
// (double clic, reessai apres un delai depasse) retombe sur la contrainte unique
// et retrouve la prestation deja creee au lieu d'en creer une seconde.
import { validIdem } from "./v3.ts";

export function extraReservationKey(date: string, idem: unknown, rand: string): string {
  if (validIdem(idem)) return "extra_" + date + "_m" + String(idem).replace(/[^A-Za-z0-9]/g, "").slice(-20);
  return "extra_" + date + "_" + rand;
}

export async function insertExtraOnce(sb: any, row: Record<string, unknown>): Promise<{ row: any; replay: boolean }> {
  const { data, error } = await sb.from("extra_cleanings").insert(row).select().single();
  if (!error) return { row: data, replay: false };
  if (error.code !== "23505") throw new Error(error.message ?? "insert failed");
  const { data: prev, error: e2 } = await sb.from("extra_cleanings").select("*")
    .eq("reservation_key", row.reservation_key).maybeSingle();
  if (e2 || !prev) throw new Error(error.message ?? "insert failed");
  return { row: prev, replay: true };
}
```

In `v3_fakedb.ts`, replace:

```ts
  security_contacts_doc: ["id"],
};
```

with:

```ts
  security_contacts_doc: ["id"],
  extra_cleanings: ["reservation_key"],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok`, 3 passed, 0 failed.

- [ ] **Step 5: Use it in `addExtraCleaning`, session author on the four planning writes**

In `index.ts`, replace:

```ts
import { mgrProblemAct } from "./mgr_problem_act.ts";
```

with:

```ts
import { mgrProblemAct } from "./mgr_problem_act.ts";
import { extraReservationKey, insertExtraOnce } from "./mgr_extra.ts";
```

In `saveLaundryCount`, replace:

```ts
      const body = await req.json();
      const { reservation_key, author } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
```

with:

```ts
      const body = await req.json();
      const { reservation_key } = body;
      if (!reservation_key) return jsonResp({ error: "reservation_key required" }, 400);
      // Auteur pris dans la session (spec manager, section 6) : l'ancienne app
      // envoyait « Manager » pour tous les managers. body.author ignore.
      const author = sessionActor(await currentUser(sb, req), body.author);
```

(The rest of the handler keeps writing `author: author || null` and logging with `author`.)

In `addExtraCleaning`, replace:

```ts
      const { listing_id, cleaning_date, label, guest_name, price_billed, cleaner_price, notes, assigned_cleaner_id, created_by } = body;
      if (!listing_id || !cleaning_date) return jsonResp({ error: "listing_id and cleaning_date required" }, 400);
```

with:

```ts
      const { listing_id, cleaning_date, label, guest_name, price_billed, cleaner_price, notes, assigned_cleaner_id } = body;
      if (!listing_id || !cleaning_date) return jsonResp({ error: "listing_id and cleaning_date required" }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cleaning_date))) return jsonResp({ error: "cleaning_date must be YYYY-MM-DD" }, 400);
      // Auteur pris dans la session (spec manager, section 6), body.created_by ignore.
      const created_by = sessionActor(await currentUser(sb, req), body.created_by);
```

then replace:

```ts
      // Generate unique reservation_key
      const rand = Math.random().toString(36).substring(2, 10);
      const reservation_key = `extra_${cleaning_date}_${rand}`;

      const { data, error } = await sb.from("extra_cleanings").insert({
        reservation_key, listing_id, cleaning_date,
        label: label || null,
        guest_name: guest_name || null,
        price_billed: price_billed ?? null,
        cleaner_price: cleaner_price ?? null,
        notes: notes || null,
        created_by: created_by || null,
        status: 'pending',
      }).select().single();
      if (error) throw error;
```

with:

```ts
      // reservation_key derivee de la cle d'idempotence quand le navigateur en
      // envoie une (app manager) : le meme geste rejoue retrouve la prestation
      // deja creee (contrainte unique), jamais un doublon.
      const rand = Math.random().toString(36).substring(2, 10);
      const reservation_key = extraReservationKey(String(cleaning_date), body.idem, rand);
      const created = await insertExtraOnce(sb, {
        reservation_key, listing_id, cleaning_date,
        label: label || null,
        guest_name: guest_name || null,
        price_billed: price_billed ?? null,
        cleaner_price: cleaner_price ?? null,
        notes: notes || null,
        created_by,
        status: 'pending',
      });
      const data = created.row;
```

then replace:

```ts
      await addLog(sb, reservation_key, "extra_created", created_by, { listing_id, label, price_billed, assigned_cleaner_id });
      return jsonResp({ status: "success", extra: data });
```

with:

```ts
      if (!created.replay) await addLog(sb, reservation_key, "extra_created", created_by, { listing_id, label, price_billed, assigned_cleaner_id });
      return jsonResp({ status: "success", extra: data, replay: created.replay });
```

(The assignment upsert between the two blocks stays as is: it is an upsert on `(reservation_key, cleaner_id)`, so a replay is harmless and repairs an assignment a first attempt failed to write.)

In `updateExtraCleaning`, replace:

```ts
      if (listing_id !== undefined) upd.listing_id = listing_id;
      const { error } = await sb.from("extra_cleanings").update(upd).eq("id", id);
      if (error) throw error;
      return jsonResp({ status: "success" });
```

with:

```ts
      if (listing_id !== undefined) upd.listing_id = listing_id;
      const { error } = await sb.from("extra_cleanings").update(upd).eq("id", id);
      if (error) throw error;
      // Trace avec l'auteur de la session (spec manager, section 6).
      const { data: ecDone } = await sb.from("extra_cleanings").select("reservation_key").eq("id", id).maybeSingle();
      if (ecDone?.reservation_key) {
        await addLog(sb, ecDone.reservation_key, "extra_updated", sessionActor(await currentUser(sb, req), body.actor), upd);
      }
      return jsonResp({ status: "success" });
```

In `deleteExtraCleaning`, replace:

```ts
        await sb.from("cleaning_cancelled").delete().eq("reservation_key", key);
        await sb.from("checklist_progress").delete().eq("reservation_key", key);
      }
```

with:

```ts
        await sb.from("cleaning_cancelled").delete().eq("reservation_key", key);
        await sb.from("checklist_progress").delete().eq("reservation_key", key);
        await addLog(sb, key, "extra_deleted", sessionActor(await currentUser(sb, req), body.actor));
      }
```

- [ ] **Step 6: Type-check and count**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts && grep -c "sessionActor" index.ts && grep -n "created_by } = body\|reservation_key, author } = body\|created_by || null" index.ts`
Expected: check silent, count `11` (7 before this task + 4), last grep prints nothing.

- [ ] **Step 7: Full proxy suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: 0 failed.

- [ ] **Step 8: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add supabase/functions/hostaway-proxy/mgr_extra.ts supabase/functions/hostaway-proxy/mgr_extra_test.ts supabase/functions/hostaway-proxy/v3_fakedb.ts supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: auteur de session pour le linge et les menages en plus, creation d un extra idempotente (cle derivee du geste)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Planning rules (`mgr_planning_rules.ts`)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_planning_rules.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_planning_rules_test.ts`

**Interfaces:**
- Consumes: `plusDays(date, n)` from `v3.ts`; `byRoleThenName`, `eliteLogDeadlineMs`, `type Tone` from `mgr_rules.ts`.
- Produces (used by Tasks 3 and 4):
  - `LAUNDRY_FIELDS: readonly ["pillowcases","bed_sheets","duvet_covers","small_towels","face_towels","large_towels","bath_mats"]`, `type LaundryField`, `type LaundryRow = Record<LaundryField, number> & { total: number }`
  - `PLAN_MAX_WEEKS = 26`
  - `weekStart(day: string): string` (Monday), `weekDays(start: string): string[]` (7 days)
  - `parsePlanningStart(raw: string | null, today: string): { ok: true; start: string } | { ok: false; error: string }`
  - `hourOrNull(v: unknown): number | null`
  - `type PlanState = "done" | "in_progress" | "not_started"`
  - `planStatus(i: { date; today; nowMs; assigned: number; state: PlanState; cancelled: boolean; usuallyElite: boolean; nextBefore: boolean }): { tone: Tone; word: string }`
  - `personSlots(people: Array<{ id: number; name: string; role: string; active: boolean }>): Record<string, string>` (`"p1".."p4"` for cleaners, `"sub"` for subcontractors)
  - `laundryRow(r: Record<string, unknown>): LaundryRow`

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_planning_rules_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  hourOrNull, LAUNDRY_FIELDS, laundryRow, parsePlanningStart, personSlots, planStatus, weekDays, weekStart,
} from "./mgr_planning_rules.ts";

const TODAY = "2026-10-09";
const AT_11 = Date.parse("2026-10-09T07:00:00Z"); // vendredi 11:00 Dubai

Deno.test("semaine du lundi au dimanche", () => {
  assertEquals(weekStart("2026-10-09"), "2026-10-05");
  assertEquals(weekStart("2026-10-05"), "2026-10-05");
  assertEquals(weekStart("2026-10-11"), "2026-10-05");
  assertEquals(weekStart("2026-11-01"), "2026-10-26");
  assertEquals(weekDays("2026-09-28"), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);
});

Deno.test("start : absent = cette semaine, ramene au lundi, 26 semaines au plus", () => {
  assertEquals(parsePlanningStart(null, TODAY), { ok: true, start: "2026-10-05" });
  assertEquals(parsePlanningStart("", TODAY), { ok: true, start: "2026-10-05" });
  assertEquals(parsePlanningStart("2026-10-14", TODAY), { ok: true, start: "2026-10-12" });
  assertEquals(parsePlanningStart("2027-04-05", TODAY), { ok: true, start: "2027-04-05" });
  assertEquals(parsePlanningStart("2026-04-06", TODAY), { ok: true, start: "2026-04-06" });
  assertEquals(parsePlanningStart("2027-04-12", TODAY), { ok: false, error: "start must be within 26 weeks of today" });
  assertEquals(parsePlanningStart("2026-03-30", TODAY), { ok: false, error: "start must be within 26 weeks of today" });
  assertEquals(parsePlanningStart("x", TODAY), { ok: false, error: "start must be YYYY-MM-DD" });
  assertEquals(parsePlanningStart("2026-02-30", TODAY), { ok: false, error: "start must be YYYY-MM-DD" });
});

Deno.test("heure Hostaway : 0, vide ou hors plage = non renseignee", () => {
  assertEquals(hourOrNull(0), null);
  assertEquals(hourOrNull(null), null);
  assertEquals(hourOrNull(""), null);
  assertEquals(hourOrNull(24), null);
  assertEquals(hourOrNull(11), 11);
  assertEquals(hourOrNull("11"), 11);
  assertEquals(hourOrNull(11.5), 11);
});

Deno.test("statut d'un menage de la semaine", () => {
  const base = { date: TODAY, today: TODAY, nowMs: AT_11, assigned: 1, state: "not_started" as const, cancelled: false, usuallyElite: false, nextBefore: false };
  assertEquals(planStatus({ ...base, cancelled: true, assigned: 0 }), { tone: "idle", word: "Cancelled" });
  assertEquals(planStatus({ ...base, state: "done", nextBefore: true }), { tone: "ok", word: "Done" });
  assertEquals(planStatus({ ...base, nextBefore: true }), { tone: "bad", word: "Guest arrives first" });
  assertEquals(planStatus({ ...base, assigned: 0 }), { tone: "bad", word: "Unassigned" });
  assertEquals(planStatus({ ...base, assigned: 0, usuallyElite: true }), { tone: "warn", word: "Usually Elite · not logged yet" });
  assertEquals(planStatus({ ...base, assigned: 0, usuallyElite: true, date: "2026-10-11" }), { tone: "warn", word: "Usually Elite" });
  // Menage Elite du 07 : saisie attendue le 08 a 14:00, depassee le 09 a 11:00.
  assertEquals(planStatus({ ...base, assigned: 0, usuallyElite: true, date: "2026-10-07" }), { tone: "bad", word: "Unassigned" });
  assertEquals(planStatus({ ...base, state: "in_progress" }), { tone: "idle", word: "In progress" });
  assertEquals(planStatus({ ...base, date: "2026-10-08" }), { tone: "warn", word: "Not marked done" });
  assertEquals(planStatus(base), { tone: "idle", word: "Scheduled" });
  assertEquals(planStatus({ ...base, date: "2026-10-10" }), { tone: "idle", word: "Scheduled" });
});

Deno.test("couleurs : cleaners actifs par nom, puis inactifs, sous-traitant a part", () => {
  const P = (id: number, name: string, role: string, active = true) => ({ id, name, role, active });
  assertEquals(personSlots([
    P(10, "Pionah", "cleaner"), P(4, "Faiza", "cleaner"), P(12, "Elite Cleaning", "subcontractor"),
    P(3, "Old", "cleaner", false), P(8, "Walter", "manager"),
  ]), { "4": "p1", "10": "p2", "3": "p3", "12": "sub" });
  assertEquals(personSlots([
    P(1, "Amy", "cleaner"), P(2, "Bea", "cleaner"), P(3, "Cat", "cleaner"), P(4, "Dee", "cleaner"), P(5, "Eve", "cleaner"),
  ]), { "1": "p1", "2": "p2", "3": "p3", "4": "p4", "5": "p1" });
});

Deno.test("linge : sept champs, total, valeur absente = 0", () => {
  assertEquals([...LAUNDRY_FIELDS], ["pillowcases", "bed_sheets", "duvet_covers", "small_towels", "face_towels", "large_towels", "bath_mats"]);
  assertEquals(laundryRow({ pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: null, large_towels: "4", bath_mats: 2 }), {
    total: 18, pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 0, large_towels: 4, bath_mats: 2,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_planning_rules_test.ts`
Expected: FAIL (module `./mgr_planning_rules.ts` not found).

- [ ] **Step 3: Write the module**

`supabase/functions/hostaway-proxy/mgr_planning_rules.ts`:

```ts
// Regles pures de l'ecran Planning de /manager/ (spec 2026-10-09, sections 3, 4
// et 9.3). Aucune base, aucun reseau.
import { plusDays } from "./v3.ts";
import { byRoleThenName, eliteLogDeadlineMs, type Tone } from "./mgr_rules.ts";

// Champs quantites du linge : source unique, aussi lue par index.ts (saveLaundryCount).
export const LAUNDRY_FIELDS = [
  "pillowcases", "bed_sheets", "duvet_covers",
  "small_towels", "face_towels", "large_towels", "bath_mats",
] as const;
export type LaundryField = typeof LAUNDRY_FIELDS[number];
export type LaundryRow = Record<LaundryField, number> & { total: number };

// Fenetre de navigation : 26 semaines avant et apres la semaine en cours.
export const PLAN_MAX_WEEKS = 26;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export function weekStart(day: string): string {
  const dow = (new Date(day + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = lundi
  return plusDays(day, -dow);
}
export function weekDays(start: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => plusDays(start, i));
}

export function parsePlanningStart(
  raw: string | null, today: string,
): { ok: true; start: string } | { ok: false; error: string } {
  const thisWeek = weekStart(today);
  if (raw === null || raw === "") return { ok: true, start: thisWeek };
  const t = Date.parse(raw + "T00:00:00Z");
  if (!DAY_RE.test(raw) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: "start must be YYYY-MM-DD" };
  }
  const start = weekStart(raw);
  const weeks = Math.round((Date.parse(start + "T00:00:00Z") - Date.parse(thisWeek + "T00:00:00Z")) / (7 * DAY_MS));
  if (Math.abs(weeks) > PLAN_MAX_WEEKS) return { ok: false, error: "start must be within 26 weeks of today" };
  return { ok: true, start };
}

// Hostaway rend des heures entieres ; 0 (minuit) ou vide veut dire « non renseignee ».
export function hourOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 24 ? Math.floor(n) : null;
}

export type PlanState = "done" | "in_progress" | "not_started";

// Mot et ton d'un menage de la semaine. Ordre : annule, fait, arrivee avant le
// menage (report trop loin), personne (Elite habituel tant que sa saisie du
// lendemain 14:00 n'est pas passee), en cours, passe non fait, prevu.
export function planStatus(i: {
  date: string; today: string; nowMs: number; assigned: number; state: PlanState;
  cancelled: boolean; usuallyElite: boolean; nextBefore: boolean;
}): { tone: Tone; word: string } {
  if (i.cancelled) return { tone: "idle", word: "Cancelled" };
  if (i.state === "done") return { tone: "ok", word: "Done" };
  if (i.nextBefore) return { tone: "bad", word: "Guest arrives first" };
  if (!i.assigned) {
    if (i.usuallyElite && i.nowMs < eliteLogDeadlineMs(i.date)) {
      return { tone: "warn", word: i.date > i.today ? "Usually Elite" : "Usually Elite · not logged yet" };
    }
    return { tone: "bad", word: "Unassigned" };
  }
  if (i.state === "in_progress") return { tone: "idle", word: "In progress" };
  if (i.date < i.today) return { tone: "warn", word: "Not marked done" };
  return { tone: "idle", word: "Scheduled" };
}

// Une couleur par personne : cleaners actifs par nom (p1 a p4, en boucle), puis
// inactifs ; sous-traitant (Elite) sur sa couleur propre. Les autres roles n'en ont pas.
export function personSlots(
  people: Array<{ id: number; name: string; role: string; active: boolean }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const team = people.filter((p) => p.role === "cleaner" || p.role === "subcontractor")
    .sort((a, b) => Number(!a.active) - Number(!b.active) || byRoleThenName(a, b));
  let n = 0;
  for (const p of team) out[String(p.id)] = p.role === "subcontractor" ? "sub" : "p" + ((n++ % 4) + 1);
  return out;
}

export function laundryRow(r: Record<string, unknown>): LaundryRow {
  const out: Record<string, number> = { total: 0 };
  for (const f of LAUNDRY_FIELDS) {
    const raw = r?.[f];
    const n = raw === null || raw === undefined || raw === "" ? 0 : Number(raw);
    const v = Number.isFinite(n) ? n : 0;
    out[f] = v;
    out.total += v;
  }
  return out as LaundryRow;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok`, 6 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add supabase/functions/hostaway-proxy/mgr_planning_rules.ts supabase/functions/hostaway-proxy/mgr_planning_rules_test.ts
git commit -m "proxy: regles du Planning (semaine du lundi, statut d un menage, couleur par personne, linge)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The week read (`mgr_planning.ts`)

**Files:**
- Create: `supabase/functions/hostaway-proxy/mgr_planning.ts`
- Create: `supabase/functions/hostaway-proxy/mgr_planning_test.ts`
- Modify: `supabase/functions/hostaway-proxy/mgr_today.ts` (~line 75: export `monthsBack`)

**Interfaces:**
- Consumes: Task 2 exports; `byKeys`, `monthsBack`, `peopleMap`, `readAllRows`, `readOrThrow` from `mgr_today.ts`; `byRoleThenName`, `hhmm`, `MGR_USUALLY_ELITE_WINDOW_DAYS`, `reservationKey`, `splitListing`, `usuallyEliteListings` from `mgr_rules.ts`; `INSP_VALID_STATUSES` from `insp_rules.ts`; `plusDays` from `v3.ts`.
- Produces (Task 4 wires it, Tasks 5 to 9 render it):
  ```ts
  mgrPlanning(sb, o: { start: string; today: string; nowMs: number; me: SessionUser;
    loadCheckouts: (start: string, end: string) => Promise<{ reservations: CheckoutRow[]; cachedAt: string | null }> })
    : Promise<{ status: number; body: MgrPlanning | { error: string } }>
  type MgrPlanning = {
    start: string; end: string; today: string; generatedAt: string; bookingsAt: string;
    me: { id: number; name: string };
    days: Array<{ date: string; holiday: string | null; off: number[] }>;
    jobs: PlanJob[];
    people: Array<{ id: number; name: string; role: string; slot: string; assignable: boolean }>;
    leaves: Array<{ cleanerId: number; name: string; start: string; end: string }>;
    listings: Array<{ id: string; apt: string; bld: string }>;
    counts: { total: number; unassigned: number; done: number; cancelled: number };
  }
  type PlanJob = {
    key: string; kind: "checkout" | "extra"; listingId: string; apt: string; bld: string;
    date: string; postponedFrom: string | null; checkout: string | null; guest: string | null;
    next: { date: string; time: string | null; sameDay: boolean; before: boolean } | null;
    assigned: number[]; serviceType: string | null; state: "done" | "in_progress" | "not_started";
    cancelled: { reason: string; by: string } | null; laundry: LaundryRow | null;
    extra: { id: number; label: string; guestName: string | null; priceBilled: number | null;
             cleanerPrice: number | null; notes: string | null; cleaningDate: string } | null;
    tone: "ok" | "warn" | "bad" | "idle"; word: string;
  }
  ```
  `CheckoutRow` is one row of the existing `checkouts` payload (`buildCheckoutsPayload` in `index.ts`): `{ guest, listingId, checkOut, checkOutTime, status, nextGuest: { date, checkInTime } | null }`.

- [ ] **Step 1: Write the failing test**

`supabase/functions/hostaway-proxy/mgr_planning_test.ts`:

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { fakeDb } from "./v3_fakedb.ts";
import { mgrPlanning, type CheckoutRow, type MgrPlanning } from "./mgr_planning.ts";

const START = "2026-10-05";
const TODAY = "2026-10-09";
const AT_11 = Date.parse("2026-10-09T07:00:00Z"); // vendredi 11:00 Dubai
const ME = { cleaner_id: 8, name: "Walter", role: "manager", color: "" };
const C = (listingId: string, guest: string, checkOut: string, o: any = {}): CheckoutRow =>
  ({ listingId, guest, checkOut, checkOutTime: 11, status: "confirmed", nextGuest: null, ...o });

const CHECKOUTS: CheckoutRow[] = [
  C("L1", "Ann Lee", "2026-10-06", { checkOutTime: 12 }),                                     // fait, linge compte
  C("L2", "Bo Ray", TODAY, { nextGuest: { guest: "X", date: TODAY, checkInTime: 15 } }),       // personne, arrivee le jour meme
  C("L9", "Cy Doe", TODAY),                                                                    // Elite habituel, pas encore saisi
  C("L3", "Di Fox", "2026-10-08", { checkOutTime: 0 }),                                        // heure absente, passe non fait
  C("L4", "Ed Gu", "2026-10-07"),                                                              // annule
  C("L5", "Fa Ho", "2026-10-10", { nextGuest: { guest: "Y", date: "2026-10-10", checkInTime: 15 } }), // reporte au 11, apres l'arrivee
  C("L6", "Gi Io", "2026-10-11"),                                                              // reporte au 13 : hors semaine
  C("L7", "Ha Ju", "2026-10-04"),                                                              // reporte du 04 au 05 : entre dans la semaine
  C("L7", "", TODAY, { status: "inquiry" }),                                                   // pas une reservation
];

const seed = () => fakeDb({
  listing_config: [
    { listing_id: "L1", internal_name: "308 - Binghatti Lavender" }, { listing_id: "L2", internal_name: "103 - Damac Reva" },
    { listing_id: "L3", internal_name: "805 - Azizi Riviera 39" }, { listing_id: "L4", internal_name: "404 - Elysee 1" },
    { listing_id: "L5", internal_name: "505 - Tower E" }, { listing_id: "L6", internal_name: "606 - Tower F" },
    { listing_id: "L7", internal_name: "707 - Tower G" }, { listing_id: "L8", internal_name: "808 - Tower H" },
    { listing_id: "L9", internal_name: "909 - Bloom Height" },
  ],
  cleaners: [
    { id: 4, name: "Faiza", role: "cleaner", is_active: true },
    { id: 10, name: "Pionah", role: "cleaner", is_active: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", is_active: true },
    { id: 8, name: "Walter", role: "manager", is_active: true },
    { id: 3, name: "Old", role: "cleaner", is_active: false },
    { id: 11, name: "Medini CEO Agent", role: "system", is_active: true },
  ],
  cleaning_assignments: [
    { reservation_key: "2026-10-06_Ann Lee", cleaner_id: 4, service_type: "CHC" },
    { reservation_key: "2026-10-08_Di Fox", cleaner_id: 10, service_type: "CHC" },
    { reservation_key: "2026-10-07_Ed Gu", cleaner_id: 12, service_type: "CHC" },
    { reservation_key: "extra_2026-10-09_mabc", cleaner_id: 10, service_type: "CHC" },
    { reservation_key: "2026-10-10_Fa Ho", cleaner_id: 4 },
  ],
  menage_done: [{ reservation_key: "2026-10-06_Ann Lee", done: true }, { reservation_key: "2026-10-08_Di Fox", done: false }],
  cleaning_timer: [],
  cleaning_cancelled: [{ reservation_key: "2026-10-07_Ed Gu", reason: "Guest extended", cancelled_by: "Walter" }],
  cleaning_postponed: [
    { reservation_key: "2026-10-10_Fa Ho", original_date: "2026-10-10", new_date: "2026-10-11" },
    { reservation_key: "2026-10-11_Gi Io", original_date: "2026-10-11", new_date: "2026-10-13" },
    { reservation_key: "2026-10-04_Ha Ju", original_date: "2026-10-04", new_date: START },
    { reservation_key: "extra_2026-08-01_old", original_date: "2026-08-01", new_date: "2026-10-07" },
  ],
  laundry_counts: [{
    reservation_key: "2026-10-06_Ann Lee", pillowcases: 4, bed_sheets: 2, duvet_covers: 2,
    small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2,
  }],
  extra_cleanings: [
    { id: 31, reservation_key: "extra_2026-10-09_mabc", listing_id: "L8", cleaning_date: TODAY, label: "Deep clean",
      guest_name: "Owner", price_billed: 250, cleaner_price: 120, notes: "Bring the steamer", status: "pending" },
    { id: 32, reservation_key: "extra_2026-10-08_gone", listing_id: "L8", cleaning_date: "2026-10-08", label: "Other", status: "cancelled" },
    { id: 20, reservation_key: "extra_2026-08-01_old", listing_id: "L1", cleaning_date: "2026-08-01", label: "Mid-stay", status: "pending" },
  ],
  leave_requests: [
    { cleaner_id: 4, start_date: "2026-10-10", end_date: "2026-10-12", status: "approved", leave_type: "sick" },
    { cleaner_id: 10, start_date: "2026-10-06", end_date: "2026-10-06", status: "pending" },
    { cleaner_id: 10, start_date: "2026-09-01", end_date: "2026-09-03", status: "approved" },
  ],
  public_holidays: [{ holiday_date: "2026-10-11", name: "Test holiday" }, { holiday_date: "2026-12-02", name: "National Day" }],
  cleaning_accounting_cache: [{ month: "2026-09", payload_json: { rows: [
    { listing_id: "L9", cleaning_date: "2026-09-20" }, { listing_id: "L9", cleaning_date: "2026-09-25" },
  ] } }],
});

async function run(db = seed()) {
  const r = await mgrPlanning(db, {
    start: START, today: TODAY, nowMs: AT_11, me: ME,
    loadCheckouts: async () => ({ reservations: CHECKOUTS, cachedAt: null }),
  });
  assertEquals(r.status, 200);
  return r.body as MgrPlanning;
}
const byKey = (b: MgrPlanning, k: string) => b.jobs.find((j) => j.key === k)!;

Deno.test("mgr.planning : chaque menage une fois, au jour de sa date effective", async () => {
  const b = await run();
  assertEquals(b.jobs.map((j) => [j.date, j.key]), [
    ["2026-10-05", "2026-10-04_Ha Ju"],
    ["2026-10-06", "2026-10-06_Ann Lee"],
    ["2026-10-07", "2026-10-07_Ed Gu"],
    ["2026-10-07", "extra_2026-08-01_old"],
    ["2026-10-08", "2026-10-08_Di Fox"],
    ["2026-10-09", "2026-10-09_Bo Ray"],
    ["2026-10-09", "2026-10-09_Cy Doe"],
    ["2026-10-09", "extra_2026-10-09_mabc"],
    ["2026-10-11", "2026-10-10_Fa Ho"],
  ]);
  assertEquals([b.start, b.end, b.today], [START, "2026-10-11", TODAY]);
  assertEquals(b.me, { id: 8, name: "Walter" });
  assertEquals(b.counts, { total: 8, unassigned: 4, done: 1, cancelled: 1 });
});

Deno.test("mgr.planning : statuts, heures, reports, linge, extras", async () => {
  const b = await run();
  const ha = byKey(b, "2026-10-04_Ha Ju");
  assertEquals([ha.postponedFrom, ha.checkout, ha.tone, ha.word, ha.apt, ha.bld], ["2026-10-04", null, "bad", "Unassigned", "707", "Tower G"]);
  const ann = byKey(b, "2026-10-06_Ann Lee");
  assertEquals([ann.checkout, ann.state, ann.tone, ann.word, ann.assigned, ann.serviceType], ["12:00", "done", "ok", "Done", [4], "CHC"]);
  assertEquals(ann.laundry, { total: 22, pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2 });
  const ed = byKey(b, "2026-10-07_Ed Gu");
  assertEquals([ed.cancelled, ed.tone, ed.word], [{ reason: "Guest extended", by: "Walter" }, "idle", "Cancelled"]);
  const old = byKey(b, "extra_2026-08-01_old");
  assertEquals([old.kind, old.postponedFrom, old.extra?.cleaningDate, old.word], ["extra", "2026-08-01", "2026-08-01", "Unassigned"]);
  const di = byKey(b, "2026-10-08_Di Fox");
  assertEquals([di.checkout, di.state, di.tone, di.word], [null, "not_started", "warn", "Not marked done"]);
  const bo = byKey(b, "2026-10-09_Bo Ray");
  assertEquals([bo.guest, bo.next, bo.tone], ["Bo Ray", { date: TODAY, time: "15:00", sameDay: true, before: false }, "bad"]);
  assertEquals([byKey(b, "2026-10-09_Cy Doe").tone, byKey(b, "2026-10-09_Cy Doe").word], ["warn", "Usually Elite · not logged yet"]);
  const x = byKey(b, "extra_2026-10-09_mabc");
  assertEquals([x.kind, x.guest, x.next, x.assigned, x.tone, x.word], ["extra", null, null, [10], "idle", "Scheduled"]);
  assertEquals(x.extra, { id: 31, label: "Deep clean", guestName: "Owner", priceBilled: 250, cleanerPrice: 120, notes: "Bring the steamer", cleaningDate: TODAY });
  const fa = byKey(b, "2026-10-10_Fa Ho");
  assertEquals([fa.date, fa.postponedFrom, fa.serviceType, fa.tone, fa.word], ["2026-10-11", "2026-10-10", "CHC", "bad", "Guest arrives first"]);
  assertEquals(fa.next, { date: "2026-10-10", time: "15:00", sameDay: false, before: true });
});

Deno.test("mgr.planning : jours (conges approuves, jour ferie), personnes, conges, logements", async () => {
  const b = await run();
  assertEquals(b.days.map((d) => [d.date, d.holiday, d.off]), [
    ["2026-10-05", null, []], ["2026-10-06", null, []], ["2026-10-07", null, []], ["2026-10-08", null, []],
    ["2026-10-09", null, []], ["2026-10-10", null, [4]], ["2026-10-11", "Test holiday", [4]],
  ]);
  assertEquals(b.people, [
    { id: 4, name: "Faiza", role: "cleaner", slot: "p1", assignable: true },
    { id: 10, name: "Pionah", role: "cleaner", slot: "p2", assignable: true },
    { id: 12, name: "Elite Cleaning", role: "subcontractor", slot: "sub", assignable: true },
  ]);
  // Le type de conge (donnee sensible) ne sort jamais.
  assertEquals(b.leaves, [{ cleanerId: 4, name: "Faiza", start: "2026-10-10", end: "2026-10-12" }]);
  assertEquals(b.listings.length, 9);
  assertEquals(b.listings[0], { id: "L3", apt: "805", bld: "Azizi Riviera 39" });
});

Deno.test("mgr.planning : Hostaway indisponible, 503 avec message lisible", async () => {
  const r = await mgrPlanning(seed(), {
    start: START, today: TODAY, nowMs: AT_11, me: ME,
    loadCheckouts: async () => { throw new Error("Hostaway API error 502"); },
  });
  assertEquals(r.status, 503);
  assertEquals(r.body, { error: "Bookings are unavailable right now. Try again in a few minutes." });
});

Deno.test("mgr.planning : une table illisible leve (jamais une semaine calculee a moitie)", async () => {
  const db = seed();
  db.fail["cleaning_assignments.select"] = { message: "boom" };
  let err = "";
  try { await run(db); } catch (e) { err = (e as Error).message; }
  assertEquals(err, "[mgr] cleaning_assignments: boom");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none mgr_planning_test.ts`
Expected: FAIL (module `./mgr_planning.ts` not found).

- [ ] **Step 3: Export `monthsBack` from `mgr_today.ts`**

In `mgr_today.ts`, replace:

```ts
function monthsBack(day: string, days: number): string[] {
```

with:

```ts
// Mois (AAAA-MM) couverts par les `days` jours avant `day` : cle de cleaning_accounting_cache.
export function monthsBack(day: string, days: number): string[] {
```

- [ ] **Step 4: Write the module**

`supabase/functions/hostaway-proxy/mgr_planning.ts`:

```ts
// Action mgr.planning : la semaine de menages en un appel (spec 2026-10-09,
// sections 4, 6 et 9.3). Lecture seule : les gestes passent par les actions
// existantes (assignCleaner, setDone, setCancelled, setPostponed,
// saveLaundryCount, add/update/deleteExtraCleaning), aucune logique d'ecriture ici.
// Les departs viennent du meme chemin que l'ancien Planner (checkouts et son
// cache serveur), injecte par index.ts.
import type { SessionUser } from "./auth.ts";
import { plusDays } from "./v3.ts";
import { INSP_VALID_STATUSES } from "./insp_rules.ts";
import {
  byRoleThenName, hhmm, MGR_USUALLY_ELITE_WINDOW_DAYS, reservationKey, splitListing, usuallyEliteListings, type Tone,
} from "./mgr_rules.ts";
import { byKeys, monthsBack, peopleMap, readAllRows, readOrThrow } from "./mgr_today.ts";
import {
  hourOrNull, LAUNDRY_FIELDS, laundryRow, personSlots, planStatus, weekDays, type LaundryRow, type PlanState,
} from "./mgr_planning_rules.ts";

export type CheckoutRow = {
  guest?: string | null; listingId?: string | null; checkOut?: string | null; checkOutTime?: unknown;
  status?: string | null; nextGuest?: { date?: string | null; checkInTime?: unknown; [k: string]: unknown } | null;
};
export type PlanNext = { date: string; time: string | null; sameDay: boolean; before: boolean };
export type PlanExtra = {
  id: number; label: string; guestName: string | null; priceBilled: number | null;
  cleanerPrice: number | null; notes: string | null; cleaningDate: string;
};
export type PlanJob = {
  key: string; kind: "checkout" | "extra"; listingId: string; apt: string; bld: string;
  date: string; postponedFrom: string | null; checkout: string | null; guest: string | null;
  next: PlanNext | null; assigned: number[]; serviceType: string | null; state: PlanState;
  cancelled: { reason: string; by: string } | null; laundry: LaundryRow | null; extra: PlanExtra | null;
  tone: Tone; word: string;
};
export type MgrPlanning = {
  start: string; end: string; today: string; generatedAt: string; bookingsAt: string;
  me: { id: number; name: string };
  days: Array<{ date: string; holiday: string | null; off: number[] }>;
  jobs: PlanJob[];
  people: Array<{ id: number; name: string; role: string; slot: string; assignable: boolean }>;
  leaves: Array<{ cleanerId: number; name: string; start: string; end: string }>;
  listings: Array<{ id: string; apt: string; bld: string }>;
  counts: { total: number; unassigned: number; done: number; cancelled: number };
};

const EXTRA_COLS = "id, reservation_key, listing_id, cleaning_date, label, guest_name, price_billed, cleaner_price, notes, status";
const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const txt = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));
const TEAM = (role: string) => role === "cleaner" || role === "subcontractor";

export async function mgrPlanning(sb: any, o: {
  start: string; today: string; nowMs: number; me: SessionUser;
  loadCheckouts: (start: string, end: string) => Promise<{ reservations: CheckoutRow[]; cachedAt: string | null }>;
}): Promise<{ status: number; body: MgrPlanning | { error: string } }> {
  const days = weekDays(o.start);
  const end = days[6];
  let loaded: { reservations: CheckoutRow[]; cachedAt: string | null };
  try {
    loaded = await o.loadCheckouts(o.start, end);
  } catch (e) {
    console.error("[mgr.planning] checkouts failed:", e);
    return { status: 503, body: { error: "Bookings are unavailable right now. Try again in a few minutes." } };
  }
  const res = (loaded.reservations ?? []).filter((r) =>
    r && r.listingId && r.checkOut && INSP_VALID_STATUSES.includes(String(r.status ?? "")));

  // Extras : ceux dont la date tombe pres de la semaine, plus ceux reportes dans
  // la semaine depuis plus loin (leur date d'origine est hors de la premiere lecture).
  const extrasWin = await readAllRows((a: number, b: number) => sb.from("extra_cleanings").select(EXTRA_COLS)
    .gte("cleaning_date", plusDays(o.start, -31)).lte("cleaning_date", end).order("id").range(a, b), "extra_cleanings");
  const postIn = await readAllRows((a: number, b: number) => sb.from("cleaning_postponed")
    .select("reservation_key, original_date, new_date")
    .gte("new_date", o.start).lte("new_date", end).order("reservation_key").range(a, b), "cleaning_postponed");
  const known = new Set(extrasWin.map((e: any) => String(e.reservation_key)));
  const missing = postIn.map((p: any) => String(p.reservation_key)).filter((k: string) => k.startsWith("extra_") && !known.has(k));
  const extras = [...extrasWin, ...(missing.length ? await byKeys(sb, "extra_cleanings", EXTRA_COLS, missing) : [])]
    .filter((e: any) => e.reservation_key && e.status !== "cancelled");

  const keys = [...new Set([
    ...res.map((r) => reservationKey({ departure: String(r.checkOut), guest: String(r.guest ?? "") })),
    ...extras.map((e: any) => String(e.reservation_key)),
  ])];
  const all = (p: any, what: string) => p.then((r: any) => readOrThrow(r, what));
  const [post, asg, done, timers, canc, linen, listings, people, leaves, hols, acc] = await Promise.all([
    byKeys(sb, "cleaning_postponed", "reservation_key, original_date, new_date", keys),
    byKeys(sb, "cleaning_assignments", "reservation_key, cleaner_id, service_type", keys),
    byKeys(sb, "menage_done", "reservation_key, done", keys),
    byKeys(sb, "cleaning_timer", "reservation_key, started_at, finished_at", keys),
    byKeys(sb, "cleaning_cancelled", "reservation_key, reason, cancelled_by", keys),
    byKeys(sb, "laundry_counts", ["reservation_key", ...LAUNDRY_FIELDS].join(", "), keys),
    readAllRows((a: number, b: number) => sb.from("listing_config")
      .select("listing_id, internal_name, listing_name, apt_number").order("listing_id").range(a, b), "listing_config"),
    readAllRows((a: number, b: number) => sb.from("cleaners").select("id, name, role, is_active").order("id").range(a, b), "cleaners"),
    all(sb.from("leave_requests").select("cleaner_id, start_date, end_date")
      .eq("status", "approved").lte("start_date", end).gte("end_date", o.start), "leave_requests"),
    all(sb.from("public_holidays").select("holiday_date, name").gte("holiday_date", o.start).lte("holiday_date", end), "public_holidays"),
    all(sb.from("cleaning_accounting_cache").select("month, payload_json")
      .in("month", monthsBack(o.today, MGR_USUALLY_ELITE_WINDOW_DAYS)), "cleaning_accounting_cache"),
  ]);

  const postMap: Record<string, { from: string | null; to: string }> = {};
  for (const p of post) {
    if (p.new_date) postMap[String(p.reservation_key)] = { from: p.original_date ? String(p.original_date) : null, to: String(p.new_date) };
  }
  const asgMap: Record<string, Array<{ id: number; st: string }>> = {};
  for (const r of asg) (asgMap[String(r.reservation_key)] ??= []).push({ id: Number(r.cleaner_id), st: String(r.service_type || "CHC") });
  const doneSet = new Set(done.filter((r: any) => r.done === true).map((r: any) => String(r.reservation_key)));
  const startedSet = new Set(timers.filter((t: any) => t.started_at && !t.finished_at).map((t: any) => String(t.reservation_key)));
  const cancMap: Record<string, { reason: string; by: string }> = {};
  for (const c of canc) cancMap[String(c.reservation_key)] = { reason: String(c.reason ?? ""), by: String(c.cancelled_by ?? "") };
  const linenMap: Record<string, LaundryRow> = {};
  for (const l of linen) linenMap[String(l.reservation_key)] = laundryRow(l);
  const place: Record<string, { apt: string; bld: string }> = {};
  for (const l of listings) place[String(l.listing_id)] = splitListing(l);
  const ppl = peopleMap(people);
  const elite = usuallyEliteListings(
    acc.flatMap((r: any) => Array.isArray(r?.payload_json?.rows) ? r.payload_json.rows : []), o.today);

  const jobs: PlanJob[] = [];
  const seen = new Set<string>();
  const add = (
    key: string, kind: "checkout" | "extra", listingId: string, baseDate: string, hour: number | null,
    guest: string | null, nx: { date: string; hour: number | null } | null, extra: PlanExtra | null,
  ) => {
    if (seen.has(key)) return;
    const pm = postMap[key];
    const date = pm ? pm.to : baseDate;
    if (date < o.start || date > end) return;
    seen.add(key);
    const rows = asgMap[key] ?? [];
    const state: PlanState = doneSet.has(key) ? "done" : startedSet.has(key) ? "in_progress" : "not_started";
    const next = nx ? { date: nx.date, time: hhmm(nx.hour), sameDay: nx.date === date, before: nx.date < date } : null;
    const cancelled = cancMap[key] ?? null;
    const st = planStatus({
      date, today: o.today, nowMs: o.nowMs, assigned: rows.length, state,
      cancelled: !!cancelled, usuallyElite: elite.has(listingId), nextBefore: !!next?.before,
    });
    const l = place[listingId] ?? { apt: "", bld: "Listing " + listingId };
    jobs.push({
      key, kind, listingId, apt: l.apt, bld: l.bld, date,
      postponedFrom: pm ? (pm.from ?? baseDate) : null,
      checkout: pm ? null : hhmm(hour), guest, next,
      assigned: rows.map((r) => r.id), serviceType: rows[0]?.st ?? null, state, cancelled,
      laundry: linenMap[key] ?? null, extra, tone: st.tone, word: st.word,
    });
  };
  for (const r of res) {
    const key = reservationKey({ departure: String(r.checkOut), guest: String(r.guest ?? "") });
    const ng = r.nextGuest && r.nextGuest.date ? { date: String(r.nextGuest.date), hour: hourOrNull(r.nextGuest.checkInTime) } : null;
    add(key, "checkout", String(r.listingId), String(r.checkOut), hourOrNull(r.checkOutTime), txt(r.guest), ng, null);
  }
  for (const e of extras) {
    add(String(e.reservation_key), "extra", String(e.listing_id ?? ""), String(e.cleaning_date), null, null, null, {
      id: Number(e.id), label: String(e.label ?? "Extra cleaning"), guestName: txt(e.guest_name),
      priceBilled: num(e.price_billed), cleanerPrice: num(e.cleaner_price), notes: txt(e.notes), cleaningDate: String(e.cleaning_date),
    });
  }
  jobs.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.checkout ?? "99").localeCompare(b.checkout ?? "99") ||
    (a.apt + a.bld).localeCompare(b.apt + b.bld) || a.key.localeCompare(b.key));

  const used = new Set<number>(jobs.flatMap((j) => j.assigned));
  const slots = personSlots(Object.values(ppl));
  const peopleOut = Object.values(ppl)
    .filter((p) => (TEAM(p.role) && p.active) || used.has(p.id))
    .sort(byRoleThenName)
    .map((p) => ({ id: p.id, name: p.name, role: p.role, slot: slots[String(p.id)] ?? "other", assignable: TEAM(p.role) && p.active }));
  const leavesOut = leaves
    .filter((l: any) => ppl[String(l.cleaner_id)] && ppl[String(l.cleaner_id)].role !== "system")
    .map((l: any) => ({ cleanerId: Number(l.cleaner_id), name: ppl[String(l.cleaner_id)].name, start: String(l.start_date), end: String(l.end_date) }))
    .sort((a: any, b: any) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const live = jobs.filter((j) => !j.cancelled);
  const generatedAt = new Date(o.nowMs).toISOString();
  return {
    status: 200,
    body: {
      start: o.start, end, today: o.today, generatedAt, bookingsAt: loaded.cachedAt ?? generatedAt,
      me: { id: o.me.cleaner_id, name: o.me.name },
      days: days.map((date) => ({
        date,
        holiday: (hols.find((h: any) => String(h.holiday_date) === date)?.name as string | undefined) ?? null,
        off: [...new Set(leavesOut.filter((l: any) => l.start <= date && l.end >= date).map((l: any) => l.cleanerId as number))]
          .sort((a, b) => a - b),
      })),
      jobs, people: peopleOut, leaves: leavesOut,
      listings: Object.entries(place).map(([id, l]) => ({ id, apt: l.apt, bld: l.bld }))
        .sort((a, b) => a.bld.localeCompare(b.bld) || a.apt.localeCompare(b.apt, undefined, { numeric: true })),
      counts: {
        total: live.length,
        unassigned: live.filter((j) => !j.assigned.length && j.state !== "done").length,
        done: live.filter((j) => j.state === "done").length,
        cancelled: jobs.length - live.length,
      },
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: same command as Step 2.
Expected: `ok`, 5 passed, 0 failed.

- [ ] **Step 6: Full proxy suite (mgr_today still green after the export)**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: 0 failed.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add supabase/functions/hostaway-proxy/mgr_planning.ts supabase/functions/hostaway-proxy/mgr_planning_test.ts supabase/functions/hostaway-proxy/mgr_today.ts
git commit -m "proxy: lecture mgr.planning (semaine par date effective, reports, extras, linge, conges, jours feries, couleurs)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Route `mgr.planning`, one cached path for departures

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (imports, `buildCheckoutsPayload` ~line 212 to add `loadCheckoutsCached` after it, `LAUNDRY_FIELDS` ~line 399, `ROUTES` ~line 884, `checkouts` route ~line 1512, new route before `// ==================== INSPECTIONS`)

**Interfaces:**
- Consumes: `mgrPlanning` (Task 3), `parsePlanningStart`, `LAUNDRY_FIELDS` (Task 2), `mgrAccess`, `bearerToken`, `currentUser`, `todayDubai` (already imported).
- Produces: `GET ?action=mgr.planning[&start=YYYY-MM-DD]` answering `MgrPlanning` (200), 400 `{ error }` on a bad `start`, 401 / 403 per `mgrAccess`, 503 when Hostaway and the cache both fail. `loadCheckoutsCached(sb, startDate, endDate, fresh): Promise<any>` (the existing `checkouts` payload, with `cachedAt` when served from `proxy_cache`).

- [ ] **Step 1: Imports**

In `index.ts`, replace:

```ts
import { extraReservationKey, insertExtraOnce } from "./mgr_extra.ts";
```

with:

```ts
import { extraReservationKey, insertExtraOnce } from "./mgr_extra.ts";
import { LAUNDRY_FIELDS, parsePlanningStart } from "./mgr_planning_rules.ts";
import { mgrPlanning } from "./mgr_planning.ts";
```

- [ ] **Step 2: One list of linen fields**

Replace:

```ts
// ========== Linge : champs quantités ==========
const LAUNDRY_FIELDS = [
  "pillowcases", "bed_sheets", "duvet_covers",
  "small_towels", "face_towels", "large_towels", "bath_mats",
] as const;
```

with:

```ts
// ========== Linge : champs quantités ==========
// LAUNDRY_FIELDS vit dans mgr_planning_rules.ts (source unique, lue aussi par mgr.planning).
```

- [ ] **Step 3: Extract the cached read of departures**

Replace the body of the `checkouts` route:

```ts
      // Server-side stale-while-revalidate: the Hostaway pagination is the slow
      // path (~5-10s on month ranges). Serve a recent snapshot instantly and
      // revalidate in background; only fetch synchronously when too old.
      const cacheKey = "checkouts:" + startDate + "_" + endDate;
      if (url.searchParams.get("fresh") !== "1") {
        try {
          const { data: row } = await sb.from("proxy_cache").select("payload, updated_at").eq("key", cacheKey).maybeSingle();
          if (row && row.payload) {
            const age = Date.now() - new Date(row.updated_at).getTime();
            if (age < CHECKOUTS_STALE_MS) {
              if (age > CHECKOUTS_FRESH_MS) {
                const revalidate = buildCheckoutsPayload(sb, startDate, endDate)
                  .then((payload) => sb.from("proxy_cache").upsert({ key: cacheKey, payload, updated_at: new Date().toISOString() }))
                  .catch((e) => console.error("[hostaway-proxy] checkouts revalidate failed:", e));
                try { (globalThis as any).EdgeRuntime?.waitUntil?.(revalidate); } catch (_e) { /* best effort */ }
              }
              return jsonResp({ ...row.payload, cachedAt: row.updated_at });
            }
          }
        } catch (e) {
          console.error("[hostaway-proxy] proxy_cache read failed:", e);
        }
      }
      const payload = await buildCheckoutsPayload(sb, startDate, endDate);
      try {
        await sb.from("proxy_cache").upsert({ key: cacheKey, payload, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("[hostaway-proxy] proxy_cache write failed:", e);
      }
      return jsonResp(payload);
    }
```

with:

```ts
      return jsonResp(await loadCheckoutsCached(sb, startDate, endDate, url.searchParams.get("fresh") === "1"));
    }
```

and insert this function right before `async function loadInspReservations(`:

```ts
// Departs d'une plage avec le cache serveur au chaud (proxy_cache
// « checkouts:<start>_<end> »). Stale-while-revalidate : la pagination Hostaway
// est le chemin lent (~5-10 s sur un mois) ; un instantane recent est servi tout
// de suite et rafraichi en arriere-plan, Hostaway n'est appele en direct que si
// l'instantane a plus de 10 min. Partage par l'action checkouts (ancienne app) et
// mgr.planning (app manager) : une seule logique. setPostponed purge ces cles.
async function loadCheckoutsCached(sb: any, startDate: string, endDate: string, fresh: boolean): Promise<any> {
  const cacheKey = "checkouts:" + startDate + "_" + endDate;
  if (!fresh) {
    try {
      const { data: row } = await sb.from("proxy_cache").select("payload, updated_at").eq("key", cacheKey).maybeSingle();
      if (row && row.payload) {
        const age = Date.now() - new Date(row.updated_at).getTime();
        if (age < CHECKOUTS_STALE_MS) {
          if (age > CHECKOUTS_FRESH_MS) {
            const revalidate = buildCheckoutsPayload(sb, startDate, endDate)
              .then((payload) => sb.from("proxy_cache").upsert({ key: cacheKey, payload, updated_at: new Date().toISOString() }))
              .catch((e) => console.error("[hostaway-proxy] checkouts revalidate failed:", e));
            try { (globalThis as any).EdgeRuntime?.waitUntil?.(revalidate); } catch (_e) { /* best effort */ }
          }
          return { ...row.payload, cachedAt: row.updated_at };
        }
      }
    } catch (e) {
      console.error("[hostaway-proxy] proxy_cache read failed:", e);
    }
  }
  const payload = await buildCheckoutsPayload(sb, startDate, endDate);
  try {
    await sb.from("proxy_cache").upsert({ key: cacheKey, payload, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error("[hostaway-proxy] proxy_cache write failed:", e);
  }
  return payload;
}

```

- [ ] **Step 4: Register and route `mgr.planning`**

In `ROUTES`, replace:

```ts
  ["mgr.today", "GET"], ["mgr.problems", "GET"], ["mgr.problem.get", "GET"], ["mgr.problem.act", "POST"],
```

with:

```ts
  ["mgr.today", "GET"], ["mgr.problems", "GET"], ["mgr.problem.get", "GET"], ["mgr.problem.act", "POST"],
  ["mgr.planning", "GET"],
```

Then replace:

```ts
    // ==================== INSPECTIONS ====================
    // Recap du job Telegram
```

with:

```ts
    // Planning : la semaine de menages en un appel, lecture seule. Les gestes
    // passent par les actions existantes (assignCleaner, setDone, setCancelled,
    // setPostponed, saveLaundryCount, add/update/deleteExtraCleaning).
    if (action === "mgr.planning") {
      const me = await currentUser(sb, req);
      const acc = mgrAccess(bearerToken(req) !== null, me);
      if (!acc.ok) return jsonResp({ error: acc.error }, acc.status);
      const today = todayDubai();
      const ps = parsePlanningStart(url.searchParams.get("start"), today);
      if (!ps.ok) return jsonResp({ error: ps.error }, 400);
      const r = await mgrPlanning(sb, {
        start: ps.start, today, nowMs: Date.now(), me: me!,
        loadCheckouts: async (s, e) => {
          const p = await loadCheckoutsCached(sb, s, e, false);
          return { reservations: Array.isArray(p?.reservations) ? p.reservations : [], cachedAt: p?.cachedAt ?? null };
        },
      });
      return jsonResp(r.body, r.status);
    }

    // ==================== INSPECTIONS ====================
    // Recap du job Telegram
```

- [ ] **Step 5: Type-check, grep, full suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts && grep -c "loadCheckoutsCached" index.ts && grep -c "const LAUNDRY_FIELDS" index.ts; grep -n '"mgr.planning"' index.ts && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: check silent; `3` (definition, `checkouts` route, `mgr.planning` route); `0`; two lines (ROUTES and the route); tests 0 failed.

- [ ] **Step 6: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "proxy: route mgr.planning, lecture des departs en cache extraite (checkouts et Planning partagent loadCheckoutsCached), LAUNDRY_FIELDS en source unique

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Front: Planning screen, read only (week grid, day on phone, colours, leaves, holidays, cache)

**Files:**
- Create: `manager/gesture.js`
- Create: `manager/screens/planning-rules.js`
- Create: `manager/screens/planning-view.js`
- Create: `manager/screens/planning.js`
- Create: `manager/ui/planning.css`
- Modify: `manager/app.js` (`SCREENS`, ~line 14)
- Modify: `manager/index.html` (stylesheets)
- Modify: `manager/ui/dom.js` (`I`, chevrons)
- Modify: `manager/ui/tokens.css` (person colours)
- Create: `tests/manager/planning-fixtures.ts`
- Create: `tests/manager/planning.spec.ts`
- Modify: `tests/manager/shell.spec.ts` (`LINKS`)

**Interfaces:**
- Consumes: `get`, `post`, `newIdem` (`manager/api.js`); `saveCache`, `loadCache`, `clearCache` (`manager/today-cache.js`); `addDays`, `closeSheet`, `ddmm`, `dubaiTime`, `dubaiToday`, `esc`, `I`, `openSheet`, `placeLabel`, `sheetBusy`, `sheetError`, `sheetIsOpen`, `toast` (`manager/ui/dom.js`); `mgr.planning` (Task 4).
- Produces (Tasks 6 to 9 rely on these exact names):
  - `manager/gesture.js`: `uncertain(e): boolean`, `createGestures(): { run(sig: string, fn: (idem: string) => Promise<any>): Promise<any> }`.
  - `manager/screens/planning-rules.js`: `LAUNDRY_ITEMS`, `weekStartOf(day)`, `weekLabel(start)`, `dayShort(day)`, `dayLong(day)`, `defaultDay(start, today)`, `jobsOn(data, day)`, `personOf(data, id)`, `nameOf(data, id)`, `namesOf(data, ids)`, `slotOf(data, job)`, `filterJobs(jobs, filter)`, `initials(name)`, `laundryParse(values) -> { ok: true, values } | { ok: false, field, label }`, `nextLine(next)`, `laundryLine(row)`.
  - `manager/screens/planning-view.js`: `screenHtml(s)`, `jobSheet(d, j, ro, s)`, helpers `head`, `roFoot`, `B`, `CLOSE` exported for the sheets added later. Every sheet function has the signature `(d, j, ro, s)` and is looked up by the controller as `V[view + 'Sheet']`.
  - In `planning.js`, inside `renderPlanning`: `st` (state), `ACT` (map from a `data-pa` value to `(job, button) => void`), `hooks.resync` (called after a write re-enables the panel), `show(key, view)`, `write(key, action, body, okMsg, undo)`, `readOnly()`, `job(key)`, and the marker line `  // Gestes (taches 6 a 9) : ajoutes juste sous cette ligne.` under which Tasks 6 to 9 insert their code.
  - DOM contract used by tests: `.pl-col` (desktop day column) with `h2` "Mon 5"; `.pl-strip [data-day]` (phone); `.pl-day` (phone day); `.pj[data-job="<key>"]` with class `pc-<slot>`, `extra`, `cancelled`; `.pl-off` "Faiza off"; `.pl-hol`; `[data-filter]`; `[data-week="-1|0|1"]`; `[data-add-extra]`; sheet buttons `[data-pa]`.

- [ ] **Step 1: Write the fixtures and the failing tests**

`tests/manager/planning-fixtures.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import { fetchLog } from './helpers';

// Reponse mgr.planning au format de supabase/functions/hostaway-proxy/mgr_planning.ts.
export const WEEK = '2026-10-05';
export const PNOW = new Date('2026-10-09T07:00:00Z'); // vendredi 11:00 Dubai
export const IDEM = /^mgr-[A-Za-z0-9]{8,}$/;
export const OK = { status: 'success' };

export function daysOf(start: string) {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.map((date) => ({ date, holiday: null as string | null, off: [] as number[] }));
}

const J = (o: any) => ({
  kind: 'checkout', postponedFrom: null, checkout: '11:00', guest: 'Guest', next: null, assigned: [], serviceType: null,
  state: 'not_started', cancelled: null, laundry: null, extra: null, tone: 'idle', word: 'Scheduled', ...o,
});

export function planningBody(over: any = {}) {
  const days = daysOf(WEEK).map((d) => ({
    ...d,
    holiday: d.date === '2026-10-11' ? 'Test holiday' : null,
    off: d.date === '2026-10-10' || d.date === '2026-10-11' ? [4] : [],
  }));
  return {
    start: WEEK, end: '2026-10-11', today: '2026-10-09',
    generatedAt: '2026-10-09T07:00:00.000Z', bookingsAt: '2026-10-09T06:58:00.000Z',
    me: { id: 8, name: 'Walter' },
    days,
    jobs: [
      J({ key: '2026-10-06_Ann Lee', listingId: 'L1', apt: '308', bld: 'Binghatti Lavender', date: '2026-10-06', checkout: '12:00',
        guest: 'Ann Lee', assigned: [4], serviceType: 'CHC', state: 'done', tone: 'ok', word: 'Done',
        laundry: { pillowcases: 4, bed_sheets: 2, duvet_covers: 2, small_towels: 4, face_towels: 4, large_towels: 4, bath_mats: 2, total: 22 } }),
      J({ key: '2026-10-07_Ed Gu', listingId: 'L4', apt: '404', bld: 'Elysee 1', date: '2026-10-07', guest: 'Ed Gu',
        assigned: [12], serviceType: 'CHC', cancelled: { reason: 'Guest extended', by: 'Walter' }, word: 'Cancelled' }),
      J({ key: '2026-10-07_Gi Lo', listingId: 'L6', apt: '606', bld: 'Tower F', date: '2026-10-08', checkout: null, guest: 'Gi Lo',
        postponedFrom: '2026-10-07', assigned: [4], serviceType: 'CHC', tone: 'warn', word: 'Not marked done' }),
      J({ key: '2026-10-09_Bo Ray', listingId: 'L2', apt: '103', bld: 'Damac Reva', date: '2026-10-09', guest: 'Bo Ray',
        next: { date: '2026-10-09', time: '15:00', sameDay: true, before: false }, tone: 'bad', word: 'Unassigned' }),
      J({ key: '2026-10-09_Cy Doe', listingId: 'L9', apt: '909', bld: 'Bloom Height', date: '2026-10-09', guest: 'Cy Doe',
        tone: 'warn', word: 'Usually Elite · not logged yet' }),
      J({ key: '2026-10-09_Di Fox', listingId: 'L3', apt: '805', bld: 'Azizi Riviera 39', date: '2026-10-09', checkout: null, guest: 'Di Fox',
        next: { date: '2026-10-10', time: '16:00', sameDay: false, before: false }, assigned: [10], serviceType: 'CHC' }),
      J({ key: 'extra_2026-10-09_mabc', kind: 'extra', listingId: 'L8', apt: '808', bld: 'Tower H', date: '2026-10-09', checkout: null, guest: null,
        assigned: [10], serviceType: 'CHC',
        extra: { id: 31, label: 'Deep clean', guestName: 'Owner', priceBilled: 250, cleanerPrice: 120, notes: 'Bring the steamer', cleaningDate: '2026-10-09' } }),
      J({ key: '2026-10-10_Fa Ho', listingId: 'L5', apt: '505', bld: 'Tower E', date: '2026-10-10', guest: 'Fa Ho', assigned: [12], serviceType: 'CHC' }),
    ],
    people: [
      { id: 4, name: 'Faiza', role: 'cleaner', slot: 'p1', assignable: true },
      { id: 10, name: 'Pionah', role: 'cleaner', slot: 'p2', assignable: true },
      { id: 12, name: 'Elite Cleaning', role: 'subcontractor', slot: 'sub', assignable: true },
    ],
    leaves: [{ cleanerId: 4, name: 'Faiza', start: '2026-10-10', end: '2026-10-12' }],
    listings: [
      { id: 'L3', apt: '805', bld: 'Azizi Riviera 39' }, { id: 'L1', apt: '308', bld: 'Binghatti Lavender' },
      { id: 'L8', apt: '808', bld: 'Tower H' },
    ],
    counts: { total: 7, unassigned: 2, done: 1, cancelled: 1 },
    ...over,
  };
}

export const PLAN = (body: any = planningBody()) => ({ match: 'action=mgr.planning', status: 200, body });

export const isMobile = (info: any) => info.project.name === 'mgr-mobile';

// Ouvre la fiche d'un menage ; sur telephone, choisit d'abord son jour.
export async function openJob(page: Page, mobile: boolean, key: string, day: string) {
  if (mobile) await page.locator('.pl-strip [data-day="' + day + '"]').click();
  await page.locator('.pj[data-job="' + key + '"]').click();
  await expect(page.locator('#sheet')).toHaveAttribute('aria-hidden', 'false');
}

// Corps des ecritures envoyees pour une action (POST ?action=<action>).
export async function writes(page: Page, action: string) {
  return (await fetchLog(page)).filter((l) => l.url.endsWith('action=' + action)).map((l) => JSON.parse(l.body));
}
export const noIdem = (rows: any[]) => rows.map(({ idem, ...b }) => b);
```

`tests/manager/planning.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me, noHorizontalScroll } from './helpers';
import { daysOf, isMobile, openJob, PLAN, planningBody, PNOW } from './planning-fixtures';

const HASH = '#/planning';

test('premier appel : semaine du lundi, en-tete de la semaine', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await expect(page.locator('main h1')).toHaveText('Planning');
  await expect(page.locator('main .top .date')).toHaveText('5 to 11 Oct 2026');
  await expect(page.locator('.pj').first()).toBeVisible();
  const urls = (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).map((l) => l.url);
  expect(urls.length).toBe(1);
  expect(urls[0]).toContain('start=2026-10-05');
});

test('ordinateur : 7 colonnes, une couleur par personne, conges et jour ferie', async ({ page }, info) => {
  test.skip(isMobile(info), 'grille : ordinateur');
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  const cols = page.locator('.pl-col');
  await expect(cols).toHaveCount(7);
  await expect(page.locator('.pl-col h2')).toHaveText(['Mon 5', 'Tue 6', 'Wed 7', 'Thu 8', 'Fri 9', 'Sat 10', 'Sun 11']);
  await expect(cols.nth(4).locator('.pj')).toHaveCount(4);
  await expect(cols.nth(4).locator('.pl-dh .meta')).toContainText('4 cleanings');
  await expect(cols.nth(4).locator('.pl-dh .meta')).toContainText('2 unassigned');
  await expect(page.locator('.pj[data-job="2026-10-06_Ann Lee"]')).toHaveClass(/pc-p1/);
  await expect(page.locator('.pj[data-job="2026-10-06_Ann Lee"]')).toContainText('Linen 22');
  await expect(page.locator('.pj[data-job="2026-10-09_Di Fox"]')).toHaveClass(/pc-p2/);
  await expect(page.locator('.pj[data-job="2026-10-10_Fa Ho"]')).toHaveClass(/pc-sub/);
  const bo = page.locator('.pj[data-job="2026-10-09_Bo Ray"]');
  await expect(bo).toHaveClass(/pc-none/);
  await expect(bo).toContainText('Unassigned');
  await expect(bo).toContainText('Check-in 15:00');
  await expect(page.locator('.pj[data-job="extra_2026-10-09_mabc"]')).toHaveClass(/extra/);
  await expect(page.locator('.pj[data-job="extra_2026-10-09_mabc"]')).toContainText('Extra');
  await expect(page.locator('.pj[data-job="2026-10-07_Ed Gu"]')).toHaveClass(/cancelled/);
  await expect(page.locator('.pj[data-job="2026-10-07_Gi Lo"]')).toContainText('From 07/10');
  await expect(cols.nth(5).locator('.pl-off')).toHaveText('Faiza off');
  await expect(cols.nth(6).locator('.pl-hol')).toHaveText('Test holiday');
});

test('telephone : un jour a la fois, aujourd hui par defaut', async ({ page }, info) => {
  test.skip(!isMobile(info), 'jour : telephone');
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await expect(page.locator('.pl-strip button')).toHaveCount(7);
  await expect(page.locator('.pl-strip [data-day="2026-10-09"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pl-day .pj')).toHaveCount(4);
  await expect(page.locator('.pl-grid')).toHaveCount(0);
  await page.locator('.pl-strip [data-day="2026-10-10"]').click();
  await expect(page.locator('.pl-day .pj')).toHaveCount(1);
  await expect(page.locator('.pl-day .pj')).toContainText('Apt 505');
  await expect(page.locator('.pl-day .pl-off')).toHaveText('Faiza off');
});

test('filtre par personne : Pionah, Unassigned, puis Everyone', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await page.locator('[data-filter="10"]').click();
  await expect(page.locator('[data-filter="10"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pj')).toHaveCount(2);
  await page.locator('[data-filter="none"]').click();
  await expect(page.locator('.pj')).toHaveCount(2);
  await expect(page.locator('.pj').nth(0)).toContainText('Apt 103');
  await expect(page.locator('.pj').nth(1)).toContainText('Apt 909');
  await page.locator('[data-filter="all"]').click();
  await expect(page.locator('.pj')).toHaveCount(isMobile(info) ? 4 : 8);
});

test('semaine suivante puis This week', async ({ page }) => {
  const next = planningBody({ start: '2026-10-12', end: '2026-10-18', days: daysOf('2026-10-12'), jobs: [], counts: { total: 0, unassigned: 0, done: 0, cancelled: 0 } });
  await bootMgr(page, [me(MANAGER), { match: 'start=2026-10-12', status: 200, body: next }, PLAN()], { email: true, hash: HASH, clock: PNOW });
  await expect(page.locator('.pj').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.locator('main .top .date')).toHaveText('12 to 18 Oct 2026');
  await expect(page.locator('main .empty').first()).toHaveText('No cleaning');
  await page.getByRole('button', { name: 'This week' }).click();
  await expect(page.locator('main .top .date')).toHaveText('5 to 11 Oct 2026');
  await expect(page.locator('.pj').first()).toBeVisible();
  const urls = (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).map((l) => l.url);
  expect(urls.map((u) => u.split('start=')[1])).toEqual(['2026-10-05', '2026-10-12', '2026-10-05']);
});

test('fiche d un menage : extra, linge compte, statut', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  const sh = page.locator('#sheet');
  await expect(sh.locator('h2')).toHaveText('Apt 808 · Tower H');
  for (const t of ['Extra cleaning · Fri 9', 'Deep clean', 'Owner', '250 AED', '120 AED', 'Bring the steamer', 'Pionah', 'Not counted']) {
    await expect(sh).toContainText(t);
  }
  await page.keyboard.press('Escape');
  await expect(sh).toHaveAttribute('aria-hidden', 'true');
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  await expect(sh.locator('.statusbox')).toContainText('Done');
  await expect(sh).toContainText('Pillowcases 4');
  await expect(sh).toContainText('Total 22.');
  await expect(sh).toContainText('Tuesday 6 October, checkout 12:00');
});

test('hors ligne : semaine en cache, Data from, lecture seule', async ({ page }, info) => {
  const cache = { v: 1, savedAt: PNOW.getTime() - 3600_000, owner: 'u-test', data: planningBody() };
  await bootMgr(page, [me(MANAGER), { match: 'action=mgr.planning', status: 0, body: {}, fail: true }],
    { email: true, hash: HASH, clock: PNOW, storage: { mgrPlanningCache: JSON.stringify(cache) } });
  await expect(page.locator('main .banner')).toContainText('Data from 10:00');
  await expect(page.locator('main .banner')).toContainText('No connection. Try again.');
  await expect(page.getByRole('button', { name: 'Add extra' })).toHaveCount(0);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  await expect(page.locator('#sheet .ro-note')).toHaveText('Reconnect to make changes.');
  await expect(page.locator('#sheet [data-pa]')).toHaveCount(0);
});

test('proxy lent : message clair et Retry', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), { ...PLAN(), delay: 2000 }], { email: true, hash: HASH, timeoutMs: 300 });
  await expect(page.locator('main .err-card')).toContainText('HK Planner is taking too long to answer. Try again.');
  await expect(page.locator('main h1')).toHaveText('Planning');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });
    test('Planning : aucun defilement horizontal (' + scheme + ')', async ({ page }) => {
      await bootMgr(page, [me(MANAGER), PLAN()], { email: true, hash: HASH, clock: PNOW });
      await expect(page.locator('.pj').first()).toBeVisible();
      const s = await noHorizontalScroll(page);
      expect(s.scrollWidth).toBeLessThanOrEqual(s.clientWidth);
    });
  });
}
```

In `tests/manager/shell.spec.ts`, replace:

```ts
const LINKS: Array<[string, string, string]> = [
  ['planning', 'Planning', '/?legacy=1'],
  ['inspections', 'Inspections', '/inspections/'],
```

with:

```ts
// Planning est livre (phase 3) : il n'est plus un ecran provisoire.
const LINKS: Array<[string, string, string]> = [
  ['inspections', 'Inspections', '/inspections/'],
```

- [ ] **Step 2: Run tests to verify they fail**

Run (port check first, see Global Constraints): `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager/planning.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (the Planning route still shows the placeholder: no `.pj`, no `.top .date`).

- [ ] **Step 3: Tokens, icons, gesture helper, rules**

In `manager/ui/tokens.css`, replace:

```css
  --sidebar:232px;
  color-scheme:light;
```

with:

```css
  --sidebar:232px;
  /* Une couleur par personne au Planning (cleaners p1 a p4, sous-traitant). */
  --pc-1:#7a5af8; --pc-2:#dd2590; --pc-3:#0e9384; --pc-4:#6172f3; --pc-sub:#0086c9;
  color-scheme:light;
```

replace (inside the `@media (prefers-color-scheme: dark)` block, 4-space indent):

```css
    --focus:#4ea8ff; color-scheme:dark;
  }
```

with:

```css
    --focus:#4ea8ff; color-scheme:dark;
    --pc-1:#9b8afb; --pc-2:#f670c7; --pc-3:#2ed3b7; --pc-4:#8098f9; --pc-sub:#36bffa;
  }
```

and replace (inside `:root[data-theme="dark"]`, 2-space indent):

```css
  --focus:#4ea8ff; color-scheme:dark;
}
```

with:

```css
  --focus:#4ea8ff; color-scheme:dark;
  --pc-1:#9b8afb; --pc-2:#f670c7; --pc-3:#2ed3b7; --pc-4:#8098f9; --pc-sub:#36bffa;
}
```

In `manager/ui/dom.js`, replace:

```js
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
```

with:

```js
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
```

`manager/gesture.js`:

```js
// Cle d'idempotence par geste (meme convention que problem-panel.js) : une cle
// neuve par geste de l'utilisateur, reprise telle quelle quand le meme geste est
// rejoue apres un echec a l'issue inconnue (delai depasse, reseau coupe, ou cle
// encore en cours cote serveur). Le serveur ne voit alors qu'un seul geste.
import { newIdem } from '/manager/api.js';

const STILL = 'Still processing. Retry.';

export function uncertain(e) {
  return !!e && (e.kind === 'timeout' || e.kind === 'offline' || (e.status === 409 && e.message === STILL));
}

export function createGestures() {
  let pending = null;
  return {
    // sig : signature du geste (action et corps). fn recoit la cle a envoyer.
    async run(sig, fn) {
      const idem = pending && pending.sig === sig ? pending.idem : newIdem();
      try {
        const r = await fn(idem);
        pending = null;
        return r;
      } catch (e) {
        pending = uncertain(e) ? { sig, idem } : null;
        throw e;
      }
    },
  };
}
```

`manager/screens/planning-rules.js`:

```js
// Regles d'affichage du Planning : pures, sans DOM ni reseau. Les statuts et les
// couleurs viennent du proxy (mgr.planning) ; ici seulement dates, noms, filtres
// et lecture du formulaire de linge.
import { addDays } from '/manager/ui/dom.js';

// Memes libelles que la fiche linge de l'ancienne app (colonnes de laundry_counts).
export const LAUNDRY_ITEMS = [
  { key: 'pillowcases', label: 'Pillowcases' },
  { key: 'bed_sheets', label: 'Bed sheets (queen and twin)' },
  { key: 'duvet_covers', label: 'Duvet covers (queen and twin)' },
  { key: 'small_towels', label: 'Hand towels' },
  { key: 'face_towels', label: 'Face towels (square)' },
  { key: 'large_towels', label: 'Bath towels' },
  { key: 'bath_mats', label: 'Bath mats' },
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const utc = (day) => new Date(day + 'T00:00:00Z');

export function weekStartOf(day) { return addDays(day, -((utc(day).getUTCDay() + 6) % 7)); }
export function dayShort(day) { const d = utc(day); return DAY_NAMES[d.getUTCDay()] + ' ' + d.getUTCDate(); }
export function dayLong(day) { const d = utc(day); return DAY_LONG[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS_LONG[d.getUTCMonth()]; }
// « 5 to 11 Oct 2026 », « 28 Sep to 4 Oct 2026 ».
export function weekLabel(start) {
  const a = utc(start), b = utc(addDays(start, 6));
  const left = a.getUTCMonth() === b.getUTCMonth() ? String(a.getUTCDate()) : a.getUTCDate() + ' ' + MONTHS[a.getUTCMonth()];
  return left + ' to ' + b.getUTCDate() + ' ' + MONTHS[b.getUTCMonth()] + ' ' + b.getUTCFullYear();
}
export function defaultDay(start, today) { return today >= start && today <= addDays(start, 6) ? today : start; }

export function jobsOn(data, day) { return data.jobs.filter((j) => j.date === day); }
export function personOf(data, id) { return data.people.find((p) => p.id === Number(id)) || null; }
export function nameOf(data, id) { const p = personOf(data, id); return p ? p.name : 'Member ' + id; }
export function namesOf(data, ids) {
  const n = (ids || []).map((id) => nameOf(data, id));
  return n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1];
}
// Couleur d'une carte : celle de la premiere personne assignee ; rouge si personne.
export function slotOf(data, job) {
  if (!job.assigned.length) return 'none';
  const p = personOf(data, job.assigned[0]);
  return p ? p.slot : 'other';
}
// filtre : null ou 'all' = tout ; 'none' = sans personne (hors annules) ; sinon l'id d'une personne.
export function filterJobs(jobs, filter) {
  if (filter == null || filter === 'all') return jobs;
  if (filter === 'none') return jobs.filter((j) => !j.cancelled && !j.assigned.length);
  return jobs.filter((j) => j.assigned.includes(Number(filter)));
}
export function initials(n) {
  return String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

// Sept champs obligatoires : un champ vide n'est pas un zero (meme regle que l'ancienne fiche).
export function laundryParse(values) {
  const out = {};
  for (const it of LAUNDRY_ITEMS) {
    const raw = values ? values[it.key] : undefined;
    if (raw === null || raw === undefined || String(raw).trim() === '') return { ok: false, field: it.key, label: it.label };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 999) return { ok: false, field: it.key, label: it.label };
    out[it.key] = n;
  }
  return { ok: true, values: out };
}

export function nextLine(n) {
  const at = n.time ? ' at ' + n.time : ', time not set';
  if (n.before) return 'Checks in ' + dayShort(n.date) + at + ', before this cleaning';
  if (n.sameDay) return 'Same-day check-in' + at;
  return 'Checks in ' + dayShort(n.date) + at;
}
export function laundryLine(l) {
  const parts = LAUNDRY_ITEMS.filter((it) => Number(l[it.key]) > 0).map((it) => it.label + ' ' + l[it.key]);
  return parts.length ? parts.join(', ') + '. Total ' + l.total + '.' : 'Counted, nothing collected.';
}
```

- [ ] **Step 4: Views (screen and cleaning panel)**

`manager/screens/planning-view.js`:

```js
// Ecran Planning : HTML pur construit a partir de la reponse mgr.planning. Aucun
// appel reseau, aucun calcul de statut : le proxy les rend faits. Chaque panneau
// a la signature (d, j, ro, s) et s'appelle <vue>Sheet (planning.js les trouve
// par leur nom).
import { addDays, ddmm, dubaiTime, esc, I, placeLabel } from '/manager/ui/dom.js';
import {
  dayLong, dayShort, filterJobs, initials, jobsOn, LAUNDRY_ITEMS, laundryLine, namesOf, nextLine, slotOf, weekLabel,
} from '/manager/screens/planning-rules.js';

export const RO_LINE = 'Reconnect to make changes.';
export const CLOSE = '<button class="btn" type="button" data-close>Close</button>';
export function B(pa, label, cls) {
  return '<button class="btn' + (cls ? ' ' + cls : '') + '" type="button" data-pa="' + esc(pa) + '">' + esc(label) + '</button>';
}
export function head(title, sub) {
  return '<div class="sheet-h"><div><h2 id="sheetTitle">' + esc(title) + '</h2><div class="sub">' + esc(sub) + '</div></div>'
    + '<button class="iconbtn x" type="button" data-close aria-label="Close">' + I.close + '</button></div>';
}
export function roFoot() {
  return '<div class="sheet-f"><p class="ro-note" role="status">' + RO_LINE + '</p>' + CLOSE + '</div>';
}

function header(s) {
  const asof = s.data ? '<div class="asof' + (s.stale ? ' stale' : '') + '">Data as of ' + esc(dubaiTime(s.data.generatedAt)) + '</div>' : '';
  const add = s.data && !s.ro ? '<button class="btn sm primary" type="button" data-add-extra>Add extra</button>' : '';
  return '<header class="top pl-top"><div><h1>Planning</h1><div class="date">' + esc(weekLabel(s.start)) + '</div>' + asof + '</div>'
    + '<div class="pl-tools"><div class="pl-nav" role="group" aria-label="Week">'
    + '<button class="iconbtn" type="button" data-week="-1" aria-label="Previous week" title="Previous week">' + I.prev + '</button>'
    + '<button class="btn sm" type="button" data-week="0">This week</button>'
    + '<button class="iconbtn" type="button" data-week="1" aria-label="Next week" title="Next week">' + I.next + '</button></div>'
    + add
    + '<button class="iconbtn" type="button" data-theme-toggle aria-label="Switch light or dark theme" title="Theme">' + I.theme + '</button></div></header>';
}

function legend(s) {
  const d = s.data;
  const count = {};
  let none = 0;
  for (const j of d.jobs) {
    if (j.cancelled) continue;
    if (!j.assigned.length) none++;
    for (const id of j.assigned) count[id] = (count[id] || 0) + 1;
  }
  const cur = s.filter == null ? 'all' : String(s.filter);
  const chip = (val, label, n, slot) => '<button type="button" class="chip pchip" data-filter="' + esc(val) + '" aria-pressed="' + (cur === String(val) ? 'true' : 'false') + '">'
    + (slot ? '<i class="dot pc-' + esc(slot) + '" aria-hidden="true"></i>' : '') + esc(label) + ' <span class="n">' + n + '</span></button>';
  const people = d.people.filter((p) => p.assignable || count[p.id]);
  return '<div class="chiprow pl-legend" role="group" aria-label="Filter by person">'
    + chip('all', 'Everyone', d.counts.total, '')
    + people.map((p) => chip(p.id, p.name, count[p.id] || 0, p.slot)).join('')
    + chip('none', 'Unassigned', none, 'none') + '</div>';
}

function timeText(j) {
  if (j.kind === 'extra') return 'Extra';
  if (j.postponedFrom) return 'From ' + ddmm(j.postponedFrom);
  return j.checkout || 'Time not set';
}

function card(d, j) {
  const who = j.assigned.length ? namesOf(d, j.assigned) : 'Unassigned';
  const pill = j.tone === 'idle' && j.word === 'Scheduled' ? '' : '<span class="pill sm ' + esc(j.tone) + '">' + esc(j.word) + '</span>';
  const tags = [];
  if (j.next && j.next.sameDay && !j.cancelled) tags.push('Check-in ' + (j.next.time || 'today'));
  if (j.laundry) tags.push('Linen ' + j.laundry.total);
  return '<button type="button" class="pj pc-' + esc(slotOf(d, j)) + (j.kind === 'extra' ? ' extra' : '') + (j.cancelled ? ' cancelled' : '') + '" data-job="' + esc(j.key) + '">'
    + '<span class="pj-top"><span class="mono">' + esc(timeText(j)) + '</span>' + pill + '</span>'
    + '<span class="pj-place">' + esc(placeLabel(j) || 'Apartment') + '</span>'
    + '<span class="pj-who">' + esc(who) + '</span>'
    + (tags.length ? '<span class="pj-tags">' + tags.map((t) => '<span>' + esc(t) + '</span>').join('') + '</span>' : '')
    + '</button>';
}

function dayHead(d, day, today) {
  const jobs = jobsOn(d, day.date).filter((j) => !j.cancelled);
  const un = jobs.filter((j) => !j.assigned.length && j.state !== 'done').length;
  return '<div class="pl-dh' + (day.date === today ? ' today' : '') + '"><h2>' + esc(dayShort(day.date)) + '</h2>'
    + '<div class="meta">' + jobs.length + ' cleaning' + (jobs.length === 1 ? '' : 's')
    + (un ? ' · <span class="st bad">' + un + ' unassigned</span>' : '') + '</div>'
    + (day.holiday ? '<div class="pl-hol">' + esc(day.holiday) + '</div>' : '')
    + (day.off.length ? '<div class="pl-off">' + esc(namesOf(d, day.off)) + ' off</div>' : '') + '</div>';
}

function cards(d, list) {
  return '<div class="pl-cards">' + (list.length ? list.map((j) => card(d, j)).join('') : '<p class="empty">No cleaning</p>') + '</div>';
}

function grid(s) {
  const d = s.data;
  return '<div class="pl-grid">' + d.days.map((day) =>
    '<section class="pl-col" aria-label="' + esc(dayLong(day.date)) + '">' + dayHead(d, day, s.today)
    + cards(d, filterJobs(jobsOn(d, day.date), s.filter)) + '</section>').join('') + '</div>';
}

function dayView(s) {
  const d = s.data;
  const strip = '<div class="pl-strip" role="group" aria-label="Day">' + d.days.map((day) => {
    const n = jobsOn(d, day.date).filter((j) => !j.cancelled).length;
    return '<button type="button" data-day="' + esc(day.date) + '" aria-pressed="' + (day.date === s.day ? 'true' : 'false') + '"'
      + (day.date === s.today ? ' class="today"' : '') + ' aria-label="' + esc(dayLong(day.date)) + ', ' + n + ' cleanings">'
      + '<span>' + esc(dayShort(day.date).split(' ')[0]) + '</span><b>' + Number(day.date.slice(8)) + '</b><small>' + n + '</small></button>';
  }).join('') + '</div>';
  const day = d.days.find((x) => x.date === s.day) || d.days[0];
  return strip + '<section class="pl-day" aria-label="' + esc(dayLong(day.date)) + '">' + dayHead(d, day, s.today)
    + cards(d, filterJobs(jobsOn(d, day.date), s.filter)) + '</section>';
}

// s : { data, start, today, day, wide, filter, loading, error, banner, stale, ro }
export function screenHtml(s) {
  if (!s.data) {
    if (s.loading) return header(s) + '<p class="boot" role="status">Loading the week…</p>';
    return header(s) + '<div class="err-card" role="alert"><p>' + esc(s.error ? s.error.message : 'Could not load.')
      + '</p><button class="btn primary" type="button" data-retry>Retry</button></div>';
  }
  return header(s) + (s.banner || '') + legend(s) + (s.wide ? grid(s) : dayView(s));
}

// Fiche d'un menage : statut, faits, gestes (branches par planning.js, taches 6 a 9).
export function jobSheet(d, j, ro) {
  const rows = [];
  const kv = (k, v) => rows.push('<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>');
  const time = j.kind === 'checkout' && !j.postponedFrom ? (j.checkout ? ', checkout ' + j.checkout : ', checkout time not set') : '';
  kv('When', esc(dayLong(j.date) + time));
  if (j.postponedFrom) kv('Postponed', 'from ' + esc(dayLong(j.postponedFrom)));
  kv('Assigned', j.assigned.length ? esc(namesOf(d, j.assigned)) : '<span class="st bad">Nobody</span>');
  const day = d.days.find((x) => x.date === j.date);
  const away = day ? j.assigned.filter((id) => day.off.includes(id)) : [];
  if (away.length) kv('Leave', '<span class="st warn">' + esc(namesOf(d, away)) + ' on leave this day</span>');
  if (j.next) kv('Next guest', esc(nextLine(j.next)));
  if (j.guest) kv('Guest leaving', esc(j.guest));
  if (j.cancelled) kv('Cancelled', esc((j.cancelled.reason || 'No reason given') + (j.cancelled.by ? ' · by ' + j.cancelled.by : '')));
  if (j.extra) {
    kv('Extra', esc(j.extra.label || 'Extra cleaning'));
    if (j.extra.guestName) kv('Guest or client', esc(j.extra.guestName));
    if (j.extra.priceBilled != null) kv('Price billed', esc(j.extra.priceBilled + ' AED'));
    if (j.extra.cleanerPrice != null) kv('Cleaner rate', esc(j.extra.cleanerPrice + ' AED'));
    if (j.extra.notes) kv('Notes', esc(j.extra.notes));
  }
  kv('Linen', j.laundry ? esc(laundryLine(j.laundry)) : 'Not counted');
  const status = '<div class="statusbox ' + esc(j.tone) + '"><span class="bar ' + esc(j.tone) + '"></span><div><span class="st ' + esc(j.tone) + '">' + esc(j.word) + '</span></div></div>';
  let foot;
  if (ro) foot = roFoot();
  else if (j.cancelled) foot = '<div class="sheet-f">' + B('restore', 'Restore cleaning', 'primary') + CLOSE + '</div>';
  else {
    const done = j.state === 'done';
    foot = '<div class="sheet-f">'
      + (done ? '' : B('assign', j.assigned.length ? 'Reassign' : 'Assign', 'primary'))
      + B(done ? 'undone' : 'done', done ? 'Undo done' : 'Mark done')
      + B('laundry', j.laundry ? 'Edit linen count' : 'Count linen')
      + (done ? '' : B('postpone', 'Postpone'))
      + (j.postponedFrom && !done ? B('restore-date', 'Restore date') : '')
      + (j.extra ? B('edit-extra', 'Edit extra') : '')
      + (done ? '' : B('cancel', 'Cancel cleaning'))
      + CLOSE + '</div>';
  }
  return head(placeLabel(j) || 'Cleaning', (j.kind === 'extra' ? 'Extra cleaning' : 'Checkout cleaning') + ' · ' + dayShort(j.date))
    + '<div class="sheet-b">' + status + '<dl class="kvs">' + rows.join('') + '</dl></div>' + foot;
}
```

(`addDays`, `initials` and `LAUNDRY_ITEMS` are imported now because the sheets appended by Tasks 6 to 9 use them.)

- [ ] **Step 5: Controller**

`manager/screens/planning.js`:

```js
// Ecran Planning (spec 2026-10-09, sections 3, 4 et 9.3) : la semaine de menages,
// grille de 7 jours sur ordinateur, un jour a la fois sur telephone, une couleur
// par personne. Lecture : mgr.planning (un appel par semaine, derniere semaine vue
// gardee sur l'appareil, en lecture seule). Gestes : les actions existantes du
// proxy, une cle d'idempotence par geste, jamais d'auteur envoye.
import { get, post } from '/manager/api.js';
import { createGestures } from '/manager/gesture.js';
import { clearCache, loadCache, saveCache } from '/manager/today-cache.js';
import {
  addDays, closeSheet, dubaiTime, dubaiToday, esc, openSheet, placeLabel, sheetBusy, sheetError, sheetIsOpen, toast,
} from '/manager/ui/dom.js';
import { dayShort, defaultDay, LAUNDRY_ITEMS, laundryParse, namesOf, weekStartOf } from '/manager/screens/planning-rules.js';
import * as V from '/manager/screens/planning-view.js';

const KEY = 'mgrPlanningCache';
const RO_LINE = 'Reconnect to make changes.';

export async function renderPlanning(ctx) {
  const main = ctx.main;
  const today = dubaiToday(Date.now());
  const mq = window.matchMedia('(min-width: 960px)');
  const st = {
    start: weekStartOf(today), today, day: today, data: null, savedAt: 0, fresh: false,
    loading: true, error: null, busy: false, filter: null, seq: 0, sheet: null, pick: new Set(),
  };
  const gestures = createGestures();
  // ACT[data-pa] = (menage, bouton) => void ; hooks.resync : apres une ecriture rendue.
  const ACT = {};
  const hooks = { resync: () => {} };

  const readOnly = () => !st.fresh || !st.data;
  const job = (key) => (st.data ? st.data.jobs.find((j) => j.key === key) || null : null);
  const heldHere = (key) => sheetIsOpen() && !!st.sheet && st.sheet.key === key;

  // Derniere semaine vue sur cet appareil, seulement la meme semaine et le meme manager.
  function fromCache() {
    const c = loadCache(KEY, (d) => !!(d && d.start && Array.isArray(d.jobs) && Array.isArray(d.days)));
    if (!c || c.data.start !== st.start) return;
    if (ctx.me && (!c.data.me || c.data.me.id !== ctx.me.id)) return;
    st.data = c.data;
    st.savedAt = c.savedAt;
  }

  function banner() {
    if (!st.data || st.fresh) return '';
    const savedDay = dubaiToday(st.savedAt);
    const when = (savedDay === st.today ? '' : dayShort(savedDay) + ' ') + dubaiTime(new Date(st.savedAt).toISOString());
    if (st.error) {
      return '<div class="banner warn" role="status"><span>Data from ' + esc(when) + '. ' + esc(st.error.message)
        + '</span><button class="btn sm" type="button" data-retry>Retry</button></div>';
    }
    return '<div class="banner" role="status"><span>Data from ' + esc(when) + ', updating.</span></div>';
  }

  function paint() {
    if (!ctx.isCurrent()) return;
    main.innerHTML = V.screenHtml({
      data: st.data, start: st.start, today: st.today, day: st.day, wide: mq.matches, filter: st.filter,
      loading: st.loading, error: st.error, banner: banner(), stale: !st.fresh, ro: readOnly(),
    });
  }

  // true quand l'erreur a deja ete traitee par une sortie de l'ecran.
  function handleAccess(e) {
    if (e.kind === 'auth' || e.kind === 'forbidden') clearCache(KEY);
    if (e.kind === 'auth') { location.replace('/'); return true; }
    if (e.kind === 'forbidden') {
      if (e.message === 'email sign-in required') ctx.emailRequired(); else location.replace('/');
      return true;
    }
    return false;
  }

  async function refresh() {
    const mine = ++st.seq;
    const start = st.start;
    st.loading = true;
    st.error = null;
    if (!st.data) fromCache();
    paint();
    try {
      const d = await get('mgr.planning', { start });
      if (mine !== st.seq || !ctx.isCurrent()) return;
      st.data = d;
      st.savedAt = Date.now();
      st.fresh = true;
      saveCache(KEY, d, st.savedAt);
    } catch (e) {
      if (mine !== st.seq || !ctx.isCurrent()) return;
      if (handleAccess(e)) return;
      st.error = e;
      st.fresh = false;
    }
    st.loading = false;
    if (st.data && !st.data.days.some((x) => x.date === st.day)) st.day = defaultDay(st.data.start, st.today);
    paint();
  }

  function goWeek(n) {
    st.start = n === 0 ? weekStartOf(st.today) : addDays(st.start, 7 * n);
    st.day = defaultDay(st.start, st.today);
    st.data = null;
    st.fresh = false;
    closeSheet();
    refresh();
  }

  // Panneau d'un menage (key) dans une vue : detail, assign, cancel, postpone,
  // laundry, extra, delete. key '__new' = creation d'un extra (aucun menage).
  function show(key, view) {
    const j = key === '__new' ? null : job(key);
    if (key !== '__new' && !j) { closeSheet(); return; }
    const fn = view === 'detail' ? V.jobSheet : V[view + 'Sheet'];
    if (typeof fn !== 'function') return;
    st.sheet = { key, view };
    openSheet(fn(st.data, j, readOnly(), st));
  }

  // Boutons du panneau rendus apres une ecriture : ceux d'une personne en conge restent bloques.
  function unbusy() {
    sheetBusy(false);
    document.querySelectorAll('#sheet [data-off]').forEach((b) => { b.disabled = true; });
    hooks.resync();
  }

  // Un geste : cle d'idempotence (reprise au reessai incertain), panneau bloque
  // pendant l'envoi, erreur du serveur telle quelle, puis toast et rechargement.
  async function write(key, action, body, okMsg, undo) {
    if (st.busy) { toast('Saving, wait a second.'); return false; }
    if (readOnly()) { toast(RO_LINE); return false; }
    st.busy = true;
    sheetBusy(true);
    try {
      await gestures.run(action + '|' + JSON.stringify(body), (idem) => post(action, { ...body, idem }));
    } catch (e) {
      st.busy = false;
      unbusy();
      if (handleAccess(e)) return false;
      if (heldHere(key)) sheetError(e.message); else toast(e.message);
      return false;
    }
    st.busy = false;
    unbusy();
    if (heldHere(key)) closeSheet();
    toast(okMsg, undo);
    refresh();
    return true;
  }

  // Gestes (taches 6 a 9) : ajoutes juste sous cette ligne.

  function onClick(e) {
    const t = e.target && e.target.closest ? e.target : null;
    const el = t ? t.closest('[data-retry],[data-week],[data-day],[data-filter],[data-job],[data-add-extra],#sheet [data-pa]') : null;
    if (!el) return;
    if (el.hasAttribute('data-retry')) { refresh(); return; }
    if (el.hasAttribute('data-week')) { goWeek(Number(el.getAttribute('data-week'))); return; }
    if (!st.data) return;
    if (el.hasAttribute('data-day')) { st.day = el.getAttribute('data-day'); paint(); return; }
    if (el.hasAttribute('data-filter')) {
      const f = el.getAttribute('data-filter');
      st.filter = f === 'all' || String(st.filter) === f ? null : f;
      paint();
      return;
    }
    if (el.hasAttribute('data-job')) { show(el.getAttribute('data-job'), 'detail'); return; }
    if (el.hasAttribute('data-add-extra')) { if (ACT.addExtra) ACT.addExtra(); return; }
    const k = el.getAttribute('data-pa');
    if (k === 'back') {
      if (st.sheet && st.sheet.key !== '__new') show(st.sheet.key, 'detail'); else closeSheet();
      return;
    }
    const j = st.sheet ? job(st.sheet.key) : null;
    if (ACT[k]) ACT[k](j, el);
  }

  const onMq = () => paint();
  document.addEventListener('click', onClick);
  mq.addEventListener('change', onMq);
  ctx.onLeave(() => {
    document.removeEventListener('click', onClick);
    mq.removeEventListener('change', onMq);
  });
  await refresh();
}
```

(`placeLabel`, `namesOf`, `LAUNDRY_ITEMS` and `laundryParse` are imported now for the gestures inserted by Tasks 6 to 9.)

- [ ] **Step 6: Styles, route, stylesheet**

`manager/ui/planning.css`:

```css
/* Ecran Planning : grille semaine (ordinateur), un jour (telephone), une couleur par personne. */
.pl-top{flex-wrap:wrap}
.pl-tools{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;justify-content:flex-end;min-width:0}
.pl-nav{display:flex;align-items:center;gap:6px}
.pl-legend{margin-bottom:var(--s3)}
.pchip .n{color:var(--ink-3);font-variant-numeric:tabular-nums}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:var(--pc);flex:none}
.pc-p1{--pc:var(--pc-1)} .pc-p2{--pc:var(--pc-2)} .pc-p3{--pc:var(--pc-3)} .pc-p4{--pc:var(--pc-4)}
.pc-sub{--pc:var(--pc-sub)} .pc-other{--pc:var(--ink-3)} .pc-none{--pc:var(--bad)}

.pl-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:var(--s2);align-items:start}
.pl-col,.pl-day{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);min-width:0;display:flex;flex-direction:column}
.pl-dh{padding:var(--s3);border-bottom:1px solid var(--line)}
.pl-dh h2{margin:0;font-size:17px;line-height:1.3;font-weight:600}
.pl-dh.today h2{color:var(--accent)}
.pl-dh .meta{font-size:13px;color:var(--ink-3)}
.pl-hol{font-size:13px;color:var(--ink-2);margin-top:2px}
.pl-off{font-size:13px;color:var(--warn-ink);margin-top:2px;font-weight:600}
.pl-cards{display:flex;flex-direction:column;gap:6px;padding:var(--s2)}
.pl-cards .empty{padding:var(--s2);font-size:14px}

.pj{display:flex;flex-direction:column;align-items:stretch;gap:2px;width:100%;min-width:0;text-align:left;cursor:pointer;font-size:14px;line-height:1.35;color:var(--ink);
  border:1px solid var(--line);border-left:4px solid var(--pc,var(--line-2));border-radius:10px;padding:8px 10px;
  background:color-mix(in srgb,var(--pc,var(--line-2)) 10%,var(--surface));transition:border-color .15s var(--ease-out)}
.pj:hover{border-color:var(--pc,var(--line-2))}
.pj.extra{border-style:dashed;border-left-style:solid}
.pj.cancelled{opacity:.6}
.pj.cancelled .pj-place{text-decoration:line-through}
.pj-top{display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap}
.pj-top .mono{font-size:13px;color:var(--ink-2)}
.pj-place{font-weight:600;overflow-wrap:anywhere}
.pj-who{color:var(--ink-2);overflow-wrap:anywhere}
.pj-tags{display:flex;flex-wrap:wrap;gap:4px}
.pj-tags span{font-size:12px;color:var(--ink-2);background:var(--sunk);border-radius:6px;padding:0 6px}
.pill.sm{font-size:12px;padding:1px 8px;white-space:normal}

.pl-strip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;margin-bottom:var(--s3)}
.pl-strip button{display:flex;flex-direction:column;align-items:center;gap:0;padding:6px 0;border-radius:10px;border:1px solid var(--line);background:var(--surface);cursor:pointer;font-size:12px;color:var(--ink-2);min-width:0}
.pl-strip button b{font-size:18px;line-height:1.2;color:var(--ink)}
.pl-strip button small{font-size:12px;color:var(--ink-3)}
.pl-strip button.today b{color:var(--accent)}
.pl-strip button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.pl-strip button[aria-pressed="true"] b,.pl-strip button[aria-pressed="true"] small{color:var(--accent-ink)}
.pl-day .pj{font-size:16px}

.kvs{margin:0;display:flex;flex-direction:column;gap:var(--s2)}
.kvs div{display:grid;grid-template-columns:120px minmax(0,1fr);gap:var(--s2)}
.kvs dt{color:var(--ink-3);font-size:14px}
.kvs dd{margin:0;overflow-wrap:anywhere}
.pick button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent-tint)}
.pick button[disabled]{opacity:.55;cursor:default}
.pick .av[class*="pc-"]{background:var(--pc);color:#fff}
.sheet-warn{margin:0;background:var(--warn-tint);color:var(--warn-ink);border-radius:var(--r-md);padding:var(--s2) var(--s3);font-weight:500}
.form{display:flex;flex-direction:column;gap:var(--s3)}
.fl{display:flex;flex-direction:column;gap:4px;font-size:14px;color:var(--ink-2)}
.fl input,.fl select,.fl textarea{min-height:44px;font:inherit;font-size:16px;color:var(--ink);background:var(--surface);border:1px solid var(--line-2);border-radius:10px;padding:8px 10px;width:100%;min-width:0}
.lq{display:flex;flex-direction:column;gap:var(--s2)}
.lq-row{display:grid;grid-template-columns:minmax(0,1fr) 44px 64px 44px;gap:6px;align-items:center}
.lq-row label{font-size:15px;overflow-wrap:anywhere}
.lq-row input{height:44px;text-align:center;font:inherit;font-size:18px;font-variant-numeric:tabular-nums;color:var(--ink);background:var(--surface);border:1px solid var(--line-2);border-radius:10px;min-width:0;width:100%}
@media (min-width:960px) and (max-width:1279px){ .pj{font-size:13px;padding:6px 8px} .pl-dh{padding:var(--s2)} }
```

In `manager/app.js`, replace:

```js
const SCREENS = {
  today: ['/manager/screens/today.js', 'renderToday'],
  problems: ['/manager/screens/problems.js', 'renderProblems'],
};
```

with:

```js
const SCREENS = {
  today: ['/manager/screens/today.js', 'renderToday'],
  planning: ['/manager/screens/planning.js', 'renderPlanning'],
  problems: ['/manager/screens/problems.js', 'renderProblems'],
};
```

In `manager/index.html`, replace:

```html
<link rel="stylesheet" href="/manager/ui/problems.css">
```

with:

```html
<link rel="stylesheet" href="/manager/ui/problems.css">
<link rel="stylesheet" href="/manager/ui/planning.css">
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed (new Planning tests, and `shell.spec.ts` / `access.spec.ts` still green: their `#/planning` boot now shows the Planning header with an error card, because no fake route answers `mgr.planning`).

- [ ] **Step 8: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add manager/gesture.js manager/screens/planning-rules.js manager/screens/planning-view.js manager/screens/planning.js manager/ui/planning.css manager/app.js manager/index.html manager/ui/dom.js manager/ui/tokens.css tests/manager/planning-fixtures.ts tests/manager/planning.spec.ts tests/manager/shell.spec.ts
git commit -m "manager: ecran Planning en lecture (grille semaine sur ordinateur, jour sur telephone, couleur par personne, conges, jours feries, filtre, cache lecture seule)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Assign (one or more people), Mark done and Undo

**Files:**
- Modify: `manager/screens/planning-view.js` (append `assignSheet`)
- Modify: `manager/screens/planning.js` (insert under the marker line)
- Create: `tests/manager/planning-actions.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`st`, `ACT`, `show`, `write`, `readOnly`, `head`, `B`, `roFoot`, `initials`, `jobsOn`, `dayShort`, `namesOf`, `placeLabel`); proxy `assignCleaner` (`{ reservation_key, cleaner_ids, mode: 'set', service_type }`, 409 `"<name> is on approved leave on <date>"`) and `setDone` (`{ key, done }`).
- Produces: `V.assignSheet(d, j, ro, s)`; `ACT.assign`, `ACT.toggle`, `ACT['save-assign']`, `ACT['clear-assign']`, `ACT.done`, `ACT.undone`. Buttons of a person on leave carry `data-off` and stay disabled.

- [ ] **Step 1: Write the failing tests**

`tests/manager/planning-actions.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, fetchLog, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const boot = (page: any, routes: any[]) => bootMgr(page, [me(MANAGER), PLAN(), ...routes], { email: true, hash: HASH, clock: PNOW });

test('Assign : deux personnes, assignCleaner en mode set, sans auteur, puis rechargement', async ({ page }, info) => {
  await boot(page, [{ match: 'action=assignCleaner', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(sh.locator('h2')).toHaveText('Assign');
  await sh.locator('[data-pa="toggle"][data-id="4"]').click();
  await sh.locator('[data-pa="toggle"][data-id="10"]').click();
  await expect(sh.locator('[data-pa="toggle"][data-id="10"]')).toHaveAttribute('aria-pressed', 'true');
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva assigned to Faiza and Pionah');
  await expect(sh).toHaveAttribute('aria-hidden', 'true');
  const w = await writes(page, 'assignCleaner');
  expect(noIdem(w)).toEqual([{ reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [4, 10], mode: 'set', service_type: 'CHC' }]);
  expect(w[0].idem).toMatch(IDEM);
  await expect.poll(async () => (await fetchLog(page)).filter((l) => l.url.includes('action=mgr.planning')).length).toBe(2);
  // Undo : remet la liste d'avant (personne), nouveau geste donc nouvelle cle.
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'assignCleaner')).length).toBe(2);
  const all = await writes(page, 'assignCleaner');
  expect(noIdem(all)[1]).toEqual({ reservation_key: '2026-10-09_Bo Ray', cleaner_ids: [], mode: 'set', service_type: 'CHC' });
  expect(all[1].idem).not.toBe(all[0].idem);
});

test('conge : la personne en conge ce jour-la est grisee « On leave »', async ({ page }, info) => {
  await boot(page, []);
  await openJob(page, isMobile(info), '2026-10-10_Fa Ho', '2026-10-10');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Reassign' }).click();
  const faiza = sh.locator('[data-pa="toggle"][data-id="4"]');
  await expect(faiza).toBeDisabled();
  await expect(faiza).toContainText('On leave');
  await expect(sh.locator('[data-pa="toggle"][data-id="12"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(sh.locator('[data-pa="toggle"][data-id="10"]')).toContainText('0 jobs that day');
});

test('refus du serveur (conge) : message tel quel, boutons rendus, personne en conge toujours grisee', async ({ page }, info) => {
  await boot(page, [{ match: 'action=assignCleaner', status: 409, body: { error: 'Pionah is on approved leave on 2026-10-10' } }]);
  await openJob(page, isMobile(info), '2026-10-10_Fa Ho', '2026-10-10');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Reassign' }).click();
  await sh.locator('[data-pa="toggle"][data-id="10"]').click();
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('Pionah is on approved leave on 2026-10-10');
  await expect(sh.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await expect(sh.locator('[data-pa="toggle"][data-id="4"]')).toBeDisabled();
  await expect(sh).toHaveAttribute('aria-hidden', 'false');
});

test('double clic sur Save : une seule ecriture', async ({ page }, info) => {
  await boot(page, [{ match: 'action=assignCleaner', status: 200, body: OK, delay: 400 }]);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Assign', exact: true }).click();
  await sh.locator('[data-pa="toggle"][data-id="10"]').click();
  await sh.getByRole('button', { name: 'Save', exact: true }).dblclick();
  await expect(page.locator('#toast')).toContainText('assigned to Pionah');
  expect((await writes(page, 'assignCleaner')).length).toBe(1);
});

test('Mark done puis Undo : setDone vrai puis faux, deux gestes', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setDone', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  await page.locator('#sheet').getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 805 · Azizi Riviera 39 marked done');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'setDone')).length).toBe(2);
  const w = await writes(page, 'setDone');
  expect(noIdem(w)).toEqual([{ key: '2026-10-09_Di Fox', done: true }, { key: '2026-10-09_Di Fox', done: false }]);
  expect(w[0].idem).not.toBe(w[1].idem);
  for (const b of w) expect(b.actor).toBeUndefined();
});

test('menage fait : Undo done, ni Assign ni Postpone ni Cancel', async ({ page }, info) => {
  await boot(page, []);
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  const sh = page.locator('#sheet');
  await expect(sh.getByRole('button', { name: 'Undo done' })).toBeVisible();
  for (const pa of ['assign', 'postpone', 'cancel']) await expect(sh.locator('[data-pa="' + pa + '"]')).toHaveCount(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager/planning-actions.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (clicking Assign does nothing: no "Assign" heading; Mark done sends nothing).

- [ ] **Step 3: The picker view**

Append to `manager/screens/planning-view.js`:

```js

// Choix des personnes (plusieurs possibles) : Save remplace la liste.
// Une personne en conge ce jour-la est grisee, sauf si deja assignee (on peut la retirer).
export function assignSheet(d, j, ro, s) {
  if (ro) return head('Assign', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  const day = d.days.find((x) => x.date === j.date);
  const off = new Set(day ? day.off : []);
  const n = {};
  for (const x of jobsOn(d, j.date)) if (!x.cancelled) for (const id of x.assigned) n[id] = (n[id] || 0) + 1;
  const opts = d.people.filter((p) => p.assignable).map((p) => {
    const on = s.pick.has(p.id);
    const locked = off.has(p.id) && !on;
    const k = n[p.id] || 0;
    const sub = off.has(p.id) ? 'On leave' : k + ' job' + (k === 1 ? '' : 's') + ' that day';
    return '<button type="button" data-pa="toggle" data-id="' + p.id + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
      + (locked ? ' disabled data-off' : '') + '>'
      + '<span class="av pc-' + esc(p.slot) + '" aria-hidden="true">' + esc(initials(p.name)) + '</span>'
      + '<span><b>' + esc(p.name) + '</b><small>' + esc(sub) + '</small></span></button>';
  }).join('');
  return head('Assign', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p class="note">Pick one or more people, then Save.</p><div class="pick">' + opts + '</div></div>'
    + '<div class="sheet-f">' + B('save-assign', 'Save', 'primary') + (j.assigned.length ? B('clear-assign', 'Clear all') : '') + B('back', 'Back') + '</div>';
}
```

- [ ] **Step 4: The gestures**

In `manager/screens/planning.js`, replace:

```js
  // Gestes (taches 6 a 9) : ajoutes juste sous cette ligne.
```

with:

```js
  // Gestes (taches 6 a 9) : ajoutes juste sous cette ligne.

  // Tache 6 : Assign (une ou plusieurs personnes, mode set, type de service garde), Mark done / Undo.
  function assignTo(j, ids) {
    const prev = j.assigned.slice();
    const service = j.serviceType || 'CHC';
    const where = placeLabel(j);
    const label = (list) => (list.length ? namesOf(st.data, list) : 'nobody');
    return write(j.key, 'assignCleaner', { reservation_key: j.key, cleaner_ids: ids, mode: 'set', service_type: service },
      ids.length ? where + ' assigned to ' + label(ids) : where + ' unassigned',
      () => write(j.key, 'assignCleaner', { reservation_key: j.key, cleaner_ids: prev, mode: 'set', service_type: service },
        where + ' back to ' + label(prev)));
  }
  function markDone(j, val) {
    const where = placeLabel(j);
    return write(j.key, 'setDone', { key: j.key, done: val }, where + (val ? ' marked done' : ' back to not done'),
      () => write(j.key, 'setDone', { key: j.key, done: !val }, where + (val ? ' back to not done' : ' marked done')));
  }
  ACT.assign = (j) => {
    if (!j) return;
    if (readOnly()) { toast(RO_LINE); return; }
    st.pick = new Set(j.assigned);
    show(j.key, 'assign');
  };
  ACT.toggle = (j, el) => {
    if (!j || el.disabled) return;
    const id = Number(el.getAttribute('data-id'));
    if (st.pick.has(id)) st.pick.delete(id); else st.pick.add(id);
    el.setAttribute('aria-pressed', st.pick.has(id) ? 'true' : 'false');
  };
  ACT['save-assign'] = (j) => { if (j) assignTo(j, [...st.pick].sort((a, b) => a - b)); };
  ACT['clear-assign'] = (j) => { if (j) assignTo(j, []); };
  ACT.done = (j) => { if (j) markDone(j, true); };
  ACT.undone = (j) => { if (j) markDone(j, false); };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add manager/screens/planning-view.js manager/screens/planning.js tests/manager/planning-actions.spec.ts
git commit -m "manager: Planning, Assign a une ou plusieurs personnes (conges grises, refus du serveur tel quel) et Mark done avec Undo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Cancel / Restore, Postpone / Restore date

**Files:**
- Modify: `manager/screens/planning-view.js` (append `cancelSheet`, `postponeSheet`)
- Modify: `manager/screens/planning.js` (insert under the Task 6 block)
- Create: `tests/manager/planning-changes.spec.ts`

**Interfaces:**
- Consumes: Task 5 and 6; proxy `setCancelled` (`{ key, cancelled, reason? }`) and `setPostponed` (`{ key, postpone: true, new_date, original_date }` or `{ key, postpone: false }`).
- Produces: `V.cancelSheet(d, j, ro)`, `V.postponeSheet(d, j, ro)`; `ACT.cancel`, `ACT['confirm-cancel']`, `ACT.restore`, `ACT.postpone`, `ACT['confirm-postpone']`, `ACT['restore-date']`.

- [ ] **Step 1: Write the failing tests**

`tests/manager/planning-changes.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const boot = (page: any, routes: any[]) => bootMgr(page, [me(MANAGER), ...routes, PLAN()], { email: true, hash: HASH, clock: PNOW });

test('Cancel avec raison puis Undo', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setCancelled', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Bo Ray', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Cancel cleaning' }).click();
  await expect(sh.locator('h2')).toHaveText('Cancel this cleaning?');
  await sh.locator('#pReason').fill('Owner arrived early');
  await sh.getByRole('button', { name: 'Confirm cancel' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 103 · Damac Reva cancelled');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'setCancelled')).length).toBe(2);
  const w = await writes(page, 'setCancelled');
  expect(noIdem(w)).toEqual([
    { key: '2026-10-09_Bo Ray', cancelled: true, reason: 'Owner arrived early' },
    { key: '2026-10-09_Bo Ray', cancelled: false },
  ]);
  expect(w[0].idem).toMatch(IDEM);
});

test('menage annule : Restore cleaning, rien d autre', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setCancelled', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-07_Ed Gu', '2026-10-07');
  const sh = page.locator('#sheet');
  await expect(sh).toContainText('Guest extended · by Walter');
  await expect(sh.locator('[data-pa="postpone"]')).toHaveCount(0);
  await sh.getByRole('button', { name: 'Restore cleaning' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 404 · Elysee 1 restored');
  expect(noIdem(await writes(page, 'setCancelled'))).toEqual([{ key: '2026-10-07_Ed Gu', cancelled: false }]);
});

test('Postpone : au lendemain, alerte sur l arrivee suivante, Undo', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setPostponed', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Postpone' }).click();
  await expect(sh.locator('.sheet-warn')).toHaveText('Next guest checks in Sat 10 at 16:00. The cleaning must be done before.');
  await sh.getByRole('button', { name: 'Move to Sat 10' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 805 · Azizi Riviera 39 moved to Sat 10');
  await page.locator('#toast [data-undo]').click();
  await expect.poll(async () => (await writes(page, 'setPostponed')).length).toBe(2);
  expect(noIdem(await writes(page, 'setPostponed'))).toEqual([
    { key: '2026-10-09_Di Fox', postpone: true, new_date: '2026-10-10', original_date: '2026-10-09' },
    { key: '2026-10-09_Di Fox', postpone: false },
  ]);
});

test('menage deja reporte : garde la premiere date d origine, Restore date', async ({ page }, info) => {
  await boot(page, [{ match: 'action=setPostponed', status: 200, body: OK }]);
  await openJob(page, isMobile(info), '2026-10-07_Gi Lo', '2026-10-08');
  const sh = page.locator('#sheet');
  await expect(sh).toContainText('from Wednesday 7 October');
  await sh.getByRole('button', { name: 'Postpone' }).click();
  await sh.getByRole('button', { name: 'Move to Fri 9' }).click();
  await expect(page.locator('#toast')).toContainText('moved to Fri 9');
  await openJob(page, isMobile(info), '2026-10-07_Gi Lo', '2026-10-08');
  await sh.getByRole('button', { name: 'Restore date' }).click();
  await expect(page.locator('#toast')).toContainText('Apt 606 · Tower F back to Wed 7');
  expect(noIdem(await writes(page, 'setPostponed'))).toEqual([
    { key: '2026-10-07_Gi Lo', postpone: true, new_date: '2026-10-09', original_date: '2026-10-07' },
    { key: '2026-10-07_Gi Lo', postpone: false },
  ]);
});

test('reseau coupe pendant Postpone : message, puis meme cle au second essai', async ({ page }, info) => {
  await boot(page, [
    { match: 'action=setPostponed', status: 0, body: {}, fail: true, once: true },
    { match: 'action=setPostponed', status: 200, body: OK },
  ]);
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Postpone' }).click();
  await sh.getByRole('button', { name: 'Move to Sat 10' }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('No connection. Try again.');
  await sh.getByRole('button', { name: 'Move to Sat 10' }).click();
  await expect(page.locator('#toast')).toContainText('moved to Sat 10');
  const w = await writes(page, 'setPostponed');
  expect(w.length).toBe(2);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[1].idem).toBe(w[0].idem);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager/planning-changes.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (Cancel cleaning and Postpone open nothing).

- [ ] **Step 3: The two views**

Append to `manager/screens/planning-view.js`:

```js

export function cancelSheet(d, j, ro) {
  if (ro) return head('Cancel cleaning', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  return head('Cancel this cleaning?', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p>The cleaning stays on the planning, struck through, and can be restored.</p>'
    + '<label class="fl">Reason (optional)<input id="pReason" type="text" maxlength="200" autocomplete="off"></label></div>'
    + '<div class="sheet-f">' + B('confirm-cancel', 'Confirm cancel', 'primary') + B('back', 'Back') + '</div>';
}

// Report d'un jour (19 reports sur 19 depuis juillet etaient d'un jour).
export function postponeSheet(d, j, ro) {
  if (ro) return head('Postpone', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  const to = addDays(j.date, 1);
  let warn = '';
  if (j.next && j.next.date <= to) {
    const when = dayShort(j.next.date) + (j.next.time ? ' at ' + j.next.time : '');
    warn = '<p class="sheet-warn" role="status">Next guest checks in ' + esc(when)
      + (j.next.date < to ? ', before the new date.' : '. The cleaning must be done before.') + '</p>';
  }
  return head('Postpone this cleaning?', placeLabel(j))
    + '<div class="sheet-b"><p>Move from <b>' + esc(dayShort(j.date)) + '</b> to <b>' + esc(dayShort(to))
    + '</b>. Assignment and linen stay with the cleaning.</p>' + warn + '</div>'
    + '<div class="sheet-f">' + B('confirm-postpone', 'Move to ' + dayShort(to), 'primary') + B('back', 'Back') + '</div>';
}
```

- [ ] **Step 4: The gestures**

In `manager/screens/planning.js`, replace:

```js
  ACT.done = (j) => { if (j) markDone(j, true); };
  ACT.undone = (j) => { if (j) markDone(j, false); };
```

with:

```js
  ACT.done = (j) => { if (j) markDone(j, true); };
  ACT.undone = (j) => { if (j) markDone(j, false); };

  // Tache 7 : Cancel (raison facultative) / Restore, Postpone d'un jour / Restore date.
  ACT.cancel = (j) => { if (j) show(j.key, 'cancel'); };
  ACT['confirm-cancel'] = (j) => {
    if (!j) return;
    const inp = document.getElementById('pReason');
    const reason = inp ? inp.value.trim() : '';
    const where = placeLabel(j);
    write(j.key, 'setCancelled', { key: j.key, cancelled: true, reason }, where + ' cancelled',
      () => write(j.key, 'setCancelled', { key: j.key, cancelled: false }, where + ' restored'));
  };
  ACT.restore = (j) => { if (j) write(j.key, 'setCancelled', { key: j.key, cancelled: false }, placeLabel(j) + ' restored'); };
  ACT.postpone = (j) => { if (j) show(j.key, 'postpone'); };
  // Toujours la premiere date d'origine : deux reports de suite gardent le vrai depart.
  ACT['confirm-postpone'] = (j) => {
    if (!j) return;
    const to = addDays(j.date, 1);
    const from = j.postponedFrom || j.date;
    const where = placeLabel(j);
    const back = j.postponedFrom
      ? () => write(j.key, 'setPostponed', { key: j.key, postpone: true, new_date: j.date, original_date: from }, where + ' back to ' + dayShort(j.date))
      : () => write(j.key, 'setPostponed', { key: j.key, postpone: false }, where + ' back to ' + dayShort(j.date));
    write(j.key, 'setPostponed', { key: j.key, postpone: true, new_date: to, original_date: from }, where + ' moved to ' + dayShort(to), back);
  };
  ACT['restore-date'] = (j) => {
    if (j && j.postponedFrom) write(j.key, 'setPostponed', { key: j.key, postpone: false }, placeLabel(j) + ' back to ' + dayShort(j.postponedFrom));
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add manager/screens/planning-view.js manager/screens/planning.js tests/manager/planning-changes.spec.ts
git commit -m "manager: Planning, annuler / restaurer et reporter d un jour / restaurer la date (alerte arrivee suivante, meme cle au reessai)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Linen count of each cleaning

**Files:**
- Modify: `manager/screens/planning-view.js` (append `laundrySheet`)
- Modify: `manager/screens/planning.js` (insert under the Task 7 block)
- Create: `tests/manager/planning-linen.spec.ts`

**Interfaces:**
- Consumes: Task 5 to 7; `LAUNDRY_ITEMS`, `laundryParse` (Task 5); proxy `saveLaundryCount` (`{ reservation_key, pillowcases, bed_sheets, duvet_covers, small_towels, face_towels, large_towels, bath_mats }`, author from the session since Task 1).
- Produces: `V.laundrySheet(d, j, ro)` with inputs `#lq_<field>` and steppers `[data-pa="lq-step"][data-field][data-d]`; `ACT.laundry`, `ACT['lq-step']`, `ACT['save-laundry']`; `hooks.resync = syncLaundry`.

- [ ] **Step 1: Write the failing tests**

`tests/manager/planning-linen.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';
const FIELDS = ['pillowcases', 'bed_sheets', 'duvet_covers', 'small_towels', 'face_towels', 'large_towels', 'bath_mats'];

test('Count linen : 7 champs obligatoires, boutons + et -, sans auteur', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=saveLaundryCount', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), '2026-10-09_Di Fox', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Count linen' }).click();
  await expect(sh.locator('h2')).toHaveText('Linen collected');
  const save = sh.getByRole('button', { name: 'Save count' });
  await expect(save).toBeDisabled();
  const plus = sh.locator('[data-pa="lq-step"][data-field="pillowcases"][data-d="1"]');
  await plus.click();
  await plus.click();
  await plus.click();
  await sh.locator('[data-pa="lq-step"][data-field="pillowcases"][data-d="-1"]').click();
  await expect(sh.locator('#lq_pillowcases')).toHaveValue('2');
  for (const f of FIELDS.slice(1)) await sh.locator('#lq_' + f).fill('1');
  await expect(save).toBeEnabled();
  await sh.locator('#lq_bath_mats').fill('');
  await expect(save).toBeDisabled();
  await sh.locator('#lq_bath_mats').fill('0');
  await save.click();
  await expect(page.locator('#toast')).toContainText('Linen count saved for Apt 805 · Azizi Riviera 39');
  const w = await writes(page, 'saveLaundryCount');
  expect(noIdem(w)).toEqual([{
    reservation_key: '2026-10-09_Di Fox', pillowcases: 2, bed_sheets: 1, duvet_covers: 1,
    small_towels: 1, face_towels: 1, large_towels: 1, bath_mats: 0,
  }]);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[0].author).toBeUndefined();
});

test('linge deja compte : prerempli, Save changes', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=saveLaundryCount', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Edit linen count' }).click();
  await expect(sh.locator('#lq_pillowcases')).toHaveValue('4');
  await expect(sh.locator('#lq_bath_mats')).toHaveValue('2');
  await sh.locator('#lq_bath_mats').fill('3');
  await sh.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#toast')).toContainText('Linen count saved for Apt 308 · Binghatti Lavender');
  expect(noIdem(await writes(page, 'saveLaundryCount'))[0].bath_mats).toBe(3);
});

test('refus du serveur : message tel quel, Save rendu selon les champs', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=saveLaundryCount', status: 400, body: { error: 'bath_mats is out of range' } }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), '2026-10-06_Ann Lee', '2026-10-06');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Edit linen count' }).click();
  await sh.getByRole('button', { name: 'Save changes' }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('bath_mats is out of range');
  await expect(sh.getByRole('button', { name: 'Save changes' })).toBeEnabled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager/planning-linen.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (Count linen opens nothing).

- [ ] **Step 3: The view**

Append to `manager/screens/planning-view.js`:

```js

// Linge ramasse : sept champs, tous obligatoires (0 quand il n'y en a pas).
export function laundrySheet(d, j, ro) {
  const v = j.laundry || {};
  const rows = LAUNDRY_ITEMS.map((it) => {
    const val = v[it.key] != null ? String(v[it.key]) : '';
    return '<div class="lq-row"><label for="lq_' + it.key + '">' + esc(it.label) + '</label>'
      + '<button type="button" class="iconbtn" data-pa="lq-step" data-field="' + it.key + '" data-d="-1" aria-label="Less ' + esc(it.label) + '">&minus;</button>'
      + '<input id="lq_' + it.key + '" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="' + esc(val) + '">'
      + '<button type="button" class="iconbtn" data-pa="lq-step" data-field="' + it.key + '" data-d="1" aria-label="More ' + esc(it.label) + '">+</button></div>';
  }).join('');
  const foot = ro ? roFoot() : '<div class="sheet-f">' + B('save-laundry', j.laundry ? 'Save changes' : 'Save count', 'primary') + B('back', 'Back') + '</div>';
  return head('Linen collected', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p class="note">Every field is needed. Type 0 when there is none.</p><div class="lq">' + rows + '</div></div>' + foot;
}
```

- [ ] **Step 4: The gestures**

In `manager/screens/planning.js`, replace:

```js
  ACT['restore-date'] = (j) => {
    if (j && j.postponedFrom) write(j.key, 'setPostponed', { key: j.key, postpone: false }, placeLabel(j) + ' back to ' + dayShort(j.postponedFrom));
  };
```

with:

```js
  ACT['restore-date'] = (j) => {
    if (j && j.postponedFrom) write(j.key, 'setPostponed', { key: j.key, postpone: false }, placeLabel(j) + ' back to ' + dayShort(j.postponedFrom));
  };

  // Tache 8 : linge du menage (meme regle que l'ancienne fiche : sept champs, un vide n'est pas un zero).
  function laundryValues() {
    const out = {};
    for (const it of LAUNDRY_ITEMS) {
      const inp = document.getElementById('lq_' + it.key);
      out[it.key] = inp ? inp.value.trim() : '';
    }
    return out;
  }
  function syncLaundry() {
    const b = document.querySelector('#sheet [data-pa="save-laundry"]');
    if (b && !st.busy) b.disabled = !laundryParse(laundryValues()).ok;
  }
  hooks.resync = syncLaundry;
  ACT.laundry = (j) => { if (j) { show(j.key, 'laundry'); syncLaundry(); } };
  ACT['lq-step'] = (j, el) => {
    const inp = document.getElementById('lq_' + el.getAttribute('data-field'));
    if (!inp) return;
    const cur = inp.value.trim() === '' ? 0 : Number(inp.value);
    const next = (Number.isFinite(cur) ? Math.round(cur) : 0) + Number(el.getAttribute('data-d'));
    inp.value = String(Math.max(0, Math.min(999, next)));
    syncLaundry();
  };
  ACT['save-laundry'] = (j) => {
    if (!j) return;
    const p = laundryParse(laundryValues());
    if (!p.ok) { sheetError('Check the ' + p.label + ' field.'); return; }
    write(j.key, 'saveLaundryCount', { reservation_key: j.key, ...p.values }, 'Linen count saved for ' + placeLabel(j));
  };
  const onInput = (e) => { if (e.target && e.target.closest && e.target.closest('#sheet .lq')) syncLaundry(); };
  document.addEventListener('input', onInput);
  ctx.onLeave(() => document.removeEventListener('input', onInput));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed.

- [ ] **Step 6: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add manager/screens/planning-view.js manager/screens/planning.js tests/manager/planning-linen.spec.ts
git commit -m "manager: Planning, linge de chaque menage (sept champs obligatoires, prerempli, correction, auteur de session)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Extra cleanings (add, edit, delete)

**Files:**
- Modify: `manager/screens/planning-view.js` (append `extraSheet`, `deleteSheet`)
- Modify: `manager/screens/planning.js` (insert under the Task 8 block)
- Create: `tests/manager/planning-extras.spec.ts`

**Interfaces:**
- Consumes: Task 5 to 8; `d.listings`, `d.people[].assignable`, `j.extra` (Task 3); proxy `addExtraCleaning` (`{ listing_id, cleaning_date, label, guest_name, price_billed, cleaner_price, notes, assigned_cleaner_id, idem }`, idempotent since Task 1), `updateExtraCleaning` (`{ id, listing_id, cleaning_date, label, guest_name, price_billed, cleaner_price, notes }`), `deleteExtraCleaning` (`{ id }`).
- Produces: `V.extraSheet(d, j, ro)` (form ids `xListing`, `xDate`, `xLabel`, `xGuest`, `xPrice`, `xRate`, `xWho` at creation only, `xNotes`), `V.deleteSheet(d, j, ro)`; `ACT.addExtra`, `ACT['edit-extra']`, `ACT['x-save']`, `ACT['x-delete']`, `ACT['x-delete-confirm']`.

- [ ] **Step 1: Write the failing tests**

`tests/manager/planning-extras.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { bootMgr, MANAGER, me } from './helpers';
import { IDEM, isMobile, noIdem, OK, openJob, PLAN, PNOW, writes } from './planning-fixtures';

const HASH = '#/planning';

test('Add extra : prix obligatoire, une seule creation au double clic, sans auteur', async ({ page }) => {
  await bootMgr(page, [me(MANAGER), PLAN(), { match: 'action=addExtraCleaning', status: 200, body: OK, delay: 300 }], { email: true, hash: HASH, clock: PNOW });
  await page.getByRole('button', { name: 'Add extra' }).click();
  const sh = page.locator('#sheet');
  await expect(sh.locator('h2')).toHaveText('Add an extra cleaning');
  await expect(sh.locator('#xDate')).toHaveValue('2026-10-09');
  await sh.locator('#xListing').selectOption('L8');
  await sh.locator('#xDate').fill('2026-10-10');
  await sh.locator('#xLabel').selectOption('Mid-stay');
  await sh.getByRole('button', { name: 'Create extra' }).click();
  await expect(sh.locator('.sheet-err')).toHaveText('Price billed is required.');
  await sh.locator('#xPrice').fill('200');
  await sh.locator('#xRate').fill('100');
  await sh.locator('#xWho').selectOption('10');
  await sh.locator('#xNotes').fill('Late checkout');
  await sh.getByRole('button', { name: 'Create extra' }).dblclick();
  await expect(page.locator('#toast')).toContainText('Extra cleaning added for Apt 808 · Tower H on Sat 10');
  const w = await writes(page, 'addExtraCleaning');
  expect(w.length).toBe(1);
  expect(noIdem(w)).toEqual([{
    listing_id: 'L8', cleaning_date: '2026-10-10', label: 'Mid-stay', guest_name: null,
    price_billed: 200, cleaner_price: 100, notes: 'Late checkout', assigned_cleaner_id: 10,
  }]);
  expect(w[0].idem).toMatch(IDEM);
  expect(w[0].created_by).toBeUndefined();
});

test('Edit extra puis Delete', async ({ page }, info) => {
  await bootMgr(page, [me(MANAGER), PLAN(),
    { match: 'action=updateExtraCleaning', status: 200, body: OK },
    { match: 'action=deleteExtraCleaning', status: 200, body: OK }], { email: true, hash: HASH, clock: PNOW });
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  const sh = page.locator('#sheet');
  await sh.getByRole('button', { name: 'Edit extra' }).click();
  await expect(sh.locator('h2')).toHaveText('Edit extra cleaning');
  await expect(sh.locator('#xPrice')).toHaveValue('250');
  await expect(sh.locator('#xWho')).toHaveCount(0);
  await sh.locator('#xPrice').fill('300');
  await sh.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Extra cleaning saved for Apt 808 · Tower H');
  expect(noIdem(await writes(page, 'updateExtraCleaning'))).toEqual([{
    id: 31, listing_id: 'L8', cleaning_date: '2026-10-09', label: 'Deep clean', guest_name: 'Owner',
    price_billed: 300, cleaner_price: 120, notes: 'Bring the steamer',
  }]);
  await openJob(page, isMobile(info), 'extra_2026-10-09_mabc', '2026-10-09');
  await sh.getByRole('button', { name: 'Edit extra' }).click();
  await sh.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(sh.locator('h2')).toHaveText('Delete this extra cleaning?');
  await sh.getByRole('button', { name: 'Delete extra' }).click();
  await expect(page.locator('#toast')).toContainText('Extra cleaning deleted');
  expect(noIdem(await writes(page, 'deleteExtraCleaning'))).toEqual([{ id: 31 }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager/planning-extras.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (Add extra opens nothing).

- [ ] **Step 3: The two views**

Append to `manager/screens/planning-view.js`:

```js

// Memes types que la fiche de l'ancienne app.
const EXTRA_TYPES = ['Mid-stay', 'Owner turnover', 'Deep clean', 'Post-construction', 'Other'];

// Creation (j null) ou modification d'un menage en plus. L'assignation d'un extra
// existant passe par Assign, comme tout menage.
export function extraSheet(d, j, ro) {
  const x = j && j.extra ? j.extra : null;
  const f = x
    ? { listing: j.listingId, date: x.cleaningDate, label: x.label || '', guest: x.guestName || '',
      price: x.priceBilled == null ? '' : String(x.priceBilled), rate: x.cleanerPrice == null ? '' : String(x.cleanerPrice), notes: x.notes || '' }
    : { listing: '', date: d.today >= d.start && d.today <= d.end ? d.today : d.start, label: '', guest: '', price: '', rate: '', notes: '' };
  const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(label) + '</option>';
  const listings = opt('', 'Choose an apartment', f.listing) + d.listings.map((l) => opt(l.id, placeLabel(l) || l.id, f.listing)).join('');
  const types = opt('', 'Choose a type', f.label) + EXTRA_TYPES.map((t) => opt(t, t, f.label)).join('')
    + (f.label && !EXTRA_TYPES.includes(f.label) ? opt(f.label, f.label, f.label) : '');
  const who = x ? '' : '<label class="fl">Assign to<select id="xWho">' + opt('', 'Nobody yet', '')
    + d.people.filter((p) => p.assignable).map((p) => opt(String(p.id), p.name, '')).join('') + '</select></label>';
  const body = '<div class="sheet-b"><div class="form">'
    + '<label class="fl">Apartment<select id="xListing">' + listings + '</select></label>'
    + '<label class="fl">Date<input id="xDate" type="date" value="' + esc(f.date) + '"></label>'
    + '<label class="fl">Type<select id="xLabel">' + types + '</select></label>'
    + '<label class="fl">Guest or client<input id="xGuest" type="text" maxlength="120" autocomplete="off" value="' + esc(f.guest) + '"></label>'
    + '<label class="fl">Price billed (AED)<input id="xPrice" type="number" inputmode="decimal" min="0" step="1" value="' + esc(f.price) + '"></label>'
    + '<label class="fl">Cleaner rate (AED, optional)<input id="xRate" type="number" inputmode="decimal" min="0" step="1" value="' + esc(f.rate) + '"></label>'
    + who
    + '<label class="fl">Notes<textarea id="xNotes" rows="2" maxlength="500">' + esc(f.notes) + '</textarea></label>'
    + '</div></div>';
  let foot;
  if (ro) foot = roFoot();
  else if (x) foot = '<div class="sheet-f">' + B('x-save', 'Save', 'primary') + B('x-delete', 'Delete') + B('back', 'Back') + '</div>';
  else foot = '<div class="sheet-f">' + B('x-save', 'Create extra', 'primary') + '<button class="btn" type="button" data-close>Cancel</button></div>';
  return head(x ? 'Edit extra cleaning' : 'Add an extra cleaning', x ? placeLabel(j) : weekLabel(d.start)) + body + foot;
}

export function deleteSheet(d, j, ro) {
  if (ro) return head('Delete extra', placeLabel(j)) + '<div class="sheet-b"></div>' + roFoot();
  return head('Delete this extra cleaning?', placeLabel(j) + ' · ' + dayShort(j.date))
    + '<div class="sheet-b"><p>The extra cleaning, its assignment and its done state are removed. This cannot be undone.</p></div>'
    + '<div class="sheet-f">' + B('x-delete-confirm', 'Delete extra', 'primary') + B('back', 'Back') + '</div>';
}
```

- [ ] **Step 4: The gestures**

In `manager/screens/planning.js`, replace:

```js
  const onInput = (e) => { if (e.target && e.target.closest && e.target.closest('#sheet .lq')) syncLaundry(); };
  document.addEventListener('input', onInput);
  ctx.onLeave(() => document.removeEventListener('input', onInput));
```

with:

```js
  const onInput = (e) => { if (e.target && e.target.closest && e.target.closest('#sheet .lq')) syncLaundry(); };
  document.addEventListener('input', onInput);
  ctx.onLeave(() => document.removeEventListener('input', onInput));

  // Tache 9 : menages en plus. Prix facture obligatoire (regle de l'ancienne fiche).
  function extraBody() {
    const v = (id) => { const el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
    const listing = v('xListing'), date = v('xDate'), price = v('xPrice'), rate = v('xRate');
    if (!listing) return { error: 'Choose an apartment.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Choose a date.' };
    if (price === '' || !Number.isFinite(Number(price)) || Number(price) < 0) return { error: 'Price billed is required.' };
    if (rate !== '' && (!Number.isFinite(Number(rate)) || Number(rate) < 0)) return { error: 'Cleaner rate must be a number.' };
    return { body: {
      listing_id: listing, cleaning_date: date, label: v('xLabel') || null, guest_name: v('xGuest') || null,
      price_billed: Number(price), cleaner_price: rate === '' ? null : Number(rate), notes: v('xNotes') || null,
    } };
  }
  ACT.addExtra = () => {
    if (readOnly()) { toast(RO_LINE); return; }
    show('__new', 'extra');
  };
  ACT['edit-extra'] = (j) => { if (j && j.extra) show(j.key, 'extra'); };
  ACT['x-save'] = (j) => {
    const r = extraBody();
    if (r.error) { sheetError(r.error); return; }
    if (!j) {
      const whoEl = document.getElementById('xWho');
      const who = whoEl ? whoEl.value : '';
      const l = st.data.listings.find((x) => x.id === r.body.listing_id) || {};
      write('__new', 'addExtraCleaning', { ...r.body, assigned_cleaner_id: who ? Number(who) : null },
        'Extra cleaning added for ' + (placeLabel(l) || 'the apartment') + ' on ' + dayShort(r.body.cleaning_date));
      return;
    }
    if (!j.extra) return;
    write(j.key, 'updateExtraCleaning', { id: j.extra.id, ...r.body }, 'Extra cleaning saved for ' + placeLabel(j));
  };
  ACT['x-delete'] = (j) => { if (j && j.extra) show(j.key, 'delete'); };
  ACT['x-delete-confirm'] = (j) => {
    if (j && j.extra) write(j.key, 'deleteExtraCleaning', { id: j.extra.id }, 'Extra cleaning deleted');
  };
```

- [ ] **Step 5: Run tests to verify they pass, then the whole manager suite and the proxy suite**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop && cd supabase/functions/hostaway-proxy && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none`
Expected: 0 failed everywhere.

- [ ] **Step 6: No dash and no author in the new front code**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && grep -nP "[\x{2013}\x{2014}]" manager/screens/planning*.js manager/gesture.js manager/ui/planning.css; grep -nE "actor|author|created_by" manager/screens/planning*.js manager/gesture.js`
Expected: both greps print nothing.

- [ ] **Step 7: Commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git add manager/screens/planning-view.js manager/screens/planning.js tests/manager/planning-extras.spec.ts
git commit -m "manager: Planning, menages en plus (ajout idempotent, modification, suppression avec confirmation)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Merge into main, deploy, verify in prod

**Files:** none created. Fast-forwards `main`, deploys `supabase/functions/hostaway-proxy` and the main working tree to Netlify. No migration in this phase.

**Interfaces:**
- Consumes: `BASE_SHA` and `BASELINE` recorded before Task 1; `./deploy-proxy.sh` (project `dqjnqvbxfwtvrjwnnmns`, token `~/.supabase/access-token`); `./deploy-front.sh` (Netlify site `stunning-kleicha-f61101`, stamps `sw.js` and `v3/sw.js`); Supabase MCP `execute_sql` (read only).
- Produces: `mgr.planning` live; `/manager/#/planning` live; session author on `saveLaundryCount`, `addExtraCleaning`, `updateExtraCleaning`, `deleteExtraCleaning` (old app included).

Hillal already gave the go for this deploy: Steps 5 and 7 run without an extra stop. Stop and report only on a failed check.

- [ ] **Step 1: Full verification in the worktree**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/supabase/functions/hostaway-proxy" && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno test --allow-all --node-modules-dir=none && /Users/hillal/.npm/_npx/76f887347d91547a/node_modules/@deno/darwin-arm64/deno check --node-modules-dir=none index.ts
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop
cd "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" && HK_PLANNER_URL=http://localhost:8890 npx playwright test tests/manager-link.spec.ts tests/v3-cutover.spec.ts --project=desktop --project=mobile
```
Expected: 0 failed everywhere. Then stop the 8890 server started by Playwright if it is still listening (it serves the worktree; the next run must serve main).

- [ ] **Step 2: Check the branch touches none of the files other people are editing**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
git diff --name-only "$BASE_SHA" mgr-phase3 | grep -E '^(sw\.js|v3/sw\.js|hr\.js|styles\.css|\.gitignore|tests/hr\.spec\.ts|tests/laundry\.spec\.ts)$'
git diff --name-only "$BASE_SHA" mgr-phase3 | grep -E '^supabase/migrations/'
git merge-base --is-ancestor main mgr-phase3 && echo FF-OK
```
Expected: both greps print nothing; `FF-OK`. Otherwise STOP and report.

- [ ] **Step 3: Fast-forward main (never stash)**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
P=$(mktemp -d)/sw.patch
git diff sw.js > "$P"
git checkout -- sw.js
git merge --ff-only mgr-phase3
git apply "$P"
git reset -q sw.js
git status --short
git log --oneline -1
```
Expected: `git status --short` equals `BASELINE` exactly (same `M` and `??` lines, `sw.js` still modified); HEAD is the last commit of Task 9. If `git apply` fails, STOP: the patch file `$P` still holds the stamp, report its path to Hillal.

Then re-run the manager suite from main (port 8890 must be free or served from main):
`cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop`
Expected: 0 failed.

- [ ] **Step 4: Check the deployed proxy is the base commit**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
D=$(mktemp -d); mkdir -p "$D/dl" "$D/base"
(cd "$D/dl" && SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" npx -y supabase@2 functions download hostaway-proxy --project-ref dqjnqvbxfwtvrjwnnmns)
git archive "$BASE_SHA" supabase/functions/hostaway-proxy | tar -x -C "$D/base"
DL=$(dirname "$(find "$D/dl" -name index.ts -path '*hostaway-proxy*' | head -1)")
diff -r -x '*_test.ts' -x 'v3_fakedb.ts' "$D/base/supabase/functions/hostaway-proxy" "$DL"
```
Expected: no output, or only `Only in .../base/...` lines for files `index.ts` does not import. Any content difference or `Only in <download>` line: STOP and report (prod runs code that is not in `BASE_SHA`; deploying would erase it).

- [ ] **Step 5: Deploy the proxy**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && ./deploy-proxy.sh`
Expected: `✓ Deployed.`

- [ ] **Step 6: Verify the deployed proxy is HEAD and answers**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync"
D=$(mktemp -d); mkdir -p "$D/dl" "$D/head"
(cd "$D/dl" && SUPABASE_ACCESS_TOKEN="$(cat ~/.supabase/access-token)" npx -y supabase@2 functions download hostaway-proxy --project-ref dqjnqvbxfwtvrjwnnmns)
git archive HEAD supabase/functions/hostaway-proxy | tar -x -C "$D/head"
DL=$(dirname "$(find "$D/dl" -name index.ts -path '*hostaway-proxy*' | head -1)")
diff -r -x '*_test.ts' -x 'v3_fakedb.ts' "$D/head/supabase/functions/hostaway-proxy" "$DL"
for f in mgr_planning.ts mgr_planning_rules.ts mgr_extra.ts index.ts; do cmp "$D/head/supabase/functions/hostaway-proxy/$f" "$DL/$f" && echo "same $f"; done
SECRET=$(sed -n "s/^export const APP_SECRET = '\(.*\)';/\1/p" v3/proxy-config.js)
B="https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy"
curl -sS -o /dev/null -w "%{http_code}\n" "$B?action=mgr.planning" -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w "%{http_code}\n" "$B?action=mgr.today" -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w "%{http_code}\n" "$B?action=getCleaners" -H "X-App-Secret: $SECRET"
curl -sS "$B?action=checkouts&startDate=2026-10-12&endDate=2026-10-18" -H "X-App-Secret: $SECRET" | head -c 120; echo
```
Expected: `diff` prints nothing (or only `Only in .../head/...` for unimported files); four `same ...` lines; `401`, `401`, `200`; the last line starts with `{"status":"success"` (the old Planner's `checkouts` still answers through the extracted function).

- [ ] **Step 7: Deploy the front**

Run: `cd "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" && git status --short` (must equal `BASELINE`), then `./deploy-front.sh`.
Expected: `✓ Deployed.` The script stamps `sw.js` and `v3/sw.js`; leave the stamp uncommitted (both files carry other uncommitted hunks), as before this plan.

- [ ] **Step 8: Verify the front in prod (read only)**

```bash
curl -sSI https://stunning-kleicha-f61101.netlify.app/manager/screens/planning.js | grep -iE "^HTTP|cache-control"
curl -sS https://stunning-kleicha-f61101.netlify.app/manager/screens/planning.js | head -1
curl -sS https://stunning-kleicha-f61101.netlify.app/manager/app.js | grep -c "renderPlanning"
curl -sS https://stunning-kleicha-f61101.netlify.app/manager/index.html | grep -c "planning.css"
curl -sS https://stunning-kleicha-f61101.netlify.app/manager/ui/tokens.css | grep -c "\-\-pc-sub"
```
Expected: `HTTP/2 200`, `cache-control: no-cache`; the file starts with `// Ecran Planning`; counts `1`, `1`, `3`.

- [ ] **Step 9: Real-data check with Hillal (spec section 8, read only)**

Cross-check the current week with SQL (`execute_sql`, read only; replace the Monday if the week changed):

```sql
with k as (
  select reservation_key, substring(reservation_key from '(\d{4}-\d{2}-\d{2})')::date as d
  from cleaning_assignments group by reservation_key)
select
  (select count(*) from k where d between date_trunc('week', (now() at time zone 'Asia/Dubai'))::date
                                and date_trunc('week', (now() at time zone 'Asia/Dubai'))::date + 6) as assigned_keys_this_week,
  (select count(*) from extra_cleanings where status <> 'cancelled'
     and cleaning_date between date_trunc('week', (now() at time zone 'Asia/Dubai'))::date
                           and date_trunc('week', (now() at time zone 'Asia/Dubai'))::date + 6) as extras_this_week,
  (select json_agg(x) from (select c.name, l.start_date, l.end_date from leave_requests l join cleaners c on c.id = l.cleaner_id
     where l.status = 'approved' and l.end_date >= date_trunc('week', (now() at time zone 'Asia/Dubai'))::date
       and l.start_date <= date_trunc('week', (now() at time zone 'Asia/Dubai'))::date + 6) x) as leaves_this_week;
```

Ask Hillal to open `https://stunning-kleicha-f61101.netlify.app/manager/#/planning` signed in with his email, on phone and on desktop, next to the old Planner (`/?legacy=1`, Planner tab, same week), and check:
- the same cleanings on the same days (the new week runs Monday to Sunday, the old one starts today), same assignees, cancelled ones struck through;
- Faiza, Pionah and Elite each in their own colour, unassigned in red, extras dashed;
- the leaves of the SQL above show as "X off" on their days; public holidays in the day header;
- a done cleaning of Faiza or Pionah shows "Linen N" when a count exists.

If Hillal makes a real gesture himself (for example Postpone then Undo, or a linen correction), check its trace:

```sql
select action, actor, details, created_at from cleaning_log
where action in ('assigned','unassigned','marked_done','marked_undone','cancelled','uncancelled','postponed','unpostponed',
                 'laundry_counted','extra_created','extra_updated','extra_deleted')
  and created_at > now() - interval '1 day' order by created_at desc limit 15;
```
Expected: actor = his name, never `Manager`. Do not make writes yourself in prod.

- [ ] **Step 10: Report and clean up**

Report to Hillal (French): what is live, the link, what was checked in prod and what was not, the decisions below, and the next phase (Inspections in the shell). After his validation only, remove the worktree:

```bash
rm "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3/node_modules"
git -C "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3" status --short   # only untracked deno.lock files may remain: delete them
git -C "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" worktree remove "/Users/hillal/Documents/Wix new/hk-planner-mgr-phase3"
git -C "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" branch -d mgr-phase3
git -C "/Users/hillal/Documents/Wix new/hk-planner-repo.nosync" config --get core.bare   # must print false
```

---

## Self-review (done while writing)

- **Spec coverage (9.3 and section 4 Planning row):** week grid (Task 5), day on phone (Task 5), assign / reassign (Task 6), extras (Task 9), cancel / postpone (Task 7), done (Task 6), linen per cleaning (Task 8), leaves visible (Tasks 3, 5, 6). Section 3 colour per person (Tasks 2, 5). Section 6 reuse of existing actions, no duplicated write logic (only `loadCheckoutsCached` extracted and shared), session author (Task 1). Section 7 cache "Data from", 15 s timeout and Retry, server message as is, idempotency by key (Tasks 1, 5, 7, 9). Section 8 deno on the fake DB (Tasks 1 to 3), Playwright at 390 and 1440 px, light and dark, no horizontal scroll (Task 5), prod read-only check (Task 10).
- **Placeholders:** none; every code step has its full code.
- **Names across tasks:** `assignable` (Task 3 payload, Tasks 6 and 9 views), `slot` values `p1..p4/sub/other/none` (Tasks 2, 3, 5 CSS), `ACT` keys equal the `data-pa` values of the views (`assign`, `toggle`, `save-assign`, `clear-assign`, `done`, `undone`, `cancel`, `confirm-cancel`, `restore`, `postpone`, `confirm-postpone`, `restore-date`, `laundry`, `lq-step`, `save-laundry`, `edit-extra`, `x-save`, `x-delete`, `x-delete-confirm`, `back`), sheet functions `<view>Sheet` (`assign`, `cancel`, `postpone`, `laundry`, `extra`, `delete`).
- **Review Focus:** each line has its tests in the owning task (listed in the section).

## Decisions taken where the spec is silent (for Hillal's review)

1. **Week = Monday to Sunday, Dubai calendar.** It opens on the current week; on phone it opens on today (or Monday for another week). Prev / This week / Next, up to 26 weeks back or ahead. The old Planner's week starts today; the new one does not.
2. **Colours:** Faiza violet, Pionah pink (active cleaners in name order, four colours then they repeat), Elite sky blue, unassigned red. "Extras" in the spec read as **extra cleanings**: their card has a dashed border and "Extra" in place of the checkout time, coloured by who does it. Five person colours are added to the tokens, light and dark.
3. **One Hostaway path.** `mgr.planning` reads departures through the same cached path as the old Planner (`checkouts` and its 2 to 10 minute server cache), extracted into one function used by both. No new Hostaway call.
4. **Several people on one cleaning stays** (44 such cleanings in 30 days, Faiza and Pionah together): the picker toggles people and Save replaces the list; "Clear all" unassigns. Service type kept as is (100 % CHC), no picker.
5. **Leaves:** approved leaves of everyone except the system account, shown as "Faiza off" in the day header and as a "Leave" line in the cleaning panel; in the picker the person is greyed "On leave" (still removable if already assigned). The leave type is never sent to the screen.
6. **Mark done does not force the linen count** (Today already works this way; Elite counts 7 of 149). Each card shows "Linen N" once counted; the panel offers "Count linen" or "Edit linen count", seven fields all required, as in the old sheet.
7. **Postpone = one day later only** (19 of 19 postponements since July were one day), with Undo and "Restore date". Postponing again keeps the very first original date. A done cleaning cannot be assigned, postponed or cancelled (only Undo done, linen, edit extra).
8. **Cancelled cleanings stay visible**, struck through, with reason and author, and a "Restore cleaning" button.
9. **Status words on Planning:** Done (green), Unassigned (red), Usually Elite (amber, future days) and Usually Elite · not logged yet (amber, until 14:00 the next day), Not marked done (amber, past days), In progress, Scheduled (no pill), Cancelled, Guest arrives first (red, a cleaning postponed after the next check-in). The postpone panel warns before that happens.
10. **Extra cleanings:** same fields as the old form (price billed required), assignee chosen at creation among active cleaners and Elite (the old form offered cleaners only); edit and delete (with a confirmation) from the cleaning panel.
11. **Idempotency without a migration:** every write carries an idempotency key (reused after an uncertain failure). Only "Add extra" needs it on the server: the key gives the extra's reservation key, so a replay finds the row already created. The other writes already replace a value (set, upsert, delete) and stay safe when replayed.
12. **Session author extended** to the linen count (36 of the last 67 counts were signed "Manager"), extra creation, and now also logged on extra edit and delete. Applies to the old app too.
13. **Read-only cache:** the last week viewed is kept on the device per account; on a network failure it shows with "Data from HH:MM" and no gesture is possible.
14. **Person filter chips** (Everyone, each person with their week count, Unassigned), same idea as the old Planner's cleaner filter; the filter resets when leaving the screen.
15. **No keyboard shortcuts and no week in the URL** on Planning (none in the spec); Escape closes panels, cards are focusable buttons.
16. **Public holidays** show in the day header (read from the HR holiday table).
