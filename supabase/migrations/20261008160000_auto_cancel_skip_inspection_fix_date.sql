-- auto_cancel_stale_tickets : ne plus annuler un ticket d'inspection dont la date de rectification
-- programmee (inspection_items.fix_scheduled_for, lie par source_ref 'inspection:<id>:<zone>') est
-- aujourd'hui ou plus tard (jour Dubai). Une fois la date passee, la regle des 30 jours reprend.
-- Base : la definition EN PROD au 08/10/2026 (pg_get_functiondef), reprise a l'identique hors la clause
-- ajoutee, y compris « RETURNING t.id INTO n » (qui fait echouer le job des que plus d'une ligne
-- est annulee : comportement existant, volontairement non modifie ici).
CREATE OR REPLACE FUNCTION public.auto_cancel_stale_tickets()
 RETURNS TABLE(cancelled_count integer)
 LANGUAGE plpgsql
AS $function$
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
      AND NOT (
        maintenance_tickets.source = 'inspection'
        AND EXISTS (
          SELECT 1 FROM public.inspection_items ii
          WHERE maintenance_tickets.source_ref = 'inspection:' || ii.inspection_id || ':' || ii.zone
            AND ii.fix_scheduled_for >= (now() AT TIME ZONE 'Asia/Dubai')::date
        )
      )
  )
  UPDATE public.maintenance_tickets t
  SET status = 'cancelled',
      resolution_notes = COALESCE(t.resolution_notes,'') ||
        CASE WHEN t.resolution_notes IS NULL OR t.resolution_notes='' THEN '' ELSE E'\n' END ||
        'auto-cancelled (stale: no activity for 30+ days)',
      closed_at = now()
  FROM stale s
  WHERE t.id = s.id
  RETURNING t.id INTO n;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n;
END;
$function$;
