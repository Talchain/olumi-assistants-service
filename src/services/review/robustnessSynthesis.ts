/**
 * Robustness Synthesis Generator
 *
 * Generates natural language explanations from PLoT robustness data.
 * Template-based, deterministic - no LLM calls.
 *
 * @module services/review/robustnessSynthesis
 */

import type {
  PLoTRobustnessDataT,
  RobustnessSynthesisT,
} from "../../schemas/review.js";

// =============================================================================
// Constants
// =============================================================================

/** Elasticity threshold for "high" influence */
const HIGH_ELASTICITY_THRESHOLD = 0.5;

/** Maximum importance rank to include in suggestions */
const MAX_IMPORTANCE_RANK = 3;

/** Minimum elasticity to include in suggestions */
const MIN_ELASTICITY_THRESHOLD = 0.3;

// =============================================================================
// Headline Generation
// =============================================================================

/**
 * Generate the headline from recommendation stability and recommended option
 */
function generateHeadline(data: PLoTRobustnessDataT): string | undefined {
  if (data.recommendation_stability === undefined) {
    return undefined;
  }

  const stabilityPct = Math.round(data.recommendation_stability * 100);

  if (data.recommended_option?.label) {
    return `${stabilityPct}% confident that ${data.recommended_option.label} remains your best option`;
  }

  return `${stabilityPct}% confidence in the current recommendation`;
}

// =============================================================================
// Assumption Explanations Generation
// =============================================================================

/**
 * Generate assumption explanations from fragile edges
 */
function generateAssumptionExplanations(
  data: PLoTRobustnessDataT
): Array<{
  edge_id: string;
  explanation: string;
  severity: "fragile" | "moderate" | "robust";
}> | undefined {
  if (!data.fragile_edges || data.fragile_edges.length === 0) {
    return undefined;
  }

  return data.fragile_edges.map((edge) => {
    let explanation: string;

    if (edge.alternative_winner_label) {
      explanation = `If the effect of ${edge.from_label} on ${edge.to_label} is weaker than modelled, ${edge.alternative_winner_label} may become preferred`;
    } else {
      explanation = `If the effect of ${edge.from_label} on ${edge.to_label} is weaker than modelled, your recommendation may change`;
    }

    return {
      edge_id: edge.edge_id,
      explanation,
      severity: "fragile" as const,
    };
  });
}

// =============================================================================
// Investigation Suggestions Generation
// =============================================================================

/**
 * Determine influence level description based on elasticity
 */
function getInfluenceLevel(elasticity: number): string {
  if (elasticity >= HIGH_ELASTICITY_THRESHOLD) {
    return "high";
  }
  return "moderate";
}

/**
 * Check if a factor should be included in suggestions
 */
function shouldIncludeFactor(factor: {
  elasticity: number;
  importance_rank?: number;
}): boolean {
  // Include if importance rank is top 3
  if (factor.importance_rank !== undefined && factor.importance_rank <= MAX_IMPORTANCE_RANK) {
    return true;
  }
  // Or if elasticity is above threshold
  if (factor.elasticity >= MIN_ELASTICITY_THRESHOLD) {
    return true;
  }
  return false;
}

/**
 * Generate investigation suggestions from factor sensitivity data
 */
function generateInvestigationSuggestions(
  data: PLoTRobustnessDataT
): Array<{
  factor_id: string;
  suggestion: string;
  elasticity: number;
}> | undefined {
  if (!data.factor_sensitivity || data.factor_sensitivity.length === 0) {
    return undefined;
  }

  const eligibleFactors = data.factor_sensitivity.filter(shouldIncludeFactor);

  if (eligibleFactors.length === 0) {
    return undefined;
  }

  // Sort by importance rank (if available) then by elasticity
  const sortedFactors = [...eligibleFactors].sort((a, b) => {
    if (a.importance_rank !== undefined && b.importance_rank !== undefined) {
      return a.importance_rank - b.importance_rank;
    }
    if (a.importance_rank !== undefined) return -1;
    if (b.importance_rank !== undefined) return 1;
    return b.elasticity - a.elasticity;
  });

  return sortedFactors.map((factor) => {
    const influenceLevel = getInfluenceLevel(factor.elasticity);
    return {
      factor_id: factor.factor_id,
      suggestion: `Validate your ${factor.factor_label} estimate — this factor has ${influenceLevel} influence on the outcome`,
      elasticity: factor.elasticity,
    };
  });
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Generate robustness synthesis from PLoT robustness data.
 *
 * Returns null if no robustness_data is provided.
 * Returns partial synthesis if only some data is available.
 *
 * @param robustnessData - PLoT robustness data (may be undefined)
 * @returns RobustnessSynthesis or null
 */
export function generateRobustnessSynthesis(
  robustnessData: PLoTRobustnessDataT | undefined | null
): RobustnessSynthesisT | null {
  // Handle missing data
  if (!robustnessData) {
    return null;
  }

  // Generate each component independently
  const headline = generateHeadline(robustnessData);
  const assumptionExplanations = generateAssumptionExplanations(robustnessData);
  const investigationSuggestions = generateInvestigationSuggestions(robustnessData);

  // If all components are empty, return null
  if (!headline && !assumptionExplanations && !investigationSuggestions) {
    return null;
  }

  // Build synthesis object, omitting undefined fields
  const synthesis: RobustnessSynthesisT = {};

  if (headline) {
    synthesis.headline = headline;
  }
  if (assumptionExplanations && assumptionExplanations.length > 0) {
    synthesis.assumption_explanations = assumptionExplanations;
  }
  if (investigationSuggestions && investigationSuggestions.length > 0) {
    synthesis.investigation_suggestions = investigationSuggestions;
  }

  return synthesis;
}
