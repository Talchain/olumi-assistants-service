/**
 * run_analysis Tool Handler
 *
 * Calls PLoT /v2/run via PLoTClient.run().
 * Input: context.graph (full graph, not compact) + context.analysis_inputs.
 * Error if analysis_inputs null.
 *
 * Block construction from V2RunResponseEnvelope:
 * - FactBlock (option_comparison): results[].option_label, .win_probability
 * - FactBlock (sensitivity): factor_sensitivity[].label, .elasticity, .direction
 * - FactBlock (robustness): robustness.level, .fragile_edges
 * - FactBlock (constraint): constraint_analysis.joint_probability, .per_constraint[]
 * - ReviewCardBlock: review_cards[] — forward each card as block
 * - Lineage: response_hash (top-level first), meta.seed_used (Number()), meta.n_samples
 *
 * fact_objects present → build FactBlock[] grouped by fact_type; absent → skip entirely.
 * Same for review_cards — do NOT synthesise from other fields.
 *
 * Sets envelope.analysis_response to full response (UI needs it for Results Panel).
 * Do NOT inject full response into LLM context — use AnalysisResponseSummary.
 */

import { log } from "../../utils/telemetry.js";
import type { TypedConversationBlock, ConversationContext, V2RunResponseEnvelope, OrchestratorError } from "../types.js";
import type { PLoTClient, PLoTClientRunOpts } from "../plot-client.js";
import { PLoTError, PLoTTimeoutError } from "../plot-client.js";
import { createFactBlock, createReviewCardBlock } from "../blocks/factory.js";
import { isAnalysisRunnable } from "../analysis-state.js";

/**
 * Build a synthetic V2RunResponseEnvelope for blocked/failed analysis results.
 * Avoids `as unknown as V2RunResponseEnvelope` boundary casts by constructing
 * the minimal shape that satisfies downstream consumers.
 */
function buildSyntheticAnalysisEnvelope(fields: {
  analysis_status: string;
  status_reason?: string;
  retryable: boolean;
  critiques: Array<Record<string, unknown>>;
  request_id: string;
}): V2RunResponseEnvelope {
  return {
    analysis_status: fields.analysis_status,
    status_reason: fields.status_reason,
    retryable: fields.retryable,
    critiques: fields.critiques,
    meta: { request_id: fields.request_id, seed_used: 0, n_samples: 0, response_hash: '' },
    results: [],
  };
}

// ============================================================================
// Types
// ============================================================================

