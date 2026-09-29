# V5 Golden Path — Evidence Pack (CEE)

Phase 3 of V5 alpha hardening. Produced by [tools/v5-journey-replay](../../tools/v5-journey-replay/). This pack is the V5 replay gate.

## Executive summary

| signal | value |
|---|---|
| Replay reached orchestrator | yes |
| v38.2 confirmed (startup / healthz build) | not strict-checked |
| v38.2 confirmed (per-turn) | not capturable |
| run_analysis passed end-to-end (handler + commit + response) | yes |
| Analysis persisted into follow-up context | not externally verified |
| No internal terms in user-facing text | yes |

## Run metadata

- **Branch:** `staging`
- **Harness code SHA at run time:** `1f0f819940e9af82641ef1afe15c405f508b2ea8` (the SHA the replay harness was built from when this pack was produced; the commit that lands this pack into git history is typically one commit ahead — see the committed-by SHA in `git log` for that)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-05-14T14:45:10.432Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** _not set (default: well-formed-only check)_
- **Journey:** `canonical`
- **edit_graph_journey_active:** yes (edit_graph dispatch live on staging; assertions active)

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `7872102`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **elapsed:** 891ms

Deploy reachable: `/healthz` build `7872102` is well-formed. No strict-mode comparison run (set `--expected-build` or `OLUMI_REPLAY_EXPECTED_BUILD` to assert against a specific SHA).

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=52949ms | — |
| `2_weakest_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1456 chip_count=1 elapsed=12612ms stage=analyse | — |
| `3_add_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=109 chip_count=1 elapsed=9647ms stage=frame | — |
| `4_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=38 chip_count=0 analysis_ready=ready options=4 elapsed=5832ms | — |
| `5_explain_leader` | [FAIL] failed | v5-runtime | 200 | status=200 text_len=84 (expected > 200) chip_count=2 | step_5_text_too_short |
| `6_edit_budget` | [PASS] passed | v5-runtime | 200 | status=200 text_len=141 chip_count=0 elapsed=5512ms stage=frame | — |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Your decision model for "Deliver Q3 Roadmap Commitments on Time and Within Budget" is ready, with 4 options, 6 factors, and 3 risks to consider.
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`

#### `2_weakest_option`

```
Looking at the causal structure, **Continue with Current Team (Status Quo)** appears weakest against your goal of delivering Q3 commitments on time and within budget.

Here is why the structure points that way. The Status Quo option has causal links into Headcount Investment Level, Local Senior Hire Indicator, and Offshore Partnership Indicator, but those links represent the *absence* of new investment rather than active uplift. It contributes nothing new to Q3 Roadmap Delivery Throughput, which carries the strongest path to your goal via a moderate positive causal link. It also does nothing to build Long-Term Team Capability. In short, it activates no positive mechanism that the other three options do not already have access to.

The other options each have a distinct positive pathway: local hiring drives delivery throughput and team capability directly; offshore adds capacity quickly; tiered pricing generates revenue uplift that offsets cost overrun risk. Status Quo has none of those levers.

That said, this is structural reasoning only. No simulation has run yet, so there is no computed probability to confirm this. Running the analysis would show whether Status Quo is as weak as the structure implies, or whether the risks attached to the other options (particularly Onboarding and Integration Delay, which has the strongest negative causal link to your goal) close the gap more than expected.

Would you like to run the analysis now?
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`

#### `3_add_option`

```
I wasn't able to make that change safely. Can you describe what you'd like to add or change in simpler terms?
```
Chips:
- `edit_graph_action_0` — **Describe what to change** — "Let me describe the change differently."

#### `4_run_analysis`

```
Ran analysis on your current scenario.
```

#### `5_explain_leader`

```
I couldn't complete that turn cleanly, but your current analysis is still available.
```
Chips:
- `chip_action_explain_results` — **Explain results** — "Explain the result" action_type=`explain_results`
- `chip_action_run_analysis_retry` — **Re-run analysis** — "Run the analysis" action_type=`run_analysis`

#### `6_edit_budget`

```
I couldn’t see a concrete change to make from that description. Tell me the specific factor and value you’d like, and I’ll apply it directly.
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
