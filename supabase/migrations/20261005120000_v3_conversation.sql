-- HK Planner v3, app conversation : rapports de menage, vocaux, pieces, nouveaux evenements.
--
-- La contrainte CHECK de job_events.event_type a ete posee en ligne (sans nom)
-- par 20260912090000_v3_cleaner.sql : Postgres l'a nommee job_events_event_type_check.
-- RLS activee sans policy, comme les autres tables v3 : seul le service_role lit et ecrit.

CREATE TABLE IF NOT EXISTS public.cleaning_reports (
  job_id          TEXT PRIMARY KEY,
  reservation_key TEXT NOT NULL,
  cleaner_id      INTEGER NOT NULL,
  payload         JSONB NOT NULL,
  text            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.cleaning_reports ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.cleaning_reports IS
  'v3 : rapport de fin de menage (payload structure + texte partage). Un par job_id. Ecrit par hostaway-proxy (service_role) uniquement.';

ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'photo';
ALTER TABLE public.photos DROP CONSTRAINT IF EXISTS photos_kind_check;
ALTER TABLE public.photos ADD CONSTRAINT photos_kind_check CHECK (kind IN ('photo','voice'));
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS room TEXT;

ALTER TABLE public.job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check;
ALTER TABLE public.job_events ADD CONSTRAINT job_events_event_type_check CHECK (event_type IN (
  'start_job','tick','upload_photo','finish_job','report_problem','check_ticket',
  'delete_photo','add_problem_photo','set_problem_note','upload_voice',
  'set_problem_voice','update_problem','delete_problem'));
