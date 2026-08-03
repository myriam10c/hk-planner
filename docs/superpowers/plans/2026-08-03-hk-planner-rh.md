# Module RH HK Planner - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au HK Planner un module RH permettant de suivre les congés (demande par le salarié, validation par le manager, blocage strict des assignations), le dossier employé avec ses documents et leurs expirations, et la rémunération avec estimation de gratuity visible uniquement par Hillal.

**Architecture:** Trois nouvelles tables Postgres (`employees`, `leave_requests`, `employee_documents`) plus une colonne `cleaners.is_owner`. Les données sensibles de rémunération vivent exclusivement dans `employees`, une table qu'aucune route existante ne lit : la confidentialité est garantie par construction et non par un audit de `select`. Le backend est l'edge function Deno `hostaway-proxy` (10 nouvelles actions, toutes derrière un helper `hrAuth` à trois niveaux staff/manager/owner). Le frontend est un nouveau fichier `hr.js` chargé en `<script>` classique avant `app.js`, qui partage le scope global (fonctions `esc`, `icon`, `api`, `apiWrite`, `render`) et expose ses handlers comme globales pour la délégation `data-action` existante.

**Tech Stack:** Postgres (Supabase), Deno / TypeScript (edge function `hostaway-proxy`), vanilla JS ES5-compatible (pas de bundler, pas de modules), Playwright pour les tests des helpers purs, Netlify pour l'hébergement statique.

**Spec de référence :** `docs/superpowers/specs/2026-08-03-hk-planner-rh-design.md`

## Global Constraints

- **Aucun tiret cadratin (`—`)** dans le code, les commentaires, les libellés UI, les messages de commit ou les rapports. Utiliser virgule, point, deux-points ou `-`.
- **Libellés UI en anglais.** L'équipe (cleaners, managers) lit l'app en anglais. Les commentaires de code peuvent être en français, comme le reste du repo.
- **Toute nouvelle action du proxy doit être enregistrée dans la Map `ROUTES`** (`supabase/functions/hostaway-proxy/index.ts:472`). Une action absente de cette Map renvoie 404 avant d'atteindre son handler.
- **Aucun montant de salaire ne sort du proxy en dehors de la route `hrGetCompensation`.** Les `select` sur `employees` faits par d'autres routes doivent lister explicitement leurs colonnes, jamais `select("*")`.
- **Déployer le frontend uniquement via `./deploy-front.sh`.** Le script stampe lui-même `sw.js` VERSION avec la date et le hash de commit. Ne jamais éditer `VERSION` à la main : un déploiement `netlify deploy` direct laisserait les clients existants sur l'ancien bundle.
- **Pas de dépendance npm ajoutée.** Le frontend est du vanilla JS servi tel quel.
- **Décompte des congés en jours calendaires**, bornes incluses (du 10 au 20 = 11 jours).
- **`days` est toujours recalculé côté serveur** à partir de `start_date` et `end_date`. La valeur envoyée par le client n'est jamais faite confiance.
- **Le type de congé n'est jamais exposé aux non-managers.** Les congés visibles dans `getAllData` ne portent que `cleaner_id`, `start_date`, `end_date`.
- **Pas de suivi d'heures supplémentaires.** Décision explicite de Hillal, hors périmètre.

## File Structure

| Fichier | Rôle |
|---|---|
| `supabase/migrations/20260803120000_hr.sql` (créer) | Schéma complet du module : 3 tables + colonne `is_owner` + index + RLS. Migration unique, appliquée en une fois. |
| `supabase/functions/hostaway-proxy/index.ts` (modifier) | Helper `hrAuth`, 10 handlers RH, blocage des assignations, exclusion de l'auto-assign, ajout de `leaves` dans `getAllData`, notifications Telegram. |
| `hr.js` (créer) | Module RH frontend complet : helpers purs de calcul (congés, ancienneté, gratuity), état local, chargement des données, rendu des écrans manager et salarié, handlers `data-action`. |
| `index.html` (modifier) | Ajout de `<script src="/hr.js"></script>` avant `app.js`. |
| `sw.js` (modifier) | `/hr.js` ajouté au `PRECACHE` et à la branche network-first, `VERSION` incrémentée. |
| `styles.css` (modifier) | Styles des écrans RH. |
| `app.js` (modifier) | Dispatch de l'onglet `hr` dans `render()`, entrée dans le menu More, marquage "on leave" dans les surfaces d'assignation. |
| `tests/hr.spec.ts` (créer) | Tests Playwright des helpers purs exposés sur `window`. |

`hr.js` est un fichier séparé et non un ajout à `app.js` parce que `app.js` fait déjà 7000 lignes. Le module RH est autonome : il ne partage avec `app.js` que des utilitaires (`esc`, `icon`, `api`, `apiWrite`, `toast`, `render`) et la variable globale `cleanerMode`.

---

## Phase 1 - Congés (Tasks 1 à 11)

### Task 1: Migration SQL du schéma RH

**Files:**
- Create: `supabase/migrations/20260803120000_hr.sql`

**Interfaces:**
- Consumes: table existante `public.cleaners` (PK `id INTEGER`, colonnes `name`, `role`, `is_active`, `telegram_chat_id`).
- Produces: tables `public.employees`, `public.leave_requests`, `public.employee_documents`, colonne `public.cleaners.is_owner BOOLEAN NOT NULL DEFAULT false`.

- [ ] **Step 1: Écrire le fichier de migration**

Créer `supabase/migrations/20260803120000_hr.sql` avec exactement ce contenu :

```sql
-- ============================================================================
-- Module RH : congés, dossier employé, documents.
--
-- Modèle :
--  - `employees` porte le dossier RH d'un membre de l'équipe déjà présent dans
--    `cleaners` (au plus 1 ligne par cleaner_id). Les colonnes de rémunération
--    vivent ICI et nulle part ailleurs. Aucune route existante ne lit cette
--    table, donc les montants ne peuvent pas fuiter par un `select *` sur
--    `cleaners` (cf. getAllData, qui renvoie `cleaners.*` à tous les clients,
--    y compris en mode cleaner).
--  - `leave_requests` est le journal des demandes de congé. Le solde n'est
--    jamais stocké : il se recalcule à la volée (acquis légal + ajustement
--    d'ouverture - jours approuvés).
--  - `employee_documents` suit passeport / visa / Emirates ID et leurs dates
--    d'expiration.
--
-- Sécurité : RLS activée sans policy sur les trois tables. L'anon key ne peut
-- donc rien lire ni écrire ; tout passe par l'edge function hostaway-proxy en
-- service_role, qui applique ses propres gates staff / manager / owner.
-- ============================================================================

-- `is_owner` distingue Hillal des autres managers. On n'ajoute PAS un
-- role='owner' : des dizaines de gates existantes testent `role !== 'manager'`
-- et casseraient pour lui. Il reste manager, avec ce drapeau en plus.
ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cleaners.is_owner IS
  'true uniquement pour le CEO. Seul niveau autorisé à voir la rémunération.';

CREATE TABLE IF NOT EXISTS public.employees (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaner_id           INTEGER NOT NULL UNIQUE REFERENCES public.cleaners(id) ON DELETE RESTRICT,
  hire_date            DATE NOT NULL,
  end_date             DATE,
  job_title            TEXT,
  nationality          TEXT,
  opening_annual_days  NUMERIC(6,2) NOT NULL DEFAULT 0,
  opening_date         DATE NOT NULL,
  basic_salary         NUMERIC(10,2),
  housing_allowance    NUMERIC(10,2),
  transport_allowance  NUMERIC(10,2),
  other_allowance      NUMERIC(10,2),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employees_end_after_hire     CHECK (end_date IS NULL OR end_date >= hire_date),
  CONSTRAINT employees_opening_after_hire CHECK (opening_date >= hire_date)
);

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaner_id     INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  leave_type     TEXT NOT NULL CHECK (leave_type IN ('annual','sick','unpaid','maternity','parental','bereavement','hajj','other')),
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  days           NUMERIC(6,2) NOT NULL CHECK (days > 0),
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason         TEXT,
  requested_by   TEXT,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_end_after_start CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS leave_requests_cleaner_start_idx
  ON public.leave_requests (cleaner_id, start_date);
CREATE INDEX IF NOT EXISTS leave_requests_status_idx
  ON public.leave_requests (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS leave_requests_approved_range_idx
  ON public.leave_requests (start_date, end_date) WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS public.employee_documents (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaner_id   INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('passport','emirates_id','visa','labour_card','medical_insurance','contract','other')),
  doc_number   TEXT,
  issue_date   DATE,
  expiry_date  DATE,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_documents_cleaner_idx
  ON public.employee_documents (cleaner_id);
CREATE INDEX IF NOT EXISTS employee_documents_expiry_idx
  ON public.employee_documents (expiry_date) WHERE expiry_date IS NOT NULL;

ALTER TABLE public.employees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_documents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.employees IS
  'Dossier RH d''un membre de l''équipe. Colonnes de rémunération réservées au CEO (cleaners.is_owner).';
COMMENT ON TABLE public.leave_requests IS
  'Demandes de congé. days est recalculé côté serveur en jours calendaires, bornes incluses.';
COMMENT ON TABLE public.employee_documents IS
  'Passeport / visa / Emirates ID et leurs expirations.';
COMMENT ON COLUMN public.employees.opening_annual_days IS
  'Solde de congés annuels repris manuellement à la date opening_date. L''acquis légal se calcule à partir de cette date.';
```

- [ ] **Step 2: Appliquer la migration**

Appliquer sur le projet Supabase `dqjnqvbxfwtvrjwnnmns` (havn-stays-guide / HK Planner prod) via l'outil MCP `mcp__claude_ai_Supabase__apply_migration`, avec `name: "hr"` et le contenu SQL ci-dessus.

- [ ] **Step 3: Vérifier que le schéma est en place**

Via `mcp__claude_ai_Supabase__execute_sql` sur le même projet :

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name IN ('employees','leave_requests','employee_documents')
       OR (table_name = 'cleaners' AND column_name = 'is_owner'))
ORDER BY table_name, ordinal_position;
```

Attendu : les 3 tables listées avec toutes leurs colonnes, plus `cleaners.is_owner` de type `boolean`.

- [ ] **Step 4: Marquer Hillal comme owner**

Trouver son `cleaners.id` puis le marquer. Via `mcp__claude_ai_Supabase__execute_sql` :

```sql
SELECT id, name, role, is_owner FROM public.cleaners WHERE role = 'manager' ORDER BY id;
```

Puis, avec l'id de Hillal (ne pas deviner, prendre celui de la ligne dont le `name` correspond à Hillal) :

```sql
UPDATE public.cleaners SET is_owner = true WHERE id = <ID_DE_HILLAL>;
SELECT id, name, is_owner FROM public.cleaners WHERE is_owner = true;
```

Attendu : exactement une ligne, celle de Hillal. Si aucun manager ne correspond clairement à Hillal, s'arrêter et le signaler plutôt que de deviner.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260803120000_hr.sql
git commit -m "feat(rh): schema congés, dossier employé et documents"
```

---

### Task 2: Helpers purs de calcul RH (TDD) et chargement de hr.js

**Files:**
- Create: `hr.js`
- Create: `tests/hr.spec.ts`
- Modify: `index.html:27`
- Modify: `sw.js:11`, `sw.js:48`

**Interfaces:**
- Produces (exposés sur `window` par `hr.js`) :
  - `leaveDays(start: string, end: string): number` - jours calendaires bornes incluses, 0 si invalide.
  - `completeMonths(from: string, to: string): number` - mois complets écoulés.
  - `accruedAnnualDays(hireDate: string, asOf: string, openingDays: number, openingDate: string): number` - droit annuel acquis cumulé.
  - `sickTiers(daysUsed: number): {full,half,unpaid,used,remaining}` - ventilation légale du congé maladie.
  - `rangesOverlap(aStart, aEnd, bStart, bEnd): boolean`
  - `gratuityEstimate(hireDate, endDate, basicSalary, unpaidDays): {years, days, amount}`
  - `HR_LEAVE_TYPES: Array<{key, label}>` - liste figée des types de congé.
  - `daysUntil(dateStr: string, todayStr: string): number|null`

- [ ] **Step 1: Écrire le fichier de tests (il doit échouer)**

Créer `tests/hr.spec.ts` :

