-- Fermeture des politiques « temp_permissive_all » (anon + authenticated, ALL, true)
-- demandee par Hillal le 21/10/2026. La cle publique est dans app.js : avec ces
-- politiques, n'importe qui pouvait lire, modifier ou effacer ces 13 tables. Toutes
-- les lectures et ecritures passent par les edge functions (cle secrete, hors RLS) ;
-- journaux edge du 19 au 21/10 : aucun acces par la cle publique. RLS reste activee,
-- sans politique = acces refuse a anon et authenticated.
-- Rouvrir une table : CREATE POLICY temp_permissive_all ON public.<t> FOR ALL
--   TO anon, authenticated USING (true) WITH CHECK (true);
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cleaning_timer','inventory_items','inventory_alerts','cleaning_issues','recurring_tasks',
    'vendors','equipment','maintenance_tickets','maintenance_costs','maintenance_sla','preventive_maintenance',
    'ticket_comments','app_config'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS temp_permissive_all ON public.%I', t);
  END LOOP;
END $$;
