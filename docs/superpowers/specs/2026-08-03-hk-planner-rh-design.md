# HK Planner, module RH

Date : 2026-08-03
Statut : validé pour implémentation

## 1. Problème

HK Planner gère les ménages et la maintenance de ~110 logements, mais rien du côté personnel.
Aujourd'hui les congés ne sont tracés nulle part : ni les demandes, ni les soldes, ni les jours
réellement pris. Trois conséquences concrètes :

1. Un ménage peut être assigné à quelqu'un qui est en congé, découvert le matin même.
2. Les congés non pris s'accumulent sans être chiffrés, alors qu'ils sont dus au solde de tout
   compte (payable sous 14 jours).
3. Aucune trace écrite en cas de litige MOHRE, où la charge de la preuve pèse sur l'employeur.

S'y ajoutent deux besoins connexes : suivre l'expiration des documents (visa, Emirates ID,
passeport) et disposer d'une estimation de la gratuity due, qui dépend du basic et de l'ancienneté.

## 2. Périmètre

Dans le périmètre :

- Demandes de congés avec validation, soldes calculés, historique.
- Blocage strict de l'assignation d'un ménage à une personne en congé approuvé.
- Dossier employé : date d'embauche, poste, documents et leurs dates d'expiration.
- Salaire décomposé (basic / housing / transport) et calculateur de gratuity, visibles par Hillal seul.
- Notifications Telegram : demande reçue, décision rendue, document proche de l'expiration.

Hors périmètre, décidé explicitement :

- Aucun suivi des heures supplémentaires, ni pointage, ni saisie déclarative.
- Aucune paie, aucun WPS, aucun bulletin. Zoho reste la source comptable.
- Aucun calendrier des jours fériés UAE.

## 3. Décisions structurantes

| Sujet | Décision |
|---|---|
| Population | Salariés uniquement. Les sous-traitants (Elite) n'ont ni congés ni gratuity. |
| Entrée d'un congé | L'employé demande depuis son mode cleaner, un manager approuve ou refuse. |
| Planner | Blocage strict : impossible d'assigner un ménage pendant un congé approuvé. |
| Soldes | Calcul automatique selon le décret-loi 33/2021, plus un solde d'ouverture ajustable. |
| Décompte | Jours calendaires. Du 10 au 20 inclus = 11 jours. |
| Notifications | Telegram sur demande, décision, et expiration de document. |
| Salaires | Visibles par Hillal seul. Les autres managers ne voient aucun montant. |

## 4. Architecture

### 4.1 Pourquoi une table `employees` séparée

`getAllData` (proxy `index.ts:1878`) exécute `sb.from("cleaners").select("*")` et renvoie le
résultat au navigateur de **chaque** utilisateur, mode cleaner compris. Toute colonne ajoutée à
`cleaners` est donc publiée à toute l'équipe par construction.

Les données RH sensibles vivent donc dans de nouvelles tables que les routes existantes ne lisent
jamais. La confidentialité ne repose pas sur la vigilance d'un futur `select`, elle repose sur le
schéma.

`cleaners` reste inchangée sauf une colonne : `is_owner BOOLEAN NOT NULL DEFAULT false`. Cette
colonne n'est pas sensible (elle dit qui est le patron, ce que tout le monde sait) et évite
d'introduire un rôle `owner` qui casserait les dizaines de gates `role !== 'manager'` existants.
Hillal reste `role='manager'` partout, plus `is_owner=true`.

« Être salarié » se lit comme « avoir une ligne dans `employees` ». Pas de flag supplémentaire.

### 4.2 Schéma

Migration `supabase/migrations/20260803120000_hr.sql`. RLS activé sans policy sur les trois tables,
comme le fait déjà `laundry` : l'accès passe exclusivement par l'edge function en `service_role`,
l'anon est bloqué.

