# V5 Golden Path — Evidence Pack (CEE)

Phase 3 of V5 alpha hardening. Produced by [tools/v5-journey-replay](../../tools/v5-journey-replay/). This pack is the V5 replay gate.

## Executive summary

| signal | value |
|---|---|
| Replay reached orchestrator | yes |
| v38.2 confirmed (startup / healthz build) | yes |
| v38.2 confirmed (per-turn) | not capturable |
| run_analysis passed end-to-end (handler + commit + response) | yes |
| Analysis persisted into follow-up context | yes |
| No internal terms in user-facing text | yes |

## Run metadata

- **Branch:** `staging`
- **Pack generated from commit SHA:** `ca25e31e28527ea3f3e2af0712cc6c9720c42898` (if this does not match HEAD, regenerate with the harness)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-04-28T13:50:47.002Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** `ca25e31`

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `ca25e31`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **elapsed:** 323ms

Deploy confirmed: `/healthz` build `ca25e31` matches `--expected-build ca25e31`.

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=32423ms | — |
| `2_weakest_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1097 chip_count=1 elapsed=9974ms stage=analyse | — |
| `3_add_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=347 chip_count=0 elapsed=5328ms stage=frame | — |
| `4_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=38 chip_count=0 analysis_ready=ready options=4 elapsed=5420ms | — |
| `5_explain_leader` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1496 labels_checked=4 chip_count=1 | — |
| `6_edit_budget` | [PASS] passed | v5-runtime | 200 | status=200 text_len=79 chip_count=0 elapsed=5673ms stage=frame | — |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Drafted a decision graph with 16 nodes and 29 edges.
```

#### `2_weakest_option`

```
No analysis has been run yet, so there are no probability scores or sensitivity rankings to draw from. What I can do is read the model's causal structure directly.

**Maintain Current Team (Status Quo) looks structuwest on paper.** It makes no change to Engineering Team Capacity, which is the strongest driver in the model: that factor carries a 0.65 strength connection to Q3 Roadmap Delivery Throughput and a -0.5 connection to Q3 Delivery Delay Risk, both at high confidence (0.92 and 0.90 respectively). Staying put means neither of those levers moves in your favour, while the Q3 deadline pressure remains unchanged.

The model also shows no offsetting benefit for Status Quo: it doesn't reduce Hiring and Staffing Cost in a meaningful way relative to the other options, and it doesn't improve Team Capability and Code Quality either.

That said, this is a structural reading, not a computed result. Running the simulation would tell you by how much Status Quo trails, and whether any option separates clearly from the others or whether the result is close.

Want me to run the analysis now?
```

#### `3_add_option`

```
What option would you like to add? A few directions that would complement the existing four:

- **Contract-to-hire** (trial engineers before committing to permanent headcount)
- **Internal redeployment** (shift engineers from lower-priority teams)
- **Hybrid** (one local senior hire plus a smaller offshore engagement)

What did you have in mind?
```

#### `4_run_analysis`

```
Ran analysis on your current scenario.
```

#### `5_explain_leader`

```
**Engineering Team Capacity is doing almost all the work.**

Hiring Two Senior Engineers Locally leads at 78.2% primarily because it is the option that most directly and reliably increases Engineering Team Capacity, which the model identifies as the single dominant driver with a sensitivity value of 1.0. That factor connects to your goal through three separate pathways: it moderately increases Q3 Roadmap Delivery Throughput (strength 0.65, high confidence), moderately increases Team Capability and Code Quality (strength 0.40), and moderately reduces Q3 Delivery Delay Risk (strength 0.50, high confidence). Those three reinforcing effects compound into a strong advantage.

The runner-up, Engage Offshore Partner, also increases team capacity, but it simultaneously activates Offshore Engagement, which introduces Coordination and Integration Overhead (strength 0.55 on that risk) and weakly reduces Team Capability and Code Quality. Those drag effects eat into the capacity gain, pulling its probability down to 19.1%.

Local Talent Market Tightness is the second-ranked driver (sensitivity -0.35), and it works against the local hiring path specifically. That is the main source of uncertainty in the result: if the talent market is tighter than assumed, the local hiring advantage narrows. It is worth asking how confident you are in your ability to close two senior hires within your Q3 window, because that assumption is carrying a meaningful share of the 59.1 percentage-point margin.
```

#### `6_edit_budget`

```
The request is clear but "budget factor" could map to two things in your model.
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
