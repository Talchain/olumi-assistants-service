/**
 * Validation Pipeline — Type Definitions
 *
 * All interfaces used by the two-pass graph parameter validation pipeline.
 * Pass 1 = Sonnet 4.6 (the graph drafter). Pass 2 = o4-mini (independent reviewer).
 *
 * Source of truth: validation_comparison_spec_v1_4.md and
 * validation_ui_data_contract_v1_1.md.
 */

// ============================================================================
// Enumerated string-literal types
// ============================================================================

/**
 * Why an edge was flagged as contested.
 * Multiple reasons may apply to a single edge.
 */
export type ContestedReason =
  | 'sign_flip'                        // causal direction reversed
  | 'strength_band_change'             // e.g. moderate vs weak
  | 'confidence_band_change'           // e.g. high vs moderate uncertainty
  | 'existence_boundary_crossing'      // crossed 0.5, 0.70, or 0.93
  | 'raw_magnitude';                   // |Δmean| > 0.20

/**
 * What grounded the Pass 2 estimate.
 * Determines display framing in the calibration tray.
 */
export type EstimateBasis =
  | 'brief_explicit'                   // brief directly states this
  | 'structural_inference'             // derived from graph topology
  | 'domain_prior'                     // general domain knowledge
  | 'weak_guess';                      // thin brief, low signal

/**
 * User's resolution action on a contested edge.
 * Initial state is always 'pending'.
 */
export type UserAction =
  | 'pending'
  | 'accepted_pass1'
  | 'accepted_pass2'
  | 'overridden'
  | 'dismissed';

// ============================================================================
// Lint log
// ============================================================================

/**
 * Record of a single enforcement lint correction applied to Pass 2 output.
 * Stored in ValidationMetadata for auditability.
 */
export interface LintEntry {
  /** Lint code, e.g. 'LINT_BUDGET_RESCALE'. */
  code: string;
  /** Edge key in format 'from->to'. */
  edge_key: string;
  /** Value before correction. */
  before: number | boolean;
  /** Value after correction. */
  after: number | boolean;
}

// ============================================================================
// User resolution
// ============================================================================

/** Values the user chose when overriding both estimates. */
export interface ResolvedValue {
  strength_mean?: number;
  strength_std?: number;
  exists_probability?: number;
}

// ============================================================================
// ValidationMetadata — per-edge, attached as edge.validation
// ============================================================================

/**
 * Validation metadata attached to each causal edge after the two-pass pipeline.
 * Optional (absent if the pipeline was skipped or failed).
 * Consumed by the UI calibration tray and edge inspector.
 */
export interface ValidationMetadata {
  // ── Core classification ────────────────────────────────────────────────
  status: 'agreed' | 'contested';
  /** Empty when status === 'agreed'. */
  contested_reasons: ContestedReason[];

  // ── Pass 1 values (what the graph currently uses) ─────────────────────
  pass1: {
    strength_mean: number;
    strength_std: number;
    exists_probability: number;
  };

  // ── Pass 2 values (independent review) ────────────────────────────────
  pass2: {
    strength_mean: number;
    strength_std: number;
    exists_probability: number;
    reasoning: string;
    basis: EstimateBasis;
    needs_user_input: boolean;
    /** True if deterministic enforcement lints adjusted this estimate. */
    lint_corrected: boolean;
  };

  // ── Bias-adjusted Pass 2 values ────────────────────────────────────────
  pass2_adjusted: {
    strength_mean: number;
    strength_std: number;
    exists_probability: number;
  };

  // ── Bias correction offsets applied (for auditability) ────────────────
  bias_correction: {
    strength_mean_offset: number;
    strength_std_offset: number;
    exists_probability_offset: number;
  };

  // ── Ordering and priority (internal, not displayed to user) ───────────
  /** 0–1, higher = more disagreement. Used for calibration tray ordering. */
  max_divergence: number;
  /** Topological hops from this edge's target node to the goal node. */
  distance_to_goal: number;

