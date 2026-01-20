/**
 * CEE Review Types for PLoT Integration
 *
 * M1 CEE Orchestrator - CEE SDK Workstream
 * Version 1.2
 *
 * These types define the contract between PLoT and the CEE service
 * for the /assist/v1/review endpoint.
 *
 * @module
 */

// ============================================================================
// Request Types
// ============================================================================

/**
 * Graph snapshot for review request.
 */
export interface CeeGraphSnapshot {
  /** Graph nodes */
  nodes: unknown[];
  /** Graph edges */
  edges: unknown[];
}

/**
 * Inference results from PLoT engine.
 */
export interface CeeInferenceResults {
  /** Prediction quantiles */
  quantiles: {
    p10: number;
    p50: number;
    p90: number;
  };
  /** Top edge drivers */
  top_edge_drivers: unknown[];
  /** Ranked actions (optional) */
  ranked_actions?: unknown[];
}

/**
 * Market context metadata.
 */
export interface CeeMarketContext {
  /** Market context identifier */
  id: string;
  /** Context version */
  version: string;
  /** Content hash */
  hash: string;
}

/**
 * Intent classification for the review.
 */
export type CeeReviewIntent = "selection" | "prediction" | "validation";

/**
 * Request body for CEE review endpoint.
 */
export interface CeeReviewRequest {
  /** Scenario identifier */
  scenario_id: string;
  /** Decision graph snapshot */
  graph_snapshot: CeeGraphSnapshot;
  /** Graph schema version */
  graph_schema_version: "2.2";
  /** Inference results from PLoT engine */
  inference_results: CeeInferenceResults;
  /** Intent classification */
  intent: CeeReviewIntent;
  /** Market context metadata */
  market_context: CeeMarketContext;
  /** ISL robustness analysis (optional - enriches review with sensitivity/uncertainty) */
  robustness?: CeeIslRobustnessPayload;
}

/**
 * ISL sensitivity entry for robustness payload.
 */
export interface CeeIslSensitivity {
  /** Node ID affected by the sensitivity */
  node_id: string;
  /** Display label for the node */
  label: string;
  /** Sensitivity score (0-1, higher = more sensitive) */
  sensitivity_score: number;
  /** Classification of sensitivity level */
  classification: "low" | "medium" | "high";
  /** Description of the sensitivity */
  description?: string;
}

/**
 * ISL prediction interval for robustness payload.
 */
export interface CeeIslPredictionInterval {
  /** Node ID for this prediction interval */
  node_id: string;
  /** Lower bound of the interval */
  lower_bound: number;
  /** Upper bound of the interval */
  upper_bound: number;
  /** Confidence level (e.g., 0.9 for 90%) */
  confidence_level: number;
  /** Whether the interval is well calibrated */
  well_calibrated: boolean;
}

/**
 * ISL critical assumption for robustness payload.
 */
export interface CeeIslCriticalAssumption {
  /** Node ID for this assumption */
  node_id: string;
  /** Display label for the assumption */
  label: string;
  /** Impact score (0-1, higher = more impact) */
  impact: number;
  /** Recommendation for addressing this assumption */
  recommendation?: string;
}

/**
 * ISL robustness payload - optional input for /assist/v1/review.
 *
 * When present, CEE generates a robustness synthesis block.
 * When absent or degraded, CEE emits a block with status 'requires_run' or 'cannot_compute'.
 */
export interface CeeIslRobustnessPayload {
  /** ISL computation status */
  status: "computed" | "degraded" | "not_run" | "failed";
  /** Reason for the status (if not computed) */
  status_reason?: string;
  /** Overall robustness score (0-1) */
  overall_score?: number;
  /** Confidence in the robustness assessment (0-1) */
  confidence?: number;
  /** Sensitivity analysis results */
  sensitivities?: CeeIslSensitivity[];
  /** Prediction intervals */
  prediction_intervals?: CeeIslPredictionInterval[];
  /** Critical assumptions identified */
  critical_assumptions?: CeeIslCriticalAssumption[];
  /** ISL request ID for tracing */
  isl_request_id?: string;
  /** ISL processing latency in ms */
  isl_latency_ms?: number;
}

