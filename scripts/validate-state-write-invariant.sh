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
# Frozen-debt baseline (exact ratchet — NOT a loosening of the rules below)
#
# scripts/ci/state-write-invariant-baseline.txt lists the pre-existing
# violations, keyed by rule + path + trimmed source text (NOT line number, so
# unrelated edits above a line do not churn it; text-keyed so a NEW violation
# in a baselined file still fails). Behaviour:
#   - a violation NOT in the baseline  -> FAIL (the rule is unchanged for all
#     new code);
#   - a baseline entry that no longer matches any violation -> FAIL (stale:
#     debt was paid down or the line changed; delete the entry in the same PR).
# Exact match in both directions keeps the baseline from silently going stale.
# Baselined != acceptable: each entry carries its justification.
# ---------------------------------------------------------------------------
BASELINE_FILE="scripts/ci/state-write-invariant-baseline.txt"
[ -f "$BASELINE_FILE" ] || { echo "FAIL: baseline file $BASELINE_FILE missing"; exit 1; }
SEEN_KEYS="$(mktemp)"
trap 'rm -f "$SEEN_KEYS"' EXIT

# apply_baseline <rule-id> <grep-style violation lines>  -> prints the
# violations that are NOT baselined; records baselined ones in $SEEN_KEYS.
apply_baseline() {
  local rule="$1" lines="$2" line path text key
  [ -n "$lines" ] || return 0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    path="${line%%:*}"
    text="${line#*:}"; text="${text#*:}"
    text="$(printf '%s' "$text" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    key="${rule}	${path}	${text}"
    if grep -qxF -- "$key" <(cut -f1-3 "$BASELINE_FILE" | grep -v '^#'); then
      printf '%s\n' "$key" >> "$SEEN_KEYS"
    else
      printf '%s\n' "$line"
    fi
  done <<< "$lines"
}

# ---------------------------------------------------------------------------
# 1. append_turn_atomic RPC — production callers must be supabase-store.ts only
# ---------------------------------------------------------------------------
ILLEGAL_RPC=$(
  node "$STRIPPER" --scan "\.rpc\(['\"]append_turn_atomic['\"]" src 2>/dev/null \
  | grep -v '/__tests__/' | grep -v '\.test\.ts:' \
  | grep -v '^src/orchestrator-v5/session/supabase-store\.ts:' \
  || true
)
ILLEGAL_RPC=$(apply_baseline rpc "$ILLEGAL_RPC")
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
  ILLEGAL_TABLE=$(apply_baseline table "$ILLEGAL_TABLE")
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
# ⚠ This is not cover for the pre-existing violations: they are frozen in
# scripts/ci/state-write-invariant-baseline.txt (exact ratchet, see above) and
# are the real debt. Any NEW violation still fails.
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
ILLEGAL_IMPORTS=$(apply_baseline import "$ILLEGAL_IMPORTS")
if [ -n "$ILLEGAL_IMPORTS" ]; then
  fail "SessionStore imported outside session/ + commit.ts + build-turn-context.ts" "$ILLEGAL_IMPORTS"
fi

# Stale-baseline check: every non-comment baseline entry must have matched.
STALE=$(grep -v '^#' "$BASELINE_FILE" | grep -v '^[[:space:]]*$' | cut -f1-3 | sort -u | comm -23 - <(sort -u "$SEEN_KEYS") || true)
if [ -n "$STALE" ]; then
  fail "stale baseline entries in $BASELINE_FILE (violation no longer present — delete the entry)" "$STALE"
fi

if [ "$EXIT" -eq 0 ]; then
  echo "State-write invariant OK:"
  echo "  - append_turn_atomic only in session/supabase-store.ts"
  echo "  - v5_conversation_turns / v5_handler_facts only accessed via session/supabase-store.ts"
  echo "  - SessionStore imports limited to session/, commit.ts, build-turn-context.ts, apply-operations.ts"
fi

exit "$EXIT"
