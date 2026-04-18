#!/usr/bin/env bash
# V5 handler-ownership invariant — Slice C2.
#
# Grep-based negative-proof that the run_analysis handler respects the F.6
# ownership contract locked in the overnight C2 brief §2:
#
#   1. PLoT results are not reinterpreted in CEE.
#   2. No math / statistical helpers applied to PLoT response fields.
#   3. Handler imports only from declared paths — no direct PLoT HTTP calls,
#      no UI-repo references.
#   4. Assistant-text templates match the locked enum (implicit; unit-tested
#      in run-analysis.test.ts).
#
# These invariants prevent the V4 "silent semantic drift" failure mode where
# CEE built its own derived copy of PLoT's numbers (rounding, aggregation,
# rephrasing). The V4 post-mortem identified this as the single biggest
# source of wire-level bugs. C2 is the first handler that persists a fact;
# the shape of that fact is CEE's contract with downstream consumers.
#
# Usage: run in CI (wired into validate-prepush.sh) + ad-hoc.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

EXIT=0
HANDLER_FILE='src/orchestrator-v5/tools/handlers/run-analysis.ts'

fail() {
  local name="$1"
  shift
  echo "FAIL: $name"
  echo "$@"
  echo
  EXIT=1
}

# ---------------------------------------------------------------------------
# 1. Handler module imported only by registry.ts
#
# Tightened post-C2: previously `turn-executor.ts` had an exception so it
# could import the handler-generic errors (HandlerInvocationFailedError +
# HandlerResultInvalidError). Those errors have since moved to
# `tools/handler-errors.ts`, so the exception is no longer needed. If a
# future change re-introduces an import from a handler module outside
# registry.ts, this check fails the push — forcing a decision between
# "generalise the shared surface" (move to handler-errors.ts) and
# "genuine exception" (add justification here).
# ---------------------------------------------------------------------------
ILLEGAL_IMPORTS=$(
  grep -RIn --include='*.ts' --exclude-dir='__tests__' --exclude='*.test.ts' \
    -E "from '[^']*tools/handlers/run-analysis(\.js)?'" src/ 2>/dev/null \
  | grep -v '^src/orchestrator-v5/tools/registry\.ts:' \
  || true
)
if [ -n "$ILLEGAL_IMPORTS" ]; then
  fail 'runAnalysisHandler imported outside registry.ts' "$ILLEGAL_IMPORTS"
fi

# ---------------------------------------------------------------------------
# 2. No direct PLoT HTTP calls from the handler (must go through PLoTClient)
# ---------------------------------------------------------------------------
DIRECT_HTTP=$(
  grep -nE "fetch\(|axios|node-fetch|undici" "$HANDLER_FILE" 2>/dev/null \
  | grep -v '^ *//' \
  || true
)
if [ -n "$DIRECT_HTTP" ]; then
  fail 'run_analysis handler makes direct HTTP calls — must route through PLoTClient' "$DIRECT_HTTP"
fi

# ---------------------------------------------------------------------------
# 3. No UI repo references
# ---------------------------------------------------------------------------
UI_REFS=$(
  grep -nE "DecisionGuideAI|decision-guide-ai" "$HANDLER_FILE" 2>/dev/null \
  | grep -v '^ *//' \
  || true
)
if [ -n "$UI_REFS" ]; then
  fail 'run_analysis handler references UI repo' "$UI_REFS"
fi

