# V5 P1-1 — Handler Failure Scope

Produced by the v5-replay-proof branch as the Phase 4 deliverable. Enumerates the failure surface area of V5 handler dispatch, classifies each cause against the resilience contract, and cross-references the Phase 3 staging replay finding.

This is a **scope doc, not a fix**. No code changes accompany it.

## Cross-reference to Phase 3 replay

Six-step staging replay against `https://cee-staging.onrender.com` (commit `66d1adb`, v38.2) outcome:

| step | status | outcome class | http |
|---|---|---|---|
| 1_draft_graph | PASS | v5-runtime | 200 |
| 2_weakest_option | PASS | v5-runtime | 200 |
| 3_add_option | PASS | v5-runtime | 200 |
| 4_run_analysis | **FAIL** | **v5-runtime** | **500** |
| 5_explain_leader | SKIP (prereq failed) | skipped | — |
| 6_edit_budget | PASS | v5-runtime | 200 |

Step 4 returned persistent HTTP 500 (three identical responses across retries):

```json
{
  "error": "INTERNAL_ERROR",
  "boundary": "B1",
  "direction": "egress",
  "validator": "turn_commit",
  "details": {
    "retryable": true,
    "reason": "chip_click_run_analysis_commit_failed",
    "stage": "analyse"
  },
  "request_id": "<redacted>",
  "retryable": true
}
```

Request IDs: `11b3982f-8c49-4659-87f8-b3262e907c93`, `fd231273-2483-48c8-9313-e7601d0c9f55`, `08ab86fe-94f8-4010-8c7c-b605ea377fb3`.