```ts
import { test, expect } from '@playwright/test';

// Tests unitaires des helpers RH purs exposés en globales par hr.js.
// Ils tournent dans le contexte navigateur, donc c'est bien la vraie
// implémentation qui est exercée.
//
// Boucle locale rapide :
//   python3 -m http.server 8888
//   HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/hr.spec.ts --project=desktop

test.beforeEach(async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof (window as any).leaveDays === 'function'
      && typeof (window as any).gratuityEstimate === 'function',
    null,
    { timeout: 10_000 },
  );
});

test('leaveDays compte les jours calendaires, bornes incluses', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      sameDay: w.leaveDays('2026-08-10', '2026-08-10'),
      elevenDays: w.leaveDays('2026-08-10', '2026-08-20'),
      acrossMonth: w.leaveDays('2026-08-28', '2026-09-02'),
      acrossYear: w.leaveDays('2026-12-30', '2027-01-02'),
      reversed: w.leaveDays('2026-08-20', '2026-08-10'),
      garbage: w.leaveDays('nope', '2026-08-10'),
    };
  });
  expect(r.sameDay).toBe(1);
  expect(r.elevenDays).toBe(11);
  expect(r.acrossMonth).toBe(6);
  expect(r.acrossYear).toBe(4);
  expect(r.reversed).toBe(0);
  expect(r.garbage).toBe(0);
});

test('completeMonths ne compte que les mois révolus', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      exactlyOne: w.completeMonths('2026-01-15', '2026-02-15'),
      oneDayShort: w.completeMonths('2026-01-15', '2026-02-14'),
      twelve: w.completeMonths('2025-03-01', '2026-03-01'),
      past: w.completeMonths('2026-05-01', '2026-04-01'),
      endOfMonth: w.completeMonths('2026-01-31', '2026-03-01'),
    };
  });
  expect(r.exactlyOne).toBe(1);
  expect(r.oneDayShort).toBe(0);
  expect(r.twelve).toBe(12);
  expect(r.past).toBe(0);
  expect(r.endOfMonth).toBe(1);
});

test('accruedAnnualDays applique les paliers du droit émirien', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      // 3 mois de service : rien d'acquis
      threeMonths: w.accruedAnnualDays('2026-05-01', '2026-08-01', 0, '2026-05-01'),
      // 6 mois : 6 x 2 = 12
      sixMonths: w.accruedAnnualDays('2026-02-01', '2026-08-01', 0, '2026-02-01'),
      // 11 mois : 11 x 2 = 22
      elevenMonths: w.accruedAnnualDays('2025-09-01', '2026-08-01', 0, '2025-09-01'),
      // 12 mois : 12 x 2.5 = 30
      twelveMonths: w.accruedAnnualDays('2025-08-01', '2026-08-01', 0, '2025-08-01'),
      // 24 mois : 24 x 2.5 = 60
      twoYears: w.accruedAnnualDays('2024-08-01', '2026-08-01', 0, '2024-08-01'),
      // reprise manuelle : 5 jours au 2026-02-01, puis 6 mois de plus
      withOpening: w.accruedAnnualDays('2024-01-01', '2026-08-01', 5, '2026-02-01'),
    };
  });
  expect(r.threeMonths).toBe(0);
  expect(r.sixMonths).toBe(12);
  expect(r.elevenMonths).toBe(22);
  expect(r.twelveMonths).toBe(30);
  expect(r.twoYears).toBe(60);
  // 5 repris + 6 mois a 2.5 (ancienneté deja > 12 mois) = 5 + 15
  expect(r.withOpening).toBe(20);
});

test('sickTiers ventile 15 pleins / 30 demi / 45 non payés', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return [w.sickTiers(0), w.sickTiers(10), w.sickTiers(15), w.sickTiers(30), w.sickTiers(60), w.sickTiers(95)];
  });
  expect(r[0]).toMatchObject({ full: 0, half: 0, unpaid: 0, used: 0, remaining: 90 });
  expect(r[1]).toMatchObject({ full: 10, half: 0, unpaid: 0, remaining: 80 });
  expect(r[2]).toMatchObject({ full: 15, half: 0, unpaid: 0, remaining: 75 });
  expect(r[3]).toMatchObject({ full: 15, half: 15, unpaid: 0, remaining: 60 });
  expect(r[4]).toMatchObject({ full: 15, half: 30, unpaid: 15, remaining: 30 });
  expect(r[5]).toMatchObject({ full: 15, half: 30, unpaid: 45, remaining: 0 });
});

test('rangesOverlap detecte les chevauchements bornes incluses', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      identical: w.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-10', '2026-08-12'),
      touching: w.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-12', '2026-08-15'),
      inside: w.rangesOverlap('2026-08-10', '2026-08-20', '2026-08-14', '2026-08-15'),
      before: w.rangesOverlap('2026-08-10', '2026-08-12', '2026-08-13', '2026-08-15'),
      after: w.rangesOverlap('2026-08-20', '2026-08-22', '2026-08-13', '2026-08-15'),
    };
  });
  expect(r.identical).toBe(true);
  expect(r.touching).toBe(true);
  expect(r.inside).toBe(true);
  expect(r.before).toBe(false);
  expect(r.after).toBe(false);
});

test('gratuityEstimate suit 21 jours par an puis 30 au dela de 5 ans', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      underOneYear: w.gratuityEstimate('2026-02-01', '2026-08-01', 3000, 0),
      // 2 ans pile, basic 3000 -> daily 100 -> 2 x 21 x 100 = 4200
      twoYears: w.gratuityEstimate('2024-08-01', '2026-08-01', 3000, 0),
      // ~7 ans : 5 x 21 x 100 + ~2 x 30 x 100 = 10500 + ~6000
      sevenYears: w.gratuityEstimate('2019-08-02', '2026-08-01', 3000, 0),
      noBasic: w.gratuityEstimate('2020-01-01', '2026-08-01', null, 0),
    };
  });
  expect(r.underOneYear.amount).toBe(0);
  expect(r.twoYears.amount).toBeCloseTo(4200, 0);
  // L'ancienneté est calculée en jours / 365, donc les années bissextiles
  // décalent le résultat de quelques dizaines de dirhams. On borne au lieu
  // de figer une valeur exacte qui dépendrait de la date de test.
  expect(r.sevenYears.amount).toBeGreaterThan(16400);
  expect(r.sevenYears.amount).toBeLessThan(16700);
  expect(r.noBasic.amount).toBe(0);
});

test('gratuityEstimate plafonne a 24 mois de basic', async ({ page }) => {
  const amount = await page.evaluate(
    () => (window as any).gratuityEstimate('1980-01-01', '2026-08-01', 3000, 0).amount,
  );
  expect(amount).toBe(72000);
});

test('gratuityEstimate deduit les jours de conge non payes', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      withUnpaid: w.gratuityEstimate('2024-08-01', '2026-08-01', 3000, 30).amount,
      without: w.gratuityEstimate('2024-08-01', '2026-08-01', 3000, 0).amount,
    };
  });
  expect(r.withUnpaid).toBeLessThan(r.without);
});

test('daysUntil renvoie le nombre de jours restants', async ({ page }) => {
  const r = await page.evaluate(() => {
    const w = window as any;
    return {
      future: w.daysUntil('2026-08-31', '2026-08-01'),
      today: w.daysUntil('2026-08-01', '2026-08-01'),
      past: w.daysUntil('2026-07-25', '2026-08-01'),
      empty: w.daysUntil('', '2026-08-01'),
    };
  });
  expect(r.future).toBe(30);
  expect(r.today).toBe(0);
  expect(r.past).toBe(-7);
  expect(r.empty).toBeNull();
});

test('HR_LEAVE_TYPES est la liste figée des types de conge', async ({ page }) => {
  const types = await page.evaluate(() => (window as any).HR_LEAVE_TYPES);
  expect(types.map((x: any) => x.key)).toEqual([
    'annual', 'sick', 'unpaid', 'maternity', 'parental', 'bereavement', 'hajj', 'other',
  ]);
  types.forEach((x: any) => expect(typeof x.label).toBe('string'));
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo"
python3 -m http.server 8888 >/dev/null 2>&1 &
HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/hr.spec.ts --project=desktop
```

Attendu : ÉCHEC sur le `waitForFunction` du `beforeEach`, `window.leaveDays` n'existe pas.

- [ ] **Step 3: Créer hr.js avec les helpers purs**

Créer `hr.js` :

```js
// HK Planner - module RH.
// Chargé en <script> classique AVANT app.js : les deux partagent le scope
// global, donc hr.js peut appeler esc()/icon()/api() d'app.js au runtime, et
// app.js peut appeler renderHR() (gardé par un typeof).
//
// Cette première section ne contient que des fonctions PURES : pas de DOM, pas
// de réseau, pas d'état. Elles sont testées telles quelles par tests/hr.spec.ts.

const HR_LEAVE_TYPES = [
  { key: 'annual',      label: 'Annual leave' },
  { key: 'sick',        label: 'Sick leave' },
  { key: 'unpaid',      label: 'Unpaid leave' },
  { key: 'maternity',   label: 'Maternity leave' },
  { key: 'parental',    label: 'Parental leave' },
  { key: 'bereavement', label: 'Bereavement leave' },
  { key: 'hajj',        label: 'Hajj leave' },
  { key: 'other',       label: 'Other' },
];

const HR_DOC_TYPES = [
  { key: 'passport',          label: 'Passport' },
  { key: 'emirates_id',       label: 'Emirates ID' },
  { key: 'visa',              label: 'Residence visa' },
  { key: 'labour_card',       label: 'Labour card' },
  { key: 'medical_insurance', label: 'Medical insurance' },
  { key: 'contract',          label: 'Contract' },
  { key: 'other',             label: 'Other' },
];

// Jours calendaires, bornes incluses. Du 10 au 20 = 11 jours.
function leaveDays(start, end){
  const a = Date.parse(String(start) + 'T00:00:00Z');
  const b = Date.parse(String(end) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

// Mois révolus entre deux dates. Le 15/01 -> 14/02 ne fait pas un mois.
function completeMonths(from, to){
  const f = new Date(String(from) + 'T00:00:00Z');
  const t = new Date(String(to) + 'T00:00:00Z');
  if (isNaN(f.getTime()) || isNaN(t.getTime()) || t < f) return 0;
  let m = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + (t.getUTCMonth() - f.getUTCMonth());
  if (t.getUTCDate() < f.getUTCDate()) m--;
  return Math.max(0, m);
}

// Droit annuel acquis, décret-loi fédéral 33/2021 :
//   - moins de 6 mois d'ancienneté : 0
//   - de 6 à 12 mois : 2 jours par mois révolu
//   - au-dela de 12 mois : 2,5 jours par mois révolu (30 jours par an)
// openingDays/openingDate permettent de reprendre un solde existant : on ne
// calcule alors l'acquis qu'a partir d'openingDate, mais le PALIER dépend de
// l'ancienneté réelle depuis hireDate.
function accruedAnnualDays(hireDate, asOf, openingDays, openingDate){
  const opening = Number(openingDays) || 0;
  const from = openingDate || hireDate;
  const tenureMonths = completeMonths(hireDate, asOf);
  if (tenureMonths < 6) return opening;
  const earnedMonths = completeMonths(from, asOf);
  const rate = tenureMonths >= 12 ? 2.5 : 2;
  return Math.round((opening + earnedMonths * rate) * 100) / 100;
}

// Congé maladie par année de service : 15 jours plein salaire, 30 jours a
// demi-salaire, 45 jours non payés. 90 jours au total.
function sickTiers(daysUsed){
  const d = Math.max(0, Number(daysUsed) || 0);
  return {
    full: Math.min(d, 15),
    half: Math.min(Math.max(d - 15, 0), 30),
    unpaid: Math.min(Math.max(d - 45, 0), 45),
    used: d,
    remaining: Math.max(0, 90 - d),
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd){
  return String(aStart) <= String(bEnd) && String(bStart) <= String(aEnd);
}

// Indemnité de fin de service : 21 jours de basic par an sur les 5 premières
// années, 30 jours par an ensuite, plafonnée a 24 mois de basic. Les jours de
// congé non payé ne comptent pas dans l'ancienneté.
function gratuityEstimate(hireDate, endDate, basicSalary, unpaidDays){
  const basic = Number(basicSalary) || 0;
  const a = Date.parse(String(hireDate) + 'T00:00:00Z');
  const b = Date.parse(String(endDate) + 'T00:00:00Z');
  if (!basic || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) {
    return { years: 0, days: 0, amount: 0 };
  }
  const serviceDays = Math.max(0, (b - a) / 86400000 - (Number(unpaidDays) || 0));
  const years = serviceDays / 365;
  if (years < 1) return { years: Math.round(years * 100) / 100, days: 0, amount: 0 };
  const daily = basic / 30;
  const gratDays = Math.min(years, 5) * 21 + Math.max(years - 5, 0) * 30;
  const amount = Math.min(gratDays * daily, 24 * basic);
  return {
    years: Math.round(years * 100) / 100,
    days: Math.round(gratDays * 100) / 100,
    amount: Math.round(amount * 100) / 100,
  };
}

// Jours restants avant une date. Négatif si déja passée, null si vide.
function daysUntil(dateStr, todayStr){
  if (!dateStr) return null;
  const a = Date.parse(String(dateStr) + 'T00:00:00Z');
  const b = Date.parse(String(todayStr || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86400000);
}

window.HR_LEAVE_TYPES = HR_LEAVE_TYPES;
window.HR_DOC_TYPES = HR_DOC_TYPES;
```

Note : les `function` de haut niveau d'un script classique deviennent automatiquement des propriétés de `window`, donc `leaveDays` et consorts sont accessibles sans export explicite. Seuls les `const` ont besoin de la réassignation explicite en fin de fichier.

- [ ] **Step 4: Charger hr.js depuis index.html**

Dans `index.html`, remplacer la ligne 27 :

```html
<script src="/app.js"></script>
```

par :

```html
<script src="/hr.js"></script>
<script src="/app.js"></script>
```

- [ ] **Step 5: Déclarer hr.js dans le service worker**

Dans `sw.js`, deux modifications. Ne PAS toucher a `VERSION` : `deploy-front.sh` la stampe automatiquement au déploiement.

1. Ligne 11, ajouter `/hr.js` au precache :
```js
const PRECACHE = ['/', '/index.html', '/hr.js', '/app.js', '/styles.css', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
```

2. Ligne 48, ajouter `/hr.js` a la branche network-first :
```js
    if (req.mode === 'navigate' || url.pathname === '/app.js' || url.pathname === '/hr.js' || url.pathname === '/styles.css') {
```

- [ ] **Step 6: Relancer les tests, ils doivent passer**

```bash
HK_PLANNER_URL=http://localhost:8888 npx playwright test tests/hr.spec.ts --project=desktop
```

Attendu : les 9 tests passent. Si `accruedAnnualDays` échoue sur le cas `withOpening`, vérifier que le palier est bien choisi sur `completeMonths(hireDate, asOf)` et non sur `completeMonths(openingDate, asOf)`.

- [ ] **Step 7: Commit**

```bash
git add hr.js tests/hr.spec.ts index.html sw.js
git commit -m "feat(rh): helpers de calcul congés et gratuity, chargement de hr.js"
```

---

### Task 3: Helper d'auth RH et routes de lecture du proxy

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (ajout dans `ROUTES` vers la ligne 599, nouveau helper après `validateCleanerToken` ligne 315, nouveaux handlers avant le bloc `getAllData`)

**Interfaces:**
- Consumes: `validateCleanerToken(sb, token)` qui renvoie `{cleaner_id, name, role, color}` ou `null` ; `jsonResp(body, status)`.
- Produces:
  - `hrAuth(sb, req, level)` renvoyant `{ me, isOwner, err }` ; si `err` n'est pas null, le handler doit le retourner tel quel.
  - Action GET `hrOverview` : `{ status:"success", employees: [...], pending: [...], upcoming: [...], today: "YYYY-MM-DD", isOwner: boolean }`
  - Action GET `hrMyLeave` : `{ status:"success", employee: {...}|null, requests: [...], today: "YYYY-MM-DD" }`

- [ ] **Step 1: Ajouter le helper hrAuth**

Dans `supabase/functions/hostaway-proxy/index.ts`, juste après la fonction `validateCleanerToken` (elle se termine vers la ligne 316), insérer :

