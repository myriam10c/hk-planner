-- Qui est ou (plan docs/superpowers/plans/2026-10-29-team-locations.md, tache 1).
-- Coordonnees des logements, remplies par syncListings depuis Hostaway (lat/lng).
ALTER TABLE public.listing_config ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.listing_config ADD COLUMN IF NOT EXISTS lng double precision;

-- Derniere position connue de chaque membre, une ligne par personne, pas d'historique.
-- Ecrite par v3.saveLocation (identite de la session), lue par mgr.locations et mgr.today.
-- RLS activee sans politique : seul le service role de hostaway-proxy lit et ecrit.
CREATE TABLE IF NOT EXISTS public.team_locations (
  cleaner_id integer PRIMARY KEY REFERENCES public.cleaners(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m real,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_locations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.team_locations IS
  'Derniere position de chaque membre (app ouverte, 07:00-23:00 Dubai). Une ligne par personne, pas d''historique.';
