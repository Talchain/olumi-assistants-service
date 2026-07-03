#!/usr/bin/env bash
set -euo pipefail

# One-shot toolchain bootstrap for a fresh clone or linked git worktree.
#
# A fresh worktree checks out tracked sources but has no usable toolchain:
# node_modules binaries are absent (or stale symlinks from the partially
# tracked node_modules population), and src/generated/openapi.d.ts is
# gitignored, so typecheck/lint/test — and pre-push checks 2–4 — fail with
# MODULE_NOT_FOUND walls that mask the real cause.
#
# Run once per new worktree, from anywhere inside it:
#   bash scripts/bootstrap-worktree.sh
#
# Idempotent: safe to re-run at any time.

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# The pnpm MAJOR that CI installs with (pnpm/action-setup `version:` in
# .github/workflows/*.yml). Keep in sync if the workflows change. A local pnpm
# on a different major can behave differently against this lockfile — newer
# majors have false-reded `--frozen-lockfile` here — so we surface the
# divergence loudly rather than let it read as a mysterious install failure.
CI_PNPM_MAJOR=9

# Non-interactive: never let Corepack block setup on a download prompt.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

fail() {
  echo "[bootstrap-worktree] FAIL: $1" >&2
  exit 1
}

step() {
  echo ""
  echo "[bootstrap-worktree] $1"
}

# ---------------------------------------------------------------------------
# 0. pnpm present + version awareness
# ---------------------------------------------------------------------------
step "checking pnpm"
if ! command -v pnpm > /dev/null 2>&1; then
  fail "pnpm not found on PATH. Install via 'corepack enable' or https://pnpm.io/installation, then re-run."
fi
PNPM_VERSION="$(pnpm --version)"
echo "  pnpm ${PNPM_VERSION}"
if [ "${PNPM_VERSION%%.*}" != "${CI_PNPM_MAJOR}" ]; then
  echo "  NOTE: CI installs with pnpm ${CI_PNPM_MAJOR}.x; you are on ${PNPM_VERSION} (not fatal)."
  echo "        If install or the replay gate behaves unexpectedly, reproduce CI with:"
  echo "          corepack pnpm@${CI_PNPM_MAJOR} install --frozen-lockfile"
  echo "        See Docs/t4/pnpm-toolchain-alignment.md."
fi

# ---------------------------------------------------------------------------
# 1. Dependencies — frozen lockfile, no drift
# ---------------------------------------------------------------------------
step "installing dependencies (pnpm install --frozen-lockfile)"
pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 2. Generated OpenAPI types — gitignored, required by ~40 source imports
# ---------------------------------------------------------------------------
step "generating OpenAPI types (pnpm openapi:generate)"
pnpm openapi:generate

# ---------------------------------------------------------------------------
# 3. Git hooks — delegates to the tracked pre-push validation script
# ---------------------------------------------------------------------------
step "installing git hooks (scripts/install-hooks.sh)"
bash scripts/install-hooks.sh

# ---------------------------------------------------------------------------
# 4. Sanity — the exact binaries pre-push checks 2–4 need, plus generated types.
#    Probe by EXECUTION, not existence: node_modules is partially tracked, so
#    in a fresh worktree some binaries exist but crash on load.
# ---------------------------------------------------------------------------
step "verifying toolchain"
MISSING=0
for bin in tsc eslint vitest openapi-typescript; do
  if "node_modules/.bin/${bin}" --version > /dev/null 2>&1; then
    echo "  node_modules/.bin/${bin}  OK"
  else
    echo "  node_modules/.bin/${bin}  BROKEN or MISSING"
    MISSING=1
  fi
done
if [ -f "src/generated/openapi.d.ts" ]; then
  echo "  src/generated/openapi.d.ts  OK"
else
  echo "  src/generated/openapi.d.ts  MISSING"
  MISSING=1
fi
if [ "$MISSING" -ne 0 ]; then
  fail "toolchain incomplete after install — see MISSING entries above."
fi

echo ""
echo "[bootstrap-worktree] done. Suggested smoke check: pnpm typecheck:src"
echo ""
echo "Reminders for worktree sessions:"
echo "  - node_modules is (partially) tracked; NEVER 'git add' anything under it."
echo "  - Cut branches from fresh origin/staging: git fetch origin && git checkout -B <branch> origin/staging"
echo "  - After a squash merge, re-cut from origin/staging; never rebase or reuse the old feature branch."
