-- _writer_stakeout etait la seule table publique sans RLS : lisible et modifiable
-- avec la cle anon. Aucune policy : seuls service_role et postgres y accedent.
-- Son seul ecrivain, le trigger trg_redirect_resolution_notes (maintenance_tickets),
-- avale deja toute erreur d'insertion (EXCEPTION WHEN OTHERS) : rien ne casse.
ALTER TABLE public._writer_stakeout ENABLE ROW LEVEL SECURITY;
