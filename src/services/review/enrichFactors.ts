/**
 * Enrich Factors Service
 *
 * Generates factor-level validation guidance grounded in ISL sensitivity analysis.
 * Key principle: Output observations and perspectives, not instructions.
 *
 * @module services/review/enrichFactors
 */

import { log } from "../../utils/telemetry.js";
import { callLLMForExtraction } from "../../adapters/llm/extraction.js";
import {
  ENRICH_FACTORS_PROMPT,
  FACTOR_TYPE_GUIDANCE,
  MAX_ENRICHMENT_RANK,
  CONFIDENCE_QUESTION_MAX_RANK,
} from "../../prompts/enrich-factors.js";
import {
  EnrichFactorsInput,
  EnrichFactorsOutput,
  validateConfidenceQuestionRank,
  filterByRank,
  type EnrichFactorsInputT,
  type FactorEnrichmentT,
} from "../../schemas/enrichment.js";
import { FactorType, type GraphT, type NodeT, type FactorTypeT } from "../../schemas/graph.js";
import type { FactorSensitivityInputT } from "../../schemas/enrichment.js";

// =============================================================================
// Types
// =============================================================================

export interface EnrichFactorsOptions {
  /** Request ID for telemetry */
  requestId?: string;
  /** Maximum rank to include (default: 10) */
  maxRank?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

export interface EnrichFactorsResult {
  /** Factor enrichments */
  enrichments: FactorEnrichmentT[];
  /** Whether enrichment succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Warnings (e.g., filtered factors, validation issues) */
  warnings: string[];
  /** Token usage */
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// =============================================================================
// Graph Extraction Helpers
// =============================================================================

/**
 * Extract goal label from graph
 */
export function extractGoalLabel(graph: GraphT): string | undefined {
  const goalNode = graph.nodes.find((n: NodeT) => n.kind === "goal");
  return goalNode?.label;
}

/**
 * Extract outcome labels from graph
 */
export function extractOutcomeLabels(graph: GraphT): string[] {
  return graph.nodes
    .filter((n: NodeT) => n.kind === "outcome")
    .map((n: NodeT) => n.label)
    .filter((label): label is string => Boolean(label));
}

/**
 * Extract risk labels from graph
 */
export function extractRiskLabels(graph: GraphT): string[] {
  return graph.nodes
    .filter((n: NodeT) => n.kind === "risk")
    .map((n: NodeT) => n.label)
    .filter((label): label is string => Boolean(label));
}

/**
 * Extract controllable factors from graph.
 * A factor is controllable if it has an incoming edge from an option node.
 */
export function extractControllableFactors(graph: GraphT): Array<{
  factor_id: string;
  label: string;
  factor_type?: FactorTypeT;
  uncertainty_drivers?: string[];
}> {
  // Find option node IDs
  const optionIds = new Set(
    graph.nodes.filter((n: NodeT) => n.kind === "option").map((n: NodeT) => n.id)
  );

  // Find factor IDs that receive edges from options
  const controllableFactorIds = new Set<string>();
  for (const edge of graph.edges) {
    if (optionIds.has(edge.from)) {
      controllableFactorIds.add(edge.to);
    }
  }

  // Extract factor nodes that are controllable
  return graph.nodes
    .filter((n: NodeT) => n.kind === "factor" && controllableFactorIds.has(n.id))
    .map((n: NodeT) => {
      const data = n.data as {
        factor_type?: string;
        uncertainty_drivers?: string[];
      } | undefined;

      // Validate factor_type against enum
      let factorType: FactorTypeT | undefined;
      if (data?.factor_type) {
        const parsed = FactorType.safeParse(data.factor_type);
        factorType = parsed.success ? parsed.data : undefined;
      }

      return {
        factor_id: n.id,
        label: n.label || n.id,
        factor_type: factorType,
        uncertainty_drivers: data?.uncertainty_drivers,
      };
    });
}

// =============================================================================
// Numeric Formatting
// =============================================================================

/**
 * Format elasticity value to 2 decimal places.
 * Returns null for NaN, undefined, null, or non-finite values.
 */
export function formatElasticity(value: number | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  return value.toFixed(2);
}

// =============================================================================
// Input Building
// =============================================================================

/**
 * Drop reason counts for filtered sensitivity data
 */
export interface DroppedReasonCounts {
  id_mismatch: number;
  rank_exceeded: number;
  invalid_elasticity: number;
}

/**
 * Filter factor_sensitivity to only include valid factors.
 * Filters out:
 * - Factors not in controllable factors set
 * - Factors with invalid elasticity (NaN, Infinity, null, undefined)
 * - Factors with rank > maxRank
 *
 * Returns filtered list, dropped IDs, and breakdown by reason.
 */
export function filterMismatchedSensitivity(
  factorSensitivity: FactorSensitivityInputT[],
  controllableFactorIds: Set<string>,
  maxRank: number = MAX_ENRICHMENT_RANK
): {
  valid: FactorSensitivityInputT[];
  dropped: string[];
  reasonCounts: DroppedReasonCounts;
} {
  const valid: FactorSensitivityInputT[] = [];
  const dropped: string[] = [];
  const reasonCounts: DroppedReasonCounts = {
    id_mismatch: 0,
    rank_exceeded: 0,
    invalid_elasticity: 0,
  };

  for (const sensitivity of factorSensitivity) {
    // Check ID match
    if (!controllableFactorIds.has(sensitivity.factor_id)) {
      dropped.push(sensitivity.factor_id);
      reasonCounts.id_mismatch++;
      continue;
    }

    // Check rank within maxRank
    if (sensitivity.rank > maxRank) {
      dropped.push(sensitivity.factor_id);
      reasonCounts.rank_exceeded++;
      continue;
    }

    // Format elasticity to 2 decimal places, skip if invalid
    const formatted = formatElasticity(sensitivity.elasticity);
    if (formatted === null) {
      dropped.push(sensitivity.factor_id);
      reasonCounts.invalid_elasticity++;
      continue;
    }

    valid.push({
      ...sensitivity,
      elasticity: parseFloat(formatted),
    });
  }

  return { valid, dropped, reasonCounts };
}

/**
 * Build the input for the enrich_factors prompt from graph and ISL sensitivity data.
 */
export function buildEnrichFactorsInput(
  graph: GraphT,
  factorSensitivity: FactorSensitivityInputT[]
): EnrichFactorsInputT {
  const goalLabel = extractGoalLabel(graph);
  if (!goalLabel) {
    throw new Error("Graph must have a goal node with a label");
  }

  const outcomeLabels = extractOutcomeLabels(graph);
  const riskLabels = extractRiskLabels(graph);
  const controllableFactors = extractControllableFactors(graph);

  return {
    goal_label: goalLabel,
    outcome_labels: outcomeLabels,
    risk_labels: riskLabels.length > 0 ? riskLabels : undefined,
    controllable_factors: controllableFactors,
    factor_sensitivity: factorSensitivity,
  };
}

/**
 * Build the user prompt with input data.
 */
function buildUserPrompt(input: EnrichFactorsInputT): string {
  return `Generate factor enrichments for the following decision model:

INPUT:
${JSON.stringify(input, null, 2)}

Output ONLY valid JSON with the enrichments array.`;
}

// =============================================================================
// Response Validation
// =============================================================================

/**
 * Validate and clean LLM response.
 * - Removes confidence_question from factors with rank > 3
 * - Filters out factors with rank > maxRank
 * - Validates observation/perspective counts
 */
function validateAndCleanResponse(
  response: unknown,
  maxRank: number
): {
  enrichments: FactorEnrichmentT[];
  warnings: string[];
} {
  const warnings: string[] = [];

  // Parse response
  const parseResult = EnrichFactorsOutput.safeParse(response);
  if (!parseResult.success) {
    throw new Error(`Invalid LLM response: ${parseResult.error.message}`);
  }

  let enrichments = parseResult.data.enrichments;

  // Validate confidence_question rank constraint
  const confidenceValidation = validateConfidenceQuestionRank(enrichments);
  if (!confidenceValidation.valid) {
    warnings.push(...confidenceValidation.violations);
    // Remove confidence_question from violating factors
    enrichments = enrichments.map((e) => {
      if (e.confidence_question && e.sensitivity_rank > CONFIDENCE_QUESTION_MAX_RANK) {
        const { confidence_question: _, ...rest } = e;
        return rest;
      }
      return e;
    });
  }

  // Filter by rank
  const beforeFilter = enrichments.length;
  enrichments = filterByRank(enrichments, maxRank);
  if (enrichments.length < beforeFilter) {
    warnings.push(
      `Filtered ${beforeFilter - enrichments.length} factors with rank > ${maxRank}`
    );
  }

  // Validate observation/perspective counts
  for (const enrichment of enrichments) {
    if (enrichment.observations.length > 2) {
      warnings.push(
        `Factor ${enrichment.factor_id} has ${enrichment.observations.length} observations (max 2)`
      );
    }
    if (enrichment.perspectives.length > 2) {
      warnings.push(
        `Factor ${enrichment.factor_id} has ${enrichment.perspectives.length} perspectives (max 2)`
      );
    }
  }

  return { enrichments, warnings };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Enrich factors with validation guidance.
 *
 * @param graph - Decision graph with factor metadata
 * @param factorSensitivity - ISL sensitivity analysis results
 * @param options - Enrichment options
 * @returns Factor enrichments with observations and perspectives
 */
export async function enrichFactors(
  graph: GraphT,
  factorSensitivity: FactorSensitivityInputT[],
  options: EnrichFactorsOptions = {}
): Promise<EnrichFactorsResult> {
  const { requestId, maxRank = MAX_ENRICHMENT_RANK, timeoutMs = 30000 } = options;

  const startTime = Date.now();
  const warnings: string[] = [];

  log.info(
    {
      event: "cee.enrich_factors.start",
      requestId,
      factorCount: factorSensitivity.length,
    },
    "Starting factor enrichment"
  );

  try {
    // Extract controllable factors to validate sensitivity IDs
    const controllableFactors = extractControllableFactors(graph);
    const controllableFactorIds = new Set(controllableFactors.map(f => f.factor_id));

    // Filter sensitivity entries: ID mismatch, invalid elasticity, or rank > maxRank
    const { valid: validSensitivity, dropped: droppedIds, reasonCounts } = filterMismatchedSensitivity(
      factorSensitivity,
      controllableFactorIds,
      maxRank
    );

    if (droppedIds.length > 0) {
      log.warn(
        {
          event: "cee.enrich_factors.filtered",
          requestId,
          droppedFactorIds: droppedIds,
          dropped_reason_counts: reasonCounts,
          controllableFactorIds: Array.from(controllableFactorIds),
          sensitivityCount: factorSensitivity.length,
          validCount: validSensitivity.length,
          maxRank,
          task_version: "v1",
        },
        `Dropped ${droppedIds.length} factor(s) (mismatched ID, invalid elasticity, or rank > ${maxRank})`
      );
      warnings.push(
        `Dropped ${droppedIds.length} factor sensitivity entries: ${droppedIds.join(", ")}`
      );
    }

    // Early return if no valid sensitivity data remains
    if (validSensitivity.length === 0) {
      const durationMs = Date.now() - startTime;
      log.info(
        {
          event: "cee.enrich_factors.empty_sensitivity",
          requestId,
          durationMs,
        },
        "No valid sensitivity data after filtering, returning empty enrichments"
      );
      warnings.push("No valid factor sensitivity data to enrich");
      return {
        enrichments: [],
        success: true,
        warnings,
      };
    }

    // Build input with filtered sensitivity
    const input = buildEnrichFactorsInput(graph, validSensitivity);

    // Validate input
    const inputValidation = EnrichFactorsInput.safeParse(input);
    if (!inputValidation.success) {
      return {
        enrichments: [],
        success: false,
        error: `Invalid input: ${inputValidation.error.message}`,
        warnings,
      };
    }

    // Build prompts
    const systemPrompt = ENRICH_FACTORS_PROMPT;
    const userPrompt = buildUserPrompt(input);

    // Call LLM
    const llmResult = await callLLMForExtraction(systemPrompt, userPrompt, {
      requestId,
      timeoutMs,
      maxTokens: 4000,
      temperature: 0,
    });

    if (!llmResult.success || !llmResult.response) {
      return {
        enrichments: [],
        success: false,
        error: llmResult.error || "LLM call failed",
        warnings,
        usage: llmResult.usage,
      };
    }

    // Validate and clean response
    const { enrichments, warnings: responseWarnings } = validateAndCleanResponse(
      llmResult.response,
      maxRank
    );

    // Merge all warnings
    const allWarnings = [...warnings, ...responseWarnings];

    const durationMs = Date.now() - startTime;

    log.info(
      {
        event: "cee.enrich_factors.complete",
        requestId,
        enrichmentCount: enrichments.length,
        warningCount: allWarnings.length,
        durationMs,
      },
      "Factor enrichment complete"
    );

    return {
      enrichments,
      success: true,
      warnings: allWarnings,
      usage: llmResult.usage,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    log.error(
      {
        event: "cee.enrich_factors.error",
        requestId,
        error: message,
        durationMs,
      },
      "Factor enrichment failed"
    );

    return {
      enrichments: [],
      success: false,
      error: message,
      warnings,
    };
  }
}

// =============================================================================
// Exports
// =============================================================================

export { FACTOR_TYPE_GUIDANCE };
