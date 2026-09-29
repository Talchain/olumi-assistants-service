# Slice A1 — Investigation

**Branch:** CEE `claude/nostalgic-hermann` (this worktree). UI `staging`.
**Stage 1 approved with 11 clarifications** (see §Decisions locked).
**Two pre-implementation investigations added per Paul's constraints 3 & 4.**

---

## Context

A0 landed the contracts foundation and B1 boundary seam:

- `@talchain/schemas@0.3.0` ships a populated `/boundary` subpath and an empty `/orchestrator` stub reserved for A1.
- CEE has `/orchestrate/v2/turn` registered under `ENABLE_V5_ORCHESTRATOR=true`, returning a typed `FEATURE_NOT_ENABLED` envelope today.
- UI has `v5Adapter`, `responseParser`, `responseRouter`, `TypedErrorRenderer` wired but unused in production: the V5 flag is off by default and `useConversation.ts` was intentionally not edited. V4 regression smoke pins the `fall_through_v4` guarantee.

A1 replaces the feature-unavailable envelope with a real `TurnExecutor` that produces renderable `direct_answer` responses end to end, and lands the single V5 branch in UI's `useConversation.ts` so a flag flip drives real content.

---

## Stage 1 findings (7 targets)

### 1. LLM adapter surface (CEE)

Single unified entry point: **`src/adapters/llm/router.ts::getAdapter(task?, modelOverride?)`**.

- Wraps OpenAI (`src/adapters/llm/openai.ts`) and Anthropic (`src/adapters/llm/anthropic.ts`) behind one `LLMAdapter` interface (`src/adapters/llm/types.ts:1-597`).
- Composed output: `withUsageTracking(withCaching(baseAdapter))` — caching, retry (`src/utils/retry.ts`, 3 attempts with backoff + jitter), and usage tracking pre-wired.
- A1 needs only `chat(args: ChatArgs, opts: CallOpts): Promise<ChatResult>`.
- `ChatArgs` (`types.ts:290-314`): `system`, `userMessage`, `temperature?`, `maxTokens?`, `responseFormat?`, `outputSchema?`.
- `CallOpts` (`types.ts:333-344`): `requestId`, `timeoutMs`, `abortSignal?`, `signal?`. **AbortSignal first-class.**
- Typed errors in `src/adapters/llm/errors.ts`: `UpstreamTimeoutError` (with `phase`, `elapsedMs`), `UpstreamHTTPError`, `UpstreamNonJsonError`.
- Per-model timeouts from `src/config/timeouts.ts` (`HTTP_CLIENT_TIMEOUT_MS`, `REASONING_MODEL_TIMEOUT_MS`).

A1's `src/orchestrator-v5/llm-adapter.ts` wraps `getAdapter('direct_answer_narrate').chat(...)`. Maps `UpstreamTimeoutError → LLM_TIMEOUT` internally. **No new LLM provider code** — purely a thin adapter over the established seam.

### 2. Prompt loading mechanism (CEE)

Entry point: **`src/adapters/llm/prompt-loader.ts::getSystemPrompt(taskId)`** (lines 169-360).

- 5-minute TTL cache, 10-minute stale-while-revalidate, proactive refresh at 80 %.
- Resolution: cache → store fetch (5 s, `PROMPT_STORE_FETCH_TIMEOUT_MS`) → hardcoded default.
- Defaults registered in `src/prompts/defaults.ts` via `registerAllDefaultPrompts()`.
- Task-id map at `prompt-loader.ts:102-116` (`OPERATION_TO_TASK_ID`).

**Thinnest safe seam for A1:**
1. Add `direct_answer: 'direct_answer_narrate'` to `OPERATION_TO_TASK_ID`.
2. Register a hardcoded default fragment in `defaults.ts` via `registerDefaultPrompt('direct_answer_narrate', '...')`.
3. TurnExecutor: `await getSystemPrompt('direct_answer_narrate')`.

Additive and idempotent. Paul remains sole author of fragment content. **No V5-local prompt wrapper** per Paul's rejects list.

### 3. Existing TurnContext shape

Closest V4 analogue: **`src/orchestrator/deterministic/turn-context.ts::DeterministicTurnContext`** — bundles stage, entity registry, capabilities, graph/analysis summaries, conversation turns, signals, eligible actions.

The `/orchestrator` subpath in `@talchain/schemas@0.3.0` is genuinely empty (`export {};` marker).

