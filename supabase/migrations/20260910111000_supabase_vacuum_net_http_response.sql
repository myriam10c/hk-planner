-- 2026-09-10 · repli quand le role courant n'est pas proprietaire de net._http_response
-- et ne peut donc pas lui poser de reloptions d'autovacuum. Un VACUUM quotidien en
-- journee remplace le reglage : il ne prend aucun verrou exclusif et il a rendu 42 MB
-- sur 60 lors du passage manuel du 2026-09-10.
-- pg_cron execute chaque job dans sa propre session, donc VACUUM y est autorise, alors
-- qu'il est interdit dans le corps transactionnel d'une migration.
--
-- Releve du 2026-09-10 qui justifie cette branche et prouve qu'elle fonctionne :
--   proprietaire = supabase_admin, role courant = postgres,
--   pg_has_role(postgres, supabase_admin, 'MEMBER') = false  -> ALTER TABLE impossible,
--   has_table_privilege(postgres, 'net._http_response', 'MAINTAIN') = true (PG 17)
--     -> VACUUM autorise malgre l'absence de propriete,
--   pg_stat_all_tables.last_vacuum = 2026-09-10 06:06:44 UTC (le VACUUM manuel a bien
--     pris effet, 60 MB -> 18 MB).
-- Le job est cree par le role postgres, il s'executera donc avec ce meme role.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'vacuum-net-http-response') then
    perform cron.unschedule('vacuum-net-http-response');
  end if;
end
$$;

select cron.schedule(
  'vacuum-net-http-response',
  '50 6 * * *',
  $job$vacuum (analyze) net._http_response$job$
);
