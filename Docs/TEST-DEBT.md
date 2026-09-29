# Test debt — pre-existing failures

Tracked: 2026-02-19
Context: These failures predate the Phase 1-3 contract and golden test work. None were introduced by recent changes.

## Failing test files (17)

### Model routing / selection (3 files, 15 failures)

Tests expect outdated model names (e.g. `gpt-4o-mini`) after model defaults were updated upstream.

1. `tests/unit/model-selector.test.ts` — expects old fast-tier model IDs and override behavior (12 failures)
2. `tests/unit/model-routing.test.ts` — TASK_MODEL_DEFAULTS and getDefaultModelForTask expect old defaults (2 failures)
3. `tests/unit/llm-router.test.ts` — expects `gpt-5-mini` for clarification but router returns different default (1 failure)

### Validation / classifier (5 files, 11 failures)

Validator and classifier tests have outdated expectations after validation logic changes.

4. `tests/unit/cee.edge-direction-validator.test.ts` — direction validation warnings changed shape (5 failures)
5. `tests/unit/cee.classifier.test.ts` — warning code classification defaults changed (3 failures)
6. `tests/unit/cee.branch-probability-validator.test.ts` — branch normalisation warning format changed (1 failure)
7. `tests/unit/cee.numerical-validator.test.ts` — grounding warning assertion outdated (1 failure)
8. `tests/unit/cee.verification.pipeline.test.ts` — branch_probabilities trace format changed (1 failure)

### Integration tests (4 files, 11 failures)

Integration tests require provider context or response shapes that have shifted.

9. `tests/integration/cee.review-results-panel.test.ts` — review response shape changed across multiple content types (8 failures)
10. `tests/integration/cee.draft-graph.coefficients.test.ts` — coefficient preservation assertion outdated (1 failure)
11. `tests/integration/cee.hero-journey.degraded.test.ts` — degraded mode trace format changed (1 failure)
12. `tests/integration/cee.status-consistency.test.ts` — draft-graph / graph-readiness status consistency assertion (1 failure)

### Pre-decision / review blocks (2 files, 4 failures)

Test fixtures don't match current nudge and block builder output.

13. `tests/unit/cee.pre-decision-checks.test.ts` — framing nudge required fields changed (3 failures)
14. `tests/unit/cee.review-blocks.test.ts` — orphan node detection behavior changed (1 failure)

### Graph caps / protected kinds (2 files, 4 failures)

GRAPH_MAX_NODES was raised but test assertions still use the old cap value.

15. `tests/invariants/cee/caps-consistency.test.ts` — simpleRepair expected node count <= 50 but cap is now higher (1 failure)
16. `tests/invariants/cee/protected-kinds.test.ts` — pruning and compliance assertions use old cap (3 failures)

### Version (1 file, 1 failure)

17. `tests/version.regression.test.ts` — hardcoded version string doesn't match current SERVICE_VERSION (1 failure)

### Flaky (not counted above)

- `tests/unit/cee.request-budget.test.ts` — "throws UpstreamTimeoutError" test intermittently times out at 5s threshold
- `tests/unit/request-timing.test.ts` — elapsed_ms timing assertion sensitive to CI load (~50ms threshold)
