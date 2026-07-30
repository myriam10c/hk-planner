# HK Planner : comptage du linge et suivi blanchisserie

Date : 2026-07-30
Statut : design validé, prêt pour plan d'implémentation

## Problème

Le linge sale part à la blanchisserie sans être compté. Personne ne sait combien de pièces
ont été envoyées ni combien sont revenues, donc aucune discussion chiffrée n'est possible
avec le prestataire, et les pertes passent inaperçues.

## Objectif

1. Chaque ménage déclare le linge sale ramassé, article par article.
2. Un tableau manager donne les totaux par jour et par semaine.
3. Les mouvements vers et depuis la blanchisserie sont enregistrés, avec un solde courant
   de ce qui est réputé se trouver chez le prestataire.

## Périmètre

Concerné : tous les ménages, quel qu'en soit le type (départ, en cours de séjour, extra
hors Hostaway). Toute tâche qui passe par le bouton « Done » du planner demande le comptage.

Hors périmètre, décidé explicitement :

- comptage du linge propre remis en place et suivi du stock propre
- export Excel ou PDF du tableau
- alerte automatique si le solde blanchisserie dérape
- valorisation en dirhams
- liste d'articles modifiable depuis l'app
- rattachement d'un ménage à un lot de ramassage précis

## Articles

Liste figée de 6 articles, dans cet ordre, libellés en anglais puisque l'app est
entièrement en anglais pour l'équipe :

| Clé technique | Libellé UI |
|---|---|
| `pillowcases` | Pillowcases |
| `bed_sheets` | Bed sheets |
| `duvet_covers` | Duvet covers |
| `small_towels` | Small towels |
| `large_towels` | Large towels |
| `bath_mats` | Bath mats |

Ajouter un article plus tard demandera une migration et une modification de code. C'est
assumé.

## Modèle de données

### Table `laundry_counts`

Une ligne par ménage. Ce que la cleaner a déclaré avoir ramassé.

| Colonne | Type | Notes |
|---|---|---|
| `reservation_key` | text | clé primaire, même clé stable que `menage_done` |
| `pillowcases` | int | not null, >= 0 |
| `bed_sheets` | int | not null, >= 0 |
| `duvet_covers` | int | not null, >= 0 |
| `small_towels` | int | not null, >= 0 |
| `large_towels` | int | not null, >= 0 |
| `bath_mats` | int | not null, >= 0 |
| `author` | text | nom de la personne qui a saisi |
| `counted_on` | date | jour d'imputation, par défaut la date de checkout portée par la clé |
| `created_at` | timestamptz | défaut `now()` |
| `updated_at` | timestamptz | défaut `now()` |

Écriture en upsert sur `reservation_key` : une resaisie écrase la précédente.

`counted_on` est dérivé de la partie date de `reservation_key` (format `YYYY-MM-DD_guest`),
et non de l'horodatage de saisie. Un ménage du 12 saisi à 1h du matin le 13 reste imputé au 12.
Si la clé ne commence pas par une date valide, on retombe sur la date du jour de saisie.

Index sur `counted_on` pour le tableau par période.

### Table `laundry_movements`

Une ligne par mouvement au local. Écriture réservée aux managers.

| Colonne | Type | Notes |
|---|---|---|
| `id` | bigint | `generated always as identity`, clé primaire |
| `kind` | text | `out`, `in`, `adjust_store`, `adjust_laundry` |
| `pillowcases`, `bed_sheets`, `duvet_covers`, `small_towels`, `large_towels`, `bath_mats` | int | not null, négatif autorisé pour les deux `adjust_*` uniquement |
| `moved_on` | date | not null, modifiable par l'utilisateur, par défaut aujourd'hui |
| `note` | text | libre, nullable |
| `author` | text | nom du manager |
| `created_at` | timestamptz | défaut `now()` |

Contrainte : pour `kind in ('out','in')`, les 6 quantités doivent être >= 0. Pour les deux
`adjust_*`, tout entier est accepté.

Index sur `moved_on` et sur `kind`.