# ---------------------------------------------------------------------------
# 4. No math / statistical helpers applied to PLoT response fields
#
# This is the core F.6 negative-proof: grep for patterns that would round,
# aggregate, or reformat PLoT's numerical output. If a later refactor
# introduces any of these into the handler, the commit is blocked so Paul
# sees the drift before it ships.
#
# Patterns targeted:
#   - Math.round / floor / ceil applied to any variable
#   - .toFixed(...) — formatting
#   - Number.parseFloat(...) / parseFloat — coercing PLoT strings
#   - Number(...) applied to a response-looking expression
#   - imports from math-aggregation libraries (d3, mathjs, simple-statistics,
#     lodash/round)
#
# `Number.isFinite(...)` is explicitly permitted — it's a predicate, not a
# coercion, and is necessary for NaN/Infinity filtering. The whitelist below
# strips `Number.isFinite` matches before the audit.
# ---------------------------------------------------------------------------
# Strip comment lines before auditing. JSDoc may legitimately document what
# is forbidden; we only care about forbidden patterns in EXECUTABLE code.
#
# Passes each candidate line through the filter:
#   - strips lines starting with // (line comment)
#   - strips lines starting with * or whitespace+* (JSDoc continuation)
#   - strips lines inside /** … */ blocks by anchoring on leading *
HANDLER_CODE=$(
  awk '
    /^[[:space:]]*\/\*/ { in_block = 1 }
    in_block { if (/\*\//) in_block = 0; next }
    /^[[:space:]]*\/\// { next }
    /^[[:space:]]*\*/ { next }
    { print NR ":" $0 }
  ' "$HANDLER_FILE"
)

FORBIDDEN_HELPERS=$(
  echo "$HANDLER_CODE" | grep -E "Math\.(round|floor|ceil|abs)|\.toFixed\(|parseFloat\(|parseInt\(" || true
)
NUMBER_COERCIONS=$(
  echo "$HANDLER_CODE" \
  | grep -E "Number\(" \
  | grep -vE "Number\.isFinite|Number\.is" \
  || true
)
if [ -n "$FORBIDDEN_HELPERS" ]; then
  fail 'run_analysis handler uses math/formatting helpers on PLoT response fields' "$FORBIDDEN_HELPERS"
fi
if [ -n "$NUMBER_COERCIONS" ]; then
  fail 'run_analysis handler uses Number(...) coercion on PLoT response fields' "$NUMBER_COERCIONS"
fi

MATH_IMPORTS=$(
  grep -nE "from ['\"](d3|mathjs|simple-statistics|lodash/round|lodash-es/round)" "$HANDLER_FILE" 2>/dev/null \
  || true
)
if [ -n "$MATH_IMPORTS" ]; then
  fail 'run_analysis handler imports math/statistical libraries' "$MATH_IMPORTS"
fi

# ---------------------------------------------------------------------------
# 5. Handler emits one of the locked assistant_text templates.
#
# Parses the handler file for the RUN_ANALYSIS_ASSISTANT_TEMPLATES constant
# and asserts exactly two entries (DEFAULT + NO_RESULTS). Drift here would
# mean new prose was added without going through the test allowlist — which
# would then drift from D7's regex guards.
# ---------------------------------------------------------------------------
TEMPLATE_COUNT=$(
  awk '
    /RUN_ANALYSIS_ASSISTANT_TEMPLATES = \{/,/\} as const/ { print }
  ' "$HANDLER_FILE" \
  | grep -cE "^\s+(DEFAULT|NO_RESULTS):"
)
if [ "$TEMPLATE_COUNT" -ne 2 ]; then
  fail "RUN_ANALYSIS_ASSISTANT_TEMPLATES must contain exactly 2 entries (DEFAULT + NO_RESULTS); found $TEMPLATE_COUNT" ''
fi

# ---------------------------------------------------------------------------
# 6. `result.enrichment` is assigned from a pass-through, not constructed
#
# Specifically, grep for the handler's enrichment assignment and verify it
# references `response` (the validated PLoT envelope) rather than building
# a new object literal from response fields.
# ---------------------------------------------------------------------------
ENRICHMENT_OK=$(
  awk '/enrichment: /{print}' "$HANDLER_FILE" \
  | grep -E "enrichment: response as Record" \
  || true
)
if [ -z "$ENRICHMENT_OK" ]; then
  fail 'result.enrichment is not a verbatim pass-through of the validated PLoT response' \
    "Expected a line matching 'enrichment: response as Record' in $HANDLER_FILE; none found."
fi

# ---------------------------------------------------------------------------
# 7. Placeholder scenario-reader must NOT be the production default when a
#    handler is registered on a newer surface (Resolution 1 / classifier
#    prompt update). The placeholder (`NOT_WIRED_SCENARIO_READER`) exists
#    by design in C2 to make the failure path visible while the real
#    Supabase-backed reader is pending a future slice — but shipping a
#    production registry with this default AFTER the classifier prompt
#    starts emitting `handler_id: run_analysis` would fail real traffic
#    with HANDLER_INVOCATION_FAILED(cause_kind='scenario_read_failed').
#
#    This guard fires when BOTH:
#      (a) the classifier prompt already teaches the handler variant (i.e.
#          the prompt mentions `handler_id` and `run_analysis` — the
#          Paul-authored update has landed)
#      (b) the production registry factory still binds
#          `NOT_WIRED_SCENARIO_READER` as the default `scenarioReader`.
#
#    If only (a) is true, the placeholder is still safe (no real reader
#    needed yet). If only (b) is true, the combo is inert until (a) also
#    lands. Both together = unmergeable without wiring a real reader.
# ---------------------------------------------------------------------------
REGISTRY_FILE='src/orchestrator-v5/tools/registry.ts'
PROMPT_FILE='src/prompts/defaults.ts'

HANDLER_IN_PROMPT=$(
  grep -n 'handler_id' "$PROMPT_FILE" 2>/dev/null \
  | grep -iE 'run_analysis|"handler"' \
  || true
)
PLACEHOLDER_IS_DEFAULT=$(
  awk '
    /function createRegistry/ { in_fn = 1 }
    in_fn && /scenarioReader = /{print; if (/NOT_WIRED_SCENARIO_READER/) print "HIT"}
    in_fn && /^}/ { in_fn = 0 }
  ' "$REGISTRY_FILE" \
  | grep -c '^HIT$' \
  || true
)

if [ -n "$HANDLER_IN_PROMPT" ] && [ "${PLACEHOLDER_IS_DEFAULT:-0}" -gt 0 ]; then
  fail 'placeholder scenario reader is the production default AFTER classifier prompt update landed' \
    "Classifier prompt now emits handler_id on run_analysis (per $PROMPT_FILE), but createRegistry() in $REGISTRY_FILE still defaults scenarioReader to NOT_WIRED_SCENARIO_READER. Real traffic will fail with HANDLER_INVOCATION_FAILED(cause_kind='scenario_read_failed'). Wire a real Supabase-backed scenarioReader before merging."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
if [ "$EXIT" -eq 0 ]; then
  echo 'Handler ownership invariant OK:'
  echo '  - runAnalysisHandler imported only by registry.ts'
  echo '  - no direct HTTP calls; no UI-repo refs; no math/formatting helpers'
  echo '  - template enum has exactly 2 entries'
  echo '  - result.enrichment is a verbatim pass-through of the PLoT envelope'
  echo '  - placeholder scenario reader acceptable (classifier prompt still direct_answer/clarify only)'
fi

exit "$EXIT"
