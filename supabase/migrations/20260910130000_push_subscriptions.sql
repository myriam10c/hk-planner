-- Web Push (RFC 8291) pour HK Planner : un abonnement par (utilisateur, navigateur).
-- L'endpoint est l'identité unique d'un abonnement côté push service ; il peut
-- tourner (réinstallation de la PWA, rotation du push service), d'où l'upsert
-- sur endpoint côté proxy plutôt qu'un couple (cleaner_id, device).
--
-- RLS activée sans aucune policy : comme team_tasks, seul le service_role de
-- l'edge function lit et écrit. Un client anon est bloqué.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id               BIGSERIAL PRIMARY KEY,
  cleaner_id       INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  endpoint         TEXT NOT NULL UNIQUE,
  p256dh           TEXT NOT NULL,
  auth             TEXT NOT NULL,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at  TIMESTAMPTZ,
  last_error       TEXT,
  disabled_at      TIMESTAMPTZ
);

-- Chemin chaud : « tous les abonnements vivants de ce cleaner ».
CREATE INDEX IF NOT EXISTS push_subscriptions_cleaner_live_idx
  ON public.push_subscriptions (cleaner_id) WHERE disabled_at IS NULL;

COMMENT ON TABLE public.push_subscriptions IS
  'Abonnements Web Push par utilisateur PIN. Ecrit par hostaway-proxy (service_role) uniquement.';
COMMENT ON COLUMN public.push_subscriptions.disabled_at IS
  'Non NULL = endpoint mort (404/410 du push service) ; plus jamais reessaye.';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Anti-doublon : une meme notification (meme tag logique) ne part qu'une fois
-- par fenetre courte, meme si deux ecritures declenchent notifyAssignee.
CREATE TABLE IF NOT EXISTS public.push_dedupe (
  dedupe_key  TEXT PRIMARY KEY,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.push_dedupe IS
  'Garde anti-doublon des envois push. Cle = "<scope>:<id>:<cleaner_id>".';

ALTER TABLE public.push_dedupe ENABLE ROW LEVEL SECURITY;

-- Purge de push_dedupe : une ligne par notification envoyee, plus aucune utilite
-- passe la fenetre anti-doublon. Job pg_cron idempotent, meme motif que
-- 20260910112000_supabase_cron_night_spacing.sql (unschedule par jobname puis
-- schedule, jamais de jobid en dur). 06:50 UTC = 10:50 Dubai, heure creuse de jour :
-- hors de la fenetre de reprise de l'instance et hors de la nuit Dubai.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-push-dedupe') then
    perform cron.unschedule('purge-push-dedupe');
  end if;
end
$$;

select cron.schedule(
  'purge-push-dedupe',
  '50 6 * * *',
  $job$
  DELETE FROM public.push_dedupe WHERE sent_at < now() - interval '7 days';
  $job$
);
