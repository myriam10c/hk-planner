-- 2026-09-10 · chantier P2 n°14, Tache 5 reorientee apres la mesure J0.
--
-- Cible reelle, mesuree : 78.3 % du temps d'execution de la base sur 137 jours est de
-- la tenue de livres interne de pg_net et pg_cron, contre moins de 10 % pour toutes les
-- lectures PostgREST du front HK Planner reunies.
--   - net._http_response : 60 MB pour 35 lignes utiles, sans autovacuum depuis le
--     2026-08-05. Son ramasse-miettes est le premier consommateur de la base :
--     30 299 s cumulees, 41.8 % du total, 1 247 ms de moyenne par passage.
--     Un VACUUM (ANALYZE) manuel le 2026-09-10 a rendu 42 MB sur 60.
--   - cron.job_run_details : 52 243 lignes depuis le 2026-04-05, 19 MB, jamais purgee.
--     Trois ecritures par execution de job, 25 682 s cumulees.
--
-- Les tables applicatives proxy_cache (1376 kB, 125 lignes) et hermes_actions_cache
-- (grosse mais saine, 2.8 % de morts) ne sont PAS le probleme : l'advisor table_bloat
-- de Supabase ne signale qu'un seul objet sur toute la base, net._http_response.
--
-- NOTE : le bloc « ALTER TABLE net._http_response SET (autovacuum_*) » prevu par le plan
-- est ABSENT de cette migration. Releve du 2026-09-10 : la table appartient a
-- supabase_admin, le role courant est postgres, pg_has_role(..., 'MEMBER') = false.
-- Le role ne peut donc pas lui poser de reloptions. Le repli est la migration
-- 20260910111000_supabase_vacuum_net_http_response.sql (VACUUM quotidien par pg_cron).

-- 1. Retention du journal d'execution de pg_cron.
--    Idempotent : cron.unschedule leve si le nom n'existe pas, donc on le garde sous
--    condition d'existence. 06:30 UTC (10:30 Dubai) = pleine fenetre saine, la base
--    repond de 03:00 a 18:00 UTC.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-cron-job-run-details') then
    perform cron.unschedule('purge-cron-job-run-details');
  end if;
end
$$;

select cron.schedule(
  'purge-cron-job-run-details',
  '30 6 * * *',
  $job$delete from cron.job_run_details where start_time < now() - interval '7 days'$job$
);

-- 2. Index dupliques sur hermes_actions_cache (advisor duplicate_index, mesure-J0 §6).
--    Verifie le 2026-09-10 : hermes_actions_cache_ts_idx et idx_hermes_actions_cache_ts
--    ont un indexdef strictement identique au nom pres
--    (USING btree (ts DESC), pas de WHERE, pas de UNIQUE).
--    On garde le premier, on supprime le second. Sans CONCURRENTLY : une migration
--    s'execute dans une transaction et DROP INDEX CONCURRENTLY y est interdit. Le DROP
--    simple prend un verrou tres bref sur une table de 101 MB, et il est sans risque
--    ici puisque le jumeau reste en place : aucune requete ne perd son index.
drop index if exists public.idx_hermes_actions_cache_ts;

-- 3. Retention legere de monitoring_events. Conservee du plan initial, sans attente de
--    gain : la table fait 20 MB et 0 % de tuples morts apres le VACUUM du 2026-09-10.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-monitoring-events') then
    perform cron.unschedule('purge-monitoring-events');
  end if;
end
$$;

select cron.schedule(
  'purge-monitoring-events',
  '40 6 * * *',
  $job$delete from public.monitoring_events where task_dispatched = true and received_at < now() - interval '30 days'$job$
);
