# V5 turn-shape matrix — Task 0 investigation

**Brief:** v5-cee-exclusive-path (claude/v5-exclusive-cee) + v5-handler-surface (claude/v5-handler-surface)
**Status:** wire-contract readiness (brief §4) and exclusive-path readiness (brief §1) now BOTH satisfied for the four-turn primary user journey (free-text conversation, brief submission, natural-language edit, run_analysis chip click) plus all six system events. See §4c for the updated readiness verdict.
**Date:** 2026-04-22, updated 2026-04-21 post v5-handler-surface.

## v5-handler-surface delta (2026-04-21)

The follow-up brief v5-handler-surface widened V5's handler surface by:
1. Consuming `@talchain/schemas` v0.7.0 (breaking wire change: payloads now carry a `kind: 'message' | 'system_event'` discriminator; legacy v0.6.0 flat payloads are rejected with 422 `INGRESS_CONTRACT_VIOLATION`).
2. Adding deterministic pre-TurnExecutor dispatch in `src/orchestrator/route-v2.ts` for four new paths:
   - System events (6 kinds) — intercepts `kind: 'system_event'` payloads before TurnExecutor, since SystemEventTurnPayload has no `message` field.
   - draft_graph — triggered by `kind: 'message'` + `stage: 'frame'` + no `graph_state` + message length ≥ `DRAFT_GRAPH_MIN_BRIEF_LENGTH` + positive decision-keyword regex.
   - edit_graph — triggered by `kind: 'message'` + `graph_state` present + stage ∈ {analyse, decide} + positive edit-intent regex + NO non-edit guard regex match.
   - run_analysis chip click — triggered by `source: 'chip_click'` + `chip.action_type: 'run_analysis'`.
3. Narrowing `CEE_PIPELINE_V4_ENABLED` documentation: the flag gates V1 route registration only; the unified pipeline and V4 tool handlers remain callable from V2 regardless. Verified by `tests/integration/orchestrator/unified-pipeline-v4-flag-independence.test.ts`.

## V1 regression invariant

`POST /orchestrate/v1/turn` continues to return 410 `V4_DISABLED` when `CEE_PIPELINE_V4_ENABLED=false`, per the predecessor v5-cee-exclusive-path brief. Covered by `tests/integration/orchestrator/route-v4-disabled-guard.test.ts`.

## Turn-shape matrix — current reality (v5-handler-surface, 2026-04-21)

Each row: what V5 does TODAY if the UI posts to `/orchestrate/v2/turn`.

**Status taxonomy:**

- **WORKING** — happy 200 response with a valid OlumiResponse envelope.
- **TYPED_ERROR** — non-200 response with a typed BoundaryError / typed error block. Wire-contract-compliant; acceptable final state.
- **NEEDS_FIX** — blank turn, hidden failure, opaque INTERNAL_ERROR, or hang. Must be addressed before V5 can be a compliant exclusive path. **Zero rows in this category post v5-handler-surface.**

### 4a. Newly WORKING after v5-handler-surface (2026-04-21)

Each new WORKING row cites the passing route-level integration test.

