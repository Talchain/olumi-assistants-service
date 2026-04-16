# Slice A1 — Implementation summary

Landed: 2026-04-16. Three repos, local commits only, no push, no registry publish.

## What ships

### Contracts package — `@talchain/schemas@0.4.0` (at `~/Documents/GitHub/olumi-schemas/`)

- `/orchestrator` subpath populated (previously an empty stub):
  - `ConversationMessageSchema` — role/content turn entry.
  - `TurnContextSchema` + building blocks (`EntityRegistrySchema`, `CapabilityFlagsSchema`, `BudgetsSchema`). Forward-compatible per AI Arch v4.1 §5.
  - `LLMAdapterRequestSchema` / `LLMAdapterResponseSchema` — narrate-mode I/O.
  - `HandlerFactSchema = z.never()` — empty-union placeholder (A1 ships zero handlers).
- **No `/boundary` changes.** `OlumiResponseSchema` is final as v0.3.0 defined it (6 required fields, strict): `response_version`, `assistant_text`, `blocks`, `suggested_actions`, `insights`, `stage_indicator`.
- Tests: 23 new `/orchestrator` tests + 172 existing = **195/195 green**.
- Built + packed: `talchain-schemas-0.4.0.tgz`. Installed in CEE and UI via `file:` reference. **Not published to npm.**

### CEE (this worktree) — `claude/nostalgic-hermann`

**TurnExecutor** — `src/orchestrator-v5/`:
- [turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) — single entry `runTurnExecutor(payload, requestId)`. §2.1.2 shape, §2.1.3 ordering, §2.1.9 telemetry. Top-level try/finally enforces **BI-01** (every `turn_executor.started` matched by `.completed` with `response_emitted=true`).
- [build-turn-context.ts](../../src/orchestrator-v5/build-turn-context.ts) — skeletal A1 TurnContext (capabilities all false).
- [dispatch.ts](../../src/orchestrator-v5/dispatch.ts) — direct_answer **exclusively** (Paul constraint 1). Any other class → `UnhandledTurnClassError` → UNHANDLED.
- [llm-adapter.ts](../../src/orchestrator-v5/llm-adapter.ts) — thin wrapper over `getAdapter('direct_answer_narrate').chat(...)`. Maps `UpstreamTimeoutError` / abort → `NarrateTimeoutError`.
- [sanitise.ts](../../src/orchestrator-v5/sanitise.ts) — strips XML tags + em-dashes; flags contamination but keeps the response as a success (**BI-02**).
- [compose.ts](../../src/orchestrator-v5/compose.ts) — OlumiResponse assembly with strictly the 6 schema fields.
- [commit.ts](../../src/orchestrator-v5/commit.ts) — A1 no-op per Paul constraint 11 (no writes, no mutation).
- [failure-response.ts](../../src/orchestrator-v5/failure-response.ts) — FailureType → ErrorBlock envelope using `FAILURE_USER_TEXT`.
- [budgets.ts](../../src/orchestrator-v5/budgets.ts) — env-driven `TURN_BUDGET_MS` (default 180000) + `LLM_BUDGET_NARRATE_MS` (default 60000) per Implementation Plan v2.2 (Paul constraint 5). Reads `process.env` on every call so runtime overrides take effect.
- [types.ts](../../src/orchestrator-v5/types.ts) — internal `InternalFailure` ↔ `BoundaryErrorCode` mapping.

**Timeout precedence** (Paul constraint 7): `turn-executor.ts` inspects `turnAbort.signal.aborted` **before** mapping inner `NarrateTimeoutError`. If the outer wall-clock aborted during an in-flight narrate call, the outcome is `TURN_BUDGET_EXCEEDED`, not `UPSTREAM_TIMEOUT`. Covered by a dedicated unit test.

**Route wiring** — [src/orchestrator/route-v2.ts](../../src/orchestrator/route-v2.ts) replaces the A0 feature-unavailable stub with `runTurnExecutor(payload, requestId)`. B1 ingress/egress validators unchanged.

**B5 validator** — [src/validators/b5.ts](../../src/validators/b5.ts) shape-validates `LLMAdapterRequest` / `LLMAdapterResponse` at the CEE-internal narrate seam.

**Prompt-loader** — additive entry in `OPERATION_TO_TASK_ID`: `direct_answer: 'direct_answer_narrate'`. New `CeeTaskId` literal `direct_answer_narrate` in `src/prompts/schema.ts`. Default registered in `src/prompts/defaults.ts` (placeholder content; Paul remains sole prompt author).

**Telemetry** — `TelemetryEvents` gains `TurnExecutorStarted`, `TurnExecutorCompleted`, `TurnExecutorContaminationNarrate` (see `src/utils/telemetry.ts:440`).

