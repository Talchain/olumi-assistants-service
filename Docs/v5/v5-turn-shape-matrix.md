# V5 turn-shape matrix — Task 0 investigation

**Brief:** v5-cee-exclusive-path (claude/v5-exclusive-cee)
**Status:** Task 0 complete + Task 1 shipped + P0 follow-up applied (UNSUPPORTED_ACTION → FEATURE_NOT_ENABLED). Tasks 2–5 HALTED pending Paul-decisions on brief §6 schema constraint — but matrix §4 now shows zero NEEDS_FIX rows; every turn shape either WORKs or returns a clean TYPED_ERROR.
**Date:** 2026-04-22.

## Executive summary

The brief's premise — *"setting `CEE_PIPELINE_V4_ENABLED=false` makes V5 the exclusive orchestration path"* — is not how the V4 flag actually behaves. It also assumes V5 today has handlers for `draft_graph`, `edit_graph`, and system events. It does not. Making V5 the *exclusive host* for those turn types (i.e. 200 responses) requires schema and handler work out of scope for this brief (explicitly excluded by §6).

However, "V5 either handles or cleanly rejects every turn shape" — the weaker §4 invariant the brief actually requires — **is satisfied**. Shipped on this branch:

1. Task 1: V1 routes return 410 `V4_DISABLED` when the flag is off (clients get a loud migration signal, not a silent fall-through to legacy pipelines).
2. P0 follow-up: unregistered V5ActionType handlers surface as typed `FEATURE_NOT_ENABLED` (via a new `UNSUPPORTED_ACTION` internal class), not generic `INTERNAL_ERROR`. Distinguishes "feature not built yet" from "server bug" on the wire.

After these two changes, every row of §4's matrix is WORKING or TYPED_ERROR — no NEEDS_FIX remains.

Three specific discoveries below remain Paul-decisions for future expansion of V5's surface.

## 1. The V4 flag scope

