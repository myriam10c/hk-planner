-- Qui est ou, choix par personne (plan 2026-10-29, suite) : share_location = false
-- coupe le partage de position d'une personne. Le proxy n'ecrit plus sa position
-- (v3.saveLocation rend saved:false, reason:"not_shared"), mgr.locations et
-- mgr.today ne la montrent plus, et les deux apps n'affichent ni l'avertissement
-- ni la ligne Profile / carte Settings.
-- Hillal (6), Walter (8), Harlene (9) et le compte AI Assistant (17) ne partagent pas.
-- A appliquer AVANT de deployer le proxy qui lit la colonne.

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS share_location boolean NOT NULL DEFAULT true;

UPDATE public.cleaners SET share_location = false WHERE id IN (6, 8, 9, 17);

DELETE FROM public.team_locations WHERE cleaner_id IN (6, 8, 9, 17);
