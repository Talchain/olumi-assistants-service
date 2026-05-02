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
 * permitted narrow graph_patch blocks. v0.8.0 adds an optional top-level
 * `draft_graph` field to OlumiResponse carrying the full post-repair graph
 * inline so the UI can render immediately without a Supabase re-fetch.
 *
 * Decision: the adapter now includes `draft_graph` in the response when
 * graphOutput is available. The graph is also persisted atomically via
 * CommitMetadata.graph → append_turn_atomic → scenarios.graph for session
 * resume. The inline graph is the primary render path; Supabase is the
 * fallback for session resume. We still drop V4's GraphPatchBlock,
 * strengthen_items, draft warnings, and telemetry — those remain V4-only
 * surface not yet in the V5+UI contract.
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

import { handleDraftGraph, type DraftGraphResult } from '../../orchestrator/tools/draft-graph.js';
import type { GraphV3T } from '../../orchestrator/types.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import type { SuggestedAction } from '../compose/types.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  emitFreshnessTelemetry,
  type FreshnessDerivation,
} from '../context/freshness.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { normaliseBriefText } from '../session/normalise-brief-text.js';
import { checkDraftNarrationCounts } from './narration-count-guard.js';

export interface DispatchDraftGraphParams {
  readonly payload: MessageTurnPayload;
  readonly requestId: string;
  readonly request: FastifyRequest;
}

export interface DispatchDraftGraphResult {
  readonly response: OlumiResponse;
  readonly commitPerformed: boolean;
  /**
   * V5 finaliser contract: pre-computed readiness surfaced for the response
   * finaliser in route-v2.ts. Draft uses the rich pipeline payload from
   * `DraftGraphResult.analysisReady` (carries blockers, model_adjustments,
   * intervention_details, bias_findings — fields the structural fallback
   * does not produce). Undefined when the draft did not persist a graph;
   * the finaliser then emits no analysis_ready, which the UI treats as
   * "no fresh readiness this turn" rather than as a blocker.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * Post-repair graph used for label resolution by the central egress
   * sanitiser (sanitiseOlumiResponseForEgress). Null when the draft did
   * not produce a graph — sanitiser falls back to prefix-aware generic.
   */
  readonly graph: GraphV3T | null;
  /**
   * V5 state-trust freshness derivation. Draft is the first-turn brief
   * shape — there is no prior run_analysis fact yet. Expected to be
   * `none` in normal use; surfaced for telemetry / contract consistency
   * and to make the wire field present on every CEE dispatch path.
   */
  readonly freshness?: import('../context/freshness.js').FreshnessDerivation;
}

/**
 * Map V4 DraftGraphResult → OlumiResponse (v0.8.0 contract).
 *
 * Includes the FINAL post-repair graph in `draft_graph` when graphOutput is
 * present so the UI can render immediately without a Supabase re-fetch. The
 * graph is also persisted atomically via CommitMetadata.graph for session
 * resume — Supabase remains the fallback, not the primary path.
 *
 * assistant_text contract:
 *   - graphPersisted=true: use handler narration, falling back to FINAL
 *     node/edge count (post-repair) — graph is on canvas.
 *   - graphPersisted=false (commit threw, caught by caller): the route maps
 *     commitPerformed=false to HTTP 500 INTERNAL_ERROR with retryable=true.
 *     The response text here is never sent to the client; use the pipeline's
 *     own narration as a neutral fallback for server-side logging only.
 */