Source: [src/orchestrator/route-v2.ts:288-296](../../src/orchestrator/route-v2.ts#L288-L296) branches on `cc.outcome === 'commit_failed'` and emits `buildCommitFailureBoundaryError(validator: 'turn_commit', reason: 'chip_click_run_analysis_commit_failed', retryable: true)` → HTTP 500.

The underlying trigger: [src/orchestrator-v5/handlers/chip-click-dispatch.ts:226-236](../../src/orchestrator-v5/handlers/chip-click-dispatch.ts#L226-L236) catches `commitDirectAnswer` exceptions and returns `{ outcome: 'commit_failed' }`. `commitDirectAnswer` calls `store.append(...)` — the Supabase `append_turn_atomic` RPC (see [src/orchestrator-v5/commit.ts:107](../../src/orchestrator-v5/commit.ts#L107)).

**Classification:** despite the `retryable: true` flag, two consecutive retries returned identical errors with distinct request IDs. This is **fatal infrastructure**, not retryable infrastructure — a persistent Supabase write failure (likely missing/stale credentials or schema drift in the Render deploy environment).

**Not a user-recoverable case:** there is no composable coaching response path for commit failures. The user sees a 500 BoundaryError, not a chip.

## Two parallel dispatch paths

V5 currently has two handler invocation paths, both reachable from `/orchestrate/v2/turn`:

1. **Sonnet-routed path** — [src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts). Used for classifier-driven turns. `translateExecuteError` at [lines 1294-1391](../../src/orchestrator-v5/turn-executor.ts#L1294-L1391) maps errors to wire responses.
2. **Chip-click fast path** — [src/orchestrator/route-v2.ts:258-325](../../src/orchestrator/route-v2.ts#L258-L325) + [dispatchChipClickRunAnalysis](../../src/orchestrator-v5/handlers/chip-click-dispatch.ts). Used only for `source: 'chip_click'` + `chip.action_type: 'run_analysis'`. Bypasses Sonnet.

The two paths share the same registered `run_analysis` handler and commit logic but have **different failure-to-HTTP mappings**. The Sonnet path wraps handler failures in composed coaching responses (still returns HTTP 500 per current wire contract). The chip-click path hard-codes HTTP 500 for all four non-OK outcomes.

## Cause-kind table

| Path | Failure case | Cause kind | Currently returns | Classification | Example trigger |
|---|---|---|---|---|---|
| Both | Args schema parse fails | `args_validation_failed` | 500 (composed) | **user-recoverable** (composable response exists → principle 1 says 200) | POST with `scenario_id: undefined` |
| Both | Scenario read fails | `scenario_read_failed` | 500 (composed) | retryable infrastructure | Supabase read timeout |
| Both | Options exist but unconfigured | `options_not_configured` | 500 (composed) | **user-recoverable** (coaching chip exists → principle 1 says 200) | Graph has `opt_1` but no interventions |
| Both | PLoT outbound validator rejects handler payload | `plot_payload_invalid` | 500 (composed) | contract mismatch (handler shape drifted past PLoT's allowlist) | Handler builds malformed payload |
| Both | PLoT request timed out / analysis service did not respond within timeout | `plot_timeout` | 500 (composed) | retryable infrastructure | Slow PLoT response |
| Both | PLoT returns 5xx or error envelope | `plot_error` | 500 (composed) | retryable infrastructure | PLoT service 502 |
| Both | PLoT returns unknown error | `plot_unknown` | 500 (composed) | retryable infrastructure | Network / opaque |
| Both | PLoT `analysis_status = 'blocked'` | `analysis_blocked` | 500 (composed) | **user-recoverable** (scenario-status chip exists → principle 1 says 200) | Constraints prevent analysis |
| Both | PLoT `analysis_status = 'failed'` | `analysis_failed` | 500 (composed) | retryable infrastructure | PLoT crashed mid-run |
| Both | PLoT returns **success-ish status** without usable fields | `analysis_not_completed` (sub-case A) | 500 (composed) | contract mismatch (external service returned shape we don't recognise) | New PLoT status added upstream without CEE update |
| Both | PLoT reports **partial / blocked** with reason | `analysis_blocked` OR caveat-wrapped 200 | 200 (partial) / 500 (blocked) | recoverable/degraded (depends on sub-case) | Partial analysis with missing factor |
| Both | PLoT service fails / times out (classified under plot_*) | — | 500 (composed) | retryable infrastructure | — |
| Both | `HandlerResultInvalidError` — handler fact fails Zod | — | 500 (generic BoundaryError) | fatal infrastructure (code bug) | Handler constructs invalid fact shape |
| Sonnet path only | Unsupported action proposed by Sonnet | `handler_not_registered` (sub-case A: LLM-proposed) | 500 (FEATURE_NOT_ENABLED) | **user-recoverable** (clarifier fallback would be cleaner than 500) | Sonnet proposes a handler not in v0.7.0 registry |
| Sonnet path only | Registered handler missing at dispatch after routing validation | `handler_not_registered` (sub-case B: dispatch invariant) | 500 (FEATURE_NOT_ENABLED) | fatal infrastructure (dispatch invariant broken — shouldn't happen) | Registry tampered with |
| Sonnet path only | Turn budget exceeded mid-execute | `BUDGET_EXCEEDED` | **200** | user-recoverable (already correct — retry chip) | Handler runs > turn_ms |
| **Chip-click path** | **`commitDirectAnswer` throws (Supabase write failure)** | `chip_click_run_analysis_commit_failed` | **500 (BoundaryError `turn_commit` validator)** | **fatal infrastructure** (persistent, not transient per Phase 3 retries) | **Phase 3 golden-path blocker — see cross-reference above** |
| Chip-click path | `handler_not_registered` (registry safety-net) | — | 500 (commit_failed with fallback response) | fatal infrastructure (deploy contract) | Default registry missing `run_analysis` |
| Chip-click path | Handler throws `HandlerInvocationFailedError` | Various (see Sonnet path) | 500 (BoundaryError `chip_click_dispatch` validator) | Per cause_kind (same as Sonnet path) | Same triggers as Sonnet path cause_kinds |
| Chip-click path | Handler throws `HandlerResultInvalidError` | — | 500 (BoundaryError `chip_click_dispatch` validator) | fatal infrastructure (code bug) | Handler constructs invalid fact shape |
| Chip-click path | Uncaught exception from handler | — | 500 (BoundaryError `chip_click_dispatch` validator, reason=`chip_click_run_analysis_handler_threw`) | fatal infrastructure (unclassified throw) | Unexpected throw |

## Summary by classification

> **Update — 2026-05-10 (post P1.1 + P1.1 follow-up):** the canonical
> recoverable handler cause-kind list is now the seven causes below.
> The earlier four-cause summary in this section (which proposed
> `args_validation_failed`, `options_not_configured`, `analysis_blocked`,
> `handler_not_registered (Sonnet-proposed sub-case)`) was superseded
> by the War-Room locked seven-cause contract shipped in P1.1 commit
> `23ec3016` and refined by the P1.1 follow-up. See
> [`recoverable-handler-causes.ts`](../../src/orchestrator-v5/compose/recoverable-handler-causes.ts)
> for the runtime source of truth. The classification table at the top
> of this document (rows tagged "user-recoverable" / "retryable
> infrastructure" / "contract mismatch" / "fatal infrastructure")
> remains the authoritative *cause-kind* taxonomy; only the summary
> below has been updated to reflect what landed.

- **user-recoverable — clean direct_answer 200 with coaching chip (canonical contract since P1.1):**
  - `args_validation_failed`
  - `options_not_configured`
  - `analysis_blocked`
  - `parameter_invalid_at_execute` *(D1 mutation handler, P1.1 follow-up: text-prompt chip, no chip-derived pending action)*
  - `entity_not_found_in_graph` *(D1 mutation handler, same)*
  - `entity_kind_mismatch_at_execute` *(D1 mutation handler, same)*
  - `precondition_unmet_at_execute` *(D1 mutation handler, same)*
- **retryable infrastructure (500 acceptable if genuinely transient):**
  - `scenario_read_failed`
  - `plot_timeout`
  - `plot_error`
  - `plot_unknown`
  - `analysis_failed`
- **contract mismatch (500 — fatal, not user-recoverable):**
  - `plot_payload_invalid`
  - `analysis_not_completed` (unknown PLoT status, no usable fields)
- **fatal infrastructure (500 — must NOT be disguised as recovered 200):**
  - `HandlerResultInvalidError` (code bug)
  - `handler_not_registered` — fatal in this tranche. The runtime data
    cannot distinguish "Sonnet proposed an unavailable action"
    (recoverable in spirit) from "registry tampered / dispatch
    invariant broken" (genuinely fatal). Splitting / enriching the
    cause-kind so the runtime can tell them apart is a follow-up;
    until then, the safer default is to surface the fatal envelope
    rather than risk masking a real invariant breach as a coaching turn.
  - `graph_invariant_violated` — fatal until a validator/D1 audit says
    otherwise. A post-mutation invariant breach signals the proposed
    change would have left the graph in an invalid state; coaching the
    user as if the change "didn't apply" risks confusing them about
    whether their input was at fault. Stays on the fatal path with the
    canonical handler-level user-safe phrase set via `userGuidance`.
  - **commit failures** (e.g. `chip_click_run_analysis_commit_failed`,
    Supabase `append_turn_atomic` write failure) — fatal infrastructure
    regardless of `retryable: true` framing. P1.1 keeps commit failures
    on the fatal path and emits two distinct log records
    (`v5.recoverable_outcome_pre_commit_failure` +
    `v5.state_commit_failed`) when commit fails on a recoverable
    cause-kind so infrastructure issues are not hidden behind
    resilience.
- **already correct (200) — budget always wins:**
  - `BUDGET_EXCEEDED` — outer `turnAbort` precedence is enforced as
    the first statement of the recoverable handler branch (P1.1
    follow-up). A budget-exceeded turn cannot masquerade as a
    recovered 200; no `v5.recovery_response` /
    `turn_executor.failure_response{outcome:'recovered'}` /
    `store.append(...)` runs on a budget-exhausted turn.

## Flagged row (golden-path 500)

Phase 3 did not hit a user-recoverable cause — it hit **fatal infrastructure** (`chip_click_run_analysis_commit_failed`). Per the brief's verdict rubric, this is:

- NOT verdict 4 ("P1-1 is immediate next brief — replay hit a user-recoverable handler failure returning 500 on the golden path"). The commit failure is infrastructure, not user-recoverable.
- Matches verdict 3 context ("Blocked by V5 runtime contract — replay reached orchestrator but revealed a contract failure") — the "contract" here being that chip-click commit failures are not retryable-recoverable in practice despite the `retryable: true` flag.

## Recommended P1-1 scope (next brief, not this one)

Scope for a future P1-1 branch, ordered by user-facing impact:

1. **Resolve the staging commit failure first.** Without Supabase writes working on staging, nothing else about the chip-click path can be exercised end-to-end. Root-cause the `append_turn_atomic` failure (creds, schema, RLS). This is a deploy/operational issue, not a code change.
2. Port the composed-response pattern to user-recoverable causes:
   - `args_validation_failed` → 200 + coaching chip
   - `options_not_configured` → 200 + `Configure {entityRef}` chip (already composed, needs the 200 wrapper)
   - `analysis_blocked` → 200 + scenario-status chip
3. Reconcile the two dispatch paths. Either unify chip-click under TurnExecutor (with a pre-classified short-circuit skipping ORIENT) or hold the current split but make failure-to-HTTP consistent.
4. The `v5_journey_id` observability fix in `evaluateAnalysisStatus` (deferred from this branch; requires `ctx` signature change).
