#!/usr/bin/env bash
#
# Populate the Vercel **Preview** environment for fair-oaks-realty-group.
#
# Why this exists: as of Aug 2026 the project had 28 env vars in Production and only 5
# in Preview, so every PR preview deployment crashed with
#   "@supabase/ssr: Your project's URL and API key are required"
# which meant no pull request could be exercised before merge.
#
# Run it yourself — it reads your own production values and writes them to Preview.
# Nothing is printed to the terminal.
#
#   chmod +x scripts/vercel-preview-env.sh && ./scripts/vercel-preview-env.sh
#
# ---------------------------------------------------------------------------
# SECURITY NOTE — read before uncommenting anything below.
#
# Preview deployment URLs are effectively public. Every branch you push builds with
# whatever lives in Preview. Any secret placed here can therefore be exercised by any
# preview build, so only the minimum needed to boot and test the app is enabled.
#
# Deliberately NOT copied (they can spend money, send mail, or move real data):
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET  -> use Stripe *test* keys instead
#   RESEND_API_KEY, RESEND_API_KEY_COMMERCIAL -> previews would send real email
#   ANTHROPIC_API_KEY                         -> previews would bill real tokens
#   FACEBOOK_APP_SECRET, GOOGLE_CLIENT_SECRET -> OAuth callbacks won't match anyway
#   CRON_SECRET, WEBHOOK_SECRET               -> keep production-only
#
# Best practice, if you ever want previews to be fully safe: point them at a separate
# Supabase project (or a Supabase branch) rather than production.
# ---------------------------------------------------------------------------
set -euo pipefail

VARS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SERVICE_ROLE_KEY     # needed: every /api/crm route uses the service role
  NEXT_PUBLIC_BASE_URL
  NEXT_PUBLIC_SERVER_URL
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  DATABASE_URL
  PAYLOAD_SECRET
  TOKEN_ENCRYPTION_KEY          # needed: social-publish token decryption

  # --- enable only if you accept the risk described above ---
  # RESEND_API_KEY
  # RESEND_API_KEY_COMMERCIAL
  # ANTHROPIC_API_KEY
  # STRIPE_SECRET_KEY
  # STRIPE_WEBHOOK_SECRET
)

TMP="$(mktemp -t vercel-prod-env)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT INT TERM

echo "Pulling production values (nothing is displayed)…"
vercel env pull --environment=production "$TMP" >/dev/null 2>&1

for name in "${VARS[@]}"; do
  # shellcheck disable=SC2016
  value="$(grep -m1 "^${name}=" "$TMP" | cut -d= -f2- | sed 's/^"//; s/"$//')"
  if [ -z "$value" ]; then
    echo "  skip    $name (not set in production)"
    continue
  fi
  if printf '%s' "$value" | vercel env add "$name" preview >/dev/null 2>&1; then
    echo "  added   $name"
  else
    echo "  exists  $name (remove it first with: vercel env rm $name preview)"
  fi
done

echo
echo "Done. Redeploy an open PR to pick the new values up:"
echo "  vercel --prebuilt=false"
echo "or just push a commit to the branch."