function draftResultToOlumiResponse(
  result: DraftGraphResult,
  payload: MessageTurnPayload,
  graphPersisted: boolean,
  requestId: string,
): OlumiResponse {
  // Derive node/edge counts from the FINAL graph (post-repair, post-validation)
  // to ensure the assistant_text matches what the UI will render.
  const finalNodeCount = result.graphOutput?.nodes?.length ?? 0;
  const finalEdgeCount = result.graphOutput?.edges?.length ?? 0;

  let assistantText: string;
  if (graphPersisted) {
    // Success path: prefer handler narration, fall back to FINAL node/edge count.
    // Phase 2 workstream B: when narration explicitly states a count that
    // disagrees with the final graph, fall back to deterministic prose so
    // the user never sees numbers that contradict the canvas.
    const successFallback = result.graphOutput
      ? `Drafted a decision graph with **${finalNodeCount}** nodes and **${finalEdgeCount}** edges.`
      : 'Drafted a decision graph.';
    if (result.assistantText !== null) {
      const guardCheck = checkDraftNarrationCounts({
        narration: result.assistantText,
        finalNodeCount,
        finalEdgeCount,
        fallback: successFallback,
        requestId,
      });
      assistantText = guardCheck.chosenText;
    } else {
      assistantText = successFallback;
    }
  } else {
    // Failure path: route discards this response and returns 500 INTERNAL_ERROR.
    // Use neutral narration; the client never sees this text.
    assistantText = result.assistantText ?? 'Drafted a decision graph.';
  }

  // Only advance to 'analyse' when persistence actually succeeded. If
  // graphPersisted is false the graph was not written to scenarios.graph and
  // the client must not try to fetch it — keep the current stage so the
  // frame stays visible and the operator can investigate the persistence log.
  const stageIndicator = graphPersisted ? 'analyse' : payload.stage;

  // Include the FINAL graph inline so the UI can apply it directly without a
  // Supabase re-fetch. Only present when graphOutput is available and
  // persistence succeeded — on failure the client never sees this response.
  const draftGraphField =
    graphPersisted && result.graphOutput
      ? {
          nodes: (result.graphOutput.nodes ?? []) as unknown[],
          edges: (result.graphOutput.edges ?? []) as unknown[],
          node_count: finalNodeCount,
          edge_count: finalEdgeCount,
        }
      : undefined;

  // V5 finaliser contract: this composer must NOT set `analysis_ready`. The
  // dispatcher surfaces `result.analysisReady` on `DispatchDraftGraphResult`
  // (when graphPersisted), and the response-finaliser stamps it onto the
  // wire envelope after composition, before egress validation. The chip
  // gate below still reads the raw payload locally to choose the post-draft
  // chip — that's chip-suggestion logic, not envelope stamping.
  const analysisReadyField: AnalysisReadyPayload | undefined =
    graphPersisted && result.analysisReady
      ? (result.analysisReady as AnalysisReadyPayload)
      : undefined;

  // V5 review: post-draft_graph chips. The draft path produces its own
  // response envelope (not through the standard composers) so it needs its
  // own deterministic chip rule, matching the brief's chip mapping table:
  //   - graph persisted + analysis_ready === "ready" → executable Run analysis
  //   - graph persisted + analysis not ready → conversational setup prompt
  //   - draft failed to persist → no chips (the route returns 500 anyway)
  const suggestedActions = buildPostDraftChips({ graphPersisted, analysisReadyField });

  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [...suggestedActions],
    insights: [],
    stage_indicator: stageIndicator,
    ...(draftGraphField && { draft_graph: draftGraphField }),
  };
}

