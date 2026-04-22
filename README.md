# HK Planner — Housekeeping & Maintenance

Single-file web app pour gérer les ménages et la maintenance de locations courte durée (Dubai / Hostaway integration).

**Live** : https://stunning-kleicha-f61101.netlify.app

## Stack
- **Frontend** : HTML + Vanilla JS (single-file `index.html`), déployé sur Netlify
- **Backend** : Supabase Edge Functions (Deno) + Postgres
- **Reservations source** : Hostaway API (via `hostaway-proxy`)

## Auth
- **Cleaners** : login PIN 4 chiffres → token session 90j
- **Manager** : accès direct Netlify + secret partagé `X-App-Secret`
- Backend API : tous les endpoints requièrent `X-App-Secret` (strict mode)

## Structure

```
├── index.html                       # App complète
├── netlify.toml                     # Config déploiement
├── supabase/
│   ├── functions/
│   │   ├── hostaway-proxy/          # Backend principal (63 actions CRUD)
│   │   ├── medini-bot/              # Bot trading (cron 5 min, schema trading)
│   │   └── migrate-photos/          # Migration one-shot photos DB → Storage
│   └── migrations/                  # SQL migrations
└── docs/
    └── AUDIT-NOTES.md               # Historique des phases de l'audit
```

## Environnement (Supabase env vars requis)
- `HOSTAWAY_ACCOUNT_ID` — ID compte Hostaway
- `HOSTAWAY_API_KEY` — secret API Hostaway
- `APP_SHARED_SECRET` — secret partagé frontend ↔ backend (X-App-Secret header)
- `STRICT_AUTH` — "true" (par défaut) force la vérification du header

## Déploiement
- **Frontend** : push sur `main` → Netlify auto-deploy
- **Backend Edge Functions** : via Supabase CLI ou MCP (pas encore automatisé)

## Historique sécurité
Voir `docs/AUDIT-NOTES.md` pour l'historique des phases d'audit et de hardening.
