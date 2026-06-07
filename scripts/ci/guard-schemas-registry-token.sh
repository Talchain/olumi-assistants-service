#!/usr/bin/env bash
#
# Guard (sentinel): registry consumption of @talchain/schemas requires a
# package-read token. This is a tripwire, NOT full coverage — see note below.
#
# WHY (full context: Docs/v5/v5-schemas-ci-auth-readiness.md):
#   @talchain/schemas is currently vendored as a local `file:` tarball
#   (vendor/talchain-schemas-<ver>.tgz), so CI needs no registry auth and the
#   absent NPM_PACKAGES_TOKEN secret is harmless. The GitHub Packages 401/token
#   issue may have been real historically, but it is not a blocker for current
#   CEE precisely because the dependency is vendored via `file:`.
#
#   If the dependency is ever switched back to a registry spec (the vendor/README
#   "Removal criterion") WITHOUT a read:packages token set as NPM_PACKAGES_TOKEN,
#   `pnpm install` will 401 against npm.pkg.github.com. A real registry switch
#   would fail many install steps across CI; this guard's job is only to turn the
#   FIRST, clearest signal — one loud failure on the required `check-schemas`
#   gate — into an explicit, self-explaining error instead of a confusing 401.
#   It is a sentinel, not a substitute for fixing the token.
#
# Behaviour (deterministic, no network):
#   spec starts file:/link:/workspace:        -> PASS (local; token not required)
#   registry spec + NPM_PACKAGES_TOKEN set     -> PASS
#   registry spec + NPM_PACKAGES_TOKEN missing -> FAIL (exit 1)
#
set -euo pipefail

SPEC="$(node -p "(() => { const p = require('./package.json'); return (p.dependencies && p.dependencies['@talchain/schemas']) || (p.devDependencies && p.devDependencies['@talchain/schemas']) || ''; })()")"

if [ -z "$SPEC" ]; then
  echo "::error::guard-schemas-registry-token: '@talchain/schemas' not found in package.json dependencies or devDependencies. If it was renamed or removed, update this guard."
  exit 1
fi

case "$SPEC" in
  file:* | link:* | workspace:*)
    echo "✅ @talchain/schemas is local ('$SPEC') — no registry auth required; NPM_PACKAGES_TOKEN not needed."
    exit 0
    ;;
  *)
    if [ -n "${NPM_PACKAGES_TOKEN:-}" ]; then
      echo "✅ @talchain/schemas is a registry spec ('$SPEC') and NPM_PACKAGES_TOKEN is set."
      exit 0
    fi
    echo "::error::@talchain/schemas is a REGISTRY dependency ('$SPEC') but NPM_PACKAGES_TOKEN is missing or empty."
    echo "::error::CI 'pnpm install' will 401 against npm.pkg.github.com. Fix: set a read:packages token as the NPM_PACKAGES_TOKEN secret, OR revert to the vendored file: tarball (see vendor/README.md). Context: Docs/v5/v5-schemas-ci-auth-readiness.md."
    exit 1
    ;;
esac
