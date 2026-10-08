-- Décision Hillal (08/10/2026) : un ticket maintenance n'est JAMAIS annulé automatiquement,
-- même après sa date de rectification. Le job cron est désactivé (pas supprimé, fonction conservée).
-- Le job échouait déjà tous les jours en prod (RETURNING ... INTO n sur plusieurs lignes).
SELECT cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname = 'auto-cancel-stale-tickets';
