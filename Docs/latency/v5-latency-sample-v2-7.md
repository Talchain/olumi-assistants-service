# V5 Golden Path — Evidence Pack (CEE)

Phase 3 of V5 alpha hardening. Produced by [tools/v5-journey-replay](../../tools/v5-journey-replay/). This pack is the V5 replay gate.

## Executive summary

| signal | value |
|---|---|
| Replay reached orchestrator | yes |
| v38.2 confirmed (startup / healthz build) | not strict-checked |
| v38.2 confirmed (per-turn) | not capturable |
| run_analysis passed end-to-end (handler + commit + response) | yes |
| Analysis persisted into follow-up context | yes |
| No internal terms in user-facing text | yes |

## Run metadata

- **Branch:** `claude/v5-latency-observability`
- **Harness code SHA at run time:** `c704e6e2ffcab48ac8e5104324927c1a7d04ab50` (the SHA the replay harness was built from when this pack was produced; the commit that lands this pack into git history is typically one commit ahead — see the committed-by SHA in `git log` for that)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-05-15T12:20:53.937Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** _not set (default: well-formed-only check)_
- **Journey:** `dl7-set-factor`
- **edit_graph_journey_active:** yes (edit_graph dispatch live on staging; assertions active)

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `45028b8`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **elapsed:** 335ms

Deploy reachable: `/healthz` build `45028b8` is well-formed. No strict-mode comparison run (set `--expected-build` or `OLUMI_REPLAY_EXPECTED_BUILD` to assert against a specific SHA).

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=60045ms draft={total:59593,parse:59568,parse_llm:59556,normalise:1,enrich:2,repair:13,repair_fired:false,repair_attempts:0,validation:0,threshold:0,package:3,boundary:5} | — |
| `2_set_factor_value` | [PASS] passed | v5-runtime | 200 | status=200 text_len=49 chip_count=1 mutation_ack="Updated" factor_label="Incremental Staffing Cost" mentioned=true elapsed=1037ms timings={total:762,ctx:573,ctx_pack:8,ctx_chars:16968,handler:4,compose:1,commit:168,handler_id:set_factor_value,llm_calls:0} | — |
| `3_what_changed` | [FAIL] failed | v5-runtime | 200 | status=200 text_len=32 factor_label="Incremental Staffing Cost" mentioned=false elapsed=860ms timings={total:645,ctx:513,ctx_pack:2,ctx_chars:17015,llm_calls:0} | what_changed_factor_label_not_referenced |
| `4_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=38 chip_count=0 analysis_ready=ready options=4 elapsed=3633ms | — |
| `5_explain_leader` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1349 labels_checked=4 chip_count=1 elapsed=13204ms timings={total:12989,ctx:624,ctx_pack:3,ctx_chars:18306,routing:12243,handler:0,compose:1,commit:113,handler_id:explain_results,cache:hit,cache_read_tokens:7818,cache_create_tokens:0,input_tokens:4687,llm_calls:1} | — |
| `6_what_would_flip` | [PASS] passed | v5-runtime | 200 | status=200 text_len=257 labels_checked=4 option_referenced=true elapsed=917ms timings={total:729,ctx:604,ctx_pack:2,ctx_chars:18462,llm_calls:0} | — |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Your decision model for "Deliver Q3 Roadmap Commitments at Sustainable Cost" is ready, with 4 options, 4 factors, and 3 risks to consider.
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`

#### `2_set_factor_value`

```
Updated Incremental Staffing Cost from £0 to 20%.
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`

#### `3_what_changed`

```
Updated a factor from £0 to 20%.
```
Chips:
- `chip_action_run_analysis_after_state_query` — **Run analysis** — "Run the analysis." action_type=`run_analysis`

#### `4_run_analysis`

```
Ran analysis on your current scenario.
```

#### `5_explain_leader`

```
Engage Offshore Partner leads at 48% win probability, just 2 percentage points ahead of Hire Two Senior Engineers Locally at 47%. That margin is moderate in robustness, meaning the result is directionally meaningful but not decisive.

The result is carried primarily by Speed to Productive Contribution, which has a very strong positive influence on the goal. Offshore partners, once contracted, can typically be onboarded faster than a local senior hire who needs to be sourced, interviewed, and given notice periods. That speed advantage flows through to Q3 Roadmap Delivery Confidence, which has a moderate positive causal link to the goal.

Effective Engineering Capacity is the second driver, with a strong positive influence. Both options add capacity, but the offshore route can scale headcount more quickly, which the model reflects in how that factor is weighted.

Incremental Staffing Cost works against both options, but its moderate negative influence is not strong enough to overcome the speed and capacity advantages the offshore path holds in the current configuration.

Given the 2-point margin, this is genuinely close. The result could shift if your Speed to Productive Contribution estimate for the offshore option is optimistic, or if Coordination and Integration Overhead turns out to be higher than the model currently assumes.
```
Chips:
- `chip_action_what_would_flip` — **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`

#### `6_what_would_flip`

```
Right now Engage Offshore Partner is ahead. The factor most likely to flip the analysis is Speed to Productive Contribution — that's where the result is most sensitive. Try changing its value or strength and re-running to see where the leading option moves.
```

## DL-7 journey: `dl7-set-factor`

See per-step `description` fields in [tools/v5-journey-replay/steps.ts](../../tools/v5-journey-replay/steps.ts) for the canonical narrative of this journey. The replay table above is the authoritative pass/fail record.

### Step 1 capture

- **Option labels parsed:** `Hire Two Senior Engineers Locally`, `Engage Offshore Partner`, `Continue with Current Team (Status Quo)`, `Introduce Tiered Pricing to Fund Gradual Hiring`
- **Factor labels parsed:** `Incremental Staffing Cost`, `Local Senior Engineering Talent Availability`, `Effective Engineering Capacity`, `Speed to Productive Contribution`
- **Resolved factor for Step 2:** `Incremental Staffing Cost` _(fallback reason: `first_label`)_
- **Graph hash at draft (post-Step 1):** _not surfaced on wire envelope_

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
