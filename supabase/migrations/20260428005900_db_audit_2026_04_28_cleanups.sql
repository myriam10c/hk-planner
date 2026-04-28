-- DB-auditor pass 2026-04-28 (HK Planner)
-- 5 findings fixed in one transaction. See chat audit report for details.

-- 1) CRITICAL: enable RLS on maintenance_followups (was anon-readable).
--    No policy defined = anon blocked; edge functions use service_role and bypass RLS.
ALTER TABLE public.maintenance_followups ENABLE ROW LEVEL SECURITY;

-- 2) Reassign 17 stale cleaning_assignments from inactive Hillal duplicates (ids 1,2,3) to the
--    real active Hillal manager record (id 6). Preserves assignment history.
UPDATE public.cleaning_assignments
SET cleaner_id = 6
WHERE cleaner_id IN (1, 2, 3);

-- 3) Now that no FKs reference them, drop the 3 duplicate inactive cleaner rows.
DELETE FROM public.cleaners
WHERE id IN (1, 2, 3) AND is_active = false;

-- 4) Drop the two zero-duration timers (Apr 7 / Apr 8) that skew avg-time KPIs.
DELETE FROM public.cleaning_timer
WHERE duration_minutes = 0;

-- 5) Create the missing property_profiles table the proxy already references.
--    Frontend `savePropertyProfile` was failing silently; getAllData was returning {} for it.
CREATE TABLE IF NOT EXISTS public.property_profiles (
  listing_id            TEXT PRIMARY KEY,
  listing_name          TEXT,
  access_code           TEXT,
  wifi_name             TEXT,
  wifi_password         TEXT,
  special_instructions  TEXT,
  contact_name          TEXT,
  contact_phone         TEXT,
  parking_info          TEXT,
  trash_instructions    TEXT,
  checkout_instructions TEXT,
  notes                 TEXT,
  updated_at            TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.property_profiles ENABLE ROW LEVEL SECURITY;
-- No policies = anon blocked; edge function uses service_role and works.
