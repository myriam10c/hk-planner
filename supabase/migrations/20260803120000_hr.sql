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