**A1 creates a fresh V5 TurnContext in `@talchain/schemas@0.4.0/orchestrator`**, minimal and forward-compatible per AI Arch v4.1 §5:
- `stage: Stage`
- `entity_registry: { option_ids: string[]; goal_id: string | null }` (skeleton only)
- `capabilities: Record<CapabilityKey, false>` (all false in A1 — no handlers exist)
- `messages: ConversationMessage[]`
- `session_id: string`, `request_id: string`
- `budgets: { turn_ms: number; llm_narrate_ms: number }`

V4 `DeterministicTurnContext` is **reference only** — not imported, not cloned.

### 4. Telemetry infrastructure (CEE)

`src/utils/telemetry.ts`:
- `TelemetryEvents` frozen const object (line 53).
- `emit(event: string, data: Record<string, unknown>)` at line 730.
- A0 added `BoundaryValidation: "boundary.validation"` (line 440) using this pattern.

A1 adds to `TelemetryEvents`:
```
TurnExecutorStarted:   "turn_executor.started"
TurnExecutorCompleted: "turn_executor.completed"
```

Every `started` emission has a matching `completed` emission enforced by top-level try/finally in `TurnExecutor.run`. Event fields: `request_id`, `session_id`, `stage`, `turn_class`, `stages_completed`, `response_emitted`, `llm_calls_used`, `commit_performed`, `failure_type`, `wall_clock_ms`.

`response_emitted=false` is impossible — unit test drives every `FailureType` and asserts the flag is `true` on all `completed` events. The typed failure envelope itself counts as a response.

### 5. `useConversation.ts` entry point (UI)

File: `/Users/paulslee/Documents/GitHub/DecisionGuideAI/src/canvas/conversation/useConversation.ts` (3106 lines).
Dispatcher: `sendTurn` at line 2316. 10 observed V4 side effects between line 2364 and 2527. V5 imports (`callV5Turn` / `v5Adapter` / `routeV5Response`) **absent** — A1 adds them.

V5 branch placement: **top of `sendTurn`**, before any side effect, short-circuiting on flag-on + renderable V5 result. See §Pre-impl B for the minimum allow-list Paul requested.

### 6. Session state mutation site

**Critical finding:** V4 does **not** persist conversation turns to external storage.
- Session state is ephemeral, round-tripped via `updated_session_state` on the V4 envelope.
- Mutation sites in `src/orchestrator/deterministic/pipeline-v4.ts:447` and `:1285`.
- UI owns conversation history; appends `{ role: 'assistant', content: assistant_text, ... }` locally.
- No Supabase / Redis / KV writes on the turn path.

