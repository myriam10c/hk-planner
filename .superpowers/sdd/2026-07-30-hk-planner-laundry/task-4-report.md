# Task 4 Report: Blocking laundry sheet on the cleaner side

## Changes made

### app.js

**1. `bulkMarkDoneSelected` (line 491)**
Changed `await markDone(k)` to `await markDone(k,{skipLaundry:true})` so bulk operations bypass the sheet.

**2. `markDone` (line 1513)**
Changed signature from `markDone(key)` to `markDone(key,opts)`. Added the guard as the first thing in the `nw` path:
```
if(nw&&!(opts&&opts.skipLaundry)){openLaundrySheet(key);return;}
```
All other call sites (data-action on cards, table rows, context menu, and the `#doneYes` overlay at line 1967) pass no opts so `opts` is `undefined` and the sheet opens.

**3. Laundry cleaner sheet section (inserted between laundryPrefill and the RENDER banner)**
Added the full block specified by the brief:
- `laundryCountCache` and `laundrySheetKey` module-level state
- `openLaundrySheet(key)` - opens sheet, fires async prefill fetch
- `closeLaundrySheet()` - clears key and re-renders
- `__closeLaundrySheetBackdrop(e)` - guard function for overlay clicks (same pattern as `__closeExtraModalBackdrop`)
- `renderLaundrySheet()` - builds the DOM into `#laundrySheet`
- `readLaundrySheetValues()` - reads lq_ inputs into a plain object
- `syncLaundryConfirm()` - gates the Confirm button on `laundryParseCounts`
- `laundryStep(inputId, delta)` - clamps 0-999, id-based (not key-based) to avoid collision with Task 5 lm_ prefix
- `submitLaundrySheet()` - validates, calls `apiWrite('saveLaundryCount', ...)`, updates cache, closes sheet, calls `markDone(key,{skipLaundry:true})`

**4. `renderCleaningDetailPane` Actions section (line 3716)**
Added Laundry button after the Mark done / Undo button:
```javascript
h += '<button class="btn-secondary" data-action="openLaundrySheet" data-arg0="'+esc(k)+'">'+icon('clipboard',14)+' Laundry</button>';
```

### styles.css
Appended the `/* ============ LAUNDRY SHEET ============ */` block with 10 rules as specified verbatim.

## Decisions made

- `laundryCountCache` keyed by reservation key; `undefined` means not yet fetched, `null` means fetched but no prior submission. This lets the prefill path run exactly once per session per key.
- `renderLaundrySheet` uses `(RESERVATIONS||[])` to guard against early calls before data loads.
- `parsed.values` in `submitLaundrySheet` is the correct property name as returned by the actual `laundryParseCounts` implementation (which returns `{ok:true, values:out}`).
- `data-arg1="-1"` on the minus button: the delegated handler coerces numeric-looking strings, so delta arrives as number -1, not string. No `Number()` call added around delta in `laundryStep`.
- No `data-stop-propagation` on the modal box: the brief explicitly warns this would be ignored. The guard function `__closeLaundrySheetBackdrop` checks `classList.contains('modal-overlay')` instead.
- The Laundry button is added in `renderCleaningDetailPane` (desktop detail pane) only, not in `renderCardDetail` (mobile expanded card), because the brief specifies "line 3499" which resolves to the actions section of `renderCleaningDetailPane`. The `renderCardDetail` function does not have a visible actions row with Mark done in the same style.

## Test evidence

All 23 tests pass locally:
- `tests/laundry.spec.ts` (desktop): 9/9
- `tests/smoke.spec.ts` (desktop): 6/6
- `tests/helpers.spec.ts` (desktop): 8/8

Run against `http://localhost:8888` (python3 -m http.server 8888).

No console errors, no JS pageerrors.

## Uncertainty

One minor ambiguity: the brief says "line 3499" for where to add the Laundry button, with context "next to the existing Mark done / Undo buttons in `renderCardDetail`". In the actual codebase the Mark done / Undo buttons appear in two functions: `renderCardDetail` (mobile) and `renderCleaningDetailPane` (desktop). The line number 3499 resolves to the desktop pane. The brief's intent (a way to reopen the sheet to fix a wrong count) makes more sense in a persistent pane than in the toggled mobile card. Added to `renderCleaningDetailPane` only, matching the line reference.

## Fix round 1 (controller-applied)

The dispatched fix subagent died on an API error after making no commits, so the
controller applied these directly.

1. **Critical, corrections un-marked the cleaning.** `submitLaundrySheet` ended
   with an unconditional `markDone(key,{skipLaundry:true})`, but `markDone` is a
   toggle, so confirming from the Laundry correction button reverted a finished
   cleaning to not-done and POSTed `setDone{done:false}`. Now captures
   `wasDone` before closing the sheet and only hands off when the cleaning is not
   already done, toasting "Laundry count saved" otherwise. New
   `laundryConfirmLabel(key)` drives the button copy so it reads "Save count"
   instead of promising a mark-done it will not perform. Used in the initial
   render and in the save-failure restore path.
2. **Important, late prefill wiped typed input.** `openLaundrySheet` repainted
   unconditionally when `getLaundryCount` resolved. Added `laundrySheetIsBlank()`
   and gated the repaint on it, so a prefill landing after the cleaner started
   typing is dropped rather than clobbering her entry.
3. **Important, Escape left state stale.** The global Escape handler only blanked
   the overlay's parent, leaving `laundrySheetKey` set so a late prefill could
   repaint a dismissed sheet. Added a laundry branch calling `closeLaundrySheet()`
   before the generic branch.
4. **Important, no inner padding.** `.laundry-box` now sets `padding:20px` with
   `box-sizing:border-box`. Verified by screenshot at a 390x844 viewport. The
   same screenshot showed the confirm button wrapping to two lines and its
   disabled state being visually identical to enabled, so `.laundry-actions` now
   sizes the two buttons asymmetrically and `button[disabled]` fades to 0.45.
5. **Minor, iOS selection.** `inp.select()` deferred with `setTimeout(...,0)`;
   iOS Safari collapses the selection right after the focus handler returns.
6. **Minor, gating mismatch.** The desktop pane showed the Laundry button for
   cancelled cleanings while the mobile detail hid it. Both now hide it.
7. **Minor, `laundryStep` destroyed decimals.** `"2.5"` plus one produced `"1"`.
   Now rounds rather than resetting to zero.
8. **Regression coverage.** Seven tests appended to `tests/laundry.spec.ts`.
   They drive the real functions: `app.js` is a classic script, so top-level
   `function` declarations are on `window` and stubbable, while `let` state is
   not readable, so done-state is observed through the confirm button's label.
   Verified each new test fails against the unfixed code before the fix:
   finding 1 gave `"Confirm & mark done"` instead of `"Save count"`, finding 2
   gave `"9"` instead of `"7"`, finding 3 left the sheet re-rendered.

Deferred, argued not worth fixing: the dead `if(!parsed.ok)` branch in
`submitLaundrySheet` (unreachable because `syncLaundryConfirm` disables the
button on the same predicate, but harmless as a belt-and-braces guard), and the
`savingDone` race where a concurrent cleaning's undo timer can swallow the
mark-done silently (pre-existing app-wide behaviour, not introduced here).

Test evidence: 57 passed, 3 skipped (desktop-only specs skipped on mobile),
across both the desktop and the mobile/webkit projects, served locally.
