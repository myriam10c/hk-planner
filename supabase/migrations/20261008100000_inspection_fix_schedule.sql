-- Inspections : date de rectification programmee pour une zone envoyee en maintenance (facultative).
-- Jour Dubai (date sans fuseau) + creneau libre court (ex. "morning", "2 pm"). Additif uniquement.
ALTER TABLE public.inspection_items ADD COLUMN IF NOT EXISTS fix_scheduled_for date;
ALTER TABLE public.inspection_items ADD COLUMN IF NOT EXISTS fix_scheduled_slot text;
