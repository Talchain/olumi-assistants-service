#!/usr/bin/env bash
# V5 docs consistency guard.
#
# Tripwire against specific stale/contradictory patterns that have actually
# drifted in this project before. NOT a general docs linter. Every pattern
# here has a documented reason: the external reviewer flagged it, we fixed
# it, this script keeps the fix from silently regressing.
#
# Non-zero exit blocks CI / pre-push.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXIT=0

check_substring_absent() {
  local pattern="$1"
  local where="$2"
  local reason="$3"
  local hits
  hits="$(grep -rIn --include='*.md' --include='*.sql' -F "$pattern" "${REPO_ROOT}/${where}" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "TRIPWIRE: '$pattern' present in ${where}"
    echo "  reason: $reason"
    echo "  hits:"
    echo "$hits" | sed 's/^/    /'
    echo
    EXIT=1
  fi
}

# ---------------------------------------------------------------------------
# 1. P1-1 regression: grant-model contradiction in audit §4.4.
#
# The explicit-GRANT model (service_role gets EXECUTE via `GRANT EXECUTE ...
# TO service_role`) is the sole source of permission. If "inherits EXECUTE"
# or "superuser-like privileges" reappear, the Notes bullet has drifted back
# to its pre-P1-2 wording.
# ---------------------------------------------------------------------------
check_substring_absent 'inherits EXECUTE' 'Docs/v5' \
  'P1-1 regression: grant-model Notes bullet reverted to pre-P1-2 language.'
check_substring_absent 'superuser-like' 'Docs/v5' \
  'P1-1 regression: grant-model Notes bullet reverted to pre-P1-2 language.'

# ---------------------------------------------------------------------------
# 2. P0-3 regression: `append_turn_atomic` must NOT carry a spoofable
# `p_user_id` parameter. That RPC derives user_id from scenarios.user_id by
# design; adding a caller-supplied user_id would re-open the SECURITY
# DEFINER impersonation vector (see supabase/migrations/…_v5_session_store
# .sql file header).
#
# Scope note (2026-04-21): the tripwire is narrowed to `append_turn_atomic`
# only. `ensure_scenario_exists` intentionally accepts `p_user_id` as a
# PoC trade-off — production will upgrade to a JWT-scoped client that
# reads identity from auth.uid(). See the ensure_scenario_exists migration
# file header for the full accepted-risk discussion.
# ---------------------------------------------------------------------------
migration_hits="$(grep -rInz --include='*.sql' -E 'CREATE( OR REPLACE)? FUNCTION[[:space:]]+(public\.)?append_turn_atomic[^$]*p_user_id' "${REPO_ROOT}/supabase/migrations" 2>/dev/null || true)"
if [ -n "$migration_hits" ]; then
  echo "TRIPWIRE: 'p_user_id' parameter detected on append_turn_atomic"
  echo "  reason: P0-3 regression: append_turn_atomic derives user_id from scenarios.user_id; a caller-supplied p_user_id re-opens SECURITY DEFINER impersonation."
  echo "  hits:"
  echo "$migration_hits" | sed 's/^/    /'
  echo
  EXIT=1
fi

# ---------------------------------------------------------------------------
# 3. P1-2 regression: vendored schemas pin must match the committed tarball.
# If package.json pin and vendor/*.tgz filename disagree, `pnpm install`
# fails / `npm ci` fails, and at least one of these drifted without the other
# being updated.
# ---------------------------------------------------------------------------
pin_version="$(grep -oE '"@talchain/schemas": "file:\./vendor/talchain-schemas-[0-9.]+\.tgz"' "${REPO_ROOT}/package.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
vendored_files="$(ls "${REPO_ROOT}/vendor/" | grep -oE 'talchain-schemas-[0-9.]+\.tgz$' | sort -u | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || true)"
if [ -z "$pin_version" ]; then
  echo "TRIPWIRE: package.json @talchain/schemas pin does not match file:./vendor/... shape."
  EXIT=1
elif [ "$vendored_files" != "$pin_version" ]; then
  echo "TRIPWIRE: @talchain/schemas pin ($pin_version) and vendored tarball ($vendored_files) disagree."
  echo "  reason: P1-2 regression: vendoring out-of-sync with pin."
  EXIT=1
fi

if [ "$EXIT" -eq 0 ]; then
  echo "Docs consistency check OK: no stale grant-model wording; no p_user_id in migrations; pin and vendored tarball agree."
fi

exit "$EXIT"
