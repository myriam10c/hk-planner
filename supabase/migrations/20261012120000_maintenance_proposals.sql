-- Maintenance repensee (spec 2026-10-12) : propositions tirees des messages
-- des guests, validees par Semax ou un manager avant de devenir des tickets.
CREATE TABLE IF NOT EXISTS public.maintenance_proposals (
  id bigserial PRIMARY KEY,
  listing_id text,
  reservation_id text,
  conversation_id text NOT NULL,
  guest_name text,
  stay_from date,
  stay_to date,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('ac','plumbing','electrical','appliance','lock_door','wifi_tv','hot_water','pest','furniture','other')),
  urgency text NOT NULL CHECK (urgency IN ('urgent','high','normal')),
  quotes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  ticket_id integer REFERENCES public.maintenance_tickets(id) ON DELETE SET NULL,
  open_ticket_id integer,
  decided_by text,
  decided_at timestamptz,
  reject_reason text CHECK (reject_reason IS NULL OR reject_reason IN ('not_maintenance','already_fixed','duplicate','other')),
  reject_note text,
  dedup_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Une seule proposition en attente par conversation et categorie.
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_proposals_pending_dedup
  ON public.maintenance_proposals (dedup_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS maintenance_proposals_status_created ON public.maintenance_proposals (status, created_at DESC);
ALTER TABLE public.maintenance_proposals ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.maintenance_tickets ADD COLUMN IF NOT EXISTS proposal_id bigint;
ALTER TABLE public.maintenance_tickets ADD COLUMN IF NOT EXISTS due_on date;

-- Archives pour la remise a zero de la phase 5 (vides ici).
CREATE TABLE IF NOT EXISTS public.archive_maintenance_tickets (LIKE public.maintenance_tickets INCLUDING DEFAULTS);
ALTER TABLE public.archive_maintenance_tickets ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_ticket_comments (LIKE public.ticket_comments INCLUDING DEFAULTS);
ALTER TABLE public.archive_ticket_comments ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_maintenance_costs (LIKE public.maintenance_costs INCLUDING DEFAULTS);
ALTER TABLE public.archive_maintenance_costs ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_ticket_photos (LIKE public.photos INCLUDING DEFAULTS);
ALTER TABLE public.archive_ticket_photos ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE IF NOT EXISTS public.archive_team_tasks (LIKE public.team_tasks INCLUDING DEFAULTS);
ALTER TABLE public.archive_team_tasks ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.archive_maintenance_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_maintenance_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_ticket_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_team_tasks ENABLE ROW LEVEL SECURITY;

-- Deux types d evenement en plus pour la garde d idempotence.
ALTER TABLE public.job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check;
ALTER TABLE public.job_events ADD CONSTRAINT job_events_event_type_check CHECK (event_type IN (
  'start_job','tick','upload_photo','finish_job','report_problem','check_ticket','delete_photo','add_problem_photo','set_problem_note','upload_voice','set_problem_voice','update_problem','delete_problem','mgr_problem_act','mnt_act','mnt_ingest'));
