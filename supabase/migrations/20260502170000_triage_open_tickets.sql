-- Triage 62 open whatsapp_ops-sourced tickets that had accumulated since 2026-04-28.
-- Audit before:  62 open · 57 urgent · 51 general (Gemini classifier defaults swamping the queue)
-- Audit after:   45 open · 1 urgent / 8 high / 15 medium / 21 low
--
-- 17 cancelled (resolution_notes records the reason for audit):
--   8  completed_or_planned   — already done / ordered / scheduled
--   7  cleaning_task          — cleaning workflow, not maintenance
--   2  admin_chatter          — guest check-in time / mattress on next checkout
--
-- Step 1: cancel the noise

WITH classified AS (
  SELECT id,
    CASE
      WHEN (title || ' ' || COALESCE(description,'')) ~* '\m(ordered|applied|done|fixed|resolved|completed|installed|replaced|paid|reimburs(ed|ement)|ongoing|underway|scheduled|booked)\M'
        THEN 'auto-cancelled (already completed/planned)'
      WHEN (title || ' ' || COALESCE(description,'')) ~* '\m(check[- ]?in|check[- ]?out|dtcm|renewal|nightly rate|review|guest arrival|early arrival|late checkout|extension|extra night)\M'
        THEN 'auto-cancelled (admin chatter, not a maintenance issue)'
      WHEN (title || ' ' || COALESCE(description,'')) ~* '\m(shampoo|deep clean|cleaning|stain|odou?r|smell)\M'
        AND NOT (title || ' ' || COALESCE(description,'')) ~* '\m(broken|damaged|leak|burst|fail)\M'
        THEN 'auto-cancelled (cleaning task — handled in cleaning workflow)'
    END AS cancel_reason
  FROM public.maintenance_tickets
  WHERE status NOT IN ('resolved','cancelled')
)
UPDATE public.maintenance_tickets t
SET status = 'cancelled',
    resolution_notes = c.cancel_reason,
    closed_at = now()
FROM classified c
WHERE t.id = c.id
  AND c.cancel_reason IS NOT NULL;

-- Step 2: re-prioritise the remaining 45 open tickets from content. The classifier
-- defaults everything to "urgent" so the Urgent stat card meant nothing.

UPDATE public.maintenance_tickets
SET priority = CASE
    WHEN (title || ' ' || COALESCE(description,'')) ~* '\m(fire|smoke|gas leak|burst|flood|electrocut|locked out|cannot enter|no access|cockroach|bedbug|infestation)\M' THEN 'urgent'
    WHEN (title || ' ' || COALESCE(description,'')) ~* '\m(leak|leakage|seepage|no power|no water|no electricity|no internet|wifi down|ac (not working|broken|fail)|fridge|water heater|lock (in)?active|door lock|access card|key)\M' THEN 'high'
    WHEN (title || ' ' || COALESCE(description,'')) ~* '\m(damaged?|broken|crack|loose|stained?|inactive|fail|malfunction|wifi)\M' THEN 'medium'
    ELSE 'low'
  END
WHERE status NOT IN ('resolved','cancelled');
