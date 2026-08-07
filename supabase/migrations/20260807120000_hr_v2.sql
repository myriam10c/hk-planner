-- ============================================================================
-- HR v2 : signatures des demandes de congé, formulaire PDF archivé,
-- jours fériés UAE.
--
-- - Signatures stockées en data-URL PNG base64 (<= 100 Ko, validé par l'edge
--   function). RLS sans policy comme le reste du module RH : seul le
--   service_role de l'edge function y accède.
-- - form_path : chemin du PDF archivé dans le bucket privé hr-forms
--   (leave-forms/{id}.pdf), null tant qu'aucun PDF n'a été généré.
-- - public_holidays : liste éditable par les managers. Les dates islamiques
--   dépendent de la lune : seed « (to confirm) » à ajuster à l'annonce.
-- ============================================================================

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS employee_signature TEXT,
  ADD COLUMN IF NOT EXISTS manager_signature  TEXT,
  ADD COLUMN IF NOT EXISTS form_path          TEXT;

COMMENT ON COLUMN public.leave_requests.employee_signature IS
  'Signature dessinée par l''employé à la soumission (data:image/png;base64). Null si saisie par un manager pour un tiers ou antérieure à la feature.';
COMMENT ON COLUMN public.leave_requests.manager_signature IS
  'Signature dessinée par le manager à l''approbation. Null si rejet ou antérieure à la feature.';
COMMENT ON COLUMN public.leave_requests.form_path IS
  'Chemin du PDF archivé dans le bucket hr-forms, ex. leave-forms/42.pdf.';

CREATE TABLE IF NOT EXISTS public.public_holidays (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.public_holidays IS
  'Jours fériés UAE, éditables par les managers via l''edge function. Aucun impact sur le décompte des congés.';

INSERT INTO public.public_holidays (holiday_date, name) VALUES
  ('2026-08-25', 'Prophet''s Birthday (to confirm)'),
  ('2026-12-02', 'Eid Al Etihad / National Day'),
  ('2026-12-03', 'Eid Al Etihad / National Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-03-10', 'Eid Al Fitr (to confirm)'),
  ('2027-03-11', 'Eid Al Fitr holiday (to confirm)'),
  ('2027-03-12', 'Eid Al Fitr holiday (to confirm)'),
  ('2027-05-16', 'Arafat Day (to confirm)'),
  ('2027-05-17', 'Eid Al Adha (to confirm)'),
  ('2027-05-18', 'Eid Al Adha holiday (to confirm)'),
  ('2027-05-19', 'Eid Al Adha holiday (to confirm)'),
  ('2027-06-06', 'Islamic New Year (to confirm)'),
  ('2027-08-14', 'Prophet''s Birthday (to confirm)'),
  ('2027-12-02', 'Eid Al Etihad / National Day'),
  ('2027-12-03', 'Eid Al Etihad / National Day')
ON CONFLICT (holiday_date) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('hr-forms', 'hr-forms', false)
ON CONFLICT (id) DO NOTHING;