```ts
// Gate d'auth du module RH, a trois niveaux :
//   staff   : n'importe quel membre authentifié (agit sur son propre dossier)
//   manager : role === 'manager'
//   owner   : role === 'manager' ET cleaners.is_owner (Hillal uniquement)
// Retourne { me, isOwner, err }. Si err n'est pas null, le handler doit le
// retourner immédiatement sans rien faire d'autre.
async function hrAuth(sb: any, req: Request, level: "staff" | "manager" | "owner") {
  const me = await validateCleanerToken(sb, req.headers.get("x-cleaner-token"));
  if (!me) return { me: null, isOwner: false, err: jsonResp({ error: "auth required" }, 401) };
  const { data } = await sb.from("cleaners").select("is_owner").eq("id", me.cleaner_id).maybeSingle();
  const isOwner = !!(data && data.is_owner);
  if (level !== "staff" && me.role !== "manager") {
    return { me: null, isOwner, err: jsonResp({ error: "manager auth required" }, 403) };
  }
  if (level === "owner" && !isOwner) {
    return { me: null, isOwner, err: jsonResp({ error: "owner auth required" }, 403) };
  }
  return { me, isOwner, err: null };
}

// Jours calendaires bornes incluses. Miroir serveur de leaveDays() de hr.js :
// la valeur envoyée par le client n'est jamais utilisée.
function hrLeaveDays(start: string, end: string): number {
  const a = Date.parse(String(start) + "T00:00:00Z");
  const b = Date.parse(String(end) + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

const HR_TODAY = () => new Date().toISOString().slice(0, 10);

// Colonnes non sensibles d'employees. Utilisée par toutes les routes SAUF
// hrGetCompensation. Ne jamais remplacer par un select("*") : les colonnes de
// salaire sortiraient vers les managers non-owner.
const HR_EMPLOYEE_PUBLIC_COLS =
  "id, cleaner_id, hire_date, end_date, job_title, nationality, opening_annual_days, opening_date, notes, created_at, updated_at";
```

- [ ] **Step 2: Enregistrer les routes de lecture**

Dans la Map `ROUTES`, juste après le bloc `// ===== Laundry =====` (dernier bloc, se termine par `["addLaundryMovement", "POST"],` vers la ligne 599), ajouter :

```ts
  // ===== RH (congés, dossier employé, documents) =====
  ["hrOverview", "GET"],
  ["hrMyLeave", "GET"],
```

- [ ] **Step 3: Implémenter hrOverview et hrMyLeave**

Juste avant le bloc `// ========== PROPERTY HEATMAP ==========` (vers la ligne 1922), insérer :

```ts
    // ========== RH : LECTURE ==========
    if (action === "hrOverview") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const today = HR_TODAY();
      const horizon = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      const [empRes, pendingRes, upcomingRes, takenRes] = await Promise.all([
        sb.from("employees").select(HR_EMPLOYEE_PUBLIC_COLS).order("hire_date"),
        sb.from("leave_requests").select("*").eq("status", "pending").order("start_date"),
        sb.from("leave_requests").select("*").eq("status", "approved").gte("end_date", today).lte("start_date", horizon).order("start_date"),
        sb.from("leave_requests").select("cleaner_id, leave_type, days, start_date, end_date").eq("status", "approved"),
      ]);
      // Cumul des jours approuvés par employé et par type, pour que le client
      // puisse afficher un solde sans refaire un aller-retour par personne.
      const taken: Record<string, Record<string, number>> = {};
      (takenRes.data || []).forEach((r: any) => {
        const k = String(r.cleaner_id);
        if (!taken[k]) taken[k] = {};
        taken[k][r.leave_type] = (taken[k][r.leave_type] || 0) + Number(r.days || 0);
      });
      return jsonResp({
        status: "success",
        employees: empRes.data || [],
        pending: pendingRes.data || [],
        upcoming: upcomingRes.data || [],
        taken,
        today,
        isOwner: g.isOwner,
      });
    }

    if (action === "hrMyLeave") {
      const g = await hrAuth(sb, req, "staff");
      if (g.err) return g.err;
      const [empRes, reqRes] = await Promise.all([
        sb.from("employees").select(HR_EMPLOYEE_PUBLIC_COLS).eq("cleaner_id", g.me!.cleaner_id).maybeSingle(),
        sb.from("leave_requests").select("*").eq("cleaner_id", g.me!.cleaner_id).order("start_date", { ascending: false }).limit(100),
      ]);
      return jsonResp({
        status: "success",
        employee: empRes.data || null,
        requests: reqRes.data || [],
        today: HR_TODAY(),
      });
    }
```

- [ ] **Step 4: Déployer et vérifier les gates**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo"
npm run deploy:proxy
```

Puis vérifier qu'une action inconnue est bien 404 et que la route existe (sans token, on doit obtenir 401 et non 404) :

```bash
SECRET='0RicFT1AZL0NDyH1M2ZWhbUvworsGOx38UhNNwFVF8dmP8SC-TRXfaoyQbR5pdn0'
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE?action=hrOverview"  -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE?action=hrMyLeave"   -H "X-App-Secret: $SECRET"
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE?action=hrNotARoute" -H "X-App-Secret: $SECRET"
```

Attendu : `401`, `401`, `404`. Un `404` sur les deux premières signifie que la Map `ROUTES` n'a pas été mise a jour.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(rh): helper hrAuth et routes de lecture hrOverview/hrMyLeave"
```

---

### Task 4: Routes d'écriture des congés

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (Map `ROUTES`, puis nouveaux handlers a la suite de `hrMyLeave`)

**Interfaces:**
- Consumes: `hrAuth(sb, req, level)`, `hrLeaveDays(start, end)`, `HR_TODAY()`, `sendTelegram(chatId, text)`.
- Produces:
  - POST `hrSubmitLeave` body `{cleaner_id?, leave_type, start_date, end_date, reason?}` -> `{status:"success", request:{...}}`
  - POST `hrDecideLeave` body `{id, decision:"approved"|"rejected", note?}` -> `{status:"success", request:{...}}`
  - POST `hrCancelLeave` body `{id}` -> `{status:"success", request:{...}}`

- [ ] **Step 1: Enregistrer les trois routes**

Dans la Map `ROUTES`, sous le bloc `// ===== RH ... =====` créé en Task 3, ajouter :

```ts
  ["hrSubmitLeave", "POST"],
  ["hrDecideLeave", "POST"],
  ["hrCancelLeave", "POST"],
```

- [ ] **Step 2: Ajouter le helper de notification RH**

Juste après `hrLeaveDays` (Task 3), ajouter :

```ts
const HR_LEAVE_LABELS: Record<string, string> = {
  annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave",
  maternity: "Maternity leave", parental: "Parental leave",
  bereavement: "Bereavement leave", hajj: "Hajj leave", other: "Leave",
};

// Notifie tous les managers ayant un chat Telegram. Les échecs sont avalés par
// sendTelegram : une notif ratée ne doit pas faire échouer la demande.
async function hrNotifyManagers(sb: any, text: string) {
  const { data } = await sb.from("cleaners")
    .select("telegram_chat_id").eq("role", "manager").eq("is_active", true)
    .not("telegram_chat_id", "is", null);
  await Promise.all((data || []).map((c: any) => sendTelegram(c.telegram_chat_id, text)));
}

async function hrNotifyCleaner(sb: any, cleanerId: number, text: string) {
  const { data } = await sb.from("cleaners").select("telegram_chat_id").eq("id", cleanerId).maybeSingle();
  if (data && data.telegram_chat_id) await sendTelegram(data.telegram_chat_id, text);
}
```

- [ ] **Step 3: Implémenter hrSubmitLeave**

A la suite du handler `hrMyLeave` :

```ts
    if (action === "hrSubmitLeave" && req.method === "POST") {
      const g = await hrAuth(sb, req, "staff");
      if (g.err) return g.err;
      const body = await req.json();
      const target = Number(body.cleaner_id) || g.me!.cleaner_id;
      // Déposer une demande pour quelqu'un d'autre est une action de manager.
      if (target !== g.me!.cleaner_id && g.me!.role !== "manager") {
        return jsonResp({ error: "manager auth required" }, 403);
      }
      const leaveType = String(body.leave_type || "");
      if (!HR_LEAVE_LABELS[leaveType]) return jsonResp({ error: "invalid leave_type" }, 400);
      const start = String(body.start_date || "");
      const end = String(body.end_date || "");
      // days est TOUJOURS recalculé ici : la valeur envoyée par le client est ignorée.
      const days = hrLeaveDays(start, end);
      if (!days) return jsonResp({ error: "invalid date range" }, 400);
      if (days > 365) return jsonResp({ error: "range too long" }, 400);

      const { data: emp } = await sb.from("employees").select("id").eq("cleaner_id", target).maybeSingle();
      if (!emp) return jsonResp({ error: "no employee record for this person" }, 400);

      const { data: clash } = await sb.from("leave_requests")
        .select("id, start_date, end_date, status")
        .eq("cleaner_id", target).in("status", ["pending", "approved"])
        .lte("start_date", end).gte("end_date", start).limit(1);
      if (clash && clash.length) {
        return jsonResp({ error: `Overlaps an existing ${clash[0].status} request (${clash[0].start_date} to ${clash[0].end_date})` }, 409);
      }

      const { data, error } = await sb.from("leave_requests").insert({
        cleaner_id: target, leave_type: leaveType, start_date: start, end_date: end,
        days, status: "pending", reason: body.reason ? String(body.reason).slice(0, 500) : null,
        requested_by: g.me!.name,
      }).select().single();
      if (error) return jsonResp({ error: error.message }, 500);

      const { data: who } = await sb.from("cleaners").select("name").eq("id", target).maybeSingle();
      await hrNotifyManagers(sb,
        `🌴 <b>Leave request</b>\n${(who && who.name) || "Someone"} - ${HR_LEAVE_LABELS[leaveType]}\n${start} to ${end} (${days} day${days > 1 ? "s" : ""})` +
        (body.reason ? `\nReason: ${String(body.reason).slice(0, 200)}` : ""));
      return jsonResp({ status: "success", request: data });
    }
```

- [ ] **Step 4: Implémenter hrDecideLeave**

```ts
    if (action === "hrDecideLeave" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const body = await req.json();
      const id = Number(body.id);
      const decision = String(body.decision || "");
      if (!id) return jsonResp({ error: "id required" }, 400);
      if (decision !== "approved" && decision !== "rejected") return jsonResp({ error: "invalid decision" }, 400);

      const { data: lr } = await sb.from("leave_requests").select("*").eq("id", id).maybeSingle();
      if (!lr) return jsonResp({ error: "request not found" }, 404);
      if (lr.status !== "pending") return jsonResp({ error: `request already ${lr.status}` }, 409);
      // Un manager ne valide pas sa propre demande. Seul le CEO le peut.
      if (lr.cleaner_id === g.me!.cleaner_id && !g.isOwner) {
        return jsonResp({ error: "you cannot decide your own request" }, 403);
      }

      if (decision === "approved") {
        const { data: clash } = await sb.from("leave_requests")
          .select("id, start_date, end_date").eq("cleaner_id", lr.cleaner_id).eq("status", "approved")
          .lte("start_date", lr.end_date).gte("end_date", lr.start_date).limit(1);
        if (clash && clash.length) {
          return jsonResp({ error: `Overlaps an approved leave (${clash[0].start_date} to ${clash[0].end_date})` }, 409);
        }
      }

      const { data, error } = await sb.from("leave_requests").update({
        status: decision, decided_by: g.me!.name, decided_at: new Date().toISOString(),
        decision_note: body.note ? String(body.note).slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      }).eq("id", id).eq("status", "pending").select().single();
      if (error) return jsonResp({ error: error.message }, 500);
      if (!data) return jsonResp({ error: "request already decided" }, 409);

      await hrNotifyCleaner(sb, lr.cleaner_id,
        `${decision === "approved" ? "✅" : "❌"} <b>Leave ${decision}</b>\n${HR_LEAVE_LABELS[lr.leave_type] || "Leave"}: ${lr.start_date} to ${lr.end_date} (${lr.days} day${Number(lr.days) > 1 ? "s" : ""})\nBy ${g.me!.name}` +
        (body.note ? `\nNote: ${String(body.note).slice(0, 200)}` : ""));
      return jsonResp({ status: "success", request: data });
    }
```

- [ ] **Step 5: Implémenter hrCancelLeave**

```ts
    if (action === "hrCancelLeave" && req.method === "POST") {
      const g = await hrAuth(sb, req, "staff");
      if (g.err) return g.err;
      const id = Number((await req.json()).id);
      if (!id) return jsonResp({ error: "id required" }, 400);

      const { data: lr } = await sb.from("leave_requests").select("*").eq("id", id).maybeSingle();
      if (!lr) return jsonResp({ error: "request not found" }, 404);
      const isMine = lr.cleaner_id === g.me!.cleaner_id;
      const isManager = g.me!.role === "manager";
      if (!isMine && !isManager) return jsonResp({ error: "not your request" }, 403);
      // Un salarié n'annule que ses demandes encore en attente. Un manager peut
      // aussi annuler un congé déja approuvé : c'est la soupape qui débloque
      // une assignation refusée par le blocage strict.
      if (!isManager && lr.status !== "pending") return jsonResp({ error: "only pending requests can be cancelled" }, 409);
      if (lr.status === "cancelled" || lr.status === "rejected") return jsonResp({ error: `already ${lr.status}` }, 409);

      const { data, error } = await sb.from("leave_requests").update({
        status: "cancelled", decided_by: g.me!.name, decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id).select().single();
      if (error) return jsonResp({ error: error.message }, 500);

      if (!isMine) {
        await hrNotifyCleaner(sb, lr.cleaner_id,
          `🚫 <b>Leave cancelled</b>\n${HR_LEAVE_LABELS[lr.leave_type] || "Leave"}: ${lr.start_date} to ${lr.end_date}\nBy ${g.me!.name}`);
      }
      return jsonResp({ status: "success", request: data });
    }
```

- [ ] **Step 6: Déployer et vérifier**

```bash
npm run deploy:proxy
SECRET='0RicFT1AZL0NDyH1M2ZWhbUvworsGOx38UhNNwFVF8dmP8SC-TRXfaoyQbR5pdn0'
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'
for a in hrSubmitLeave hrDecideLeave hrCancelLeave; do
  printf '%s ' "$a"
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE?action=$a" -H "X-App-Secret: $SECRET" -H 'Content-Type: application/json' -d '{}'
done
# Méthode incorrecte : doit répondre 405
curl -sS -o /dev/null -w '405? %{http_code}\n' "$BASE?action=hrSubmitLeave" -H "X-App-Secret: $SECRET"
```

