-- Heure dediee (optionnelle) d'un menage en plus, heure de Dubai sans fuseau.
-- Null = pas d'heure : l'extra se comporte exactement comme avant.
ALTER TABLE public.extra_cleanings ADD COLUMN IF NOT EXISTS cleaning_time time;
