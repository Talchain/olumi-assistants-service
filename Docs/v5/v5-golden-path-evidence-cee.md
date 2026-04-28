# V5 Golden Path — Evidence Pack (CEE)

Phase 3 of V5 alpha hardening. Produced by [tools/v5-journey-replay](../../tools/v5-journey-replay/). This pack is the V5 replay gate.

## Executive summary

| signal | value |
|---|---|
| Replay reached orchestrator | yes |
| v38.2 confirmed (startup / healthz build) | yes |
| v38.2 confirmed (per-turn) | not capturable |
| run_analysis passed end-to-end (handler + commit + response) | yes |
| Analysis persisted into follow-up context | not externally verified |
| No internal terms in user-facing text | yes |

## Run metadata

- **Branch:** `staging`
- **Pack generated from commit SHA:** `db7825b9b2e2e45cf86f3f515e35e4185cde03ac` (if this does not match HEAD, regenerate with the harness)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-04-28T09:55:05.027Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** `db7825b`

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `db7825b`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **elapsed:** 346ms

Deploy confirmed: `/healthz` build `db7825b` matches `--expected-build db7825b`.

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=31294ms | — |
| `2_weakest_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1163 chip_count=1 elapsed=10081ms stage=analyse | — |
| `3_add_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=134 chip_count=0 elapsed=5073ms stage=frame | — |
| `4_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=38 chip_count=0 analysis_ready=ready options=4 elapsed=4092ms | — |
| `5_explain_leader` | [FAIL] failed | v5-runtime | 200 | status=200 text_len=141 (expected > 200) chip_count=1 | step_5_text_too_short |
| `6_edit_budget` | [PASS] passed | v5-runtime | 200 | status=200 text_len=181 chip_count=0 elapsed=13731ms stage=frame | — |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Drafted a decision graph with 14 nodes and 28 edges.
```

#### `2_weakest_option`

```
No analysis has been run yet, so there are no probability results to draw from. What the model does show is the causal structure, and that points to a clear answer.

**Maintain Current Team (Status Quo)** looks weakest against your goal of delivering Q3 roadmap commitments on time.

Here is why the structure points that way: Engineering Team Capacity is the strongest driver in the model, with a 0.65 effect on Q3 Roadmap Delivery and a -0.5 drag on Roadmap Slip risk, both at high confidence. Status Quo does nothing to move that factor. Every other option at least attempts to shift capacity or velocity in a positive direction.

Status Quo also leaves Customer Demand Growth as an unmitigated pressure. If demand is rising and your team size is not, the Roadmap Slip risk accumulates with no counterweight.

The one thing Status Quo has going for it is zero Headcount Investment, which keeps Budget Overrun Risk low. But under your current model, that saving does not offset the delivery exposure.

Running the analysis would give you actual probabilities across all four options rather than structural inference. Worth doing before drawing firm conclusions?
```

#### `3_add_option`

```
Which option would you like to add? A brief description is enough, for example "Contract a freelance team" or "Delay hiring until Q4".
```

#### `4_run_analysis`

```
Ran analysis on your current scenario.
```

#### `5_explain_leader`

```
I wasn't sure what you meant by Engineering Team Scaling Strategy. Try asking about a specific option, or describe what you'd like to change.
```

#### `6_edit_budget`

```
Which factor did you have in mind? The model has two that relate to budget:

- **Headcount Investment** (the cost of hiring)
- **Budget Overrun Risk** (the risk of exceeding budget)
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
