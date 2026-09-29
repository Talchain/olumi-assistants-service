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

# Comment handling: negative-proof scans (checks 2–4) match against the
# COMMENT-STRIPPED view of the handler via
# scripts/ci/strip-source-comments.mjs (literal-aware tokeniser). A JSDoc or
# trailing comment documenting a forbidden pattern — which the old `^ *//`
# filters could not see — can never fail the gate; real code still does.
STRIPPER="scripts/ci/strip-source-comments.mjs"
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required (matching runs via $STRIPPER)"; exit 1; }

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
  node "$STRIPPER" --scan "fetch\(|axios|node-fetch|undici" "$HANDLER_FILE" 2>/dev/null \
  || true
)
if [ -n "$DIRECT_HTTP" ]; then
  fail 'run_analysis handler makes direct HTTP calls — must route through PLoTClient' "$DIRECT_HTTP"
fi

# ---------------------------------------------------------------------------
# 3. No UI repo references
# ---------------------------------------------------------------------------
UI_REFS=$(
  node "$STRIPPER" --scan "DecisionGuideAI|decision-guide-ai" "$HANDLER_FILE" 2>/dev/null \
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
# Comments are stripped BEFORE matching (via $STRIPPER): JSDoc and trailing
# comments may legitimately document what is forbidden; we only care about
# forbidden patterns in EXECUTABLE code. The old awk filter dropped whole
# comment LINES but could not see a trailing comment on a code line — the
# tokeniser can.
FORBIDDEN_HELPERS=$(
  node "$STRIPPER" --scan "Math\.(round|floor|ceil|abs)|\.toFixed\(|parseFloat\(|parseInt\(" "$HANDLER_FILE" 2>/dev/null || true
)
NUMBER_COERCIONS=$(
  node "$STRIPPER" --scan "Number\(" "$HANDLER_FILE" 2>/dev/null \
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
  node "$STRIPPER" --scan "from ['\"](d3|mathjs|simple-statistics|lodash/round|lodash-es/round)" "$HANDLER_FILE" 2>/dev/null \
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
# 6b. The claim-safety verdict is written INSIDE the validated fact — and
#     nothing is bolted onto enrichment after validation.
#
# ⚠ REWRITTEN 2026-07-27 BECAUSE THIS CHECK HAD GONE VACUOUS IN UNDER 24 HOURS.
#
# #710 (2026-07-26) carried the constraint verdict as a post-validation stamp on
# `result.enrichment.__cee_claim_safety`, applied by a helper
# `stampClaimSafetyOnEnrichment`, and pinned "applied exactly once" by counting
# references to that helper. #712 — the SAME NIGHT — moved the verdict to the
# first-class `result.constraint_verdict` field (schemas 0.25.0) and DELETED the
# helper. The count check was left behind: with zero references `STAMP_COUNT`
# was 0, `0 -gt 2` is false, and the guard PASSED BY POLICING A SYMBOL THAT NO
# LONGER EXISTS. Trap 13 (an absence assertion that never proved it could see a
# presence) and trap 14 (the comment still said the typed field was "blocked
# behind V5-CI-01" — unblocked by #712) in one block, inside a gate wired into
# validate-prepush.sh.
#
# It is replaced rather than deleted: the underlying invariant — the verdict is
# CEE-owned, written ONCE, and never smuggled into the PLoT pass-through — is
# still real, it just has a new mechanism. Every check below FAILS ON ZERO, so
# "the thing I police no longer exists" is now RED, not green.

# (i) NON-VACUITY + exactly-once: the verdict is a first-class field on the
#     fact, written inside the single safeParse. Zero occurrences fails.
VERDICT_WRITE='constraint_verdict: projectClaimSafety(constraintVerdict),'
VERDICT_COUNT=$(grep -cF "$VERDICT_WRITE" "$HANDLER_FILE" || true)
if [ "$VERDICT_COUNT" -ne 1 ]; then
  fail "the claim-safety verdict is not written exactly once (found $VERDICT_COUNT)" \
    "Expected exactly one '$VERDICT_WRITE' in $HANDLER_FILE.
0 means the mechanism this check polices has MOVED — do not leave this guard
counting a symbol that no longer exists (that is the defect this block replaced).
Re-derive where the verdict is written and re-point the check.
>1 means two derivations can disagree inside one response (CLAUDE.md trap #12)."
fi

# (ii) The post-validation enrichment bolt must not come back. Matched on the
#      COMMENT-STRIPPED view: run-analysis.ts legitimately DISCUSSES the old
#      `__cee_claim_safety` channel in prose (and the read-side ramp in
#      constraint-feasibility.ts still honours facts persisted under it), so a
#      raw grep here would fail on a docstring.
ENRICHMENT_STAMP_WRITES=$(
  node "$STRIPPER" --scan "__cee_claim_safety" "$HANDLER_FILE" 2>/dev/null \
  || true
)
if [ -n "$ENRICHMENT_STAMP_WRITES" ]; then
  fail 'run_analysis handler writes the claim-safety stamp onto enrichment' \
    "$ENRICHMENT_STAMP_WRITES
The verdict is a first-class \`result.constraint_verdict\` field since schemas
0.25.0 and is validated by the handler's single safeParse. Writing it onto
\`enrichment\` re-opens the post-validation edit that §6 exists to forbid, and
splits the verdict across two homes that can disagree."
fi

UNNAMESPACED_ENRICHMENT_WRITES=$(
  grep -nE 'enrichment:\s*\{\s*\.\.\.' "$HANDLER_FILE" \
  || true
)
if [ -n "$UNNAMESPACED_ENRICHMENT_WRITES" ]; then
  fail 'run_analysis handler spreads into result.enrichment inline' \
    "$UNNAMESPACED_ENRICHMENT_WRITES
Enrichment must stay the verbatim PLoT pass-through at schema-validation time.
CEE-owned fields (graph_hash_at_run, computed_at, constraint_verdict) are
declared members of RunAnalysisResultSchema — put new ones there, never in
enrichment."
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
# 8. Phase 1 — Anthropic SDK confined to route-with-tool-use.ts
#
# The Phase 1 routing spine is the single entry point for Anthropic tool-use
# calls inside orchestrator-v5. Handler internals must not call the SDK
# directly (they go through PLoTClient / other backends). This guard catches
# drift where a new handler tries to fan out its own Anthropic call.
# ---------------------------------------------------------------------------
ROGUE_ANTHROPIC=$(
  grep -RIn --include='*.ts' --exclude='*.test.ts' --exclude-dir='__tests__' \
    -E "from '@anthropic-ai/sdk'" src/orchestrator-v5/ 2>/dev/null \
  || true
)
if [ -n "$ROGUE_ANTHROPIC" ]; then
  fail 'Anthropic SDK imported outside Phase 1 routing seam' "$ROGUE_ANTHROPIC"
fi

# ---------------------------------------------------------------------------
# 9. Phase 1 — context pack assembler is free of UI / LLM imports
#
# ContextPack is a pure projection. Any LLM or UI import in this module is
# a smell that will cascade into test mocks and cycle dependencies.
# ---------------------------------------------------------------------------
CTXPACK_FILE='src/orchestrator-v5/context/context-pack-assembler.ts'
if [ -f "$CTXPACK_FILE" ]; then
  CTX_BAD=$(
    grep -nE "from '[^']*(adapters/llm|DecisionGuideAI|decision-guide-ai)" "$CTXPACK_FILE" 2>/dev/null \
    || true
  )
  if [ -n "$CTX_BAD" ]; then
    fail 'context-pack-assembler.ts imports an LLM or UI module' "$CTX_BAD"
  fi
fi

# ---------------------------------------------------------------------------
# 10. Phase 1 — validator has no LLM imports and no numeric coercions
#
# Validator is pure. LLM calls, network calls, and Math.round/.toFixed/
# parseFloat would all indicate the validator has started reasoning about
# values rather than structural conformance — semantic drift.
# ---------------------------------------------------------------------------
VALIDATOR_FILE='src/orchestrator-v5/routing/validator.ts'
if [ -f "$VALIDATOR_FILE" ]; then
  VAL_LLM=$(
    grep -nE "from '[^']*(adapters/llm|routing/route-with-tool-use)" "$VALIDATOR_FILE" 2>/dev/null \
    || true
  )
  if [ -n "$VAL_LLM" ]; then
    fail 'validator.ts imports an LLM module' "$VAL_LLM"
  fi

  VAL_CODE=$(
    awk '
      /^[[:space:]]*\/\*/ { in_block = 1 }
      in_block { if (/\*\//) in_block = 0; next }
      /^[[:space:]]*\/\// { next }
      /^[[:space:]]*\*/ { next }
      { print NR ":" $0 }
    ' "$VALIDATOR_FILE"
  )
  VAL_COERCIONS=$(
    echo "$VAL_CODE" | grep -E "Math\.(round|floor|ceil)|\.toFixed\(|parseFloat\(" || true
  )
  if [ -n "$VAL_COERCIONS" ]; then
    fail 'validator.ts uses numeric coercion (Math.round/.toFixed/parseFloat)' "$VAL_COERCIONS"
  fi
fi

# ---------------------------------------------------------------------------
# 11. Phase 1 — canonical enum quarantine (Resolution E + correction 4)
#
# The nine canonical enum NAMES from spec §5 must be DEFINED in exactly
# one file: src/orchestrator-v5/routing/types.ts. Other files may import
# the names; they must not contain their own declarations.
#
# Catch pattern: a declaration is either `export const <Name>` or
# `export type <Name>` or `export enum <Name>` in a non-canonical file.
# ---------------------------------------------------------------------------
CANONICAL_FILE='src/orchestrator-v5/routing/types.ts'
CANONICAL_ENUMS=(
  'IntentClass'
  'CoachingMode'
  'EntityKind'
  'ParameterOperator'
  'ResolutionStatus'
  'ResolutionMethod'
  'AmbiguityType'
  'ParameterSource'
  'ContextPackField'
)

for name in "${CANONICAL_ENUMS[@]}"; do
  # Presence in canonical file
  if ! grep -qE "^export (const|type|enum) ${name}(Schema)?\\b" "$CANONICAL_FILE" 2>/dev/null; then
    fail "canonical enum '${name}' missing from $CANONICAL_FILE" \
      "Spec §5 enum must be defined in $CANONICAL_FILE (as a const Zod schema + inferred type)."
  fi
  # Drift detection outside canonical file
  DRIFT=$(
    grep -RIln --include='*.ts' --exclude-dir='__tests__' --exclude='*.test.ts' \
      -E "^export (const|type|enum) ${name}(Schema)?\\b" src/orchestrator-v5/ 2>/dev/null \
    | grep -v "^${CANONICAL_FILE}$" \
    || true
  )
  if [ -n "$DRIFT" ]; then
    fail "canonical enum '${name}' redeclared outside $CANONICAL_FILE" "$DRIFT"
  fi
done

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
  echo '  - Phase 1: Anthropic SDK confined to route-with-tool-use.ts'
  echo '  - Phase 1: context-pack-assembler + validator free of LLM/UI imports'
  echo '  - Phase 1: canonical §5 enums defined only in routing/types.ts'
fi

exit "$EXIT"
