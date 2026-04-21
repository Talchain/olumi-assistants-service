# V5 turn-shape matrix — Task 0 investigation

**Brief:** v5-cee-exclusive-path (claude/v5-exclusive-cee)
**Status:** Task 0 complete + Task 1 shipped. Tasks 2–5 HALTED pending Paul-decisions on brief §6 schema constraint.
**Date:** 2026-04-21.

## Executive summary

The brief's premise — *"setting `CEE_PIPELINE_V4_ENABLED=false` makes V5 the exclusive orchestration path"* — is not how the V4 flag actually behaves. It also assumes V5 today has handlers for `draft_graph`, `edit_graph`, and system events. It does not. Making V5 the exclusive CEE path requires schema and handler work that is out of scope for this brief (and explicitly excluded by §6).

Three specific discoveries below. Paul owns the path forward; this doc is a halt-and-report per the brief's own escape hatch.

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

And the runtime registry ([tools/registry.ts:173](../../src/orchestrator-v5/tools/registry.ts#L173)) today has **exactly one** entry: `run_analysis`. The other six `V5ActionType` members are declared but have no handlers — dispatch lookups miss, `UnhandledTurnClassError('handler_not_registered')` is raised, the turn-executor UNHANDLED catch maps to `INTERNAL_ERROR` on the wire.

### 3c. V5 has no system-event layer

V4 handles system events (patch_accepted, patch_dismissed, direct_graph_edit, chip_click, undo, redo) via a deterministic layer — no LLM, no tool call, fast and boring. See [pipeline-stream.ts:151-160](../../src/orchestrator/pipeline/pipeline-stream.ts#L151-L160) — the system-event path branches off before any routing decision.

V5's TurnExecutor has no equivalent branch. Every V5 turn goes through the seven-step assembly: ContextPack → LLM-backed routing → validate → execute → confirm → coach → compose → commit. A system event with no message text wouldn't even get past ingress; a system event with a message would spend an LLM call routing to an action the system event doesn't need.

## 4. Turn-shape matrix — current reality

Each row: what V5 does TODAY if UI posts to `/orchestrate/v2/turn`. Status column is current; "fix needed" = what making V5 exclusive would require.

| # | Turn type | UI sends | V5 today | Status | Fix needed for V5-exclusive |
|---|---|---|---|---|---|
| 1 | Free-text conversation | message text, stage, session_state | Routes through TurnExecutor; Sonnet responds via `routeWithToolUse` (text-only branch) | WORKING | None — happy path |
| 2 | Draft_graph (brief submission) | message text, stage=frame | Routes to TurnExecutor; Sonnet may emit tool_use `draft_graph`, but `draft_graph` is NOT in `V5ActionType` schema so parser rejects → 500 INTERNAL_ERROR (schema_repair_failed) | NEEDS_FIX | Add `draft_graph` to @talchain/schemas `ActionType`; implement V5 handler that delegates to unified pipeline; register in V5 registry. Schema change violates brief §6. |
| 3 | run_analysis | message text or chip_click payload | chip_click payload rejected at ingress (no chip_metadata field). Message-text form: routes to TurnExecutor, handler executes, decision_review enrichment + coaching signal fire (Group 1 proof) | WORKING (message-text form only) | None for message-text. Chip_click form needs ingress widening + chip-payload extraction. |
| 4 | System event: patch_accepted | event payload, no message text | 422 INGRESS_CONTRACT_VIOLATION (message is required, system_event is unknown field) | NEEDS_FIX | Ingress schema change + new V5 deterministic event layer + event handlers. Schema change violates brief §6. |
| 5 | System event: patch_dismissed | event payload | Same as #4 | NEEDS_FIX | Same as #4 |
| 6 | System event: direct_graph_edit | event payload with graph changes | Same as #4 | NEEDS_FIX | Same as #4 |
| 7 | System event: chip_click | chip action payload | Same as #4 | NEEDS_FIX | Same as #4 |
| 8 | System event: undo/redo | event payload | Same as #4 | NEEDS_FIX | Same as #4 |
| 9 | Turn with analysis_state | conversation turn + analysis envelope | Phase 1.5 extension honored; TurnExecutor receives it, ContextPack includes compact summary | WORKING | None |
| 10 | Turn with graph state | conversation turn + graph | Phase 1.5 extension honored; TurnExecutor receives, ContextPack includes graph | WORKING | None |
| 11 | Turn with session_state | conversation turn + session round-trip | `session_state` is NOT an accepted field. Ingress 422 if sent | NEEDS_FIX (clarification) | Depends on what `session_state` means in the UI — V5 already reads prior turns from the session store via `readRecent`. If the UI sends a round-trip envelope, ingress needs to accept and ignore it. |
| 12 | Edit_graph (natural language) | message text requesting graph change | Routes to TurnExecutor; Sonnet may emit `edit_graph` tool_use, but `edit_graph` is NOT in `V5ActionType`. Same failure mode as #2 | NEEDS_FIX | Schema + handler + registry work, same pattern as #2. |
| 13 | set_factor_value (via tool call) | message text with value change request | `set_factor_value` IS in `V5ActionType`, but the registry has no handler. Dispatch miss → `UnhandledTurnClassError('handler_not_registered')` → 500 INTERNAL_ERROR | NEEDS_FIX | Implement handler + register. No schema change required. |
| 14 | `add_constraint`, `adjust_edge_strength`, `explain_result`, `compare_options`, `what_would_flip` | tool-use payload | Same as #13 — action type declared, no handler | NEEDS_FIX | Same as #13 |

## 5. Recommendation (halt point)

**Do not proceed with the brief's Tasks 1–5 today.** The brief's goal (V5 exclusive CEE path) is premature because V5's handler surface covers only ~15% of the turn types V4 currently serves on staging. Setting `CEE_PIPELINE_V4_ENABLED=false` without either narrowing the UI's turn-shape vocabulary OR expanding V5 to cover the matrix would surface as 422 / 500 errors on almost every non-trivial turn type.

Paul-owned decisions before this brief can proceed:

1. **Is the brief's *sequence* still right?** The brief says "this brief lands FIRST, then UI removes V4 fallback." Recommend inverting it: UI brief first (chooses a V5-compatible subset of turn types — free-text + analysis_state + graph_state + run_analysis via chip), then CEE can make V5 exclusive for that subset.

2. **Schema amendment: is @talchain/schemas actually out-of-scope?** Brief §6 says "no @talchain/schemas changes." But widening `V5ActionType` to include `draft_graph` and `edit_graph` (and widening `OrchestratorTurnPayload` to include `system_event` and `chip_metadata`) is the only way V5 can cover those turn types. If the schema is pinned hard, the brief is a multi-month effort; if the schema can be widened, it's weeks of handler implementation work.

3. **Alternative framing: "V4 disabled, V5 exclusive for the subset it supports."** Add a V1-route guard that returns `410 { error: "V4_DISABLED", ... }` when the V4 flag is off (brief §3 Task 1). Then V5 serves free-text + analysis turns via the V2 route. V1 callers needing draft_graph/system events get a loud typed failure until the UI is updated or V5 is widened. This is a minimal, in-scope step that *does* achieve one piece of the brief's intent without touching the schema or V5 handler surface.

## 6. What I did (and didn't) on this branch

- **Did:** investigated Task 0 end-to-end, produced this document, and implemented the Task 1 V4_DISABLED guard on BOTH V1 route entry points (streaming + non-streaming) — the minimal safe piece of the brief that does not depend on schema changes or handler-surface expansion. Added dedicated tests.
- **Did not:** implement Tasks 2–5 (system-event routing, draft_graph/edit_graph through V5, ingress widening). All of those depend on the Paul-decisions in §5 — specifically, whether `@talchain/schemas` can be widened to include new action types (brief §6 currently forbids it).

### Rollback

Task 1 is fully rolled back by setting `CEE_PIPELINE_V4_ENABLED=true` on Render staging and redeploying. The guard is a single pre-validation `if` branch; flipping the flag restores the prior V4-dispatch behaviour with zero data-migration and zero state-change cost. No additional code revert or database migration is required.

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
