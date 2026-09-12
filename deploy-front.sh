#!/usr/bin/env bash
# Deploy the HK Planner front-end to Netlify.
# Stamps the VERSION of both service workers automatically (so returning clients
# drop the old cache): sw.js for the current app, v3/sw.js for the cleaner app.
# Then deploys to prod.
#
# Site: stunning-kleicha-f61101 (d6377da2-9acb-4fbf-84a5-f7bdd87e120b)
#       linked via .netlify/state.json, so no --site flag needed.
# Usage: ./deploy-front.sh

set -euo pipefail

cd "$(dirname "$0")"

# 1) Stamp both service workers with date + short commit hash
STAMP="v-$(date +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
sed -i '' "s/^const VERSION = '[^']*';/const VERSION = '$STAMP';/" sw.js
sed -i '' "s/^const VERSION = '[^']*';/const VERSION = '$STAMP';/" v3/sw.js

for f in sw.js v3/sw.js; do
  if ! grep -q "const VERSION = '$STAMP';" "$f"; then
    echo "Failed to stamp VERSION in $f, check the 'const VERSION = ...' line."
    exit 1
  fi
done
echo "-> Stamped VERSION = $STAMP in sw.js and v3/sw.js"

# 2) Deploy to Netlify prod (site resolved from .netlify/state.json)
echo "→ Deploying to Netlify prod..."
npx -y netlify-cli@17 deploy --prod --dir=.

echo ""
echo "✓ Deployed."
echo "⚠ Reminder: both service workers were modified (VERSION = $STAMP), commit them:"
echo "    git add sw.js v3/sw.js && git commit -m 'chore: stamp sw VERSION $STAMP'"
