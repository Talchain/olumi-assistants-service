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
#      imported by files inside session/ plus the three declared integration
#      points: commit.ts, build-turn-context.ts and apply-operations.ts
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
# `.from('v5_conversation_turns'…)`. Comments remain legal BY MECHANISM, not
# by hope: matching runs on the COMMENT-STRIPPED view of each file
# (scripts/ci/strip-source-comments.mjs, literal-aware tokeniser), so even a
# comment quoting the call syntax verbatim — which the raw grep used to flag —
# cannot fail the gate, while the real call (whose table name lives in a
# string literal, kept intact) still does.
STRIPPER="scripts/ci/strip-source-comments.mjs"
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required (matching runs via $STRIPPER)"; exit 1; }

# ---------------------------------------------------------------------------
# 1. append_turn_atomic RPC — production callers must be supabase-store.ts only
# ---------------------------------------------------------------------------
ILLEGAL_RPC=$(
  node "$STRIPPER" --scan "\.rpc\(['\"]append_turn_atomic['\"]" src 2>/dev/null \
  | grep -v '/__tests__/' | grep -v '\.test\.ts:' \
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
    node "$STRIPPER" --scan "\.from\(['\"]$tbl['\"]" src 2>/dev/null \
    | grep -v '/__tests__/' | grep -v '\.test\.ts:' \
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
#   - src/orchestrator-v5/apply-operations.ts  (declared 21 Sep 2026)
#
# WHY apply-operations.ts IS A DECLARED POINT AND NOT AN EXEMPTION. This rule
# exists to keep the session write surface NARROW AND DECLARED. The accept path
# is a genuine write path and needs a store; the only question is who holds the
# import. Left undeclared, it lands in a ROUTE file — and then in the next route
# that offers an accept, and the one after that, because the adapter cannot
# supply what it is not allowed to resolve. One small single-purpose adapter is
# strictly narrower than N route files, which is the same argument that made
# commit.ts a point rather than an exception.
#
# ⚠ This does NOT make the gate pass and was not added to. At the time of
# writing the gate is RED on five pre-existing violations (turn-fence-prehandler,
# clarify-v2-dispatch, system-events/dispatch, scenario-graph-analysis-read,
# persist-graph-write) plus one direct .from('v5_handler_facts') in
# decision-records/store-adapter.ts. Those are the real debt; this line is not
# cover for them and must not be read as sanctioning them.
#
# ⛔ AND THE REASON THEY ACCUMULATED, which matters more than any of them:
# tests/meta/guard-liveness-acknowledgements.json records this script as
# reachable ONLY from the manually-installed pre-push hook — "no CI job does".
# A guard that stopped running looks exactly like a guard that found nothing.
ILLEGAL_IMPORTS=$(
  node "$STRIPPER" --scan "from '[^']*(orchestrator-v5/)?session/(index|store|supabase-store|cache|invalidation)(\.js)?'" src 2>/dev/null \
  | grep -v '/__tests__/' | grep -v '\.test\.ts:' \
  | grep -v '^src/orchestrator-v5/session/' \
  | grep -v '^src/orchestrator-v5/commit\.ts:' \
  | grep -v '^src/orchestrator-v5/build-turn-context\.ts:' \
  | grep -v '^src/orchestrator-v5/apply-operations\.ts:' \
  || true
)
if [ -n "$ILLEGAL_IMPORTS" ]; then
  fail "SessionStore imported outside session/ + commit.ts + build-turn-context.ts" "$ILLEGAL_IMPORTS"
fi

if [ "$EXIT" -eq 0 ]; then
  echo "State-write invariant OK:"
  echo "  - append_turn_atomic only in session/supabase-store.ts"
  echo "  - v5_conversation_turns / v5_handler_facts only accessed via session/supabase-store.ts"
  echo "  - SessionStore imports limited to session/, commit.ts, build-turn-context.ts, apply-operations.ts"
fi

exit "$EXIT"
