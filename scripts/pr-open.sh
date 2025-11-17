#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-main}"
BRANCH="$(git branch --show-current)"

# Ensure the branch exists on origin (no-op if already pushed)
git push -u origin "$BRANCH" >/dev/null 2>&1 || true

# Use the acceptance file if present; otherwise fall back to commit text.
if [ -f "release/ACCEPTANCE_V1.12.0.md" ]; then
  BODY_ARGS=(--body-file release/ACCEPTANCE_V1.12.0.md)
else
  BODY_ARGS=(--fill-first)
fi

gh pr create \
  --base "$BASE" \
  --head "$BRANCH" \
  --label release \
  --title "release($BRANCH): ship what's built" \
  "${BODY_ARGS[@]}"
