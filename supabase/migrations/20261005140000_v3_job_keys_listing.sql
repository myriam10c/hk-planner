-- HK Planner v3, branchement 2026-10-05 (tache 3, correctif 1) : logement du menage.
--
-- Les photos de reference d'une piece viennent du menage precedent du meme
-- logement. Ni la reservation_key (« <date>_<guest> ») ni v3_job_keys ne
-- portaient le logement : v3.myDay le pose desormais ici pour chaque arret
-- (ensureJobKeys), et complete les lignes existantes ou il est NULL.
-- Idempotent. Colonne nullable : les lignes d'avant restent valides.

ALTER TABLE public.v3_job_keys ADD COLUMN IF NOT EXISTS listing_id TEXT;

CREATE INDEX IF NOT EXISTS v3_job_keys_listing_idx ON public.v3_job_keys (listing_id);

COMMENT ON COLUMN public.v3_job_keys.listing_id IS
  'Logement Hostaway du menage, pose par v3.myDay. Sert a retrouver le menage precedent du logement (photos de reference).';
