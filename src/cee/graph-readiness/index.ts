/**
 * Graph Readiness Assessment
 *
 * Evaluates a decision graph's readiness for analysis.
 * Returns a 0-100 score with quality factor breakdown and recommendations.
 *
 * Characteristics:
 * - Deterministic (no LLM calls)
 * - Sub-50ms latency target
 * - Actionable recommendations
 */

import type { GraphV1 } from "../../contracts/plot/engine.js";
import type {
  GraphReadinessAssessment,
  QualityFactor,
  QualityFactorName,
  ReadinessLevel,
  ConfidenceLevel,
  FactorResult,
} from "./types.js";
import {
  FACTOR_WEIGHTS,
  FACTOR_IMPACTS,
  READINESS_THRESHOLDS,
  CONFIDENCE_THRESHOLDS,
  MINIMUM_REQUIREMENTS,
} from "./constants.js";
import {
  scoreCausalDetail,
  scoreWeightRefinement,
  scoreRiskCoverage,
  scoreOutcomeBalance,
  scoreOptionDiversity,
  computeGraphStats,
} from "./factors.js";
import {
  generateRecommendation,
  estimatePotentialImprovement,
  generateConfidenceExplanation,
} from "./recommendations.js";

// ============================================================================
// Main Assessment Function
// ============================================================================

/**
 * Assess graph readiness for analysis.
 *
 * @param graph - Decision graph to evaluate
 * @returns GraphReadinessAssessment with score, factors, and recommendations
 */
