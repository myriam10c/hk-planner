-- Catch the "1234A" pattern (digits + optional suffix letter + separator) that the original
-- regex missed. Examples: "2410B - Bloom Height", "705a · 15th Northside".
-- Proxy `extractAptNumber()` was updated in tandem so future syncs handle this format.

UPDATE public.listing_config
SET apt_number = (regexp_match(internal_name, '^([0-9]{1,5}[A-Za-z]?)\s*[-|:,·]'))[1]
WHERE apt_number IS NULL
  AND internal_name IS NOT NULL
  AND internal_name ~ '^[0-9]{1,5}[A-Za-z]?\s*[-|:,·]';
