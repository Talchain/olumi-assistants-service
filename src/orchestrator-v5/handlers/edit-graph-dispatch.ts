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

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import { handleEditGraph, type EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import { classifyAddRiskIntent } from './edit-templates/classify-add-risk.js';
import { buildAddRiskClarification } from './edit-templates/add-risk-template.js';
import { wouldExceedAddRiskLimits } from '../../orchestrator/graph-structure-validator.js';
import { commitDirectAnswer, computeRequestHash } from '../commit.js';
import { getAdapter } from '../../adapters/llm/router.js';
import type {
  ConversationContext,
  DecisionStage,
  GraphPatchBlockData,
  GraphV3T,
  PendingClarificationState,
  SuggestedAction,
  V2RunResponseEnvelope,
} from '../../orchestrator/types.js';
import { GraphV3 } from '../../schemas/cee-v3.js';
import type { AnalysisStateIngress, GraphStateIngress } from '../boundary/request-extensions.js';
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import { buildTurnContext } from '../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import {
  deriveAnalysisFreshness,
  emitFreshnessTelemetry,
  type FreshnessDerivation,
} from '../context/freshness.js';

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
  /**
   * V5 finaliser contract: pre-computed structural readiness from the
   * post-edit `appliedGraph`. Surfaced so the response-finaliser in
   * route-v2.ts can stamp `analysis_ready` after composition. Undefined
   * when there is no `appliedGraph` — the canvas is unchanged so the UI's
   * prior `ceeAnalysisReady` remains correct.
   */
  readonly analysisReady?: AnalysisReadyPayload;
  /**
   * V5 state-trust freshness derivation. Edit_graph mutates the graph
   * but does not produce a run_analysis fact, so post-edit freshness is
   * determined by comparing the prior fact chain's recorded
   * graph_hash_at_run against the post-edit graph hash. Expected to be
   * `stale` after an accepted substantive edit, `fresh`/`unknown`/`none`
   * otherwise. Surfaced on `analysis_ready` via response-finaliser.
   */
  readonly freshness?: import('../context/freshness.js').FreshnessDerivation;
  /**
   * Post-edit graph used for label resolution by the central egress
   * sanitiser (sanitiseOlumiResponseForEgress). Null when no graph was
   * applied — sanitiser falls back to prefix-aware generic wording.
   */
  readonly graph: GraphV3T | null;
}

/**
 * Map the V4 internal `SuggestedAction` shape (`{ label, prompt, role,
 * action_type? }`) to the boundary `Action` shape (`{ id, label, message,
 * action_type? }`). The boundary `action_type` enum is closed to v0.7.0
 * V5ActionType values, so internal action_types that don't fit are dropped
 * (the resulting chip still works as a prompt-replay button via `message`).
 */
const BOUNDARY_ACTION_TYPES: ReadonlySet<string> = new Set([
  'run_analysis',
  'set_factor_value',
  'add_constraint',
  'adjust_edge_strength',
  'explain_result',
  'compare_options',
  'what_would_flip',
]);

type BoundaryAction = OlumiResponse['suggested_actions'][number];

function mapSuggestedActionToBoundary(
  action: SuggestedAction,
  index: number,
): BoundaryAction {
  const base: BoundaryAction = {
    id: `edit_graph_action_${index}`,
    label: action.label,
    message: action.prompt,
  };
  if (action.action_type && BOUNDARY_ACTION_TYPES.has(action.action_type)) {
    base.action_type = action.action_type as BoundaryAction['action_type'];
  }
  return base;
}

function chipsFromPendingClarification(
  pending: PendingClarificationState,
): SuggestedAction[] {
  return pending.candidate_labels.map((label) => ({
    label,
    prompt: `Update ${label}.`,
    role: 'facilitator' as const,
  }));
}

// NOTE — pendingProposal accept/cancel chips intentionally NOT rendered.
//
// The V4 `handleEditGraph` reads `invocationInput.pending_proposal`
// (edit-graph.ts around line 1274) to deterministically apply a stored
// proposal on the next turn. The V5 pre-Sonnet dispatcher, however, does
// NOT currently:
//   (a) persist `pendingProposal` to session storage,
//   (b) read it back on the next turn,
//   (c) thread it via `handleEditGraph(..., { invocationInput: { ... } })`.
//
// Without (a)+(b)+(c), an "Apply this change" chip would replay as a plain
// user prompt that the LLM has to re-resolve — not a byte-for-byte replay
// of the original proposal. Presenting non-deterministic accept/cancel
// chips is worse UX than no chips at all (the user expects clicking
// "Apply" to apply exactly the shown proposal).
//
// Until the deterministic-replay plumbing is wired (separate brief), the
// composer simply does not surface pending-proposal chips. The V4
// `assistant_text` still describes the proposal and the user can confirm
// in natural language.

