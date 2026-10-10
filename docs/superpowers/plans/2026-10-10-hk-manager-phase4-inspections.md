# HK Manager phase 4 · Inspections dans le shell · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Inspections entry of `/manager/` renders the existing Inspections screens (Today, Inspect, Fleet, History, Reports) inside the manager shell, with the manager navigation kept and the manager look.

**Architecture:** Front only, no proxy change. A new adapter screen `manager/screens/inspections.js` maps the manager hash `#/inspections/<sub>` to the existing `inspections/*.js` modules, creates a host `<div id="view" class="insp">` inside `#main` (the modules look up `#view` by id), and gives them a ctx with `go` translated to manager hashes. A scoped stylesheet `manager/ui/inspections.css` restyles their markup with manager tokens (light and dark). `/inspections/` keeps working standalone and unchanged except for two `ctx.embedded` tweaks.

**Tech Stack:** Vanilla ES modules without build, Playwright (projects `mgr-mobile`, `mgr-desktop`, `insp-mobile`, `insp-desktop`).

**Spec:** `docs/superpowers/specs/2026-10-09-hk-manager-app-design.md` (section 4 row « Inspections », section 6 « Les écrans Inspections sont importés depuis `inspections/*.js` et rendus dans le shell (`/inspections/` reste servi tant qu'il a des liens) », section 9 phase 4).

## Global Constraints

- UI in English. No em dash (U+2014) in any UI string.
- No duplicate of Inspections logic: the manager imports `/inspections/*.js`, never copies them.
- `/inspections/` standalone must behave exactly as before (its Playwright suite stays green, `insp-mobile` and `insp-desktop`).
- Manager writes keep the author from the session: the Inspections modules already send the session token through `/inspections/api.js`; do not add an `actor` field.
- Phone (390 px) and desktop (1440 px) equally, light and dark, no horizontal scroll, tap targets ≥ 44 px, body text ≥ 16 px.
- Git: never `git stash`, never `git add -A`; add files by name.
- Comments in French without accents, like the surrounding code.

## Review Focus

1. Moving inside Inspections (Start inspection, Back, Fleet → History, Reports) keeps the manager tab bar or sidebar, with Inspections marked current. Test in Task 1.
2. Leaving an inspection mid-way through the tab bar (Today) runs the module's `onLeave` cleanup and shows Today with no console error. Test in Task 1.
3. After « Inspection saved » the module calls `go('#/')`: the shell must land on `#/inspections` with a fresh Today list (and a `go` to the current hash must re-render, not freeze). Test in Task 1 (finish flow).
4. Shell started without a signed-in member (`me` null, stale session offline): a clear message, never a crash or blank screen. Test in Task 1.
5. Phone 390 px: the Inspect screen's last zone and Finish button are not hidden under the tab bar, no horizontal scroll; dark mode text is readable. Test in Task 2.

---

### Task 1: Adapter screen, routing and embedded tweaks

**Files:**
- Create: `manager/screens/inspections.js`
- Modify: `manager/app.js` (SCREENS map)
- Modify: `inspections/today.js:69` (hide « Back to HK Planner » when embedded)
- Modify: `inspections/fleet.js:39`, `inspections/reports.js:67` (home button label when embedded)
- Modify: `manager/screens/today-view.js` (`controlHtml`, link to Inspections)
- Modify: `tests/manager/shell.spec.ts` (Inspections is no longer a placeholder)
- Test: `tests/manager/inspections.spec.ts` (new)

**Interfaces:**
- Consumes: manager ctx `{ me: {id, name} | null, main, isCurrent, onLeave, emailRequired }` (built in `manager/app.js` `route()`); `esc`, `toast` from `/manager/ui/dom.js`; Inspections modules `renderToday(ctx)`, `renderInspect(ctx)` (needs `ctx.listingId`, `ctx.entry`), `renderFleet(ctx)`, `renderReports(ctx)`, `renderHistory(ctx)` (needs `ctx.listingId`). Their ctx contract: `{ me: {cleaner_id, name, role}, go(hash), toast(msg), render(html), esc, isCurrent(), onLeave(fn) }`; they read `document.getElementById('view')` and set `view.onclick/oninput/onchange` on it.
- Produces: `export function parseInspHash(hash) -> { sub: '' | 'inspect' | 'fleet' | 'reports' | 'history', id: string | null, entry: string | null }`, `export function toShellHash(inspHash) -> string`, `export async function renderInspections(ctx)`. Host element `#view.insp` inside `#main` (Task 2 styles `.insp`). Inspections ctx flag `embedded: true`.

- [ ] **Step 1: Write the failing tests** in `tests/manager/inspections.spec.ts`. Use `bootMgr`, `MANAGER`, `me`, `fetchLog`, `noHorizontalScroll` from `./helpers`. Fixtures: copy the shapes of `tests/inspections/today.spec.ts` (`card()`, `TODAY` with `match: 'action=insp.today'`) and of `tests/inspections/fleet.spec.ts`, `history`/`inspect` specs for `insp.fleet`, `insp.history`, `insp.start` (read those files for the exact response shapes; do not invent fields). Tests:
  1. `#/inspections` shows « Today's inspections », the card « Apt 101 · Tower A », the nav entry Inspections has `aria-current="page"`, there is no link « Back to HK Planner », and `document.querySelectorAll('main').length === 1` (the adapter turns the modules' `<main>` into `<section>`).
  2. Click « Fleet » → `location.hash === '#/inspections/fleet'`, heading Fleet visible, nav still visible, Inspections still current; the Fleet home button reads « Back » and returns to `#/inspections`.
  3. From Fleet, open an apartment → hash `#/inspections/history/<id>`, its name as heading; « Back to fleet » → `#/inspections/fleet`.
  4. As manager, « Reports » button visible on Today and opens `#/inspections/reports`.
  5. « Start inspection » on a claimed card → hash `#/inspections/inspect/A?e=checkout` and the zone list renders (fake `insp.start`); click the Today tab → Today manager screen renders (`mgr.today` fake from `tests/manager/fixtures.ts`) and no `pageerror` was raised during the test (listen with `page.on('pageerror')`).
  6. Finish an inspection (all zones OK, then Finish, with the fake `insp.item` / `insp.finish` responses used in `tests/inspections/inspect.spec.ts`): toast « Inspection saved », hash back to `#/inspections`, Today's inspections visible.
  7. Module load failure: `page.route('**/inspections/fleet.js', r => r.abort())` then go to `#/inspections/fleet` → message « Could not load Inspections. » with a « Retry » button and a link to `/inspections/`.
  8. `me` null: boot with an email session whose `cleanerMe` fails offline (`fail: true` route) → the shell starts (existing behaviour) and `#/inspections` shows « Inspections need a connection. » with a Retry button, no `pageerror`.
  9. Unit checks through `page.evaluate(async () => { const m = await import('/manager/screens/inspections.js'); return [...] })`: `parseInspHash('#/inspections')` → `{sub:'', id:null, entry:null}`; `'#/inspections/inspect/12%2034?e=vacant'` → `{sub:'inspect', id:'12 34', entry:'vacant'}`; `'#/inspections/history'` (no id) → sub `''`; `'#/inspections/zzz'` → sub `''`; `toShellHash('#/')` → `'#/inspections'`; `toShellHash('#/fleet')` → `'#/inspections/fleet'`; `toShellHash('#/inspect/A?e=adhoc')` → `'#/inspections/inspect/A?e=adhoc'`.
  Also add to `tests/manager/today.spec.ts` (or the new file) a check that Today's « Team control » block has a link « Open inspections » with `href="#/inspections"`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/manager/inspections.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (placeholder screen « Inspections move into this app in a later phase. »). Before running, check port 8890 with `lsof -i :8890` as the config's web server uses it.

- [ ] **Step 3: Create `manager/screens/inspections.js`**

```js
// Inspections dans la coquille manager (spec section 6, phase 4) : les ecrans de
// /inspections/*.js sont importes tels quels et rendus dans #main. Ils cherchent
// #view par id : on le cree ici, neuf a chaque route, ce qui efface leurs
// gestionnaires view.onclick/oninput/onchange.
import { esc, toast } from '/manager/ui/dom.js';

const SUB = {
  '': ['/inspections/today.js', 'renderToday'],
  inspect: ['/inspections/inspect.js', 'renderInspect'],
  fleet: ['/inspections/fleet.js', 'renderFleet'],
  reports: ['/inspections/reports.js', 'renderReports'],
  history: ['/inspections/history.js', 'renderHistory'],
};
const NEEDS_ID = { inspect: true, history: true };

// '#/inspections/inspect/12?e=vacant' -> { sub: 'inspect', id: '12', entry: 'vacant' }.
// Sous-ecran inconnu ou sans identifiant requis : Today, comme /inspections/.
export function parseInspHash(hash) {
  const rest = String(hash || '').replace(/^#\/?inspections\/?/, '');
  const cut = rest.indexOf('?');
  const path = cut === -1 ? rest : rest.slice(0, cut);
  const q = new URLSearchParams(cut === -1 ? '' : rest.slice(cut + 1));
  const parts = path.split('/').filter(Boolean);
  let sub = parts[0] || '';
  let id = null;
  if (!Object.prototype.hasOwnProperty.call(SUB, sub)) sub = '';
  if (NEEDS_ID[sub]) {
    try { id = parts[1] ? decodeURIComponent(parts[1]) : null; } catch (e) { id = null; }
    if (!id) sub = '';
  }
  return { sub, id: sub && NEEDS_ID[sub] ? id : null, entry: sub === 'inspect' ? (q.get('e') || null) : null };
}

// Hash relatif des modules Inspections ('#/', '#/fleet'...) -> hash de la coquille.
export function toShellHash(h) {
  const s = String(h || '#/').replace(/^#\/?/, '');
  return s ? '#/inspections/' + s : '#/inspections';
}

function go(h) {
  const t = toShellHash(h);
  // Meme hash : pas de hashchange natif, on relance la route a la main.
  if (location.hash === t) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = t;
}

function retry() { window.dispatchEvent(new HashChangeEvent('hashchange')); }

function message(ctx, title, text, withLink) {
  ctx.main.innerHTML = '<header class="top"><div><h1>' + esc(title) + '</h1></div></header>'
    + '<div class="ph"><p role="alert">' + esc(text) + '</p><button class="btn primary" type="button" data-insp-retry>Retry</button>'
    + (withLink ? ' <a class="btn" href="/inspections/">Open Inspections</a>' : '') + '</div>';
  ctx.main.querySelector('[data-insp-retry]').onclick = retry;
}

export async function renderInspections(ctx) {
  if (!ctx.me) { message(ctx, 'Inspections', 'Inspections need a connection. Check your connection and try again.', false); return; }
  const r = parseInspHash(location.hash);
  const [path, fn] = SUB[r.sub];
  let mod = null;
  try { mod = await import(path); } catch (e) { mod = null; }
  if (!ctx.isCurrent()) return;
  if (!mod || typeof mod[fn] !== 'function') { message(ctx, 'Inspections', 'Could not load Inspections. Check your connection and try again.', true); return; }
  ctx.main.innerHTML = '<div id="view" class="insp"></div>';
  const host = ctx.main.querySelector('#view');
  // Les modules rendent un <main> : un seul <main> par page, on le change en <section>.
  const render = (html) => { host.innerHTML = String(html).replace(/<(\/?)main\b/g, '<$1section'); };
  await mod[fn]({
    me: { cleaner_id: ctx.me.id, name: ctx.me.name, role: 'manager' },
    go, toast: (m) => toast(m), render, esc,
    isCurrent: ctx.isCurrent, onLeave: ctx.onLeave, embedded: true,
    listingId: r.id, entry: r.entry || 'adhoc',
  });
}
```

Notes for the implementer: verify `toast` in `/manager/ui/dom.js` accepts a single string (it is `toast(msg, undo)`). Check that `inspections/history.js` dialog (appended to `document.body`) is still removed or closed on route change; if it stays open after leaving, close it through `ctx.onLeave` in the adapter by removing any `dialog` the module appended (report what you found). If the regex replacement would hit the word « main » inside text, it cannot: it only matches `<main` and `</main` tags.

- [ ] **Step 4: Wire it in `manager/app.js`**

Add to `SCREENS`: `inspections: ['/manager/screens/inspections.js', 'renderInspections'],`. Keep `renderPlaceholder` fallback for other views; leave the `inspections` entry of `manager/screens/placeholder.js` (used only if the adapter module itself fails to import).

- [ ] **Step 5: Embedded tweaks in `/inspections/`**

`inspections/today.js` `head()`: render `<a class="btn ghost" href="/">Back to HK Planner</a>` only when `!ctx.embedded`. `inspections/fleet.js:39` and `inspections/reports.js:67`: the `data-act="home"` button label is `ctx.embedded ? 'Back' : 'Today'` (keep `data-act="home"`). Read how `ctx` is destructured in each function and use the right variable. No other change in `/inspections/`.

- [ ] **Step 6: Today link** in `manager/screens/today-view.js` `controlHtml`: after the « Inspections today » `.kv` block (and the unfinished list if any), inside the same `.ctl` div, add `'<a class="link" href="#/inspections">Open inspections</a>'`.

- [ ] **Step 7: Update `tests/manager/shell.spec.ts`**: remove the `inspections` row from `LINKS` (it is now a real screen) and add an assertion in the navigation test that clicking Inspections shows « Today's inspections » (add the `insp.today` fake route to that test's boot).