**Fixtures** — `tests/fixtures/contracts/b1/slice-a1/`:
- `direct-answer-happy.json`
- `direct-answer-llm-timeout.json`
- `direct-answer-budget-exceeded.json`
- `direct-answer-contamination.json`

**V4 regression fixture** — `tests/fixtures/v4-baseline/direct-answer-v4-baseline.json` derived from bundle d8d0cab0 Paul handed over.

**Tests (CEE, 73 total)**:
- 38 unit tests under `src/orchestrator-v5/__tests__/` — behavioural branch coverage + timeout-precedence case.
- 7 A0 integration tests (updated valid-payload fixture to A1 happy-path, adapter mocked).
- 5 A1 integration tests.
- 2 V4 regression smoke tests (from A0, carried forward).
- 2 server-boot tests.
- 17 V4 baseline structural regression tests (Paul constraint 8 — shape-match + element Zod-validate; count-exact only on invariants).
- 2 tarball SHA drift simulation tests.

**CI / pre-push hooks** — `scripts/`:
- `validate-transport-invariants.sh` — grep guard against `reply.raw.write` and `text/event-stream` in `src/orchestrator-v5/` and `src/orchestrator/route-v2.ts`. Non-zero exit blocks push (Paul constraint 10).
- `validate-tarball-sha.sh` — compares vendored tarball SHA against the `.sha256` manifest. Non-zero exit with a stable error message so the drift-simulation test can assert against it.
- `validate-prepush.sh` — adds `check_tarball_sha` and `check_transport_invariants` after the dependency audit. `check_dependency_audit` now allowlists `@talchain/schemas`.

**Vendored tarball** — `vendor/talchain-schemas-0.4.0.tgz` + `.sha256` (SHA `16cc078476ab83e5852091fb6181485fbda8d58a13528fad2bf8cb0b88bcd19d`). `package.json` pins `"@talchain/schemas": "file:./vendor/talchain-schemas-0.4.0.tgz"`.

### UI (`~/Documents/GitHub/DecisionGuideAI/`)

**`useConversation.ts` V5 branch** — `src/canvas/conversation/useConversation.ts` (~line 2382). Minimum allow-list per Pre-impl B (Paul constraint 4): `inFlightRef`, `beginInteractionChain` (both already set before the branch), `addMessage(user bubble)`, `setIsThinking(true)`, `bindRequestToInteraction`. Skips `recordUserAction`, `setLastFailedInput(null)`, `setIsGenerating(true)`, `AbortController`/timeout setup, `recordRequestContext`. On `fall_through_v4` → unwinds V5 loading state and lets V4 continue.

**End-to-end test** — `src/v5/__tests__/end-to-end.test.ts` (4 tests): flag-on happy path, typed error (UPSTREAM_TIMEOUT), typed error (TURN_BUDGET_EXCEEDED), flag-off fall-through invariant.

**Vendored tarball + SHA manifest + pin** — `vendor/talchain-schemas-0.4.0.tgz` + `.sha256` (identical SHA). `package.json` pins `0.4.0`.

**Pre-push hook** — `scripts/validate-prepush.sh` gains Check 6a (V5 tarball SHA manifest). Check 6 (dependency audit) now allowlists `@talchain/schemas`.

**Tests (UI, 35 total)**:
- 4 new A1 end-to-end tests.
- 31 A0 tests carried forward (responseParser 5, responseRouter 6, v5Adapter 5, TypedErrorRenderer 12, v4-regression-smoke 3).

### BFF proxy — no change.

## Intentional deviations from plan

