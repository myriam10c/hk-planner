-- BEFORE-INSERT trigger on maintenance_tickets — neutralises the noisy
-- WhatsApp/Gemini classifier without having to find/redeploy that function.
-- Mirrors the redirect_resolution_notes_log_entries trigger pattern.
--
-- Rules (only when source='whatsapp_ops'):
--   1. completed/planned action  → status='cancelled', reason recorded
--   2. admin chatter             → status='cancelled', reason recorded
--   3. cleaning task             → status='cancelled', reason recorded
--      (unless the title also mentions damage/leak — real maintenance issue
--       that happens to mention cleaning)
--   4. priority='urgent' (the classifier's default for everything) gets
--      recomputed from content. Human-reported urgent tickets are unaffected
--      because they don't have source='whatsapp_ops'.
--
-- Reversal: DROP TRIGGER trg_filter_whatsapp_ops_noise; updates to existing
-- rows are not affected — only INSERTs.

CREATE OR REPLACE FUNCTION public.filter_whatsapp_ops_noise()
RETURNS TRIGGER AS $$
DECLARE
  blob TEXT;
BEGIN
  IF NEW.source IS DISTINCT FROM 'whatsapp_ops' THEN
    RETURN NEW;
  END IF;

  blob := COALESCE(NEW.title,'') || ' ' || COALESCE(NEW.description,'');

  IF blob ~* '\m(ordered|applied|done|fixed|resolved|completed|installed|replaced|paid|reimburs(ed|ement)|ongoing|underway|scheduled|booked)\M' THEN
    NEW.status := 'cancelled';
    NEW.resolution_notes := 'auto-filtered at insert (already completed/planned)';
    NEW.closed_at := now();
    RETURN NEW;
  END IF;

  IF blob ~* '\m(check[- ]?in|check[- ]?out|dtcm|renewal|nightly rate|review|guest arrival|early arrival|late checkout|extension|extra night)\M' THEN
    NEW.status := 'cancelled';
    NEW.resolution_notes := 'auto-filtered at insert (admin chatter, not a maintenance issue)';
    NEW.closed_at := now();
    RETURN NEW;
  END IF;

  IF blob ~* '\m(shampoo|deep clean|cleaning|stain|odou?r|smell)\M'
     AND blob !~* '\m(broken|damaged|leak|burst|fail)\M' THEN
    NEW.status := 'cancelled';
    NEW.resolution_notes := 'auto-filtered at insert (cleaning task — handled in cleaning workflow)';
    NEW.closed_at := now();
    RETURN NEW;
  END IF;

  IF NEW.priority = 'urgent' THEN
    NEW.priority := CASE
      WHEN blob ~* '\m(fire|smoke|gas leak|burst|flood|electrocut|locked out|cannot enter|no access|cockroach|bedbug|infestation)\M' THEN 'urgent'
      WHEN blob ~* '\m(leak|leakage|seepage|no power|no water|no electricity|no internet|wifi down|ac (not working|broken|fail)|fridge|water heater|lock (in)?active|door lock|access card|key)\M' THEN 'high'
      WHEN blob ~* '\m(damaged?|broken|crack|loose|stained?|inactive|fail|malfunction|wifi)\M' THEN 'medium'
      ELSE 'low'
    END;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_filter_whatsapp_ops_noise ON public.maintenance_tickets;
CREATE TRIGGER trg_filter_whatsapp_ops_noise
BEFORE INSERT ON public.maintenance_tickets
FOR EACH ROW
EXECUTE FUNCTION public.filter_whatsapp_ops_noise();