/**
 * Build wire-shaped `suggested_actions` from `EditGraphResult`.
 *
 * Sources merged (not exclusive precedence) and deduped by `message`:
 *   1. `result.suggestedActions` — explicit chips from edit-graph.ts
 *      (clarification chips from `buildClarificationActions`, "Try a
 *      simpler change" / "Start fresh" recovery chips, "Re-run analysis"
 *      rerun_recommended chip).
 *   2. `result.pendingClarification` candidate-label chips — defensively
 *      included so a result that carries pendingClarification without
 *      explicit actions still surfaces chips.
 *
 * `pendingProposal` accept/cancel chips are intentionally NOT rendered —
 * see comment on `chipsFromPendingProposal` removal.
 *
 * First occurrence wins on dedupe, so explicit `suggestedActions` take
 * priority over pending-state-derived chips when prompts collide.
 */
function buildBoundarySuggestedActions(
  result: EditGraphResult,
): BoundaryAction[] {
  const collected: SuggestedAction[] = [];

  if (result.suggestedActions && result.suggestedActions.length > 0) {
    collected.push(...result.suggestedActions);
  }
  if (result.pendingClarification) {
    collected.push(...chipsFromPendingClarification(result.pendingClarification));
  }

  // Dedupe by message.
  const seen = new Set<string>();
  const unique: SuggestedAction[] = [];
  for (const action of collected) {
    if (seen.has(action.prompt)) continue;
    seen.add(action.prompt);
    unique.push(action);
  }

  return unique.map((a, i) => mapSuggestedActionToBoundary(a, i));
}

/**
 * Surface rejection metadata on the wire as a boundary `error` block.
 *
 * The internal V4 `GraphPatchBlock` uses `data.status: 'rejected'` with
 * rejection.code/reason/attempts. The boundary `graph_patch` block schema
 * has no rejected status (only `'applied' | 'noop'`) and a narrow
 * `operation` enum, so V4 rejection blocks cannot pass through unmodified.
 *
 * Mapping rejection → `error` block (with `details` carrying the rejection
 * code AND the specific structural violation codes) preserves the
 * rejection signal without widening the boundary schema. The UI can read
 * `details.rejection_code` and `details.violation_codes` to render a
 * specific recovery affordance.
 *
 * Two rejection-emit paths exist in the V4 handler:
 *   1. `buildRejectionResult` (final-attempt repair exhaustion / max-ops /
 *      budget) → returns `result.blocks: [GraphPatchBlock with rejection]`.
 *   2. Structural-violation immediate reject for structural intents
 *      (edit-graph.ts:1950) → returns `result.blocks: []`. Violation codes
 *      live on `result.diagnostics.validation_violation_codes` and the
 *      umbrella code on `result.diagnostics.failure_code`.
 *
 * Both paths are handled here so a structural-validation rejection (e.g.
 * the new OPTION_NO_FACTOR_EDGES code) reaches the wire even when the V4
 * block is absent.
 *
 * Successful (non-rejected) edits return `[]` — the V4 GraphPatchBlock
 * with `operations: PatchOperation[]` does not fit the narrow boundary
 * `graph_patch` operation enum, and the applied graph reaches the UI via
 * `analysis_ready` + the persisted scenarios.graph row.
 *
 * COMPATIBILITY NOTE on `error_code: 'INTERNAL_ERROR'` (P0 fix, 2026-05):
 * `BoundaryErrorCode` is a closed enum (olumi-schemas/src/boundary/
 * error-codes.ts; "extend additively, do not rename") with no recoverable-
 * rejection member, so we ship `INTERNAL_ERROR` + `severity: 'warn'` as a
 * documented short-term combination. The severity-aware UI router treats
 * the warn-level block as advisory and renders the friendly assistant_text
 * + chips. Operators read `details.rejection_code` for the specific cause.
 *
 * TODO(schemas): additive bump to introduce `RECOVERABLE_EDIT_REJECTION`
 * (or equivalent) so the wire signal is self-describing without relying
 * on severity-aware parsing. Tracked separately; coordinate with UI.
 */
