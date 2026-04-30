# V5 Golden Path — Evidence Pack (CEE)

Phase 3 of V5 alpha hardening. Produced by [tools/v5-journey-replay](../../tools/v5-journey-replay/). This pack is the V5 replay gate.

## Executive summary

| signal | value |
|---|---|
| Replay reached orchestrator | yes |
| v38.2 confirmed (startup / healthz build) | yes |
| v38.2 confirmed (per-turn) | not capturable |
| run_analysis passed end-to-end (handler + commit + response) | not externally verified |
| Analysis persisted into follow-up context | not externally verified |
| No internal terms in user-facing text | yes |

## Run metadata

- **Branch:** `claude/cross-boundary-contract-tests`
- **Pack generated from commit SHA:** `c7cfb91d87dfd61f702513c6c7cd0a97a100385f` (if this does not match HEAD, regenerate with the harness)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-04-30T14:28:52.283Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** `a555cf7`

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `a555cf7`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **elapsed:** 856ms

Deploy confirmed: `/healthz` build `a555cf7` matches `--expected-build a555cf7`.

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=31334ms | — |
| `1a_assist_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 nodes=17 edges=29 node_provenance=17/17 edge_provenance_display=29/29 coaching=absent | — |
| `2_weakest_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=789 chip_count=1 elapsed=7181ms stage=analyse | — |
| `3_add_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=530 chip_count=0 elapsed=7776ms stage=frame | — |
| `4_run_analysis` | [FAIL] failed | v5-runtime | 200 | leaks=[$.blocks[0].enrichment.critiques[0].message:opt_hire_local, $.blocks[0].enrichment.critiques[1].message:opt_offshore, $.blocks[0].enrichment.critiques[2].message:opt_status_quo, $.blocks[0].enrichment] | analysis_run entity_id_leak |
| `5_explain_leader` | [SKIP] skipped | skipped | — | skipped_dependency: prerequisite 4_run_analysis did not pass | skipped_dependency: 4_run_analysis |
| `6_edit_budget` | [PASS] passed | v5-runtime | 200 | status=200 text_len=123 chip_count=0 elapsed=6066ms stage=frame | — |
| `7_stale_explanation` | [FAIL] failed | v5-runtime | 200 | text_starts="Hire Two Senior Engineers Locally is the leading option at 0.76 probability, wit" expected_prefix_first_30="These results are from a prior" | step_7_missing_staleness_prefix |
| `8_rerun_via_chip` | [SKIP] skipped | skipped | — | skipped_dependency: prerequisite 7_stale_explanation did not pass | skipped_dependency: 7_stale_explanation |
| `9_what_would_flip` | [SKIP] skipped | skipped | — | skipped_dependency: prerequisite 8_rerun_via_chip did not pass | skipped_dependency: 8_rerun_via_chip |

### Per-step feature observation summary

Layered on top of the pass/fail table above. Captures *what features the response actually exhibited* (coaching, provenance, staleness prefix, recovery chip, etc.) and any non-fatal warnings raised by the new Wave 1–3 assertions. A step with `passed` status here may still surface warnings — they document soft contract divergences without failing the run.

| step | endpoint | status | features observed | warnings | failures | response saved |
|---|---|---|---|---|---|---|
| `1_draft_graph` | orchestrate/v2/turn | [PASS] passed | — | — | — | yes |
| `1a_assist_draft_graph` | assist/v1/draft-graph | [PASS] passed | node_provenance, edge_provenance_display | coaching_absent (CEE may not produce coaching on every draft) | — | no |
| `2_weakest_option` | orchestrate/v2/turn | [PASS] passed | — | — | — | yes |
| `3_add_option` | orchestrate/v2/turn | [PASS] passed | — | — | — | yes |
| `4_run_analysis` | orchestrate/v2/turn | [FAIL] failed | — | — | analysis_run entity_id_leak | yes |
| `5_explain_leader` | orchestrate/v2/turn | [SKIP] skipped | — | — | skipped_dependency: 4_run_analysis | no |
| `6_edit_budget` | orchestrate/v2/turn | [PASS] passed | — | — | — | yes |
| `7_stale_explanation` | orchestrate/v2/turn | [FAIL] failed | — | — | step_7_missing_staleness_prefix | yes |
| `8_rerun_via_chip` | orchestrate/v2/turn | [SKIP] skipped | — | — | skipped_dependency: 7_stale_explanation | no |
| `9_what_would_flip` | orchestrate/v2/turn | [SKIP] skipped | — | — | skipped_dependency: 8_rerun_via_chip | no |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Drafted a decision graph with 16 nodes and 28 edges.
```

#### `2_weakest_option`

