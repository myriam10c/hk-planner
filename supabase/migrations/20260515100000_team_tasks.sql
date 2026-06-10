-- Team tasks : to-do partagée multi-rôles. Étend l'existant cleaners (qui a déjà
-- un champ `role`) plutôt que créer une seconde table d'utilisateurs. Edge function
-- accède via service_role, RLS en place mais aucune policy = anon bloqué.

CREATE TABLE IF NOT EXISTS public.team_tasks (
  id                       BIGSERIAL PRIMARY KEY,
  title                    TEXT NOT NULL,
  description              TEXT,
  status                   TEXT NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','in_progress','done','cancelled')),
  priority                 TEXT NOT NULL DEFAULT 'normal'
                             CHECK (priority IN ('low','normal','high','urgent')),
  category                 TEXT,
  source                   TEXT NOT NULL DEFAULT 'manual'
                             CHECK (source IN ('manual','ceo_agent','whatsapp','system')),
  listing_id               TEXT,
  assigned_cleaner_id      INTEGER REFERENCES public.cleaners(id) ON DELETE SET NULL,
  created_by_cleaner_id    INTEGER REFERENCES public.cleaners(id) ON DELETE SET NULL,
  completed_by_cleaner_id  INTEGER REFERENCES public.cleaners(id) ON DELETE SET NULL,
  due_at                   TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_tasks_assigned_status_idx
  ON public.team_tasks (assigned_cleaner_id, status);
CREATE INDEX IF NOT EXISTS team_tasks_status_due_idx
  ON public.team_tasks (status, due_at);
CREATE INDEX IF NOT EXISTS team_tasks_listing_idx
  ON public.team_tasks (listing_id) WHERE listing_id IS NOT NULL;

-- Commentaires rapides (MVP). Une seconde itération pourra extraire dans une table dédiée.
CREATE TABLE IF NOT EXISTS public.team_task_comments (
  id                BIGSERIAL PRIMARY KEY,
  task_id           BIGINT NOT NULL REFERENCES public.team_tasks(id) ON DELETE CASCADE,
  cleaner_id        INTEGER REFERENCES public.cleaners(id) ON DELETE SET NULL,
  body              TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_task_comments_task_idx
  ON public.team_task_comments (task_id, created_at);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.team_tasks_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_tasks_touch_updated_at_trg ON public.team_tasks;
CREATE TRIGGER team_tasks_touch_updated_at_trg
  BEFORE UPDATE ON public.team_tasks
  FOR EACH ROW EXECUTE FUNCTION public.team_tasks_touch_updated_at();

ALTER TABLE public.team_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_task_comments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.team_tasks IS
  'To-do partagée multi-rôles. Accès via edge function (service_role). Source enum trace l''origine (agent CEO, WhatsApp, manuel).';