### Soldes

Calculés par article, à la demande, sans table de cache.

```
dirty_at_store   = Σ adjust_store + Σ laundry_counts - Σ out
at_laundry       = Σ adjust_laundry + Σ out - Σ in
```

Ce calcul rend les corrections auto-cicatrisantes. Si un manager saisit une sortie
inférieure à ce que l'app proposait, la différence reste au local et se retrouve dans la
proposition de la sortie suivante. Aucune réconciliation manuelle.

### État initial

Le stock existant se saisit comme deux mouvements ordinaires au démarrage : un
`adjust_store` avec le linge sale présent au local aujourd'hui, un `adjust_laundry` avec ce
qui est parti chez le prestataire et n'est pas revenu. Pas de concept de « seed » séparé :
le jour où un inventaire physique révèle un écart, on recorrige avec le même formulaire.

L'onglet affiche un encart d'amorçage tant qu'aucun mouvement `adjust_*` n'existe, pour que
la mise en route ne dépende pas de la mémoire de l'utilisateur.

## Flux cleaner

Le bouton « Done » du planner n'appelle plus `markDone` directement. Il ouvre une feuille
en bas d'écran.

- Titre « Laundry collected », sous-titre avec le nom du logement.
- 6 lignes : libellé, bouton moins, champ, bouton plus.
- Champs en `inputmode="numeric"`, contenu sélectionné au focus pour qu'un chiffre tapé
  remplace la valeur au lieu de s'y ajouter.
- Les champs démarrent vides. Un vrai zéro doit être saisi explicitement, ce qui le
  distingue d'un champ oublié.
- Bouton « Confirm & mark done » inactif tant que les 6 champs n'ont pas de valeur.
- Bouton « Cancel » qui referme sans rien marquer.

À la validation : appel `saveLaundryCount`, puis, seulement en cas de succès, enchaînement
sur le flux `markDone` existant avec son toast d'annulation de 5 secondes. Si
l'enregistrement échoue, le ménage n'est pas marqué terminé et l'erreur s'affiche. Pas de
file d'attente hors ligne : c'est le comportement déjà en vigueur pour `setDone`.

Annuler le « Done » depuis le toast ne supprime pas le comptage. Rappuyer sur « Done »
rouvre la feuille pré-remplie avec les valeurs enregistrées.

Un bouton « Laundry » dans le détail de la carte rouvre la feuille après coup, pré-remplie,
pour corriger. La règle vaut pour cleaners et managers : c'est un fait du ménage, pas un
privilège de rôle.

## Onglet Laundry, côté manager

Nouvel onglet visible en mode manager uniquement, placé après Maintenance.

### Bloc 1 : soldes

Deux cartes côte à côte, « Dirty at store » et « At laundry », chacune détaillant les 6
articles et un total. Trois actions : `Pickup`, `Return`, `Adjust`.

### Bloc 2 : tableau des totaux

- Sélecteur `Day` / `Week`, période par mois avec les flèches de navigation déjà utilisées
  dans le Dashboard.
- Une ligne par jour, ou par semaine du lundi au dimanche.
- Colonnes : période, les 6 articles, Total, Cleanings.
- `Cleanings` compte les lignes `laundry_counts` agrégées, ce qui explique un total faible
  sans avoir à enquêter. Les ménages terminés avant la mise en service n'ont pas de ligne et
  ne sont donc pas comptés : les premiers jours afficheront un chiffre incomplet, c'est normal.
- Ligne de total en pied de tableau.
- En mode semaine, l'agrégation reste bornée au mois sélectionné. Une semaine à cheval sur
  deux mois n'est comptée que pour ses jours à l'intérieur du mois, et son libellé affiche la
  plage réellement couverte. Sans cette règle, naviguer de mois en mois compterait deux fois
  les mêmes ménages.

### Bloc 3 : historique des mouvements

Liste des mouvements les plus récents : date, type, quantités, auteur, note. C'est la pièce
à produire en cas de contestation du prestataire.

### Formulaires

