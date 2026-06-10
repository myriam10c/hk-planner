#!/usr/bin/env bash
# Deploy canary: run Playwright smoke tests against the latest Netlify deploy.
# If they fail, automatically restore the previous good deploy.
#
# Usage:
#   ./canary.sh                         # check current prod, rollback on fail
#   ./canary.sh --dry-run               # smoke only, never rollback
#   NETLIFY_AUTH_TOKEN=xxx ./canary.sh  # explicit token
#
# Defaults: HK Planner site (d6377da2-9acb-4fbf-84a5-f7bdd87e120b),
#           prod URL https://stunning-kleicha-f61101.netlify.app

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

SITE_ID="${NETLIFY_SITE_ID:-d6377da2-9acb-4fbf-84a5-f7bdd87e120b}"
PROD_URL="${HK_PLANNER_URL:-https://stunning-kleicha-f61101.netlify.app}"

# Load token from ~/.netlify/token.env if not in env
if [[ -z "${NETLIFY_AUTH_TOKEN:-}" && -f "$HOME/.netlify/token.env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.netlify/token.env"
fi

if [[ -z "${NETLIFY_AUTH_TOKEN:-}" ]]; then
  echo "❌ NETLIFY_AUTH_TOKEN not set. Set it in env or in ~/.netlify/token.env"
  exit 2
fi

cd "$(dirname "$0")"

# 1) Find the currently PUBLISHED deploy (authoritative — survives rollbacks,
#    where the newest "ready" deploy in the list is NOT the live one),
#    plus the most recent other ready deploy as rollback candidate.
PUBLISHED_ID=$(curl -sS -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites/$SITE_ID" | python3 -c '
import sys, json
site = json.load(sys.stdin)
pub = site.get("published_deploy") or {}
if not pub.get("id"):
    sys.exit("no published deploy found for site")
print(pub["id"])
')

DEPLOY_INFO=$(curl -sS -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys?per_page=20" | python3 -c '
import sys, json
published_id = sys.argv[1]
def first_line(s):  # commit messages can have newlines; canary metadata is one-line only
    return (s or "").splitlines()[0] if s else ""
ready = [d for d in json.load(sys.stdin) if d.get("state") == "ready"]
if not ready:
    sys.exit("no ready deploys found")
cur = next((d for d in ready if d["id"] == published_id), ready[0])
# Rollback candidate: the newest ready deploy OLDER than the published one
# (list is newest-first). Never pick a newer deploy — after a rollback that
# would be the broken build we just rolled away from.
cur_idx = ready.index(cur)
prev = ready[cur_idx + 1] if cur_idx + 1 < len(ready) else None
print(cur["id"])
print(first_line(cur.get("title","")))
print(prev["id"] if prev else "")
print(first_line(prev.get("title","")) if prev else "")
' "$PUBLISHED_ID")

CURRENT_ID=$(echo "$DEPLOY_INFO" | sed -n '1p')
CURRENT_TITLE=$(echo "$DEPLOY_INFO" | sed -n '2p')
PREVIOUS_ID=$(echo "$DEPLOY_INFO" | sed -n '3p')
PREVIOUS_TITLE=$(echo "$DEPLOY_INFO" | sed -n '4p')

echo "→ Current deploy:  $CURRENT_ID  $(echo "$CURRENT_TITLE" | head -c 60)"
echo "→ Previous good:   ${PREVIOUS_ID:-(none — no fallback available)}  $(echo "$PREVIOUS_TITLE" | head -c 60)"
echo ""

# 2) Run smoke tests against the live URL
echo "→ Running Playwright smoke tests against $PROD_URL"
if HK_PLANNER_URL="$PROD_URL" npx playwright test --project=desktop --reporter=list; then
  echo ""
  echo "✓ Smoke passed — keeping current deploy."
  exit 0
fi

echo ""
echo "✗ Smoke FAILED."

if [[ "$DRY_RUN" == "true" ]]; then
  echo "  Dry-run mode — would restore $PREVIOUS_ID. Exiting non-zero."
  exit 1
fi

if [[ -z "$PREVIOUS_ID" ]]; then
  echo "  No previous deploy available to restore. Manual intervention required."
  exit 1
fi

echo "→ Auto-restoring previous deploy $PREVIOUS_ID..."
RESTORE=$(curl -sS -X POST -H "Authorization: Bearer $NETLIFY_AUTH_TOKEN" \
  "https://api.netlify.com/api/v1/sites/$SITE_ID/deploys/$PREVIOUS_ID/restore")
echo "$RESTORE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print('  state:', d.get('state'), ' title:', (d.get('title') or '')[:60])
except Exception as e:
    print('  warning: could not parse restore response:', e)
"
echo ""
echo "✓ Rollback issued. Next: investigate the broken deploy ($CURRENT_ID), fix, redeploy."
exit 1