```sql
CREATE TABLE public.employees (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaner_id            INTEGER NOT NULL UNIQUE REFERENCES public.cleaners(id) ON DELETE RESTRICT,
  hire_date             DATE NOT NULL,
  end_date              DATE,
  job_title             TEXT,
  nationality           TEXT,
  -- Solde d'ouverture : pour les salariés déjà en poste avant l'app.
  -- L'accrual repart de opening_date, et seuls les congés pris à partir de
  -- cette date sont décomptés. Pour une nouvelle embauche : 0 à hire_date.
  opening_annual_days   NUMERIC(6,2) NOT NULL DEFAULT 0,
  opening_date          DATE NOT NULL,
  -- Confidentiel, jamais renvoyé sans is_owner. Montants mensuels en AED.
  basic_salary          NUMERIC(10,2),
  housing_allowance     NUMERIC(10,2),
  transport_allowance   NUMERIC(10,2),
  other_allowance       NUMERIC(10,2),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employees_end_after_hire CHECK (end_date IS NULL OR end_date >= hire_date),
  CONSTRAINT employees_opening_after_hire CHECK (opening_date >= hire_date)
);

CREATE TABLE public.leave_requests (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaner_id    INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  leave_type    TEXT NOT NULL CHECK (leave_type IN
                  ('annual','sick','unpaid','maternity','parental','bereavement','hajj','other')),
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  days          NUMERIC(6,2) NOT NULL CHECK (days > 0),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason        TEXT,
  requested_by  TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  decision_note TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_end_after_start CHECK (end_date >= start_date)
);
CREATE INDEX leave_requests_cleaner_start_idx ON public.leave_requests (cleaner_id, start_date);
CREATE INDEX leave_requests_status_idx ON public.leave_requests (status) WHERE status = 'pending';
CREATE INDEX leave_requests_approved_range_idx
  ON public.leave_requests (start_date, end_date) WHERE status = 'approved';

CREATE TABLE public.employee_documents (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaner_id  INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN
                ('passport','emirates_id','visa','labour_card','medical_insurance','contract','other')),
  doc_number  TEXT,
  issue_date  DATE,
  expiry_date DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX employee_documents_expiry_idx ON public.employee_documents (expiry_date)
  WHERE expiry_date IS NOT NULL;

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;
```

Le chevauchement de deux congés approuvés n'est pas empêché par contrainte SQL (cela demanderait
l'extension `btree_gist`) mais par un contrôle applicatif à la création et à l'approbation.

### 4.3 Découpage du code front

`app.js` fait 7004 lignes et 397 Ko. Le module RH n'y est pas ajouté. Il vit dans un `hr.js`
séparé, chargé par une balise `<script src="/hr.js"></script>` placée **avant** celle d'`app.js`
dans `index.html`.

Le chargement paresseux via `loadScript()` a été écarté : ce helper impose un hash SRI et
`crossOrigin="anonymous"`, il est conçu pour les CDN et ne convient pas à un fichier same-origin.
Écrire un second chargeur pour économiser ~40 Ko à côté des 397 Ko d'`app.js` déjà téléchargés
n'en vaut pas le coût.

L'ordre de chargement est imposé : `hr.js` ne définit que des fonctions et des constantes, et ne
touche à aucun global d'`app.js` au moment de son évaluation. Le charger en premier supprime toute
question d'ordre d'initialisation.

Conséquences à ne pas oublier :

- `sw.js` : ajouter `/hr.js` au `PRECACHE` et à la condition network-first, à côté de `/app.js` et
  `/styles.css`. Sans cela un déploiement continue de servir l'ancien module.
- `app.js` expose les points d'accroche dont `hr.js` a besoin (`api`, `apiWrite`, `esc`, `icon`,
  `toast`, `confirmAction`, `renderBottomNav`, `cleaners`, `cleanerMode`, `render`) sur `window`.
- `hr.js` expose ses helpers purs sur `window` pour être testable en Playwright, comme le linge.
- `render()` et `renderBottomNav()` dans `app.js` gardent un `typeof renderHR === 'function'` de
  garde, pour qu'un `hr.js` absent ou en échec de chargement dégrade l'onglet RH sans casser le reste.

## 5. Règles de calcul

Toutes les fonctions de calcul sont pures, dans `hr.js`, exposées sur `window`, et couvertes par
des tests avant d'écrire l'interface. Le proxy réimplémente uniquement le décompte de jours et le
test de chevauchement, qui sont triviaux, afin de ne jamais faire confiance au client sur des
valeurs qu'il envoie.

### 5.1 Décompte des jours

