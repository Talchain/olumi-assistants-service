#!/usr/bin/env bash
# Check that dist/ is not stale relative to src/.
# Usage: ./scripts/check-dist-freshness.sh
# Exit 0 if dist/ is fresh or doesn't exist (first build), exit 1 if stale.

set -euo pipefail

DIST_MARKER="dist/src/server.js"
SRC_DIR="src"

if [ ! -f "$DIST_MARKER" ]; then
  echo "[check-dist] dist/ not found — run 'pnpm build' first."
  exit 1
fi

# Find any .ts file in src/ newer than the dist marker
STALE=$(find "$SRC_DIR" -name '*.ts' -newer "$DIST_MARKER" -print -quit 2>/dev/null || true)

if [ -n "$STALE" ]; then
  echo "[check-dist] WARNING: dist/ is stale — source files modified since last build."
  echo "  Example: $STALE"
  echo "  Run 'pnpm build' before starting with 'node dist/src/server.js'."
  exit 1
fi

echo "[check-dist] dist/ is up to date."