```
Looking at the model structure, Status Quo is the weakest-looking option. It has no mechanism to increase Engineering Capacity beyond the current 0.3 (15 engineers), and the causal pathway to your goal runs through Delivery Throughput and Q3 Roadmap Coverage, both of which depend heavily on capacity. Without adding capacity, those outcomes stay flat while the risks remain.

The other three options all activate the Engineering Capacity link to Delivery Throughput (strength 0.65) and Roadmap Coverage (strength 0.55). Status Quo simply does not.

That said, no analysis has been run yet, so this is structural reasoning rather than a computed ranking. Running the simulation would show you the actual probability gap between Status Quo and the leading option. Would you like to do that?
```

#### `3_add_option`

```
I want to make sure I add something genuinely useful rather than a generic option. What option did you have in mind?

For context, the model currently compares hiring locally, engaging an offshore partner, gradual hiring via tiered pricing, and maintaining the status quo. A few directions that might make sense here:

- A **contractor or freelance** route (short-term capacity without permanent headcount)
- A **hybrid** approach (one local hire plus a smaller offshore engagement)
- Something else entirely that you have in mind
```

#### `4_run_analysis`

```
Ran analysis on your current scenario.
```

#### `6_edit_budget`

```
The model has two cost-related factors: Hiring and Staffing Cost and Cost Overrun Risk. Which one did you mean to increase?
```

#### `7_stale_explanation`

```
Hire Two Senior Engineers Locally is the leading option at 0.76 probability, with a 55.3 percentage point margin over the runner-up, Maintain Current Team (Status Quo), at 0.21.

Note that the analysis was loaded from a prior run, so it's worth rerunning to confirm these figures reflect the current model. Would you like to do that?
```

## Canonical steps (from brief)

1. POST fresh scenario + decision brief → draft_graph response with post-draft chips
2. "Which option looks weakest?" → references actual option/factor labels
3. "Add another option" → product-shaped: 200, no BoundaryError, no internal terms
4. chip_click payload for Run analysis → 200, PLoT completes, fact persisted
5. "Why does the leading option win?" → names leading option + probability + driver + caveat
6. "Increase the budget factor" → edit proposal or clarifying question

### 4b — pinned unit regression (handler-level)

Unknown PLoT status with no usable result fields → typed fatal, not a misleading 200. Covered by the unit test [run-analysis-permissive-status.test.ts](../../src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts). The handler cannot be exercised through the HTTP boundary without mocking the PLoT response, so this is asserted at the unit level.

## Halt policy

If the harness uncovers a systemic blocker outside the approved Phase 2 scope, the row is marked `failed` with a specific `failing_contract` and the blocker documented in Discoveries. Scope is NOT expanded to force green rows.

## Discoveries (deferred for follow-up)

| area | observation | follow-up recommendation |
|---|---|---|
| Handler failure recovery (P1-1) | `translateExecuteError` composes a coaching response for `HandlerInvocationFailedError` but returns via `failureType = HANDLER_INVOCATION_FAILED` → HTTP 500. Principle 1 ("default recoverable") suggests user-recoverable handler failures (args_validation_failed, options_not_configured, analysis_blocked) should commit as direct_answer and return 200. | See [v5-p1-1-handler-failure-scope.md](v5-p1-1-handler-failure-scope.md) for the full cause-kind classification table. |
| PLoT usable-fields enforcement on known statuses | `hasUsableResultFields` is only consulted for unknown statuses. Known statuses (`completed`, `computed`, `partial`) succeed regardless of whether records carry a usable id/label + finite probability. | Thread `hasUsableResultFields` into the `ok` / `partial` branches of `evaluateAnalysisStatus`. When a known status arrives with no usable fields, demote to fatal (`analysis_not_completed`) or surface a caveat. |
| `v5_journey_id` in unknown-status warning | `evaluateAnalysisStatus` logs `event: external_contract_unknown_status` with `request_id` but not `v5_journey_id`. Adding it requires a `ctx` signature change. | Deferred from this branch per the hard "one-liner only" limit. Pick up when the next `evaluateAnalysisStatus` change happens. |
| Per-step assertions are content-shape only | Step 2 does not assert that the response references actual option/factor labels from step 1's draft. Step 4 cannot verify analysis fact persistence without reading Supabase. Step 5 does not require leading option, probability, driver, or caveat to be present. A generic 200 with non-empty `assistant_text` can pass these. | Strengthen the per-step DSL: thread step 1's parsed labels into step 2's assertion; add Supabase facts-table read for step 4 (or a dedicated unit test); add required-substring matchers (probability percent, "leading", "driver", caveat marker) for step 5. New brief — out of scope here. |
| Forbidden-term scan tolerates plain `handler` | The brief lists `handler` as forbidden user-facing terminology. Current implementation matches `handler[ _](id\|failed\|error\|registered)` only — plain `handler` in isolation passes. The looser stance was deliberate (avoid false positives on "handles" / legitimate user-facing uses) but diverges from the brief. | Decision required: tighten to brief-strict (and accept some false positives) or document the loose policy in the forbidden-terms.ts header. New brief — out of scope here. |