`leaveDays(start, end)` = nombre de jours calendaires inclusifs, soit `(end - start) / 86400000 + 1`.
Calcul en UTC pour éviter les décalages d'heure locale. Aucun week-end ni férié n'est retiré.

### 5.2 Congés annuels

Barème du décret-loi 33/2021 :

- moins de 6 mois d'ancienneté : aucun droit acquis
- de 6 à 12 mois : 2 jours par mois complet d'ancienneté
- à partir de 12 mois : 2,5 jours par mois, soit 30 jours par an

`accruedAnnualDays(hireDate, asOf)` crédite mois complet par mois complet depuis l'embauche, au
taux applicable à l'ancienneté atteinte à la fin de chaque mois. Les mois antérieurs au 6e ne
créditent rien, y compris rétroactivement.

Solde disponible :

```
solde(asOf) = opening_annual_days
            + accruedAnnualDays(hire_date, asOf) - accruedAnnualDays(hire_date, opening_date)
            - somme des jours des congés 'annual' approuvés dont start_date >= opening_date
```

Un solde négatif est affiché tel quel, en rouge. Il signale une avance accordée, pas une erreur.

### 5.3 Congés maladie

Article 31 : par année de service, à compter de la fin de la période d'essai, 90 jours maximum,
découpés en 15 jours à plein salaire, 30 jours à demi-salaire, 45 jours non payés. L'année de
service court d'anniversaire d'embauche à anniversaire d'embauche, pas en année civile.

`sickTiers(daysTakenInServiceYear)` renvoie `{full, half, unpaid, remaining}`. Aucun paiement
n'est calculé, seule la consommation est affichée. Les congés maladie ne touchent pas au solde annuel.

### 5.4 Autres types

`unpaid`, `maternity`, `parental`, `bereavement`, `hajj`, `other` sont enregistrés et bloquent
l'assignation, mais ne consomment aucun solde. Les jours `unpaid` sont en revanche déduits de
l'ancienneté dans le calcul de gratuity.

### 5.5 Gratuity

Article 51, visible par Hillal seul, affichée comme une estimation.

```
serviceDays  = (fin - hire_date) en jours - jours de congés 'unpaid' approuvés
serviceYears = serviceDays / 365
dailyBasic   = basic_salary / 30
si serviceYears < 1  : gratuity = 0
sinon                : gratuity = min(serviceYears, 5) * 21 * dailyBasic
                               + max(serviceYears - 5, 0) * 30 * dailyBasic
plafond      = 24 * basic_salary
```

À quoi s'ajoute, affiché séparément, le solde de congés non pris valorisé :
`solde annuel restant * dailyBasic`.

Le bloc porte la mention : « Estimation indicative. Le calcul officiel dépend du motif de fin de
contrat et doit être validé par un PRO. » Cette mention n'est pas optionnelle.

## 6. Routes du proxy

Toutes déclarées dans la map `ROUTES` (`index.ts:473`), sinon elles renvoient 404 avant d'atteindre
le handler. Un helper local `hrAuth(sb, req, level)` factorise la vérification, avec `level` valant
`'staff'`, `'manager'` ou `'owner'` :

- `staff` : un `X-Cleaner-Token` valide suffit, quel que soit le rôle.
- `manager` : le token doit correspondre à un `role === 'manager'`.
- `owner` : le token doit correspondre à un cleaner dont `is_owner = true`.

Le `X-App-Secret` seul ne donne accès à aucune route RH. Il est embarqué dans le bundle public.

| Action | Méthode | Niveau | Rôle |
|---|---|---|---|
| `hrOverview` | GET | manager | Employés, soldes, demandes en attente, documents expirants. Aucun montant. |
| `hrSaveEmployee` | POST | manager, owner si champs salaire | Créer ou modifier une fiche. |
| `hrDeleteEmployee` | POST | owner | Retirer quelqu'un du périmètre RH. |
| `hrGetCompensation` | GET | owner | Salaire décomposé et données de gratuity d'un employé. |
| `hrMyLeave` | GET | staff | Solde et historique de l'appelant uniquement. |
| `hrSubmitLeave` | POST | staff | Déposer une demande. Un manager peut déposer pour autrui. |
| `hrDecideLeave` | POST | manager | Approuver ou refuser. |
| `hrCancelLeave` | POST | staff | Annuler. Voir règles ci-dessous. |
| `hrSaveDocument` | POST | manager | Créer ou modifier un document. |
| `hrDeleteDocument` | POST | manager | Supprimer un document. |

