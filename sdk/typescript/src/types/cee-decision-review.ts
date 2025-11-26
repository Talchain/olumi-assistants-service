/**
 * CeeDecisionReviewPayload v1 Types
 *
 * Frozen v1 contract for CEE decision review.
 * Matches schema: schemas/cee-decision-review.v1.json
 *
 * @module
 */

// ============================================================================
// Recommendation Types
// ============================================================================

export type RecommendationPriority = "high" | "medium" | "low";

export interface Recommendation {
  /** Unique recommendation identifier */
  id: string;
  /** Priority level */
  priority: RecommendationPriority;
  /** Human-readable recommendation message */
  message: string;
  /** Suggested action to take */
  action?: string;
  /** Node IDs affected by this recommendation */
  affected_nodes?: string[];
}

// ============================================================================
// Bias Finding Types
// ============================================================================

export type BiasSeverity = "critical" | "high" | "medium" | "low";

export interface MicroIntervention {
  /** Steps to address the bias */
  steps: string[];
  /** Estimated time to complete intervention */
  estimated_minutes: number;
}

export interface BiasFinding {
  /** Bias code identifier (e.g., "CONFIRMATION_BIAS") */
  code: string;
  /** Severity level */
  severity: BiasSeverity;
  /** Human-readable description of the bias finding */
  message: string;
  /** Confidence score for this finding (0-1) */
  confidence?: number;
  /** Node IDs affected by this bias */
  affected_node_ids?: string[];
  /** Optional micro-intervention to address the bias */
  micro_intervention?: MicroIntervention;
}

// ============================================================================
// Structural Issue Types
// ============================================================================

export type StructuralIssueSeverity = "error" | "warning" | "info";

export interface StructuralIssue {
  /** Issue code identifier (e.g., "ORPHAN_NODE") */
  code: string;
  /** Severity level */
  severity: StructuralIssueSeverity;
  /** Human-readable description of the structural issue */
  message: string;
  /** Node IDs affected by this issue */
  affected_node_ids?: string[];
}

// ============================================================================
// Review Types
// ============================================================================

export type QualityBand = "high" | "medium" | "low";

export interface Review {
  /** Plain-English summary of decision quality */
  summary: string;
  /** Overall confidence score (0-1) */
  confidence: number;
  /** Quality band categorization */
  quality_band?: QualityBand;
  /** Actionable recommendations */
  recommendations: Recommendation[];
  /** Detected bias patterns */
  bias_findings?: BiasFinding[];
  /** Structural issues in the decision graph */
  structural_issues?: StructuralIssue[];
  /** Strengths identified in the decision model */
  strengths?: string[];
}

// ============================================================================
// Trace Types
// ============================================================================

export interface Trace {
  /** Request identifier for debugging */
  request_id?: string;
  /** Correlation ID for distributed tracing */
  correlation_id?: string;
  /** Total latency in milliseconds */
  latency_ms?: number;
  /** Model version used for the review */
  model_version?: string;
}

// ============================================================================
// Meta Types
// ============================================================================

export interface Meta {
  /** ISO 8601 timestamp of creation */
  created_at?: string;
  /** Hash of the input graph */
  graph_hash?: string;
  /** Random seed used (if applicable) */
  seed?: number;
}

// ============================================================================
// Main Payload Type
// ============================================================================

/**
 * CeeDecisionReviewPayload v1
 *
 * Frozen contract for CEE decision review responses.
 * This is the primary type for PLoT and UI integration.
 */
export interface CeeDecisionReviewPayloadV1 {
  /** Schema identifier - always "cee.decision-review.v1" */
  schema: "cee.decision-review.v1";
  /** Version - always "1.0.0" */
  version: "1.0.0";
  /** Decision identifier */
  decision_id: string;
  /** Optional scenario identifier */
  scenario_id?: string | null;
  /** The review content */
  review: Review;
  /** Optional trace information */
  trace?: Trace;
  /** Optional metadata */
  meta?: Meta;
}

/**
 * Type alias for convenience
 */
export type CeeDecisionReview = CeeDecisionReviewPayloadV1;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a value is a valid CeeDecisionReviewPayloadV1
 */
export function isCeeDecisionReviewPayloadV1(value: unknown): value is CeeDecisionReviewPayloadV1 {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  return (
    obj.schema === "cee.decision-review.v1" &&
    obj.version === "1.0.0" &&
    typeof obj.decision_id === "string" &&
    obj.decision_id.length > 0 &&
    typeof obj.review === "object" &&
    obj.review !== null &&
    typeof (obj.review as Record<string, unknown>).summary === "string" &&
    typeof (obj.review as Record<string, unknown>).confidence === "number" &&
    Array.isArray((obj.review as Record<string, unknown>).recommendations)
  );
}

/**
 * Create a minimal valid CeeDecisionReviewPayloadV1
 */
export function createMinimalReviewPayload(
  decisionId: string,
  summary: string,
  confidence: number
): CeeDecisionReviewPayloadV1 {
  return {
    schema: "cee.decision-review.v1",
    version: "1.0.0",
    decision_id: decisionId,
    review: {
      summary,
      confidence: Math.max(0, Math.min(1, confidence)),
      recommendations: [],
    },
  };
}