- [ ] **Step 8: Run the tests**

Run: `npx playwright test tests/manager tests/inspections --project=mgr-mobile --project=mgr-desktop --project=insp-mobile --project=insp-desktop`
Expected: all PASS (new tests, existing manager suite, and the standalone Inspections suite unchanged).

- [ ] **Step 9: Commit**

```bash
git add manager/screens/inspections.js manager/app.js inspections/today.js inspections/fleet.js inspections/reports.js manager/screens/today-view.js tests/manager/shell.spec.ts tests/manager/inspections.spec.ts
git commit -m "manager: Inspections dans la coquille (ecrans existants importes, hash traduit, un seul main)"
```

---

### Task 2: Manager look for the Inspections screens

**Files:**
- Create: `manager/ui/inspections.css`
- Modify: `manager/index.html` (stylesheet link after `planning.css`)
- Test: `tests/manager/inspections-look.spec.ts` (new)

**Interfaces:**
- Consumes: host `#view.insp` from Task 1; manager tokens in `manager/ui/tokens.css` (`--bg --surface --surface-2 --sunk --ink --ink-2 --ink-3 --line --line-2 --accent --accent-ink --accent-tint --ok --ok-ink --ok-tint --warn --warn-ink --warn-tint --bad --bad-ink --bad-tint --r-sm --r-md --r-lg --s1..--s10 --font-ui --font-mono --focus`), with dark values already defined there.
- Produces: nothing consumed by later tasks.

