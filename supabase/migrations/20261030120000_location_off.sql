-- Qui est ou, bouton Location ON / OFF (30/10) : heure a laquelle une personne a
-- coupe elle-meme le partage (v3.stopLocation, qui efface aussi sa ligne de
-- team_locations). Effacee par le prochain v3.saveLocation accepte. Les managers
-- lisent « Location turned off at 14:02 » sur la carte (mgr.locations, offAt).
-- A appliquer AVANT de deployer le proxy qui lit la colonne.

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS location_off_at timestamptz;
