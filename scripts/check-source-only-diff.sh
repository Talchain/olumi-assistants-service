#!/usr/bin/env bash
# Source-only diff guard for the P0 V5 golden-path branch (and any other
# branch that needs to ship intentional source changes only).
#
# Fails if `node_modules/**` appears in:
#   - The staging area (git diff --cached --name-only).
#   - The current commit's diff against the configured base ref.
#
# Why this exists: the CEE repo has ~4360 files tracked under
# `node_modules/` from a historical accidental commit. Local
# `pnpm install` produces ~739 dirty entries that drift from those
# committed snapshots. A careless `git add -A` or `git add .` would
# absorb thousands of dependency-churn diffs. The pre-push validation
# catches dependency `file:` references, but tracked-state churn still
# slips through. This guard fails fast.
#
# Usage:
#   bash scripts/check-source-only-diff.sh                 # checks staged
#   bash scripts/check-source-only-diff.sh --against staging  # diff vs staging
#   bash scripts/check-source-only-diff.sh --commit HEAD   # check single commit
#
# Exit codes:
#   0 — no node_modules paths in the checked diff/staging area.
#   1 — node_modules paths found; printed for review.
#   2 — usage error or git failure.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

MODE="staged"
BASE_REF=""
COMMIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --against)
      MODE="against"
      BASE_REF="${2:-}"
      shift 2
      ;;
    --commit)
      MODE="commit"
      COMMIT="${2:-HEAD}"
      shift 2
      ;;
    -h|--help)
      sed -n '1,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

case "$MODE" in
  staged)
    DIFF_OUTPUT="$(git diff --cached --name-only -- '*')"
    SCOPE="staged changes"
    ;;
  against)
    if [[ -z "$BASE_REF" ]]; then
      echo "error: --against requires a ref" >&2
      exit 2
    fi
    DIFF_OUTPUT="$(git diff --name-only "${BASE_REF}..HEAD" -- '*')"
    SCOPE="diff against ${BASE_REF}"
    ;;
  commit)
    DIFF_OUTPUT="$(git show --name-only --format='' "${COMMIT}" -- '*')"
    SCOPE="commit ${COMMIT}"
    ;;
esac

NODE_MODULES_PATHS="$(echo "$DIFF_OUTPUT" | grep -E '^node_modules/' || true)"

if [[ -n "$NODE_MODULES_PATHS" ]]; then
  COUNT="$(echo "$NODE_MODULES_PATHS" | wc -l | tr -d ' ')"
  echo "✗ source-only diff guard FAILED — ${COUNT} node_modules path(s) in ${SCOPE}:" >&2
  echo "$NODE_MODULES_PATHS" | head -20 >&2
  if [[ "$COUNT" -gt 20 ]]; then
    REMAINDER="$((COUNT - 20))"
    echo "  ... and ${REMAINDER} more" >&2
  fi
  echo "" >&2
  echo "  This branch must ship source-only changes. The repo has" >&2
  echo "  pre-existing tracked node_modules churn from a historical" >&2
  echo "  accidental commit; do NOT use 'git add -A' or 'git add .'" >&2
  echo "  to stage. Stage individual source files with explicit paths:" >&2
  echo "    git add src/<file> tests/<file> Docs/<file>" >&2
  echo "" >&2
  echo "  See Docs/v5/p0-v5-golden-path-final-report.md §8 for the" >&2
  echo "  full merge-handoff checklist." >&2
  exit 1
fi

echo "✓ source-only diff guard passed — no node_modules paths in ${SCOPE}"
exit 0
