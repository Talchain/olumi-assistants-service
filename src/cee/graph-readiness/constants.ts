/**
 * Graph Readiness Constants
 *
 * Weights, thresholds, and scoring parameters for graph readiness assessment.
 */

import type { QualityFactorName, ImpactLevel } from "./types.js";

/** Factor weights for overall score calculation (must sum to 1.0) */
export const FACTOR_WEIGHTS: Record<QualityFactorName, number> = {
  causal_detail: 0.25,       // Highest: causal relationships are core to quality
  weight_refinement: 0.20,   // Critical for accurate inference
  risk_coverage: 0.20,       // Important for decision completeness
  outcome_balance: 0.20,     // Ensures fair option comparison
  option_diversity: 0.15,    // Foundational but less critical
};

/** Factor impact on overall quality */
export const FACTOR_IMPACTS: Record<QualityFactorName, ImpactLevel> = {
  causal_detail: "high",
  weight_refinement: "high",
  risk_coverage: "medium",
  outcome_balance: "medium",
  option_diversity: "low",
};

/** Readiness level thresholds (0-100 scale) */
export const READINESS_THRESHOLDS = {
  ready: 70,         // >= 70 = ready
  fair: 40,          // >= 40 and < 70 = fair
  // < 40 = needs_work
};

/** Confidence level thresholds */
export const CONFIDENCE_THRESHOLDS = {
  /** Minimum nodes for high confidence */
  highConfidenceMinNodes: 5,
  /** Maximum factor score variance for high confidence */
  highConfidenceMaxVariance: 0.15,
  /** Minimum nodes for medium confidence */
  mediumConfidenceMinNodes: 3,
  /** Variance threshold above which confidence becomes low */
  lowConfidenceVarianceThreshold: 0.3,
};

/** Minimum structure requirements for analysis */
export const MINIMUM_REQUIREMENTS = {
  /** At least one decision node required */
  minDecisionNodes: 1,
  /** At least one option node required */
  minOptionNodes: 1,
  /** Minimum total nodes to run analysis */
  minTotalNodes: 2,
};

/** Scoring adjustments for causal_detail factor */
export const CAUSAL_DETAIL_SCORING = {
  baseScore: 50,
  edgeDensityThreshold: 0.8,
  edgeDensityPenalty: -15,
  edgeDensityBonus: 10,
  edgeDensityBonusThreshold: 1.2,
  beliefCoverageThreshold: 0.5,
  beliefCoveragePenalty: -10,
  beliefCoverageBonus: 15,
  beliefCoverageBonusThreshold: 0.8,
  provenanceBonus: 2,
  provenanceMaxBonus: 10,
  disconnectedOutcomePenalty: -10,
};

/** Scoring adjustments for weight_refinement factor */
export const WEIGHT_REFINEMENT_SCORING = {
  baseScore: 70,
  noBeliefsScore: 30,
  uniformBeliefsPenalty: -30,
  defaultBeliefsPenalty: -20,
  defaultBeliefsThreshold: 0.6,
  extremeValuesPenalty: -10,
  goodVarianceBonus: 15,
  goodVarianceMin: 0.05,
  goodVarianceMax: 0.25,
};

/** Scoring adjustments for risk_coverage factor */
export const RISK_COVERAGE_SCORING = {
  noOptionsScore: 20,
  noRisksScore: 40,
  baseScore: 60,
  lowRiskRatioThreshold: 0.5,
  lowRiskRatioPenalty: -10,
  goodRiskRatioThreshold: 1.0,
  goodRiskRatioBonus: 20,
  disconnectedRiskPenalty: -10,
};

/** Scoring adjustments for outcome_balance factor */
export const OUTCOME_BALANCE_SCORING = {
  missingDataScore: 30,
  baseScore: 60,
  noOutcomesPenalty: -20,
  unevenDistributionPenalty: -15,
  unevenDistributionThreshold: 2,
  goodOutcomeCountBonus: 20,
  goodOutcomeCountThreshold: 2,
};

/** Scoring adjustments for option_diversity factor */
export const OPTION_DIVERSITY_SCORING = {
  noOptionsScore: 20,
  baseScore: 50,
  singleOptionPenalty: -20,
  twoOptionsBonus: 10,
  optimalRangeBonus: 25,
  optimalRangeMin: 3,
  optimalRangeMax: 5,
  manyOptionsBonus: 15,
  disconnectedOptionPenalty: -10,
};

/** Potential improvement estimation parameters */
export const IMPROVEMENT_ESTIMATION = {
  /** Base improvement potential */
  baseImprovement: 30,
  /** Actionable issue patterns and their improvement bonuses */
  actionablePatterns: {
    placeholder: 15,
    "default 0.5": 15,
    "no belief": 20,
    "not connected": 10,
    "no risk": 15,
    uniform: 15,
    uneven: 10,
    "only one": 20,
    "few risks": 10,
    disconnected: 10,
    missing: 15,
  } as Record<string, number>,
};
