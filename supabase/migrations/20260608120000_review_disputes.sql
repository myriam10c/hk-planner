-- review_disputes : version partagée (web) du tracker local JSON de
-- walter_dispute_prep.py. L'analyse (removable, ground, template, quote, evidence,
-- public_reply) est pré-calculée chaque jour par un job Claude Max et upsertée ici ;
-- le statut de progression (dispute_status, reply_posted) est mis à jour par
-- Walter/Hillal depuis HK Planner. Edge accède via service_role ; RLS activée sans
-- policy => anon bloqué (même posture que team_tasks).
-- Pas de FK vers reviews_cache : le join se fait côté edge (getDisputes) pour rester
-- robuste si reviews_cache.id n'a pas de contrainte unique formelle.

CREATE TABLE IF NOT EXISTS public.review_disputes (
  review_id       BIGINT PRIMARY KEY,
  reservation_id  BIGINT,
  removable       BOOLEAN NOT NULL DEFAULT false,
  confidence      TEXT CHECK (confidence IS NULL OR confidence IN ('STRONG','MEDIUM','WEAK')),
  ground          TEXT,
  template        INTEGER,
  quote           TEXT,
  evidence        JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_reply    TEXT,
  analyzed_at     TIMESTAMPTZ,
  dispute_status  TEXT NOT NULL DEFAULT 'todo'
                    CHECK (dispute_status IN ('todo','submitted','removed','rejected','not_disputable')),
  reply_posted    BOOLEAN NOT NULL DEFAULT false,
  proposal_count  INTEGER NOT NULL DEFAULT 0,
  last_proposed   DATE,
  updated_by      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_disputes_status_idx ON public.review_disputes (dispute_status);
CREATE INDEX IF NOT EXISTS review_disputes_reservation_idx ON public.review_disputes (reservation_id);

ALTER TABLE public.review_disputes ENABLE ROW LEVEL SECURITY;

-- Au premier INSERT seulement : une plainte non-removable démarre en 'not_disputable',
-- une review removable en 'todo' (défaut). Les UPDATE du job quotidien n'envoient
-- jamais dispute_status, donc ne déclenchent pas ce trigger (BEFORE INSERT) =>
-- le statut posé par Walter est toujours préservé.
CREATE OR REPLACE FUNCTION public.review_disputes_init_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.removable = false THEN
    NEW.dispute_status := 'not_disputable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS review_disputes_init_status_trg ON public.review_disputes;
CREATE TRIGGER review_disputes_init_status_trg
  BEFORE INSERT ON public.review_disputes
  FOR EACH ROW EXECUTE FUNCTION public.review_disputes_init_status();