  // ── Special flags ──────────────────────────────────────────────────────
  /** True when sign_flip is a contested reason. Convenience flag for UI. */
  sign_unstable: boolean;
  /**
   * True when Pass 2 did not return an estimate for this edge.
   * When true, status is forced to 'agreed' and pass2 fields are zeroed defaults.
   */
  pass2_missing: boolean;

  // ── Post-analysis enrichment (null until first MC run) ─────────────────
  evoi_rank: number | null;
  evoi_impact: number | null;

  // ── User interaction tracking ──────────────────────────────────────────
  was_shown: boolean;
  user_action: UserAction;
  resolved_value: ResolvedValue | null;
  resolved_by: 'default' | 'user';

  // ── Audit log ─────────────────────────────────────────────────────────
  validation_lint_log: LintEntry[];
}

// ============================================================================
// Pass 2 API types
// ============================================================================

/**
 * A single edge estimate from the Pass 2 (o4-mini) response.
 * Mirrors the JSON schema defined in validate_graph_v1_3.txt.
 */
export interface Pass2EdgeEstimate {
  from: string;
  to: string;
  strength: {
    mean: number;
    std: number;
  };
  exists_probability: number;
  reasoning: string;
  basis: EstimateBasis;
  needs_user_input: boolean;
}

/**
 * Full Pass 2 response object returned by o4-mini.
 * model_notes contains structural concerns (not parameter disagreements).
 */
export interface Pass2Response {
  edges: Pass2EdgeEstimate[];
  model_notes: string[];
}

// ============================================================================
// Bias correction
// ============================================================================

/**
 * Per-parameter systematic offsets between Pass 1 and Pass 2, computed as
 * median(pass1[param] - pass2[param]) across all edges in this graph.
 * Applied by adding offsets to raw Pass 2 values before comparison.
 */
export interface BiasOffsets {
  strength_mean: number;
  strength_std: number;
  exists_probability: number;
}

/**
 * A Pass 2 estimate after enforcement lints have been applied.
 * Same shape as Pass2EdgeEstimate but carries a lint_corrected flag.
 */
export interface LintedPass2Estimate extends Pass2EdgeEstimate {
  lint_corrected: boolean;
}

// ============================================================================
// Graph-level validation summary
// ============================================================================

/**
 * Summary attached at graph level (ctx.graph.validation_summary).
 * Not rendered by the UI calibration tray in v1 — available for the model tab
 * and coaching pipeline.
 */
export interface GraphValidationSummary {
  /** Structural concerns from Pass 2 model_notes. Not acted on in v1. */
  model_notes: string[];
  /** Total causal edges submitted to Pass 2. */
  total_edges_validated: number;
  /** Number of edges with status === 'contested'. */
  contested_count: number;
  /** Bias offsets computed across this graph. */
  bias_offsets: BiasOffsets;
  /** Wall-clock time for the Pass 2 API call (ms). */
  pass2_latency_ms: number;
  /** End-to-end validation pipeline wall-clock time (ms). */
  total_pipeline_latency_ms: number;
  /** Total number of lint corrections applied across all edges. */
  lint_corrections: number;
}

// ============================================================================
// Input shape for Pass 2 (minimal node/edge info sent to o4-mini)
// ============================================================================

/** Minimal node descriptor sent to o4-mini (no parameter values). */
export interface Pass2NodeInput {
  id: string;
  kind: string;
  label: string;
  category?: string;
}

/** Minimal edge descriptor sent to o4-mini (no strength or ep values). */
export interface Pass2EdgeInput {
  from: string;
  to: string;
  label?: string;
}

/** The full structured payload sent as the user message to o4-mini. */
export interface Pass2UserMessage {
  brief: string;
  nodes: Pass2NodeInput[];
  edges: Pass2EdgeInput[];
}
