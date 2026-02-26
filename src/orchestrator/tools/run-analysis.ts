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
import type { PLoTClient } from "../plot-client.js";
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
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'Cannot run analysis: no analysis_inputs in context. Define options and constraints first.',
      tool: 'run_analysis',
      recoverable: false,
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
    response = await plotClient.run(payload, requestId);
  } catch (error) {
    if (error instanceof PLoTError || error instanceof PLoTTimeoutError) {
      // Prefer PLoT's retryable override (set from error.v1 envelope) over status-code heuristic
      const orchErr = (error as unknown as Record<string, unknown>)._overriddenOrchestratorError as import("../types.js").OrchestratorError
        ?? error.toOrchestratorError();
      throw Object.assign(error, { orchestratorError: orchErr });
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
