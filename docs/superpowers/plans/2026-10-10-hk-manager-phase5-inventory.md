# Inventory of the old manager « More » screens (10/10/2026, read-only pass)

Paths relative to the repo; `idx` = `supabase/functions/hostaway-proxy/index.ts`. Line numbers as of main 5e203b2.

## Gating facts
- Every action needs `X-App-Secret` (public in the bundle, not a protection). Role checked in code only for: `saveCleaner`, `inviteCleaner`, `pushTest`, `setDone`/`setCancelled`/`setPostponed`, `hr*` (`hrAuth` idx:485), `insp.*` (`INSP_ROLES`).
- Not gated: `getCleanerRatings`, `getCleaningAccounting`, `listCleaningAccountingMonths`, `getDisputes`, `updateDisputeStatus`, `getVendors`, `saveVendor`, `deleteVendor`, `saveEquipment`, `savePreventiveMaintenance`, `addMaintenanceCost`, `getConfig`, `setConfig`, `runAutopilot`, `getDashboardKPIs`, `getPropertyHeatmap`, CSV exports. `deleteCleaner` deactivates without a manager check (Auth account deletion needs one, idx:1908).
- Author from the browser still trusted: `updateDisputeStatus.updated_by` (app.js hard-codes `'walter'`, app.js:6457, 6468), `addTicketComment.author`, `addMaintenanceCost` (none).
- Old `api()` (app.js:1371) returns `{error}` instead of throwing: several screens toast success on failure.

## Old More menu (app.js:3258-3272)
Subs (`renderSubcontractors` 6589), Ratings (`renderCleanerRatings` 6343), Reviews (`renderReviews` 6484), HR (`renderHR` hr.js:311), Settings (`renderSettings` 6082), History (`renderHistory` 6199), Calendar (~6243), Stats (`renderCleanerStats` 6699), Security (`renderSecurity` 3811), Inspections (`/inspections/`). Dashboard and Maintenance are main-nav tabs.

## A. Team
- Settings › Team Members (app.js:6082-6125), handlers app.js:139-207, `saveCleaner` 2425, `deleteCleaner` 2435. Actions: `getCleaners` idx:1809, `saveCleaner` idx:1816 (manager session), `deleteCleaner` idx:1880, `inviteCleaner` idx:1930 (manager session), `linkEmail` idx:1968. « No PIN » always shown: PIN hash no longer read (app.js:6097). Role select omits subcontractor. Tests: `tests/team-invite.spec.ts`, deno `auth_test.ts`.
- HR: `hr.js` (1036 lines), `renderHRManager` 392, `renderHRDetail` 533. Actions idx:3181-3585 (`hrOverview`, `hrMyLeave`, `hrSubmitLeave`, `hrDecideLeave` owner only, `hrCancelLeave`, `hrLeaveForm`, `hrSaveHoliday`, `hrDeleteHoliday` owner, `hrSaveEmployee`, `hrDeleteEmployee` owner, `hrSaveDocument`, `hrDeleteDocument`, `hrGetCompensation` owner). Tests `tests/hr.spec.ts`.
- Ratings: `renderCleanerRatings` app.js:6343, all French strings. `getCleanerRatings` idx:4486 (payload_json.cleaners[cid] avg_cleanliness_all_time/_90d, details[]).
- Stats: `renderCleanerStats` app.js:6699, returns early for managers (blank). Candidate data: `getDashboardKPIs.cleanerPerformance` idx:3035.

## B. Reviews
`renderReviews` app.js:6484, `renderDisputeCard` 6513, `setDisputeStatus` 6455, `toggleReplyPosted` 6465. `getDisputes` idx:4329 (→ reviews[] with `dispute` row: removable, confidence, ground, template, quote, angle, evidence[], public_reply, public_review_en, dispute_status, reply_posted…), `updateDisputeStatus` (enum todo/submitted/removed/rejected/not_disputable). No tests.

## C. Maintenance setup
`renderMtVendors` 7280, `renderMtEquipment` 7307, `renderMtPreventive` 7347; handlers 3047-3083. Actions idx:2694-2825: `getVendors`, `saveVendor` (specialty required), `deleteVendor`, `getEquipment`, `saveEquipment`, `getPreventiveMaintenance`, `savePreventiveMaintenance`, `completePreventive` (session actor), `getMaintenanceCosts`, `addMaintenanceCost` (no UI anywhere), `getPropertyHealth` idx:2826 (no caller), `exportMaintenanceCsv`. No edit UI, equipment lacks install_date so service-due never fires.

## D. Reports
- Dashboard `renderDashboard` app.js:5517-5943 (ops / revenue / properties), computed in the browser from `checkouts` + `getAllData`; `getDashboardKPIs` idx:3035, `getPropertyHeatmap` idx:3588.
- Elite tariff hard-coded: `ELITE_COST_HT_BY_BR` app.js:1598 (used by `computeRevenuePerCleaner` and `generateInvoice` 7672), `_ELITE_COST` app.js:5555. Server: `getSubcontractorPricing` idx:2163 (no caller), accounting snapshot `getCleaningAccounting` idx:4446, `listCleaningAccountingMonths` idx:4457 (fed hourly by a VPS job not in this repo).
- Exports: `exportExcel` 7622, `exportPDF`, `exportCleaningsCsv` idx:3700, `exportMaintenanceCsv` idx:3775, `generateOwnerReport` 7539, `exportSubCsv` 2406.

## E. Apartment
- History x3: `renderHistory` app.js:6199 (`getLogs` idx:2537, raw feed), maintenance resolved modal app.js:3215, `inspections/history.js`.
- Health x3: `getPropertyHeatmap` (100 − 5×open − 10×urgent − cost/500 − rating), dead `renderMtHealth` 7376, `getPropertyHealth` idx:2826 (100 − 5×open − 10×urgent − 8×overdue equipment − rating).
- Security: `renderSecurity` app.js:3811, `getSecurityContacts` idx:4495 (`security_contacts.ts`, session required, doc in `security_contacts_doc`), shows portal passwords. Tests `tests/security.spec.ts`.

## F. Settings
`renderSettings` app.js:6082-6188: Team, account setup, Autopilot (`getConfig` idx:2900, `setConfig` idx:2913 ungated upsert of any key, `runAutopilot` idx:2923 mutating GET on the UTC date), checklist templates read only, push (`getVapidPublicKey` idx:2059, `savePushSubscription` idx:2069, `deletePushSubscription`, `pushTest` idx:2118; front app.js:3504-3530), WhatsApp recap links, language. Inspection target has no UI (`app_config.inspections_daily_target`, `readTarget` insp_read.ts:87). Exclusions only in `/inspections/` fleet (`insp.setExcluded`).
