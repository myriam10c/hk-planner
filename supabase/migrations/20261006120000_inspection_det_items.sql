-- Inspections : zone DET equipment, cles des equipements manquants (plan 2026-10-06-insp-det-equipment.md).
ALTER TABLE public.inspection_items ADD COLUMN IF NOT EXISTS missing_items text[] NOT NULL DEFAULT '{}';
