# Slice A2 — Implementation summary

Landed: 2026-04-17. Two repos (CEE + UI), local commits only, no push, no registry publish. Schema unchanged from A1's 0.4.0 (no bump, no tarball SHA change).

## What ships

### Contracts package — `@talchain/schemas@0.4.0` (unchanged)

A2 introduces no new cross-service types. Vendored tarball SHA unchanged (`16cc078476ab83e5852091fb6181485fbda8d58a13528fad2bf8cb0b88bcd19d`). Wire `TurnClass` enum already included `'clarify'` as a provisional placeholder in 0.4.0 — A2 now uses it.

### CEE — `claude/nostalgic-hermann` (this worktree)

**New modules** under `src/orchestrator-v5/`:
- [classify.ts](../../src/orchestrator-v5/classify.ts) — `classifyTurn(input, opts) → { turn_class }`. One LLM call against `turn_classifier` with `responseFormat: 'json_object'` + Zod structural validation (accepts any non-empty string for `turn_class`), then an explicit A2TurnClass union check. Three failure classes (Paul's correction 3):
  - `ClassifierSchemaViolationError` — malformed output (invalid JSON, missing key, wrong type, empty, extra keys) → LLM_SCHEMA_VIOLATION → LLM_UNAVAILABLE.
  - `UnhandledTurnClassError` (P0) — well-formed JSON whose `turn_class` value is outside A2TurnClass (e.g. `"propose"`, `"frame"`) → UNHANDLED → INTERNAL_ERROR. **Strictly distinct** from schema violation.
  - `NarrateTimeoutError` with `phase: 'classify'` — upstream timeout / abort on the classifier call → UPSTREAM_TIMEOUT (details.phase preserved).
- [clarify.ts](../../src/orchestrator-v5/clarify.ts) — `dispatchClarify(context, opts)` handler. One narrate call against `clarify_narrate`, sanitiser pass, same failure mapping as direct_answer. Reuses existing `invokeNarrate` (`phase: 'narrate'`).

**Extended modules:**
- [dispatch.ts](../../src/orchestrator-v5/dispatch.ts) — renamed `dispatchDirectAnswer` → `dispatch(context, opts)`. Internal flow: classifyTurn → branch → inline direct_answer or delegated clarify. Accepts optional `onClassified(turnClass)` callback so TurnExecutor captures the resolved class **and increments `llm_calls_used` to 1** before narrate runs (so failure-path telemetry is accurate). `UnhandledTurnClassError` remains as a defensive tripwire at the dispatch seam even though classify.ts is the primary thrower. `llm_calls_used` accounting: classifier (1) + handler (1) = 2.
- [compose.ts](../../src/orchestrator-v5/compose.ts) — adds `composeClarifyResponse(input)`. Structurally identical to direct_answer (6-field strict shape); separation kept in case later slices diverge.
- [turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) — calls `dispatch(context)` with `onClassified` callback; accrues `llmCallsUsed` as calls complete (1 on classifier success, 2 on dispatch success); branches compose on `dispatchResult.turn_class`; maps errors:
  - `ClassifierSchemaViolationError` → `LLM_SCHEMA_VIOLATION` → wire `LLM_UNAVAILABLE` with `details.phase: 'classify'`.
  - `UnhandledTurnClassError` → `UNHANDLED` → wire `INTERNAL_ERROR` with `details.reason: 'unhandled_turn_class'` (P0).
  - `NarrateTimeoutError` → `LLM_TIMEOUT` → wire `UPSTREAM_TIMEOUT` with `details.phase` read from the error (`classify` or `narrate`, **not hardcoded**).
  `turn_class` is **omitted** from `turn_executor.started` (classifier hasn't decided). `turn_executor.completed` emits `turn_class: A2TurnClass | null`; null when the classifier itself failed (schema violation, unsupported class, timeout, or abort). `stages_completed` gains `classify` then `dispatch` on successful classify.
- [types.ts](../../src/orchestrator-v5/types.ts) — replaces `A1TurnClass` with `A2TurnClass = 'direct_answer' | 'clarify'`. Adds `A2_TURN_CLASSES` runtime list, `isA2TurnClass(value)` type guard, `LLM_SCHEMA_VIOLATION` to `InternalFailure`. `INTERNAL_TO_WIRE` maps it to `LLM_UNAVAILABLE`. `UnhandledTurnClassError` lives here (not dispatch.ts) so classify.ts can throw it without a circular import; dispatch.ts re-exports for A1-era callers. `TurnExecutorTelemetry.turn_class` nullable.
- [budgets.ts](../../src/orchestrator-v5/budgets.ts) — comment block documents budget-independence semantics (Paul's correction 4): classifier and narrate each get a fresh `LLM_BUDGET_NARRATE_MS`; outer `TURN_BUDGET_MS` is the shared wall-clock ceiling; worst-case LLM time = 2 × narrate budget, bounded by the outer.

**Prompt plumbing (all additive):**
- [src/prompts/schema.ts](../../src/prompts/schema.ts) — new `CeeTaskId` literals `clarify_narrate`, `turn_classifier`.
- [src/adapters/llm/prompt-loader.ts](../../src/adapters/llm/prompt-loader.ts) — `OPERATION_TO_TASK_ID` gains `clarify_narrate` + `turn_classifier`.
- [src/prompts/defaults.ts](../../src/prompts/defaults.ts) — registers placeholder defaults for both task_ids. **Paul is sole prompt author**; placeholders exist so the store / Paul can override without code changes. The classifier placeholder asks for a single JSON object with `turn_class`; the clarify placeholder asks for one short clarifying question in prose.

**A2 fixtures** under `tests/fixtures/contracts/b1/slice-a2/`:
- [clarify-happy.json](../../tests/fixtures/contracts/b1/slice-a2/clarify-happy.json)
- [clarify-llm-timeout.json](../../tests/fixtures/contracts/b1/slice-a2/clarify-llm-timeout.json)
- [clarify-contamination.json](../../tests/fixtures/contracts/b1/slice-a2/clarify-contamination.json)

No V4 baseline fixture for clarify — the 7 A1 candidate bundles are all direct_answer-shaped. Documented in `clarify-happy.json`'s `_meta.note_a2`.

**A1 fixture annotations** — existing A1 fixtures gain `_meta.note_a2_update` explaining the `llm_calls_used` bump (1 → 2) and how the mock routing changed for the budget-exceeded case. The fixture telemetry values are now accurate post-A2.

**Tests (CEE):**
- Unit — `src/orchestrator-v5/__tests__/`:
  - [classify.test.ts](../../src/orchestrator-v5/__tests__/classify.test.ts) — 12 tests (happy, schema violations, timeouts, generic).
  - [clarify.test.ts](../../src/orchestrator-v5/__tests__/clarify.test.ts) — 7 tests (happy, contamination, empty, timeout, invariants).
  - [dispatch.test.ts](../../src/orchestrator-v5/__tests__/dispatch.test.ts) — 10 tests (direct_answer branch, clarify branch, classifier failures, narrate failures, UnhandledTurnClassError tripwire).
  - [turn-executor.test.ts](../../src/orchestrator-v5/__tests__/turn-executor.test.ts) — extended from A1's 15 to 21 tests (adds clarify happy path, clarify contamination, classify timeout branch, LLM_SCHEMA_VIOLATION mapping, per-outcome response_emitted cases).
  - [compose.test.ts](../../src/orchestrator-v5/__tests__/compose.test.ts) — adds 2 clarify cases (4 total).
  - [budgets.test.ts](../../src/orchestrator-v5/__tests__/budgets.test.ts) — adds 3 budget-independence cases (10 total).
- Integration:
  - [tests/integration/orchestrate-v2-a2.test.ts](../../tests/integration/orchestrate-v2-a2.test.ts) — 4 tests (3 fixtures + BI-01 missing-owner detector).
  - [tests/integration/orchestrate-v2-a1.test.ts](../../tests/integration/orchestrate-v2-a1.test.ts) — updated mock to phase-aware (classify JSON vs narrate prose); `llm_calls_used` expectation 1 → 2 on happy path.
  - [tests/integration/orchestrate-v2.test.ts](../../tests/integration/orchestrate-v2.test.ts) — A0 test mock updated to return direct_answer classifier JSON on `responseFormat: 'json_object'` calls.
- Unit (prompts defaults) — [tests/unit/prompts.defaults.test.ts](../../tests/unit/prompts.defaults.test.ts) — `JSON_EXEMPT_TASKS` exemption list extended to `direct_answer_narrate` and `clarify_narrate` (narrate-mode prompts output prose, not JSON). `turn_classifier` remains checked and does contain "json".

**Full test count (CEE A0+A1+A2 surface): 157/157 pass** across 15 test files (post-correction run adds 7 regression guards for the P0/P1a/P1b fixes):
- 7 A2 unit tests (classify/clarify/dispatch/compose/budgets — new files or extended)
- 3 A2 integration tests (orchestrate-v2-a2.test.ts)
- 5 A1 integration tests (unchanged semantics)
- Plus all A0 + orchestrator-v5 + prompts.defaults + server-boot tests.

### UI — `ui/ai-panel-tranche-1` (A1 branch, worktree at `.claude/worktrees/v5-slice-a2/`)

**Edits:**
- [src/v5/eligibility.ts](../../../../DecisionGuideAI/.claude/worktrees/v5-slice-a2/src/v5/eligibility.ts) — JSDoc only. Documents `direct_answer + clarify` scope. No predicate conditions added or relaxed. Investigation Target 4 rationale included.
- [src/v5/__tests__/eligibility.test.ts](../../../../DecisionGuideAI/.claude/worktrees/v5-slice-a2/src/v5/__tests__/eligibility.test.ts) — new describe block "A2: ambiguous free-text messages route to V5 unchanged" (4 tests).
- [src/v5/__tests__/end-to-end.test.ts](../../../../DecisionGuideAI/.claude/worktrees/v5-slice-a2/src/v5/__tests__/end-to-end.test.ts) — 2 new tests: clarify envelope routes to `text_only`; `LLM_UNAVAILABLE` envelope routes to `typed_error`.

**No component changes.** `TypedErrorRenderer.tsx` already has a `LLM_UNAVAILABLE` case from A1. The clarify wire shape is structurally identical to direct_answer — text-only, empty blocks/actions/insights — so the existing assistant-text render path handles it. `useConversation.ts` unchanged.

**Tests (UI): 55/55 pass** (up from A1's 35, with new A2 cases). Tarball vendored SHA unchanged.

### BFF proxy — no change.

## Intentional deviations from plan

- **Mock architecture in A0 and A1 integration tests.** The shared `getAdapter` mock now routes on `args.responseFormat === 'json_object'`. Classifier calls get JSON; narrate calls get the fixture's prose. This is A2 plumbing in A1 test files, unavoidable given the classifier now precedes narrate on every turn.
- **`LLM_SCHEMA_VIOLATION` maps to existing `LLM_UNAVAILABLE` wire code.** Plan locked "no schema bump", so adding a dedicated `LLM_SCHEMA_VIOLATION` wire code is out of scope. `LLM_UNAVAILABLE`'s user-facing text ("The model is temporarily unavailable. Please retry shortly.") is the correct user action for a transient classifier structured-output malfunction. Commentary in `types.ts` documents the mapping + rationale.
- **No repair-loop on classifier failure.** Paul's correction 3 described classifier parse-error as "recoverable LLM fault after one repair." A2 treats "recoverable" as the MAPPING choice (not UNHANDLED, but a retry-it user-facing code), not as an implementation commitment to a repair call. A3+ may add a single retry; A2 maps to the envelope directly to keep `llm_calls_used` accounting predictable.
- **Structural vs semantic classifier failure split (P0 fix).** Original implementation used a Zod enum `z.enum(['direct_answer','clarify'])` which collapsed both malformed JSON and out-of-union values into `ClassifierSchemaViolationError`. Review flagged this as a violation of Paul's correction 3 ("UNHANDLED reserved for truly unknown turn classes from valid classifier output"). Corrected: Zod accepts `z.string()` for the field, then an explicit `isA2TurnClass` check throws `UnhandledTurnClassError` for unsupported values. Regression guards at classify, dispatch, and turn-executor seams prevent drift.
- **`llm_calls_used` accrues as calls complete.** Earlier implementation assigned from dispatch result only on full success, reporting `llm_calls_used: 0` on narrate-timeout-after-classify-success. Now the `onClassified` callback bumps the counter to 1 before narrate runs; the 2-on-success value is still assigned from the dispatch result. Failure paths now correctly distinguish classify-side (0) from narrate-side-after-classify (1) in telemetry.
- **`phase` on `NarrateTimeoutError`.** Originally this error type was narrate-only. A2 classifier timeouts were wrapped in it and then emitted with hardcoded `phase: 'narrate'` — losing attribution. Added `phase: 'classify' | 'narrate'` to the error class; `classify.ts` passes `'classify'`, `invokeNarrate` passes `'narrate'`, and `turn-executor.ts` reads `error.phase` for the failure-envelope `details.phase`.
- **`turn_class` omitted from `turn_executor.started`.** Earlier code emitted a provisional `'direct_answer'` default, which would skew any metric aggregating started events by class. Now omitted; authoritative value lives on `completed`, typed as `A2TurnClass | null` (null when classifier failed before resolving).
- **UI branch = `ui/ai-panel-tranche-1`.** A1 UI code sits on this branch (A1 follow-up commit `06374026` is a direct parent of the A2 baseline). The brief said "UI branch TBD per Paul"; continuing `ui/ai-panel-tranche-1` matches the CEE pattern of continuing `claude/nostalgic-hermann`. A new worktree was created at `.claude/worktrees/v5-slice-a2/` to avoid disturbing the user's active checkout.

## Verification summary

- **CEE tsc:** `pnpm exec tsc -p tsconfig.build.json --noEmit` — zero errors in V5 A2 code. 44 pre-existing errors elsewhere (generated/openapi.d.ts missing, V4 implicit-any) unchanged from baseline.
- **CEE tests (A0+A1+A2 scope):** 157/157 pass across 15 test files (`src/orchestrator-v5/**`, `tests/integration/orchestrate-v2*.test.ts`, `tests/unit/prompts.defaults.test.ts`, `tests/integration/server-boot.test.ts`).
- **CEE regression:** V4 test failures in `tests/integration/orchestrator/**`, `admin.models.test.ts`, `cee.ask.test.ts` are **pre-existing** — verified by stashing A2 changes and replaying the same failures against the pre-A2 baseline.
- **UI tsc:** `pnpm exec tsc --noEmit` — zero errors.
- **UI tests:** 55/55 pass in `src/v5/**` + `src/canvas/conversation/__tests__/v4-regression-smoke.spec.ts`.
- **Transport invariant:** `bash scripts/validate-transport-invariants.sh` — OK (buffered-JSON only, no SSE, no `reply.raw.write`).
- **Tarball SHA:** `bash scripts/validate-tarball-sha.sh` — OK (unchanged from A1).

## Self-review (Codex checklist)

- **Contract compliance:** Every emitted `OlumiResponse` Zod-validates against boundary schema. Failure envelopes use existing `FAILURE_USER_TEXT` table. No V5 fields leak into V4 envelope.
- **No seam leakage:** New A2 modules import only from `@talchain/schemas`, existing V5 modules (`llm-adapter`, `sanitise`, `types`, etc.), and the shared adapter seam (`adapters/llm/router`, `prompt-loader`, `errors`). Zero V4 pipeline imports.
- **No undeclared side effects:** `commit()` remains a no-op per constraint 11. No new telemetry events — reuses `turn_executor.started` / `.completed` / `.contamination_narrate`. `turn_class` field in completed event now reflects classifier outcome.
- **No dead/duplicate mechanisms:** Single `dispatch` entry point. Single classifier module. Single clarify handler module. `composeClarifyResponse` is structurally identical to direct_answer today — kept separate so later slices can diverge without touching direct_answer composition. `UnhandledTurnClassError` tripwire for out-of-union classifier output preserved (P0).
- **Acceptance pack match:** 3 A2 fixtures (happy, llm-timeout, contamination) + 1 BI-01 missing-owner test. Every fixture's `commit_performed` + `failure_type` + `turn_class` asserted against telemetry. `response_emitted=true` invariant holds across every outcome path (proved by the per-case describe in `turn-executor.test.ts`).
- **Paul's 4 corrections traced:**
  1. Internal naming `clarify` — `A2TurnClass`, `clarify_narrate`, `clarify.ts`, `composeClarifyResponse`, fixtures prefixed `clarify-`. Telemetry uses `clarify` in `turn_class` field.
  2. Telemetry compat — audit confirmed zero A1 tests assert `stages_completed`. Adding `classify` stage is additive. `llm_calls_used` assertions updated from 1 → 2 on happy paths (semantically accurate).
  3. Classifier parse error → `LLM_SCHEMA_VIOLATION` → `LLM_UNAVAILABLE` wire code. `UNHANDLED` reserved for out-of-union classifier values and generic errors. Commentary in `types.ts` documents the rationale.
  4. Budget independence — `budgets.ts` comment documents semantics. Three unit tests in `budgets.test.ts` pin independence, worst-case bound, and no-shared-counter invariants.

## Known gaps carried to A3+

- **Post-tool-failure clarify** — deferred. Requires widening the UI eligibility predicate + a CEE dispatcher path that retries with a clarification prompt after a handler fails.
- **Repair-loop on classifier schema violation** — A2 maps parse failure directly to the envelope. A3+ may add a single structured-output retry before giving up.
- **No V4 behavioural baseline for clarify** — the 7 A1 candidate bundles are all direct_answer-shaped. If Paul supplies a clarify bundle from production later, add it as `tests/fixtures/v4-baseline/clarify-v4-baseline.json`.
- **Handler facts still empty** — `HandlerFactSchema = z.never()` in `@talchain/schemas/orchestrator`. A2 has zero handlers; C+ populates the union.
- **MCQ output for clarify** — A2 clarify is free-text prose. Future slices may add MCQ-structured clarification using the `clarify_brief` shape from V4's brief pipeline. Not required for A2.

## A2 brief line items (carried forward)

None — every A2 deliverable is satisfied. A3 picks up from here.
