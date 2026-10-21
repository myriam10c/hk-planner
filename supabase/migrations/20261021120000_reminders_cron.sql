-- Relances automatiques (plan 2026-10-20-hk-reminders, T7) : un passage du moteur
-- toutes les 10 min (le planning des menages relit Hostaway a chaque passage, 5 min
-- serait inutilement charge). Les secrets sont lus dans Vault, jamais en clair ici.
-- Couper : interrupteur More > Reminders (rien ne part), ou SELECT cron.unschedule('hk-reminders').
SELECT cron.unschedule('hk-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hk-reminders');
SELECT cron.schedule('hk-reminders', '*/10 * * * *', $job$
  SELECT net.http_post(
    url := 'https://dqjnqvbxfwtvrjwnnmns.supabase.co/functions/v1/hostaway-proxy?action=rem.run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-App-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'hk_proxy_app_secret'),
      'X-Server-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'hk_proxy_server_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