function buildPostDraftChips(params: {
  readonly graphPersisted: boolean;
  readonly analysisReadyField: DraftGraphResult['analysisReady'] | undefined;
}): readonly SuggestedAction[] {
  if (!params.graphPersisted) return [];
  const readyStatus =
    typeof params.analysisReadyField === 'object' && params.analysisReadyField !== null
      ? (params.analysisReadyField as { status?: unknown }).status
      : undefined;
  if (readyStatus === 'ready') {
    return [
      {
        id: 'chip_action_run_analysis',
        label: 'Run analysis',
        message: 'Run analysis.',
        action_type: 'run_analysis',
      },
    ];
  }
  return [
    {
      id: 'chip_prompt_set_option_values',
      label: 'Set values for options',
      message: 'Help me set up the options for this decision so the analysis can run.',
    },
  ];
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
    // V5 Phase 1 brief persistence: persist payload.message as
    // scenarios.brief_text on the first SUCCESSFUL draft turn. The RPC
    // enforces first-write-wins via `WHERE brief_text IS NULL OR
    // brief_text = ''`, so subsequent repair / edit / regeneration
    // draft_graph turns also pass through this dispatch path safely —
    // the second write is a no-op at the DB layer.
    //
    // CRITICAL guard against graphless first-write lockout: only thread
    // briefText to commit metadata when draftResult.graphOutput is
    // present. Without this guard, a graphless draft (handleDraftGraph
    // returned null graphOutput) would still write briefText, then the
    // user's retry on a successful draft would find brief_text already
    // populated → real brief silently dropped by the WHERE clause.
    // Tying the briefText write to graph presence means brief_text is
    // only set when the scenario has a usable graph the user can
    // actually act on.
    //
    // Brief regeneration semantics (intentional user edit of brief on a
    // scenario with existing brief_text) are out of scope for Phase 1.
    //
    // Normalisation: enforces the same length / whitespace invariants
    // as the DB CHECK constraint, with truncation rather than failure
    // on over-length inputs. Whitespace-only payloads collapse to
    // undefined → RPC param NULL → no write.
    const briefNorm = normaliseBriefText(payload.message);
    if (briefNorm.truncated) {
      emit(TelemetryEvents.V5BriefTextNormalised, {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        original_length: briefNorm.originalLength,
        truncated_length: briefNorm.value?.length ?? 0,
        reason: 'over_8000_chars',
      });
    }
    const briefTextForCommit =
      draftResult.graphOutput != null ? briefNorm.value : undefined;

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
        briefText: briefTextForCommit,
      },
    );

    const response = draftResultToOlumiResponse(draftResult, payload, commitResult.graphPersisted, requestId);
    // V5 finaliser contract: surface the rich pipeline payload on the
    // dispatch result so route-v2.ts can stamp it via finaliseV5Response.
    // Only surface when the graph actually persisted — a non-persisted
    // draft has no canvas state for the UI to apply readiness against.
    const analysisReady: AnalysisReadyPayload | undefined =
      commitResult.graphPersisted && draftResult.analysisReady
        ? (draftResult.analysisReady as AnalysisReadyPayload)
        : undefined;

    // V5 state-trust: derive freshness WITHOUT a session-store read.
    // Draft is the first-turn brief shape — the dispatcher invariant
    // pinned by route-v2-draft-graph-persistence.test.ts forbids
    // readRecent here.
    //
    // Wire freshness is `none` — the canonical "no successful
    // run_analysis fact" verdict. That's the honest user-facing state:
    // a brand new session has no prior analysis. UI handles `none`
    // exactly the same as it handles "no fact found via lookup", so
    // the wire stays consistent with non-shortcut dispatch paths.
    //
    // A separate telemetry-only event (`first_turn_assumed`) records
    // the operator-facing assumption that we did not read the chain
    // to verify it was empty. Replay scenarios (where a "first-turn"
    // shape lands on a session with prior facts) surface as a divergence
    // between the wire `none` and any later turn's actual `freshness`
    // verdict — operators have a grep target.
    const currentGraphHash = computeAnalysisAffectingGraphHash(
      draftResult.graphOutput as GraphStateIngress | null | undefined,
    );
    const freshness: FreshnessDerivation = {
      freshness: 'none',
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: currentGraphHash,
      computed_at: null,
    };
    emitFreshnessTelemetry(
      freshness,
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        dispatch_path: 'draft_graph',
      },
      {
        prior_fact_count: 0,
        current_turn_fact_count: 0,
      },
    );
    emit(TelemetryEvents.AnalysisFreshnessFirstTurnAssumed, {
      request_id: requestId,
      scenario_id: payload.scenario_id,
      dispatch_path: 'draft_graph',
      reason: 'dispatcher_invariant_forbids_readRecent',
    });

    log.info(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        latency_ms: draftResult.latencyMs,
        graph_persisted: commitResult.graphPersisted,
        analysis_ready_present: analysisReady != null,
        analysis_ready_status: analysisReady?.status ?? null,
      },
      'V5 draft_graph dispatch committed',
    );
    return {
      response,
      commitPerformed: true,
      analysisReady,
      graph: draftResult.graphOutput,
      freshness,
    };
  } catch (err) {
    // Route maps commitPerformed=false → HTTP 500 INTERNAL_ERROR (retryable: true).
    // Client sees the generic retry prompt; the response built below is server-side only.
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        graph_produced: draftResult.graphOutput !== null,
        node_count: draftResult.graphOutput?.nodes?.length ?? 0,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 draft_graph dispatch — commit failed; route returns 500 INTERNAL_ERROR',
    );
    const response = draftResultToOlumiResponse(draftResult, payload, false, requestId);
    return { response, commitPerformed: false, graph: draftResult.graphOutput };
  }
}