**A1 commit() contract (Paul's constraint 11 verbatim):**
> A1 `commit()` performs no storage writes, no cache writes, no graph mutation, no session mutation. It populates only `OlumiResponse` fields defined by the locked Zod schema.

Confirmed by Pre-impl A: `OlumiResponseSchema` has **no** `updated_session_state` field, so A1 omits it entirely. No inference from V4.

### 7. V4 baseline bundle selection

Selected: **`d8d0cab0-52ff-4f96-91ba-44e9e1ec031e`** (2026-04-16, "Run a pre-mortem on the leading option").

Why d8d0cab0:
- `blocks: []`, no graph mutation, no patch operations
- `turn_plan.routing: "llm"`, `executed_tools: []`, `selected_tool: null` — pure narrate
- `assistant_text` is 1473-char conversational prose
- No PLoT/ISL calls this turn
- All envelope fields populated (gives the V4 regression test a rich target)

Commit at `tests/fixtures/v4-baseline/direct-answer-v4-baseline.json` with a `_meta` block recording request_id, scenario_id, selection rationale.

Other bundles rejected as primary:
- **a0280603** — first-turn `generate_model`, full-draft graph patch (tool-heavy)
- **9325a506** — `add_option` tool call
- **4ac0caae** — `set_factor_value` tool call
- **2394efe6** — failed `edit_graph`; useful as *secondary* reference for V4 `failure_code` envelope pattern
- **7a3fa9d4** — `edit_graph` with `executed_tools` populated (closer but not clean)
- **b2968343** — CEE stream disconnect, `status: 0` (failure bundle, timeout reference only)

Budget calibration from observed CEE latencies (7–22 s range). Per Paul's constraint 5: env defaults from Implementation Plan v2.2 — `TURN_BUDGET_MS=180000`, `LLM_BUDGET_NARRATE_MS=60000`. Observed latencies inform *test fixture bounds*, not production defaults.

---

## Pre-impl A — OlumiResponseSchema field-by-field contract

**Source:** `/Users/paulslee/Documents/GitHub/olumi-schemas/src/boundary/olumi-response.ts` (v0.3.0). `.strict()` — unknown fields rejected.

### OlumiResponseSchema (6 required fields, no optionals)

| Field | Type | A1 direct_answer success | A1 failure envelope |
|---|---|---|---|
| `response_version` | `z.literal(2)` | `2` | `2` |
| `assistant_text` | `z.string()` | sanitised narrate LLM output | `FAILURE_USER_TEXT[error_code]` |
| `blocks` | `z.array(BlockSchema)` | `[]` | `[{ type: 'error', error_code, severity: 'error', details? }]` |
| `suggested_actions` | `z.array(ActionSchema)` | `[]` | `[]` |
| `insights` | `z.array(InsightSchema)` | `[]` | `[]` |
| `stage_indicator` | `Stage` enum | resolved from TurnContext (see Stage mapping) | TurnContext stage, else `'frame'` |

**Fields NOT on the schema (Paul's constraint 6: omit):**
- `updated_session_state` — absent. A1 does not emit session state on `OlumiResponse`.
- `lineage` / `context_hash` — absent.
- `turn_plan` / `guidance_items` — absent (V4 envelope only).

### Supporting schemas (from `/boundary/`)

- `BlockSchema` = `z.discriminatedUnion('type', [TextBlockSchema, ErrorBlockSchema])`.
  - `TextBlockSchema`: `{ type: 'text', content: string }` (`.strict()`)
  - `ErrorBlockSchema`: `{ type: 'error', error_code: BoundaryErrorCode, severity: Severity, details?: passthrough object }` (`.strict()`)
- `ActionSchema`: `{ id: string (min 1), label: string (min 1), message: string (min 1) }` (`.strict()`) — NOT the V4 `suggested_action` shape.
- `InsightSchema`: `{ id: string (min 1), text: string (min 1) }` (`.strict()`)
- `Stage`: `z.enum(['frame', 'analyse', 'decide', 'review'])` — only 4 values. V4 stages `evaluate`/`ideate` are NOT accepted here.
- `Severity`: `z.enum(['info', 'warn', 'error'])`
- `BoundaryErrorCode` = `FailureType`: 8 values — `INGRESS_CONTRACT_VIOLATION`, `EGRESS_CONTRACT_VIOLATION`, `FEATURE_NOT_ENABLED`, `TURN_BUDGET_EXCEEDED`, `UPSTREAM_TIMEOUT`, `UPSTREAM_UNAVAILABLE`, `LLM_UNAVAILABLE`, `INTERNAL_ERROR`.
- `FAILURE_USER_TEXT`: lookup table from `BoundaryErrorCode` → user-visible string.

### A1 FailureType → BoundaryErrorCode mapping

| Internal A1 failure class | `error_code` emitted |
|---|---|
| `LLM_TIMEOUT` | `UPSTREAM_TIMEOUT` |
| `BUDGET_EXCEEDED` | `TURN_BUDGET_EXCEEDED` |
| `LLM_CONTAMINATION_NARRATE` | *(not a failure)* sanitiser strips → telemetry, response is success |
| `STATE_COMMIT_FAILED` | `INTERNAL_ERROR` |
| `UNHANDLED` | `INTERNAL_ERROR` |

### Stage resolution (Stage enum is 4-value)

V4 bundles show stages `evaluate` / `ideate` — not in A1's Stage enum. `build-turn-context.ts` resolves:
- If TurnContext carries an explicit Stage-valid value → use it
- Default for A1 direct_answer: `'frame'`
- Future: graph-state-aware mapping lands in later slices

### Contract version bump

`@talchain/schemas` bump `0.3.0 → 0.4.0` populates `/orchestrator` with A1 TurnContext, LLMAdapterRequest, LLMAdapterResponse, HandlerFact stub. **No changes to `/boundary`** — OlumiResponseSchema is final as v0.3.0 defined it.

---

## Pre-impl B — useConversation V5 branch minimum side-effect allow-list

**File:** `/Users/paulslee/Documents/GitHub/DecisionGuideAI/src/canvas/conversation/useConversation.ts`, `sendTurn` function (line 2316).

V4 runs 10 side effects between `sendTurn` entry (line 2364) and the network call (line 2574). Per-effect analysis:

| # | Side effect | V5 branch | Rationale |
|---|---|---|---|
| 1 | `inFlightRef.current = true` (L2364) | **Run** | Prevents double-click; checked at L2360 before any further work. Both V4 and V5 need the guard. |
| 2 | `beginInteractionChain({...})` (L2372-2381) | **Run** | Creates debug chain ID; `bindRequestToInteraction` later references it. V5 needs trace correlation for observability. |
| 3 | `recordUserAction(...)` (L2391-2401) | **Skip** | Analytics only. Not load-bearing. Can be deferred or V5-scoped. |
| 4 | `setLastFailedInput(null)` (L2403) | **Skip** | Retry recovery state. V5 catch block re-sets on failure. |
| 5 | `addMessage({ user bubble })` (L2406-2414) | **Run** | Renders the user's message in the conversation. Without it, user sees assistant reply but no user question. UI-correctness required. |
| 6 | `setIsThinking(true)` (L2435) | **Run** | Sets `isThinkingRef.current` (checked at L2384, L2428) and drives "Thinking…" indicator. Without it, UI appears idle during a V5 call. |
| 7 | `setIsGenerating(true)` (L2436) | **Skip** | Draft-panel loading. V5 direct-answer does not drive draft panel. |
| 8 | AbortController + timeout setup (L2439-2459) | **Skip** | V4 streaming infrastructure. V5 is fire-and-forget POST with server-side budget. |
| 9 | `recordRequestContext({...})` (L2527) | **Skip** | Debug telemetry only. Populates in-memory map read by dev tools; not checked by conditional logic. |
| 10 | `bindRequestToInteraction(...)` (L2515-2526) | **Run** | Links request ID to trace chain. Pairs with #2; without it the request is orphaned from the debug trace. |

### V5 branch allow-list (5 side effects before the network call)

```
1. inFlightRef.current = true
2. beginInteractionChain({...})
3. addMessage({ user bubble })
4. setIsThinking(true)
5. bindRequestToInteraction(requestId, ...)
```

**V5 branch cleanup (always runs on V5 path return):**
- `setIsThinking(false)`
- `inFlightRef.current = false`

### Branch shape

```typescript
const sendTurn = useCallback(async (input) => {
  if (import.meta.env.VITE_ENABLE_V5_ORCHESTRATOR === 'true') {
    // 5 V5-required side effects (mirror V4 where needed for UI correctness)
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const chainId = beginInteractionChain({ source: 'v5', ... });
    if (!input.skipUserBubble) addMessage({ role: 'user', content: input.text, ... });
    setIsThinking(true);
    const requestId = crypto.randomUUID();
    bindRequestToInteraction(chainId, requestId);

    try {
      const v5Result = await callV5Turn({ text: input.text, requestId, ... });
      if (v5Result.kind !== 'fall_through_v4') {
        const target = routeV5Response(v5Result);
        // Render via TypedErrorRenderer or block renderer (A0 wiring)
        // addMessage for the assistant bubble happens inside the renderer or here
        return;
      }
    } finally {
      setIsThinking(false);
      inFlightRef.current = false;
    }
  }
  // V4 path unchanged below this line
  inFlightRef.current = true;
  // ... 9 V4 side effects + network call
}, [...])
```

The V5 branch's `addMessage` for the **assistant** bubble happens after `routeV5Response` returns a renderable result. For A1 direct_answer success, the `assistant_text` field populates the bubble. For error envelopes, `TypedErrorRenderer` handles presentation and may append via `addMessage` or render in-place (A0's wiring).

---

## Decisions locked with Paul (Stage 1 review + 11 clarifications)

1. **direct_answer exclusively.** `dispatch.ts` rejects every other turn class (`clarification`, `interpretive_tool`, etc.) with an internal invariant violation → `UNHANDLED` → P0 alert. Comments in `dispatch.ts` state this explicitly.
2. **Canonical field names from `@talchain/schemas/boundary`.** No renaming. A1 uses `suggested_actions`, not `chips`. Code, fixtures, tests, and docs all verbatim.
3. **OlumiResponseSchema documented upfront.** See Pre-impl A. Every required field has an A1 population decision. No optional fields exist. `updated_session_state` absent → omitted.
4. **useConversation minimum side effects.** See Pre-impl B. V5 branch runs 5 of 10 V4 effects with per-item rationale.
5. **Budgets from Implementation Plan v2.2.** `TURN_BUDGET_MS=180000`, `LLM_BUDGET_NARRATE_MS=60000`. Observed-latency values (7–22 s) inform test fixtures only.
6. **`updated_session_state` conditional on schema.** Absent in OlumiResponseSchema → A1 omits entirely. No V4 inference.
7. **Timeout precedence explicit.** `BUDGET_EXCEEDED` wins when both could apply. TurnExecutor wall-clock is the outer bound. Inline comment in `turn-executor.ts`; unit test `race-both` case covers it.
8. **V4 regression assertions structural, not count-exact.** `suggested_actions` / `guidance_items`: assert array shape + each element Zod-validates. Count-exact only for invariants: `blocks.length === 0`, `response_version === 2`, `turn_plan.executed_tools === []`, `turn_plan.selected_tool === null`.
9. **LLM mocked at adapter seam for all A1 fixtures.** `getAdapter(...).chat` stubbed in every A1 fixture / unit / integration test. No live provider calls in acceptance pack. Manual smoke via `curl` may hit real provider.
10. **Transport invariant grep as CI step.** `reply.raw.write` and `text/event-stream` grepped against `src/orchestrator-v5/` and `src/orchestrator/route-v2.ts` in CI pipeline. Non-zero hits fail the build.
11. **`commit()` wording tightened.** "A1 `commit()` performs no storage writes, no cache writes, no graph mutation, no session mutation. It populates only `OlumiResponse` fields defined by the locked Zod schema."

### Rejects (no change)

- Tarball SHA work stays in A1.
- Prompt-loader additive entry in `OPERATION_TO_TASK_ID` is correct; no V5-local wrapper.
- `/orchestrator` namespace scope (TurnContext, LLMAdapterRequest/Response, HandlerFact stub) is minimal and forward-compatible.

### V4 vs V5 contract separation

V4 uses `OrchestratorResponseEnvelopeV2` on `/orchestrate/v1/turn`. V5 uses `OlumiResponse` on `/orchestrate/v2/turn`. Distinct envelopes on distinct routes. Regression tests assert the right shape on the right route; no schema collision.

---

## Failure contract (explicit, per addendum §2.1.5)

| Class | Trigger | HTTP | Body |
|---|---|---|---|
| B1 contract failure | Ingress payload Zod fail or egress shape Zod fail | **422** | `BoundaryError` per Boundary Contract §6.4 |
| TurnExecutor runtime failure | Any `FailureType` from §2.1.5 | **200** | `OlumiResponse` with `ErrorBlock` |

Unreachable A1 paths (clarification, interpret, artefact modes) → internal invariant violation → `UNHANDLED` → `INTERNAL_ERROR` block + P0 telemetry. No user-facing `NOT_IMPLEMENTED`.

---

## File layout (Stage 2)

```
src/orchestrator-v5/
  turn-executor.ts          # single class, §2.1.2 shape, §2.1.3 ordering
  build-turn-context.ts     # minimal V5 TurnContext assembler
  dispatch.ts               # turn-class router: direct_answer only; others → UNHANDLED
  llm-adapter.ts            # narrate-mode wrapper over getAdapter(...).chat
  sanitise.ts               # XML/banned-terms/em-dash stripper per §2.1.4
  compose.ts                # non-action-turn response assembler (OlumiResponse)
  commit.ts                 # no-op per constraint 11 (emits no side effects)
  failure-response.ts       # FailureType → OlumiResponse with ErrorBlock
  __tests__/*.test.ts       # unit coverage per stage, behavioural invariants
src/validators/b5.ts        # B5 narrate-mode LLM I/O validation (shape only)
tests/integration/
  orchestrate-v2-a1.test.ts      # 4 A1 fixtures replayed green, LLM mocked
  server-boot.test.ts            # flag on → route registered, flag off → 404
tests/regression/
  v4-baseline.test.ts            # d8d0cab0 structural regression
tests/fixtures/contracts/b1/slice-a1/
  direct-answer-happy.json
  direct-answer-llm-timeout.json
  direct-answer-budget-exceeded.json
  direct-answer-contamination.json
tests/fixtures/v4-baseline/
  direct-answer-v4-baseline.json # from bundle d8d0cab0
scripts/validate-tarball-sha.sh  # invoked by pre-push hook + CI
vendor/talchain-schemas-0.4.0.tgz
vendor/talchain-schemas-0.4.0.tgz.sha256
```

## Critical files modified

CEE (this worktree):
- `src/orchestrator/route-v2.ts` — replace feature-unavailable stub with `TurnExecutor.run(payload)`
- `src/adapters/llm/prompt-loader.ts` — add `direct_answer: 'direct_answer_narrate'` to `OPERATION_TO_TASK_ID`
- `src/prompts/defaults.ts` — register default fragment (Paul authors content; A1 lands placeholder)
- `src/utils/telemetry.ts` — add `TurnExecutorStarted`, `TurnExecutorCompleted` keys
- `package.json` — bump `@talchain/schemas` to local v0.4.0 tarball
- `scripts/validate-prepush.sh` — call `scripts/validate-tarball-sha.sh`
- All new files under `src/orchestrator-v5/`, `src/validators/b5.ts`, `tests/`

Schemas (`~/Documents/GitHub/olumi-schemas/`):
- `src/orchestrator/index.ts` — populate with `TurnContextSchema`, `LLMAdapterRequestSchema`, `LLMAdapterResponseSchema`, `HandlerFactSchema` stub (`z.never()` placeholder)
- `package.json` — 0.3.0 → 0.4.0
- `tests/orchestrator/` — schema parse coverage

UI (`~/Documents/GitHub/DecisionGuideAI/`):
- `src/canvas/conversation/useConversation.ts` — single V5 branch at top of `sendTurn`, minimum allow-list per Pre-impl B
- `src/v5/__tests__/end-to-end.test.tsx` — flag-on integration
- `package.json` — bump vendored tarball
- `vendor/talchain-schemas-0.4.0.tgz` + `.sha256`

## Existing utilities reused

- `src/adapters/llm/router.ts::getAdapter` — LLM dispatch
- `src/adapters/llm/prompt-loader.ts::getSystemPrompt` — prompt fetch
- `src/utils/retry.ts::withRetry` — already composed into `getAdapter`
- `src/utils/telemetry.ts::emit` — telemetry emission
- `src/utils/request-id.ts` — request-id generation (used by A0 route-v2)
- `src/config/timeouts.ts` — timeout values
- `src/validators/b1.ts` — B1 patterns inform B5 validator shape

## Verification plan (Stage 2 exit gate)

Run from CEE worktree root unless noted:

- `cd ~/Documents/GitHub/olumi-schemas && npm test` — all schema tests green, 0.4.0 pack succeeds
- `pnpm exec tsc -p tsconfig.build.json --noEmit` — source compiles
- `pnpm test tests/integration/orchestrate-v2-a1.test.ts` — 4 A1 fixtures green
- `pnpm test tests/integration/server-boot.test.ts` — flag on → route registered, flag off → 404
- `pnpm test tests/regression/v4-baseline.test.ts` — d8d0cab0 structural regression
- `pnpm test src/orchestrator-v5/__tests__/` — unit suite green, BI-01/BI-02 proven
- `bash scripts/validate-tarball-sha.sh` — passes on clean tree; drift simulation test asserts rejection
- UI: `cd ~/Documents/GitHub/DecisionGuideAI && pnpm test src/v5/__tests__/end-to-end.test.tsx` — flag-on turn renders through `useConversation → callV5Turn → routeV5Response → TypedErrorRenderer`
- A0 regression: `pnpm test tests/integration/orchestrate-v2.test.ts tests/integration/orchestrate-v1-regression.test.ts` — 9/9 still green
- Transport invariant grep step (CI): zero `reply.raw.write` / `text/event-stream` hits
- Missing-owner detector: fixture suite asserts every `turn_executor.started` has a matching `turn_executor.completed`

## Rollback triggers

- Any blank turn, double response, or null envelope in a fixture run
- V4 regression fixture fails the structural assertions (Paul's constraint 8)
- `useConversation.ts` V5 branch breaks V4 path with flag off
- Any TurnExecutor stage cannot be unit-tested in isolation
- Tarball SHA drift simulation test fails to reject
- **Any `turn_executor.started` event without matching `turn_executor.completed`**
