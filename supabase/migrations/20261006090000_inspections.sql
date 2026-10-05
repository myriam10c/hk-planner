-- Module Inspections (spec 2026-10-05-hk-inspections-design.md).
CREATE TABLE IF NOT EXISTS public.inspections (
  id            bigserial PRIMARY KEY,
  listing_id    text NOT NULL,
  inspector_id  integer NOT NULL REFERENCES public.cleaners(id),
  inspection_date date NOT NULL,
  eligibility   text NOT NULL CHECK (eligibility IN ('checkout','vacant','adhoc')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  general_note  text,
  idem_key      text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspections_listing_finished
  ON public.inspections (listing_id, finished_at DESC);
-- Une seule inspection en cours par inspecteur et par logement et par jour.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inspections_open
  ON public.inspections (listing_id, inspector_id, inspection_date) WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS public.inspection_items (
  id            bigserial PRIMARY KEY,
  inspection_id bigint NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  zone          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('ok','not_ok')),
  note          text,
  outcome       text CHECK (outcome IN ('fixed','maintenance')),
  fix_note      text,
  ticket_id     integer REFERENCES public.maintenance_tickets(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, zone)
);

CREATE TABLE IF NOT EXISTS public.inspection_photos (
  id            bigserial PRIMARY KEY,
  inspection_id bigint NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  zone          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('issue','after')),
  storage_path  text NOT NULL UNIQUE,
  idem_key      text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inspection_photos_insp ON public.inspection_photos (inspection_id);

CREATE TABLE IF NOT EXISTS public.inspection_proposals (
  proposal_date date NOT NULL,
  listing_id    text NOT NULL,
  rank          integer NOT NULL,
  claimed_by    integer REFERENCES public.cleaners(id),
  claimed_at    timestamptz,
  assigned_by   integer REFERENCES public.cleaners(id),
  PRIMARY KEY (proposal_date, listing_id)
);

ALTER TABLE public.listing_config
  ADD COLUMN IF NOT EXISTS inspection_excluded boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_tickets_inspection_ref
  ON public.maintenance_tickets (source_ref) WHERE source = 'inspection';

-- Fermees au client : tout passe par le proxy (service role).
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_proposals ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_config (key, value) VALUES ('inspections_daily_target', '4')
  ON CONFLICT (key) DO NOTHING;
