-- HK Planner v3, phase A : identifiant de menage oppose.
--
-- Pourquoi. Jusqu'ici l'identifiant de menage rendu a la cleaner etait la
-- reservation_key elle-meme, « <date>_<nom complet du guest> ». Le front de la
-- phase A l'ecrit dans le DOM et dans le hash de l'URL : le nom complet du guest
-- se serait retrouve dans la barre d'adresse et dans l'historique du telephone,
-- ce que le ruling 9 de la specification interdit (« aucun nom de guest complet
-- cote cleaner »). Cette table porte la correspondance dans un seul sens utile :
-- le proxy rend un id opaque, et lui seul sait a quelle reservation il renvoie.
--
-- Forme de l'id : « job_ » + les 20 premiers caracteres hexadecimaux du SHA-256
-- de la reservation_key (voir jobKeyFor dans v3_idem.ts). Deterministe, donc la
-- meme reservation rend toujours le meme id : la file hors ligne du telephone
-- peut rejouer un geste pose avant un rechargement de l'ecran.
--
-- Introspection prealable du 2026-09-12 (lecture seule, aucune donnee modifiee) :
--   - aucune table public.v3_job_keys n'existe ;
--   - reservation_key est bien le nom de la colonne de cleaning_timer,
--     checklist_progress, cleaning_log, cleaning_postponed et extra_cleanings,
--     toutes en TEXT (sauf les dates) : aucun nom de colonne a adapter.
--
-- RLS activee sans aucune policy, comme les trois tables de 20260912090000 :
-- seul le service_role de l'edge function lit et ecrit, un client anon est
-- bloque. La table ne doit jamais etre lisible par le navigateur, sinon l'id
-- opaque redeviendrait un nom de guest en une requete.

CREATE TABLE IF NOT EXISTS public.v3_job_keys (
  job_id          TEXT PRIMARY KEY,
  reservation_key TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.v3_job_keys ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.v3_job_keys IS
  'v3 : correspondance id de menage oppose (sans donnee guest) vers la reservation_key Hostaway. Ecrit par myDay, lu par les actions d ecriture v3.';
COMMENT ON COLUMN public.v3_job_keys.job_id IS
  'job_ + 20 hex du SHA-256 de reservation_key. Le seul identifiant de menage qui quitte le proxy.';
COMMENT ON COLUMN public.v3_job_keys.reservation_key IS
  'Cle interne <date>_<guest> ou extra_<date>_<suffixe>. Ne sort jamais vers un client cleaner.';
