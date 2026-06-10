-- Rate-limiting login persistant et GLOBAL pour cleanerLogin.
-- L'ancien limiteur comptait les échecs par ip_hash, mais l'IP venait d'en-têtes
-- falsifiables (x-forwarded-for & co) : un attaquant pouvait tourner les headers
-- et brute-forcer les PINs. Nouveau modèle : seuil global (toutes IPs confondues,
-- la base utilisateurs = ~5 personnes) sur les échecs des 15 dernières minutes,
-- et on stocke un hash SHA-256 du PIN tenté (jamais le PIN en clair) pour le debug.
--
-- NB : la table login_attempts existe déjà en prod (créée en phase_1, non versionnée
-- ici, avec une colonne ip_hash) — tout est donc en IF NOT EXISTS / défensif.

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id BIGSERIAL PRIMARY KEY,
  pin_hash TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  success BOOLEAN NOT NULL DEFAULT false
);

-- Si la table pré-existe (schéma phase_1) : ajouter la nouvelle colonne de keying.
ALTER TABLE public.login_attempts ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- L'ancienne colonne ip_hash n'est plus alimentée par l'edge function — on la
-- supprime (l'historique est purgé sous 24h de toute façon).
ALTER TABLE public.login_attempts DROP COLUMN IF EXISTS ip_hash;

-- RLS activé sans aucune policy : seul le service role (qui bypass RLS) y accède.
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Le limiteur filtre sur attempted_at (fenêtre 15 min) + la purge 24h.
CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON public.login_attempts (attempted_at);

COMMENT ON TABLE public.login_attempts IS
  'Tentatives de login PIN (edge function cleanerLogin). pin_hash = SHA-256 du PIN tenté, jamais le PIN en clair. Purge opportuniste >24h à chaque login.';
