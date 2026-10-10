# Phase 5a More, revue finale : rapport des correctifs

1. Reviews (CRITICAL) : more-reviews.js. Ecouteur nomme `onClick`, retire via `ctx.onLeave(() => main.removeEventListener(...))`, garde `ctx.isCurrent()` dans le gestionnaire et en tete de `load()` (avant le premier affichage).
   - RED : test "revenir sur Reviews apres More" (more-reviews.spec.ts) en echec avant correction (carte non mise a jour, ecouteurs empiles, requetes doublees).
   - GREEN : passe, exactement une requete updateDisputeStatus.
2. CSS (IMPORTANT) : more.css `.tm` -> `.tm-page`, `.ap` -> `.ap-page`; more-team.js et more-apartment.js mis a jour (liste + fiche).
   - RED : test today.spec.ts "les classes de More ne fuient pas" en echec (display: flex sur `.job .tm`).
   - GREEN : display non flex, gap normal.
3. Fiche logement : `mgr.apartment` sans part ne charge plus Hostaway et renvoie `cleanings: null`. `?part=cleanings` (meme action, meme controle d'acces, pas de nouvelle ROUTE) appelle `mgrApartmentCleanings` (listing, cleanings, unavailable, generatedAt). Front : fiche affichee d'abord, section « Loading cleanings... », second appel, erreur avec bouton Retry propre a la section. Une panne de la table cleaners ne marque plus `cleanings` indisponible dans la fiche.
   Tests Deno (fiche, part=cleanings, pannes) et Playwright (chargement differe, echec + Retry, ordre des appels).
4. healthScore : statut absent = 'open', priorite via normPriority. Test Deno : ticket status null + priorite 'High', score et liste concordent ; getPropertyHealth appelle toujours healthScore.
5. Inspections : `inspHistory` remplace par une lecture legere (inspections + inspection_items) avec controle d'erreur ; erreur => `unavailable: ['inspections']`. Test Deno sur les deux tables.
6. more-apartment.js : plus de « Unassigned » sur un menage annule.
7. mgr_settings.ts : `templateItems(t).items.length` ; test Deno avec items en texte JSON (et JSON casse = 0).
8. app.js deleteCleaner : `apiWrite` + toast du message serveur en cas de refus, pas de « Removed ».

## Commandes et resultats
- `deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/` : 623 passed, 0 failed.
- `deno check --node-modules-dir=none index.ts` : OK.
- `npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop` : 317 passed, 7 skipped, 0 failed.
- `npx playwright test tests/team-invite.spec.ts tests/smoke.spec.ts` : 39 passed, 3 skipped, 0 failed.

Note : RED/GREEN verifie pour 1 et 2 ; pour 3 a 5 et 7 les tests ont ete ecrits avec le code (pas de run RED separe).
