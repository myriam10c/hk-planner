# Cleaning money · design court (16/11/2026)

## Intention
Hillal ne lit pas la rentabilité du ménage dans HK Planner. Aujourd'hui l'app ne montre en argent que les ménages donnés à Elite (More > Reports > Elite accounting), et rien sur les ménages faits par l'équipe interne. Demande du 16/11/2026, mot pour mot : « dans l'app je veux juste savoir combien de CA génère le ménage fait par mon équipe, combien je prends sur Elite, et le bénéfice potentiel car pour le bénéfice net il faudra calculer toutes les dépenses variables ».

## Ce qui est livré
Un écran `/manager/#/more/money`, « Cleaning money », première ligne de More, par mois :
1. **Team revenue** : somme des cleaning fees (hors TVA) des ménages faits par l'équipe interne, et leur nombre.
2. **Kept on Elite** : cleaning fees des ménages Elite moins le coût Elite (hors TVA). C'est la marge Elite déjà calculée par le snapshot.
3. **Potential profit** : Team revenue + Kept on Elite. « Potentiel » = avant dépenses variables (commission OTA, produits, linge, salaires), dit en toutes lettres sur l'écran.
4. Bloc « Your team » : moyenne de ménages par cleaner et par jour travaillé, puis par cleaner : ménages, jours travaillés, moyenne par jour, CA généré.

## Hors périmètre (noté, pas fait)
- Bénéfice net (dépenses variables), projection de fin de mois, vue de charge par jour, Elite évitable.
- Ménages extra (`extra_...`) : exclus comme aujourd'hui.
- Mois antérieurs à la fenêtre de sync (3 mois glissants) : pas de chiffres équipe, l'écran le dit. On ne recalcule pas les anciens mois (le recalcul changerait aussi leurs chiffres Elite figés).
- Restriction au seul owner : non, même visibilité que Reports (managers). À resserrer si Hillal le demande (changement proxy).

## Approches
- **A (retenue)** : étendre le job VPS `sync_cleaning_accounting` (dépôt `~/business`) qui calcule déjà la compta Elite, pour qu'il calcule aussi les ménages équipe avec la même méthode (même rapprochement réservation, même cleaning fee, même TVA), et ranger le résultat dans `totals_json` du snapshot. Le proxy passe `totals_json` tel quel (`mgr.reports`) : aucun changement ni déploiement du proxy. Le front affiche, ne calcule rien.
- B : calculer dans le proxy depuis Hostaway en direct. Écarté : deux méthodes de calcul pour le même argent, déploiement du proxy partagé, lecture d'un mois entier de réservations à chaque ouverture.
- C : ajouter des lignes à la carte Elite accounting existante. Écarté : c'est justement l'écran jugé illisible, les trois chiffres y seraient noyés.

## Règles de calcul (job VPS)
- Ménage équipe = clé d'assignation datée du mois (`YYYY-MM-DD_<guest>`), pas `extra_`, sans sous-traitant parmi les assignés (id 12 Elite, ou rôle `subcontractor`).
- Ménage équipe daté après aujourd'hui (jour de Dubaï) : pas compté. Les managers assignent à l'avance (demain, +5 jours) : sans cette règle, le CA du mois en cours compterait des ménages pas encore faits (constaté sur les vraies données le 16/11 : 2 ménages du 17/11 déjà comptés). Le chemin Elite ne change pas (Elite est écrit après coup).
- Ménage avec Elite ET une cleaner interne : compté Elite (inchangé), dénombré dans `shared_with_elite_count`.
- Rapprochement (règle corrigée le 17/11/2026 après la revue finale, équipe ET Elite) : la clé d'un ménage est `<jour du départ>_<guest>`. La réservation d'un ménage est celle du guest dont le départ tombe ce jour-là. L'ancienne règle (« arrivée la plus proche ») rattachait une assignation restée sur une ancienne date (séjour prolongé ou raccourci) à une réservation déjà comptée : mesuré sur le VPS, CA équipe surévalué de 2 952 AED en septembre, 3 667 en octobre, 810 en novembre.
- Une réservation ne rapporte sa cleaning fee qu'une fois. Ménage équipe sans départ de ce guest ce jour-là, ou dont la réservation est déjà comptée (Elite ou autre ménage équipe) : pas compté du tout (ni ménage, ni CA, ni moyenne par cleaner), dénombré dans `skipped_count`. Mesuré : 24 de ces 27 assignations sur trois mois n'ont ni « done » ni chrono.
- Elite : même rapprochement par jour de départ ; à défaut de départ ce jour-là, l'ancienne règle s'applique (aucun ménage Elite ne perd sa ligne). Les noms des clés Elite de `totals_json` ne changent pas ; leurs valeurs peuvent bouger là où l'ancienne règle prenait une autre réservation du même guest.
- CA = `cleaningFee` de la réservation rapprochée, TTC, puis HT = TTC / 1,05 (comme Elite). Fee absent ou nul : ménage compté, CA 0, dénombré dans `missing_fee_count`. Aucun guest de ce nom dans les réservations : ménage compté, CA non compté, dénombré dans `unmatched_count`.
- Par cleaner : un ménage à deux cleaners compte pour chacune ; son CA est partagé à parts égales. Jours travaillés = dates distinctes. Moyenne = ménages / jours travaillés.
- Ajouts à `totals_json` : `team` (objet) et `potential_profit_ht`. Les lignes écartées vont dans `payload_json.team_skipped` (clé, guest, date, cleaners, raison).

## Contrat de données (ajouts à `totals_json`)
```json
{
  "team": {
    "cleanings_count": 56, "matched_count": 54, "unmatched_count": 2, "missing_fee_count": 3,
    "shared_with_elite_count": 7, "skipped_count": 3,
    "revenue_ttc": 13500.0, "revenue_ht": 12857.14, "vat_output": 642.86,
    "cleaner_jobs": 74, "cleaner_days": 37, "per_cleaner_day": 2.0,
    "by_cleaner": [
      {"id": 18, "name": "Annet", "cleanings": 27, "days_worked": 13, "per_day": 2.08, "revenue_ht": 4700.0}
    ]
  },
  "potential_profit_ht": 20062.58
}
```
`by_cleaner` trié par nom. `per_cleaner_day` et `per_day` valent `null` sans jour travaillé.

## Écran (anglais, mobile d'abord, zéro défilement horizontal)
```
< More
Cleaning money
Month [November 2026 v]     Computed 16 Nov 2026, 22:17

Team revenue       AED 12,857.14    56 cleanings done by your team
Kept on Elite      AED 7,205.44     78 cleanings · revenue AED 22,095.44 · Elite cost AED 14,890.00
Potential profit   AED 20,062.58    Team revenue + kept on Elite

All amounts exclude VAT. Before variable costs: OTA commission, products, laundry, salaries.

Your team
Average: 2.0 cleanings per cleaner per day worked
Annet     27 cleanings · 13 days · 2.1 per day     AED 4,700.00
...
(notes, seulement si > 0 : sans cleaning fee, non rapprochés, partagés avec Elite, assignations non comptées)

[Elite invoice check] -> #/more/reports
```
Aucun montant n'est calculé dans le front (même règle que Reports) : valeur absente = « Not available ». Mois sans `team` : « Team figures are not available for this month. »