The Inspections markup uses these classes (from `inspections/insp.css`, 115 lines, tokens of `/v3/styles/tokens.css` which the manager does NOT load): `.actions .addphoto .also .bad .badge .badges .block .btn .card .card-top .chip .chips .choice .choices .count .detgrp .detlist .detrow .detrows .detsum .dim .dot .dot-green .dot-off .dot-orange .dot-red .filein .fix .fixedit .fixrow .fixsched .focus .focus-chk .focus-h .focus-item .focus-rep .focus-sum .frow .ghost .good .hist .inp .lbl .link .list .mute .note .notice .notok .nourl .off .ok .okbtn .overdue .pad .photo .primary .reason .rname .row .rrow .search .small .sr .state .sum .ta .thumb .thumbs .tile .tiles .top .top-actions .tstate .warn .when .who .wrap .zone .zone-item`, plus `h1`, `h3`. Manager `components.css` also defines unscoped `.bad .btn .card .link .note .ok .pad .primary .toast .top .warn`, which apply inside `.insp` too.

- [ ] **Step 1: Write the failing tests** in `tests/manager/inspections-look.spec.ts`, for `light` and `dark` (`test.use({ colorScheme })`), with the Task 1 fixtures (copy them, or move shared fixtures into `tests/manager/insp-fixtures.ts` and import from both files):
  1. `#/inspections` Today: the first `.insp .card` has a background different from `body` background, its `h3` text color has a contrast ratio ≥ 4.5 against the card background (compute with a small luminance helper in `page.evaluate`), and in dark mode the card background luminance is < 0.2.
  2. Every `.insp button, .insp a.btn` that is visible has `getBoundingClientRect().height >= 44`.
  3. `.insp` body text (`.reason` or `.mute`) computed `font-size` ≥ 16 px.
  4. No horizontal scroll on Today, Fleet, History and Inspect (`noHorizontalScroll`).
  5. Phone only (`mgr-mobile`): on Inspect, scroll to the bottom; the Finish button's bottom is above the tab bar's top (`#tabbar` rect) so it is tappable.
  6. Primary buttons (`.insp .btn.primary`) use the manager accent: computed background equals `getComputedStyle(document.documentElement).getPropertyValue('--accent')` resolved (compare against a probe element styled `background: var(--accent)`).

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/manager/inspections-look.spec.ts --project=mgr-mobile --project=mgr-desktop`
Expected: FAIL (unstyled modules: v3 tokens undefined, transparent cards, small buttons).

- [ ] **Step 3: Write `manager/ui/inspections.css`**

Port every rule of `inspections/insp.css` under the `.insp` prefix (each selector `X` becomes `.insp X`; `#toast-host` and any `body`/`html` rule are dropped since the manager has its own toast). Map tokens: `--line → --line`, `--ink → --ink`, `--bone-hi → --surface`, `--card → --surface`, `--sand → --sunk`, `--mute → --ink-2`, `--terra → --accent` (primary buttons and links; text on it `#fff`), `--moss → --ok-ink` (text) or `--ok` (dots), `--amber-ink → --warn-ink`, `--ember-ink → --bad-ink`, `--disp → --font-ui`; status chips/badges use the `--*-tint` backgrounds with `--*-ink` text like the manager pills. `.insp .wrap` drops its own side padding if `#main` already pads (check `components.css`), keeps `max-width: 720px` on phone and becomes wider on desktop only if the Today list reads well (keep 720 px if unsure). `h1` matches the manager screens' `header.top h1` (read `components.css`). Where a manager rule and the ported rule disagree for `.btn`, `.card`, `.top`, keep the manager look (radius, font) and only add what Inspections needs (`.ghost`, `.primary`, `.small`, `.okbtn`, `.notok`). Add bottom padding to `.insp` so the last element clears the phone tab bar (use the same value `#main` uses for other screens if it already does; report which). No new color literal except `#fff` on accent; no em dash in comments.

