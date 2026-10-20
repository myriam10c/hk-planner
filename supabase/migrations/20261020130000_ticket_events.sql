-- Suivi de qui ouvre et ferme un ticket (demande de Hillal, 20/10/2026).
-- Un trigger sur maintenance_tickets journalise chaque creation et chaque
-- changement de statut, quel que soit l'ecrivain (proxy, inspections, app
-- cleaner, Hermes, API assistant, ecriture directe en base).
-- L'auteur arrive par la colonne actor_hint, posee par l'ecrivain dans la meme
-- ecriture et toujours remise a NULL par le trigger : une ecriture qui ne la
-- pose pas est journalisee « unknown », jamais attribuee a l'auteur precedent.
-- A la creation sans indice, l'auteur est reported_by.

ALTER TABLE public.maintenance_tickets ADD COLUMN IF NOT EXISTS actor_hint text;

CREATE TABLE IF NOT EXISTS public.ticket_events (
  id bigserial PRIMARY KEY,
  ticket_id integer NOT NULL,
  event text NOT NULL CHECK (event IN ('opened', 'closed', 'cancelled', 'reopened', 'status')),
  from_status text,
  to_status text,
  actor text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON public.ticket_events (ticket_id, at);
CREATE INDEX IF NOT EXISTS ticket_events_at_idx ON public.ticket_events (at);
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.ticket_events IS
  'Journal des ouvertures, clotures, reouvertures et changements de statut des tickets de maintenance. Ecrit par le trigger trg_ticket_events uniquement.';

CREATE OR REPLACE FUNCTION public.ticket_events_track() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  who text := nullif(btrim(NEW.actor_hint), '');
  closed text[] := ARRAY['resolved', 'closed', 'cancelled'];
  was_closed boolean;
  is_closed boolean;
  ev text;
BEGIN
  NEW.actor_hint := NULL;
  IF TG_OP = 'INSERT' THEN
    ev := 'opened';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    was_closed := coalesce(OLD.status, '') = ANY (closed);
    is_closed := coalesce(NEW.status, '') = ANY (closed);
    ev := CASE
      WHEN is_closed AND NOT was_closed THEN CASE WHEN NEW.status = 'cancelled' THEN 'cancelled' ELSE 'closed' END
      WHEN was_closed AND NOT is_closed THEN 'reopened'
      ELSE 'status' END;
  ELSE
    RETURN NEW;
  END IF;
  BEGIN
    INSERT INTO public.ticket_events (ticket_id, event, from_status, to_status, actor)
    VALUES (NEW.id, ev, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status,
            coalesce(who, CASE WHEN TG_OP = 'INSERT' THEN nullif(btrim(NEW.reported_by), '') END, 'unknown'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ticket_events: % (ticket %)', SQLERRM, NEW.id; -- le suivi ne bloque jamais un ticket
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_events ON public.maintenance_tickets;
CREATE TRIGGER trg_ticket_events BEFORE INSERT OR UPDATE ON public.maintenance_tickets
  FOR EACH ROW EXECUTE FUNCTION public.ticket_events_track();

-- Reprise de l'existant : creation de chaque ticket (reported_by), puis les
-- clotures et reouvertures deja journalisees par l'app dans cleaning_log.
INSERT INTO public.ticket_events (ticket_id, event, from_status, to_status, actor, at)
SELECT t.id, 'opened', NULL, NULL, coalesce(nullif(btrim(t.reported_by), ''), 'unknown'), coalesce(t.created_at, now())
FROM public.maintenance_tickets t
WHERE NOT EXISTS (SELECT 1 FROM public.ticket_events e WHERE e.ticket_id = t.id AND e.event = 'opened');

INSERT INTO public.ticket_events (ticket_id, event, from_status, to_status, actor, at)
SELECT substring(l.reservation_key FROM 8)::int,
       CASE l.action WHEN 'mnt_ticket.done' THEN 'closed' WHEN 'ticket_cancelled' THEN 'cancelled'
                     WHEN 'problem_closed' THEN 'closed' ELSE 'reopened' END,
       l.details->>'from', NULL, coalesce(nullif(btrim(l.actor), ''), 'unknown'), l.created_at
FROM public.cleaning_log l
WHERE l.reservation_key ~ '^ticket_[0-9]+$'
  AND l.action IN ('mnt_ticket.done', 'ticket_cancelled', 'mnt_ticket.reopen', 'problem_closed')
  AND EXISTS (SELECT 1 FROM public.maintenance_tickets t WHERE t.id = substring(l.reservation_key FROM 8)::int);
