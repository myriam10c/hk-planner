-- Daily cron: auto-cancel low-priority maintenance tickets that have had no
-- activity for 30+ days. Keeps the Open queue honest — items that nobody's
-- working on AND nobody's commented on for a month are almost certainly junk.
--
-- Rules:
--   - Only acts on status open / assigned (in_progress / waiting_parts is exempt
--     because someone's actively working it)
--   - Priority must be low or medium (urgent + high are never auto-cancelled)
--   - No new comments in the last 30 days (last_update column would be a fallback
--     but ticket_comments freshness is the better signal)
--   - Records the reason in resolution_notes for audit
--
-- Schedule: 03:30 UTC daily (= 07:30 Dubai). One-shot per ticket — once cancelled
-- it stays cancelled unless someone reopens.

CREATE OR REPLACE FUNCTION public.auto_cancel_stale_tickets()
RETURNS TABLE(cancelled_count int) AS $$
DECLARE
  n int;
BEGIN
  WITH stale AS (
    SELECT id FROM public.maintenance_tickets
    WHERE status IN ('open','assigned')
      AND priority IN ('low','medium')
      AND COALESCE(last_update, created_at) < now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.ticket_comments c
        WHERE c.ticket_id = maintenance_tickets.id
          AND c.created_at > now() - interval '30 days'
      )
  )
  UPDATE public.maintenance_tickets t
  SET status = 'cancelled',
      resolution_notes = COALESCE(t.resolution_notes,'') ||
        CASE WHEN t.resolution_notes IS NULL OR t.resolution_notes='' THEN '' ELSE E'\n' END ||
        'auto-cancelled (stale: no activity for 30+ days)',
      closed_at = now()
  FROM stale s
  WHERE t.id = s.id;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  PERFORM cron.unschedule('auto-cancel-stale-tickets');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'auto-cancel-stale-tickets',
  '30 3 * * *',
  $$ SELECT public.auto_cancel_stale_tickets(); $$
);