- [ ] **Step 4: Link it** in `manager/index.html` after `planning.css`: `<link rel="stylesheet" href="/manager/ui/inspections.css">`.

- [ ] **Step 5: Run the tests**

Run: `npx playwright test tests/manager tests/inspections --project=mgr-mobile --project=mgr-desktop --project=insp-mobile --project=insp-desktop`
Expected: all PASS.

- [ ] **Step 6: Look at it.** Take screenshots (Playwright `page.screenshot`, saved under the scratch path given in the dispatch, not in the repo) of Today, Fleet, History, Inspect with one zone open in Not OK, at 390 and 1440, light and dark. Read them and fix anything misaligned, clipped or unreadable. List the screenshot paths in the report.

- [ ] **Step 7: Commit**

```bash
git add manager/ui/inspections.css manager/index.html tests/manager/inspections-look.spec.ts
git commit -m "manager: Inspections au style manager (feuille limitee a .insp, clair et sombre)"
```
(Add `tests/manager/insp-fixtures.ts` and the Task 1 spec if you moved fixtures.)

---

### Task 3: Deploy and verify in prod (controller, not a subagent)

- [ ] Merge the branch into `main` (fast-forward, keeping the uncommitted `sw.js` stamp as in phases 2 and 3).
- [ ] `./deploy-front.sh` from the main tree. No proxy deploy (no proxy change; check `git diff --stat <base>..HEAD -- supabase` is empty).
- [ ] Prod checks: `/manager/screens/inspections.js` and `/manager/ui/inspections.css` served (200, no-cache), `/inspections/` still 200, `/inspections/today.js` contains `embedded`.
- [ ] Update memory `project_hk_manager_app.md` (phase 4 done) and report to Hillal with what to test: open Inspections in `/manager/`, start and finish one inspection, check the author.
