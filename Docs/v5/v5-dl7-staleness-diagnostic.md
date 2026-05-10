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

- **Branch:** `claude/v5-golden-journey-dl7-replay`
- **Pack generated from commit SHA:** `6211789bf6a9781df7e2be7e7cc3df96c29a2082` (if this does not match HEAD, regenerate with the harness)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-05-10T20:50:53.198Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** `6211789`
- **Journey:** `dl7-staleness`
- **DL7_PR_B_LANDED:** true (PR-B-gated assertions active)

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `6211789`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **elapsed:** 1051ms

Deploy confirmed: `/healthz` build `6211789` matches `--expected-build 6211789`.

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=1 first_chip_label="Run analysis" elapsed=53276ms | — |
| `2_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=38 chip_count=0 analysis_ready=ready options=4 elapsed=5145ms | — |
| `3_edit_graph_generic` | [PASS] passed | v5-runtime | 200 | status=200 text_len=544 chip_count=0 mutation_ack="now has" elapsed=10419ms routing_class_check=unit_tests_only | — |
| `4_explain_leader_stale` | [FAIL] failed | v5-runtime | 200 | status=200 text_len=970 staleness_text=false staleness_chip=false chip_count=1 | explain_leader_stale_signal_missing |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
Your decision model for "Deliver Q3 Roadmap Commitments on Time" is ready, with 4 options, 5 factors, and 3 risks to consider.
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`

#### `2_run_analysis`

```
Ran analysis on your current scenario.
```

#### `3_edit_graph_generic`

```
Headcount Investment Level now has a stronger and more certain effect on Q3 Delivery Capacity, making it a more influential driver in the model.

Note: The [REDACTED] absolute strength total on Q3 Roadmap Delivery Capacity should be checked. With this update, Headcount Investment Level, Local Senior Hire Activated, Offshore Partnership Activated, Current Engineering Team Size, and Senior Engineering Talent Availability together approach the 1.0 limit. No existing edge was weakened, but a rerun will confirm the total remains within bounds.
```

#### `4_explain_leader_stale`

```
Hire Two Senior Engineers Locally leads at 59% win probability, 42 percentage points ahead of the runner-up, Continue with Current Team (Status Quo), at 16%. Three factors carry the result. Senior Engineering Talent Availability is the top driver with very strong negative influence, meaning the model sees tight talent markets as a significant headwind across all options, but the local hire path is best positioned to navigate it by directly activating the Local Senior Hire factor. Offshore Partnership Activated carries strong negative influence, which drags down the Engage Offshore Partner option through the moderate negative causal link from Coordination and Integration Overhead to your goal. Local Senior Hire Activated itself has moderate positive influence, flowing through Q3 Roadmap Delivery Capacity and Team Knowledge and Code Quality into your goal. The result is fragile, though, so that 59% reflects meaningful uncertainty rather than a clear verdict.
```
Chips:
- `chip_action_what_would_flip` — **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`

## DL-7 journey: `dl7-staleness`

See per-step `description` fields in [tools/v5-journey-replay/steps.ts](../../tools/v5-journey-replay/steps.ts) for the canonical narrative of this journey. The replay table above is the authoritative pass/fail record.

### Step 1 capture

- **Option labels parsed:** `Hire Two Senior Engineers Locally`, `Engage Offshore Partner`, `Continue with Current Team (Status Quo)`, `Introduce Tiered Pricing to Fund Gradual Hiring`
- **Factor labels parsed:** `Headcount Investment Level`, `Local Senior Hire Activated`, `Senior Engineering Talent Availability`, `Offshore Partnership Activated`, `Current Engineering Team Size`
- **Resolved factor for Step 2:** `Headcount Investment Level` _(fallback reason: `first_label`)_
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

## Product gap (this pack is the diagnostic)

This pack is **not** completion evidence for the V5 Golden Journey. It is the diagnostic record of a runtime gap surfaced by the `dl7-staleness` journey on staging build `6211789` (rerun `20260510T205052Z`).

**V5 product gap (surfaced by `dl7-staleness`, staging build `6211789`, rerun `20260510T205052Z`):** Post-analysis `edit_graph` mutation does not propagate stale/rerun state into the `explain_result` flow. After a successful structural edit between a completed `run_analysis` and a follow-up explain turn, the assistant explains the *old* analysis without a staleness warning, and the chip surfaced is `what_would_flip` rather than `run_analysis` / `rerun`. This is a runtime gap, not a harness gap. Recommended follow-up workstream: a runtime PR that marks the prior analysis stale on any post-analysis graph-mutating fact and routes the next explain turn through a stale-aware composer.

### Observed evidence for the gap

| artefact | observation |
|---|---|
| Step 3 result | `edit_graph_generic` PASS, `mutation_ack="now has"` — mutation accepted by runtime |
| Step 3 assistant text | "Headcount Investment Level now has a stronger and more certain effect on Q3 Delivery Capacity, making it a more influential driver in the model." |
| Step 4 result | `explain_leader_stale` FAIL, `failing_contract = explain_leader_stale_signal_missing` |
| Step 4 staleness in text | `staleness_text = false` — assistant explains the prior analysis with no caveat |
| Step 4 chip set | one chip only: `chip_action_what_would_flip` (action_type `what_would_flip`); no `run_analysis` / `rerun` chip |
| Wire-envelope freshness fields | `staleness_chip = false`; no `analysis_stale` / `analysis_dirty` field surfaced by `/orchestrate/v2/turn` |

### 9-step Golden Journey verdict

**Partially proven; blocked at Step 8 (stale/rerun).** Steps 1–7 are covered by the green canonical and `dl7-edit-graph` packs in this same commit. Step 8 cannot pass until the runtime gap above is resolved, so Step 9 (updated result after stale rerun) is unreachable.

### Recommended next product-code workstream

**`V5 stale-aware explain and rerun recovery`** — runtime PR that:
1. On commit of any post-`run_analysis` graph-mutating fact (`edit_graph`, `set_factor_value`, structural changes), marks the prior analysis result as stale in orchestrator state.
2. Routes the next `explain_result` turn through a composer that prepends a staleness caveat to the assistant text.
3. Replaces the chip set on that turn — `what_would_flip` → `run_analysis` (label "Rerun analysis") — so the user has the recovery path one click away.

This pack proves the gap. The fix is out of scope for this workstream.
