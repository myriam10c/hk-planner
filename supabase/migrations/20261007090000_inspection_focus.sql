-- Inspections : points a verifier en priorite par logement (problemes recurrents remontes par les guests).
-- Source initiale : rapport "Recurring guest issues" du 2026-10-07 (meme probleme sur >= 3 sejours en 12 mois).
CREATE TABLE IF NOT EXISTS public.inspection_focus (
  id          bigserial PRIMARY KEY,
  listing_id  text NOT NULL,
  zone        text NOT NULL,
  title       text NOT NULL,
  check_text  text NOT NULL,
  reported    text,
  stays       integer,
  last_seen   date,
  source      text NOT NULL DEFAULT 'manual',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, zone, title, source)
);
CREATE INDEX IF NOT EXISTS idx_inspection_focus_listing ON public.inspection_focus (listing_id) WHERE active;
ALTER TABLE public.inspection_focus ENABLE ROW LEVEL SECURITY;
