#!/usr/bin/env bash
# Deploy the HK Planner front-end to Netlify.
# Stamps sw.js VERSION automatically (so returning clients drop the old cache),
# then deploys to prod.
#
# Site: stunning-kleicha-f61101 (d6377da2-9acb-4fbf-84a5-f7bdd87e120b)
#       — linked via .netlify/state.json, so no --site flag needed.
# Usage: ./deploy-front.sh

set -euo pipefail

cd "$(dirname "$0")"

# 1) Stamp sw.js VERSION with date + short commit hash
STAMP="v-$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
sed -i '' "s/^const VERSION = '[^']*';/const VERSION = '$STAMP';/" sw.js

if ! grep -q "const VERSION = '$STAMP';" sw.js; then
  echo "❌ Failed to stamp VERSION in sw.js — check the 'const VERSION = ...' line."
  exit 1
fi
echo "→ Stamped sw.js VERSION = $STAMP"

# 2) Deploy to Netlify prod (site resolved from .netlify/state.json)
echo "→ Deploying to Netlify prod..."
npx -y netlify-cli@17 deploy --prod --dir=.

echo ""
echo "✓ Deployed."
echo "⚠ Reminder: sw.js was modified (VERSION = $STAMP) — commit it:"
echo "    git add sw.js && git commit -m 'chore: stamp sw VERSION $STAMP'"