export interface RunAnalysisResult {
  blocks: TypedConversationBlock[];
  analysisResponse: V2RunResponseEnvelope;
  responseHash: string | undefined;
  seedUsed: number | undefined;
  nSamples: number | undefined;
  latencyMs: number;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the run_analysis tool.
 *
 * @param context - Conversation context (must have graph + analysis_inputs)
 * @param plotClient - PLoT HTTP client
 * @param requestId - Request ID for tracing
 * @param turnId - Turn ID for block provenance
 * @returns Blocks + full analysis response
 * @throws OrchestratorError-compatible errors
 */
export async function handleRunAnalysis(
  context: ConversationContext,
  plotClient: PLoTClient,
  requestId: string,
  turnId: string,
  plotOpts?: PLoTClientRunOpts,
): Promise<RunAnalysisResult> {
  // Validate prerequisites
  if (!context.graph) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Cannot run analysis: no graph in context.',
      tool: 'run_analysis',
      recoverable: false,
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  if (!context.analysis_inputs) {
    return buildBlockedAnalysisResult(
      requestId,
      startTimedReason('Options need intervention values before the analysis can run. Tell me what each option changes and I\'ll configure them, or set values directly on the canvas.', 'missing_analysis_inputs'),
    );
  }

  // Option-configuration recovery: check if options have configured interventions.
  // Empty interventions cause PLoT to return degenerate results or fail.
  const unconfigured = context.analysis_inputs.options.filter(
    (opt) => !opt.interventions || Object.keys(opt.interventions).length === 0,
  );
  if (!isAnalysisRunnable(context) || unconfigured.length > 0) {
    const labels = unconfigured.map((o) => o.label || o.option_id).join(', ');
    log.warn(
      { unconfigured_options: labels, turn_id: turnId },
      'run_analysis: options missing intervention values — returning recovery message',
    );
    return buildBlockedAnalysisResult(
      requestId,
      startTimedReason(
        `The analysis can't run yet — ${unconfigured.length === 1 ? `option "${labels}" has` : `options ${labels} have`} no intervention values configured. Each option needs to specify how it changes the model factors. You can set these on the canvas, or describe what each option changes and I'll configure them.`,
        'missing_interventions',
        unconfigured.map((o) => o.label || o.option_id),
      ),
    );
  }

  // Build PLoT payload: only fields in PLoT's allowlist.
  // PLoT has strict unknown-field rejection at the top level — any field
  // not in the allowlist returns 400. Spread would leak disallowed fields.
  const inputs = context.analysis_inputs!;
  const inputsAny = inputs as Record<string, unknown>;

  // Derive goal_node_id: prefer analysis_inputs value, fall back to graph
  let goalNodeId = inputsAny.goal_node_id as string | undefined;
  if (!goalNodeId && context.graph) {
    const goalNode = context.graph.nodes.find((n) => n.kind === 'goal');
    if (goalNode) goalNodeId = goalNode.id;
  }

  // Allowlist-construct each option: id, option_id, label, interventions.
  // Normalize interventions to { factor_id: number } — PLoT expects flat
  // numeric maps. CEE V3 schema uses { factor_id: { value, source, ... } }.
  const plotOptions = inputs.options.map((opt, idx) => {
    const normalizedInterventions = normalizeInterventions(opt.interventions, opt.option_id, idx);
    return {
      id: (opt as unknown as Record<string, unknown>).id ?? opt.option_id,
      option_id: opt.option_id,
      label: opt.label,
      interventions: normalizedInterventions,
    };
  });

  const payload: Record<string, unknown> = {
    graph: context.graph,
    options: plotOptions,
    goal_node_id: goalNodeId,
    request_id: requestId,
    ...(inputs.seed != null && { seed: inputs.seed }),
    ...(inputs.n_samples != null && { n_samples: inputs.n_samples }),
    // PLoT calls this field "goal_constraints", not "constraints"
    ...(inputs.constraints != null && { goal_constraints: inputs.constraints }),
    // Forward optional PLoT fields if present in analysis_inputs
    ...(inputsAny.detail_level != null && { detail_level: inputsAny.detail_level }),
    ...(inputsAny.goal_threshold != null && { goal_threshold: inputsAny.goal_threshold }),
    ...(inputsAny.include_thresholds != null && { include_thresholds: inputsAny.include_thresholds }),
  };

  const startTime = Date.now();

  let response: V2RunResponseEnvelope;
  try {
    response = await plotClient.run(payload, requestId, plotOpts);
  } catch (error) {
    if (error instanceof PLoTError) {
      if (error.v2RunError) {
        // 422 analysis blocked/failed — surface as structured result, not pipeline error
        const v2 = error.v2RunError;
        return {
          blocks: [],
          analysisResponse: buildSyntheticAnalysisEnvelope({
            analysis_status: v2.analysis_status,
            status_reason: v2.status_reason,
            retryable: false,
            critiques: v2.critiques ?? [],
            request_id: error.requestId ?? requestId,
          }),
          responseHash: undefined,
          seedUsed: undefined,
          nSamples: undefined,
          latencyMs: Date.now() - startTime,
        };
      }
      throw Object.assign(error, { orchestratorError: error.toOrchestratorError() });
    }
    if (error instanceof PLoTTimeoutError) {
      throw Object.assign(error, { orchestratorError: error.toOrchestratorError() });
    }
    throw error;
  }

  const latencyMs = Date.now() - startTime;

  // Extract lineage fields per spec:
  // response_hash from top-level first, fall back to meta.response_hash
  const responseHash = response.response_hash ?? response.meta?.response_hash;
  // seed_used arrives as string from PLoT — parse as Number()
  const seedUsed = Number(response.meta?.seed_used);
  const nSamples = response.meta?.n_samples;

  log.info(
    { request_id: requestId, elapsed_ms: latencyMs, response_hash: responseHash, seed_used: seedUsed },
    "run_analysis completed",
  );

  // Build blocks
  const blocks: TypedConversationBlock[] = [];

  // FactBlocks from fact_objects (grouped by fact_type)
  // Only if fact_objects is present and non-empty — do NOT synthesise from other fields
  if (response.fact_objects && Array.isArray(response.fact_objects) && response.fact_objects.length > 0) {
    const grouped = groupByFactType(response.fact_objects);
    for (const [factType, facts] of grouped) {
      blocks.push(createFactBlock(
        { fact_type: factType, facts },
        turnId,
        responseHash,
        seedUsed,
      ));
    }
  }

  // ReviewCardBlocks from review_cards
  // Only if review_cards is present and non-empty — do NOT synthesise
  if (response.review_cards && Array.isArray(response.review_cards) && response.review_cards.length > 0) {
    for (const card of response.review_cards) {
      blocks.push(createReviewCardBlock(card, turnId));
    }
  }

  return {
    blocks,
    analysisResponse: response,
    responseHash,
    seedUsed,
    nSamples,
    latencyMs,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize interventions to PLoT's expected { factor_id: number } map.
 *
 * CEE V3 schema uses { factor_id: { value: number, source: ..., ... } }.
 * Analysis-ready helper produces { factor_id: number } directly.
 * Accept both, extracting the numeric value from either shape.
 *
 * Throws OrchestratorError if any intervention value cannot be resolved
 * to a finite number — this is a hard fail to prevent silent bad data.
 */
function normalizeInterventions(
  raw: Record<string, unknown>,
  optionId: string,
  optionIndex: number,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [factorId, value] of Object.entries(raw)) {
    let numeric: number;

    if (typeof value === 'number') {
      numeric = value;
    } else if (value != null && typeof value === 'object' && 'value' in value) {
      // V3 InterventionV3 shape: { value: number, source: ..., ... }
      const inner = (value as { value: unknown }).value;
      if (typeof inner === 'number') {
        numeric = inner;
      } else {
        throwInterventionError(optionId, optionIndex, factorId, value);
      }
    } else {
      throwInterventionError(optionId, optionIndex, factorId, value);
    }

    if (!Number.isFinite(numeric!)) {
      throwInterventionError(optionId, optionIndex, factorId, value);
    }

    result[factorId] = numeric!;
  }

  return result;
}

function throwInterventionError(
  optionId: string,
  optionIndex: number,
  factorId: string,
  value: unknown,
): never {
  const err: OrchestratorError = {
    code: 'INTERNAL_PAYLOAD_ERROR',
    message: `Cannot normalize intervention for option "${optionId}" (index ${optionIndex}), factor "${factorId}": expected number or { value: number }, got ${JSON.stringify(value)?.slice(0, 100)}`,
    tool: 'run_analysis',
    recoverable: false,
  };
  throw Object.assign(new Error(err.message), { orchestratorError: err });
}

/**
 * Group fact_objects by fact_type.
 * Each FactObjectV1 is expected to have a fact_type string field.
 */
function groupByFactType(factObjects: unknown[]): Map<string, unknown[]> {
  const grouped = new Map<string, unknown[]>();

  for (const fact of factObjects) {
    const factType = (fact as Record<string, unknown>)?.fact_type;
    if (typeof factType !== 'string') continue;

    const existing = grouped.get(factType);
    if (existing) {
      existing.push(fact);
    } else {
      grouped.set(factType, [fact]);
    }
  }

  return grouped;
}

function startTimedReason(
  statusReason: string,
  critiqueCode: string,
  missingLabels: string[] = [],
): {
  statusReason: string;
  critiques: Array<Record<string, unknown>>;
} {
  return {
    statusReason,
    critiques: [
      {
        code: critiqueCode,
        message: statusReason,
        ...(missingLabels.length > 0 ? { labels: missingLabels } : {}),
      },
    ],
  };
}

function buildBlockedAnalysisResult(
  requestId: string,
  blocked: {
    statusReason: string;
    critiques: Array<Record<string, unknown>>;
  },
): RunAnalysisResult {
  return {
    blocks: [],
    analysisResponse: buildSyntheticAnalysisEnvelope({
      analysis_status: 'blocked',
      status_reason: blocked.statusReason,
      retryable: false,
      critiques: blocked.critiques,
      request_id: requestId,
    }),
    responseHash: undefined,
    seedUsed: undefined,
    nSamples: undefined,
    latencyMs: 0,
  };
}
