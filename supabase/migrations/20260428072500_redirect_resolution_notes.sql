-- Stop the bleeding: anything writing timestamped log entries
-- "[ISO-timestamp] text" to maintenance_tickets.resolution_notes on a NON-RESOLVED ticket
-- gets redirected into ticket_comments and the resolution_notes column is left untouched.
--
-- Context: a function (deployed straight to Supabase, not in repo, source unknown)
-- was appending Gemini-generated action suggestions to resolution_notes hourly.
-- 14 entries on a single ticket over 2 days. resolution_notes is meant for the
-- final write-up at resolve time, not a comment log. ticket_comments is the right home.
--
-- This trigger neutralises the bad writer without needing to find/redeploy that function.
-- Human-typed plain notes (no [ts] prefix) still go through unchanged.

CREATE OR REPLACE FUNCTION public.redirect_resolution_notes_log_entries()
RETURNS TRIGGER AS $$
DECLARE
  added_text TEXT;
  m TEXT[];
  parsed_ts TIMESTAMPTZ;
BEGIN
  -- Resolution_notes is legitimate at resolve/cancel time
  IF NEW.status IN ('resolved','cancelled') THEN
    RETURN NEW;
  END IF;

  IF NEW.resolution_notes IS NOT DISTINCT FROM OLD.resolution_notes THEN
    RETURN NEW;
  END IF;

  -- Common case: writer concatenates a new entry to the existing column
  IF OLD.resolution_notes IS NOT NULL
     AND NEW.resolution_notes IS NOT NULL
     AND NEW.resolution_notes LIKE OLD.resolution_notes || '%' THEN
    added_text := substring(NEW.resolution_notes FROM length(OLD.resolution_notes) + 1);
  ELSE
    added_text := COALESCE(NEW.resolution_notes, '');
  END IF;

  -- Parse every "[ISO-ts] text" pattern in the added portion → ticket_comments rows
  FOR m IN
    SELECT regexp_matches(added_text, '\[([^\]]+)\]\s*([^\n]+)', 'g')
  LOOP
    BEGIN
      parsed_ts := m[1]::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      parsed_ts := now();
    END;
    INSERT INTO public.ticket_comments (ticket_id, author, comment, created_at)
    VALUES (NEW.id, 'auto-extracted', m[2], parsed_ts);
  END LOOP;

  -- If the writer was using the log pattern, revert resolution_notes so the column doesn't grow.
  IF added_text ~ '\[[^\]]+\]\s*[^\n]+' THEN
    NEW.resolution_notes := OLD.resolution_notes;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_redirect_resolution_notes ON public.maintenance_tickets;
CREATE TRIGGER trg_redirect_resolution_notes
BEFORE UPDATE ON public.maintenance_tickets
FOR EACH ROW
WHEN (NEW.resolution_notes IS DISTINCT FROM OLD.resolution_notes)
EXECUTE FUNCTION public.redirect_resolution_notes_log_entries();

-- Backfill: parse every existing dirty resolution_notes on non-resolved tickets into ticket_comments,
-- then clear the column.
WITH parsed AS (
  SELECT t.id AS ticket_id,
         (regexp_matches(t.resolution_notes, '\[([^\]]+)\]\s*([^\n]+)', 'g')) AS m
  FROM public.maintenance_tickets t
  WHERE t.status NOT IN ('resolved','cancelled')
    AND t.resolution_notes IS NOT NULL
    AND t.resolution_notes ~ '\[[^\]]+\]\s*[^\n]+'
), to_insert AS (
  SELECT ticket_id, m[1] AS ts_str, m[2] AS comment_text FROM parsed
)
INSERT INTO public.ticket_comments (ticket_id, author, comment, created_at)
SELECT ticket_id, 'auto-extracted (backfill)', comment_text,
       CASE WHEN ts_str ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
            THEN ts_str::timestamptz ELSE now() END
FROM to_insert;

UPDATE public.maintenance_tickets
SET resolution_notes = NULL
WHERE status NOT IN ('resolved','cancelled')
  AND resolution_notes IS NOT NULL
  AND resolution_notes ~ '\[[^\]]+\]\s*[^\n]+';