Même moule visuel que la feuille cleaner.

- `Pickup` : pré-rempli avec le solde « dirty at store » du moment, corrigeable. Un solde
  négatif, possible après un ajustement, se pré-remplit à zéro. Date par défaut aujourd'hui,
  modifiable. Note libre.
- `Return` : champs vides. Date et note idem.
- `Adjust` : choix entre `store` et `laundry`, valeurs négatives acceptées, date et note idem.

## Actions serveur

Ajoutées dans `supabase/functions/hostaway-proxy/index.ts`, déclarées dans `ROUTES`.

| Action | Méthode | Auth | Rôle |
|---|---|---|---|
| `saveLaundryCount` | POST | `X-App-Secret` | ouvert, comme `addNote` |
| `getLaundryCount` | GET | `X-App-Secret` | ouvert, pré-remplissage de la feuille, paramètre `key` unique |
| `getLaundrySummary` | GET | `X-App-Secret` | totaux par période et soldes |
| `getLaundryMovements` | GET | `X-App-Secret` | historique |
| `addLaundryMovement` | POST | `X-App-Secret` + contrôle de rôle | manager |

`addLaundryMovement` suit exactement le contrôle en place sur `setCancelled` et
`setPostponed` : `const me = await validateCleanerToken(...)` puis rejet si
`me && me.role !== "manager"`. Une session non authentifiée reste autorisée, c'est la
convention actuelle de l'app pour la vue manager historique sans login. Ne pas durcir ici,
sous peine d'incohérence avec le reste.

`saveLaundryCount` écrit aussi dans `cleaning_log` via `addLog`, action `laundry_counted`,
comme le fait `addNote`.

`getLaundrySummary` prend `start`, `end` et `granularity` (`day` ou `week`) et renvoie les
lignes agrégées plus les deux soldes. L'agrégation se fait côté serveur pour éviter de
descendre tous les comptages dans le navigateur.

## Validation des entrées

Côté serveur, pour toute écriture : chaque quantité doit être un entier, valeur absolue
plafonnée à 999 pour bloquer une faute de frappe grossière, et >= 0 sauf pour les
mouvements `adjust_*`. `reservation_key` non vide. `kind` dans la liste fermée. Une entrée
invalide renvoie 400 avec le nom du champ fautif.

## Tests

Pas de suite de tests automatisée dans le repo. La vérification suit la méthode déjà en
place pour cette app : déploiement sur une URL de préversion Netlify, pointant sur le proxy
réel, puis pilotage au navigateur.

Scénarios à valider avant la mise en production :

1. Un clic sur « Done » ouvre la feuille et ne marque rien tant qu'elle n'est pas validée.
2. Le bouton de confirmation reste inactif avec 5 champs sur 6 remplis.
3. Une saisie complète enregistre le comptage puis marque le ménage terminé.
4. Rappuyer sur « Done » après annulation rouvre la feuille pré-remplie.
5. Le tableau jour affiche le bon total et le bon nombre de ménages pour une journée connue.
6. La bascule semaine regroupe bien du lundi au dimanche.
7. Un `Pickup` pré-rempli au solde, validé tel quel, ramène « dirty at store » à zéro.
8. Un `Pickup` corrigé à la baisse laisse le reste au local.
9. Un `Return` inférieur à la sortie laisse un solde positif chez la blanchisserie.
10. Un cleaner connecté par PIN reçoit un 403 sur `addLaundryMovement`.

## Déploiement

Ordre imposé par les dépendances :

1. Migration SQL appliquée sur Supabase, additive, création de deux tables uniquement.
2. Déploiement du proxy via `npm run deploy:proxy`, jamais via un `supabase functions deploy`
   brut qui remettrait `verify_jwt` à true et ferait tomber toute l'app.
3. Déploiement Netlify en préversion pour la recette.
4. Bump de `VERSION` dans `sw.js`, puis déploiement production, après accord explicite.

L'étape 4 change le geste quotidien de toutes les cleaners, elle ne part pas sans validation.
