/**
 * Enrichment schemas for factor-level validation guidance
 *
 * Used by enrich_factors prompt in the Review phase of M1 Orchestrator.
 * Generates factor-level observations and perspectives grounded in ISL sensitivity analysis.
 *
 * @module schemas/enrichment
 */

import { z } from "zod";
import { FactorType } from "./graph.js";

// =============================================================================
// Input Schemas
// =============================================================================

/**
 * Factor sensitivity data from ISL analysis
 */
export const FactorSensitivityInput = z.object({
  /** Factor node ID */
  factor_id: z.string().min(1),
  /** Elasticity - relative influence magnitude (higher = more impact) */
  elasticity: z.number(),
  /** Sensitivity rank (1 = most sensitive, ascending) */
  rank: z.number().int().min(1),
});

export type FactorSensitivityInputT = z.infer<typeof FactorSensitivityInput>;

/**
 * Controllable factor data from graph
 */
export const ControllableFactorInput = z.object({
  /** Factor node ID */
  factor_id: z.string().min(1),
  /** Factor label */
  label: z.string().min(1),
  /** Factor type classification */
  factor_type: FactorType.optional(),
  /** Sources of epistemic uncertainty */
  uncertainty_drivers: z.array(z.string()).max(2).optional(),
});

export type ControllableFactorInputT = z.infer<typeof ControllableFactorInput>;

/**
 * Input for enrich_factors prompt
 */
export const EnrichFactorsInput = z.object({
  /** Goal node label */
  goal_label: z.string().min(1),
  /** Outcome node labels */
  outcome_labels: z.array(z.string()),
  /** Risk node labels */
  risk_labels: z.array(z.string()).optional(),
  /** Controllable factors from graph */
  controllable_factors: z.array(ControllableFactorInput),
  /** Factor sensitivity data from ISL */
  factor_sensitivity: z.array(FactorSensitivityInput),
});

export type EnrichFactorsInputT = z.infer<typeof EnrichFactorsInput>;

// =============================================================================
// Output Schemas
// =============================================================================

/**
 * Factor enrichment output per factor
 */
export const FactorEnrichment = z.object({
  /** Factor node ID */
  factor_id: z.string().min(1),
  /** Sensitivity rank from ISL (1 = most sensitive) */
  sensitivity_rank: z.number().int().min(1),
  /** 1-2 observations about this factor's role (not instructions) */
  observations: z.array(z.string()).min(1).max(2),
  /** 1-2 alternative ways to view/validate this factor */
  perspectives: z.array(z.string()).min(1).max(2),
  /** Optional confidence question - only for rank <= 3 */
  confidence_question: z.string().optional(),
});

export type FactorEnrichmentT = z.infer<typeof FactorEnrichment>;

/**
 * Output from enrich_factors prompt
 */
export const EnrichFactorsOutput = z.object({
  /** Enrichments per factor */
  enrichments: z.array(FactorEnrichment),
});

export type EnrichFactorsOutputT = z.infer<typeof EnrichFactorsOutput>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that confidence_question only appears for rank <= 3
 */
export function validateConfidenceQuestionRank(enrichments: FactorEnrichmentT[]): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];

  for (const enrichment of enrichments) {
    if (enrichment.confidence_question && enrichment.sensitivity_rank > 3) {
      violations.push(
        `Factor ${enrichment.factor_id} has confidence_question but rank ${enrichment.sensitivity_rank} > 3`
      );
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Filter enrichments to exclude factors with rank > 10
 */
export function filterByRank(enrichments: FactorEnrichmentT[], maxRank: number = 10): FactorEnrichmentT[] {
  return enrichments.filter(e => e.sensitivity_rank <= maxRank);
}
