/**
 * V5 deterministic system-event dispatch.
 *
 * v0.7.0 introduced `kind: 'system_event'` on OrchestratorTurnPayload. System
 * events (patch_accepted, patch_dismissed, direct_graph_edit, chip_click,
 * undo, redo, selection_change) are deterministic Layer 0 operations — no
 * LLM routing, no handler dispatch. The route (route-v2.ts) intercepts them
 * BEFORE calling runTurnExecutor because:
 *   (1) system-event payloads have no `message` field, so TurnExecutor's
 *       ORIENT step (which needs a user message) cannot fire.
 *   (2) these events map to UI state changes the server records without
 *       LLM involvement.
 *
 * Persistence (Paul decision in planning round, matching V4 semantics):
 *   - patch_accepted, patch_dismissed, direct_graph_edit, chip_click
 *     → commit via commitDirectAnswer (append_turn_atomic).
 *   - undo, redo, selection_change → no commit; return commitPerformed:
 *     false with commitSkippedReason: 'client_only_event'. The route
 *     recognises this reason and still returns 200 — the skip is honest,
 *     not a fake success. See src/orchestrator/route-v2.ts for the
 *     skip-reason allowlist.
 *
 * Response envelope: empty assistant_text, no blocks, no actions — the UI
 * renders the state change visually. Mirrors the silent-acknowledgement
 * pattern in src/orchestrator/deterministic/system-event-handler.ts.
 */

import type {
  OlumiResponse,
  SystemEventTurnPayload,
  SystemEventKindLiteral,
} from '@talchain/schemas/boundary';

import { log } from '../../utils/telemetry.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';

export type SystemEventCommitSkipReason = 'client_only_event';

export interface DispatchSystemEventResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
  readonly commitSkippedReason?: SystemEventCommitSkipReason;
  /**
   * V5 finaliser contract — system event readiness, by event kind:
   *
   *   undo / redo / selection_change / chip_click / patch_dismissed
   *     No server-side graph state to inspect. analysisReady stays
   *     undefined; the finaliser stamps no analysis_ready, and the UI's
   *     prior `ceeAnalysisReady` remains the truth (it was correct before
   *     the event).
   *
   *   patch_accepted / direct_graph_edit
   *     Graph-MUTATING. The current dispatch produces only a silent
   *     acknowledgement and has no post-mutation graph snapshot in scope,
   *     so analysisReady stays undefined here too. The UI is responsible
   *     for invalidating `ceeAnalysisReady` locally on these events
   *     (per `invalidateAnalysisReady()` in DecisionGuideAI canvas store).
   *     If a future change exposes the post-mutation graph at this layer,
   *     populate this field from `computeStructuralReadiness` so the wire
   *     refreshes readiness atomically with the mutation acknowledgement.
   *
   * Type is `AnalysisReadyPayload | undefined` (not literal `undefined`)
   * so future implementations can populate it without a type-shape change.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * Graph for the central egress sanitiser. Always `null` here as a
   * deliberate documented choice: system-event acknowledgement responses
   * have empty `assistant_text` and no blocks, so the sanitiser is a no-op
   * regardless. If a future change exposes a post-mutation graph at this
   * layer (see `analysisReady` jsdoc above), populate it here too.
   */
  readonly graph: null;
}

export interface DispatchSystemEventParams {
  readonly payload: SystemEventTurnPayload;
  readonly requestId: string;
}

// Events that produce no server state change. Skipping commit for these
// matches V4's deterministic handler behaviour — undo/redo are realised in
// the client's graph history, not in Supabase turn state. Typed against
// `SystemEventKindLiteral` so adding a new kind to the schema without
// updating this list is a compile-time error (not a silent runtime miss).
//
// selection_change is client-only ACKED as a holding position — R5 will
// likely route it into ephemeral turn context (never a committed turn);
// revisit the dispatch branch, not this guard, when R5 lands.
const CLIENT_ONLY_EVENT_KINDS: ReadonlySet<SystemEventKindLiteral> = new Set<SystemEventKindLiteral>([
  'undo',
  'redo',
  'selection_change',
]);

function buildAcknowledgementResponse(
  payload: SystemEventTurnPayload,
): OlumiResponse {
  // Silent acknowledgement. V4's handleSystemEvent follows the same
  // convention — UI-visible confirmation is rendered by the UI's own
  // patch/history components, not by a message bubble.
  return {
    response_version: 2,
    assistant_text: '',
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: payload.stage,
  };
}

export async function dispatchSystemEvent(
  params: DispatchSystemEventParams,
): Promise<DispatchSystemEventResult> {
  const { payload, requestId } = params;
  const startedAt = Date.now();
  const response = buildAcknowledgementResponse(payload);

  if (CLIENT_ONLY_EVENT_KINDS.has(payload.event.kind)) {
    log.info(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
      },
      'V5 system event — client-only, skipping commit',
    );
    return {
      response,
      commitPerformed: false,
      commitSkippedReason: 'client_only_event',
      graph: null,
    };
  }

  try {
    await commitDirectAnswer(response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 0,
      duration_ms: Date.now() - startedAt,
      handler_facts: [],
      // V5 Stage 2B-1b: system-event turns have no user turn / coaching context
      // (no buildTurnContext) — persist NULL explicitly. The most-recent read
      // filters non-null, so this never resets a prior coaching snapshot.
      coaching_state: null,
    });
    log.info(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
      },
      'V5 system event committed',
    );
    return { response, commitPerformed: true, graph: null };
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        event_kind: payload.event.kind,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 system event commit failed',
    );
    return { response, commitPerformed: false, graph: null };
  }
}
