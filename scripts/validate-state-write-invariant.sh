#!/usr/bin/env bash
# State-write invariant guard — V5 Slice B.
#
# The V5 session layer has a narrow write surface by design: every mutation
# to v5_conversation_turns / v5_handler_facts must flow through
# `append_turn_atomic` (which is GRANTed to service_role with SECURITY
# DEFINER), never via direct PostgREST inserts. Direct writes would:
#   1. bypass the biconditional CHECK + turn_class CHECK enforcement
#   2. bypass the ON CONFLICT idempotency path
#   3. split the audit trail across code sites
#
# This guard confirms, across production source (src/, excluding __tests__):
#   1. `append_turn_atomic` RPC invocations live only in
#      src/orchestrator-v5/session/supabase-store.ts
#   2. No src/ file issues direct .from('v5_conversation_turns') or
#      .from('v5_handler_facts') calls (read or write) — reads go through
#      the SessionStore interface, not raw Supabase
#   3. The store interface (`SessionStore` from session/store.ts) is only
#      imported by files inside session/ plus the two declared integration
#      points: commit.ts and build-turn-context.ts
#
# Test files are exempt from all three — integration tests legitimately
# exercise the RPC directly and clean up rows they wrote.
#
# Non-zero exit blocks pre-push.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

EXIT=0

fail() {
  local name="$1"
  shift
  echo "FAIL: $name"
  echo "$@"
  echo
  EXIT=1
}

# Pattern note: matches call-site syntax `.rpc('append_turn_atomic'…)` and
# `.from('v5_conversation_turns'…)` — NOT plain string occurrences in
# comments or docstrings. Comments that mention the names remain legal.

# ---------------------------------------------------------------------------
# 1. append_turn_atomic RPC — production callers must be supabase-store.ts only
# ---------------------------------------------------------------------------
ILLEGAL_RPC=$(
  grep -RInE --include='*.ts' --exclude-dir='__tests__' --exclude='*.test.ts' \
    "\.rpc\\(['\"]append_turn_atomic['\"]" src/ 2>/dev/null \
  | grep -v '^src/orchestrator-v5/session/supabase-store\.ts:' \
  || true
)
if [ -n "$ILLEGAL_RPC" ]; then
  fail "append_turn_atomic RPC called outside src/orchestrator-v5/session/supabase-store.ts" "$ILLEGAL_RPC"
fi

# ---------------------------------------------------------------------------
# 2. v5_conversation_turns / v5_handler_facts — direct PostgREST access only
#    from supabase-store.ts
# ---------------------------------------------------------------------------
V5_TABLES=(
  'v5_conversation_turns'
  'v5_handler_facts'
)
for tbl in "${V5_TABLES[@]}"; do
  ILLEGAL_TABLE=$(
    grep -RInE --include='*.ts' --exclude-dir='__tests__' --exclude='*.test.ts' \
      "\.from\\(['\"]$tbl['\"]" src/ 2>/dev/null \
    | grep -v '^src/orchestrator-v5/session/supabase-store\.ts:' \
    || true
  )
  if [ -n "$ILLEGAL_TABLE" ]; then
    fail "direct PostgREST .from('$tbl') call outside src/orchestrator-v5/session/supabase-store.ts" "$ILLEGAL_TABLE"
  fi
done

# ---------------------------------------------------------------------------
# 3. SessionStore import surface — only the declared integration points
# ---------------------------------------------------------------------------
# Allowed importers (outside session/ itself):
#   - src/orchestrator-v5/commit.ts
#   - src/orchestrator-v5/build-turn-context.ts
ILLEGAL_IMPORTS=$(
  grep -RIn --include='*.ts' --exclude-dir='__tests__' --exclude='*.test.ts' \
    -E "from '[^']*(orchestrator-v5/)?session/(index|store|supabase-store|cache|invalidation)(\.js)?'" src/ 2>/dev/null \
  | grep -v '^src/orchestrator-v5/session/' \
  | grep -v '^src/orchestrator-v5/commit\.ts:' \
  | grep -v '^src/orchestrator-v5/build-turn-context\.ts:' \
  || true
)
if [ -n "$ILLEGAL_IMPORTS" ]; then
  fail "SessionStore imported outside session/ + commit.ts + build-turn-context.ts" "$ILLEGAL_IMPORTS"
fi

if [ "$EXIT" -eq 0 ]; then
  echo "State-write invariant OK:"
  echo "  - append_turn_atomic only in session/supabase-store.ts"
  echo "  - v5_conversation_turns / v5_handler_facts only accessed via session/supabase-store.ts"
  echo "  - SessionStore imports limited to session/, commit.ts, build-turn-context.ts"
fi

exit "$EXIT"