function buildBoundaryBlocks(result: EditGraphResult): OlumiResponse['blocks'] {
  if (!result.wasRejected) return [];

  // Path 1: V4 GraphPatchBlock with rejection metadata (from buildRejectionResult).
  const rejectionBlock = result.blocks.find(
    (b) => b.block_type === 'graph_patch'
      && (b.data as GraphPatchBlockData).status === 'rejected',
  );

  if (rejectionBlock) {
    const data = rejectionBlock.data as GraphPatchBlockData;
    const rej = data.rejection;
    if (rej) {
      // Stable codes only on the wire. Raw validator detail (rej.reason
      // text, failure messages, free-form descriptions) stays in server
      // logs and never crosses the boundary. The UI renders specific
      // recovery affordances from the codes, not the text.
      const details: Record<string, unknown> = { source: 'edit_graph' };
      if (rej.code) details.rejection_code = rej.code;
      if (rej.plot_code) details.plot_code = rej.plot_code;
      if (rej.attempts != null) details.attempts = rej.attempts;
      // Promote diagnostics violation_codes when present so OPTION_NO_FACTOR_EDGES
      // and similar specific codes reach the wire alongside the umbrella rejection_code.
      const violationCodes = result.diagnostics?.validation_violation_codes;
      if (violationCodes && violationCodes.length > 0) {
        details.violation_codes = violationCodes;
      }
      return [
        {
          type: 'error',
          error_code: 'INTERNAL_ERROR',
          severity: 'warn',
          details,
        },
      ];
    }
  }

  // Path 2: structural-violation immediate reject — V4 returns blocks: [] but
  // surfaces the failure on diagnostics. Synthesize an error block so the
  // wire still carries rejection_code + violation_codes (e.g. for the
  // OPTION_NO_FACTOR_EDGES rule).
  //
  // Stable codes only — `failure_message` may contain raw validator output
  // ("Option opt_x has no outbound edge to a factor — cannot be analysed")
  // which we do NOT want on the wire. Logs retain it via diagnostics; the
  // wire surface is just `rejection_code` + `failure_branch` + optional
  // `violation_codes`.
  const diag = result.diagnostics;
  if (diag?.failure_code || (diag?.validation_violation_codes && diag.validation_violation_codes.length > 0)) {
    const details: Record<string, unknown> = { source: 'edit_graph' };
    if (diag.failure_code) details.rejection_code = diag.failure_code;
    if (diag.failure_branch) details.failure_branch = diag.failure_branch;
    if (diag.validation_violation_codes && diag.validation_violation_codes.length > 0) {
      details.violation_codes = diag.validation_violation_codes;
    }
    return [
      {
        type: 'error',
        error_code: 'INTERNAL_ERROR',
        severity: 'warn',
        details,
      },
    ];
  }

  return [];
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

  // V5 finaliser contract: this composer must NOT set `analysis_ready`. The
  // dispatcher computes structural readiness from `editResult.appliedGraph`
  // and surfaces it on `DispatchEditGraphResult.analysisReady`; the
  // response-finaliser stamps it onto the wire envelope after composition.
  return {
    response_version: 2,
    assistant_text: result.assistantText ?? fallback,
    blocks: buildBoundaryBlocks(result),
    suggested_actions: buildBoundarySuggestedActions(result),
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
/**
 * V5 A4 Commit 6 — strict parse signal for the deterministic classifier
 * gate. Callers that need to know whether the returned graph is the
 * canonical strict-parsed form vs the structural fallback (with inert
 * default edge fields) can use `graphStateToGraphV3WithParseResult`.
 * The deterministic add_risk clarification path runs only against strictly
 * parsed graphs so non-canonical ingress keeps the pre-existing LLM path.
 */
function graphStateToGraphV3WithParseResult(
  graphState: GraphStateIngress,
  requestId: string,
): { graph: GraphV3T; strict: boolean } {
  const parsed = GraphV3.safeParse(graphState);
  if (parsed.success) {
    return { graph: parsed.data, strict: true };
  }
  return { graph: buildStructuralFallback(graphState, requestId, parsed.error), strict: false };
}
function buildStructuralFallback(
  graphState: GraphStateIngress,
  requestId: string,
  error: import('zod').ZodError,
): GraphV3T {
  log.warn(
    {
      request_id: requestId,
      issue_count: error.issues.length,
      first_issue_path: error.issues[0]?.path.join('.') ?? null,
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

  const { graph: parsedGraph, strict: graphStrictlyCanonical } =
    graphStateToGraphV3WithParseResult(graphState, requestId);
  const context: ConversationContext = {
    graph: parsedGraph,
    analysis_response: analysisState ? analysisIngressToV2Envelope(analysisState) : null,
    framing: { stage: mapStageToDecisionStage(payload.stage) },
    messages: [{ role: 'user', content: payload.message }],
    scenario_id: payload.scenario_id,
  };

  const adapter = getAdapter('edit_graph');

  let editResult: EditGraphResult;
  // Track the deterministic clarification path independently so
  // llm_calls_used records 0 when no adapter call was made.
  let deterministicAddRiskAttempted = false;
  try {
    // V5 A4 — deterministic clarification intercept. Pre-LLM classifier
    // catches high-confidence bare "add X as a risk" patterns, but the
    // request does not state what drives the risk. Creating a risk node
    // would require inventing graph structure, so this path asks for the
    // missing driver and intentionally leaves the graph unchanged.
    // The deterministic classifier MUST NOT run against a structural
    // fallback graph. When the ingress did not pass strict GraphV3 parse,
    // fall through to the LLM path unconditionally (handleEditGraph re-casts
    // internally and is the pre-existing behaviour for non-canonical ingress).
    const classified = graphStrictlyCanonical
      ? classifyAddRiskIntent(payload.message, parsedGraph)
      : ({ intent: 'llm_required' } as const);

    if (classified.intent === 'add_risk') {
      deterministicAddRiskAttempted = true;
      // Pre-LLM preflight: would adding this risk push the model past
      // its analysis limits? If so, return a structured rejection now
      // and skip the LLM. The LLM call would otherwise spend 16–18s
      // before the post-mutation validator rejected with the same
      // limit code. Specific recovery copy + executable chips give the
      // user a real next step instead of generic failure copy.
      const preflight = wouldExceedAddRiskLimits(parsedGraph);
      if (preflight.over_node_limit || preflight.over_edge_limit) {
        const rejectionCode = preflight.over_edge_limit
          ? 'EDGE_LIMIT_EXCEEDED_PREFLIGHT'
          : 'NODE_LIMIT_EXCEEDED_PREFLIGHT';
        emit(TelemetryEvents.EditGraphPreflightSkippedLlm, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          reason: preflight.over_edge_limit ? 'edge_limit' : 'node_limit',
          projected_nodes: preflight.projected_nodes,
          projected_edges: preflight.projected_edges,
          node_limit: preflight.node_limit,
          edge_limit: preflight.edge_limit,
          label_length: classified.label.length,
        });
        editResult = {
          blocks: [],
          assistantText:
            "I can't add another risk without making the model too complex to analyse reliably. " +
            'I can rebuild it from your updated brief, or you can tell me which existing risk this should replace.',
          latencyMs: Date.now() - startedAt,
          appliedGraph: null,
          wasRejected: true,
          diagnostics: {
            classified_intent: 'structural',
            instruction_mode_applied: 'structural_default',
            edit_instruction_preview: classified.label.slice(0, 80),
            graph_context_node_count: preflight.current_nodes,
            graph_context_edge_count: preflight.current_edges,
            operations_proposed_count: 0,
            operations_proposed_types: [],
            validation_outcome: 'preflight_rejected',
            validation_violation_codes: [
              preflight.over_edge_limit ? 'EDGE_LIMIT_EXCEEDED' : 'NODE_LIMIT_EXCEEDED',
            ],
            recovery_path_chosen: 'preflight_rejection',
            conversational_state_summary: null,
            target_resolution: null,
            resolution_mode: null,
            proposal_returned: false,
            branch_taken: 'rejection',
            branch_reason: 'add_risk_preflight_limit_exceeded',
            failure_branch: 'preflight',
            failure_code: rejectionCode,
            failure_message: preflight.over_edge_limit
              ? `Adding the risk would project ${preflight.projected_edges} edges (limit ${preflight.edge_limit}).`
              : `Adding the risk would project ${preflight.projected_nodes} nodes (limit ${preflight.node_limit}).`,
          },
          // Executable chips only. "Rebuild from updated brief" routes
          // through the existing draft-graph path. The replace-risk
          // option opens a focused clarification the LLM can resolve
          // on the next turn.
          suggestedActions: [
            {
              label: 'Rebuild from updated brief',
              prompt: 'I want to rewrite the brief and rebuild the model from scratch.',
              role: 'facilitator' as const,
            },
            {
              label: 'Replace an existing risk',
              prompt: `Which existing risk should I replace with '${classified.label}'?`,
              role: 'facilitator' as const,
            },
          ],
        };
        log.info(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            latency_ms: editResult.latencyMs,
            reason: rejectionCode,
            projected_nodes: preflight.projected_nodes,
            projected_edges: preflight.projected_edges,
          },
          'V5 edit_graph add_risk preflight blocked LLM call (limit would be exceeded)',
        );
      } else {
        editResult = {
          blocks: [],
          assistantText: buildAddRiskClarification(classified.label),
          latencyMs: Date.now() - startedAt,
          appliedGraph: null,
          wasRejected: false,
        };
        log.info(
          {
            request_id: requestId,
            scenario_id: payload.scenario_id,
            latency_ms: editResult.latencyMs,
          },
          'V5 edit_graph add_risk clarification returned without graph mutation',
        );
        emit(TelemetryEvents.V5EditGraphAddRiskClarified, {
          request_id: requestId,
          scenario_id: payload.scenario_id,
          latency_ms: editResult.latencyMs,
          label_length: classified.label.length,
        });
      }
    } else {
      editResult = await handleEditGraph(
        context,
        payload.message,
        adapter,
        requestId,
        payload.turn_id,
      );
    }
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

  // V5 finaliser contract: compute structural readiness from the post-edit
  // graph here so route-v2.ts can stamp it onto the wire envelope.
  // computeStructuralReadiness is intervention-shape-tolerant
  // (mergeInterventionSources handles the V3 shape that the UI legacy
  // fallback could not read). Undefined when no graph was applied — the
  // canvas is unchanged so the UI's prior store value remains correct.
  const analysisReady: AnalysisReadyPayload | undefined = editResult.appliedGraph
    ? computeStructuralReadiness(editResult.appliedGraph)
    : undefined;

  // V5 state-trust: load the prior fact chain and derive freshness against
  // the POST-edit graph hash. Expected behaviour: an accepted substantive
  // edit produces freshness === 'stale' because the graph hash recorded
  // on the prior run_analysis fact diverges from the new graph hash.
  // Rejected edits produce 'fresh' (graph unchanged).
  //
  // On failure: fall back to a synthetic `unknown / derivation_failed`
  // verdict rather than dropping the freshness fields. This honours the
  // brief's "every CEE dispatch path emits freshness" contract and
  // surfaces the failure as observable wire data rather than silent
  // absence.
  let freshness: FreshnessDerivation;
  try {
    const turnContext = await buildTurnContext(payload, requestId);
    const postEditGraph = editResult.appliedGraph ?? graphState;
    const currentGraphHash = computeAnalysisAffectingGraphHash(
      postEditGraph as GraphStateIngress | null | undefined,
    );
    freshness = deriveAnalysisFreshness(turnContext.prior_facts, currentGraphHash);
    emitFreshnessTelemetry(
      freshness,
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        dispatch_path: 'edit_graph',
      },
      {
        prior_fact_count: turnContext.prior_facts.length,
        current_turn_fact_count: 0,
        edit_was_rejected: editResult.wasRejected,
      },
    );
  } catch (err) {
    log.warn(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 edit_graph dispatch — freshness derivation failed; emitting derivation_failed verdict',
    );
    const postEditGraph = editResult.appliedGraph ?? graphState;
    let currentGraphHash: string | null = null;
    try {
      currentGraphHash = computeAnalysisAffectingGraphHash(
        postEditGraph as GraphStateIngress | null | undefined,
      );
    } catch {
      // Hash computation failure is rare (input validation upstream)
      // but if it does happen we still synthesise the verdict.
    }
    freshness = {
      freshness: 'unknown',
      reason: 'derivation_failed',
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
        dispatch_path: 'edit_graph',
      },
      {
        prior_fact_count: 0,
        current_turn_fact_count: 0,
        edit_was_rejected: editResult.wasRejected,
        derivation_error: err instanceof Error ? err.message : String(err),
      },
    );
  }

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
      // Deterministic clarification path makes zero LLM calls; LLM path
      // makes at least one (handleEditGraph drives the classification +
      // repair loop). Distinguish so dashboards can attribute cost honestly.
      llm_calls_used: deterministicAddRiskAttempted ? 0 : 1,
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
    return {
      response,
      commitPerformed: true,
      analysisReady,
      graph: editResult.appliedGraph ?? null,
      freshness,
    };
  } catch (err) {
    log.error(
      {
        request_id: requestId,
        scenario_id: payload.scenario_id,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'V5 edit_graph dispatch — commit failed',
    );
    return {
      response,
      commitPerformed: false,
      analysisReady,
      graph: editResult.appliedGraph ?? null,
      freshness,
    };
  }
}