Règles serveur non négociables :

- `days` est **toujours** recalculé côté serveur à partir de `start_date` et `end_date`. La valeur
  envoyée par le client est ignorée.
- Une demande n'est acceptée que si l'auteur a une ligne dans `employees`.
- Chevauchement : à la création et à l'approbation, refus 409 si la personne a déjà un congé
  `approved` ou `pending` qui recoupe la période.
- Un manager ne peut pas approuver sa propre demande, sauf s'il est `is_owner`.
- `hrCancelLeave` : le demandeur peut annuler sa demande tant qu'elle est `pending`. Un manager
  peut annuler n'importe quelle demande, y compris `approved` (c'est la porte de sortie quand un
  congé approuvé doit être écourté pour rappeler quelqu'un).
- `hrGetCompensation` est la seule route qui renvoie un montant. Aucune autre route ne sélectionne
  les colonnes de salaire, y compris par `select("*")`.

## 7. Blocage de l'assignation

Le blocage est appliqué côté serveur. L'interface se contente de le rendre visible.

**Serveur**, handler `assignCleaner` (`index.ts:1061`), pour les modes `set` et `add` :

1. Extraire la date du ménage du `reservation_key` avec le pattern déjà utilisé par le linge
   (`index.ts:799`) : `/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/`. Si la clé ne matche pas, ne pas bloquer.
2. Chercher les congés `approved` couvrant cette date pour les cleaners concernés.
3. Si au moins un correspond, répondre 409 avec un message nommant la personne et les dates.
   Aucune ligne n'est écrite, même partiellement.

`autoAssign` (`index.ts:1125`) exclut de la même façon les personnes en congé à la date visée,
silencieusement.

**Client** : `getAllData` gagne un tableau `leaves` contenant uniquement
`{cleaner_id, start_date, end_date}` des congés approuvés dans une fenêtre de J-7 à J+90. Le type
de congé n'est pas exposé : savoir que quelqu'un est absent est opérationnel, savoir qu'il est
malade ne l'est pas.

Les surfaces d'assignation marquent les personnes indisponibles : le picker (`app.js:1798`), la
rangée d'assignation rapide du planner (`app.js:3654`) et le glisser-déposer. Une personne en
congé apparaît grisée avec un badge, et le clic affiche un toast expliquant pourquoi c'est refusé
plutôt que de laisser partir un appel voué au 409.

## 8. Interface

### 8.1 Onglet RH, côté manager

Accessible depuis le menu More, pas depuis la barre du bas qui est pleine et réservée au
quotidien. Le bouton More porte une pastille quand des demandes sont en attente.

Trois sections empilées :

1. **Demandes en attente** en premier, avec pour chacune le nom, le type, les dates, le nombre de
   jours, le solde restant après approbation, et deux boutons Approuver / Refuser. C'est l'action
   la plus fréquente, elle est en haut.
2. **Équipe**, une ligne par salarié : nom, poste, ancienneté, solde annuel restant, jours maladie
   consommés dans l'année de service en cours, et une pastille rouge si un document expire dans
   moins de 60 jours. Clic pour ouvrir la fiche.
3. **Documents expirants**, triés par date, sur un horizon de 90 jours.

La fiche employé ouvre un panneau : identité et contrat, historique des congés, documents. Pour
Hillal seulement, un bloc supplémentaire rémunération et gratuity, chargé par un appel séparé à
`hrGetCompensation` afin que les montants ne transitent jamais dans la réponse consultée par les
autres managers.

### 8.2 Onglet Congés, côté employé

Quatrième onglet dans la barre du bas en mode cleaner, visible seulement si l'utilisateur a une
fiche `employees`. Il montre son solde annuel, sa consommation maladie, le bouton « Demander un
congé » (type, dates, motif), et l'historique de ses demandes avec leur statut. Il ne voit jamais
les données de quelqu'un d'autre, ni aucun montant.

### 8.3 Conventions