Attendu : `401` sur les trois POST (route connue, session absente) et `405` sur le GET.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(rh): demande, validation et annulation de congé avec notifications Telegram"
```

---

### Task 5: Routes de création et suppression du dossier employé

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (Map `ROUTES` + handlers a la suite de `hrCancelLeave`)

**Interfaces:**
- Consumes: `hrAuth`, `HR_EMPLOYEE_PUBLIC_COLS`.
- Produces:
  - POST `hrSaveEmployee` body `{cleaner_id, hire_date, end_date?, job_title?, nationality?, opening_annual_days?, opening_date?, notes?, basic_salary?, housing_allowance?, transport_allowance?, other_allowance?}` -> `{status:"success", employee:{...}}` (colonnes publiques uniquement dans la réponse)
  - POST `hrDeleteEmployee` body `{cleaner_id}` -> `{status:"success"}`

- [ ] **Step 1: Enregistrer les routes**

Dans la Map `ROUTES`, bloc RH :

```ts
  ["hrSaveEmployee", "POST"],
  ["hrDeleteEmployee", "POST"],
```

- [ ] **Step 2: Implémenter hrSaveEmployee**

A la suite de `hrCancelLeave` :

```ts
    if (action === "hrSaveEmployee" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const body = await req.json();
      const cleanerId = Number(body.cleaner_id);
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);

      const isDate = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (!isDate(body.hire_date)) return jsonResp({ error: "hire_date must be YYYY-MM-DD" }, 400);
      if (body.end_date && !isDate(body.end_date)) return jsonResp({ error: "end_date must be YYYY-MM-DD" }, 400);
      const openingDate = isDate(body.opening_date) ? body.opening_date : body.hire_date;
      if (openingDate < body.hire_date) return jsonResp({ error: "opening_date cannot precede hire_date" }, 400);
      if (body.end_date && body.end_date < body.hire_date) return jsonResp({ error: "end_date cannot precede hire_date" }, 400);

      const { data: c } = await sb.from("cleaners").select("id, role").eq("id", cleanerId).maybeSingle();
      if (!c) return jsonResp({ error: "unknown cleaner" }, 404);
      // Les sous-traitants (Elite) ne sont pas des salariés : pas de dossier RH.
      if (c.role === "subcontractor") return jsonResp({ error: "subcontractors have no HR record" }, 400);

      const row: Record<string, any> = {
        cleaner_id: cleanerId,
        hire_date: body.hire_date,
        end_date: body.end_date || null,
        job_title: body.job_title ? String(body.job_title).slice(0, 120) : null,
        nationality: body.nationality ? String(body.nationality).slice(0, 80) : null,
        opening_annual_days: Number(body.opening_annual_days) || 0,
        opening_date: openingDate,
        notes: body.notes ? String(body.notes).slice(0, 2000) : null,
        updated_at: new Date().toISOString(),
      };
      // Les montants ne sont modifiables que par le CEO. Un manager qui poste
      // ces champs les voit simplement ignorés : le reste de son édition passe.
      if (g.isOwner) {
        const money = (v: any) => (v === "" || v === null || v === undefined ? null : Number(v));
        ["basic_salary", "housing_allowance", "transport_allowance", "other_allowance"].forEach((k) => {
          if (k in body) {
            const n = money(body[k]);
            if (n !== null && (!Number.isFinite(n) || n < 0)) return;
            row[k] = n;
          }
        });
      }

      const { data, error } = await sb.from("employees")
        .upsert(row, { onConflict: "cleaner_id" })
        .select(HR_EMPLOYEE_PUBLIC_COLS).single();
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success", employee: data });
    }
```

- [ ] **Step 3: Implémenter hrDeleteEmployee**

```ts
    if (action === "hrDeleteEmployee" && req.method === "POST") {
      // Suppression réservée au CEO : le dossier porte la rémunération et
      // l'historique d'ancienneté, sa perte n'est pas rattrapable.
      const g = await hrAuth(sb, req, "owner");
      if (g.err) return g.err;
      const cleanerId = Number((await req.json()).cleaner_id);
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);
      const { count } = await sb.from("leave_requests")
        .select("id", { count: "exact", head: true }).eq("cleaner_id", cleanerId);
      if ((count || 0) > 0) return jsonResp({ error: `${count} leave request(s) exist, delete them first` }, 409);
      const { error } = await sb.from("employees").delete().eq("cleaner_id", cleanerId);
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success" });
    }
```

- [ ] **Step 4: Déployer et vérifier**

```bash
npm run deploy:proxy
SECRET='0RicFT1AZL0NDyH1M2ZWhbUvworsGOx38UhNNwFVF8dmP8SC-TRXfaoyQbR5pdn0'
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'
for a in hrSaveEmployee hrDeleteEmployee; do
  printf '%s ' "$a"
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE?action=$a" -H "X-App-Secret: $SECRET" -H 'Content-Type: application/json' -d '{}'
done
```

Attendu : `401` sur les deux.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(rh): création et suppression du dossier employé"
```

---

### Task 6: Blocage strict des assignations et exposition des congés approuvés

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts:1061-1124` (`assignCleaner`), `:1125-1156` (`autoAssign`), `:1872-1918` (`getAllData`)

**Interfaces:**
- Consumes: table `leave_requests` (statut `approved`), format `reservation_key` = `YYYY-MM-DD_guest` ou `extra_YYYY-MM-DD_...`.
- Produces: `getAllData` renvoie en plus `leaves: Array<{cleaner_id, start_date, end_date}>` (congés approuvés de J-7 a J+90, sans le type).

- [ ] **Step 1: Bloquer l'assignation d'une personne en congé**

Dans le handler `assignCleaner`, après la lecture du body et avant le traitement des `op`, insérer :

```ts
      // Blocage strict : on n'assigne pas un ménage a quelqu'un dont le congé
      // est approuvé ce jour-la. La date se lit dans la reservation_key
      // (YYYY-MM-DD_guest, ou extra_YYYY-MM-DD_... pour les ménages hors Hostaway).
      const dm = String(reservation_key).match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
      const cleaningDate = dm ? dm[1] : null;
      const candidates: number[] = op === "set"
        ? (Array.isArray(list) ? list.map(Number) : (single ? [Number(single)] : []))
        : (op === "add" && single ? [Number(single)] : []);
      if (cleaningDate && candidates.length) {
        const { data: onLeave } = await sb.from("leave_requests")
          .select("cleaner_id").eq("status", "approved")
          .in("cleaner_id", candidates)
          .lte("start_date", cleaningDate).gte("end_date", cleaningDate);
        if (onLeave && onLeave.length) {
          const ids = [...new Set(onLeave.map((r: any) => r.cleaner_id))];
          const { data: names } = await sb.from("cleaners").select("name").in("id", ids);
          const who = (names || []).map((n: any) => n.name).join(", ") || "This person";
          return jsonResp({ error: `${who} is on approved leave on ${cleaningDate}` }, 409);
        }
      }
```

Avant d'écrire ce bloc, lire le début du handler `assignCleaner` pour récupérer les noms exacts des variables du body. Le handler accepte les opérations `set`, `add`, `update_service_type`, `remove` et `clear` ; seules `set` et `add` ajoutent quelqu'un et doivent donc être bloquées. Si les variables ne s'appellent pas `list` et `single`, adapter la construction de `candidates` sans changer la logique.

- [ ] **Step 2: Exclure les personnes en congé de l'auto-assign**

Dans le handler `autoAssign`, après la sélection des cleaners actifs et avant la construction de la map `load`, filtrer :

```ts
      // Les personnes en congé approuvé sur la journée traitée sortent du pool.
      // On charge une fois tous les congés approuvés qui touchent la fenêtre,
      // puis on filtre par date de ménage.
      const { data: leaveRows } = await sb.from("leave_requests")
        .select("cleaner_id, start_date, end_date").eq("status", "approved");
      const isOnLeave = (cid: number, day: string | null) =>
        !!day && (leaveRows || []).some((l: any) =>
          l.cleaner_id === cid && l.start_date <= day && l.end_date >= day);
```

Puis, dans la boucle qui choisit le cleaner le moins chargé pour une réservation, extraire la date de la clé et écarter les indisponibles :

```ts
        const dm = String(key).match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
        const day = dm ? dm[1] : null;
        const pool = eligible.filter((c: any) => !isOnLeave(c.id, day));
        if (!pool.length) continue; // personne de disponible ce jour-la
```

Adapter `key` et `eligible` aux noms réellement utilisés dans le handler. Ne pas assigner par défaut quand le pool est vide : laisser la ligne non assignée est le comportement voulu, un manager la traitera a la main.

- [ ] **Step 3: Exposer les congés approuvés dans getAllData**

Dans le `Promise.all` de `getAllData` (vers la ligne 1872), ajouter une entrée en fin de tableau :

```ts
        sb.from("leave_requests")
          .select("cleaner_id, start_date, end_date")
          .eq("status", "approved")
          .gte("end_date", new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0])
          .lte("start_date", new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0]),
```

et la variable correspondante en fin de destructuration : `..., extraRes, leaveRes]`.

Puis, dans l'objet renvoyé par `jsonResp` (vers la ligne 1909), ajouter :

```ts
        leaves: leaveRes.data || [],
```

Le `select` est volontairement limité a trois colonnes : le type de congé ne doit jamais atteindre un client en mode cleaner, un arrêt maladie est une donnée sensible.

- [ ] **Step 4: Déployer et vérifier que getAllData renvoie bien la clé**

```bash
npm run deploy:proxy
SECRET='0RicFT1AZL0NDyH1M2ZWhbUvworsGOx38UhNNwFVF8dmP8SC-TRXfaoyQbR5pdn0'
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'
curl -sS "$BASE?action=getAllData" -H "X-App-Secret: $SECRET" | python3 -c "import sys,json;d=json.load(sys.stdin);print('leaves present:', 'leaves' in d, d.get('leaves'))"
```

Attendu : `leaves present: True []` (tableau vide tant qu'aucun congé n'est approuvé).

- [ ] **Step 5: Vérifier qu'aucun montant ne fuit**

```bash
curl -sS "$BASE?action=getAllData" -H "X-App-Secret: $SECRET" | grep -c "basic_salary\|housing_allowance" || echo "OK: aucun champ de salaire dans getAllData"
```

Attendu : `OK: aucun champ de salaire dans getAllData`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(rh): blocage des assignations pendant un congé approuvé"
```

---

### Task 7: Onglet HR, état frontend et chargement des données

**Files:**
- Modify: `hr.js` (ajout de la section état + chargement a la suite des helpers purs)
- Modify: `app.js:3529-3556` (`render`), `app.js:3558-3580` (`renderBottomNav`), `app.js:2917-2946` (`renderMoreMenu`), `app.js:2915` (`setTab`)

**Interfaces:**
- Consumes: `api(action, opts)`, `apiWrite(action, opts)`, `toast(msg, type)`, `render()`, `esc()`, `icon(name,size)`, variable globale `cleanerMode` (déclarées dans `app.js`).
- Produces (globales de `hr.js`) : `hrData`, `hrLoading`, `hrError`, `hrIsManager()`, `loadHR()`, `renderHR()`, `hrRefresh()`.

- [ ] **Step 1: Ajouter l'état et le chargement dans hr.js**

A la fin de `hr.js`, après le bloc des helpers purs, ajouter :

```js
// ===========================================================================
// Etat du module RH. Volontairement séparé des helpers purs ci-dessus, qui
// restent testables sans DOM ni réseau.
// ===========================================================================

let hrData = null;        // payload de hrOverview ou hrMyLeave
let hrLoading = false;
let hrError = null;
let hrSelected = null;    // cleaner_id du dossier ouvert (vue manager)
let hrSubmitting = false;

function hrIsManager(){
  return !cleanerMode || cleanerMode.role === 'manager';
}

function hrToday(){
  return (hrData && hrData.today) || new Date().toISOString().slice(0, 10);
}

function hrCleanerName(id){
  const c = (typeof cleaners !== 'undefined' ? cleaners : []).find(x => x.id === Number(id));
  return c ? c.name : ('#' + id);
}

function hrTypeLabel(key){
  const t = HR_LEAVE_TYPES.find(x => x.key === key);
  return t ? t.label : key;
}

async function loadHR(){
  if (hrLoading) return;
  hrLoading = true; hrError = null;
  try {
    const r = await api(hrIsManager() ? 'hrOverview' : 'hrMyLeave');
    if (r && r.error) throw new Error(r.error);
    hrData = r;
  } catch (e) {
    hrError = (e && e.message) || 'Failed to load HR data';
    hrData = null;
  } finally {
    hrLoading = false;
    render();
  }
}

function hrRefresh(){
  hrData = null; hrError = null;
  loadHR();
  render();
}

function renderHR(){
  if (hrLoading || (hrData === null && !hrError)) {
    document.getElementById('app').innerHTML =
      '<div class="header"><div class="header-top"><h1>👤 HR</h1></div></div>' +
      '<div class="container"><div class="loading"><div class="spinner"></div></div></div>' + renderBottomNav();
    return;
  }
  if (hrError) {
    document.getElementById('app').innerHTML =
      '<div class="header"><div class="header-top"><h1>👤 HR</h1></div></div>' +
      '<div class="container"><div class="hr-empty">' + esc(hrError) +
      ' <button class="btn-secondary" data-action="hrRefresh">Retry</button></div></div>' + renderBottomNav();
    return;
  }
  document.getElementById('app').innerHTML =
    (hrIsManager() ? renderHRManager() : renderHRMine()) + renderBottomNav();
}
```

- [ ] **Step 2: Ajouter des stubs de rendu pour que l'onglet s'affiche**

Toujours dans `hr.js`, en fin de fichier (ils seront remplacés en Task 8 et Task 10) :

```js
function renderHRManager(){
  return '<div class="header"><div class="header-top"><h1>👤 HR</h1></div></div>' +
    '<div class="container"><div class="hr-empty">Manager view coming next.</div></div>';
}

function renderHRMine(){
  return '<div class="header"><div class="header-top"><h1>🌴 My leave</h1></div></div>' +
    '<div class="container"><div class="hr-empty">Employee view coming next.</div></div>';
}
```

- [ ] **Step 3: Brancher l'onglet dans render()**

Dans `app.js`, dans `render()`, juste après la ligne qui traite `currentTab==='laundry'` (ligne 3535), insérer :

```js
  if(currentTab==='hr'){
    if(typeof renderHR!=='function'){currentTab='planner';}
    else{if(hrData===null&&!hrLoading&&!hrError)loadHR();return renderHR();}
  }
```

