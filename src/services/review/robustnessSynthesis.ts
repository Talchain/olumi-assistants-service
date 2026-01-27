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

/** Threshold probability for "likely" switch */
const HIGH_SWITCH_PROBABILITY = 0.4;

/** Patterns to detect factor types for contextualised messaging */
const FACTOR_TYPE_PATTERNS: Array<{
  type: string;
  patterns: RegExp[];
  validationHint: string;
  uncertaintyPhrase: string;
}> = [
  // Note: price checked before cost since cost includes currency symbols which could match price labels
  {
    type: "price",
    patterns: [/price/i, /pricing/i, /fee/i, /rate/i, /tier/i, /discount/i],
    validationHint: "Validate pricing assumptions with market research",
    uncertaintyPhrase: "pricing may need adjustment",
  },
  {
    type: "cost",
    patterns: [/cost/i, /expense/i, /budget/i, /spend/i, /£|€|\$/],
    validationHint: "Get actual quotes or historical cost data",
    uncertaintyPhrase: "costs may differ from estimates",
  },
  {
    type: "time",
    patterns: [/time/i, /duration/i, /delay/i, /schedule/i, /deadline/i, /weeks?|months?|days?/i],
    validationHint: "Review past project timelines or get expert estimates",
    uncertaintyPhrase: "timelines may vary",
  },
  {
    type: "probability",
    patterns: [/probability/i, /likelihood/i, /chance/i, /risk/i, /%/],
    validationHint: "Gather historical frequency data or expert assessments",
    uncertaintyPhrase: "the likelihood may be different than assumed",
  },
  {
    type: "revenue",
    patterns: [/revenue/i, /sales/i, /income/i, /profit/i, /margin/i, /earnings/i],
    validationHint: "Validate with market research or sales forecasts",
    uncertaintyPhrase: "revenue projections may not materialise",
  },
  {
    type: "demand",
    patterns: [/demand/i, /volume/i, /quantity/i, /uptake/i, /adoption/i, /customers?/i],
    validationHint: "Test with customer surveys or pilot programs",
    uncertaintyPhrase: "demand levels are uncertain",
  },
  {
    type: "quality",
    patterns: [/quality/i, /satisfaction/i, /rating/i, /score/i, /nps/i, /retention/i],
    validationHint: "Run user testing or gather customer feedback",
    uncertaintyPhrase: "quality outcomes may vary",
  },
];

/**
 * Detect the factor type from its label for contextualised messaging.
 */
function detectFactorType(label: string): {
  type: string;
  validationHint: string;
  uncertaintyPhrase: string;
} | undefined {
  for (const factorType of FACTOR_TYPE_PATTERNS) {
    for (const pattern of factorType.patterns) {
      if (pattern.test(label)) {
        return {
          type: factorType.type,
          validationHint: factorType.validationHint,
          uncertaintyPhrase: factorType.uncertaintyPhrase,
        };
      }
    }
  }
  return undefined;
}

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
 * Generate a plain English explanation of an assumption's fragility.
 * Uses factor type detection to provide contextualised messaging.
 */
function generateContextualisedAssumptionExplanation(
  fromLabel: string,
  toLabel: string,
  alternativeWinner: string | undefined,
  switchProbability: number | undefined,
): string {
  // Detect factor types for contextualised phrasing
  const fromType = detectFactorType(fromLabel);
  const toType = detectFactorType(toLabel);

  // Build uncertainty phrase based on detected types
  let uncertaintyPhrase: string;
  if (fromType) {
    uncertaintyPhrase = fromType.uncertaintyPhrase;
  } else if (toType) {
    uncertaintyPhrase = toType.uncertaintyPhrase;
  } else {
    uncertaintyPhrase = "this assumption may not hold";
  }

  // Build switch likelihood phrase
  let likelihoodPhrase = "";
  if (switchProbability !== undefined) {
    if (switchProbability >= HIGH_SWITCH_PROBABILITY) {
      likelihoodPhrase = " This is a realistic scenario.";
    } else if (switchProbability >= 0.2) {
      likelihoodPhrase = " This is worth considering.";
    }
  }

  // Build the consequence phrase
  let consequencePhrase: string;
  if (alternativeWinner) {
    consequencePhrase = `${alternativeWinner} could become the better choice`;
  } else {
    consequencePhrase = "the recommendation could change";
  }

  // Generate contextualised explanation
  return `The recommendation assumes ${fromLabel} significantly affects ${toLabel}. If ${uncertaintyPhrase}, ${consequencePhrase}.${likelihoodPhrase}`;
}

/**
 * Generate assumption explanations from fragile edges
 */
