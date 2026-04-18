# Slice C1 — Evidence Pack

**Date:** 2026-04-18
**Branch:** `claude/v5-slice-c1` (off `staging`)
**Branch-base:** `08714098` (Slice B squash-merge)
**Head (pre-push):** `bff0cc22`
**Scope:** Handler spine only. Zero handlers registered by design — every `turn_class: 'handler'` turn dispatches, resolves against the empty registry, and returns UNHANDLED → INTERNAL_ERROR cleanly. Slice C2 (`run_analysis`) will be the first handler registration.

Paul's 2026-04-18 refinement requirement: evidence pack + implementation doc collapsed into a single file (refinement #9). §Implementation below.

---

## 1. Artefacts landed

### New source files

| Path | Purpose |
|---|---|
| [src/orchestrator-v5/tools/registry.ts](../../src/orchestrator-v5/tools/registry.ts) | `HandlerInvocation`, `HandlerOutcome`, `HandlerFn`, `HandlerRegistry` types. `EMPTY_HANDLER_REGISTRY` singleton. `resolveHandler()` typed lookup. File-level JSDoc documents the AbortSignal chain per refinement #5 — handler `signal` is NOT a new construct; it propagates from `turn-executor`'s `turnAbort.signal` through `dispatch({signal})` into `HandlerInvocation`. |

### New test files

| Path | Tests | Purpose |
|---|---|---|
| [src/orchestrator-v5/tools/__tests__/registry.test.ts](../../src/orchestrator-v5/tools/__tests__/registry.test.ts) | 6 | `EMPTY_HANDLER_REGISTRY` size-0 invariant; `resolveHandler` null-on-miss for all 7 V5ActionTypes; hit-on-registered; miss-on-other-key in populated registry |

### Modified source files

