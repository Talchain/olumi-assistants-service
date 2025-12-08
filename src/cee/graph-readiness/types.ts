/**
 * Graph Readiness Assessment Types
 *
 * Defines the interface for pre-analysis graph readiness evaluation.
 * Returns a 0-100 score with actionable quality factor recommendations.
 */

export type ReadinessLevel = "ready" | "fair" | "needs_work";

export type ConfidenceLevel = "high" | "medium" | "low";

export type ImpactLevel = "high" | "medium" | "low";

export type QualityFactorName =
  | "causal_detail"
  | "weight_refinement"
  | "risk_coverage"
  | "outcome_balance"
  | "option_diversity";

export interface QualityFactor {
  /** Factor identifier */
  factor: QualityFactorName;

  /** Current score (0-100) */
  current_score: number;

  /** Impact of this factor on overall quality */
  impact: ImpactLevel;

  /** Actionable recommendation to improve this factor */
  recommendation: string;

  /** Estimated score improvement if recommendation is followed */
  potential_improvement: number;
}

export interface GraphReadinessAssessment {
  /** Overall readiness score (0-100) */
  readiness_score: number;

  /** Categorical readiness level */
  readiness_level: ReadinessLevel;

  /** Confidence in the assessment accuracy */
  confidence_level: ConfidenceLevel;

  /** Plain language explanation of confidence */
  confidence_explanation: string;

  /** Breakdown of quality factors with recommendations */
  quality_factors: QualityFactor[];

  /** Whether the graph meets minimum requirements for analysis */
  can_run_analysis: boolean;

  /** Reason analysis is blocked (if can_run_analysis is false) */
  blocker_reason?: string;
}

export interface FactorResult {
  /** Raw score (0-100) */
  score: number;

  /** Issues detected */
  issues: string[];
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  optionCount: number;
  riskCount: number;
  outcomeCount: number;
  goalCount: number;
  decisionCount: number;
  factorCount: number;
  actionCount: number;
  evidenceCount: number;
}
