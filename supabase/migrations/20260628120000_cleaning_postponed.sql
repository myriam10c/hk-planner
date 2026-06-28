-- cleaning_postponed : ménages reportés à un jour ultérieur (1 par réservation).
-- Override de date posé par-dessus la date naturelle (checkout Hostaway ou cleaning_date
-- d'un extra). Le frontend gèle la clé (reservation_key) et déplace la carte au new_date,
-- en conservant assignation / done / checklist attachés. Même modèle que cleaning_cancelled.
-- Accès via edge function (service_role) ; RLS activé sans policy = anon bloqué.

CREATE TABLE IF NOT EXISTS public.cleaning_postponed (
  reservation_key  TEXT PRIMARY KEY,
  original_date    DATE NOT NULL,
  new_date         DATE NOT NULL,
  postponed_by     TEXT DEFAULT 'Manager',
  postponed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cleaning_postponed ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.cleaning_postponed IS
  'Reports de ménage à une date ultérieure (1 par réservation). reservation_key = keyFor() côté app (checkout_guest pour Hostaway, clé stable pour les extras). Accès via edge function service_role.';
