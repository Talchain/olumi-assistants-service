/**
 * CEE Observability Types
 *
 * Types for tracking LLM calls, validation, and orchestrator activity
 * within the CEE pipeline for debug panel visibility.
 *
 * Key features:
 * - LLM call tracking with raw prompts/responses (when enabled)
 * - Validation attempt tracking with rule-level detail
 * - Orchestrator step tracking
 * - Aggregated totals for quick overview
 *
 * @see CEE_OBSERVABILITY_ENABLED feature flag
 */

// ============================================================================
// LLM Call Tracking
// ============================================================================

/**
 * Single LLM call record.
 * Captures timing, model info, token usage, and optionally raw I/O.
 */
export interface LLMCallRecord {
  /** Unique call ID */
  id: string;
  /** Pipeline step that made this call */
  step: LLMCallStep;
  /** Model ID used */
  model: string;
  /** Provider (anthropic, openai) */
  provider: "anthropic" | "openai";
  /** Token usage */
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  /** Call latency in milliseconds */
  latency_ms: number;
  /** Attempt number (1 = first try, 2+ = retry) */
  attempt: number;
  /** Whether the call succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Timestamp when call started */
  started_at: string;
  /** Timestamp when call completed */
  completed_at: string;
  /**
   * Raw prompt sent to LLM (only included if CEE_OBSERVABILITY_RAW_IO=true).
   * Redacted in production unless explicitly enabled.
   */
  raw_prompt?: string;
  /**
   * Raw response from LLM (only included if CEE_OBSERVABILITY_RAW_IO=true).
   * Redacted in production unless explicitly enabled.
   */
  raw_response?: string;
  /** SHA-256 hash of raw prompt (only included when raw_prompt is available) */
  prompt_hash?: string;
  /** SHA-256 hash of raw response (only included when raw_response is available) */
  response_hash?: string;
  /** Prompt version/template used */
  prompt_version?: string;
  /** Cache hit indicator */
  cache_hit?: boolean;
}

/**
 * Pipeline steps that make LLM calls.
 */
export type LLMCallStep =
  | "draft_graph"
  | "repair_graph"
  | "suggest_options"
  | "clarify_brief"
  | "critique_graph"
  | "explain_diff"
  | "factor_extraction"
  | "constraint_extraction"
  | "factor_enrichment"
  | "other";

// ============================================================================
// Validation Tracking
// ============================================================================

/**
 * Validation attempt record.
 */
export interface ValidationAttemptRecord {
  /** Attempt number (1-indexed) */
  attempt: number;
  /** Whether validation passed */
  passed: boolean;
  /** Total rules checked */
  rules_checked: number;
  /** Rules that failed */
  rules_failed: string[];
  /** Whether repairs were triggered */
  repairs_triggered: boolean;
  /** Repair types attempted */
  repair_types?: string[];
  /** Whether retry was triggered */
  retry_triggered: boolean;
  /** Validation latency in milliseconds */
  latency_ms: number;
  /** Timestamp */
  timestamp: string;
  /** Validator name/source */
  validator?: string;
  /** Warnings generated (non-blocking) */
  warnings?: string[];
}

/**
 * Aggregated validation tracking.
 */
export interface ValidationTracking {
  /** Total validation attempts */
  attempts: number;
  /** Whether final validation passed */
  passed: boolean;
  /** Total rules checked across all attempts */
  total_rules_checked: number;
  /** All failed rules (deduplicated) */
  failed_rules: string[];
  /** Whether any repairs were triggered */
  repairs_triggered: boolean;
  /** All repair types attempted */
  repair_types: string[];
  /** Whether any retry was triggered */
  retry_triggered: boolean;
  /** Individual attempt records */
  attempt_records: ValidationAttemptRecord[];
  /** Total validation time in milliseconds */
  total_latency_ms: number;
}

// ============================================================================
// Orchestrator Tracking
// ============================================================================

/**
 * Orchestrator step record.
 */
export interface OrchestratorStepRecord {
  /** Step name */
  step: string;
  /** Whether step was executed */
  executed: boolean;
  /** Why step was skipped (if not executed) */
  skip_reason?: string;
  /** Step latency in milliseconds */
  latency_ms: number;
  /** Timestamp */
  timestamp: string;
  /** Step-specific metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Orchestrator tracking.
 */
export interface OrchestratorTracking {
  /** Whether orchestrator was enabled */
  enabled: boolean;
  /** Completed steps */
  steps_completed: string[];
  /** Skipped steps */
  steps_skipped: string[];
  /** Total orchestrator latency in milliseconds */
  total_latency_ms: number;
  /** Individual step records */
  step_records: OrchestratorStepRecord[];
}

// ============================================================================
// Aggregated Totals
// ============================================================================

/**
 * Aggregated totals for quick overview.
 */
export interface ObservabilityTotals {
  /** Total LLM calls made */
  total_llm_calls: number;
  /** Total tokens used */
  total_tokens: {
    input: number;
    output: number;
    total: number;
  };
  /**
   * Sum of component latencies in milliseconds.
   * Note: This is the sum of individual operation latencies, not wall-clock time.
   * May exceed actual elapsed time if operations overlap or run in parallel.
   */
  total_latency_ms: number;
  /** CEE version */
  cee_version: string;
}

// ============================================================================
// Complete Observability Object
// ============================================================================

/**
 * Complete CEE observability metadata.
 * Included in response when CEE_OBSERVABILITY_ENABLED=true.
 */
export interface CEEObservability {
  /** LLM call records */
  llm_calls: LLMCallRecord[];
  /** Validation tracking */
  validation: ValidationTracking;
  /** Orchestrator tracking */
  orchestrator: OrchestratorTracking;
  /** Aggregated totals */
  totals: ObservabilityTotals;
  /** Request ID for correlation */
  request_id: string;
  /** Whether raw I/O is included */
  raw_io_included: boolean;
}

// ============================================================================
// Collector Options
// ============================================================================

/**
 * Options for creating an observability collector.
 */
export interface ObservabilityCollectorOptions {
  /** Request ID for correlation */
  requestId: string;
  /** CEE version */
  ceeVersion: string;
  /** Whether to capture raw I/O (prompts/responses) */
  captureRawIO?: boolean;
  /** Maximum length for raw prompt capture (truncates if longer) */
  maxPromptLength?: number;
  /** Maximum length for raw response capture (truncates if longer) */
  maxResponseLength?: number;
}
