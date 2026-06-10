-- getDisputes trie review_disputes par submitted_at DESC (nulls last) à chaque
-- chargement de l'onglet Disputes ; sans index c'est un seq scan + sort qui
-- grossit avec la table (~180 jours d'analyses). Index aligné sur l'ordre exact
-- de la requête.

CREATE INDEX IF NOT EXISTS idx_review_disputes_submitted_at ON public.review_disputes (submitted_at DESC NULLS LAST);
