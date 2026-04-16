#!/usr/bin/env bash
# Tarball SHA manifest check — V5 slice A1.
#
# Asserts that `vendor/talchain-schemas-0.4.0.tgz` matches the SHA-256
# recorded in `vendor/talchain-schemas-0.4.0.tgz.sha256`. Non-zero exit
# blocks the push. Per A1 brief: if the tarball is regenerated, the
# manifest must be updated in the same commit.
#
# Error message format is stable so the drift-simulation test can assert
# against it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARBALL="$REPO_ROOT/vendor/talchain-schemas-0.4.0.tgz"
MANIFEST="$REPO_ROOT/vendor/talchain-schemas-0.4.0.tgz.sha256"

if [ ! -f "$TARBALL" ]; then
  echo "ERROR: Missing tarball at $TARBALL"
  exit 1
fi
if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: Missing SHA manifest at $MANIFEST"
  exit 1
fi

ACTUAL="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
EXPECTED="$(tr -d '[:space:]' < "$MANIFEST")"

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "ERROR: Vendored schemas tarball changed without manifest update. Rebuild and commit both."
  echo "  manifest:  $EXPECTED"
  echo "  actual:    $ACTUAL"
  exit 1
fi

echo "Tarball SHA OK: $ACTUAL"
