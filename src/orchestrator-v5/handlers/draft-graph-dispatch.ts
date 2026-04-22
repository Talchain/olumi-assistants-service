/**
 * V5 pre-Sonnet dispatch for draft_graph turns.
 *
 * Triggered by route-v2.ts when a message-kind payload looks like a
 * first-time brief submission (stage=frame, no graphState, message length
 * meets DRAFT_GRAPH_MIN_BRIEF_LENGTH). Delegates to the V4 unified pipeline
 * via the shared handleDraftGraph handler — no schema changes, no new
 * handler registry entry. See the v5-handler-surface brief Task 2 for the
 * Paul-decision (draft_graph not in v0.7.0 ActionType, so Sonnet tool-use
 * routing cannot reach the unified pipeline through V5).
 *
 * Adapter checkpoint (per brief review): V4's DraftGraphResult.blocks is a
 * `TypedConversationBlock[]` that includes V4-internal `GraphPatchBlock`
 * variants (patch_type: 'full_draft'). v0.7.0's OlumiResponseSchema only
 * permits a narrow `graph_patch` block (single-target edits:
 * set_factor_value, add_constraint, adjust_edge_strength) — there is NO
 * v0.7.0 block variant that can carry a full initial graph draft.
 *
 * Decision: the adapter produces a TEXT-ONLY OlumiResponse. The graph is
 * persisted atomically with the turn commit via CommitMetadata.graph, which
 * is passed to append_turn_atomic as p_graph. The RPC writes scenarios.graph
 * and inserts the turn row in the same transaction — both succeed or both roll
 * back. The UI re-fetches via the existing scenario/graph read paths. We drop
 * V4's GraphPatchBlock, applied_graph, strengthen_items, draft warnings, and
 * telemetry — dropping is deliberate, not accidental: these were V4 surface
 * that the new V5+UI contract does not yet need to thread through OlumiResponse.
 * When Paul widens @talchain/schemas to carry a full_draft block, this adapter
 * can be extended without call-site changes.
 *
 * V4 column audit (2026-04-22): V4's handleDraftGraph does not write to the
 * scenarios table directly — it returns graphOutput in its result and the
 * caller decides what to persist. The scenarios table has columns for framing,
 * brief, analysis_status, analysis, events, etc. but none of these are written
 * by the V4 draft_graph handler: framing is set by the intent-gate path,
 * analysis_status by the run_analysis handler, events by a separate event log.
 * Only scenarios.graph needs to be persisted here. Other columns are either
 * populated by their own handlers or are not relevant to the draft turn.
 * Re-audit if run_analysis returns "no graph found" after a V5 draft turn.
 *
 * commit_performed signal: always true on success (append_turn_atomic
 * fires with handler_id=null, handler_facts=[]). handler_facts is empty
 * because v0.7.0's HandlerFact union has no draft_graph variant — adding
 * one is a schema extension out of scope for this brief.
 *
 * stage_indicator advances to 'analyse' ONLY when graph persistence
 * succeeded (CommitResult.graphPersisted === true) — this is the client's
 * signal that a graph exists to fetch. On persistence failure the stage
 * stays at 'frame' so the client does not attempt a fetch against an empty
 * scenarios.graph column.
 */

import type { FastifyRequest } from 'fastify';

import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';

import { log } from '../../utils/telemetry.js';
import { handleDraftGraph, type DraftGraphResult } from '../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';

export interface DispatchDraftGraphParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly request: FastifyRequest;
}

export interface DispatchDraftGraphResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
}

/**
 * Map V4 DraftGraphResult → v0.7.0 OlumiResponse.
 *
 * The mapping deliberately drops V4-specific fields that have no v0.7.0
 * equivalent (see file header). The UI obtains graph content via the
 * scenarios read path (scenarios.graph), written atomically by the commit
 * stage (append_turn_atomic with p_graph).
 *
 * assistant_text contract:
 *   - graphPersisted=true: use handler narration, falling back to node/edge
 *     count confirmation — graph is on canvas.
 *   - graphPersisted=false AND a graph was produced: explicit save-failure
 *     message — the user must not see "Drafted a graph" when no graph appears.
 *   - graphPersisted=false AND no graphOutput: pipeline produced no graph;
 *     use handler narration or a neutral confirmation.
 */
