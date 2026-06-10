-- Telegram chat ID par membre d'équipe — utilisé par l'edge function pour notifier
-- l'assigné d'une team_task lors de sa création ou réassignation.
-- Le chat_id se récupère via /start sur le bot puis Telegram getUpdates.

ALTER TABLE public.cleaners
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

COMMENT ON COLUMN public.cleaners.telegram_chat_id IS
  'Telegram chat ID (numérique sous forme texte). NULL = pas de notif. Stocké en texte car les chat_id de groupes peuvent dépasser les bornes int4.';
