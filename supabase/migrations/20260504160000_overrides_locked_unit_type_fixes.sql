-- Add a per-row "manual override" flag to listing_config. When true, syncListings
-- will skip updating bedrooms / unit_type / listing_name from Hostaway for that row.
-- Lets us correct Hostaway data inconsistencies (e.g. listing tagged "studio" but
-- bedrooms=1 and listing_name says "1 bedroom") and have the fix stick across syncs.
--
-- The proxy syncListings handler (hostaway-proxy-patched.ts) reads this flag and,
-- when locked, only refreshes apt_number / internal_name / updated_at — no other
-- columns get touched.

ALTER TABLE public.listing_config
  ADD COLUMN IF NOT EXISTS overrides_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- 623 Samana Park View — user-reported. Hostaway: bedrooms=1 + unit_type=studio.
-- listing_name says "Private Pool - One bedroom". Fix unit_type to match.
UPDATE public.listing_config
SET unit_type='1 BHK', overrides_locked=true
WHERE listing_id='397093';

-- bedrooms+listing_name agree on 1 BR; unit_type wrong/null
UPDATE public.listing_config SET unit_type='1 BHK', overrides_locked=true WHERE listing_id IN (
  '511475',  -- 1511 Zada Tower — "1BR · Gym, Sauna" (unit_type was null)
  '511476',  -- 1701 Zada Tower — "1BR · Gym, Sauna & Hammam" (unit_type was null)
  '275431'   -- 204 Azizi Riviera 10 — "1 bedroom - 12 min from downtown"
);

-- 418 Elysée 1 — listing_name "Nice and cozy 1 Bedroom"; Hostaway has bedrooms=2
-- (likely counts a maid room). Fix bedrooms to 1 and unit_type to 1 BHK.
UPDATE public.listing_config
SET bedrooms=1, unit_type='1 BHK', overrides_locked=true
WHERE listing_id='118945';

-- 11 listings where listing_name + unit_type both say Studio, but Hostaway
-- bedroomsNumber=1. Reset bedrooms to 0 so any pricing/grouping logic that
-- falls back to bedrooms is consistent with the Studio classification.
UPDATE public.listing_config
SET bedrooms=0, overrides_locked=true
WHERE listing_id IN (
  '180198', -- 1604 — "Studio in heart of Dubai"
  '275563', -- 1617 — "Studio - Miraclz Tower"
  '133468', -- 1913a — "Nice Studio in JVC"
  '171299', -- 2201A — "Cozy studio @ bloom height"
  '276343', -- 2503 — "Nice studio in JVT"
  '228673', -- 431 — "Studio 12min from Burj Khalifa"
  '218690', -- 507 — "Nice Studio in Azizi Riviera 32"
  '457550', -- 622 — "12 min from downtown - Studio"
  '274872', -- 623 (Azizi Riviera 20) — "Studio - 12 min downtown - Pool"
  '179761', -- 707A — "Studio in JVC"
  '147828'  -- G11 — "Nice and cozy Studio in JVC"
);
