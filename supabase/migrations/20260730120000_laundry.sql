-- Comptage du linge sale et suivi des mouvements vers la blanchisserie.
-- laundry_counts   : 1 ligne par ménage, saisie par la cleaner avant "Done".
-- laundry_movements: 1 ligne par mouvement au local (sortie, retour, ajustement).
-- Les deux soldes se dérivent de ces deux tables via la vue laundry_balances :
--   dirty_at_store = adjust_store + counts - out
--   at_laundry     = adjust_laundry + out - in
-- Accès via edge function (service_role) ; RLS activé sans policy = anon bloqué.

CREATE TABLE IF NOT EXISTS public.laundry_counts (
  reservation_key  TEXT PRIMARY KEY,
  pillowcases      INTEGER NOT NULL DEFAULT 0 CHECK (pillowcases  BETWEEN 0 AND 999),
  bed_sheets       INTEGER NOT NULL DEFAULT 0 CHECK (bed_sheets   BETWEEN 0 AND 999),
  duvet_covers     INTEGER NOT NULL DEFAULT 0 CHECK (duvet_covers BETWEEN 0 AND 999),
  small_towels     INTEGER NOT NULL DEFAULT 0 CHECK (small_towels BETWEEN 0 AND 999),
  large_towels     INTEGER NOT NULL DEFAULT 0 CHECK (large_towels BETWEEN 0 AND 999),
  bath_mats        INTEGER NOT NULL DEFAULT 0 CHECK (bath_mats    BETWEEN 0 AND 999),
  counted_on       DATE NOT NULL,
  author           TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS laundry_counts_counted_on_idx
  ON public.laundry_counts (counted_on);

ALTER TABLE public.laundry_counts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.laundry_counts IS
  'Linge sale déclaré par la cleaner en fin de ménage. reservation_key = keyFor() côté app. counted_on est dérivé du préfixe date de la clé, pas de l''heure de saisie. Accès via edge function service_role.';

CREATE TABLE IF NOT EXISTS public.laundry_movements (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('out','in','adjust_store','adjust_laundry')),
  pillowcases  INTEGER NOT NULL DEFAULT 0 CHECK (abs(pillowcases)  <= 999),
  bed_sheets   INTEGER NOT NULL DEFAULT 0 CHECK (abs(bed_sheets)   <= 999),
  duvet_covers INTEGER NOT NULL DEFAULT 0 CHECK (abs(duvet_covers) <= 999),
  small_towels INTEGER NOT NULL DEFAULT 0 CHECK (abs(small_towels) <= 999),
  large_towels INTEGER NOT NULL DEFAULT 0 CHECK (abs(large_towels) <= 999),
  bath_mats    INTEGER NOT NULL DEFAULT 0 CHECK (abs(bath_mats)    <= 999),
  moved_on     DATE NOT NULL,
  note         TEXT,
  author       TEXT DEFAULT 'Manager',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT laundry_movements_non_negative CHECK (
    kind LIKE 'adjust%' OR (
      pillowcases >= 0 AND bed_sheets >= 0 AND duvet_covers >= 0
      AND small_towels >= 0 AND large_towels >= 0 AND bath_mats >= 0
    )
  )
);

CREATE INDEX IF NOT EXISTS laundry_movements_moved_on_idx
  ON public.laundry_movements (moved_on DESC, id DESC);

ALTER TABLE public.laundry_movements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.laundry_movements IS
  'Mouvements de linge au local. out = ramassé par la blanchisserie, in = rapporté, adjust_store / adjust_laundry = corrections d''inventaire (valeurs négatives autorisées, servent aussi à l''amorçage du stock existant).';

CREATE OR REPLACE VIEW public.laundry_balances
WITH (security_invoker = on) AS
WITH c AS (
  SELECT
    COALESCE(SUM(pillowcases), 0)::BIGINT  AS pillowcases,
    COALESCE(SUM(bed_sheets), 0)::BIGINT   AS bed_sheets,
    COALESCE(SUM(duvet_covers), 0)::BIGINT AS duvet_covers,
    COALESCE(SUM(small_towels), 0)::BIGINT AS small_towels,
    COALESCE(SUM(large_towels), 0)::BIGINT AS large_towels,
    COALESCE(SUM(bath_mats), 0)::BIGINT    AS bath_mats
  FROM public.laundry_counts
),
m AS (
  SELECT
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'out'), 0)::BIGINT            AS out_bath_mats,
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'in'), 0)::BIGINT             AS in_bath_mats,
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'adjust_store'), 0)::BIGINT   AS as_bath_mats,
    COALESCE(SUM(pillowcases)  FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_pillowcases,
    COALESCE(SUM(bed_sheets)   FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_bed_sheets,
    COALESCE(SUM(duvet_covers) FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_duvet_covers,
    COALESCE(SUM(small_towels) FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_small_towels,
    COALESCE(SUM(large_towels) FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_large_towels,
    COALESCE(SUM(bath_mats)    FILTER (WHERE kind = 'adjust_laundry'), 0)::BIGINT AS al_bath_mats
  FROM public.laundry_movements
)
SELECT 'store'::TEXT AS bucket,
  c.pillowcases  + m.as_pillowcases  - m.out_pillowcases  AS pillowcases,
  c.bed_sheets   + m.as_bed_sheets   - m.out_bed_sheets   AS bed_sheets,
  c.duvet_covers + m.as_duvet_covers - m.out_duvet_covers AS duvet_covers,
  c.small_towels + m.as_small_towels - m.out_small_towels AS small_towels,
  c.large_towels + m.as_large_towels - m.out_large_towels AS large_towels,
  c.bath_mats    + m.as_bath_mats    - m.out_bath_mats    AS bath_mats
FROM c CROSS JOIN m
UNION ALL
SELECT 'laundry'::TEXT,
  m.al_pillowcases  + m.out_pillowcases  - m.in_pillowcases,
  m.al_bed_sheets   + m.out_bed_sheets   - m.in_bed_sheets,
  m.al_duvet_covers + m.out_duvet_covers - m.in_duvet_covers,
  m.al_small_towels + m.out_small_towels - m.in_small_towels,
  m.al_large_towels + m.out_large_towels - m.in_large_towels,
  m.al_bath_mats    + m.out_bath_mats    - m.in_bath_mats
FROM c CROSS JOIN m;

COMMENT ON VIEW public.laundry_balances IS
  'Deux lignes : bucket=store (linge sale au local) et bucket=laundry (linge chez le prestataire). Recalculée à chaque lecture, pas de cache.';
