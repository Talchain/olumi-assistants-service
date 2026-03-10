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
import type { ConversationBlock, ConversationContext, V2RunResponseEnvelope, OrchestratorError } from "../types.js";
import type { PLoTClient, PLoTClientRunOpts } from "../plot-client.js";
import { PLoTError, PLoTTimeoutError } from "../plot-client.js";
import { createFactBlock, createReviewCardBlock } from "../blocks/factory.js";

// ============================================================================
// Types
// ============================================================================

export interface RunAnalysisResult {
  blocks: ConversationBlock[];
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
    // Safety net — prerequisite gate in turn-handler.ts should prevent reaching here.
    // If called directly without analysis_inputs, throw so the caller can handle it.
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Cannot run analysis: no analysis_inputs in context. Options need intervention values — tell me what each option changes and I\'ll configure them, or set values directly on the canvas.',
      tool: 'run_analysis',
      recoverable: true,
      suggested_retry: 'Configure option interventions first, then re-run.',
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  // Option-configuration recovery: check if options have configured interventions.
  // Empty interventions cause PLoT to return degenerate results or fail.
  const unconfigured = context.analysis_inputs.options.filter(
    (opt) => !opt.interventions || Object.keys(opt.interventions).length === 0,
  );
  if (unconfigured.length > 0) {
    const labels = unconfigured.map((o) => o.label || o.option_id).join(', ');
    log.warn(
      { unconfigured_options: labels, turn_id: turnId },
      'run_analysis: options missing intervention values — returning recovery message',
    );
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `The analysis can't run yet — ${unconfigured.length === 1 ? `option "${labels}" has` : `options ${labels} have`} no intervention values configured. Each option needs to specify how it changes the model factors. You can set these on the canvas, or describe what each option changes and I'll configure them.`,
      tool: 'run_analysis',
      recoverable: true,
      suggested_retry: 'Configure option interventions, then ask to run the analysis again.',
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  // Build PLoT payload: full graph + analysis_inputs
  const payload: Record<string, unknown> = {
    graph: context.graph,
    ...context.analysis_inputs,
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
          analysisResponse: {
            analysis_status: v2.analysis_status,
            status_reason: v2.status_reason,
            retryable: false,
            critiques: v2.critiques ?? [],
            meta: { request_id: error.requestId ?? requestId, seed_used: 0, n_samples: 0, response_hash: '' },
            results: [],
          } as unknown as V2RunResponseEnvelope,
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
  const responseHash = response.response_hash ?? response.meta.response_hash;
  // seed_used arrives as string from PLoT — parse as Number()
  const seedUsed = Number(response.meta.seed_used);
  const nSamples = response.meta.n_samples;

  log.info(
    { request_id: requestId, elapsed_ms: latencyMs, response_hash: responseHash, seed_used: seedUsed },
    "run_analysis completed",
  );

  // Build blocks
  const blocks: ConversationBlock[] = [];

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