Réutilisation stricte de l'existant : `.settings-panel` pour les blocs, `.card` et `.cleaner-row`
pour les lignes, `.btn-primary` / `.btn-secondary` / `.btn-danger`, `confirmAction()` pour les
confirmations, `toast()` pour les retours. Le routage passe par la délégation `data-action`
existante, pas par des `onclick` inline. Tout texte utilisateur est échappé par `esc()`.

Interface en anglais, comme le reste de l'app, puisqu'elle est utilisée par l'équipe.

Mobile d'abord : sur petit écran les tableaux deviennent des cartes empilées, aucun défilement
horizontal.

## 9. Notifications Telegram

Via le `sendTelegram()` existant (`index.ts:320`), en respectant sa règle : un échec d'envoi ne
fait jamais échouer la requête principale.

- Nouvelle demande : message à tous les cleaners `role='manager'` ayant un `telegram_chat_id`.
- Décision rendue : message au demandeur.
- Expiration de document : sur `hrOverview`, si un document expire dans 60 ou 30 jours et qu'aucune
  alerte n'a été envoyée pour ce palier, envoi aux managers. L'état est mémorisé dans la table
  `app_config` existante sous une clé par document et par palier, pour ne pas alerter deux fois.

## 10. Tests

Suite Playwright existante, même approche que `tests/laundry.spec.ts` : les helpers purs sont
exposés sur `window` et évalués dans le navigateur contre l'implémentation réelle.

Nouveau fichier `tests/hr.spec.ts`, écrit avant l'interface :

- `leaveDays` : jour unique, période sur un mois, année bissextile, passage d'année.
- `accruedAnnualDays` : moins de 6 mois, exactement 6 mois, 11 mois, 12 mois, 3 ans.
- solde avec `opening_annual_days` non nul et congés antérieurs à `opening_date` ignorés.
- `sickTiers` : 0, 10, 20, 50, 100 jours, et vérification des plafonds 15 / 30 / 45.
- `gratuityEstimate` : moins d'un an, 3 ans, 7 ans, effet des jours non payés, plafond 24 mois.
- chevauchement : périodes disjointes, adjacentes, incluses, identiques.

Le blocage d'assignation est vérifié manuellement contre la prod après déploiement : créer un
congé approuvé, tenter d'assigner, constater le refus.

## 11. Livraison

La migration du 4.2 est unique et crée l'intégralité du schéma en une fois, y compris `is_owner`
et les colonnes de salaire. Découper le schéma en trois migrations n'apporterait rien et
multiplierait les occasions de désynchroniser la base et le code. Ce sont les routes et
l'interface qui sont livrées en trois phases, chacune déployable et utile seule.

**Phase 1, congés.** Migration complète, routes de congés, calculs et tests, onglet RH réduit aux
demandes et à l'équipe, onglet Congés côté employé, blocage de l'assignation, notifications de
demande et de décision.

**Phase 2, documents.** Routes documents, section documents dans la fiche employé, section
documents expirants, alertes Telegram à 60 et 30 jours.

**Phase 3, rémunération.** Route `hrGetCompensation`, calcul de gratuity, bloc rémunération
réservé à Hillal. Passer `is_owner = true` sur sa ligne dans `cleaners`.

Déploiement : `npm run deploy:proxy` pour l'edge function, puis `netlify deploy --prod --dir .`
pour le front, après avoir incrémenté `VERSION` dans `sw.js`. Ne jamais déployer l'edge function
avec un `supabase functions deploy` brut, cela remet `verify_jwt=true` et casse toute l'app.

## 12. Risques

| Risque | Traitement |
|---|---|
| Un salaire fuite vers un manager ou un cleaner | Colonnes dans une table séparée, une seule route les lit, elle exige `is_owner`. |
| Le blocage empêche une réassignation urgente | Un manager peut annuler ou raccourcir un congé approuvé, ce qui débloque immédiatement. |
| Les règles légales évoluent ou sont mal interprétées | Calculs isolés dans des fonctions pures testées, mention explicite que la gratuity est indicative. |
| Le service worker sert un `hr.js` périmé | `/hr.js` ajouté à la stratégie network-first, `VERSION` incrémentée à chaque déploiement. |
| Soldes faux pour les salariés déjà en poste | `opening_annual_days` et `opening_date` à saisir une fois par personne au démarrage. |