function draftResultToOlumiResponse(
  result: DraftGraphResult,
  payload: MessageTurnPayload,
  graphPersisted: boolean,
): OlumiResponse {
  let assistantText: string;
  if (graphPersisted) {
    // Success path: prefer handler narration, fall back to node/edge summary.
    const successFallback = result.graphOutput
      ? `Drafted a decision graph with ${result.graphOutput.nodes?.length ?? 0} nodes and ${result.graphOutput.edges?.length ?? 0} edges.`
      : 'Drafted a decision graph.';
    assistantText = result.assistantText ?? successFallback;
  } else if (result.graphOutput) {
    // Persistence failed after the pipeline produced a graph. Saying "Drafted
    // a graph" while nothing appears on canvas violates the quality contract.
    assistantText = 'I generated a decision graph, but it could not be saved. Please try submitting your brief again.';
  } else {
    // Pipeline produced no graph — narration stands.
    assistantText = result.assistantText ?? 'Drafted a decision graph.';
  }

  // Only advance to 'analyse' when persistence actually succeeded. If
  // graphPersisted is false the graph was not written to scenarios.graph and
  // the client must not try to fetch it — keep the current stage so the
  // frame stays visible and the operator can investigate the persistence log.
  const stageIndicator = graphPersisted ? 'analyse' : payload.stage;
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: stageIndicator,
  };
}

export async function dispatchDraftGraph(
  params: DispatchDraftGraphParams,
): Promise<DispatchDraftGraphResult> {
  const { payload, requestId, request } = params;
  const startedAt = Date.now();

  let draftResult: DraftGraphResult;
  try {
    draftResult = await handleDraftGraph(payload.message, request, payload.turn_id);
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 draft_graph dispatch — unified pipeline threw',
    );
    // Throw upward — route-v2.ts can decide the wire-level mapping. Keeping
    // the branch honest: success path returns normally; failure surfaces
    // as a thrown error that the route converts to a 500 BoundaryError.
    throw err;
  }

  try {
    // llm_calls_used: the unified pipeline's draft stage makes at least one
    // LLM call (see src/cee/unified-pipeline/stages/parse.ts). V4's
    // DraftGraphResult exposes this via `toolLLMTelemetry` but not as a
    // simple integer count. Using 1 as an honest minimum rather than 0
    // (zero would misrepresent the turn as a no-LLM deterministic event).
    //
    // graph: when graphOutput is present, it is passed to append_turn_atomic
    // as p_graph and persisted atomically with the turn insert. If the RPC
    // throws (StateCommitFailedError), both graph and turn roll back together
    // and the catch below returns commitPerformed=false.
    const commitResult = await commitDirectAnswer(
      // Provisional response — the real response is built below once we know
      // graphPersisted. This value is recorded in the turn row but is NOT
      // sent to the client (the caller uses the response we return).
      { response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [], stage_indicator: payload.stage },
      {
        scenario_id: payload.scenario_id,
        turn_id: payload.turn_id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: computeRequestHash(payload),
        llm_calls_used: 1,
        duration_ms: Date.now() - startedAt,
        handler_facts: [],
        graph: draftResult.graphOutput ?? undefined,
      },
    );

    const response = draftResultToOlumiResponse(draftResult, payload, commitResult.graphPersisted);
    log.info(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        latency_ms: draftResult.latencyMs,
        graph_persisted: commitResult.graphPersisted,
      },
      'V5 draft_graph dispatch committed',
    );
    return { response, commitPerformed: true };
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 draft_graph dispatch — commit failed',
    );
    const response = draftResultToOlumiResponse(draftResult, payload, false);
    return { response, commitPerformed: false };
  }
}
