#!/usr/bin/env bash
set -euo pipefail

# V5 finaliser contract — grep gate for `analysis_ready` direct emission.
#
# Rule: only the response-finaliser stamps `analysis_ready` onto the wire
# envelope. Composers must NEVER set the field directly. Dispatch result
# types may declare `analysisReady?: AnalysisReadyPayload` and surface a
# pre-computed payload — that's the legitimate pathway INTO the finaliser.
# The route-v2.ts call sites invoke `finaliseV5Response` and (separately)
# log `analysis_ready_emitted` telemetry — also legitimate.
#
# Exclusion list (precise — not so broad it lets bypasses through, not so
# narrow it blocks legitimate code):
#
#   - response-finaliser.ts        : the finaliser itself
#   - analysis-ready-emit.ts        : `attachComputedAt` helper
#   - response-finaliser.test.ts    : contract tests
#   - dispatch-result type files    : surface `analysisReady?` field declarations
#                                     (draft-graph-dispatch.ts, edit-graph-dispatch.ts,
#                                      chip-click-dispatch.ts, system-events/dispatch.ts,
#                                      turn-executor.ts)
#   - route-v2.ts                   : the only caller of finaliseV5Response
#   - any //  finaliser-exempt:     marker (must include the marker text on the
#                                     same line as the violation; reviewer reads
#                                     the rationale next to the code)
#
# Bypass patterns the gate must catch (verified by the adversarial round of
# the schema contract test):
#
#   - direct property assignment   : `response.analysis_ready = ...`
#   - object-literal property      : `{ analysis_ready: ..., ... }`
#   - destructuring with rename    : `const { analysis_ready: ar } = response`
#   - dynamic key                  : `response['analysis_ready'] = ...`
#   - aliased identifier           : `const ar = "analysis_ready"; response[ar] = ...`
#                                     (this last one cannot be caught by grep —
#                                     covered by the schema test instead, which
#                                     parses the OlumiResponse and asserts no
#                                     compose function output carries the field)

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Patterns that are real bypasses (must catch):
#   - `analysis_ready: ...`              object-literal property
#   - `.analysis_ready = ...`            dot-assignment
#   - `["analysis_ready"] = ...`         dynamic-key assignment, double quotes
#   - `['analysis_ready'] = ...`         dynamic-key assignment, single quotes
#
# Patterns that are NOT bypasses (must skip):
#   - `Type['analysis_ready']`           TypeScript type indexer (no trailing `=`)
#   - `// ... analysis_ready ...`        any comment line
#   - `analysis_ready_*` identifiers     analysis_ready_status / _emitted / _present
#                                        (caught by negative greps)
PATTERN='analysis_ready[[:space:]]*:|\.analysis_ready[[:space:]]*=|\["analysis_ready"\][[:space:]]*=|\['"'"'analysis_ready'"'"'\][[:space:]]*='

matches=$(grep -rnE "$PATTERN" \
  src/orchestrator-v5/compose/ \
  src/orchestrator-v5/handlers/ \
  src/orchestrator-v5/system-events/ \
  src/orchestrator-v5/turn-executor.ts \
  --include="*.ts" 2>/dev/null \
  | grep -v "__tests__" \
  | grep -v "response-finaliser" \
  | grep -v "analysis-ready-emit" \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*//.*analysis_ready" \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*\*.*analysis_ready" \
  | grep -v "// finaliser-exempt:" \
  | grep -v "analysisReady\?:" \
  | grep -v "readonly analysisReady" \
  | grep -v "analysis_ready_emitted" \
  | grep -v "analysis_ready_status" \
  | grep -v "analysis_ready_present" \
  || true)

if [ -n "$matches" ]; then
  echo "FAIL: analysis_ready may only be set by the response finaliser."
  echo "      The following lines violate the V5 finaliser contract."
  echo "      If a write is intentional, add // finaliser-exempt: <reason>"
  echo "      on the same line and re-run."
  echo ""
  echo "$matches" | sed 's/^/        /'
  echo ""
  echo "      See src/orchestrator-v5/response-finaliser.ts and"
  echo "      Docs/v5/v5-response-exit-audit.md for the contract."
  exit 1
fi

# Also check route-v2.ts for direct response.analysis_ready assignment outside
# the finaliser invocation. The finaliser is the only sanctioned writer; the
# route-v2 logger reads `response.analysis_ready` (which is fine — read-only
# access doesn't violate the contract, only writes do).
route_matches=$(grep -nE "$PATTERN" src/orchestrator/route-v2.ts 2>/dev/null \
  | grep -v "// finaliser-exempt:" \
  | grep -v "analysis_ready_emitted" \
  | grep -v "analysis_ready_status" \
  || true)

if [ -n "$route_matches" ]; then
  echo "FAIL: route-v2.ts must not write analysis_ready directly."
  echo "      Use finaliseV5Response(response, { analysisReady }) instead."
  echo ""
  echo "$route_matches" | sed 's/^/        /'
  exit 1
fi

exit 0
