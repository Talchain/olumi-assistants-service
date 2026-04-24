# V5 Golden Path — Evidence Pack (CEE)

Phase 3 of V5 alpha hardening. This pack is produced by [tools/v5-journey-replay](../../tools/v5-journey-replay/) and serves as the V5 regression gate.

## Run metadata

- **Branch:** `claude/v5-alpha-hardening`
- **Commit SHA:** `d43befe39474f24d61a3790b308ca0768c3a97b0`
- **Base URL:** http://localhost:3000
- **Started at:** 2026-04-24T14:57:41.998Z
- **Prompt version:** `v38.2`
- **Prompt hash:** `2e25001a025e288c`

## Pre-merge gate (local)

Harness runs against a locally-started server (`pnpm start`). Log capture is stdout-only per correction 15 — no remote log API. Step 4 requires a reachable PLoT endpoint; when unreachable locally the step is marked `skipped` with the blocker noted. The unit-level regression for that path lives in [run-analysis-permissive-status.test.ts](../../src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts).

| step | status | evidence | failing_contract |
|---|---|---|---|
| `1_draft_graph` | [SKIP] skipped | server unreachable: fetch failed | local server not running |
| `2_weakest_option` | [SKIP] skipped | skipped: prerequisite 1_draft_graph failed | — |
| `3_add_option` | [SKIP] skipped | skipped: prerequisite 1_draft_graph failed | — |
| `4_run_analysis` | [SKIP] skipped | skipped: prerequisite 1_draft_graph failed | — |
| `5_explain_leader` | [SKIP] skipped | server unreachable: fetch failed | local server not running |
| `6_edit_budget` | [SKIP] skipped | server unreachable: fetch failed | local server not running |

## Post-authorised-deploy gate (staging)

Populated by Paul after authorising the staging push. The harness runs against `https://cee-staging.onrender.com` with the same canonical steps. Staging log lines are pasted manually — no new log-exposure API surface is added.

| step | status | evidence | failing_contract |
|---|---|---|---|
| _pending Paul's authorisation_ | _—_ | _—_ | _—_ |

## Canonical steps (exact brief)

1. POST fresh scenario + decision brief → draft_graph response with post-draft chips
2. "Which option looks weakest?" → references actual option/factor labels
3. "Add another option" → product-shaped: 200, no BoundaryError, no internal terms
4. chip_click payload for Run analysis → 200, PLoT completes, fact persisted
5. "Why does the leading option win?" → names leading option + probability + driver + caveat
6. "Increase the budget factor" → edit proposal or clarifying question

### 4b — pinned unit regression (handler-level)

Unknown PLoT status with no usable result fields → typed fatal, not a misleading 200. Covered by the unit test `run-analysis-permissive-status.test.ts` (case: "unknown status with NO usable fields is fatal with cause_kind analysis_not_completed"). The handler cannot be exercised through the HTTP boundary without mocking the PLoT response, so this is asserted at the unit level rather than in the replay harness.

## Halt policy (correction 16)

If the harness uncovers a systemic blocker outside the approved Phase 2 scope, the row is marked `failed` with a specific `failing_contract` and the blocker documented below. Scope is NOT expanded to force green rows.

## Discoveries (deferred for follow-up)

| area | observation | follow-up recommendation |
|---|---|---|
| Handler failure recovery (P1-1) | `translateExecuteError` composes a coaching response for `HandlerInvocationFailedError` but returns via `failureType = HANDLER_INVOCATION_FAILED` → HTTP 500. Principle 1 ("default recoverable") suggests retryable handler failures (plot_timeout, plot_error, scenario_read_failed, options_not_configured) should commit as direct_answer and return 200, mirroring the Phase 2.2 validator pattern. | Extend Part B of the resilience contract to enumerate handler-failure fatals (only analysis_blocked / analysis_failed remain fatal) and port the `commitDirectAnswer` pattern to `translateExecuteError`. One table-driven test per retryable cause_kind. |
| PLoT usable-fields enforcement on known statuses | `hasUsableResultFields` is only consulted for unknown statuses. Known statuses (`completed`, `computed`, `partial`) succeed regardless of whether records carry a usable id/label + finite probability. Contract Part C reads as a floor for ALL success paths; code enforces it selectively. | Thread `hasUsableResultFields` into the `ok` and `partial` branches of `evaluateAnalysisStatus`. When a known status arrives with no usable fields, demote to fatal (`analysis_not_completed`) with a dedicated cause_kind, or (softer) surface a caveat via assistant_text. Requires a decision on how strict to be. |

### Known blocker — local bootstrap

**Branch status: unit-proven, replay-unproven.** The pre-merge local gate requires `pnpm start` to be reachable at the `--base-url`. On this developer machine the server did NOT boot because required credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) live only in the Render deploy env and are not present in the repo `.env` (see [reference_supabase_env.md](../../.claude/projects/-Users-paulslee-Documents-GitHub-olumi-assistants-service/memory/reference_supabase_env.md)).

**Implication:** per-step replay assertions could not run locally on this branch. Unit + integration coverage verifies each individual contract is implemented correctly; it is **supporting coverage**, not a substitute for the six-step end-to-end journey. The six-step replay gate remains UNPROVEN until the staging table above is populated.

**Supporting unit + integration coverage per Phase 2 task:**

- Phase 2.1 install: `src/orchestrator-v5/routing/__tests__/prompt-loader.test.ts` (8 tests, 1 conditional dist test)
- Phase 2.2 recoverable validator: `src/orchestrator-v5/__tests__/turn-executor-recoverable-validator.test.ts` (8 tests, pinned ENTITY_KIND_MISMATCH + commit-failure-per-code)
- Phase 2.3 PLoT matrix: `src/orchestrator-v5/tools/handlers/__tests__/run-analysis-permissive-status.test.ts` (11 tests)
- Phase 2.4 chip gate: `src/orchestrator-v5/compose/__tests__/chip-generator.test.ts` (17 tests)
- Phase 2.5 observability: `src/orchestrator-v5/__tests__/turn-executor-observability.test.ts` (3 tests)
- P1-2 routing-log redaction: `src/orchestrator-v5/__tests__/turn-executor.test.ts` (default + opt-in tests)
- P1-2 validator-log privacy: `src/orchestrator-v5/__tests__/turn-executor-validator-log-privacy.test.ts` (4 tests)

**Required next step:** run the harness against staging after push authorisation. Only a green staging table above changes the branch status from "replay-unproven" to "replay-proven".
