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

- **Branch:** `claude/v5-golden-journey-dl7-replay`
- **Pack generated from commit SHA:** `2cea5eb22de2cde5750e0ad27aa95c6873215013` (if this does not match HEAD, regenerate with the harness)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-05-10T23:58:56.753Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** `6211789`
- **Journey:** `canonical`
- **DL7_PR_B_LANDED:** true (PR-B-gated assertions active)

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `6211789`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **elapsed:** 902ms

Deploy confirmed: `/healthz` build `6211789` matches `--expected-build 6211789`.

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=59333ms | — |
| `2_weakest_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1484 chip_count=1 elapsed=10799ms stage=analyse | — |
| `3_add_option` | [PASS] passed | v5-runtime | 200 | status=200 text_len=109 chip_count=1 elapsed=11035ms stage=frame | — |
| `4_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=38 chip_count=0 analysis_ready=ready options=4 elapsed=6136ms | — |
| `5_explain_leader` | [PASS] passed | v5-runtime | 200 | status=200 text_len=1684 labels_checked=4 chip_count=1 | — |
| `6_edit_budget` | [PASS] passed | v5-runtime | 200 | status=200 text_len=333 chip_count=0 elapsed=8119ms stage=frame | — |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Your decision model for "Deliver Q3 Roadmap Commitments at Scale" is ready, with 4 options, 5 factors, and 3 risks to consider.
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`

#### `2_weakest_option`

```
Looking at the model structure, **Continue with Current Team (Status Quo)** appears weakest against your goal of delivering Q3 roadmap commitments at scale.

Here is why the structure points that way. The goal is reached primarily through two outcome pathways: Engineering Delivery Capacity and Q3 Roadmap Commitment Confidence. Status quo has a causal link to Local Senior Headcount Added and Offshore Partner Engaged, but those links represent the absence of change rather than a positive contribution, so it adds nothing to either outcome pathway. It also avoids Budget Strain and Coordination Overhead, which is a genuine structural advantage, but that benefit is passive: it does not offset the lack of capacity growth.

By contrast, Hire Two Senior Engineers Locally has very strong positive links into both Local Senior Headcount Added and Hiring and Scaling Budget Allocated, feeding delivery capacity and roadmap confidence directly. Engage Offshore Partner activates the offshore engagement pathway quickly. Even Introduce Tiered Pricing to Fund Gradual Hiring, the slowest of the active options, at least drives budget allocation toward future capacity.

Status quo is structurally the only option with no mechanism to increase delivery capacity or roadmap confidence. That said, this is a structural reading only. Running the analysis would give you computed probabilities across all four options and show whether the margin is decisive or close. Would you like to run it?
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
Hire Two Senior Engineers Locally leads at 70% win probability, 52 percentage points ahead of the runner-up, Continue with Current Team (Status Quo), at 19%. The result is moderate in robustness, so it is a meaningful lead but not an unassailable one.

Three factors carry the result. Local Senior Headcount Added has a very strong positive influence: choosing this option directly activates that factor via a very strong causal link, which then drives both Engineering Delivery Capacity and Q3 Roadmap Commitment Confidence, both of which connect to the goal with moderate positive links. That is the core of why this option performs best.

Offshore Partner Engaged works in the opposite direction, with a strong negative influence on the goal. The offshore option activates that factor, which in turn drives Coordination and Integration Overhead with a moderate positive link, and Coordination and Integration Overhead carries a moderate negative link to the goal. By not engaging an offshore partner, the local hiring option avoids that drag entirely.

Local Senior Talent Availability adds a moderate positive influence. It is an external factor, so it introduces uncertainty, but on balance it supports the local hiring path through its weak positive link to Engineering Delivery Capacity and its weak negative link to Time to Full Productivity (meaning better availability reduces ramp-up risk).

The main vulnerability is that the result is moderate rather than stable. If talent availability turns out to be worse than modelled, or if the time-to-productivity risk materialises, the margin could narrow. Would you like to explore what would need to change to flip this result?
```
Chips:
- `chip_action_what_would_flip` — **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`

#### `6_edit_budget`

```
Strengthened the hiring spend factor's effect on delivery capacity and budget strain risk to reflect a more impactful budget role in the model.

Note: Increasing hiring spend influence also amplifies budget strain risk. The net effect on the goal depends on how the simulation balances delivery capacity gains against increased risk.
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
