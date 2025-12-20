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
  | "next_steps";

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