| # | Turn type | UI sends (v0.7.0 shape) | V5 today | Test file |
|---|---|---|---|---|
| 1 | Free-text conversation | `kind: 'message'`, source: 'composer' | TurnExecutor text_only → 200 | (existing) |
| 2 | Draft_graph (brief submission) | `kind: 'message'`, stage: 'frame', no graph, decision-keyword message | Pre-Sonnet dispatch to `handleDraftGraph` via `dispatchDraftGraph` → 200 + commit | `route-v2-draft-graph.test.ts` |
| 3 | run_analysis via message text | `kind: 'message'`, no chip | TurnExecutor ORIENT → EXECUTE via registered handler → 200 | (existing, Group 3) |
| 3b | run_analysis via chip_click | `source: 'chip_click'`, `chip.action_type: 'run_analysis'` | Pre-Sonnet `dispatchChipClickRunAnalysis` → handler invoked directly → 200 + commit | `route-v2-chip-click.test.ts` |
| 4 | System event: patch_accepted | `kind: 'system_event'`, `event.kind: 'patch_accepted'` | `dispatchSystemEvent` → empty acknowledgement envelope + commit → 200 | `route-v2-system-events.test.ts` |
| 5 | System event: patch_dismissed | same shape | same dispatcher → 200 + commit | `route-v2-system-events.test.ts` |
| 6 | System event: direct_graph_edit | `event.kind: 'direct_graph_edit'` + `target_id` + `operation` | 200 + commit | `route-v2-system-events.test.ts` |
| 7 | System event: chip_click | `event.kind: 'chip_click'` + `chip_id` | 200 + commit | `route-v2-system-events.test.ts` |
| 8 | System event: undo | `event.kind: 'undo'` | 200 acknowledgement, **commit SKIPPED** (client-only event — matches V4 semantics) | `route-v2-system-events.test.ts` |
| 8b | System event: redo | `event.kind: 'redo'` | Same as undo | `route-v2-system-events.test.ts` |
| 9 | Turn with analysis_state | v0.7.0 message + analysis ingress extension | Phase 1.5 extension; TurnExecutor → 200 | (existing) |
| 10 | Turn with graph_state | v0.7.0 message + graph ingress extension | Phase 1.5 extension; TurnExecutor → 200 | (existing) |
| 12 | Edit_graph (natural language) | `kind: 'message'`, graph_state present, stage ∈ {analyse, decide}, edit-verb message, no non-edit guard match | Pre-Sonnet dispatch to `handleEditGraph` via `dispatchEditGraph` → 200 + commit | `route-v2-edit-graph.test.ts` |
| GOLDEN | Full journey: brief → edit → analysis chip (V4 flag OFF) | Four-turn sequence with v0.7.0 shapes | All three dispatchers fire; each commits; each returns 200 OlumiResponse | `route-v2-golden-path.test.ts` |

### 4b. Correctly typed but still blocking paths (TYPED_ERROR)

These rows are wire-contract-compliant (typed non-200 BoundaryError) but still NOT WORKING. Widening either the v0.7.0 schema or V5's handler registry would flip them to WORKING in a follow-up brief.

| # | Turn type | Status | Why |
|---|---|---|---|
| 11 | Turn with session_state | TYPED_ERROR (422) | `session_state` is not an accepted v0.7.0 field. Semantically correct — UI should not send it; V5 reads prior turns from the session store internally. |
| 13 | set_factor_value via tool call | TYPED_ERROR (500 FEATURE_NOT_ENABLED) | In V5ActionType but no handler registered; validator-miss → typed FEATURE_NOT_ENABLED per v5-exclusive-cee P0 follow-up. |
| 14 | add_constraint, adjust_edge_strength, explain_result, compare_options, what_would_flip | TYPED_ERROR (500 FEATURE_NOT_ENABLED) | Same as #13. Chip clicks for these action_types fall through to TurnExecutor and take the same typed path. |

### 4c. Exclusive-path readiness verdict (post v5-handler-surface)

- **Wire-contract readiness — SATISFIED** ✅ (was already satisfied pre-brief).
- **Exclusive-path readiness — SATISFIED for the primary user journey** ✅. The four rows the UI brief needs (free-text, brief → draft, natural-language edit, analysis chip click) plus all six system events are WORKING. The remaining TYPED_ERROR rows (session_state, set_factor_value et al.) are either semantically correct non-UI turns (#11) or features whose handlers are deferred to a later slice (#13/#14).
- `CEE_PIPELINE_V4_ENABLED=false` can be turned on in staging without breaking the primary UI flows, subject to the usual staging-validation sequence.

---

## Historical reference

The pre-v5-handler-surface snapshot (when 10/14 rows were exclusive-path BLOCKERS) is archived at [v5-turn-shape-matrix-archived-v0.6.0.md](v5-turn-shape-matrix-archived-v0.6.0.md). That file is retained as a change record only and must not be used to determine current system behaviour.
