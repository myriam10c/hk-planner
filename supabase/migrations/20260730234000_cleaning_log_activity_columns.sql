-- cleaning_log : alignement du schéma sur ce que le code écrit et lit depuis toujours.
--
-- La table avait été créée comme un journal de ménages terminés (cleaner_id,
-- listing_name, checkout_date, completed_at, duration_minutes), mais addLog()
-- insère depuis le début un événement générique {reservation_key, action, actor,
-- details} et getLogs() / l'écran History lisent cette forme-là. Les colonnes
-- action/actor/details n'existaient pas, chaque insert échouait en 42703, et
-- l'erreur n'était jamais lue : la table est restée vide (0 ligne) depuis sa
-- création. L'historique passé est perdu, il n'y a rien à rattraper.
--
-- checkout_date était NOT NULL sans défaut : sans ce DROP NOT NULL les inserts
-- continueraient d'échouer même avec les nouvelles colonnes. Les colonnes de
-- l'ancien modèle sont conservées, aucune donnée ne les remplit.

ALTER TABLE public.cleaning_log
  ADD COLUMN IF NOT EXISTS action  TEXT,
  ADD COLUMN IF NOT EXISTS actor   TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.cleaning_log
  ALTER COLUMN checkout_date DROP NOT NULL;

-- getLogs() filtre sur reservation_key puis trie par created_at DESC.
CREATE INDEX IF NOT EXISTS idx_cleaning_log_key_created
  ON public.cleaning_log (reservation_key, created_at DESC);

COMMENT ON COLUMN public.cleaning_log.action IS
  'Type d''événement écrit par addLog() : marked_done, assigned, timer_stopped, laundry_counted, ticket_created, etc.';
COMMENT ON COLUMN public.cleaning_log.actor IS
  'Nom de la cleaner ou du manager à l''origine de l''action, null si déclenché par le système.';
COMMENT ON COLUMN public.cleaning_log.details IS
  'Charge utile libre de l''événement (durée, cleaner_ids, quantités de linge…).';
