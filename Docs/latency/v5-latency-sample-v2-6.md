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
- **Started at:** 2026-05-15T12:20:48.398Z
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
- **elapsed:** 243ms

Deploy reachable: `/healthz` build `45028b8` is well-formed. No strict-mode comparison run (set `--expected-build` or `OLUMI_REPLAY_EXPECTED_BUILD` to assert against a specific SHA).

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=61650ms draft={total:61166,parse:60962,parse_llm:60948,normalise:0,enrich:4,repair:105,repair_fired:false,repair_attempts:0,validation:1,threshold:0,package:2,boundary:92} | — |
| `2_set_factor_value` | [PASS] passed | v5-runtime | 200 | status=200 text_len=62 chip_count=1 mutation_ack="Updated" factor_label="Incremental Hiring and Engagement Cost" mentioned=true elapsed=1258ms timings={total:776,ctx:583,ctx_pack:9,ctx_chars:18530,handler:2,compose:2,commit:174,handler_id:set_factor_value,llm_calls:0} | — |
| `3_what_changed` | [FAIL] failed | v5-runtime | 200 | status=200 text_len=32 factor_label="Incremental Hiring and Engagement Cost" mentioned=false elapsed=1405ms timings={total:661,ctx:519,ctx_pack:8,ctx_chars:18564,llm_calls:0} | what_changed_factor_label_not_referenced |
| `4_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=38 chip_count=0 analysis_ready=ready options=4 elapsed=3972ms | — |
| `5_explain_leader` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1124 labels_checked=4 chip_count=1 elapsed=12576ms timings={total:12351,ctx:519,ctx_pack:3,ctx_chars:19900,routing:11709,handler:0,compose:1,commit:112,handler_id:explain_results,cache:hit,cache_read_tokens:7818,cache_create_tokens:0,input_tokens:4987,llm_calls:1} | — |
| `6_what_would_flip` | [PASS] passed | v5-runtime | 200 | status=200 text_len=263 labels_checked=4 option_referenced=true elapsed=797ms timings={total:604,ctx:481,ctx_pack:3,ctx_chars:20056,llm_calls:0} | — |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Your decision model for "Meet Q3 Roadmap Commitments with Sustainable Capacity" is ready, with 4 options, 5 factors, and 3 risks to consider.
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`

#### `2_set_factor_value`

```
Updated Incremental Hiring and Engagement Cost from £0 to 20%.
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
Hire Two Senior Engineers Locally leads at 82% win probability, 72 percentage points ahead of the runner-up, Continue with Current Team (Status Quo), at 9%. Three factors carry the result. Local Senior Headcount Added has a very strong positive influence: adding two senior engineers directly boosts Q3 Roadmap Delivery Capacity, which in turn has a moderate positive causal link to your goal. Time to Full Productivity works against the option with a strong negative influence, reflecting the 3-month ramp-up period that delays when that capacity actually lands. Incremental Hiring and Engagement Cost, currently set at 20%, applies a moderate negative drag through its causal link to Budget Overrun Risk. The net effect is strongly positive because the headcount gain outweighs both the ramp-up delay and the cost pressure. The robustness band is moderate, meaning the result is credible but not locked in. Time to Full Productivity is the factor most worth scrutinising: if onboarding takes longer than 3 months, the delivery capacity benefit arrives too late for Q3, which is the scenario most likely to erode this lead.
```
Chips:
- `chip_action_what_would_flip` — **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`

#### `6_what_would_flip`

```
Right now Hire Two Senior Engineers Locally is ahead. The factor most likely to flip the analysis is Local Senior Headcount Added — that's where the result is most sensitive. Try changing its value or strength and re-running to see where the leading option moves.
```

## DL-7 journey: `dl7-set-factor`

See per-step `description` fields in [tools/v5-journey-replay/steps.ts](../../tools/v5-journey-replay/steps.ts) for the canonical narrative of this journey. The replay table above is the authoritative pass/fail record.

### Step 1 capture

- **Option labels parsed:** `Hire Two Senior Engineers Locally`, `Engage Offshore Partner`, `Continue with Current Team (Status Quo)`, `Introduce Tiered Pricing to Fund Gradual Hiring`
- **Factor labels parsed:** `Incremental Hiring and Engagement Cost`, `Local Senior Headcount Added`, `Customer Demand Growth`, `Current Team Size`, `Time to Full Productivity`
- **Resolved factor for Step 2:** `Incremental Hiring and Engagement Cost` _(fallback reason: `first_label`)_
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
