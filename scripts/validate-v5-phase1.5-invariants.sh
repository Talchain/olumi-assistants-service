#!/usr/bin/env bash
# V5 Phase 1.5 invariants (D7).
#
# 1. `validate_skipped_graph_checks` must not appear in production code paths
#    (comments referencing the old telemetry name ARE allowed — only
#    string-literal emission is forbidden).
#    (Check 2, "no semantic transforms in the ContextPack assembler", retired
#    with the assembler in deletion 8, 22 Oct 2026.)
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0

# Comment handling: scans match against the COMMENT-STRIPPED view via
# scripts/ci/strip-source-comments.mjs (literal-aware tokeniser). This makes
# the "comments referencing the old name are allowed" promise below TRUE by
# mechanism — the raw grep it replaces flagged a comment quoting the old
# telemetry name, the exact opposite of its own documentation.
STRIPPER="scripts/ci/strip-source-comments.mjs"
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required (matching runs via $STRIPPER)"; exit 1; }

# --- 1. validate_skipped_graph_checks string-literal emission --------------
# Flag any PRODUCTION TS file that emits the string 'validate_skipped_graph_checks'.
# Test files legitimately reference this name as a regression guard
# (.not.toContain('validate_skipped_graph_checks')), so they are excluded.
# Comments referencing the old name are also allowed (documentation).
STAGE_LEAKS=$(node "$STRIPPER" --scan "['\"]validate_skipped_graph_checks['\"]" src 2>/dev/null \
  | grep -v '/__tests__/' | grep -v '\.test\.ts:' || true)
if [[ -n "$STAGE_LEAKS" ]]; then
  echo "FAIL: 'validate_skipped_graph_checks' string literal found in production code — Phase 1.5 renamed this to 'validate_skipped_no_graph'."
  echo "$STAGE_LEAKS"
  FAIL=1
fi

if [[ $FAIL -eq 0 ]]; then
  echo "OK: V5 Phase 1.5 invariants hold."
fi
exit $FAIL
