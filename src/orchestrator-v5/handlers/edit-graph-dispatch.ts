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
import { GraphV3 } from '../../schemas/cee-v3.js';
import type { AnalysisStateIngress, GraphStateIngress } from '../boundary/request-extensions.js';

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
  /** Permissive ingress shape. Adapter inside converts to GraphV3T. */
  readonly graphState: GraphStateIngress;
  /** Permissive ingress shape. Adapter inside converts to V2RunResponseEnvelope. */
  readonly analysisState: AnalysisStateIngress | null;
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
      ? `Applied edit. Graph now has ${result.appliedGraph.nodes?.length ?? 0} nodes and ${result.appliedGraph.edges?.length ?? 0} edges.`
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

/**
 * Adapter: permissive `GraphStateIngress` (v0.7.0 wire shape) → strict
 * `GraphV3T` (V4 internal type) for `ConversationContext.graph`.
 *
 * Ingress has already been Zod-validated by `parseRequestExtensions`, but its
 * schema uses `.passthrough()` and weaker field types than GraphV3. Rather
 * than `as unknown as` (erasing type safety), this adapter runs `GraphV3`
 * through `safeParse`. Outcomes:
 *   - parse success → return the parsed GraphV3T (nodes/edges preserved).
 *   - parse failure → construct a minimal GraphV3T-compatible value from
 *     the ingress fields `handleEditGraph` actually reads (nodes[id,kind,
 *     label], edges[from,to]). Failure is logged at warn so the operator
 *     sees the drift; the edit still proceeds because handleEditGraph
 *     internally re-casts to a weaker structural type (see edit-graph.ts
 *     lines 1662/1712/1766).
 *
 * Callers of this module MUST NOT apply `as unknown as GraphV3T` themselves
 * — see the banner comment in src/orchestrator-v5/boundary/request-extensions.ts.
 */
function graphStateToGraphV3(graphState: GraphStateIngress, requestId: string): GraphV3T {
  const parsed = GraphV3.safeParse(graphState);
  if (parsed.success) {
    return parsed.data;
  }
  log.warn(
    {
      request_id: requestId,
      issue_count: parsed.error.issues.length,
      first_issue_path: parsed.error.issues[0]?.path.join('.') ?? null,
    },
    'V5 edit_graph dispatch — graph ingress did not pass strict GraphV3 parse; using structural fallback',
  );
  // Structural fallback: build a GraphV3T-shaped object from the ingress
  // fields handleEditGraph actually reads. Required GraphV3 fields that
  // the ingress does NOT carry (edge.effect_direction, edge.strength
  // object, edge.exists_probability) are stamped with inert defaults so
  // the returned value satisfies GraphV3T's type without fabricating
  // semantically meaningful values. handleEditGraph re-casts graph
  // internally (edit-graph.ts:1662/1712/1766 cast to a weaker
  // { nodes: Array<{id,kind?}>, edges?: unknown[] } type), so these
  // defaults never influence the edit logic itself.
  const fallbackNodes: GraphV3T['nodes'] = graphState.nodes.map((n) => {
    const node = n as { id: string; kind: string; label?: string };
    return {
      id: node.id,
      kind: node.kind as GraphV3T['nodes'][number]['kind'],
      label: node.label ?? node.id,
    };
  });
  const fallbackEdges: GraphV3T['edges'] = graphState.edges.map((e) => {
    const edge = e as { from: string; to: string };
    return {
      from: edge.from,
      to: edge.to,
      strength: { mean: 0, std: 0 },
      exists_probability: 1,
      effect_direction: 'positive',
    };
  });
  return { nodes: fallbackNodes, edges: fallbackEdges };
}

/**
 * Adapter: permissive `AnalysisStateIngress` → `V2RunResponseEnvelope`.
 *
 * Mirrors `coerceIngressAnalysis` in turn-executor.ts (the existing V5
 * convention for ingress→V4 envelope conversion). Only `analysis_status` is
 * structurally required in the ingress schema; everything else is
 * passthrough. We fill `meta` and normalise `results` so handleEditGraph's
 * downstream consumers receive the shape they expect without this module
 * applying a type-erasing `as unknown as` cast.
 */
function analysisIngressToV2Envelope(a: AnalysisStateIngress): V2RunResponseEnvelope {
  const raw = a as AnalysisStateIngress & {
    meta?: V2RunResponseEnvelope['meta'];
    results?: unknown;
    [k: string]: unknown;
  };
  const results: unknown[] = Array.isArray(raw.results)
    ? raw.results
    : raw.results && typeof raw.results === 'object'
      ? Object.values(raw.results as Record<string, unknown>)
      : [];
  return {
    ...raw,
    meta: raw.meta ?? { seed_used: 0, n_samples: 0, response_hash: '' },
    results,
  };
}

export async function dispatchEditGraph(
  params: DispatchEditGraphParams,
): Promise<DispatchEditGraphResult> {
  const { payload, requestId, graphState, analysisState } = params;
  const startedAt = Date.now();

  const context: ConversationContext = {
    graph: graphStateToGraphV3(graphState, requestId),
    analysis_response: analysisState ? analysisIngressToV2Envelope(analysisState) : null,
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
    // llm_calls_used: handleEditGraph makes at least one LLM call for the
    // edit classification + repair loop. Using 1 as an honest minimum.
    //
    // graph: when the edit was actually applied, EditGraphResult.appliedGraph
    // carries the post-edit GraphV3T. Pass it as p_graph so append_turn_atomic
    // writes scenarios.graph in the same transaction as the turn row. When the
    // edit was rejected (or otherwise produced no graph), appliedGraph is null
    // — `null ?? undefined` resolves to undefined, the RPC receives p_graph =
    // null, and scenarios.graph is left unchanged. Mirror of the pattern in
    // draft-graph-dispatch.ts.
    await commitDirectAnswer(response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 1,
      duration_ms: Date.now() - startedAt,
      handler_facts: [],
      graph: editResult.appliedGraph ?? undefined,
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
