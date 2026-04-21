/**
 * V5 pre-Sonnet dispatch for edit_graph turns.
 *
 * Mirrors draft-graph-dispatch.ts for natural-language graph edits.
 * `edit_graph` is NOT in v0.7.0 V5ActionType, so Sonnet's tool-use validator
 * cannot propose it. Route-v2 detects the edit shape (message-kind, graph
 * present, positive edit-intent regex, no non-edit phrasing regex) and
 * delegates deterministically to handleEditGraph.
 *
 * Adapter decision (same reasoning as draft-graph-dispatch): v0.7.0's
 * OlumiResponse.graph_patch block is narrow (single-target operation on
 * ['set_factor_value','add_constraint','adjust_edge_strength']), whereas
 * V4's edit_graph emits richer patch descriptions including multi-op
 * patches, pending clarifications, and route metadata. The adapter
 * produces a text-only OlumiResponse; the applied graph persists via
 * the pipeline's own side channels.
 */

import type { FastifyRequest } from 'fastify';

import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';

import { log } from '../../utils/telemetry.js';
import { handleEditGraph, type EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { getAdapter } from '../../adapters/llm/router.js';
import type {
  ConversationContext,
  DecisionStage,
  GraphV3T,
  V2RunResponseEnvelope,
} from '../../orchestrator/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

// v0.7.0's Stage enum (frame | analyse | decide | review) does not align with
// V4's DecisionStage (frame | ideate | evaluate | decide | optimise). Map
// across the boundary so ConversationContext.framing.stage is a valid V4
// DecisionStage. Unmapped values fall back to 'frame' — edit_graph is a
// structural operation that doesn't branch on stage, so a broad default is
// safe here.
function mapStageToDecisionStage(stage: MessageTurnPayload['stage']): DecisionStage {
  switch (stage) {
    case 'frame':
      return 'frame';
    case 'analyse':
      return 'evaluate';
    case 'decide':
      return 'decide';
    case 'review':
      return 'optimise';
    default:
      return 'frame';
  }
}

export interface DispatchEditGraphParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly request: FastifyRequest;
  readonly graphState: GraphStateIngress;
  readonly analysisState: V2RunResponseEnvelope | null;
}

export interface DispatchEditGraphResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
}

function editResultToOlumiResponse(
  result: EditGraphResult,
  payload: MessageTurnPayload,
): OlumiResponse {
  const fallback = result.wasRejected
    ? 'The proposed edit was rejected.'
    : result.appliedGraph
      ? `Applied edit — graph now has ${result.appliedGraph.nodes?.length ?? 0} nodes and ${result.appliedGraph.edges?.length ?? 0} edges.`
      : 'Edit processed.';
  return {
    response_version: 2,
    assistant_text: result.assistantText ?? fallback,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: payload.stage,
  };
}

function graphStateToGraphV3(graphState: GraphStateIngress): GraphV3T {
  // GraphStateIngress is a permissive ingress shape with `nodes: [{id,kind,label,...}]`
  // and `edges: [{from,to,...}]`. V4's ConversationContext expects a full
  // GraphV3T but handleEditGraph only reads structural fields, so a coerced
  // cast is safe here. This mirrors the coerceIngressAnalysis pattern in
  // turn-executor.ts.
  return graphState as unknown as GraphV3T;
}

export async function dispatchEditGraph(
  params: DispatchEditGraphParams,
): Promise<DispatchEditGraphResult> {
  const { payload, requestId, graphState, analysisState } = params;
  const startedAt = Date.now();

  const context: ConversationContext = {
    graph: graphStateToGraphV3(graphState),
    analysis_response: analysisState,
    framing: { stage: mapStageToDecisionStage(payload.stage) },
    messages: [{ role: 'user', content: payload.message }],
    scenario_id: payload.scenario_id,
  };

  const adapter = getAdapter('edit_graph');

  let editResult: EditGraphResult;
  try {
    editResult = await handleEditGraph(
      context,
      payload.message,
      adapter,
      requestId,
      payload.turn_id,
    );
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 edit_graph dispatch — handler threw',
    );
    throw err;
  }

  const response = editResultToOlumiResponse(editResult, payload);

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
    });
    log.info(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        latency_ms: editResult.latencyMs,
        was_rejected: editResult.wasRejected,
      },
      'V5 edit_graph dispatch committed',
    );
    return { response, commitPerformed: true };
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 edit_graph dispatch — commit failed',
    );
    return { response, commitPerformed: false };
  }
}