Le `!hrError` est indispensable : sans lui, un échec de chargement laisse `hrData` a `null`, `renderHR()` appelle `render()` en boucle et l'onglet part en boucle infinie de requêtes.

- [ ] **Step 4: Ajouter l'entrée dans le menu More (manager)**

Dans `renderMoreMenu()` (`app.js:2919`), ajouter dans le tableau `items`, juste après l'entrée `reviews` :

```js
    {id:'hr',icon:icon('user',22),label:'HR',color:'#0d9488'},
```

- [ ] **Step 5: Ajouter l'onglet Leave dans la barre du bas des salariés**

Dans `renderBottomNav()` (`app.js:3558`), remplacer la branche "Cleaner view (default)" :

```js
    tabs=[{id:'planner',icon:icon('clipboard',22),label:t('myTasks')},{id:'stats',icon:icon('trending',22),label:t('stats')},{id:'history',icon:icon('history',22),label:t('history')}];
```

par :

```js
    tabs=[{id:'planner',icon:icon('clipboard',22),label:t('myTasks')},{id:'hr',icon:icon('user',22),label:'Leave'},{id:'stats',icon:icon('trending',22),label:t('stats')},{id:'history',icon:icon('history',22),label:t('history')}];
```

Et dans la branche "Maintenance view", ajouter aussi l'onglet :

```js
    tabs=[{id:'maintenance',icon:icon('wrench',22),label:'Maintenance'},{id:'hr',icon:icon('user',22),label:'Leave'},{id:'history',icon:icon('history',22),label:t('history')}];
```

- [ ] **Step 6: Charger les données au changement d'onglet**

Dans `setTab()` (`app.js:2915`), a la fin de la chaîne de conditions, avant la fermeture de la fonction, ajouter :

```js
if(t==='hr'&&typeof loadHR==='function'&&hrData===null&&!hrLoading&&!hrError)loadHR();
```

- [ ] **Step 7: Ajouter les styles de base**

Dans `styles.css`, en fin de fichier :

```css
/* ===== Module RH ===== */
.hr-empty{padding:32px 16px;text-align:center;color:var(--text3);font-size:13px}
.hr-section{margin-bottom:18px}
.hr-section h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);margin:0 0 8px}
.hr-card{background:var(--card,#fff);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px}
.hr-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hr-row .hr-grow{flex:1;min-width:120px}
.hr-name{font-weight:700;font-size:14px}
.hr-meta{font-size:11px;color:var(--text3)}
.hr-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap}
.hr-badge.pending{background:#f59e0b22;color:#b45309}
.hr-badge.approved{background:#16a34a22;color:#15803d}
.hr-badge.rejected{background:#dc262622;color:#b91c1c}
.hr-badge.cancelled{background:#94a3b822;color:#475569}
.hr-badge.onleave{background:#0d948822;color:#0f766e}
.hr-stat{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid var(--border)}
.hr-stat:last-child{border-bottom:none}
.hr-stat b{font-variant-numeric:tabular-nums}
.hr-form{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.hr-form label{font-size:11px;color:var(--text2);font-weight:600}
.hr-form input,.hr-form select,.hr-form textarea{width:100%;padding:9px;border:1px solid var(--border);border-radius:8px;font-size:14px;background:#fff;box-sizing:border-box}
.hr-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.hr-actions button{flex:1;min-width:110px;padding:10px;border-radius:8px;border:none;font-weight:700;font-size:13px;cursor:pointer}
.hr-btn-ok{background:var(--green,#16a34a);color:#fff}
.hr-btn-no{background:var(--red,#dc2626);color:#fff}
.hr-btn-alt{background:var(--bg2,#f1f5f9);color:var(--text,#0f172a)}
@media (max-width:640px){.hr-actions button{min-width:0}}
```

- [ ] **Step 8: Vérifier dans le navigateur**

```bash
python3 -m http.server 8888 >/dev/null 2>&1 &
open http://localhost:8888
```

Vérifier : le menu More contient une entrée HR, le clic ouvre un écran "Manager view coming next." et la barre du bas reste visible. La console ne doit afficher aucune erreur, en particulier aucun `[data-action] unknown handler`.

- [ ] **Step 9: Commit**

```bash
git add hr.js app.js styles.css
git commit -m "feat(rh): onglet HR, chargement des données et navigation"
```

---

### Task 8: Ecran manager, demandes en attente et liste de l'équipe

**Files:**
- Modify: `hr.js` (remplacement du stub `renderHRManager`)

**Interfaces:**
- Consumes: `hrData` = `{employees, pending, upcoming, taken, today, isOwner}` produit par `hrOverview` (Task 3), helpers `accruedAnnualDays`, `sickTiers`, `leaveDays`.
- Produces: `hrDecide(id, decision)`, `hrOpen(cleanerId)`, `hrCloseDetail()` exposées comme handlers `data-action`.

- [ ] **Step 1: Remplacer le stub renderHRManager**

Dans `hr.js`, remplacer entièrement la fonction `renderHRManager` par :

```js
// Solde de congés annuels d'un employé : acquis légal moins jours approuvés.
function hrAnnualBalance(emp){
  const taken = ((hrData && hrData.taken) || {})[String(emp.cleaner_id)] || {};
  const asOf = emp.end_date && emp.end_date < hrToday() ? emp.end_date : hrToday();
  const accrued = accruedAnnualDays(emp.hire_date, asOf, emp.opening_annual_days, emp.opening_date);
  const used = Number(taken.annual || 0);
  return { accrued: accrued, used: used, left: Math.round((accrued - used) * 100) / 100 };
}

function hrIsOnLeave(cleanerId, day){
  return ((hrData && hrData.upcoming) || []).some(l =>
    l.cleaner_id === Number(cleanerId) && rangesOverlap(l.start_date, l.end_date, day, day));
}

function hrRequestCard(r, withActions){
  const days = Number(r.days || 0);
  return '<div class="hr-card"><div class="hr-row">' +
    '<div class="hr-grow"><div class="hr-name">' + esc(hrCleanerName(r.cleaner_id)) + '</div>' +
    '<div class="hr-meta">' + esc(hrTypeLabel(r.leave_type)) + ' · ' + esc(r.start_date) + ' to ' + esc(r.end_date) +
    ' · ' + days + ' day' + (days > 1 ? 's' : '') + '</div>' +
    (r.reason ? '<div class="hr-meta">“' + esc(r.reason) + '”</div>' : '') +
    (r.decided_by ? '<div class="hr-meta">' + esc(r.status) + ' by ' + esc(r.decided_by) + '</div>' : '') +
    '</div>' +
    '<span class="hr-badge ' + esc(r.status) + '">' + esc(r.status) + '</span>' +
    '</div>' +
    (withActions ? '<div class="hr-actions">' +
      '<button class="hr-btn-ok" data-action="hrDecide" data-arg0="' + r.id + '" data-arg1="approved">Approve</button>' +
      '<button class="hr-btn-no" data-action="hrDecide" data-arg0="' + r.id + '" data-arg1="rejected">Reject</button>' +
      '</div>' : '') +
    '</div>';
}

function renderHRManager(){
  const today = hrToday();
  const employees = (hrData.employees || []).slice();
  const pending = hrData.pending || [];
  const upcoming = hrData.upcoming || [];
  const known = new Set(employees.map(e => e.cleaner_id));
  const staff = (typeof cleaners !== 'undefined' ? cleaners : [])
    .filter(c => (c.role || 'cleaner') !== 'subcontractor');
  const missing = staff.filter(c => !known.has(c.id));

  let h = '<div class="header"><div class="header-top"><h1>👤 HR</h1>' +
    '<div class="header-actions"><button data-action="hrRefresh" title="Refresh" aria-label="Refresh">' + icon('refresh', 18) + '</button></div></div></div>';
  h += '<div class="container">';

  if (hrSelected) { h += renderHRDetail(hrSelected); h += '</div>'; return h; }

  h += '<div class="hr-section"><h3>Pending requests (' + pending.length + ')</h3>';
  h += pending.length
    ? pending.map(r => hrRequestCard(r, true)).join('')
    : '<div class="hr-empty">Nothing waiting for a decision.</div>';
  h += '</div>';

  const onLeaveNow = upcoming.filter(l => rangesOverlap(l.start_date, l.end_date, today, today));
  if (onLeaveNow.length) {
    h += '<div class="hr-section"><h3>Away today</h3>';
    h += onLeaveNow.map(l => '<div class="hr-card"><div class="hr-row">' +
      '<div class="hr-grow"><div class="hr-name">' + esc(hrCleanerName(l.cleaner_id)) + '</div>' +
      '<div class="hr-meta">Back on ' + esc(new Date(Date.parse(l.end_date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) + '</div></div>' +
      '<span class="hr-badge onleave">on leave</span></div></div>').join('');
    h += '</div>';
  }

  h += '<div class="hr-section"><h3>Team (' + employees.length + ')</h3>';
  employees.forEach(e => {
    const bal = hrAnnualBalance(e);
    const away = hrIsOnLeave(e.cleaner_id, today);
    h += '<div class="hr-card" data-action="hrOpen" data-arg0="' + e.cleaner_id + '" style="cursor:pointer">' +
      '<div class="hr-row"><div class="hr-grow">' +
      '<div class="hr-name">' + esc(hrCleanerName(e.cleaner_id)) + (away ? ' <span class="hr-badge onleave">away</span>' : '') + '</div>' +
      '<div class="hr-meta">' + esc(e.job_title || 'Employee') + ' · since ' + esc(e.hire_date) +
      (e.end_date ? ' · left ' + esc(e.end_date) : '') + '</div></div>' +
      '<div style="text-align:right"><div class="hr-name">' + bal.left + '</div>' +
      '<div class="hr-meta">days left</div></div></div></div>';
  });
  if (!employees.length) h += '<div class="hr-empty">No employee record yet.</div>';
  h += '</div>';

  if (missing.length) {
    h += '<div class="hr-section"><h3>Not set up yet</h3>';
    missing.forEach(c => {
      h += '<div class="hr-card"><div class="hr-row"><div class="hr-grow">' +
        '<div class="hr-name">' + esc(c.name) + '</div><div class="hr-meta">' + esc(c.role || 'cleaner') + '</div></div>' +
        '<button class="hr-btn-alt" style="padding:8px 12px;border:none;border-radius:8px;font-weight:700;cursor:pointer" data-action="hrOpen" data-arg0="' + c.id + '">Set up</button>' +
        '</div></div>';
    });
    h += '</div>';
  }

  h += '</div>';
  return h;
}

async function hrDecide(id, decision){
  if (hrSubmitting) return;
  hrSubmitting = true;
  try {
    await apiWrite('hrDecideLeave', { body: { id: id, decision: decision } });
    toast('Leave ' + decision, decision === 'approved' ? 'success' : 'info');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed', 'error');
  } finally {
    hrSubmitting = false;
  }
}

function hrOpen(cleanerId){ hrSelected = Number(cleanerId); render(); }
function hrCloseDetail(){ hrSelected = null; render(); }
```

- [ ] **Step 2: Ajouter un stub de détail pour que l'écran compile**

Toujours dans `hr.js` (remplacé en Task 9) :

```js
function renderHRDetail(cleanerId){
  return '<div class="hr-card">Detail for ' + esc(hrCleanerName(cleanerId)) +
    ' <button class="hr-btn-alt" data-action="hrCloseDetail">Back</button></div>';
}
```

- [ ] **Step 3: Vérifier dans le navigateur**

Recharger `http://localhost:8888`, ouvrir More puis HR. Vérifier que la section "Pending requests" affiche "Nothing waiting for a decision.", que la section "Not set up yet" liste bien l'équipe existante, et qu'un clic sur "Set up" affiche le stub de détail. Aucune erreur console.

- [ ] **Step 4: Commit**

```bash
git add hr.js
git commit -m "feat(rh): écran manager avec demandes en attente et vue équipe"
```

---

### Task 9: Panneau de détail employé

**Files:**
- Modify: `hr.js` (remplacement du stub `renderHRDetail`)

**Interfaces:**
- Consumes: `hrData.employees`, `hrData.taken`, helpers `hrAnnualBalance`, `sickTiers`, `accruedAnnualDays`.
- Produces: `hrSaveEmployee()`, `hrDeleteEmployeeRecord(cleanerId)`, `hrSubmitLeaveFor(cleanerId)`, `hrCancelRequest(id)`, `hrVal(id)` exposées comme handlers ou utilitaires.

- [ ] **Step 1: Remplacer le stub renderHRDetail**