- **`useConversation.ts` V5 branch is ~100 lines, not a single `if` guard.** The brief sketched a 5-line branch. Real UI wiring requires: user-bubble `addMessage`, scenario_id fallback, typed-error rendering via `addMessage` (no dedicated `TypedErrorRenderer` drive since it's component-level), and error handling that unwinds `setIsThinking`. The allow-list (5 effects run, 5 skipped) is implemented exactly as Pre-impl B specifies; branch size is implementation detail, not scope creep.
- **V4 regression is a contract-snapshot test, not a pipeline replay.** Replaying the V4 pipeline in CI requires a full staging round-trip (live LLM, PLoT, ISL). The test instead asserts the d8d0cab0 bundle's recorded shape satisfies the Paul-constraint-8 invariants, serving as a frozen V4 contract. Any future V4 or V5 change that would break the V4 envelope shape fails this test. See the fixture's `_meta.note_a1` field.
- **A0 `valid-turn-payload.json` fixture updated.** A0 expected the FEATURE_NOT_ENABLED envelope. A1 replaces that stub with TurnExecutor, so this fixture's `expected.body` now asserts a direct_answer success envelope. Added `mock_narrate_output` field; `orchestrate-v2.test.ts` mocks the adapter with this value. The B1 ingress/egress boundary behaviour the A0 test was designed to cover is unchanged.

## Verification summary

- `npm test` in `olumi-schemas`: **195/195 pass** (23 new + 172 existing).
- CEE: **73/73 pass** across A0 integration, A1 integration, orchestrator-v5 units, server-boot, V4 regression (both smoke and baseline), tarball drift.
- UI: **35/35 pass** (4 new + 31 carried forward from A0).
- `pnpm exec tsc -p tsconfig.build.json --noEmit` in CEE: no errors on A1 files (pre-existing `generated/openapi.d.ts` missing-module errors are out of A1 scope per memory/CLAUDE.md).
- `pnpm exec tsc --noEmit` in UI: no errors on `useConversation.ts` or `src/v5/`.
- `bash scripts/validate-transport-invariants.sh` passes on clean tree, rejects injected violation.
- `bash scripts/validate-tarball-sha.sh` passes on clean tree, rejects drifted tarball.

## Self-review (Codex checklist)

- **Contract compliance:** Every emitted `OlumiResponse` Zod-validates; failure envelopes follow addendum §2.1.5 mapping via `FAILURE_USER_TEXT`. No V5 fields leak into V4 envelope (v4-baseline.test.ts asserts negative).
- **No seam leakage:** `src/orchestrator-v5/` imports only `@talchain/schemas`, `src/adapters/llm/router.js`, `src/adapters/llm/prompt-loader.js`, `src/adapters/llm/errors.js`, `src/utils/telemetry.js`. Zero V4 pipeline imports. `route-v2.ts` imports only `@talchain/schemas/boundary`, `utils/request-id`, `utils/telemetry`, `validators/b1.js`, `orchestrator-v5/turn-executor.js`. Still no V4 imports.
- **No undeclared side effects:** `commit()` is a no-op per Paul constraint 11. TurnExecutor emits `turn_executor.started`, `.completed`, optional `.contamination_narrate`. No cache writes, DB access, session mutation, graph mutation. B1 egress validator still runs on every turn via `validators/b1.ts`.
- **No dead/duplicate mechanisms:** Single LLM narrate path (`invokeNarrate` → `getAdapter('direct_answer_narrate').chat`). Single failure-envelope factory (`buildFailureResponse`). Single dispatcher (`dispatchDirectAnswer`). Empty `HandlerFactSchema` stub prevents accidental handler-fact construction at the type level.
- **Acceptance pack match:** 4 A1 fixtures + V4 baseline fixture. Per-outcome test in `turn-executor.test.ts` asserts `response_emitted=true` across every outcome (happy, contamination, LLM_TIMEOUT, BUDGET_EXCEEDED, empty output, generic throw). Missing-owner detector in `orchestrate-v2-a1.test.ts` proves every `started` has a matching `completed` across fixture replay.
- **Paul's 11 clarifications traced:**
  1. direct_answer only — dispatch.ts rejects all other classes with `UnhandledTurnClassError` → UNHANDLED.
  2. Canonical field names — code, fixtures, tests all use `suggested_actions`, `insights`, `stage_indicator` verbatim.
  3. OlumiResponseSchema documented upfront — see `slice-a1-investigation.md` §Pre-impl A.
  4. useConversation minimum side effects — Pre-impl B allowlist implemented verbatim (5 run, 5 skip).
  5. Budget defaults — `TURN_BUDGET_MS=180000`, `LLM_BUDGET_NARRATE_MS=60000` in `budgets.ts`.
  6. `updated_session_state` omitted (not in schema).
  7. BUDGET_EXCEEDED precedence — `turn-executor.ts` inspects `turnAbort.signal.aborted` first; dedicated unit test.
  8. V4 regression structural, not count-exact — `tests/regression/v4-baseline.test.ts` splits into count-exact invariants vs structural shape.
  9. LLM mocked at adapter seam — every A1 test mocks `getAdapter(...).chat`. No live provider calls in the acceptance pack.
  10. Transport invariant CI step — `scripts/validate-transport-invariants.sh` wired into `validate-prepush.sh`.
  11. commit() wording tightened — comment in `commit.ts` quotes constraint 11 verbatim.

## Known gaps carried to A2+

- **Clarification turn class** — A1 rejects clarification (UNHANDLED). A2 will add the clarification path.
- **Stage mapping** — A1 always sets `stage: 'frame'` on the wire. Full graph-state-aware stage routing lands in later slices.
- **Handler facts** — `HandlerFactSchema = z.never()`. A1 has zero handlers. C+ slices populate the union.
- **scenario_id bootstrap in V5 UI branch** — if `currentScenarioId` is null, the V5 branch falls through to V4 (which allocates). Later slices will let V5 handle scenario creation without round-tripping.

## A1 brief line items (carried forward)

None — every A1 deliverable is satisfied. A2 picks up from clarification support.
