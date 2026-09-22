#!/usr/bin/env bash
#
# FairOaks CRM — safe production deploy.
#
# Enforces the DEPLOY.md discipline so prod can NEVER run code that isn't on
# GitHub (the failure that put unpushed commits live on 2026-09-21):
#   1. must be on the canonical deploy branch
#   2. no uncommitted changes (a CLI deploy would ship them untracked)
#   3. push to origin FIRST, then verify local == origin
#   4. only then `vercel --prod`
#
# Usage:  commit your work (with a real message), then:  ./deploy.sh
#
set -euo pipefail

EXPECTED_BRANCH="consolidate/props-plus-calls"
cd "$(dirname "$0")"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "$EXPECTED_BRANCH" ]; then
  echo "✋ On branch '$branch', not '$EXPECTED_BRANCH'."
  echo "   The live CRM deploys ONLY from $EXPECTED_BRANCH (see DEPLOY.md)."
  echo "   Deploying another branch overwrites prod with the wrong code. Aborting."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "✋ You have uncommitted changes:"
  git status --short | sed 's/^/     /'
  echo "   Commit them first — a CLI deploy ships working-directory files that"
  echo "   never reach GitHub. Aborting."
  exit 1
fi

echo "→ Pushing $branch to origin (back up before shipping)…"
git push origin "$branch"

local_head="$(git rev-parse HEAD)"
origin_head="$(git rev-parse "origin/$branch")"
if [ "$local_head" != "$origin_head" ]; then
  echo "✋ After push, local HEAD ($local_head) != origin/$branch ($origin_head)."
  echo "   Not deploying code that isn't on GitHub. Aborting."
  exit 1
fi

echo "→ Deploying to production (vercel --prod)…"
vercel --prod --yes

echo "✓ Deployed. Live code == origin/$branch (${local_head:0:7}), backed up on GitHub."