/**
 * Options for the SDK review() method.
 */
export interface CeeReviewOptions {
  /** Additional headers to pass (e.g., X-Request-Id) */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 6000) */
  timeout?: number;
  /** AbortSignal for request cancellation */
  signal?: AbortSignal;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Analysis state for the review.
 */
export type CeeAnalysisState = "not_run" | "ran" | "partial" | "stale";

/**
 * Readiness level classification.
 */
export type CeeReadinessLevel = "ready" | "caution" | "not_ready";

/**
 * Readiness factor status.
 */
export type CeeFactorStatus = "ok" | "warning" | "blocking";

/**
 * Readiness factor with label and status.
 */
export interface CeeReadinessFactor {
  /** Factor label */
  label: string;
  /** Factor status */
  status: CeeFactorStatus;
}

/**
 * Readiness assessment in the review response.
 */
export interface CeeReadiness {
  /** Overall readiness level */
  level: CeeReadinessLevel;
  /** Human-readable headline */
  headline: string;
  /** Individual factor assessments */
  factors: CeeReadinessFactor[];
  /** Optional numeric score (for backwards compatibility) */
  [key: string]: unknown;
}

/**
 * Block identifier - matches UI block lookup keys.
 */
export type CeeBlockId =
  | "recommendation"
  | "prediction"
  | "drivers"
  | "risks"
  | "biases"
  | "gaps"
  | "next_steps"
  | "robustness";

/**
 * Block computation status.
 */
export type CeeBlockStatus =
  | "ok"
  | "requires_run"
  | "not_applicable"
  | "cannot_compute"
  | "low_discrimination";

/**
 * Block source classification.
 */
export type CeeBlockSource = "engine" | "validator" | "cee" | "hybrid";

/**
 * Block severity classification.
 */
export type CeeBlockSeverity = "low" | "medium" | "high";

/**
 * Block priority (1 = highest, 3 = lowest).
 */
export type CeeBlockPriority = 1 | 2 | 3;

/**
 * Item within a review block.
 */
export interface CeeBlockItem {
  /** Item identifier */
  id: string;
  /** Display label */
  label: string;
  /** Optional description */
  description?: string;
  /** Optional severity */
  severity?: CeeBlockSeverity;
}

/**
 * A discrete review block from the CEE analysis.
 */
export interface CeeReviewBlock {
  /** Block identifier - used for UI lookup via getBlock(review, 'biases') */
  id: CeeBlockId;
  /** Block computation status */
  status: CeeBlockStatus;
  /** Reason for the status (if not 'ok') */
  status_reason?: string;
  /** Source of the block content */
  source: CeeBlockSource;
  /** Human-readable summary */
  summary: string;
  /** Detailed explanation (optional) */
  details?: string;
  /** List of items/findings (optional) */
  items?: CeeBlockItem[];
  /** Priority level (1-3) */
  priority: CeeBlockPriority;
  /** Overall severity (optional) */
  severity?: CeeBlockSeverity;
  /** Index signature for extra fields */
  [key: string]: unknown;
}

// ============================================================================
// Robustness Block Types
// ============================================================================

/**
 * Robustness block computation status.
 */
export type CeeRobustnessStatus =
  | "computed"
  | "cannot_compute"
  | "requires_run"
  | "degraded";

/**
 * Robustness finding type classification.
 * Matches service schema: sensitivity, uncertainty, assumption, calibration
 */
export type CeeRobustnessFindingType =
  | "sensitivity"
  | "uncertainty"
  | "assumption"
  | "calibration";

/**
 * Finding within a robustness block.
 * Matches service schema for RobustnessFinding.
 */
