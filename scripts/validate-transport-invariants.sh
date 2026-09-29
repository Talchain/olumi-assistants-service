#!/usr/bin/env bash
# Transport invariants — V5 slice A1 (Paul's constraint 10).
#
# Buffered JSON only on POST /orchestrate/v2/turn. Zero tolerance for
# `reply.raw.write` or `text/event-stream` in src/orchestrator-v5/ and
# src/orchestrator/route-v2.ts.
#
# Non-zero exit blocks CI.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Matching runs on the COMMENT-STRIPPED view (scripts/ci/strip-source-comments.mjs,
# literal-aware tokeniser): a comment documenting this invariant can never trip
# it, while real code — including a 'text/event-stream' string literal — still
# does.
STRIPPER="$REPO_ROOT/scripts/ci/strip-source-comments.mjs"
command -v node >/dev/null 2>&1 || { echo "ERROR: node is required (matching runs via $STRIPPER)"; exit 1; }

EXIT=0

check() {
  local pattern="$1"
  local label="$2"
  local -a paths=("src/orchestrator-v5" "src/orchestrator/route-v2.ts")

  local hits
  hits="$(node "$STRIPPER" --scan "$pattern" "${paths[@]/#/$REPO_ROOT/}" 2>/dev/null | grep -v '/__tests__/' || true)"
  if [ -n "$hits" ]; then
    echo "ERROR: Transport invariant violated ($label)"
    echo "Pattern: $pattern"
    echo "Hits:"
    echo "$hits"
    echo
    EXIT=1
  fi
}

check 'reply\.raw\.write' 'reply.raw.write forbidden'
check 'text/event-stream' 'text/event-stream forbidden'

if [ "$EXIT" -eq 0 ]; then
  echo "Transport invariants OK: src/orchestrator-v5/ and src/orchestrator/route-v2.ts are buffered-JSON only."
fi

exit "$EXIT"
