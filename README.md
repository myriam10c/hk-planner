# HK Planner

Housekeeping & maintenance scheduling app for ~108 Dubai short-term rentals.

- **Live**: https://stunning-kleicha-f61101.netlify.app/
- **Frontend**: single-file vanilla-JS HTML, deployed to Netlify
- **Backend**: Supabase (Postgres + Edge Functions + Storage), project `dqjnqvbxfwtvrjwnnmns`
- **Source of upstream data**: Hostaway PMS

## Repo layout

```
.
├── index.html                    # the app (~5,100 lines, HTML+JS — CSS extracted)
├── styles/styles.css             # all of the app's CSS (~2,350 lines, single file for now)
├── hostaway-proxy-patched.ts     # the edge function (~1,660 lines, 75 actions)
├── medini-bot-patched.ts         # legacy WhatsApp bot edge function
├── migrate-photos.ts             # one-shot photo bucket migration (already ran)
├── deploy-proxy.sh               # one-command edge function deploy
├── deploy-netlify/               # static-site bundle ready for Netlify (zip-deploy)
│   ├── index.html                # synced from the canonical index.html
│   ├── _headers
│   ├── netlify.toml
│   └── sw.js
├── hk-planner-repo/              # clone of github.com/myriam10c/hk-planner
├── supabase/
│   ├── migrations/               # canonical schema migrations (commit every DDL change)
│   ├── README.md
│   └── DECOMMISSION_CHECKLIST.md # legacy projects to clean up
├── tests/
│   └── smoke.spec.ts             # Playwright smoke suite (5 tests)
├── playwright.config.ts
├── .github/workflows/smoke.yml   # runs smoke tests on push + PR
└── package.json
```

## Common tasks

### Run smoke tests

```bash
npm install              # first time
npm run test:install     # downloads chromium + webkit
npm test                 # runs against prod
HK_PLANNER_URL=https://my-preview.netlify.app npm test  # any URL
```

5 tests covering: page-load, global helper exposure, table column count, container width cascade, table-cell layout regression. Designed to catch the bug classes we've shipped (CSS specificity, getAllData filter leaks, broken table layout).

### Deploy the edge function

One-time setup:

```bash
# Create a PAT at https://supabase.com/dashboard/account/tokens
echo 'sbp_xxxxx' > ~/.supabase/access-token
chmod 600 ~/.supabase/access-token
```

Then anytime:

```bash
./deploy-proxy.sh
```

### Deploy the frontend (Netlify)

The `deploy-netlify/` folder is the deploy artifact. After editing `index.html` or `styles/styles.css`:

```bash
cp index.html deploy-netlify/index.html
cp styles/styles.css deploy-netlify/styles.css
cp index.html hk-planner-repo/index.html        # GitHub mirror
cp styles/styles.css hk-planner-repo/styles.css
source ~/.netlify/token.env                      # contains NETLIFY_AUTH_TOKEN
cd deploy-netlify && zip -qr /tmp/hk-deploy.zip . -x '*.DS_Store'
curl -s -X POST \
  -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  -H 'Content-Type: application/zip' \
  --data-binary @/tmp/hk-deploy.zip \
  https://api.netlify.com/api/v1/sites/d6377da2-9acb-4fbf-84a5-f7bdd87e120b/deploys
```

### Apply a schema change

1. Add `supabase/migrations/YYYYMMDDHHMMSS_short_description.sql`
2. Apply via Supabase MCP `apply_migration` (preferred) or `supabase db push`
3. Commit the file. The repo is the source of truth.

See [`supabase/README.md`](supabase/README.md) for details.

## Known tech debt

A prioritized backlog lives in the chat history (`/engineering:tech-debt` from 2026-04-28). Top items:

1. ~~Edge function deploy pipeline~~ ✅ done — see `deploy-proxy.sh`
2. ~~`getAllData` returns resolved tickets~~ ✅ done — proxy now filters
3. ~~No automated tests~~ ✅ done — 5-test Playwright smoke suite
4. **Split single-file `index.html`** — bundler + JS modules, biggest payoff for cascade-bug class
5. **Centralize state** — 9 ad-hoc localStorage keys + dozens of globals
6. **Remove inline `onclick` handlers** — 233 of them; blocks CSP
7. **Edge function: route map** — 75 actions in one if/else