```js
function renderHRDetail(cleanerId){
  const cid = Number(cleanerId);
  const emp = (hrData.employees || []).find(e => e.cleaner_id === cid) || null;
  const taken = ((hrData && hrData.taken) || {})[String(cid)] || {};
  const history = ((hrData.pending || []).concat(hrData.upcoming || []))
    .filter(r => r.cleaner_id === cid)
    .sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  let h = '<div class="hr-row" style="margin-bottom:12px">' +
    '<button class="hr-btn-alt" style="padding:8px 12px;border:none;border-radius:8px;font-weight:700;cursor:pointer" data-action="hrCloseDetail">' + icon('chevronLeft', 14) + ' Back</button>' +
    '<div class="hr-grow"><div class="hr-name">' + esc(hrCleanerName(cid)) + '</div></div></div>';

  if (emp) {
    const bal = hrAnnualBalance(emp);
    const sick = sickTiers(Number(taken.sick || 0));
    h += '<div class="hr-section"><h3>Balances</h3><div class="hr-card">' +
      '<div class="hr-stat"><span>Annual accrued</span><b>' + bal.accrued + '</b></div>' +
      '<div class="hr-stat"><span>Annual taken</span><b>' + bal.used + '</b></div>' +
      '<div class="hr-stat"><span>Annual left</span><b>' + bal.left + '</b></div>' +
      '<div class="hr-stat"><span>Sick used (full / half / unpaid)</span><b>' + sick.full + ' / ' + sick.half + ' / ' + sick.unpaid + '</b></div>' +
      '<div class="hr-stat"><span>Sick left this service year</span><b>' + sick.remaining + '</b></div>' +
      '<div class="hr-stat"><span>Unpaid days taken</span><b>' + (Number(taken.unpaid || 0)) + '</b></div>' +
      '</div></div>';
  }

  h += '<div class="hr-section"><h3>' + (emp ? 'Employee record' : 'Create employee record') + '</h3><div class="hr-card"><div class="hr-form">' +
    '<input type="hidden" id="hrEmpCleanerId" value="' + cid + '"/>' +
    '<label>Hire date</label><input type="date" id="hrHireDate" value="' + esc((emp && emp.hire_date) || '') + '"/>' +
    '<label>Job title</label><input id="hrJobTitle" value="' + esc((emp && emp.job_title) || '') + '" placeholder="Housekeeper"/>' +
    '<label>Nationality</label><input id="hrNationality" value="' + esc((emp && emp.nationality) || '') + '" placeholder="Philippines"/>' +
    '<label>Opening annual balance (days)</label><input type="number" step="0.5" id="hrOpeningDays" value="' + ((emp && emp.opening_annual_days) || 0) + '"/>' +
    '<label>Opening balance date</label><input type="date" id="hrOpeningDate" value="' + esc((emp && emp.opening_date) || '') + '"/>' +
    '<label>End of service date (leave empty if active)</label><input type="date" id="hrEndDate" value="' + esc((emp && emp.end_date) || '') + '"/>' +
    '<label>Notes</label><textarea id="hrNotes" rows="2">' + esc((emp && emp.notes) || '') + '</textarea>' +
    '</div><div class="hr-actions">' +
    '<button class="hr-btn-ok" data-action="hrSaveEmployee">' + (emp ? 'Save' : 'Create') + '</button>' +
    (emp && hrData.isOwner ? '<button class="hr-btn-no" data-action="hrDeleteEmployeeRecord" data-arg0="' + cid + '">Delete record</button>' : '') +
    '</div></div></div>';

  if (emp) {
    h += '<div class="hr-section"><h3>Book leave for this person</h3><div class="hr-card"><div class="hr-form">' +
      '<label>Type</label><select id="hrNewType">' +
      HR_LEAVE_TYPES.map(t => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('') + '</select>' +
      '<label>From</label><input type="date" id="hrNewStart"/>' +
      '<label>To</label><input type="date" id="hrNewEnd"/>' +
      '<label>Reason (optional)</label><input id="hrNewReason" placeholder="Family trip"/>' +
      '</div><div class="hr-actions">' +
      '<button class="hr-btn-ok" data-action="hrSubmitLeaveFor" data-arg0="' + cid + '">Submit request</button>' +
      '</div></div></div>';

    h += '<div class="hr-section"><h3>Current and upcoming leave</h3>';
    h += history.length
      ? history.map(r => hrRequestCard(r, false) +
          (r.status === 'pending' || r.status === 'approved'
            ? '<div class="hr-actions" style="margin-top:-4px;margin-bottom:8px"><button class="hr-btn-alt" data-action="hrCancelRequest" data-arg0="' + r.id + '">Cancel this leave</button></div>'
            : '')).join('')
      : '<div class="hr-empty">Nothing planned.</div>';
    h += '</div>';
  }

  return h;
}

function hrVal(id){ const el = document.getElementById(id); return el ? el.value.trim() : ''; }

async function hrSaveEmployee(){
  if (hrSubmitting) return;
  const cid = Number(hrVal('hrEmpCleanerId'));
  const hire = hrVal('hrHireDate');
  if (!hire) { toast('Hire date is required', 'error'); return; }
  hrSubmitting = true;
  try {
    await apiWrite('hrSaveEmployee', { body: {
      cleaner_id: cid, hire_date: hire,
      job_title: hrVal('hrJobTitle') || null,
      nationality: hrVal('hrNationality') || null,
      opening_annual_days: Number(hrVal('hrOpeningDays')) || 0,
      opening_date: hrVal('hrOpeningDate') || hire,
      end_date: hrVal('hrEndDate') || null,
      notes: hrVal('hrNotes') || null,
    }});
    toast('Employee record saved', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to save', 'error');
  } finally {
    hrSubmitting = false;
  }
}

async function hrDeleteEmployeeRecord(cleanerId){
  if (!confirm('Delete the HR record of ' + hrCleanerName(cleanerId) + '? This cannot be undone.')) return;
  try {
    await apiWrite('hrDeleteEmployee', { body: { cleaner_id: Number(cleanerId) } });
    toast('Record deleted', 'success');
    hrSelected = null; hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to delete', 'error');
  }
}

async function hrSubmitLeaveFor(cleanerId){
  if (hrSubmitting) return;
  const start = hrVal('hrNewStart'), end = hrVal('hrNewEnd');
  if (!start || !end) { toast('Pick both dates', 'error'); return; }
  if (!leaveDays(start, end)) { toast('End date must be on or after start date', 'error'); return; }
  hrSubmitting = true;
  try {
    await apiWrite('hrSubmitLeave', { body: {
      cleaner_id: Number(cleanerId), leave_type: hrVal('hrNewType') || 'annual',
      start_date: start, end_date: end, reason: hrVal('hrNewReason') || null,
    }});
    toast('Request submitted', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to submit', 'error');
  } finally {
    hrSubmitting = false;
  }
}

async function hrCancelRequest(id){
  if (!confirm('Cancel this leave?')) return;
  try {
    await apiWrite('hrCancelLeave', { body: { id: Number(id) } });
    toast('Leave cancelled', 'info');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to cancel', 'error');
  }
}
```

- [ ] **Step 2: Vérifier dans le navigateur**

Recharger, ouvrir HR puis "Set up" sur un membre de l'équipe. Vérifier que le formulaire s'affiche, que le bouton Back revient a la liste, et que la console reste propre. La sauvegarde échouera avec "auth required" tant qu'on n'est pas connecté avec un PIN manager, ce qui est le comportement attendu ici.

- [ ] **Step 3: Commit**

```bash
git add hr.js
git commit -m "feat(rh): panneau de détail employé avec soldes et édition du dossier"
```

---

### Task 10: Ecran salarié My leave

**Files:**
- Modify: `hr.js` (remplacement du stub `renderHRMine`)

**Interfaces:**
- Consumes: `hrData` = `{employee, requests, today}` produit par `hrMyLeave` (Task 3), `hrRequestCard(r, withActions)` et `hrVal(id)` définies en Tasks 8 et 9, helpers `accruedAnnualDays` et `sickTiers`.
- Produces: `hrSubmitMine()`. Réutilise `hrCancelRequest(id)` définie en Task 9.

- [ ] **Step 1: Remplacer le stub renderHRMine**

```js
function renderHRMine(){
  const emp = hrData.employee;
  const reqs = hrData.requests || [];
  let h = '<div class="header"><div class="header-top"><h1>🌴 My leave</h1>' +
    '<div class="header-actions"><button data-action="hrRefresh" title="Refresh" aria-label="Refresh">' + icon('refresh', 18) + '</button></div></div></div>';
  h += '<div class="container">';

  if (!emp) {
    h += '<div class="hr-empty">Your HR record is not set up yet. Ask your manager to create it before requesting leave.</div></div>';
    return h;
  }

  const approved = reqs.filter(r => r.status === 'approved');
  const usedAnnual = approved.filter(r => r.leave_type === 'annual').reduce((s, r) => s + Number(r.days || 0), 0);
  const usedSick = approved.filter(r => r.leave_type === 'sick').reduce((s, r) => s + Number(r.days || 0), 0);
  const asOf = emp.end_date && emp.end_date < hrToday() ? emp.end_date : hrToday();
  const accrued = accruedAnnualDays(emp.hire_date, asOf, emp.opening_annual_days, emp.opening_date);
  const sick = sickTiers(usedSick);

  h += '<div class="hr-section"><div class="hr-card">' +
    '<div class="hr-stat"><span>Annual days available</span><b>' + (Math.round((accrued - usedAnnual) * 100) / 100) + '</b></div>' +
    '<div class="hr-stat"><span>Annual days earned so far</span><b>' + accrued + '</b></div>' +
    '<div class="hr-stat"><span>Annual days taken</span><b>' + usedAnnual + '</b></div>' +
    '<div class="hr-stat"><span>Sick days left this year</span><b>' + sick.remaining + '</b></div>' +
    '</div></div>';

  h += '<div class="hr-section"><h3>Request leave</h3><div class="hr-card"><div class="hr-form">' +
    '<label>Type</label><select id="hrMineType">' +
    HR_LEAVE_TYPES.map(t => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('') + '</select>' +
    '<label>From</label><input type="date" id="hrMineStart" min="' + esc(hrToday()) + '"/>' +
    '<label>To</label><input type="date" id="hrMineEnd" min="' + esc(hrToday()) + '"/>' +
    '<label>Reason (optional)</label><input id="hrMineReason" placeholder="Family trip"/>' +
    '</div><div class="hr-actions"><button class="hr-btn-ok" data-action="hrSubmitMine">Send request</button></div>' +
    '<div class="hr-meta" style="margin-top:8px">Days are counted on the calendar, weekends included.</div>' +
    '</div></div>';

  h += '<div class="hr-section"><h3>My requests</h3>';
  h += reqs.length
    ? reqs.map(r => hrRequestCard(r, false) +
        (r.status === 'pending'
          ? '<div class="hr-actions" style="margin-top:-4px;margin-bottom:8px"><button class="hr-btn-alt" data-action="hrCancelRequest" data-arg0="' + r.id + '">Cancel</button></div>'
          : '')).join('')
    : '<div class="hr-empty">No request yet.</div>';
  h += '</div></div>';
  return h;
}

async function hrSubmitMine(){
  if (hrSubmitting) return;
  const start = hrVal('hrMineStart'), end = hrVal('hrMineEnd');
  if (!start || !end) { toast('Pick both dates', 'error'); return; }
  const d = leaveDays(start, end);
  if (!d) { toast('End date must be on or after start date', 'error'); return; }
  if (!confirm('Request ' + d + ' day' + (d > 1 ? 's' : '') + ' off, from ' + start + ' to ' + end + '?')) return;
  hrSubmitting = true;
  try {
    await apiWrite('hrSubmitLeave', { body: {
      leave_type: hrVal('hrMineType') || 'annual',
      start_date: start, end_date: end, reason: hrVal('hrMineReason') || null,
    }});
    toast('Request sent to your manager', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to send', 'error');
  } finally {
    hrSubmitting = false;
  }
}
```

- [ ] **Step 2: Vérifier le rendu en mode cleaner**

Recharger `http://localhost:8888/#cleaner`. Sans PIN valide on reste sur l'écran de login, ce qui est normal. Vérifier au minimum dans la console :

```js
cleanerMode = {role:'cleaner', name:'Test'};
hrData = {employee:{cleaner_id:1,hire_date:'2024-01-01',opening_annual_days:0,opening_date:'2024-01-01',end_date:null},requests:[],today:'2026-08-03'};
currentTab='hr'; render();
```

Attendu : l'écran "My leave" s'affiche avec 30 jours acquis pour 2 ans et demi d'ancienneté, le formulaire de demande, et "No request yet.".

- [ ] **Step 3: Commit**

```bash
git add hr.js
git commit -m "feat(rh): écran salarié de demande et suivi des congés"
```

---

### Task 11: Signaler les absences dans les surfaces d'assignation

**Files:**
- Modify: `app.js:1798-1811` (`showAssignPicker`), `app.js:1814-1836` (`toggleAssignee`), `app.js:2151`, `app.js:3654`
- Modify: `hr.js` (helper `hrLeaveIndexFromAllData`)

**Interfaces:**
- Consumes: `getAllData().leaves` (Task 6) stocké côté front, `keyFor(r)` et le format `reservation_key`.
- Produces: `hrOnLeaveOn(cleanerId, day): boolean` et `hrDayOfKey(reservationKey): string|null`, utilisables depuis `app.js`.

- [ ] **Step 1: Ajouter les helpers de lecture des congés dans hr.js**

```js
// Congés approuvés reçus via getAllData. Ne contiennent que cleaner_id,
// start_date et end_date : le type de congé n'est jamais envoyé aux clients
// non-manager, un arrêt maladie n'a pas a circuler.
let hrApprovedLeaves = [];

function hrSetApprovedLeaves(rows){
  hrApprovedLeaves = Array.isArray(rows) ? rows : [];
}

function hrOnLeaveOn(cleanerId, day){
  if (!day) return false;
  const cid = Number(cleanerId);
  return hrApprovedLeaves.some(l => Number(l.cleaner_id) === cid && l.start_date <= day && l.end_date >= day);
}

function hrDayOfKey(reservationKey){
  const m = String(reservationKey || '').match(/^(?:extra_)?(\d{4}-\d{2}-\d{2})_/);
  return m ? m[1] : null;
}
```

- [ ] **Step 2: Alimenter hrApprovedLeaves depuis fetchAll**

Dans `app.js`, dans la fonction qui consomme la réponse de `getAllData` (chercher `assignmentMeta` pour la localiser), après l'affectation des autres champs, ajouter :

```js
    if(typeof hrSetApprovedLeaves==='function') hrSetApprovedLeaves(d.leaves||[]);
```

Utiliser le nom réel de la variable qui porte la réponse a cet endroit, `d` n'est qu'un exemple.

- [ ] **Step 3: Marquer les personnes en congé dans le picker d'assignation**

Dans `showAssignPicker` (`app.js:1798`), la liste est construite a partir de `cleaners.filter(c=>(c.role||'cleaner')==='cleaner')`. Ajouter le calcul du jour et le marquage, sans retirer la personne de la liste :

```js
  const __day = (typeof hrDayOfKey==='function') ? hrDayOfKey(rkey) : null;
```

puis, dans le template de chaque `.assign-picker-item`, ajouter la classe et le libellé :

```js
    const __away = (typeof hrOnLeaveOn==='function') && hrOnLeaveOn(c.id, __day);
```

et concaténer `(__away?' <span class="hr-badge onleave">on leave</span>':'')` après le nom, plus `style="opacity:.55"` sur l'élément quand `__away` est vrai. Adapter aux noms de variables réellement présents dans la fonction.

Le blocage réel est côté serveur (Task 6) : ici on informe seulement, pour éviter que le manager clique dans le vide.

- [ ] **Step 4: Faire remonter proprement le refus du serveur**

Dans `toggleAssignee` (`app.js:1814`), le `catch` revert déja l'état optimiste. Vérifier que le message d'erreur du serveur est bien affiché en toast et non un message générique. Si le catch affiche un texte fixe, le remplacer par :

```js
    toast((e&&e.message)||'Assignment failed','error');
```

Le message serveur est `"<Name> is on approved leave on YYYY-MM-DD"`, il est suffisamment explicite pour être montré tel quel.

- [ ] **Step 5: Vérifier de bout en bout**

Dans la console du navigateur, simuler un congé approuvé et vérifier le marquage :

