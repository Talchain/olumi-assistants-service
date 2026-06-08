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

- **Branch:** `claude/charming-sinoussi-7ce0c7`
- **Harness code SHA at run time:** `2e3ecdcbe353e018875e724b4139a51d1c093050` (the SHA the replay harness was built from when this pack was produced; the commit that lands this pack into git history is typically one commit ahead — see the committed-by SHA in `git log` for that)
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-06-08T09:03:25.744Z
- **Expected prompt version:** `v38.2`
- **Expected prompt hash:** `2e25001a025e288c`
- **Auth mode:** authenticated
- **Expected build:** `9f04975`
- **Journey:** `branch-a-canonical`
- **edit_graph_journey_active:** yes (edit_graph dispatch live on staging; assertions active)
- **branch_a_enforced:** yes (default — PR #236 live on staging; steps 4-8 run + assert)
- **branch_a_pending_scenario:** yes (default; BRANCH_A_PENDING_SCENARIO on — a DB-confirmed no-usable-flip state (flip_thresholds all-null OR an empty array) downgrades the step-4 chip-absent failure to a pending-scenario skip)
- **Branch-A pending-scenario rows:** 5 (skipped, NOT failed — staging has no live flip-capable result)

> **Branch A pending-scenario:** staging has no live flip-capable result (run_analysis `flip_thresholds` carry no usable flip — all-null or an empty array, DB-verified), NOT a harness failure — the #236 emit is enforced deterministically by `branch-a-emit-through-executor.test.ts`.

## Deploy confirmation (Phase 2)

- **GET /healthz status:** 200
- **build (commit short):** `9f04975`
- **version:** `1.12.0`
- **service:** `assistants`
- **degraded:** false
- **critical_prompts_pms:** true
- **elapsed:** 243ms

Deploy confirmed: `/healthz` build `9f04975` matches `--expected-build 9f04975`.

**Per-turn prompt evidence:** not capturable from the current response envelope. The runtime emits `prompt_version` / `system_chars` to structured telemetry at server startup, but the `/orchestrate/v2/turn` response payload does not surface them. Deploy confirmation relies on `/healthz.build` + Render dashboard as the externally-verifiable signal.

## Preflight (Phase 3)

Two-stage probe before the six canonical steps: (a) public `/healthz` for reachability, (b) authenticated POST to `/orchestrate/v2/turn` with a minimal body. Halt on 401/403/5xx/exception — do not burn the replay on a known-bad state.

- **Auth probe status:** 422 — auth accepted (HTTP 422 as expected for empty body)

## Six-step replay

| step | status | outcome class | http | evidence | failing_contract |
|---|---|---|---|---|---|
| `1_draft_graph` | [PASS] passed | v5-runtime | 200 | status=200 chip_count=3 first_chip_label="Run analysis" elapsed=58790ms draft={total:58196,parse:58094,parse_llm:56099,normalise:0,enrich:4,repair:80,repair_fired:false,repair_attempts:0,validation:0,threshold:0,package:8,boundary:9} | — |
| `2_run_analysis` | [PASS] passed | v5-runtime | 200 | status=200 text_len=161 chip_count=2 analysis_ready=ready options=4 elapsed=4113ms | — |
| `3_what_would_flip` | [PASS] passed | v5-runtime | 200 | status=200 text_len=566 labels_checked=4 option_referenced=true elapsed=1067ms | — |
| `4_flip_proposal_present` | [SKIP] skipped | skipped | — | pending-scenario: staging produced no live flip-capable result — run_analysis flip_thresholds carry no usable flip (DB-verified). Not a harness failure; emit reachability is enforced deterministically by branch-a-emit-through-executor.test.ts. (run_analysis fact flip_thresholds classification=all_null (entries=1)) | — |
| `5_accept_proposal` | [SKIP] skipped | skipped | — | pending-scenario (cascaded from 4_flip_proposal_present): no live flip-capable result | — |
| `6_db_readback` | [SKIP] skipped | skipped | — | pending-scenario (cascaded from 5_accept_proposal): no live flip-capable result | — |
| `7_explain_leader_stale` | [SKIP] skipped | skipped | — | pending-scenario (cascaded from 5_accept_proposal): no live flip-capable result | — |
| `8_what_changed` | [SKIP] skipped | skipped | — | pending-scenario (cascaded from 5_accept_proposal): no live flip-capable result | — |

### assistant_text per step (redacted)

#### `1_draft_graph`

```
I've built a first decision model for "Deliver Q3 Roadmap Commitments on Time and Within Budget".

Options compared
• Hire Two Senior Engineers Locally
• Engage Offshore Partner
• Continue with Current Team (Status Quo)
• Introduce Tiered Pricing to Fund

What the model is weighing
• Main trade-off: Incremental Hiring Cost balanced against Local Senior Hire Programme
• Assumption to check: One local senior hire combined with a scoped offshore engagement could balance capacity speed and cost, reducing single-path risk before Q3

Your brief covered the main points; adding detail on the lighter areas would sharpen the comparison.

Next, run the analysis to see how the options compare and what could shift the outcome.
```
Chips:
- `chip_action_run_analysis` — **Run analysis** — "Run analysis." action_type=`run_analysis`
- `chip_prompt_review_model` — **Review model** — "Walk me through the model so I can review it before running the analysis."
- `chip_prompt_assumptions` — **What assumptions matter most?** — "Which assumptions in this model matter most to check before I run the analysis?"

#### `2_run_analysis`

```
Hire Two Senior Engineers Locally currently leads by 55 percentage points, but treat this as provisional: the result is sensitive to Local Senior Hire Programme.
```
Chips:
- `chip_action_explain_results` — **Explain the result** — "Please explain the analysis result in plain language." action_type=`explain_results`
- `chip_action_what_would_flip` — **What could change the outcome?** — "What could change the outcome of this analysis?" action_type=`what_would_flip`

#### `3_what_would_flip`

```
'Hire Two Senior Engineers Locally' currently leads, with a probability of 68%. For 'Engage Offshore Partner' to overtake it, the lead of 55 percentage points would need to close. Movement on Local Senior Hire Programme or Offshore Partner Engagement would shift this result the most. Local Senior Hire Programme very strongly strengthens the lead; Offshore Partner Engagement strongly weakens the lead. The picture appears fragile, so even small adjustments to the strongest drivers could shift which option leads. Which of those would you like to explore changing?
```

## Branch A journey: `branch-a-canonical`

See per-step `description` fields in [tools/v5-journey-replay/steps.ts](../../tools/v5-journey-replay/steps.ts) for the canonical narrative of this journey. The replay table above is the authoritative pass/fail record.

### Step 1 capture

- **Option labels parsed:** `Hire Two Senior Engineers Locally`, `Engage Offshore Partner`, `Continue with Current Team (Status Quo)`, `Introduce Tiered Pricing to Fund Gradual Hiring`
- **Factor labels parsed:** `Incremental Hiring Cost`, `Local Senior Hire Programme`, `Market Demand for Product`, `Offshore Partner Engagement`, `Current Team Size`, `Tiered Pricing Introduction`
- **Resolved factor for Step 2:** `Incremental Hiring Cost` _(fallback reason: `first_label`)_
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
