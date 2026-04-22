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
 * persisted via the CEE pipeline's own side channels (it writes to the
 * scenarios table as part of its V3 boundary stage); the UI re-fetches via
 * the existing scenario/graph read paths. We drop V4's GraphPatchBlock,
 * applied_graph, strengthen_items, draft warnings, and telemetry —
 * dropping is deliberate, not accidental: these were V4 surface that the
 * new V5+UI contract does not yet need to thread through OlumiResponse.
 * When Paul widens @talchain/schemas to carry a full_draft block, this
 * adapter can be extended without call-site changes.
 *
 * commit_performed signal: always true on success (append_turn_atomic
 * fires with handler_id=null, handler_facts=[]). handler_facts is empty
 * because v0.7.0's HandlerFact union has no draft_graph variant — adding
 * one is a schema extension out of scope for this brief.
 */

import type { FastifyRequest } from 'fastify';

import type { MessageTurnPayload, OlumiResponse } from '@talchain/schemas/boundary';

import { log } from '../../utils/telemetry.js';
import { handleDraftGraph, type DraftGraphResult } from '../../orchestrator/tools/draft-graph.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { getSessionStore, type SessionStore } from '../session/index.js';

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
 * scenarios read path (scenarios.graph), written by storeDraftGraph.
 *
 * stage_indicator advances to 'analyse' ONLY when graph persistence
 * succeeded — this is the client's signal that a graph exists to fetch.
 * On persistence failure we stay on 'frame' so the client does not attempt
 * a fetch against an empty scenarios.graph column.
 */
function draftResultToOlumiResponse(
  result: DraftGraphResult,
  payload: MessageTurnPayload,
  graphPersisted: boolean,
): OlumiResponse {
  // Prefer the handler's narration; fall back to a minimal confirmation so
  // assistant_text is never empty on success (empty assistant_text is reserved
  // for system events).
  const fallback = result.graphOutput
    ? `Drafted a decision graph with ${result.graphOutput.nodes?.length ?? 0} nodes and ${result.graphOutput.edges?.length ?? 0} edges.`
    : 'Drafted a decision graph.';
  // Only advance to 'analyse' when persistence actually succeeded. If
  // graphPersisted is false the graph was not written to scenarios.graph and
  // the client must not try to fetch it — keep the current stage so the
  // frame stays visible and the operator can investigate the persistence log.
  const stageIndicator = graphPersisted ? 'analyse' : payload.stage;
  return {
    response_version: 2,
    assistant_text: result.assistantText ?? fallback,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: stageIndicator,
  };
}

/**
 * Attempt to persist the draft graph to scenarios.graph.
 * Returns true on success, false on failure (after logging).
 * Never throws — persistence failure is non-fatal to the turn commit.
 */
async function tryStoreDraftGraph(
  store: SessionStore,
  scenarioId: string,
  graph: DraftGraphResult['graphOutput'],
  requestId: string,
): Promise<boolean> {
  try {
    await store.storeDraftGraph(scenarioId, graph);
    log.info(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        node_count: graph!.nodes.length,
        edge_count: graph!.edges.length,
      },
      'V5 draft_graph: graph persisted to scenarios table',
    );
    return true;
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: scenarioId,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 draft_graph: graph persistence failed — stage kept at frame, client will not see graph on canvas',
    );
    return false;
  }
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

  // Resolve the store once — used for both graph persistence and turn commit.
  const store = getSessionStore();

  // Persist graph first — the stage_indicator in the response depends on
  // whether this succeeds, so it must complete before building the response.
  const graphPersisted = draftResult.graphOutput
    ? await tryStoreDraftGraph(store, payload.scenario_id, draftResult.graphOutput, requestId)
    : false;

  const response = draftResultToOlumiResponse(draftResult, payload, graphPersisted);

  try {
    // llm_calls_used: the unified pipeline's draft stage makes at least one
    // LLM call (see src/cee/unified-pipeline/stages/parse.ts). V4's
    // DraftGraphResult exposes this via `toolLLMTelemetry` but not as a
    // simple integer count. Using 1 as an honest minimum rather than 0
    // (zero would misrepresent the turn as a no-LLM deterministic event).
    await commitDirectAnswer(response, {
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: computeRequestHash(payload),
      llm_calls_used: 1,
      duration_ms: Date.now() - startedAt,
      handler_facts: [],
    }, store);
    log.info(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        latency_ms: draftResult.latencyMs,
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
    return { response, commitPerformed: false };
  }
}
