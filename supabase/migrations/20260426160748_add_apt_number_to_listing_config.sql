-- Add apartment number columns to listing_config.
-- apt_number: short canonical apt label ("1503", "G8") shown in UI
-- internal_name: Hostaway's internalListingName, free-form, used as a parsing source.
--
-- Auto-extraction logic lives in hostaway-proxy (syncListings action) — see
-- extractAptNumber() in hostaway-proxy-patched.ts.
-- A manual override endpoint (action=setAptNumber) is also provided.

ALTER TABLE public.listing_config
  ADD COLUMN IF NOT EXISTS apt_number   TEXT,
  ADD COLUMN IF NOT EXISTS internal_name TEXT;

-- Backfill: extract apt numbers already embedded in listing_name where the
-- pattern is unambiguous ("1503 - Building", "G8 - Building").
UPDATE public.listing_config
SET apt_number = (regexp_match(listing_name, '^([0-9]{1,5})\s*[-|:,·]'))[1]
WHERE apt_number IS NULL
  AND listing_name ~ '^[0-9]{1,5}\s*[-|:,·]';

UPDATE public.listing_config
SET apt_number = (regexp_match(listing_name, '^([A-Za-z]\s*[0-9]{1,3})\b'))[1]
WHERE apt_number IS NULL
  AND listing_name ~ '^[A-Za-z]\s*[0-9]{1,3}\b';
