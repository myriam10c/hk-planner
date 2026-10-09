-- security_contacts_doc : contacts concierge / securite des immeubles (onglet Security).
-- Remplace security-contacts.json, qui etait servi en clair par Netlify a n'importe qui.
-- Une seule ligne (id = 1) : le document JSON tel que le produit le job VPS
-- scheduled/hk_security_contacts.py (cle `buildings`), ecrit par l'action server-only
-- setSecurityContacts, lu par getSecurityContacts derriere une session d'equipe.
create table if not exists public.security_contacts_doc (
  id         int primary key default 1 check (id = 1),
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.security_contacts_doc enable row level security;
-- Pas de policy : acces uniquement via service_role (edge function hostaway-proxy).
