# Cleaning money Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montrer à Hillal, par mois, le CA des ménages faits par son équipe, ce qu'il garde sur Elite et le bénéfice potentiel (avant dépenses variables).

**Architecture:** Le job VPS `sync_cleaning_accounting` (dépôt `~/business`) calcule déjà la compta Elite et la pousse dans `cleaning_accounting_cache.totals_json`. On lui fait calculer aussi les ménages équipe avec la même méthode, dans deux nouvelles clés de `totals_json`. Le proxy passe `totals_json` tel quel par `mgr.reports` : aucun changement du proxy. Un nouvel écran `/manager/#/more/money` affiche ces valeurs sans rien calculer.

**Tech Stack:** Python 3.11/3.13 + pytest (handler Hermes) ; JS vanilla en modules ES + Playwright (app `/manager/`).

**Spec:** `docs/superpowers/specs/2026-11-16-cleaning-money-design.md` (dépôt hk-planner)

## Global Constraints

- Deux dépôts : `/Users/hillal/business` (branche `conciergerie-scalable-m2`) et `/Users/hillal/Documents/Wix new/hk-planner-repo.nosync` (branche `main`). Les deux ont du travail non commité étranger : ne jamais le toucher, jamais de `git stash`, jamais de `git add -A`. Les implémenteurs ne commitent pas : le contrôleur commite les fichiers nommés après revue.
- Interdit dans toute commande shell : la suppression récursive forcée de dossier (un hook la bloque et l'appel ne revient jamais). Pour repartir à froid : un dossier neuf, ou `mv` vers `_aside/`.
- Ne pas toucher : `hr.js`, `styles.css`, `sw.js`, `v3/sw.js`, `supabase/` (proxy), `data/`, `.env`.
- Interface de l'app en anglais ; commentaires de code en français comme le reste du dépôt ; jamais de tiret cadratin dans un texte.
- Les clés Elite existantes de `totals_json` (`cleanings_count`, `cost_ht`, `revenue_ht`, `margin_ht`, `by_service`, `by_bedrooms`, etc.) gardent leurs valeurs à l'identique.
- Le front ne calcule aucun montant : valeur absente = « Not available ».
- Mobile d'abord, zéro défilement horizontal.

## Review Focus

1. Mois sans aucun ménage équipe : `team` existe avec des zéros, `per_cleaner_day` vaut `null`, `potential_profit_ht` = marge Elite. (test tâche 1)
2. `getCleaners` en échec ou cleaner désactivée (absente de la liste) : le snapshot Elite part quand même, le nom retombe sur `Cleaner #<id>`. (test tâche 1)
3. Ancien mois dont le snapshot n'a pas `team` : l'écran affiche « Not available » et « Team figures are not available for this month. », la ligne Elite reste lisible. (test tâche 2)
4. Nom de cleaner contenant du HTML : échappé à l'écran. (test tâche 2)
5. Largeur téléphone avec de gros montants et un long nom : pas de défilement horizontal. (test tâche 2)

---

### Task 1: Ménages équipe dans le snapshot (dépôt `~/business`)

**Files:**
- Modify: `/Users/hillal/business/hermes/handlers/sync_cleaning_accounting.py`
- Test (create): `/Users/hillal/business/tests/test_sync_cleaning_accounting.py`

**Interfaces:**
- Consumes: proxy `GET ?action=getCleaners` (header `X-App-Secret`) → `{"cleaners": [{"id": 4, "name": "Fauzia", "role": "cleaner", ...}]}` (actifs seulement).
- Produces (lu par la tâche 2 via `mgr.reports` → `accounting.totals`) : les clés `team` et `potential_profit_ht` du contrat de données de la spec, à l'identique.

Signatures à écrire :

```python
def _fetch_cleaners(url: str, secret: str) -> dict[int, dict]:
    """{id: {"name": str, "role": str}} ; toute erreur réseau/HTTP : log warning et {}."""

def _compute_team(month: str, assignments: dict, cleaners: dict[int, dict] | None,
                  by_norm: dict) -> dict:
    """Pur. Rend {"rows": [...], "unmatched": [...], "totals": {...}} ; "totals" = l'objet `team` de la spec."""

def _compute_month(month, assignments, meta, pricing, by_norm, listings,
                   cleaners: dict[int, dict] | None = None) -> dict:
    # inchangé pour Elite ; ajoute totals["team"], totals["potential_profit_ht"],
    # et les clés de retour "team_rows", "team_unmatched"
```

Règles (spec, section « Règles de calcul ») :
- Sous-traitant = id 12, ou id dont `cleaners[id]["role"] == "subcontractor"`. Ménage équipe = clé `YYYY-MM-DD_<guest>` du mois, pas `extra_`, au moins un assigné, aucun sous-traitant.
- `shared_with_elite_count` = clés Elite du mois (mêmes filtres que `elite_keys`) qui portent aussi un id non sous-traitant.
- Rapprochement par `_find_resa(by_norm, guest, date)`. Introuvable : ligne dans `unmatched`, comptée dans `cleanings_count` et `unmatched_count`, aucun CA. Trouvée : `matched_count` ; `cleaningFee` `None` ou 0 → CA 0, `missing_fee_count` ; sinon `revenue_ttc` = fee, `revenue_ht` = `_round2(ttc / 1.05)`, `vat_output` = ttc − ht.
- `by_cleaner` : une entrée par id assigné sur un ménage équipe (rapproché ou non) ; `cleanings` = nombre de ménages ; `days_worked` = dates distinctes ; `per_day` = `round(cleanings / days_worked, 2)` ; `revenue_ht` = somme des parts (CA HT arrondi de la ligne divisé par le nombre d'assignés), arrondie à 2 décimales en fin de somme ; `name` = `cleaners[id]["name"]` ou `f"Cleaner #{id}"` ; tri par `name`.
- `cleaner_jobs` = somme des `cleanings`, `cleaner_days` = somme des `days_worked`, `per_cleaner_day` = `round(cleaner_jobs / cleaner_days, 2)` ou `None`.
- `potential_profit_ht` = `team.revenue_ht + totals["margin_ht"]`, arrondi à 2 décimales (sommes en `Decimal`, comme `s()`).
- Ligne équipe (`rows`) : `cleaning_date, resa_id, listing_id, guest, cleaner_ids, revenue_ttc, revenue_ht, vat_output, revenue_status ("OK"|"MISSING"), resa_key`.
- `_push_to_supabase` : ajoute `team_rows` et `team_unmatched` à `payload_json` ; `rows_count` et `unmatched_count` restent ceux d'Elite.
- `run` : appelle `_fetch_cleaners` une fois et passe le résultat à `_compute_month`.
- Mettre à jour la docstring du module (le job ne calcule plus seulement Elite).

- [ ] **Step 1: Écrire les tests (ils échouent)** dans `tests/test_sync_cleaning_accounting.py`, zéro réseau, fonctions pures seulement. Fixture commune :

```python
from decimal import Decimal
from hermes.handlers.sync_cleaning_accounting import _compute_month, _compute_team

CLEANERS = {4: {"name": "Fauzia", "role": "cleaner"}, 10: {"name": "Pionah", "role": "cleaner"},
            12: {"name": "Elite Cleaning", "role": "subcontractor"}, 30: {"name": "Other Sub", "role": "subcontractor"}}
PRICING = {("CHC", "STUDIO"): {"price_ht": Decimal("155"), "tax_rate": Decimal("0.05")}}
LISTINGS = {1: {"name": "L1", "internal_name": "101 Tower", "bedrooms": 0}}

def resa(rid, guest, arrival, fee):
    return {"id": rid, "listingMapId": 1, "guestName": guest, "arrivalDate": arrival,
            "departureDate": arrival, "cleaningFee": fee, "totalPrice": 1000, "nights": 3}

def index(*resas):
    from hermes.handlers.sync_cleaning_accounting import _norm
    out = {}
    for r in resas:
        out.setdefault(_norm(r["guestName"]), []).append(r)
    return out
```

Tests et assertions exactes :
  - `test_team_revenue_counts_only_team_jobs_of_the_month` : assignments `{"2026-11-03_Alice Martin": [4], "2026-11-04_Bob Stone": [12], "extra_2026-11-05_x": [4], "2026-10-30_Carl Old": [4]}`, résas Alice fee 250 et Bob fee 250 → `team["cleanings_count"] == 1`, `team["matched_count"] == 1`, `team["revenue_ttc"] == 250.0`, `team["revenue_ht"] == 238.10`, `team["vat_output"] == 11.90`.
  - `test_shared_with_elite_is_counted_as_elite` : `{"2026-11-04_Bob Stone": [12, 4]}` → `team["cleanings_count"] == 0`, `team["shared_with_elite_count"] == 1`, `totals["cleanings_count"] == 1`.
  - `test_missing_fee_and_unmatched_are_counted_without_revenue` : Alice fee `None` (assignée à 4), « Zed Ghost » sans résa (assigné à 10) → `cleanings_count == 2`, `matched_count == 1`, `missing_fee_count == 1`, `unmatched_count == 1`, `revenue_ht == 0.0`, une ligne dans `team_unmatched`.
  - `test_by_cleaner_split_days_and_average` : `{"2026-11-03_Alice Martin": [4, 10], "2026-11-03_Bob Stone": [4], "2026-11-05_Dina Roy": [4]}`, fees 210, 250, 250 → Fauzia `cleanings 3, days_worked 2, per_day 1.5, revenue_ht 576.20` (part = CA HT arrondi de la ligne divisé par le nombre d'assignés, soit 100.00 + 238.10 + 238.10 ; ainsi la somme des cleaners égale `team["revenue_ht"] == 676.20`, à vérifier aussi) ; Pionah `cleanings 1, days_worked 1, per_day 1.0, revenue_ht 100.0` ; `cleaner_jobs == 4`, `cleaner_days == 3`, `per_cleaner_day == 1.33` ; `by_cleaner` trié `["Fauzia", "Pionah"]`.
  - `test_unknown_cleaner_falls_back_and_other_subcontractor_is_excluded` : `{"2026-11-03_Alice Martin": [19], "2026-11-04_Bob Stone": [30]}` → `cleanings_count == 1`, `by_cleaner[0]["name"] == "Cleaner #19"`, et le ménage de l'id 30 n'est ni équipe ni Elite (`totals["cleanings_count"] == 0`).
  - `test_potential_profit_is_team_revenue_plus_elite_margin` : Alice [4] fee 250, Bob [12] fee 250 → `totals["margin_ht"] == 83.10`, `totals["potential_profit_ht"] == 321.20`.
  - `test_month_without_team_jobs` : seulement Bob [12] → `team["cleanings_count"] == 0`, `team["revenue_ht"] == 0.0`, `team["per_cleaner_day"] is None`, `team["by_cleaner"] == []`, `potential_profit_ht == totals["margin_ht"]`.
  - `test_cleaners_none_still_computes` : `_compute_month(..., cleaners=None)` avec Alice [4] → `cleanings_count == 1`, nom `"Cleaner #4"`.
  - `test_elite_keys_unchanged` : Bob [12] fee 250 → `totals["cleanings_count"] == 1`, `cost_ht == 155.0`, `revenue_ht == 238.10`, `margin_ht == 83.10`, `by_bedrooms == {"STUDIO": {"count": 1, "cost_ht": 155.0, "revenue_ht": 238.1, "margin_ht": 83.1}}`.

- [ ] **Step 2: Lancer, vérifier l'échec** · `cd /Users/hillal/business && COMMS_DATABASE_URL="" .venv/bin/python -m pytest tests/test_sync_cleaning_accounting.py -q` → échec à l'import de `_compute_team`.
- [ ] **Step 3: Implémenter** selon les signatures et règles ci-dessus.
- [ ] **Step 4: Lancer, vérifier le succès** · même commande → 9 tests verts ; puis `.venv/bin/ruff check hermes/handlers/sync_cleaning_accounting.py tests/test_sync_cleaning_accounting.py` → aucun constat ; puis `COMMS_DATABASE_URL="" .venv/bin/python -m pytest tests/test_pms_statuses.py tests/test_policies_handlers.py -q` → verts.
- [ ] **Step 5: Ne pas commiter.** Rendre la liste des fichiers modifiés et la sortie des tests.

---

### Task 2: Écran Cleaning money (dépôt hk-planner)

**Files:**
- Create: `manager/screens/more-money.js` (exporte `renderMoney(ctx)`)
- Modify: `manager/screens/more-reports.js` (ajouter `export` devant `NA`, `STALE_MS`, `money`, `count`, `monthLabel`, `dubaiStamp`, `isNum`, `isObj` ; aucun autre changement)
- Modify: `manager/screens/more.js` (`SECTIONS.money = ['/manager/screens/more-money.js', 'renderMoney']` ; première entrée de `ROWS` : `{ title: 'Cleaning money', desc: 'Team revenue, what you keep on Elite, potential profit', href: '#/more/money' }`)
- Modify: `manager/ui/more.css` (classes `.mn-*`, en s'appuyant sur les jetons et les classes `.rp-*` existants)
- Test (create): `tests/manager/more-money.spec.ts`
- Test (modify): `tests/manager/more.spec.ts` (nouvelle première ligne, 12 → 13 lignes partout)

**Interfaces:**
- Consumes: `get('mgr.reports', month ? { month } : undefined)` de `/manager/api.js` → `{ month: 'YYYY-MM', months: string[], accounting: null | { computedAt, totals } }`. `totals` porte les clés Elite existantes (`cleanings_count`, `revenue_ht`, `cost_ht`, `margin_ht`) et, pour les mois récents, `team` et `potential_profit_ht` (contrat de la spec). Modèle à suivre pour le chargement, le sélecteur de mois, les erreurs et le nettoyage : `manager/screens/more-reports.js`.
- Produces: rien pour d'autres tâches.

Contrat DOM et textes exacts (les tests s'y accrochent) :
- En-tête : lien retour `More` vers `#/more`, `<h1>Cleaning money</h1>`.
- Sélecteur de mois `select[data-mn-month]` (mêmes options et libellés que Reports), puis `p.rp-fresh` : `Computed <dubaiStamp>` et la pastille `Snapshot is older than 3 hours` au-delà de 3 h.
- `section[data-mn="summary"]` avec trois blocs `[data-mn-stat="team"|"elite"|"potential"]`, chacun `span.mn-label`, `b.mn-value`, `span.mn-sub` :
  - team : label `Team revenue`, valeur `money(team.revenue_ht)`, sous-ligne `<n> cleanings done by your team` (`1 cleaning done by your team` au singulier).
  - elite : label `Kept on Elite`, valeur `money(totals.margin_ht)`, sous-ligne `<n> cleanings · revenue <money(revenue_ht)> · Elite cost <money(cost_ht)>`.
  - potential : label `Potential profit`, valeur `money(totals.potential_profit_ht)`, sous-ligne `Team revenue + kept on Elite`.
- `p.mn-note` : `All amounts exclude VAT. Before variable costs: OTA commission, products, laundry, salaries.`
- `section[data-mn="team"]`, titre `Your team` : `p.mn-avg` = `Average: <1 décimale> cleanings per cleaner per day worked` (absent si `per_cleaner_day` n'est pas un nombre) ; une ligne `.mn-person` par entrée de `by_cleaner` : nom échappé, `<n> cleanings · <d> days · <1 décimale> per day`, `money(revenue_ht)` ; liste vide : `No team cleanings this month.`
- `ul.mn-flags`, un `li` par compteur > 0, dans cet ordre : `<n> team cleanings with no cleaning fee on the booking.` · `<n> team cleanings not matched to a booking, revenue not counted.` · `<n> cleanings with both Elite and a team member, counted as Elite.` (singulier `1 team cleaning ...` / `1 cleaning ...`). Aucun `ul` si tous à zéro.
- Lien `a.btn[href="#/more/reports"]` : `Elite invoice check`.
- Sans snapshot (`accounting === null`) : `No snapshot for this month yet.`, aucun chiffre. Snapshot sans `team` : valeurs team et potential = `Not available`, section team = `Team figures are not available for this month.`, bloc elite affiché normalement.
- Erreur de lecture : message du serveur + bouton `Retry` (comme Reports). Accès : mêmes renvois que Reports (`handleAccess`).

- [ ] **Step 1: Écrire les tests (ils échouent)** dans `tests/manager/more-money.spec.ts`, sur le modèle de `tests/manager/more-reports.spec.ts` (`bootMgr(page, [me(MANAGER), ...reads], { email: true, hash: '#/more/money', clock })`). Snapshot de novembre :

```ts
const TEAM = {
  cleanings_count: 56, matched_count: 54, unmatched_count: 2, missing_fee_count: 3, shared_with_elite_count: 7,
  revenue_ttc: 13500, revenue_ht: 12857.14, vat_output: 642.86, cleaner_jobs: 74, cleaner_days: 37, per_cleaner_day: 2,
  by_cleaner: [
    { id: 18, name: 'Annet', cleanings: 27, days_worked: 13, per_day: 2.08, revenue_ht: 4700 },
    { id: 4, name: 'Fauzia <b>x</b>', cleanings: 23, days_worked: 12, per_day: 1.92, revenue_ht: 4100.5 },
  ],
};
const TOTALS = { cleanings_count: 78, revenue_ht: 22095.44, cost_ht: 14890, margin_ht: 7205.44, team: TEAM, potential_profit_ht: 20062.58 };
```

Tests : (1) les trois chiffres et leurs sous-lignes : `AED 12,857.14` / `56 cleanings done by your team`, `AED 7,205.44` / `78 cleanings · revenue AED 22,095.44 · Elite cost AED 14,890.00`, `AED 20,062.58` / `Team revenue + kept on Elite`, la note, l'horodatage ; (2) bloc équipe : `Average: 2.0 cleanings per cleaner per day worked`, `Annet` avec `27 cleanings · 13 days · 2.1 per day` et `AED 4,700.00`, nom `Fauzia <b>x</b>` affiché en texte (aucun `<b>` injecté dans `.mn-person`) ; (3) les trois `li` de `.mn-flags` avec 3, 2 et 7, et aucun `ul.mn-flags` quand les trois valent 0 ; (4) snapshot sans `team` ni `potential_profit_ht` : `Not available` pour team et potential, `Team figures are not available for this month.`, elite `AED 7,205.44` ; (5) `accounting: null` : `No snapshot for this month yet.` et changement de mois qui recharge avec `month=` dans l'URL (via `fetchLog`) ; (6) pastille `Snapshot is older than 3 hours` avec une horloge 4 h après `computedAt`, absente sinon ; (7) `noHorizontalScroll(page)` avec `revenue_ht: 1234567.89` et un nom de 40 caractères ; (8) lecture en échec : message et `Retry` ; (9) le lien `Elite invoice check` pointe `#/more/reports`. Dans `tests/manager/more.spec.ts` : première ligne `['Cleaning money', 'Team revenue, what you keep on Elite, potential profit', '#/more/money']`, compte 13.
- [ ] **Step 2: Lancer, vérifier l'échec** · `npx playwright test tests/manager/more-money.spec.ts --project=mgr-mobile` → échecs (écran inconnu).
- [ ] **Step 3: Implémenter** l'écran, la route, la ligne du hub et le CSS. Trois blocs empilés sur téléphone, en grille de trois colonnes à partir de 720 px ; `b.mn-value` en `font-variant-numeric: tabular-nums` avec `overflow-wrap:anywhere`.
- [ ] **Step 4: Lancer, vérifier le succès** · `npx playwright test tests/manager/more-money.spec.ts tests/manager/more.spec.ts tests/manager/more-reports.spec.ts --project=mgr-mobile --project=mgr-desktop` → tout vert.
- [ ] **Step 5: Ne pas commiter.** Rendre la liste des fichiers modifiés et la sortie des tests.

---

### Task 3: Commits, déploiements, vérification (contrôleur, pas un sous-agent)

- [ ] `~/business` : `git add` des deux fichiers nommés, commit `hk: compta ménage, CA des ménages équipe et bénéfice potentiel dans le snapshot`, vérifier `git log -3` et l'auteur, `scripts/deploy_vps.sh medini-hermes`.
- [ ] VPS : lancer le handler une fois à la main, puis lire `cleaning_accounting_cache` : `totals_json.team` présent pour 2026-11, 2026-10, 2026-09 ; clés Elite identiques à avant (comparer à la lecture du 16/11 : nov. `margin_ht` 7205.44, oct. 17668.77, sept. 13964.27, aux nouvelles assignations près pour novembre).
- [ ] hk-planner : vérifier que la `VERSION` de `sw.js` en ligne égale celle de l'arbre, commit des fichiers nommés, `./deploy-front.sh`, commit du tampon, `git push`.
- [ ] Vérifier en ligne : `curl` de `/manager/screens/more-money.js` et de `sw.js` (nouveau tampon).

---

## Addendum (16 et 17/11/2026) · règles ajoutées pendant l'exécution

Deux règles ont été ajoutées à la spec après l'écriture de ce plan, sur constat des vraies données. La spec fait foi.

1. **Ménages équipe futurs** (commit business `6be6f03`) : un ménage équipe daté après aujourd'hui (jour de Dubaï) n'est pas compté.
2. **Rapprochement par jour de départ** (revue finale, commit business `c25f551`) : la réservation d'un ménage est celle du guest dont le départ tombe le jour de la clé, pour l'équipe et pour Elite (repli sur l'ancienne règle pour Elite seulement). Une réservation ne rapporte sa cleaning fee qu'une fois. Une assignation équipe sans départ ce jour-là, ou dont la réservation est déjà comptée, est écartée et dénombrée dans `team.skipped_count` (détail dans `payload_json.team_skipped`). L'écran ajoute la ligne « team assignments not counted ». La fenêtre des mois est calculée en heure de Dubaï.

Restes notés, non traités : un ménage reporté garde la date de sa clé d'origine ; une assignation périmée au nom très court peut prendre le départ du même jour d'un autre guest (visible dans `team_skipped`) ; séjour de plus de 60 nuits hors de la fenêtre d'index.
