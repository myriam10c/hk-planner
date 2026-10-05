-- HK Planner v3, branchement 2026-10-05 (tache 3, correctif 1) : photo d'annonce.
--
-- Premiere image de l'annonce Hostaway (listingImages[0].url, https seulement),
-- ecrite par syncListings depuis les donnees /listings qu'il lit deja : aucun
-- appel Hostaway supplementaire. Lue par v3.myDay (heroPhotoUrl de chaque arret).
-- Idempotent. Colonne nullable : NULL tant que le prochain syncListings n'a pas tourne.

ALTER TABLE public.listing_config ADD COLUMN IF NOT EXISTS hero_photo_url TEXT;

COMMENT ON COLUMN public.listing_config.hero_photo_url IS
  'Premiere image Hostaway de l''annonce (https), ecrite par syncListings. Lue par v3.myDay.';
