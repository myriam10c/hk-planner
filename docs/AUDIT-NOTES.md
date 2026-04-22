# HK Planner — Notes d'audit & historique sécurité

Audit réalisé le 21-22 Avril 2026.

## Phase 0 — Hygiène Supabase & auth serveur
- RLS activée sur 19 tables publiques (fermé 19 alertes ERROR)
- 13 indexes FK manquants créés, 7 indexes inutilisés supprimés
- Listing public du bucket `webapp` retiré
- Secret Hostaway sorti du code → env var Supabase
- CORS restreint à l'origin Netlify (auparavant `*`)
- `X-App-Secret` strict sur hostaway-proxy (backdoor fermée)

## Phase 1 — Auth cleaner
- 8 PINs cleaners hashés bcrypt (pgcrypto `crypt` + `gen_salt('bf')`)
- Table `cleaner_sessions` (token 256 bits, TTL 90j)
- Rate limit login : 5 tentatives/min/IP
- Stored procs : `verify_cleaner_pin`, `validate_cleaner_session`, `set_cleaner_pin`, `cleanup_expired_sessions`
- Actions ajoutées : `cleanerLogin` (sans fuite du PIN dans la réponse), `cleanerLogout`, `cleanerMe`
- Frontend : header `X-Cleaner-Token` sur toutes les requêtes

## Phase 2 — Isolation bot trading
- Tables `bot_*` (43 000+ lignes) déplacées vers schema `trading` (non exposé à PostgREST)
- `medini-bot` : service_role + schema('trading') (plus d'ANON hardcodée)
- Policies `service_role_only` sur les tables déplacées

## Phase 3 — Photos → Storage
- Bucket `cleaning-photos` (privé, 10 MB max, images only)
- 101 photos migrées de base64 DB → fichiers bucket
- Colonnes `photo_path` ajoutées, accès via signed URLs (1h)
- Upload nouvelles photos direct vers bucket

## À faire (cleanup)
- `ALTER TABLE cleaners DROP COLUMN pin` (après 24-48h de validation des sessions)
- `ALTER TABLE cleaning_photos DROP COLUMN photo_data` (idem)
- `ALTER TABLE cleaning_issues DROP COLUMN photo_data`
- `ALTER TABLE maintenance_tickets DROP COLUMN photo_data, resolution_photo`
- `ALTER TABLE ticket_comments DROP COLUMN photo_data`
- `ALTER TABLE maintenance_costs DROP COLUMN receipt_photo`
