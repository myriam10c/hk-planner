-- Sentry-lite MVP: persist client-side errors caught by the global
-- window.error / unhandledrejection handlers in app.js.
--
-- Edge function `hostaway-proxy` (action=logError) inserts here via service role.
-- Anon/auth roles get no policies = blocked, matching the rest of the schema.

CREATE TABLE IF NOT EXISTS public.error_logs (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind        TEXT,
  message     TEXT,
  stack       TEXT,
  source      TEXT,
  lineno      INT,
  colno       INT,
  url         TEXT,
  user_agent  TEXT,
  actor       TEXT
);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at
  ON public.error_logs (created_at DESC);
