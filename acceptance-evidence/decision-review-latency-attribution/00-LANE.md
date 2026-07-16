# Lane: surface decision_review as its own llm_calls entry + de-absorb compose_ms

Follow-up to PR #471. Base: `origin/staging` @ eb8672d0 (fresh blobless clone).

## Precondition — VERIFIED AT THE BYTES
- Config default `runAnalysisAwaitDecisionReview: booleanString.default(false)` (src/config/index.ts:742).
- render-staging.yaml does NOT set the flag — BUT the YAML is not the deployed source of truth
  (it also pins LLM_PROVIDER=fixtures, yet staging serves real LLMs → dashboard overrides YAML).
- Render API single-key GET on cee-staging (srv-d4slpaili9vc73eiq4og):
  `GET /v1/services/{srv}/env-vars/V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW` → HTTP 200, value='true'.
- => Enricher runs SYNCHRONOUSLY (awaited) on staging wall-clock. Precondition MET. Proceeding.
- (Stale note corrected: Docs/v5/v5-context-reliability-audit.md's 2026-05-30 "absent → false" is out of date.)

## Await call site (verified)
- turn-executor.ts: `handlerFactsForCommit = await enrichRunAnalysisWithDecisionReview({...})`
  inside the `else` of `if (!config.cee.runAnalysisAwaitDecisionReview)` (~line 6367).

## What shipped (verified at the bytes)
### (a) V5TurnTimings — `src/orchestrator-v5/telemetry/turn-timings.ts`
Added `decision_review_ms`, `decision_review_model`, `decision_review_provider`,
`decision_review_input_tokens`, `decision_review_output_tokens` (all optional).
Captured in `turn-executor.ts` by wrapping the awaited
`enrichRunAnalysisWithDecisionReview` call in `Date.now()` deltas, gated on
`timingsEnabled` (production default `V5_TIMING_DEBUG=false` && trace off →
byte-identical: one `timingsEnabled ? Date.now() : 0` ternary, no sink passed).

### (b) Second llm_calls entry — `src/orchestrator-v5/diagnostics/v5-diagnostic-trace.ts`
`populateCollectorFromTurnTimings` now emits a SECOND `llm_calls` entry, role
`decision_review`, when `decision_review_ms` is present.

CAPTURED FIELDS = latency + role + REAL model/provider/input_tokens/output_tokens
(NOT latency-only). Chosen because threading was CLEAN:
  - `invokeDecisionReview` / `invokeDecomposedDecisionReview` both return the
    identical `DecisionReviewInvokeResult` (model, provider, input_tokens,
    output_tokens) — the enricher's own comment guarantees shape parity.
  - Threaded via an ADDITIVE OPTIONAL `callTelemetrySink` out-param on
    `EnrichDecisionReviewInput` (NOT a return-type change, which would ripple
    across 7 early-returns + the chip-click caller + 8 test suites). Non-passing
    callers (chip-click, all tests) stay byte-identical.
  - Sink is populated ONLY right after the invoke RETURNS (before the
    output===null branch, since tokens are spent regardless). Skip / abort paths
    leave it empty → the executor gates the surfaced fields on
    `callTelemetrySink.model !== undefined`, so NO phantom `decision_review`
    entry is ever attributed to a call that did not happen, and NO token
    zero-fill occurs. `latency_ms` is the executor's wall-clock (includes
    adapter/parse/attach), which is more honest than the LLM's self-reported
    `llm_latency_ms`.

### (c) compose_ms de-absorption — CHOSEN: SUBTRACT
`turn-executor.ts` commit anchor now sets
`compose_ms = Math.max(0, commitStartedAt - composeStartedAt - decisionReviewMs)`.
Rationale: `compose_ms` is documented as "response composition"; the
decision_review enricher is a synchronous LLM call, NOT composition. Subtraction
makes compose_ms measure only real composition work; the latency is surfaced
separately (decision_review_ms + the dedicated llm_calls entry). A named substage
would have required reshaping benchmarking.substage_timings — subtraction is the
surgical, honest fix. `decisionReviewMs` is 0 unless a decision_review was awaited
this turn, so every other turn's compose_ms is unchanged.

## RED-first + MUTATION-CHECK
Test: `src/orchestrator-v5/__tests__/turn-executor-decision-review-latency-attribution.test.ts`
Drives a REAL `runTurnExecutor` run_analysis turn under
`V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW=true` + `CEE_DIAGNOSTIC_TRACE_ENABLED=true`,
mocking `invokeDecisionReview` (1000ms delay + known model/provider/tokens),
then builds the minimal trace exactly as route-v2's `sendFinalised200` does.
Observed stage_timings: `decision_review_ms:1003, model:gpt-4.1, provider:openai,
input_tokens:4321, output_tokens:876, compose_ms:83` (83 << 1003 → de-absorbed).

Reverting each production edit turns it RED (each isolated, restored after):
  1. compose_ms subtraction   → `expected 1125 to be less than 1004` (compose re-absorbed 1000ms)
  2. diagnostic-trace entry    → `expected 1 to be greater than or equal to 2` (only routing entry)
  3. executor turnTimings pop.  → decision_review_ms undefined (assertion 1 fails)
  4. enricher sink population   → decision_review_ms undefined (assertion 1 fails)

## Gates (all green, honest configs)
- `tsc -p tsconfig.build.json --noEmit` (real gate, after openapi:generate + schemas-resolution): exit 0
- full `tsc --noEmit`: MY test file adds ZERO errors (grep clean)
- `pnpm test:required`: 1073 files / 20491 tests passed, 0 failed
- `eslint` on all 5 touched files: exit 0
- forbidden-boundary ratchet: 0/95/17 == baseline (my `?? 0` is on token fields, not the
  science ERE `robustness|confidence|freshness|evpi|value_of_information|stale`; test file
  is `__tests__`-excluded from the ratchet)
- node_modules: staged file count == 0 (explicit-path staging; pnpm install mutated the
  git-tracked node_modules but none is staged)

## #473 rebase-reconcile note
PR #473 (held, unmerged, #343) also edits turn-executor.ts. This lane works from staging
(which does NOT contain #473). On #473's rebase, reconcile the turn-timings changes:
this lane adds `let decisionReviewMs = 0;` (near composeStartedAt), the timed enricher-await
wrap + finally block (~turn-executor.ts:6358-6432), and the compose_ms subtraction
(~7460). None touch the decision_review PROMPT, GM/referee, or output gates.