export function assessGraphReadiness(
  graph: GraphV1 | undefined,
): GraphReadinessAssessment {
  // Compute graph statistics
  const stats = computeGraphStats(graph);

  // Check for blockers first
  const blocker = checkBlockers(stats);
  if (blocker) {
    return createBlockedAssessment(blocker, stats);
  }

  // Score each factor
  const factorResults: Record<QualityFactorName, FactorResult> = {
    causal_detail: scoreCausalDetail(graph),
    weight_refinement: scoreWeightRefinement(graph),
    risk_coverage: scoreRiskCoverage(graph),
    outcome_balance: scoreOutcomeBalance(graph),
    option_diversity: scoreOptionDiversity(graph),
  };

  // Extract scores for weighted calculation
  const factorScores: Record<QualityFactorName, number> = {
    causal_detail: factorResults.causal_detail.score,
    weight_refinement: factorResults.weight_refinement.score,
    risk_coverage: factorResults.risk_coverage.score,
    outcome_balance: factorResults.outcome_balance.score,
    option_diversity: factorResults.option_diversity.score,
  };

  // Calculate overall readiness score (weighted average)
  const readinessScore = calculateOverallScore(factorScores);
  const readinessLevel = getReadinessLevel(readinessScore);

  // Calculate confidence level
  const confidenceLevel = calculateConfidenceLevel(stats, factorScores);
  const confidenceExplanation = generateConfidenceExplanation(
    confidenceLevel,
    stats.nodeCount,
    factorScores,
  );

  // Build quality factors with recommendations
  const qualityFactors = buildQualityFactors(factorResults);

  return {
    readiness_score: readinessScore,
    readiness_level: readinessLevel,
    confidence_level: confidenceLevel,
    confidence_explanation: confidenceExplanation,
    quality_factors: qualityFactors,
    can_run_analysis: true,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check for conditions that block analysis.
 */
function checkBlockers(stats: ReturnType<typeof computeGraphStats>): string | null {
  if (stats.nodeCount < MINIMUM_REQUIREMENTS.minTotalNodes) {
    return "Graph has insufficient nodes for analysis";
  }

  if (stats.optionCount < MINIMUM_REQUIREMENTS.minOptionNodes) {
    return "Graph requires at least one option node";
  }

  if (stats.decisionCount < MINIMUM_REQUIREMENTS.minDecisionNodes) {
    return "Graph requires at least one decision node";
  }

  return null;
}

/**
 * Create assessment for blocked analysis.
 */
function createBlockedAssessment(
  blockerReason: string,
  _stats: ReturnType<typeof computeGraphStats>,
): GraphReadinessAssessment {
  return {
    readiness_score: 0,
    readiness_level: "needs_work",
    confidence_level: "low",
    confidence_explanation: `Cannot assess readiness: ${blockerReason}`,
    quality_factors: [],
    can_run_analysis: false,
    blocker_reason: blockerReason,
  };
}

/**
 * Calculate weighted overall score.
 */
function calculateOverallScore(
  factorScores: Record<QualityFactorName, number>,
): number {
  let weightedSum = 0;
  for (const [factor, weight] of Object.entries(FACTOR_WEIGHTS)) {
    weightedSum += factorScores[factor as QualityFactorName] * weight;
  }
  return Math.round(weightedSum);
}

/**
 * Map score to readiness level.
 */
function getReadinessLevel(score: number): ReadinessLevel {
  if (score >= READINESS_THRESHOLDS.ready) return "ready";
  if (score >= READINESS_THRESHOLDS.fair) return "fair";
  return "needs_work";
}

/**
 * Calculate confidence level based on graph size and score consistency.
 */
function calculateConfidenceLevel(
  stats: ReturnType<typeof computeGraphStats>,
  factorScores: Record<QualityFactorName, number>,
): ConfidenceLevel {
  const scores = Object.values(factorScores);
  const variance = computeNormalizedScoreVariance(scores);
  const { nodeCount } = stats;
  const C = CONFIDENCE_THRESHOLDS;

  // High confidence: substantial graph, consistent scores
  if (nodeCount >= C.highConfidenceMinNodes && variance < C.highConfidenceMaxVariance) {
    return "high";
  }

  // Low confidence: tiny graph or high variance
  if (nodeCount < C.mediumConfidenceMinNodes || variance > C.lowConfidenceVarianceThreshold) {
    return "low";
  }

  return "medium";
}

/**
 * Compute variance for factor scores (0-100 scale).
 * Normalizes to 0-1 range for comparison with thresholds.
 */
function computeNormalizedScoreVariance(values: number[]): number {
  if (values.length === 0) return 0;
  // Normalize 0-100 scores to 0-1 range for variance calculation
  const normalized = values.map((v) => v / 100);
  const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
  const squaredDiffs = normalized.map((v) => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / normalized.length;
}

/**
 * Build quality factors array with recommendations.
 */
function buildQualityFactors(
  factorResults: Record<QualityFactorName, FactorResult>,
): QualityFactor[] {
  const factors: QualityFactor[] = [];

  for (const [factorName, result] of Object.entries(factorResults)) {
    const name = factorName as QualityFactorName;
    const recommendation = generateRecommendation(name, result.issues);
    const potentialImprovement = estimatePotentialImprovement(
      name,
      result.score,
      result.issues,
    );

    factors.push({
      factor: name,
      current_score: result.score,
      impact: FACTOR_IMPACTS[name],
      recommendation,
      potential_improvement: potentialImprovement,
    });
  }

  // Sort by impact (high first), then by score (lowest first)
  const impactOrder = { high: 0, medium: 1, low: 2 };
  factors.sort((a, b) => {
    const impactDiff = impactOrder[a.impact] - impactOrder[b.impact];
    if (impactDiff !== 0) return impactDiff;
    return a.current_score - b.current_score;
  });

  return factors;
}

// Re-export types and utilities
export type {
  GraphReadinessAssessment,
  QualityFactor,
  QualityFactorName,
  ReadinessLevel,
  ConfidenceLevel,
} from "./types.js";

export { computeGraphStats } from "./factors.js";

// Export for testing
export const __test_only = {
  checkBlockers,
  calculateOverallScore,
  getReadinessLevel,
  calculateConfidenceLevel,
  computeNormalizedScoreVariance,
  buildQualityFactors,
};
