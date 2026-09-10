-- Comptes utilisateurs HK Planner : un membre d'equipe peut etre relie a un
-- utilisateur Supabase Auth par son email. Colonne nullable : les membres qui
-- n'ont que leur PIN continuent de fonctionner tant qu'ils n'ont pas d'email.
--
-- Pas de cle etrangere vers auth.users : l'email est la seule jointure stable
-- (un compte Auth peut etre recree apres suppression, son uuid change, pas son
-- email). Le proxy resout donc cleaners par email, jamais par uuid.

ALTER TABLE public.cleaners ADD COLUMN IF NOT EXISTS email TEXT;

-- Toujours stocke en minuscules : le JWT Supabase porte l'email normalise en
-- minuscules, et une comparaison sensible a la casse ferait echouer le login.
ALTER TABLE public.cleaners
  DROP CONSTRAINT IF EXISTS cleaners_email_lowercase_chk;
ALTER TABLE public.cleaners
  ADD CONSTRAINT cleaners_email_lowercase_chk
  CHECK (email IS NULL OR email = lower(email));

ALTER TABLE public.cleaners
  DROP CONSTRAINT IF EXISTS cleaners_email_format_chk;
ALTER TABLE public.cleaners
  ADD CONSTRAINT cleaners_email_format_chk
  CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- Un email = un membre. L'index partiel laisse autant de lignes sans email
-- qu'on veut (Elite Cleaning, le compte systeme du CEO Agent, les cleaners
-- qui n'ont pas encore ete invites).
CREATE UNIQUE INDEX IF NOT EXISTS cleaners_email_unique_idx
  ON public.cleaners (lower(email)) WHERE email IS NOT NULL;

COMMENT ON COLUMN public.cleaners.email IS
  'Email du compte Supabase Auth de ce membre. NULL = membre PIN uniquement. Toujours en minuscules.';
