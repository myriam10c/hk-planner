-- Maintenance repensee, phase 5 (spec 2026-10-12 section 9) : remise a zero.
-- Tout est copie dans les tables archive_* puis efface de l'app. On garde les
-- tickets d'inspection d'octobre 2026 (11 au 13/10/2026) et tout ce qui les
-- concerne. Appliquee par le MCP Supabase (apply_migration), qui execute tout
-- dans une seule transaction : si une etape echoue, rien n'est efface.

CREATE TABLE IF NOT EXISTS public.archive_maintenance_followups (LIKE public.maintenance_followups INCLUDING DEFAULTS);
ALTER TABLE public.archive_maintenance_followups ADD COLUMN IF NOT EXISTS archived_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.archive_maintenance_followups ENABLE ROW LEVEL SECURITY;

-- Rien ne s'ecrit entre l'archive et l'effacement.
LOCK TABLE public.maintenance_tickets, public.ticket_comments, public.maintenance_costs,
  public.photos, public.maintenance_followups, public.team_tasks
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE reset_tickets ON COMMIT DROP AS
  SELECT id FROM public.maintenance_tickets
  WHERE NOT (source = 'inspection' AND created_at >= '2026-10-01')
    -- Tickets crees depuis la mise en route du nouvel ecran (13/10/2026) : gardes.
    AND created_at < '2026-10-13';

CREATE TEMP TABLE reset_tasks ON COMMIT DROP AS
  SELECT id FROM public.team_tasks
  WHERE source_ref LIKE 'maint:%' OR (source_ref IS NULL AND created_at < '2026-07-01');

-- Garde : aucun element d'inspection ne doit pointer vers un ticket efface.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.inspection_items WHERE ticket_id IN (SELECT id FROM reset_tickets)) THEN
    RAISE EXCEPTION 'inspection_items reference a ticket to delete';
  END IF;
END $$;

-- 1. Archive (copie integrale, colonnes par nom).
INSERT INTO public.archive_maintenance_tickets SELECT t.*, now() FROM public.maintenance_tickets t WHERE t.id IN (SELECT id FROM reset_tickets);
INSERT INTO public.archive_ticket_comments SELECT c.*, now() FROM public.ticket_comments c WHERE c.ticket_id IN (SELECT id FROM reset_tickets);
INSERT INTO public.archive_maintenance_costs SELECT c.*, now() FROM public.maintenance_costs c WHERE c.ticket_id IN (SELECT id FROM reset_tickets);
INSERT INTO public.archive_ticket_photos SELECT p.*, now() FROM public.photos p WHERE p.ticket_id IN (SELECT id FROM reset_tickets);
INSERT INTO public.archive_maintenance_followups SELECT f.*, now() FROM public.maintenance_followups f WHERE f.ticket_id IN (SELECT id FROM reset_tickets);
INSERT INTO public.archive_team_tasks SELECT t.*, now() FROM public.team_tasks t WHERE t.id IN (SELECT id FROM reset_tasks);

-- 2. Effacement (enfants d'abord ; team_task_comments et followups suivent en cascade).
DELETE FROM public.ticket_comments WHERE ticket_id IN (SELECT id FROM reset_tickets);
DELETE FROM public.maintenance_costs WHERE ticket_id IN (SELECT id FROM reset_tickets);
DELETE FROM public.photos WHERE ticket_id IN (SELECT id FROM reset_tickets);
DELETE FROM public.maintenance_tickets WHERE id IN (SELECT id FROM reset_tickets);
DELETE FROM public.team_tasks WHERE id IN (SELECT id FROM reset_tasks);

-- Garde finale : comptes attendus le 13/10/2026, sinon tout est annule.
DO $$
BEGIN
  IF (SELECT count(*) FROM public.maintenance_tickets WHERE created_at < '2026-10-13') <> 11
     OR (SELECT count(*) FROM public.archive_maintenance_tickets) <> 406
     OR (SELECT count(*) FROM public.archive_maintenance_followups) <> 3188
     OR (SELECT count(*) FROM public.archive_team_tasks) <> 231 THEN
    RAISE EXCEPTION 'reset counts mismatch';
  END IF;
END $$;
