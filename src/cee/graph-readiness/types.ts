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
  | "option_diversity"
  | "goal_outcome_linkage";

/**
 * Evidence quality grade for edges.
 * - strong: peer-reviewed data, verified metrics, authoritative sources
 * - moderate: internal data, credible sources, documented assumptions
 * - weak: hypothesis, unverified assumptions, speculation
 * - none: no provenance provided
 */
export type EvidenceGrade = "strong" | "moderate" | "weak" | "none";

/**
 * Distribution of evidence quality across edges.
 */
export interface EvidenceQualityDistribution {
  /** Count of edges with strong evidence */
  strong: number;
  /** Count of edges with moderate evidence */
  moderate: number;
  /** Count of edges with weak evidence (assumptions/hypotheses) */
  weak: number;
  /** Count of edges with no provenance */
  none: number;
  /** Human-readable summary */
  summary: string;
}

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

  /** Distribution of evidence quality across edges */
  evidence_quality?: EvidenceQualityDistribution;

  /** Key assumptions to validate - always present with at least one entry */
  key_assumptions?: KeyAssumptionsResult;

  /** Domain-specific completeness analysis */
  domain_completeness?: DomainCompletenessResult;

  /** Goal conflict analysis (when multiple goals exist) */
  goal_conflicts?: GoalConflictAnalysis;
}

export interface FactorResult {
  /** Raw score (0-100) */
  score: number;

  /** Issues detected */
  issues: string[];
}

/**
 * A key assumption that should be validated.
 */
export interface KeyAssumption {
  /** Edge identifier (from → to) */
  edge_id: string;
  /** Source node label */
  from_label: string;
  /** Target node label */
  to_label: string;
  /** Current belief value (0-1) */
  belief: number;
  /** Assumption priority score (higher = more important to validate) */
  priority_score: number;
  /** Plain English explanation */
  plain_english: string;
}

/**
 * Key assumptions analysis result.
 * Always includes at least one assumption - never empty.
 */
export interface KeyAssumptionsResult {
  /** Top assumptions to validate */
  assumptions: KeyAssumption[];
  /** Summary statement */
  summary: string;
  /** Whether all edges are well-grounded (beliefs > 0.8) */
  well_grounded: boolean;
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

// ============================================================================
// Domain Detection & Completeness Types
// ============================================================================

/**
 * Detected decision domain based on brief content.
 */
export type DomainType =
  | "product_launch"
  | "pricing"
  | "hiring"
  | "investment"
  | "general";

/**
 * A factor expected in a domain-specific decision model.
 */
export interface ExpectedFactor {
  /** Factor name/label to check for */
  name: string;
  /** Why this factor matters for this domain */
  rationale: string;
  /** Importance level */
  importance: "critical" | "recommended" | "optional";
}

/**
 * Domain-specific completeness template.
 */
export interface DomainTemplate {
  /** Domain identifier */
  domain: DomainType;
  /** Human-readable domain name */
  display_name: string;
  /** Expected factors for this domain */
  expected_factors: ExpectedFactor[];
  /** Keywords that indicate this domain */
  keywords: string[];
}

/**
 * Missing factor with suggestion to add.
 */
export interface MissingFactor {
  /** Factor name */
  name: string;
  /** Why this factor matters */
  rationale: string;
  /** Importance level */
  importance: "critical" | "recommended" | "optional";
  /** Suggested prompt to add this factor */
  suggestion: string;
}

/**
 * Domain completeness analysis result.
 */
export interface DomainCompletenessResult {
  /** Detected domain */
  detected_domain: DomainType;
  /** Confidence in domain detection (0-1) */
  detection_confidence: number;
  /** Factors found matching domain template */
  factors_found: string[];
  /** Missing factors with suggestions */
  missing_factors: MissingFactor[];
  /** Completeness score (0-100) */
  completeness_score: number;
  /** Human-readable summary */
  summary: string;
}

// ============================================================================
// Goal Conflict Analysis Types
// ============================================================================

/**
 * Relationship type between two goals.
 * - aligned: Goals benefit from the same options
 * - conflicting: Improving one goal tends to hurt the other
 * - independent: Goals don't share significant pathways
 */
export type GoalRelationship = "aligned" | "conflicting" | "independent";

/**
 * A pair of goals with their relationship analysis.
 */
export interface GoalPair {
  /** First goal ID */
  goal_a_id: string;
  /** First goal label */
  goal_a_label: string;
  /** Second goal ID */
  goal_b_id: string;
  /** Second goal label */
  goal_b_label: string;
  /** Detected relationship */
  relationship: GoalRelationship;
  /** Strength of relationship (0-1, higher = stronger) */
  strength: number;
  /** Shared outcomes/factors connecting the goals */
  shared_nodes: string[];
  /** Plain English explanation */
  explanation: string;
}

/**
 * Trade-off guidance for conflicting goals.
 */
export interface TradeOffGuidance {
  /** Type of guidance */
  type: "pareto" | "prioritize" | "hybrid";
  /** Main guidance headline */
  headline: string;
  /** Detailed explanation */
  explanation: string;
  /** Suggested next steps */
  suggestions: string[];
}

/**
 * Complete goal conflict analysis result.
 */
export interface GoalConflictAnalysis {
  /** Number of goals in graph */
  goal_count: number;
  /** Goals analyzed */
  goals: Array<{ id: string; label: string }>;
  /** Pairwise goal relationships */
  relationships: GoalPair[];
  /** Whether any conflicts were detected */
  has_conflicts: boolean;
  /** Trade-off guidance (if conflicts exist) */
  guidance?: TradeOffGuidance;
  /** Human-readable summary */
  summary: string;
}
