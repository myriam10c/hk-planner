-- Always-dispute workflow: store the policy angle (was discarded) and an English
-- translation of every review so Walter gets an angle + readable text on each one.
alter table public.review_disputes
  add column if not exists angle            text,
  add column if not exists public_review_en text;
