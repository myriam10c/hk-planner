-- 2026-09-10 · meme motif que la tache 6 pour les pollers VPS : la base n'a plus de
-- calcul de 18:00 a 03:00 UTC, on cesse de la solliciter pendant cette fenetre au meme
-- rythme que le jour. Ruling du controleur du 2026-09-10, applique job par job.
--
-- Rappel de la mesure J0 : chaque execution de job coute un aller-retour HTTP, une ligne
-- dans net._http_response (dont le ramasse-miettes est le 1er consommateur de la base,
-- 41.8 % du temps d'execution) et trois ecritures dans cron.job_run_details.
--
--  * job medini-bot-scan (*/5 * * * *, 288 appels/jour) : scan du bot de trading PAPIER
--    (aucun argent reel, deja double par medini-bot.service --mode paper sur le VPS).
--    La strategie travaille en bougies de 4 h : une evaluation toutes les 5 min n'a aucun
--    sens. Un seul job horaire jour et nuit, 288 -> 24 appels/jour. PAS de suppression
--    (ruling explicite). Seul le schedule change, donc cron.alter_job : le texte de la
--    commande est preserve octet pour octet.
--  * job monitoring-checkin-scan (*/30 * * * *) : travail metier reel, dedouble en un job
--    de jour et un job de nuit. Ici la commande doit etre recopiee, elle l'a ete depuis
--    le releve integral de cron.job du 2026-09-10 (aucun secret n'y figure).
--  * job auto-cancel-stale-tickets (30 3 * * *) : tombait a 03:30 UTC, en pleine fenetre
--    de reprise de l'instance. Decale a 05:30 UTC. Schedule seul -> cron.alter_job.
--  * jobs monitoring-heartbeat et monitoring-weekly-patterns : inactifs, non touches.
--
-- Les jobid ne sont jamais ecrits en dur : ils sont resolus par jobname.

-- 1. medini-bot-scan : */5 24h/24 -> 7 * * * * (horaire, jour et nuit).
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'medini-bot-scan';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, schedule => '7 * * * *');
  end if;
end
$$;

-- 2. auto-cancel-stale-tickets : 03:30 UTC -> 05:30 UTC.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'auto-cancel-stale-tickets';
  if v_jobid is not null then
    perform cron.alter_job(v_jobid, schedule => '30 5 * * *');
  end if;
end
$$;

-- 3. monitoring-checkin-scan : dedouble en jour et nuit, noms distincts.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'monitoring-checkin-scan') then
    perform cron.unschedule('monitoring-checkin-scan');
  end if;
  if exists (select 1 from cron.job where jobname = 'monitoring-checkin-scan-jour') then
    perform cron.unschedule('monitoring-checkin-scan-jour');
  end if;
  if exists (select 1 from cron.job where jobname = 'monitoring-checkin-scan-nuit') then
    perform cron.unschedule('monitoring-checkin-scan-nuit');
  end if;
end
$$;

select cron.schedule(
  'monitoring-checkin-scan-jour',
  '*/30 3-17 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/monitoring-checkin-scanner',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $job$
);

select cron.schedule(
  'monitoring-checkin-scan-nuit',
  '0 18-23,0-2 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/monitoring-checkin-scanner',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $job$
);
