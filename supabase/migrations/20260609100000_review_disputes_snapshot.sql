-- Snapshot columns so the Reviews tab can render every analyzed dispute
-- (review_disputes covers ~180 days), independent of reviews_cache (~30 days).
alter table public.review_disputes
  add column if not exists listing_name  text,
  add column if not exists reviewer_name text,
  add column if not exists rating        numeric,
  add column if not exists public_review text,
  add column if not exists submitted_at  timestamptz;
