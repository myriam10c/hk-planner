#!/usr/bin/env bash
# Deploy hostaway-proxy edge function to Supabase.
# One-time setup:
#   1. Create a PAT at https://supabase.com/dashboard/account/tokens
#   2. echo 'sbp_xxxxx' > ~/.supabase/access-token
#   3. chmod 600 ~/.supabase/access-token
# Usage: ./deploy-proxy.sh [project-ref]   (default: hk-planner prod)

set -euo pipefail

PROJECT_REF="${1:-dqjnqvbxfwtvrjwnnmns}"   # havn-stays-guide (HK Planner prod)
FUNCTION_NAME="hostaway-proxy"
SOURCE_FILE="hostaway-proxy-patched.ts"
TOKEN_FILE="$HOME/.supabase/access-token"

cd "$(dirname "$0")"

if [[ ! -s "$TOKEN_FILE" ]]; then
  echo "❌ No token at $TOKEN_FILE"
  echo "   Create one at https://supabase.com/dashboard/account/tokens"
  echo "   Then: echo 'sbp_xxxxx' > $TOKEN_FILE && chmod 600 $TOKEN_FILE"
  exit 1
fi

if [[ ! -f "$SOURCE_FILE" ]]; then
  echo "❌ Source not found: $SOURCE_FILE"
  exit 1
fi

# Supabase CLI expects functions in supabase/functions/<name>/index.ts.
# Mirror the patched file there each deploy so we don't drift.
mkdir -p "supabase/functions/$FUNCTION_NAME"
cp "$SOURCE_FILE" "supabase/functions/$FUNCTION_NAME/index.ts"

export SUPABASE_ACCESS_TOKEN="$(cat "$TOKEN_FILE")"

echo "→ Deploying $FUNCTION_NAME to project $PROJECT_REF..."
npx -y supabase@latest functions deploy "$FUNCTION_NAME" \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt
# Note: --no-verify-jwt because the function does its own X-App-Secret auth.

echo "✓ Deployed. Test with:"
echo "  curl -sS https://$PROJECT_REF.supabase.co/functions/v1/$FUNCTION_NAME?action=getCleaners \\"
echo "       -H 'X-App-Secret: \$SECRET' | head -c 200"
