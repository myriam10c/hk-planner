-- HK Planner v3, phase A (cleaner). Trois tables neuves, aucune colonne existante
-- modifiee. RLS activee sans aucune policy sur les trois : seul le service_role de
-- l'edge function lit et ecrit, un client anon est bloque (meme regime que
-- push_subscriptions et laundry_counts).
--
-- Statut du ticket verifie pendant un menage : branche C constatee le 2026-09-12 par
-- les requetes d'introspection de la tache 1 du plan.
--   - maintenance_tickets.status est character varying(20), DEFAULT 'open', sans
--     aucune contrainte CHECK et sans enum ('to_confirm' fait 10 caracteres, il tient).
--   - les deux seules contraintes CHECK de la table portent sur confidence et sur
--     guest_risk, aucune sur status ni sur source.
--   - source est character varying(20), DEFAULT 'manual', sans contrainte : la valeur
--     'hk_planner_v3' de la tache 6 fait 13 caracteres, elle passe telle quelle, rien
--     a ajouter ici.
-- Il n'y a donc rien a alterer cote statut, seulement a documenter la valeur.
--
-- Piege releve par l'introspection : la table porte deja une colonne booleenne
-- `to_confirm` (NOT NULL DEFAULT false), sans rapport avec la nouvelle valeur de
-- statut. Elle marque les tickets signales par Gemini qu'un humain doit relire
-- (app.js, filtre « Review » ; dispatcher du proxy qui les ecarte). Les deux vivent
-- cote a cote : status = 'to_confirm' est le ticket vu par une cleaner pendant un
-- menage, la colonne booleenne reste ce qu'elle est. Un COMMENT sur la colonne
-- booleenne est ajoute en fin de fichier pour que personne ne confonde les deux.

-- ---------------------------------------------------------------------------
-- job_events : journal d'idempotence. Une ligne par geste de cleaner. La cle
-- unique est posee AVANT l'ecriture metier ; un rejeu de la file hors ligne
-- retombe sur la ligne existante et rend le resultat memorise dans `result`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idem_key    TEXT NOT NULL UNIQUE,
  event_type  TEXT NOT NULL CHECK (event_type IN (
                'start_job','tick','upload_photo','finish_job','report_problem','check_ticket')),
  job_id      TEXT,
  cleaner_id  INTEGER REFERENCES public.cleaners(id) ON DELETE SET NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  result      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_events_job_idx
  ON public.job_events (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_events_cleaner_idx
  ON public.job_events (cleaner_id, created_at DESC);

ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.job_events IS
  'Journal d''idempotence des gestes cleaner v3. idem_key vient du telephone (file IndexedDB). result memorise la reponse rendue pour que le rejeu soit identique. Ecrit par hostaway-proxy (service_role) uniquement.';
COMMENT ON COLUMN public.job_events.result IS
  'NULL tant que l''ecriture metier n''a pas abouti. Une ecriture qui echoue supprime sa ligne pour que le rejeu reessaie.';

-- ---------------------------------------------------------------------------
-- photos : un cliche du bucket cleaning-photos, rattache a un menage ou a un
-- ticket. Pas de cle etrangere vers maintenance_tickets : le type de sa cle
-- primaire n'est pas garanti identique a INTEGER et une migration ne doit pas
-- echouer sur ce detail. L'index couvre la lecture « les photos de ce menage ».
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.photos (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  storage_path TEXT NOT NULL UNIQUE,
  job_id       TEXT,
  ticket_id    INTEGER,
  item_name    TEXT,
  cleaner_id   INTEGER REFERENCES public.cleaners(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photos_job_idx ON public.photos (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS photos_ticket_idx ON public.photos (ticket_id, created_at DESC);

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.photos IS
  'Cliches v3. storage_path est le chemin dans le bucket prive cleaning-photos (prefixe v3/). La lecture passe toujours par une URL signee cote proxy, jamais par une URL publique.';

-- ---------------------------------------------------------------------------
-- on_duty : technicien de permanence par jour. Une ligne par date, administree
-- plus tard par un ecran manager (phase C). Quand la date n'a pas de ligne, le
-- proxy applique la regle par defaut (Semax, puis Ismael, puis le premier
-- technicien actif) : la regle vit dans v3.ts, pas ici, pour rester testable et
-- pour ne dependre d'aucun identifiant en dur.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.on_duty (
  duty_date     DATE PRIMARY KEY,
  technician_id INTEGER NOT NULL REFERENCES public.cleaners(id) ON DELETE CASCADE,
  set_by        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.on_duty ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.on_duty IS
  'Technicien de permanence par jour. Absence de ligne = regle par defaut appliquee par le proxy (Semax par defaut, Ismael en secours).';

-- ---------------------------------------------------------------------------
-- Statut « verifie pendant un menage ». Branche C retenue a l'etape 1 : la colonne
-- est du texte libre sans contrainte, aucune instruction ALTER n'est necessaire.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.maintenance_tickets.status IS
  'open, assigned, in_progress, waiting_parts, to_confirm, resolved, cancelled. to_confirm = verifie par une cleaner pendant un menage, avec photo ; un technicien ou un manager confirme ou renvoie. Exclu du compteur de la Fix list.';

COMMENT ON COLUMN public.maintenance_tickets.to_confirm IS
  'Sans rapport avec status = ''to_confirm''. Booleen historique : ticket ouvert par un flux automatique (Gemini) qu''un humain doit relire, affiche dans le filtre Review de l''ecran desktop et ecarte par le dispatcher.';