| Path | Summary |
|---|---|
| [src/orchestrator-v5/types.ts](../../src/orchestrator-v5/types.ts) | New `C1TurnClass = A2TurnClass \| 'handler'` union + `isC1TurnClass`. New `UnhandledTurnClassReason` (`unhandled_turn_class` / `handler_not_registered` / `missing_handler_id`). `UnhandledTurnClassError` constructor widened: `(reason, attempted)`. `InternalFailure` adds `HANDLER_INVOCATION_FAILED` + `HANDLER_RESULT_INVALID`, both mapping to `INTERNAL_ERROR`. `TurnExecutorTelemetry.turn_class` widened to `C1TurnClass \| null`. |
| [src/orchestrator-v5/budgets.ts](../../src/orchestrator-v5/budgets.ts) | New `DEFAULT_LLM_HANDLER_BUDGET_MS = 45_000`. New `getHandlerBudgetMs()` reads `LLM_BUDGET_HANDLER_MS` at call time (matches TURN_BUDGET_MS / LLM_BUDGET_NARRATE_MS pattern). Wire `Budgets` schema unchanged (CEE-internal function, no schema bump). |
| [src/orchestrator-v5/classify.ts](../../src/orchestrator-v5/classify.ts) | `ClassifierOutputSchema` adds optional `handler_id` + biconditional refinement (Paul refinement #6): `handler_id` present iff `turn_class === 'handler'`. Post-Zod semantic checks widened: `isA2TurnClass` → `isC1TurnClass`. Handler-id validated via `V5ActionTypeSchema.safeParse`. `ClassifyTurnResult` gains `handler_id?: V5ActionType`. |
| [src/orchestrator-v5/dispatch.ts](../../src/orchestrator-v5/dispatch.ts) | `DispatchResult` converted to discriminated union on `turn_class`: A2 variant carries `sanitised`; handler variant carries `handler_id` + `handler_outcome`. New `DispatchOpts.registry` (defaults to `EMPTY_HANDLER_REGISTRY`) + `DispatchOpts.payload`. `onClassified` callback widened to `(C1TurnClass, V5ActionType \| undefined)`. New `dispatchHandler()` resolves + invokes; registry miss throws `UnhandledTurnClassError(reason='handler_not_registered')`. |
| [src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) | `resolvedTurnClass` widened to `C1TurnClass \| null`. Contamination telemetry narrowed by `turn_class !== 'handler'` (handler outcomes bypass narrate sanitiser). Compose stage: 3-branch if/else if/else over `turn_class` — handler branch composes via `composeDirectAnswerResponse` on `handler_outcome.assistant_text` (unreachable in C1, kept for C2 exhaustiveness). `dispatch()` call passes `payload` through for handler invocation support. |

### Modified test files (existing tests remain green; new tests added)

| Path | Summary |
|---|---|
| [src/orchestrator-v5/__tests__/dispatch.test.ts](../../src/orchestrator-v5/__tests__/dispatch.test.ts) | Migrated `UnhandledTurnClassError` construction to new 2-arg signature. Added 14 new tests: handler routing through empty registry, through populated test registry, HandlerInvocation field propagation, llm_calls_used accounting (including handlers with 0 / 1 / 3 LLM calls), `onClassified` handler_id capture, A2 regression (Paul refinement #7 — direct_answer / clarify DispatchResult shape preserved under extended DU). |
| [src/orchestrator-v5/__tests__/classify.test.ts](../../src/orchestrator-v5/__tests__/classify.test.ts) | Added 13 new tests: handler happy-path, every V5ActionType literal, biconditional violations in both directions (stray handler_id on A2, missing handler_id on handler; empty / null handler_id; stray handler_id on unsupported turn_class), semantic handler_id failures (hallucinated value, wrong casing, missing-underscore) → `UnhandledTurnClassError(reason='missing_handler_id')`. |
| [src/orchestrator-v5/__tests__/turn-executor.test.ts](../../src/orchestrator-v5/__tests__/turn-executor.test.ts) | Added 3 new tests: full BI-01 flow with handler class + empty registry → INTERNAL_ERROR envelope + `turn_class='handler'` in telemetry + `llm_calls_used=1`; hallucinated handler_id → `turn_class=null` in telemetry (classifier throws before yielding a class); biconditional violation → LLM_UNAVAILABLE wire code (distinct failure path). |

### No change (explicit scope guard)

- Session module (`src/orchestrator-v5/session/`) — untouched; state-write invariant still OK on all 3 checks
- Migration file, V4 orchestrator code, LLM prompt content, UI repo
- Telemetry event names (`TelemetryEvents` enum) — `turn_executor.completed` already carried `turn_class`
- Wire schemas (`@talchain/schemas@0.5.1`) — no bump; handler budget is CEE-internal

---

## 2. Commit trail

| Commit | Deliverable | Summary |
|---|---|---|
| `f4f73d77` | D1 | Precondition evidence: scoped 238/238 baseline, tsc clean, state-write invariant OK |
| `3c2b550c` | D2 | Types: `C1TurnClass`, `UnhandledTurnClassReason`, `UnhandledTurnClassError` constructor migration; `HANDLER_INVOCATION_FAILED` / `HANDLER_RESULT_INVALID` dormant plumbing. Budgets: `getHandlerBudgetMs()`. |
| `e010ff75` | D3 | Handler registry module + 6 tests |
| `972855a2` | D4+D5 | Classifier biconditional + semantic checks; dispatch handler branch + discriminated-union DispatchResult; turn-executor compose branching |
| `bff0cc22` | D6 | 36 new unit tests across classify + dispatch + turn-executor |

---

## 3. Gates passed (head `bff0cc22`)

| Gate | Command | Result |
|---|---|---|
| Typecheck (build) | `pnpm exec tsc -p tsconfig.build.json --noEmit` | clean |
| Scoped vitest | `pnpm exec vitest run src/orchestrator-v5 tests/regression tests/integration/orchestrate-v2-{a0,a1,a2} tests/integration/server-boot tests/unit/prompts.defaults.test.ts` | **274/274 pass across 22 files** |
| State-write invariant | `bash scripts/validate-state-write-invariant.sh` | OK on all 3 invariants — session surface unchanged in C1 |

### Test count delta

| Baseline | Count | Notes |
|---|---|---|
| C1 start (D1 baseline) | 238 | Post-Slice-B scoped baseline |
| After D3 | 244 | +6 registry tests |
| After D6 | 274 | +13 classify + +14 dispatch + +3 turn-executor |

Net C1 delta: **+36 new tests**, floor 20 / target 30+ both exceeded. Zero A0/A1/A2 regression.

---

## 4. Definition of Done — evidence

Quoting [slice-bcd-plan.md §Tranche 3a](slice-bcd-plan.md) DoD: *"Handler spine operational; zero handlers registered; dispatch routes but nothing executes yet."*

| DoD item | Evidence |
|---|---|
| Handler spine operational | Turn-executor test: classifier emits handler class → dispatch invoked → BI-01 preserved ([turn-executor.test.ts — "UNHANDLED envelope + BI-01 preserved"](../../src/orchestrator-v5/__tests__/turn-executor.test.ts)). Classifier now returns `{turn_class, handler_id}` for 7 V5ActionType literals ([classify.test.ts — "C1 — handler turn class" block](../../src/orchestrator-v5/__tests__/classify.test.ts)). Dispatcher routes handler class through a typed registry with typed invocation + outcome ([dispatch.test.ts — "handler turn routing against populated test registry"](../../src/orchestrator-v5/__tests__/dispatch.test.ts)). |
| Zero handlers registered | `EMPTY_HANDLER_REGISTRY.size === 0` ([registry.test.ts:29](../../src/orchestrator-v5/tools/__tests__/registry.test.ts)). Dispatcher default is `EMPTY_HANDLER_REGISTRY` ([dispatch.ts `dispatchHandler` — `opts?.registry ?? EMPTY_HANDLER_REGISTRY`](../../src/orchestrator-v5/dispatch.ts)). Registry shape is `ReadonlyMap<V5ActionType, HandlerFn>` — C2 will construct a new populated Map rather than mutating. |
| Dispatch routes but nothing executes yet | Turn-executor test covering the full unregistered-handler flow: classify → dispatch → resolveHandler → null → `UnhandledTurnClassError(reason='handler_not_registered')` → existing UNHANDLED catch → INTERNAL_ERROR envelope ([turn-executor.test.ts — "UNHANDLED envelope + BI-01 preserved when classifier emits handler class"](../../src/orchestrator-v5/__tests__/turn-executor.test.ts)). Assertion: `stages_completed` does NOT contain `'compose'` or `'commit'`; `llm_calls_used === 1` (only the classifier ran). |

---

## 5. Telemetry snapshot

No new telemetry events introduced by C1 — the existing `turn_executor.started` / `turn_executor.completed` / `turn_executor.contamination_narrate` event names continue. `turn_class` in the completed event now accepts `'handler'`; downstream dashboards that pivoted on the A2 value set must expand their filter (tracked in handoff).

BI-01 invariant (every `.started` → matching `.completed` with `response_emitted=true`) holds across every new failure path in C1: handler-not-registered, missing_handler_id, biconditional violation. Existing `expectExactlyOneResponseInvariant()` helper ([turn-executor.test.ts:157](../../src/orchestrator-v5/__tests__/turn-executor.test.ts)) exercised in each new C1 test.

---

## 6. Paul's 5 refinements (pre-execution, 2026-04-18)

| # | Refinement | Delivered |
|---|---|---|
| 5 | D3 — document AbortSignal chain in registry.ts JSDoc | File-level JSDoc §"AbortSignal chain" in [registry.ts](../../src/orchestrator-v5/tools/registry.ts). Documents the 4-step flow: turn-executor's turnAbort → dispatch({signal}) → HandlerInvocation.signal → handler's child controller (if any). Paul's constraint 7 reminder embedded. |
| 6 | D4 — biconditional in classifier schema | Zod `.refine()` on ClassifierOutputSchema ([classify.ts](../../src/orchestrator-v5/classify.ts)). Tested in both directions (forward: stray handler_id on A2; reverse: missing handler_id on handler) + edge cases (empty string, null, stray on unsupported class). |
| 7 | D5 — A2 regression test on extended DispatchResult | [dispatch.test.ts — "C1 — A2 regression under extended discriminated DispatchResult"](../../src/orchestrator-v5/__tests__/dispatch.test.ts). 4 tests covering direct_answer + clarify DispatchResult shape, `sanitised` presence, `handler_outcome` absence, `llm_calls_used === 2` preservation. |
| 8 | D6 — ≥20 floor, not target | Delivered 36 new tests. |
| 9 | D8 — collapse implementation doc into evidence pack | This file. No separate `slice-c1-implementation.md`. |

---

## 7. Residual risks carried to C2

1. **composeHandlerResponse not yet implemented.** C1 synthesises a `composeDirectAnswerResponse` on `handler_outcome.assistant_text` in the turn-executor's handler branch — unreachable in C1 but placeholder-adequate for C2. C2 should introduce a real `composeHandlerResponse` that builds an OlumiResponse shaped per handler (factBlock / graphPatchBlock / comparisonBlock per D1/D2 plan).
2. **`HANDLER_INVOCATION_FAILED` / `HANDLER_RESULT_INVALID` failure types plumbed but never thrown in C1.** First handler registration (C2 `run_analysis`) will trigger both paths: wraps the LLM/PLoT call in a try/catch that distinguishes adapter exceptions (INVOCATION_FAILED) from HandlerOutcome Zod-parse failures (RESULT_INVALID). Turn-executor will need a new catch for these at the dispatch boundary to map them cleanly to INTERNAL_ERROR (currently they fall through to the generic UNHANDLED catch — still correct wire code, but less-specific logging).
3. **Classifier prompt content change.** C1 wires the code path; the LLM won't actually emit `turn_class: 'handler'` until the classifier prompt is updated. That's out of C1 scope (prompt changes are explicitly forbidden in the brief) and lands with C2.
4. **`getHandlerBudgetMs()` exported but never read.** C1 ships the function; C2's `run_analysis` handler will wrap its LLM calls in a fresh AbortController that layers on top of the outer `signal`. Paul's constraint 7 (BUDGET_EXCEEDED precedence) is preserved by the outer wall-clock check in turn-executor, but C2 needs to ensure the handler's inner controller listens to the outer abort.

---

## 8. Self-review (brief §3)

Per-deliverable outcomes:

| D | Round 1 verdict | Round 2 findings |
|---|---|---|
| D1 | proceed | None — baseline reproduced Slice B's 238/238 exactly |
| D2 | proceed | `UnhandledTurnClassError` signature change is a breaking change to the V5 module; caught 3 callsites and migrated inline |
| D3 | proceed | Named the tools/ dir per plan (not "handlers/" as exploration suggested); kept interface minimal per Paul's deviation 2 (no budget_ms in HandlerInvocation); deep-tested registry invariants |
| D4+D5 | proceed | Shipped together because classifier shape change strictly required dispatch change for TSC to stay green; discriminated-union DispatchResult was stronger than the original optional-field design; A2 compose logic needed a 3-branch ladder for exhaustiveness |
| D6 | proceed | Two test failures caught pre-commit (registry import regression + payload-guard ordering); fixed before final commit |
| D7 | proceed | No new invariant violations; session module unchanged |

---

## 9. Implementation summary (refinement #9 — doc collapsed into evidence pack)

### Design at a glance

- **Type strategy.** `A2TurnClass` stays narrow (`'direct_answer' | 'clarify'`); new `C1TurnClass = A2TurnClass | 'handler'`. Compose branches that only handle A2 retain strict typing; dispatch / classify / turn-executor migrate to C1TurnClass. Deviation 1 (Paul-approved 2026-04-18).
- **Handler surface.** `HandlerFn = (invocation: HandlerInvocation) => Promise<HandlerOutcome>`. `HandlerInvocation` carries `context`, `payload`, `requestId`, `signal` — the signal is THE SAME AbortSignal the classifier and narrate calls use, documented in registry.ts JSDoc. `HandlerOutcome` mirrors A2's assistant_text + Slice B's handler_facts + llm_calls_used for the telemetry accumulator. Deviation 2.
- **Registry.** `ReadonlyMap<V5ActionType, HandlerFn>`, immutable after construction. C1 ships `EMPTY_HANDLER_REGISTRY` (size 0); C2 will construct a populated Map with `run_analysis` registered. `resolveHandler(registry, handlerId)` returns `HandlerFn | null`.
- **Registry-miss behaviour.** Throws `UnhandledTurnClassError(reason='handler_not_registered', attempted=handlerId)`. Turn-executor's existing UNHANDLED catch at [turn-executor.ts:169](../../src/orchestrator-v5/turn-executor.ts#L169) maps to INTERNAL_ERROR wire code. No new failure type fires in C1. Deviation 3.
- **Classifier biconditional.** Zod `.refine()` enforces `handler_id present iff turn_class === 'handler'`. Mirrors SessionTurnSchema's biconditional from Phase 0 audit §4.5. Violations surface as `ClassifierSchemaViolationError` → LLM_UNAVAILABLE (recoverable); distinct from the semantic `isHandlerId` failure path (UnhandledTurnClassError → INTERNAL_ERROR). Refinement #6.
- **Discriminated DispatchResult.** A2 variant carries `sanitised`; handler variant carries `handler_id` + `handler_outcome`. Narrowing via `turn_class` gives callers the correct shape without optional-field undefined gymnastics. Refinement #7 locked by 4 A2 regression tests.
- **AbortSignal chain.** turn-executor's `turnAbort.signal` (bounded by `TURN_BUDGET_MS`) → `dispatch({signal})` → `HandlerInvocation.signal`. Handlers may layer a fresh `LLM_BUDGET_HANDLER_MS` inner controller on top; they MUST propagate the outer abort to preserve Paul's constraint 7. JSDoc in registry.ts documents this explicitly per refinement #5.
- **Prompt content not changed.** C1 is pure wiring. The classifier prompt currently emits `direct_answer` / `clarify`; it will emit `handler` / `handler_id` only when C2 updates the prompt. Until then the handler branch is unreachable in production traffic; it's reachable in tests via the vi.mock seam.

### Paul's constraint 7 preservation

Every new failure path in C1 goes through turn-executor's existing constraint-7 check ([turn-executor.ts:132-138](../../src/orchestrator-v5/turn-executor.ts#L132-L138)): if `turnAbort.signal.aborted` at the catch boundary, BUDGET_EXCEEDED wins — regardless of whether the inner error was HandlerInvocationFailedError, UnhandledTurnClassError(reason=handler_not_registered), or anything else. C1 does not add a new catch BEFORE the existing BUDGET_EXCEEDED check, so the precedence is preserved structurally.

### Future slice hooks

- **C2 (`run_analysis`):** replaces `EMPTY_HANDLER_REGISTRY` with a new `const HANDLER_REGISTRY = new Map([['run_analysis', runAnalysisHandler]])`. Prompt update lands alongside. Stale-state assertion per plan rev 2 revision 4.
- **D1 (graph-edit):** adds 3 deterministic handlers (set_factor_value / add_constraint / adjust_edge_strength) — zero LLM calls per invocation, NOOP suppression per plan revision 5.
- **D2 (analysis-explanation):** adds 3 narrate-heavy handlers (explain_result / compare_options / what_would_flip) — content-based assertions per plan revision 6.

---

## 10. Sign-off

Slice C1 is **complete** pending Paul's review. All gates green; every DoD item has a passing test; every Paul refinement is test-locked; BI-01 holds across the new failure paths; no A0/A1/A2 regression; zero handlers registered by design.

**Pushes:** none overnight per plan. Branch `claude/v5-slice-c1` head `bff0cc22` is local only pending Paul's green light.

Awaiting approval to push and open PR.
