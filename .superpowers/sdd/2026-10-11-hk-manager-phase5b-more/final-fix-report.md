# Final fix report, More 5b

1. Sante sans guest_feedback: mgr_apartment.ts readHealthInputs lit 3 tables (tickets, equipment, costs), feedback = [] , ratingPenalty 0. getPropertyHealth garde ses champs (avgRating 0, totalFeedback 0). Tests: fixtures sans guest_feedback, test "ne lit jamais guest_feedback", scores de la fiche +5. Note: getPropertyHeatmap et getFeedback/addFeedback (index.ts) interrogent encore guest_feedback par listing_id (ancien code, non touche).
2. app.js createPreventiveFromInsight: apiWrite + try/catch, toast d erreur avec le message serveur, pas de toast de succes.
3. more-setup.js: apres "Task marked done, but..." le panneau est ferme, message en toast, liste relue. Test Playwright: un seul completePreventive, panneau ferme.
4. more-hr.js: id valide = /^[1-9]\d*$/ sinon apercu RH ; ctx.isCurrent() apres l import. Tests: abc, 0, -2, 1.5 ; changement d ecran pendant le chargement.
5. app.js exportCsv: 401 suit les memes sorties que api() (signOut email + ecran login, ou retour PIN) ; autres erreurs gardent le message serveur ; erreur reseau en toast.
6. kpis.ts: completions des 7 jours par jour Dubai de updated_at (dubaiDay). kpis_test: [09,10,11] = [1,0,1] (r2 a 01:30 Dubai le 11).
7. more.js: branche r.legacy supprimee (aucun CSS dedie).
8. manager/api.js download(): delai propre de 60 s (crochet __MGR_TIMEOUT_MS) couvrant en-tetes et res.blob(). Test: corps qui n arrive jamais, message "taking too long", bouton libre.
9. more-reports.js rowsToCsv: BOM UTF-8 en tete ; test octets EF BB BF + texte exact.

## Commandes et resultats
- deno test --node-modules-dir=none -A supabase/functions/hostaway-proxy/ : 665 passed, 0 failed
- deno check --node-modules-dir=none index.ts : rc 0
- npx playwright test tests/manager --project=mgr-mobile --project=mgr-desktop : 463 passed, 7 skipped, 0 failed
- npx playwright test tests/smoke.spec.ts tests/team-invite.spec.ts : 39 passed, 3 skipped, 0 failed