```js
hrSetApprovedLeaves([{cleaner_id: <ID_D_UN_CLEANER>, start_date:'2026-08-01', end_date:'2026-08-31'}]);
render();
```

Ouvrir le picker d'assignation sur un ménage d'août : la personne doit apparaître grisée avec le badge "on leave".

- [ ] **Step 6: Commit**

```bash
git add app.js hr.js
git commit -m "feat(rh): signalement des absences dans les écrans d'assignation"
```

---

## Phase 2 - Documents (Tasks 12 à 14)

### Task 12: Routes documents et expirations

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (Map `ROUTES`, handler `hrOverview`, nouveaux handlers)

**Interfaces:**
- Consumes: `hrAuth`, table `employee_documents`.
- Produces:
  - POST `hrSaveDocument` body `{id?, cleaner_id, doc_type, doc_number?, issue_date?, expiry_date?, note?}` -> `{status:"success", document:{...}}`
  - POST `hrDeleteDocument` body `{id}` -> `{status:"success"}`
  - `hrOverview` renvoie en plus `documents: [...]` (tous les documents) et `expiring: [...]` (expiration dans moins de 60 jours ou déja passée).

- [ ] **Step 1: Enregistrer les routes**

Dans la Map `ROUTES`, bloc RH :

```ts
  ["hrSaveDocument", "POST"],
  ["hrDeleteDocument", "POST"],
```

- [ ] **Step 2: Ajouter documents et expiring a hrOverview**

Dans le handler `hrOverview`, ajouter une quatrième requête au `Promise.all` :

```ts
        sb.from("employee_documents").select("*").order("expiry_date", { nullsFirst: false }),
```

et la variable `docRes` en fin de destructuration. Puis, juste avant le `return jsonResp`, calculer les expirations :

```ts
      const horizon60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const expiring = (docRes.data || []).filter((d: any) => d.expiry_date && d.expiry_date <= horizon60);
```

et ajouter au corps de la réponse :

```ts
        documents: docRes.data || [],
        expiring,
```

- [ ] **Step 3: Implémenter hrSaveDocument et hrDeleteDocument**

A la suite de `hrDeleteEmployee` :

```ts
    if (action === "hrSaveDocument" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const body = await req.json();
      const DOC_TYPES = new Set(["passport", "emirates_id", "visa", "labour_card", "medical_insurance", "contract", "other"]);
      if (!DOC_TYPES.has(String(body.doc_type))) return jsonResp({ error: "invalid doc_type" }, 400);
      const cleanerId = Number(body.cleaner_id);
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);
      const isDate = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (body.issue_date && !isDate(body.issue_date)) return jsonResp({ error: "issue_date must be YYYY-MM-DD" }, 400);
      if (body.expiry_date && !isDate(body.expiry_date)) return jsonResp({ error: "expiry_date must be YYYY-MM-DD" }, 400);

      const row: Record<string, any> = {
        cleaner_id: cleanerId,
        doc_type: String(body.doc_type),
        // Un numéro de passeport n'a pas a être stocké en entier ici : on garde
        // ce que le manager saisit, borné, et on ne l'affiche qu'aux managers.
        doc_number: body.doc_number ? String(body.doc_number).slice(0, 60) : null,
        issue_date: body.issue_date || null,
        expiry_date: body.expiry_date || null,
        note: body.note ? String(body.note).slice(0, 500) : null,
        updated_at: new Date().toISOString(),
      };
      if (body.id) row.id = Number(body.id);
      const { data, error } = await sb.from("employee_documents").upsert(row).select().single();
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success", document: data });
    }

    if (action === "hrDeleteDocument" && req.method === "POST") {
      const g = await hrAuth(sb, req, "manager");
      if (g.err) return g.err;
      const id = Number((await req.json()).id);
      if (!id) return jsonResp({ error: "id required" }, 400);
      const { error } = await sb.from("employee_documents").delete().eq("id", id);
      if (error) return jsonResp({ error: error.message }, 500);
      return jsonResp({ status: "success" });
    }
```

- [ ] **Step 4: Déployer et vérifier**

```bash
npm run deploy:proxy
SECRET='0RicFT1AZL0NDyH1M2ZWhbUvworsGOx38UhNNwFVF8dmP8SC-TRXfaoyQbR5pdn0'
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'
for a in hrSaveDocument hrDeleteDocument; do
  printf '%s ' "$a"
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$BASE?action=$a" -H "X-App-Secret: $SECRET" -H 'Content-Type: application/json' -d '{}'
done
```

Attendu : `401` sur les deux.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(rh): documents employés et suivi des expirations"
```

---

### Task 13: Interface documents

**Files:**
- Modify: `hr.js` (section documents dans `renderHRDetail`, bandeau d'alerte dans `renderHRManager`)

**Interfaces:**
- Consumes: `hrData.documents`, `hrData.expiring`, helper `daysUntil`, constante `HR_DOC_TYPES`.
- Produces: `hrSaveDocument()`, `hrDeleteDocument(id)`, `hrEditDoc(id)`.

- [ ] **Step 1: Ajouter le bandeau d'expirations dans renderHRManager**

Dans `renderHRManager`, juste après le bloc "Pending requests", insérer :

```js
  const expiring = hrData.expiring || [];
  if (expiring.length) {
    h += '<div class="hr-section"><h3>Documents expiring</h3>';
    expiring.forEach(d => {
      const left = daysUntil(d.expiry_date, today);
      h += '<div class="hr-card" data-action="hrOpen" data-arg0="' + d.cleaner_id + '" style="cursor:pointer">' +
        '<div class="hr-row"><div class="hr-grow">' +
        '<div class="hr-name">' + esc(hrCleanerName(d.cleaner_id)) + '</div>' +
        '<div class="hr-meta">' + esc(hrDocLabel(d.doc_type)) + ' · expires ' + esc(d.expiry_date) + '</div></div>' +
        '<span class="hr-badge ' + (left < 0 ? 'rejected' : 'pending') + '">' +
        (left < 0 ? 'expired ' + Math.abs(left) + 'd ago' : left + 'd left') + '</span>' +
        '</div></div>';
    });
    h += '</div>';
  }
```

- [ ] **Step 2: Ajouter le helper de libellé**

```js
function hrDocLabel(key){
  const d = HR_DOC_TYPES.find(x => x.key === key);
  return d ? d.label : key;
}
```

- [ ] **Step 3: Ajouter la section documents dans renderHRDetail**

Dans `renderHRDetail`, a l'intérieur du `if (emp) { ... }` final, avant le `return h`, ajouter :

```js
    const docs = (hrData.documents || []).filter(d => d.cleaner_id === cid);
    h += '<div class="hr-section"><h3>Documents</h3>';
    docs.forEach(d => {
      const left = daysUntil(d.expiry_date, hrToday());
      h += '<div class="hr-card"><div class="hr-row"><div class="hr-grow">' +
        '<div class="hr-name">' + esc(hrDocLabel(d.doc_type)) + '</div>' +
        '<div class="hr-meta">' + (d.doc_number ? esc(d.doc_number) + ' · ' : '') +
        (d.expiry_date ? 'expires ' + esc(d.expiry_date) : 'no expiry') +
        (d.note ? ' · ' + esc(d.note) : '') + '</div></div>' +
        (left !== null ? '<span class="hr-badge ' + (left < 0 ? 'rejected' : left <= 60 ? 'pending' : 'approved') + '">' +
          (left < 0 ? 'expired' : left + 'd') + '</span>' : '') +
        '<button class="hr-btn-alt" style="padding:6px 10px;border:none;border-radius:8px;cursor:pointer" data-action="hrDeleteDocument" data-arg0="' + d.id + '" title="Delete" aria-label="Delete document">' + icon('trash', 14) + '</button>' +
        '</div></div>';
    });
    if (!docs.length) h += '<div class="hr-empty">No document on file.</div>';
    h += '<div class="hr-card"><div class="hr-form">' +
      '<label>Type</label><select id="hrDocType">' +
      HR_DOC_TYPES.map(t => '<option value="' + t.key + '">' + esc(t.label) + '</option>').join('') + '</select>' +
      '<label>Number</label><input id="hrDocNumber" placeholder="Optional"/>' +
      '<label>Issued</label><input type="date" id="hrDocIssue"/>' +
      '<label>Expires</label><input type="date" id="hrDocExpiry"/>' +
      '<label>Note</label><input id="hrDocNote" placeholder="Optional"/>' +
      '</div><div class="hr-actions">' +
      '<button class="hr-btn-ok" data-action="hrSaveDocument" data-arg0="' + cid + '">Add document</button>' +
      '</div></div></div>';
```

- [ ] **Step 4: Ajouter les handlers**

```js
async function hrSaveDocument(cleanerId){
  if (hrSubmitting) return;
  const type = hrVal('hrDocType');
  if (!type) { toast('Pick a document type', 'error'); return; }
  hrSubmitting = true;
  try {
    await apiWrite('hrSaveDocument', { body: {
      cleaner_id: Number(cleanerId), doc_type: type,
      doc_number: hrVal('hrDocNumber') || null,
      issue_date: hrVal('hrDocIssue') || null,
      expiry_date: hrVal('hrDocExpiry') || null,
      note: hrVal('hrDocNote') || null,
    }});
    toast('Document saved', 'success');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to save', 'error');
  } finally {
    hrSubmitting = false;
  }
}

async function hrDeleteDocument(id){
  if (!confirm('Delete this document?')) return;
  try {
    await apiWrite('hrDeleteDocument', { body: { id: Number(id) } });
    toast('Document deleted', 'info');
    hrData = null;
    await loadHR();
  } catch (e) {
    toast((e && e.message) || 'Failed to delete', 'error');
  }
}
```

- [ ] **Step 5: Vérifier dans le navigateur**

Recharger, ouvrir un dossier employé, vérifier que la section Documents s'affiche avec "No document on file." et le formulaire d'ajout. Simuler une expiration dans la console :

```js
hrData.documents=[{id:1,cleaner_id:<CID>,doc_type:'visa',doc_number:'X',expiry_date:'2026-08-20'}];
hrData.expiring=hrData.documents; render();
```

Attendu : badge orange `17d` dans le détail et bandeau "Documents expiring" sur la liste.

- [ ] **Step 6: Commit**

```bash
git add hr.js
git commit -m "feat(rh): interface documents et alerte visuelle d'expiration"
```

---

### Task 14: Alertes Telegram d'expiration de documents

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (helper `hrRunExpiryAlerts`, appel dans `hrOverview`, route serveur `hrCheckExpiries`, `SERVER_ONLY_ACTIONS`)

**Interfaces:**
- Consumes: table `app_config` (`key`, `value`), `hrNotifyManagers`, `daysUntil` côté serveur.
- Produces: POST `hrCheckExpiries` (gate `X-Server-Secret`) -> `{status:"success", sent: number}`.

- [ ] **Step 1: Ajouter le helper d'alerte**

Après `hrNotifyCleaner` :

```ts
// Alertes d'expiration de documents. Un document déclenche au plus une alerte
// par palier (60 / 30 / 7 / 0 jours) : la clé app_config `hr_doc_alert_<id>_<palier>`
// sert de verrou, sinon chaque ouverture de l'onglet RH renverrait la même notif.
const HR_EXPIRY_THRESHOLDS = [60, 30, 7, 0];

