-- Relances automatiques par push (plan docs/superpowers/plans/2026-10-20-hk-reminders.md).
-- Journal de chaque relance : une ligne par destinataire. Ecrit par hostaway-proxy
-- (service_role) uniquement ; read_at pose par rem.read au clic sur la notification.
CREATE TABLE IF NOT EXISTS public.reminder_log (
  id bigserial PRIMARY KEY,
  rule text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('ticket', 'proposal', 'cleaning')),
  subject_id text NOT NULL,
  subject_ref text,
  cleaner_id integer,
  title text NOT NULL,
  body text NOT NULL,
  urgent boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('sent', 'no_subscription', 'quiet', 'capped', 'duplicate', 'error')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  read_token text
);
CREATE INDEX IF NOT EXISTS reminder_log_subject_idx ON public.reminder_log (subject_kind, subject_id, sent_at);
CREATE INDEX IF NOT EXISTS reminder_log_cleaner_idx ON public.reminder_log (cleaner_id, sent_at);
CREATE INDEX IF NOT EXISTS reminder_log_sent_idx ON public.reminder_log (sent_at);
ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.reminder_log IS
  'Journal des relances push automatiques (rem.run). Une ligne par destinataire. read_at = clic sur la notification.';
