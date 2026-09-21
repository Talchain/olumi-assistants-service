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
 * Model selection reason - explains why a particular model was used.
 */
export type ModelSelectionReason =
  | "explicit_override"
  | "prompt_config_staging"
  | "prompt_config_production"
  | "task_default"
  | "provider_default"
  | "provider_incompatible";

/**
 * Per-prompt model configuration.
 */
export interface PromptModelConfig {
  staging?: string;
  production?: string;
}

/**
 * Single LLM call record.
 * Captures timing, model info, token usage, and optionally raw I/O.
 */
export interface LLMCallRecord {
  /** Unique call ID */
  id: string;
  /** Pipeline step that made this call */
  step: LLMCallStep;
  /** Prompt ID used (e.g., "default:draft_graph") */
  prompt_id?: string;
  /** Model ID used */
  model: string;
  /** Provider (anthropic, openai) */
  provider: "anthropic" | "openai";
  /** Per-prompt model configuration (staging/production) */
  model_config?: PromptModelConfig;
  /** Why this model was selected */
  model_selection_reason?: ModelSelectionReason;
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
   * NEVER included in production regardless of flags.
   */
  raw_prompt?: string;
  /**
   * Raw response from LLM (only included if CEE_OBSERVABILITY_RAW_IO=true).
   * NEVER included in production regardless of flags.
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
 * Action taken after validation.
 */
export type ValidationAction = "proceed" | "trigger_repair" | "trigger_retry" | "fail";

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
  /** Action taken after this validation attempt */
  action_taken?: ValidationAction;
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
  /** Number of repair operations triggered */
  repairs_triggered: number;
  /** Number of retry operations triggered */
  retries: number;
  /** CEE version */
  cee_version: string;
}

// ============================================================================
// Graph Quality Metrics
// ============================================================================

/**
 * Graph quality metrics for monitoring and debugging.
 * Computed from the final validated/repaired graph.
 */
export interface GraphQualityMetrics {
  // Structure
  /** Total node count */
  node_count: number;
  /** Total edge count */
  edge_count: number;
  /** Factor node count */
  factor_count: number;
  /** Option node count */
  option_count: number;
  /** Outcome node count */
  outcome_count: number;
  /** Risk node count */
  risk_count: number;

  // Validation
  /** Whether final validation passed */
  validation_passed: boolean;
  /** Validation error codes */
  validation_errors: string[];
  /** Validation warning codes */
  validation_warnings: string[];
  /** Count of repairs applied */
  repairs_applied: number;
  /** Repair action codes */
  repair_codes: string[];

  // Topology
  /** Nodes with no edges */
  orphan_nodes: number;
  /** Number of disconnected subgraphs (should be 1 for valid graph) */
  disconnected_subgraphs: number;
  /** Longest path from decision to goal */
  max_path_depth: number;

  // Data Quality
  /** Factors with category field set */
  factors_with_category: number;
  /** Factors missing category field */
  factors_missing_category: number;
  /** Structural edges (decision→option, option→factor) */
  structural_edges: number;
  /** Causal edges (factor→factor, factor→outcome, etc.) */
  causal_edges: number;
  /** Edges that were repaired */
  edges_repaired: number;
}

// ============================================================================
// Graph Diff Tracking
// ============================================================================

/**
 * Type of graph modification during repair.
 */
export type GraphDiffType =
  | "node_added"
  | "node_removed"
  | "edge_added"
  | "edge_removed"
  | "edge_modified";

/**
 * Record of a single graph modification during repair.
 */
export interface GraphDiff {
  /** Type of modification */
  type: GraphDiffType;
  /** ID of the affected node or edge */
  target_id: string;
  /** State before modification (for removals and modifications) */
  before?: unknown;
  /** State after modification (for additions and modifications) */
  after?: unknown;
  /** Repair rule or reason that caused this change */
  repair_reason?: string;
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
  /** Graph quality metrics (computed after validation/repair) */
  graph_metrics?: GraphQualityMetrics;
  /** Graph diffs from repair operations */
  graph_diffs?: GraphDiff[];
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