async function hrRunExpiryAlerts(sb: any): Promise<number> {
  const today = HR_TODAY();
  const horizon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const { data: docs } = await sb.from("employee_documents")
    .select("id, cleaner_id, doc_type, expiry_date")
    .not("expiry_date", "is", null).lte("expiry_date", horizon);
  if (!docs || !docs.length) return 0;

  const { data: cRows } = await sb.from("cleaners").select("id, name");
  const nameOf = (id: number) => {
    const c = (cRows || []).find((x: any) => x.id === id);
    return (c && c.name) || ("#" + id);
  };

  let sent = 0;
  for (const d of docs) {
    const left = Math.round((Date.parse(d.expiry_date + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
    // Palier franchi le plus proche : 45 jours restants déclenche le palier 60.
    const threshold = HR_EXPIRY_THRESHOLDS.find((t) => left <= t);
    if (threshold === undefined) continue;
    const key = `hr_doc_alert_${d.id}_${threshold}`;
    const { data: seen } = await sb.from("app_config").select("key").eq("key", key).maybeSingle();
    if (seen) continue;
    await hrNotifyManagers(sb,
      `📄 <b>Document expiring</b>\n${nameOf(d.cleaner_id)} - ${d.doc_type}\n` +
      (left < 0 ? `Expired ${Math.abs(left)} day(s) ago (${d.expiry_date})` : `Expires in ${left} day(s) (${d.expiry_date})`));
    await sb.from("app_config").upsert({ key, value: today, updated_at: new Date().toISOString() }, { onConflict: "key" });
    sent++;
  }
  return sent;
}
```

- [ ] **Step 2: Déclencher a l'ouverture de l'onglet RH**

Dans le handler `hrOverview`, juste avant le `return jsonResp`, ajouter :

```ts
      // Fire and forget : un envoi Telegram lent ne doit pas retarder l'écran.
      hrRunExpiryAlerts(sb).catch((e) => console.warn("[hr] expiry alerts failed", e));
```

- [ ] **Step 3: Ajouter la route serveur**

Dans la Map `ROUTES`, bloc RH :

```ts
  ["hrCheckExpiries", "POST"],
```

Dans le set `SERVER_ONLY_ACTIONS`, ajouter `"hrCheckExpiries"`.

Puis le handler, a la suite de `hrDeleteDocument` :

```ts
    if (action === "hrCheckExpiries" && req.method === "POST") {
      // Route serveur : un cron VPS peut la déclencher tous les jours sans
      // qu'un manager ait besoin d'ouvrir l'app.
      const sent = await hrRunExpiryAlerts(sb);
      return jsonResp({ status: "success", sent });
    }
```

- [ ] **Step 4: Déployer et vérifier le gate serveur**

```bash
npm run deploy:proxy
SECRET='0RicFT1AZL0NDyH1M2ZWhbUvworsGOx38UhNNwFVF8dmP8SC-TRXfaoyQbR5pdn0'
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'
curl -sS -o /dev/null -w '403? %{http_code}\n' -X POST "$BASE?action=hrCheckExpiries" -H "X-App-Secret: $SECRET" -H 'Content-Type: application/json' -d '{}'
```

Attendu : `403` (route serveur, `X-Server-Secret` absent). Un `404` signifie que `ROUTES` n'a pas été mis a jour, un `401` que `SERVER_ONLY_ACTIONS` n'a pas été mis a jour.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(rh): alertes Telegram d'expiration de documents avec anti-doublon"
```

---

## Phase 3 - Rémunération et gratuity (Tasks 15 à 17)

### Task 15: Route de rémunération réservée au CEO

**Files:**
- Modify: `supabase/functions/hostaway-proxy/index.ts` (Map `ROUTES` + handler)

**Interfaces:**
- Consumes: `hrAuth(sb, req, "owner")`, tables `employees` et `leave_requests`.
- Produces: GET `hrGetCompensation?cleaner_id=N` -> `{status:"success", compensation:{cleaner_id, basic_salary, housing_allowance, transport_allowance, other_allowance, total, hire_date, end_date, unpaid_days}}`

- [ ] **Step 1: Enregistrer la route**

```ts
  ["hrGetCompensation", "GET"],
```

- [ ] **Step 2: Implémenter le handler**

```ts
    if (action === "hrGetCompensation") {
      // SEULE route du proxy qui renvoie des montants de salaire. Gate owner :
      // les autres managers reçoivent 403. Ne jamais élargir ce gate ni ajouter
      // ces colonnes a une autre route.
      const g = await hrAuth(sb, req, "owner");
      if (g.err) return g.err;
      const cleanerId = Number(url.searchParams.get("cleaner_id"));
      if (!cleanerId) return jsonResp({ error: "cleaner_id required" }, 400);
      const { data: emp } = await sb.from("employees")
        .select("cleaner_id, hire_date, end_date, basic_salary, housing_allowance, transport_allowance, other_allowance")
        .eq("cleaner_id", cleanerId).maybeSingle();
      if (!emp) return jsonResp({ error: "no employee record" }, 404);
      // Les congés non payés ne comptent pas dans l'ancienneté servant a la gratuity.
      const { data: unpaid } = await sb.from("leave_requests")
        .select("days").eq("cleaner_id", cleanerId).eq("status", "approved").eq("leave_type", "unpaid");
      const unpaidDays = (unpaid || []).reduce((s: number, r: any) => s + Number(r.days || 0), 0);
      const n = (v: any) => Number(v || 0);
      return jsonResp({
        status: "success",
        compensation: {
          cleaner_id: emp.cleaner_id,
          hire_date: emp.hire_date,
          end_date: emp.end_date,
          basic_salary: emp.basic_salary,
          housing_allowance: emp.housing_allowance,
          transport_allowance: emp.transport_allowance,
          other_allowance: emp.other_allowance,
          total: n(emp.basic_salary) + n(emp.housing_allowance) + n(emp.transport_allowance) + n(emp.other_allowance),
          unpaid_days: unpaidDays,
        },
      });
    }
```

- [ ] **Step 3: Déployer et vérifier**

```bash
npm run deploy:proxy
SECRET='0RicFT1AZL0NDyH1M2ZWhbUvworsGOx38UhNNwFVF8dmP8SC-TRXfaoyQbR5pdn0'
BASE='https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy'
curl -sS -o /dev/null -w '401? %{http_code}\n' "$BASE?action=hrGetCompensation&cleaner_id=1" -H "X-App-Secret: $SECRET"
```

Attendu : `401`.

- [ ] **Step 4: Audit de non-fuite**

```bash
grep -n "basic_salary\|housing_allowance\|transport_allowance\|other_allowance" supabase/functions/hostaway-proxy/index.ts
```

Attendu : les occurrences ne doivent apparaître que dans le handler `hrGetCompensation`, dans `hrSaveEmployee` (écriture, gardée par `g.isOwner`), et dans aucun `select` d'une autre route. Vérifier en particulier qu'aucun `select("*")` sur `employees` n'existe :

```bash
grep -n 'from("employees")' supabase/functions/hostaway-proxy/index.ts
```

Chaque ligne doit utiliser `HR_EMPLOYEE_PUBLIC_COLS` ou une liste explicite de colonnes non sensibles, sauf `hrGetCompensation`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hostaway-proxy/index.ts
git commit -m "feat(rh): route de rémunération réservée au CEO"
```

---

### Task 16: Bloc rémunération et gratuity dans l'interface

**Files:**
- Modify: `hr.js` (section rémunération dans `renderHRDetail`)

**Interfaces:**
- Consumes: route `hrGetCompensation`, helper `gratuityEstimate`, drapeau `hrData.isOwner`.
- Produces: `hrLoadComp(cleanerId)`, `hrSaveComp(cleanerId)`, état `hrComp`.

- [ ] **Step 1: Ajouter l'état et le chargement**

Dans `hr.js` :

```js
let hrComp = null;        // payload hrGetCompensation du dossier ouvert
let hrCompLoading = false;

async function hrLoadComp(cleanerId){
  if (hrCompLoading) return;
  hrCompLoading = true;
  try {
    const r = await api('hrGetCompensation', { params: { cleaner_id: Number(cleanerId) } });
    hrComp = (r && r.error) ? null : r.compensation;
  } catch (e) {
    hrComp = null;
  } finally {
    hrCompLoading = false;
    render();
  }
}
```

Et dans `hrOpen`, réinitialiser : `hrComp = null;` avant le `render()`.

- [ ] **Step 2: Ajouter le bloc dans renderHRDetail**

Dans `renderHRDetail`, a l'intérieur du `if (emp)`, avant le `return h` :

```js
    if (hrData.isOwner) {
      if (hrComp === null && !hrCompLoading) hrLoadComp(cid);
      const c = hrComp || {};
      const endForGratuity = emp.end_date || hrToday();
      const grat = gratuityEstimate(emp.hire_date, endForGratuity, c.basic_salary, c.unpaid_days || 0);
      h += '<div class="hr-section"><h3>Compensation (CEO only)</h3><div class="hr-card">' +
        '<div class="hr-form">' +
        '<label>Basic salary (AED / month)</label><input type="number" step="1" id="hrBasic" value="' + (c.basic_salary != null ? c.basic_salary : '') + '"/>' +
        '<label>Housing allowance</label><input type="number" step="1" id="hrHousing" value="' + (c.housing_allowance != null ? c.housing_allowance : '') + '"/>' +
        '<label>Transport allowance</label><input type="number" step="1" id="hrTransport" value="' + (c.transport_allowance != null ? c.transport_allowance : '') + '"/>' +
        '<label>Other allowance</label><input type="number" step="1" id="hrOther" value="' + (c.other_allowance != null ? c.other_allowance : '') + '"/>' +
        '</div><div class="hr-actions"><button class="hr-btn-ok" data-action="hrSaveComp" data-arg0="' + cid + '">Save compensation</button></div>' +
        '<div class="hr-stat" style="margin-top:10px"><span>Total package</span><b>' + (c.total || 0) + ' AED</b></div>' +
        '<div class="hr-stat"><span>Basic share</span><b>' + (c.total ? Math.round((Number(c.basic_salary || 0) / c.total) * 100) : 0) + '%</b></div>' +
        '</div>';
      h += '<div class="hr-card">' +
        '<div class="hr-name" style="margin-bottom:6px">End of service estimate</div>' +
        '<div class="hr-stat"><span>Service years' + (emp.end_date ? '' : ' if leaving today') + '</span><b>' + grat.years + '</b></div>' +
        '<div class="hr-stat"><span>Gratuity days</span><b>' + grat.days + '</b></div>' +
        '<div class="hr-stat"><span>Unpaid leave deducted</span><b>' + (c.unpaid_days || 0) + ' days</b></div>' +
        '<div class="hr-stat"><span>Estimated gratuity</span><b>' + grat.amount + ' AED</b></div>' +
        '<div class="hr-meta" style="margin-top:8px">Indicative only, based on basic salary. Confirm with the PRO before any settlement.</div>' +
        '</div></div>';
    }
```

- [ ] **Step 3: Ajouter le handler de sauvegarde**

```js
async function hrSaveComp(cleanerId){
  if (hrSubmitting) return;
  const emp = (hrData.employees || []).find(e => e.cleaner_id === Number(cleanerId));
  if (!emp) { toast('Create the employee record first', 'error'); return; }
  const num = (id) => { const v = hrVal(id); return v === '' ? null : Number(v); };
  hrSubmitting = true;
  try {
    await apiWrite('hrSaveEmployee', { body: {
      cleaner_id: Number(cleanerId),
      hire_date: emp.hire_date,
      end_date: emp.end_date || null,
      job_title: emp.job_title || null,
      nationality: emp.nationality || null,
      opening_annual_days: emp.opening_annual_days || 0,
      opening_date: emp.opening_date,
      notes: emp.notes || null,
      basic_salary: num('hrBasic'),
      housing_allowance: num('hrHousing'),
      transport_allowance: num('hrTransport'),
      other_allowance: num('hrOther'),
    }});
    toast('Compensation saved', 'success');
    hrComp = null;
    await hrLoadComp(cleanerId);
  } catch (e) {
    toast((e && e.message) || 'Failed to save', 'error');
  } finally {
    hrSubmitting = false;
  }
}
```

Note : `hrSaveEmployee` fait un upsert complet, donc les champs non sensibles sont repris depuis `emp` pour ne pas les écraser avec des valeurs vides.

- [ ] **Step 4: Vérifier que le bloc est absent pour un manager non-owner**

Dans la console :

```js
hrData.isOwner = false; render();
```

Attendu : la section "Compensation (CEO only)" disparaît entièrement du détail. Puis :

```js
hrData.isOwner = true; render();
```

Attendu : elle réapparaît. Le masquage frontend est un confort ; la vraie garantie est le 403 de `hrGetCompensation`, déja vérifié en Task 15.

- [ ] **Step 5: Commit**

```bash
git add hr.js
git commit -m "feat(rh): bloc rémunération et estimation de gratuity réservé au CEO"
```

---

### Task 17: Déploiement et vérification de bout en bout

**Files:**
- Modify: `sw.js` (VERSION stampée automatiquement par le script de déploiement)

- [ ] **Step 1: Lancer la suite de tests**

```bash
cd "/Users/hillal/Documents/Wix new/hk-planner-repo"
python3 -m http.server 8888 >/dev/null 2>&1 &
HK_PLANNER_URL=http://localhost:8888 npx playwright test --project=desktop
```

Attendu : toute la suite passe, y compris `tests/hr.spec.ts` et les tests existants (`helpers.spec.ts`, `laundry.spec.ts`, `smoke.spec.ts`). Un échec sur `smoke.spec.ts` en local peut venir des appels réseau vers le proxy ; dans ce cas relancer uniquement `hr.spec.ts` et `laundry.spec.ts` en local, et laisser `smoke.spec.ts` pour la vérification post-déploiement.

- [ ] **Step 2: Déployer le frontend**

```bash
./deploy-front.sh
```

Le script stampe `sw.js` VERSION avec la date et le hash de commit, puis déploie sur Netlify prod.

- [ ] **Step 3: Committer le stamp du service worker**

```bash
git add sw.js && git commit -m "chore: stamp sw VERSION apres deploiement RH"
```

- [ ] **Step 4: Vérification manuelle en production, côté manager**

Sur `https://stunning-kleicha-f61101.netlify.app`, se connecter en manager (Hillal) puis :

1. More > HR : l'écran s'affiche, "Not set up yet" liste l'équipe.
2. Créer le dossier d'un salarié : renseigner hire date et job title, enregistrer. Le dossier passe dans "Team" avec un solde de congés.
3. Ajouter un document avec une expiration a moins de 60 jours : le bandeau "Documents expiring" apparaît et une notification Telegram arrive.
4. Déposer une demande de congé pour ce salarié sur une date où il a un ménage assigné, puis l'approuver.
5. Retourner sur le planner et tenter d'assigner ce salarié sur cette date : l'assignation doit être refusée avec le message "<Nom> is on approved leave on <date>".
6. Depuis le détail du salarié, annuler le congé approuvé, puis refaire l'assignation : elle doit passer.
7. Vérifier que le bloc "Compensation (CEO only)" est visible et que la gratuity s'affiche après saisie d'un basic salary.

- [ ] **Step 5: Vérification manuelle côté salarié**

Se connecter avec le PIN d'un cleaner ayant un dossier :

1. L'onglet "Leave" est présent dans la barre du bas.
2. Le solde de congés annuels s'affiche.
3. Déposer une demande : le manager reçoit la notification Telegram.
4. La demande apparaît en "pending" avec un bouton Cancel.
5. Vérifier dans les outils réseau du navigateur que la réponse de `hrMyLeave` ne contient AUCUN champ `basic_salary`, `housing_allowance`, `transport_allowance` ni `other_allowance`, et que `getAllData` ne renvoie dans `leaves` que `cleaner_id`, `start_date` et `end_date`.

- [ ] **Step 6: Vérification du cloisonnement**

Se connecter avec le PIN d'un manager qui n'est PAS Hillal :

1. L'onglet HR est accessible, les congés et documents sont visibles.
2. La section "Compensation (CEO only)" est absente.
3. Dans la console : `await api('hrGetCompensation',{params:{cleaner_id:1}})` doit renvoyer `{error:"owner auth required"}`.

Si l'un de ces trois points échoue, ne pas continuer : c'est la contrainte de confidentialité posée par Hillal.

- [ ] **Step 7: Commit final**

```bash
git status
git log --oneline -12
```

Vérifier qu'il ne reste rien de non commité en dehors des artefacts de test (`test-results/`, `playwright-report/`).

---

## Notes de mise en oeuvre

**Ordre des dépendances.** Les Tasks 1 a 6 sont backend et peuvent s'enchaîner sans interface. Les Tasks 7 a 11 dépendent des routes des Tasks 3 a 6. La Task 11 dépend de la Task 6 (clé `leaves` dans `getAllData`). Les Tasks 12 a 14 dépendent de la Task 1 (table `employee_documents`) et de la Task 8 (écran manager). Les Tasks 15 et 16 dépendent de la Task 9 (`renderHRDetail`).

**Pièges connus.**
- Toute action absente de la Map `ROUTES` renvoie 404 avant d'atteindre son handler. C'est la cause la plus probable d'un 404 inattendu.
- `getAllData` renvoie `cleaners.*` a tous les clients, mode cleaner compris. C'est précisément pour ça que les montants sont dans `employees` et pas dans `cleaners`.
- `sw.js` sert `/hr.js` en network-first : sans l'entrée ajoutée en Task 2, les clients existants garderaient un `hr.js` périmé ou absent.
- Le raccourci Chrome de Hillal peut pointer sur un hash de déploiement figé. En cas de doute sur la version servie, ouvrir l'URL Netlify de prod directement.

