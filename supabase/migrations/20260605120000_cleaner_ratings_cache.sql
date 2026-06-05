-- cleaner_ratings_cache : snapshot pré-calculé par le handler VPS sync_cleaner_ratings.
-- 1 row unique (id=1) contenant le payload JSONB {cleaners: {<cleaner_id>: {...}}}.
create table if not exists public.cleaner_ratings_cache (
  id            smallint primary key default 1,
  payload_json  jsonb   not null default '{}'::jsonb,
  cleaners_count integer not null default 0,
  unmatched_count integer not null default 0,
  computed_at   timestamptz not null default now(),
  synced_at     timestamptz not null default now(),
  constraint cleaner_ratings_cache_singleton check (id = 1)
);

alter table public.cleaner_ratings_cache enable row level security;
-- Pas de policy publique : accès uniquement via service_role (edge function proxy).
