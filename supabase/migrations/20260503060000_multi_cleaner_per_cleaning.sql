-- Multi-cleaner-per-cleaning: drop the per-key UNIQUE so a single cleaning can
-- have multiple cleaners (team work, training pairs, hand-offs).
--
-- Was: UNIQUE (reservation_key)             — 1 row per cleaning, 1 cleaner only.
-- Now: UNIQUE (reservation_key, cleaner_id) — 1 row per (cleaning, cleaner) pair.
-- The same cleaner still can't be added to the same cleaning twice (that's the
-- new unique constraint), but multiple distinct cleaners can be co-assigned.
--
-- Frontend `assignments[reservation_key]` is now `number[]` (array of cleaner ids).
-- Proxy `getAssignments` and `getAllData` emit the array shape.
-- `assignCleaner` action accepts modes: set / add / remove / clear.

ALTER TABLE public.cleaning_assignments
  DROP CONSTRAINT IF EXISTS cleaning_assignments_reservation_key_key;

ALTER TABLE public.cleaning_assignments
  ADD CONSTRAINT cleaning_assignments_reservation_cleaner_unique
    UNIQUE (reservation_key, cleaner_id);

-- Backstop index for per-cleaning lookups (already covered by the unique
-- index, but make it explicit so future query planners see it clearly).
CREATE INDEX IF NOT EXISTS idx_cleaning_assignments_reservation_key
  ON public.cleaning_assignments (reservation_key);