export interface CeeRobustnessFinding {
  /** Finding identifier */
  id: string;
  /** Finding type classification */
  finding_type: CeeRobustnessFindingType;
  /** Severity level */
  severity: CeeBlockSeverity;
  /** Related node ID (if applicable) */
  node_id?: string;
  /** Display label */
  label: string;
  /** Finding description */
  description: string;
  /** Recommendation for addressing this finding */
  recommendation?: string;
  /** Impact score (0-1) */
  impact_score?: number;
}

/**
 * Robustness synthesis block from ISL analysis.
 *
 * This block is generated when ISL robustness data is provided to /assist/v1/review.
 * If no data is provided, the block has status 'requires_run'.
 * If data is degraded/failed, the block has status 'cannot_compute' or 'degraded'.
 */
export interface CeeRobustnessBlock {
  /** Block identifier */
  id: "robustness";
  /** Block type */
  type: "robustness";
  /** Robustness computation status */
  status: CeeRobustnessStatus;
  /** Reason for the status (if not 'computed') */
  status_reason?: string;
  /** Overall robustness score (0-1), present when status is 'computed' */
  overall_score?: number;
  /** Robustness findings */
  findings?: CeeRobustnessFinding[];
  /** Human-readable summary */
  summary?: string;
  /** Confidence in the assessment (0-1) */
  confidence?: number;
  /** Whether this is placeholder content */
  placeholder?: boolean;
  /** Generation timestamp */
  generated_at?: string;
}

/**
 * Decision review payload from the CEE service.
 */
export interface CeeDecisionReviewPayload {
  /** Intent classification */
  intent: CeeReviewIntent;
  /** Analysis state */
  analysis_state: CeeAnalysisState;
  /** Readiness assessment */
  readiness: CeeReadiness;
  /** Review blocks */
  blocks: CeeReviewBlock[];
  /** Index signature for extra fields (quality, guidance, archetype, etc.) */
  [key: string]: unknown;
}

/**
 * Trace information from the CEE service response.
 *
 * CRITICAL: `request_id` MUST be present. The SDK throws CEE_PROTOCOL_ERROR
 * if it is missing from the service response.
 */
export interface CeeReviewTrace {
  /** Request identifier - MUST be present */
  request_id: string;
  /** Total processing latency in milliseconds */
  latency_ms: number;
  /** Model version used for the review */
  model: string;
}

/**
 * Normalized response from CeeClient.review().
 *
 * INVARIANT: `trace.request_id` is always present. If the service response
 * is missing it, the SDK throws CEE_PROTOCOL_ERROR.
 */
export interface CeeReviewResponse {
  /**
   * The decision review payload.
   * Contains intent, analysis_state, readiness, blocks, and any extra fields.
   */
  review: CeeDecisionReviewPayload;

  /**
   * Trace information extracted from the service response.
   * INVARIANT: `request_id` is always present.
   */
  trace: CeeReviewTrace;

  /**
   * HTTP response headers with lowercase keys.
   */
  headers: Record<string, string>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes specific to the CEE client.
 */
export type CeeClientErrorCode =
  | "CEE_PROTOCOL_ERROR"      // Missing required fields (e.g., trace.request_id)
  | "CEE_NETWORK_ERROR"       // Network/transport failure
  | "CEE_TIMEOUT"             // Request timed out
  | "CEE_VALIDATION_FAILED"   // Input validation failed
  | "CEE_RATE_LIMIT"          // Rate limited
  | "CEE_INTERNAL_ERROR"      // Server-side error
  | "CEE_CONFIG_ERROR"        // Client configuration error
  | "CEE_ERROR";              // Generic error

// ============================================================================
// Legacy Re-exports (for backwards compatibility)
// ============================================================================

// These types are kept for backwards compatibility with existing code
export type {
  CeeGraphSnapshot as ReviewGraphSnapshot,
  CeeReviewBlock as ReviewBlock,
};
