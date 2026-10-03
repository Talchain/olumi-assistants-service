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
# 3. P1-2 regression: the vendored schemas pin must resolve to a committed tarball.
# If package.json pins a version whose vendor/*.tgz is missing, `pnpm install`
# / `npm ci` fail: the pin and the vendoring drifted apart.
#
# OTHER versions may sit beside the pinned one on purpose (the previous
# archive is kept for rollback: staging tracks 0.73.0 and 0.74.0). The old
# rule compared EVERY vendored filename to the one pin, so a kept rollback
# archive failed the pre-push hook on every push (Executor, programme-docs
# #87 5972191802). What must hold is: the PINNED archive is present, and its
# bytes match its committed .sha256 when one is committed.
# ---------------------------------------------------------------------------
pin_version="$(grep -oE '"@talchain/schemas": "file:\./vendor/talchain-schemas-[0-9.]+\.tgz"' "${REPO_ROOT}/package.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
vendored_files="$(ls "${REPO_ROOT}/vendor/" | grep -oE 'talchain-schemas-[0-9.]+\.tgz$' | sort -u | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tr '\n' ' ' | sed 's/ $//' || true)"
if [ -z "$pin_version" ]; then
  echo "TRIPWIRE: package.json @talchain/schemas pin does not match file:./vendor/... shape."
  EXIT=1
else
  pinned_tgz="${REPO_ROOT}/vendor/talchain-schemas-${pin_version}.tgz"
  if [ ! -f "$pinned_tgz" ]; then
    echo "TRIPWIRE: @talchain/schemas pin ($pin_version) has no vendored tarball (vendored: ${vendored_files:-none})."
    echo "  reason: P1-2 regression: vendoring out-of-sync with pin."
    EXIT=1
  elif [ -f "${pinned_tgz}.sha256" ]; then
    want_sha="$(tr -d '[:space:]' < "${pinned_tgz}.sha256" | cut -c1-64)"
    have_sha="$(shasum -a 256 "$pinned_tgz" | cut -d' ' -f1)"
    if [ "$want_sha" != "$have_sha" ]; then
      echo "TRIPWIRE: vendored talchain-schemas-${pin_version}.tgz does not match its committed .sha256."
      echo "  reason: the pinned archive's bytes changed without its checksum (or the reverse)."
      EXIT=1
    fi
  fi
fi

if [ "$EXIT" -eq 0 ]; then
  echo "Docs consistency check OK: no stale grant-model wording; no p_user_id in migrations; the pinned schemas tarball is vendored and matches its checksum."
fi

exit "$EXIT"