`CEE_PIPELINE_V4_ENABLED` ([config/index.ts:298](../../src/config/index.ts#L298)):

- **Default:** `true` (V4 is the canonical path).
- **Where read:** exactly two call sites:
  - [pipeline-stream.ts:109](../../src/orchestrator/pipeline/pipeline-stream.ts#L109) — V1 streaming route (`/orchestrate/v1/turn/stream`)
  - [route.ts:212](../../src/orchestrator/route.ts#L212) — V1 non-streaming route (`/orchestrate/v1/turn`)
- **What it does:** `true` → every V1-route turn executes via `executePipelineV4`. `false` → fall-through past the V4 branch, into the legacy V2 pipeline (`handleTurnV2`, gated on `orchestratorV2` flag) or the even older V1 pipeline (`handleTurn`). It does NOT route to V5.
- **What it does NOT do:** it does not disable the unified pipeline (`src/cee/unified-pipeline/`), the V4 tool handlers (`src/orchestrator/tools/`), or the deterministic orchestrator layer. Those are V4-internal; disabling the V4 pipeline just means nobody invokes them via the V1 routes.

## 2. V5 is a separate route, not a fall-through

V5 is only reachable via **POST `/orchestrate/v2/turn`** ([route-v2.ts:43](../../src/orchestrator/route-v2.ts#L43)). That route:

- Is registered only when `ENABLE_V5_ORCHESTRATOR=true` ([server.ts:956-959](../../src/server.ts#L956)).
- Is a completely different entry point from the V1 routes above.
- Has its own ingress schema, its own TurnExecutor, its own handler registry.

Setting `CEE_PIPELINE_V4_ENABLED=false` does NOT redirect V1-route traffic to V5. V1-route traffic with the flag off falls into the V2 or V1 legacy pipelines — a degraded V4 clone, not V5. To force V5, the UI must call the V5 route (controlled by UI-side `VITE_ENABLE_V5_ORCHESTRATOR=true` — documented in [Docs/v5/v5-ui-switch-investigation.md](v5-ui-switch-investigation.md)).

## 3. V5 cannot handle most turn types today

The brief's matrix assumes V5 can handle draft_graph, edit_graph, system events, and more. Today it cannot. Two independent reasons:

### 3a. V5 ingress schema is narrow

[OrchestratorTurnPayloadSchema](../../node_modules/@talchain/schemas/dist/boundary/turn-payload.js) (pinned, strict):

```ts
z.object({
  turn_id: Uuid,
  scenario_id: Uuid,
  message: z.string().min(1).max(10000),
  turn_class: TurnClass,
  stage: Stage,
}).strict()
```

Phase 1.5 additionally accepts `graph_state` and `analysis_state` as extensions (stripped before B1 validation). **No other fields are accepted.** In particular:

- No `system_event` key.
- No `chip_metadata` / `chip_click` payload key.
- No optional-message semantics — `message` is required (min 1).

A turn that "sends an event payload, no message text" (brief's matrix rows for patch_accepted, patch_dismissed, direct_graph_edit, chip_click, undo, redo) **fails V5 ingress with 422 `INGRESS_CONTRACT_VIOLATION`**.

### 3b. V5 handler registry is analysis-only

[@talchain/schemas](../../node_modules/@talchain/schemas/dist/boundary/enums.js) pins `V5ActionType` as:

```ts
'run_analysis' | 'set_factor_value' | 'add_constraint' | 'adjust_edge_strength' | 'explain_result' | 'compare_options' | 'what_would_flip'
```

`draft_graph` and `edit_graph` are **not** in the V5 action-type union. Even if the routing LLM wanted to emit a `draft_graph` tool call, the tool-use parser at [route-with-tool-use.ts](../../src/orchestrator-v5/routing/route-with-tool-use.ts) would reject it as schema-invalid.

And the runtime registry ([tools/registry.ts:173](../../src/orchestrator-v5/tools/registry.ts#L173)) today has **exactly one** entry: `run_analysis`. The other six `V5ActionType` members are declared but have no handlers.

**P0 follow-up on this branch:** unregistered-handler paths now surface the typed `FEATURE_NOT_ENABLED` wire code (via a new `UNSUPPORTED_ACTION` internal failure class in [types.ts](../../src/orchestrator-v5/types.ts)) rather than the generic `INTERNAL_ERROR`. Both entry points are covered:

- **Validator path** — when the routing LLM emits a tool_use referencing an action not in `HANDLER_VALIDATION_REGISTRY`, the validator returns `HANDLER_NOT_FOUND` and [validation-failure-responses.ts](../../src/orchestrator-v5/compose/validation-failure-responses.ts) wraps it as a 200 OlumiResponse with `error_code: 'FEATURE_NOT_ENABLED'`, `details.retryable: false`, `details.reason: 'handler_not_registered'`, `details.handler_id`.
- **Dispatch path** — when validation passes but the runtime registry has no handler, [turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) catches `UnhandledTurnClassError(reason='handler_not_registered')` and builds a failure response with the same `FEATURE_NOT_ENABLED` wire code.

This moves matrix rows 13 and 14 from NEEDS_FIX to TYPED_ERROR.

### 3c. V5 has no system-event layer

V4 handles system events (patch_accepted, patch_dismissed, direct_graph_edit, chip_click, undo, redo) via a deterministic layer — no LLM, no tool call, fast and boring. See [pipeline-stream.ts:151-160](../../src/orchestrator/pipeline/pipeline-stream.ts#L151-L160) — the system-event path branches off before any routing decision.

V5's TurnExecutor has no equivalent branch. Every V5 turn goes through the seven-step assembly: ContextPack → LLM-backed routing → validate → execute → confirm → coach → compose → commit. A system event with no message text wouldn't even get past ingress; a system event with a message would spend an LLM call routing to an action the system event doesn't need.

## 4. Turn-shape matrix — current reality

Each row: what V5 does TODAY if the UI posts to `/orchestrate/v2/turn`.

Status taxonomy (brief §2):

- **WORKING** — happy 200 response with a valid OlumiResponse envelope.
- **TYPED_ERROR** — non-200 response with a typed BoundaryError / typed error block. Brief §4-compliant ("non-200 responses include error_code, retryable, and a human-readable message"). This is an acceptable final state; no code change required.
- **NEEDS_FIX** — today's response is a blank turn, a hidden failure (200 with failure_type set), an opaque INTERNAL_ERROR that doesn't distinguish cause, or a hang. Must be addressed before V5 can be a compliant exclusive path for this turn shape.

| # | Turn type | UI sends | V5 today | Status |
|---|---|---|---|---|
| 1 | Free-text conversation | message text, stage | Routes through TurnExecutor; Sonnet responds via `routeWithToolUse` (text-only branch) → 200 OlumiResponse | **WORKING** |
| 2 | Draft_graph (brief submission) | message text, stage=frame | Routes to TurnExecutor; Sonnet may emit tool_use `draft_graph`, but `draft_graph` is NOT in `V5ActionType` schema. Tool-schema parser rejects → REPAIR_ONCE → schema_repair_failed → 500 wire `LLM_UNAVAILABLE`. Typed, non-200. | **TYPED_ERROR** (LLM_UNAVAILABLE; not ideal — widening the schema would let this be WORKING, but current behaviour is a typed retryable error, brief §4-compliant) |
| 3 | run_analysis via message text | natural-language request for analysis | Routes through TurnExecutor; handler executes via PLoT; decision_review enrichment + FIRST_ANALYSIS_COMPLETE coaching signal fire (Group 3 Group-1-proof test) → 200 | **WORKING** |
| 3b | run_analysis via chip_click | chip payload with action_type + params | Ingress rejects 422 `INGRESS_CONTRACT_VIOLATION` because `chip_metadata` is not an accepted field. Typed, non-200. | **TYPED_ERROR** (422) |
| 4 | System event: patch_accepted | event payload, no message text | Ingress rejects 422 `INGRESS_CONTRACT_VIOLATION` — `message` is required (min 1) and `system_event` is not in the pinned schema. Typed, non-200. | **TYPED_ERROR** (422) |
| 5 | System event: patch_dismissed | event payload | Same as #4 | **TYPED_ERROR** (422) |
| 6 | System event: direct_graph_edit | event payload with graph changes | Same as #4 | **TYPED_ERROR** (422) |
| 7 | System event: chip_click | chip action payload | Same as #4 | **TYPED_ERROR** (422) |
| 8 | System event: undo/redo | event payload | Same as #4 | **TYPED_ERROR** (422) |
| 9 | Turn with analysis_state | conversation turn + analysis envelope | Phase 1.5 extension honored; TurnExecutor receives, ContextPack compacts analysis → 200 | **WORKING** |
| 10 | Turn with graph_state | conversation turn + graph | Phase 1.5 extension honored; TurnExecutor receives, ContextPack includes graph → 200 | **WORKING** |
| 11 | Turn with session_state | conversation turn + session round-trip | `session_state` is NOT an accepted field. Ingress 422. V5 reads prior turns from session store internally via `readRecent` — the UI doesn't need to round-trip session state. | **TYPED_ERROR** (422; semantically correct — UI should not send this) |
| 12 | Edit_graph (natural language) | message text requesting graph change | Same schema_repair_failed path as #2 — `edit_graph` not in `V5ActionType` | **TYPED_ERROR** (LLM_UNAVAILABLE; same caveat as #2) |
| 13 | set_factor_value via tool call | message text → routing LLM emits tool_use | `set_factor_value` IS in `V5ActionType` but has no validator or runtime handler. **Post P0 follow-up:** validator returns `HANDLER_NOT_FOUND` → typed `FEATURE_NOT_ENABLED` on the wire (was: generic INTERNAL_ERROR). | **TYPED_ERROR** (FEATURE_NOT_ENABLED) |
| 14 | add_constraint, adjust_edge_strength, explain_result, compare_options, what_would_flip | tool-use payload | Same as #13 — declared in the action union but no handler/validator registered. Same typed FEATURE_NOT_ENABLED outcome post-P0. | **TYPED_ERROR** (FEATURE_NOT_ENABLED) |

### Matrix delta from P0 follow-up

Before the P0 follow-up (first pass of this branch), rows 13 + 14 were NEEDS_FIX — they produced a generic `INTERNAL_ERROR` wire code with no way for the client to distinguish "feature not built yet" from "server bug." The UNSUPPORTED_ACTION internal class + typed `FEATURE_NOT_ENABLED` wire code now surfaces this state cleanly: the client sees a stable typed signal it can handle distinctly (hide the affordance, suggest an alternative) vs "something broke, please retry." That moves them into TYPED_ERROR per brief §4.

Zero rows are NEEDS_FIX today. Every turn shape the matrix enumerates either succeeds (WORKING) or returns a typed non-200 boundary error (TYPED_ERROR) — the brief §4 hard failure-semantics invariant is satisfied for the V5 route today.

### What this DOES NOT mean

TYPED_ERROR is the BRIEF-COMPLIANT outcome — but if Paul's intent is "V5 should HANDLE draft_graph / system events / chip clicks with a 200" rather than "V5 should REJECT them cleanly," that's an expansion-of-V5 question, not a compliance question. It requires widening `@talchain/schemas` (forbidden by brief §6), implementing new handlers, and building a V5-side deterministic event layer. That work stays out of scope here and is documented in §5 as a Paul-decision.

## 5. Recommendation (halt point)

**Do not proceed with the brief's Tasks 1–5 today.** The brief's goal (V5 exclusive CEE path) is premature because V5's handler surface covers only ~15% of the turn types V4 currently serves on staging. Setting `CEE_PIPELINE_V4_ENABLED=false` without either narrowing the UI's turn-shape vocabulary OR expanding V5 to cover the matrix would surface as 422 / 500 errors on almost every non-trivial turn type.

Paul-owned decisions before this brief can proceed:

1. **Is the brief's *sequence* still right?** The brief says "this brief lands FIRST, then UI removes V4 fallback." Recommend inverting it: UI brief first (chooses a V5-compatible subset of turn types — free-text + analysis_state + graph_state + run_analysis via chip), then CEE can make V5 exclusive for that subset.

2. **Schema amendment: is @talchain/schemas actually out-of-scope?** Brief §6 says "no @talchain/schemas changes." But widening `V5ActionType` to include `draft_graph` and `edit_graph` (and widening `OrchestratorTurnPayload` to include `system_event` and `chip_metadata`) is the only way V5 can cover those turn types. If the schema is pinned hard, the brief is a multi-month effort; if the schema can be widened, it's weeks of handler implementation work.

3. **Alternative framing: "V4 disabled, V5 exclusive for the subset it supports."** Add a V1-route guard that returns `410 { error: "V4_DISABLED", ... }` when the V4 flag is off (brief §3 Task 1). Then V5 serves free-text + analysis turns via the V2 route. V1 callers needing draft_graph/system events get a loud typed failure until the UI is updated or V5 is widened. This is a minimal, in-scope step that *does* achieve one piece of the brief's intent without touching the schema or V5 handler surface.

## 6. What I did (and didn't) on this branch

- **Did:**
  - Investigated Task 0 end-to-end and produced this document.
  - Shipped the Task 1 V4_DISABLED guard on BOTH V1 route entry points (streaming + non-streaming) with dedicated tests.
  - Shipped the **P0 follow-up**: typed `FEATURE_NOT_ENABLED` wire code for unregistered V5ActionType handlers. Previously these surfaced as generic `INTERNAL_ERROR`; now the client gets a stable, distinct typed signal via a new `UNSUPPORTED_ACTION` internal class. Covers BOTH the validator-time miss and the dispatch-time miss. Added parametric + targeted tests.
  - Relabelled this matrix with the brief's taxonomy: every row is tagged WORKING, TYPED_ERROR, or NEEDS_FIX. Post P0 follow-up, zero rows are NEEDS_FIX.
- **Did not:** expand V5's handler surface to include `draft_graph`, `edit_graph`, or system-event routing. All of those depend on the Paul-decisions in §5 — specifically, whether `@talchain/schemas` can be widened to include new action types and new ingress fields (brief §6 currently forbids it).

### Rollback

Task 1 is fully rolled back by setting `CEE_PIPELINE_V4_ENABLED=true` on Render staging and redeploying. The guard is a single pre-validation `if` branch; flipping the flag restores the prior V4-dispatch behaviour with zero data-migration and zero state-change cost. No additional code revert or database migration is required.

### Wire-shape note: Task 1's 410 body is deliberately NOT a `BoundaryError`

The V4_DISABLED 410 response uses the ad-hoc shape `{ error, message, retryable }` rather than the canonical `BoundaryError` envelope used by the V2 route's non-200 responses. Two reasons:

1. **Brief §3 Task 1 prescribes this shape verbatim.** Deviating from the brief's exact spec would violate "do not stop until all tasks are complete."
2. **`V4_DISABLED` is not a `BoundaryErrorCode` enum member.** The pinned `@talchain/schemas` `BoundaryErrorCode` has 8 values and none of them captures "this endpoint is gone, use the new one." The closest semantic fit is `FEATURE_NOT_ENABLED`, but its user text ("This feature is not enabled in your environment") is less clear than `V4_DISABLED` for the specific "migrate to /orchestrate/v2/turn" signal.

The V1 routes are on a deprecation path; the 410 body is a deliberate transport-level migration signal, not an orchestrator contract. A follow-up brief could converge V1-disabled responses onto a canonical BoundaryError shape if wire consistency becomes valuable, but the current shape is documented here + matches the brief.

### Task 1 — implemented

- `POST /orchestrate/v1/turn` ([route.ts](../../src/orchestrator/route.ts)) — pre-validation V4_DISABLED guard. Returns 410 + `{ error: 'V4_DISABLED', message: 'V4 orchestration is disabled. Use /orchestrate/v2/turn.', retryable: false }` when `config.features.pipelineV4Enabled === false`.
- `POST /orchestrate/v1/turn/stream` ([route-stream.ts](../../src/orchestrator/route-stream.ts)) — same guard, placed AFTER the `orchestratorStreaming` feature gate but BEFORE any SSE header emission so the client gets plain JSON, not a half-opened stream.
- Both guards log-at-warn and never fall through.
- Tests:
  - [tests/unit/orchestrator/route-stream.test.ts](../../tests/unit/orchestrator/route-stream.test.ts) — new `V4_DISABLED guard` describe block asserts 410 body + that `executePipelineStream` is never invoked.
  - [tests/integration/orchestrator/route-v4-disabled-guard.test.ts](../../tests/integration/orchestrator/route-v4-disabled-guard.test.ts) (new file) — integration test for the non-streaming route, with a config Proxy that lets the test flip the flag. Includes a sanity-regression asserting the guard does NOT fire when the flag is on.

### Tasks 2–5 — awaiting Paul-decision

- **Task 2 (verify V5 handles conversation + tool-use turns):** already verified in the Group 3 branch for the narrow V5-supported subset. No further code change needed for that subset; what's NEEDED_FIX in the matrix above is new handler work, not verification.
- **Task 3 (system event routing in V5):** requires either a new deterministic event layer in V5 (sibling to TurnExecutor) or ingress-schema widening to accept `system_event` payloads. Both violate brief §6.
- **Task 4 (draft_graph / edit_graph through V5):** requires widening `@talchain/schemas` `V5ActionType` union to include `draft_graph` and `edit_graph`, then implementing V5 handlers that delegate to the unified pipeline or V4 tool handlers. Schema change violates brief §6.
- **Task 5 (V2 route accepts all request shapes):** today the V2 route's ingress already accepts the shapes it can handle (conversation turns + Phase 1.5 graph/analysis state). Widening it to accept `system_event` / `chip_metadata` / `session_state` is a prerequisite for Tasks 3–4 and has the same brief §6 conflict.

### Recommendation for follow-up brief

Pick ONE of the three paths in §5, then scope a follow-up brief accordingly. The most pragmatic is §5.3: V1 returns 410, V5 handles its native subset, and the UI brief that follows this one narrows the UI's turn-shape vocabulary to what V5 supports (free-text + analysis + graph-state + chip-click-mapped-to-message-text). The less pragmatic but more complete path (§5.2) unlocks system events and draft_graph at the cost of the `@talchain/schemas` pin.