function generateAssumptionExplanations(
  data: PLoTRobustnessDataT
): Array<{
  edge_id: string;
  explanation: string;
  severity: "fragile" | "moderate" | "robust";
  validation_hint?: string;
}> | undefined {
  if (!data.fragile_edges || data.fragile_edges.length === 0) {
    return undefined;
  }

  return data.fragile_edges.map((edge) => {
    const explanation = generateContextualisedAssumptionExplanation(
      edge.from_label,
      edge.to_label,
      edge.alternative_winner_label,
      edge.switch_probability,
    );

    // Get validation hint based on factor type
    const factorType = detectFactorType(edge.from_label) || detectFactorType(edge.to_label);
    const validationHint = factorType?.validationHint;

    return {
      edge_id: edge.edge_id,
      explanation,
      severity: "fragile" as const,
      ...(validationHint && { validation_hint: validationHint }),
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
 * Generate a contextualised investigation suggestion based on factor type.
 */
function generateContextualisedSuggestion(
  factorLabel: string,
  elasticity: number,
  importanceRank?: number,
): string {
  const influenceLevel = getInfluenceLevel(elasticity);
  const factorType = detectFactorType(factorLabel);

  // Build importance phrase
  let importancePhrase = "";
  if (importanceRank !== undefined && importanceRank <= 3) {
    const ordinals = ["most", "second most", "third most"];
    importancePhrase = ` (the ${ordinals[importanceRank - 1] || "key"} influential factor)`;
  }

  // Generate contextualised suggestion based on factor type
  if (factorType) {
    return `${factorType.validationHint} for "${factorLabel}"${importancePhrase}. This factor has ${influenceLevel} influence on the outcome.`;
  }

  // Fallback for unrecognised factor types
  return `Validate your "${factorLabel}" estimate${importancePhrase}. This factor has ${influenceLevel} influence on the outcome.`;
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
  factor_type?: string;
  validation_action?: string;
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
    const suggestion = generateContextualisedSuggestion(
      factor.factor_label,
      factor.elasticity,
      factor.importance_rank,
    );

    const factorType = detectFactorType(factor.factor_label);

    return {
      factor_id: factor.factor_id,
      suggestion,
      elasticity: factor.elasticity,
      ...(factorType && { factor_type: factorType.type }),
      ...(factorType && { validation_action: factorType.validationHint }),
    };
  });
}

// =============================================================================
// Fallback Messages
// =============================================================================

const FALLBACK_MESSAGES = {
  headline_no_stability: "Robustness analysis in progress",
  headline_no_option: "Analysis complete, awaiting option selection",
  no_fragile_edges: "No critical assumptions identified that could change the recommendation",
  no_sensitive_factors: "All factors show stable influence on the outcome",
};

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Generate robustness synthesis from PLoT robustness data.
 *
 * Returns partial synthesis with fallback messages if some data is missing.
 * Returns null only if no robustness_data is provided at all.
 *
 * @param robustnessData - PLoT robustness data (may be undefined)
 * @param options - Optional configuration for fallback behavior
 * @returns RobustnessSynthesis or null
 */
export function generateRobustnessSynthesis(
  robustnessData: PLoTRobustnessDataT | undefined | null,
  options?: {
    /** Include fallback messages for missing sections (default: true) */
    includeFallbacks?: boolean;
    /** Goal label for context in headlines */
    goalLabel?: string;
  }
): RobustnessSynthesisT | null {
  // Handle completely missing data
  if (!robustnessData) {
    return null;
  }

  const includeFallbacks = options?.includeFallbacks !== false;

  // Generate each component independently
  const headline = generateHeadline(robustnessData);
  const assumptionExplanations = generateAssumptionExplanations(robustnessData);
  const investigationSuggestions = generateInvestigationSuggestions(robustnessData);

  // Build synthesis object with graceful fallbacks
  const synthesis: RobustnessSynthesisT = {};

  // Headline - always include with fallback if needed
  if (headline) {
    synthesis.headline = headline;
  } else if (includeFallbacks) {
    synthesis.headline = FALLBACK_MESSAGES.headline_no_stability;
  }

  // Assumption explanations - include or provide fallback message
  if (assumptionExplanations && assumptionExplanations.length > 0) {
    synthesis.assumption_explanations = assumptionExplanations;
  } else if (includeFallbacks) {
    synthesis.assumption_explanations = [{
      edge_id: "none",
      explanation: FALLBACK_MESSAGES.no_fragile_edges,
      severity: "robust" as const,
    }];
  }

  // Investigation suggestions - include or provide fallback message
  if (investigationSuggestions && investigationSuggestions.length > 0) {
    synthesis.investigation_suggestions = investigationSuggestions;
  } else if (includeFallbacks) {
    synthesis.investigation_suggestions = [{
      factor_id: "none",
      suggestion: FALLBACK_MESSAGES.no_sensitive_factors,
      elasticity: 0,
    }];
  }

  // If synthesis has no meaningful content even with fallbacks, return null
  if (!synthesis.headline && !synthesis.assumption_explanations && !synthesis.investigation_suggestions) {
    return null;
  }

  return synthesis;
}
