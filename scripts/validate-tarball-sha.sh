#!/usr/bin/env bash
# Tarball SHA manifest check — V5 slice A1, generalised in CQE 0.6.0 bump.
#
# Reads the currently-pinned `@talchain/schemas` tarball path from
# package.json and asserts that the on-disk tarball matches the SHA-256
# recorded in the adjacent `.sha256` manifest. Non-zero exit blocks the
# push. When the tarball is regenerated and package.json re-pinned, the
# new .sha256 file must be committed alongside the new tarball in the
# same commit.
#
# Error message format is stable so the drift-simulation test can assert
# against it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Derive pinned tarball filename from package.json. This removes the
# hardcoded version bumping ritual: a future schemas bump requires a new
# tarball + its .sha256, no script edit.
PINNED_TARBALL="$(grep -oE '"@talchain/schemas":[[:space:]]*"file:\./vendor/[^"]+\.tgz"' "$REPO_ROOT/package.json" | sed -E 's|.*vendor/||; s|".*||' || true)"
if [ -z "$PINNED_TARBALL" ]; then
  echo "ERROR: could not locate a pinned @talchain/schemas file:./vendor/*.tgz entry in package.json"
  exit 1
fi
TARBALL="$REPO_ROOT/vendor/$PINNED_TARBALL"
MANIFEST="$TARBALL.sha256"

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
