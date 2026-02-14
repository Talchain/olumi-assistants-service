/**
 * Analysis-Ready Output Schema
 *
 * P0 Schema for direct pass-through to PLoT analysis engine.
 * Key requirement: interventions must be Record<string, number> (plain numbers).
 *
 * Supports the Raw+Encoded pattern for categorical/boolean interventions:
 * - interventions: Record<string, number> (always numeric for PLoT)
 * - raw_interventions: Record<string, number|string|boolean> (original values)
 *
 * @see CEE Workstream — Analysis-Ready Output (Complete Specification)
 */

import { z } from "zod";

// ============================================================================
// Option for Analysis
// ============================================================================

/**
 * Extraction metadata for transparency.
 */
export const ExtractionMetadata = z.object({
  /** How the values were determined */
  source: z.enum(["brief_extraction", "cee_hypothesis", "user_specified"]),
  /** Confidence in the extraction */
  confidence: z.enum(["high", "medium", "low"]),
  /** Explanation for transparency */
  reasoning: z.string().optional(),
}).passthrough(); // CIL Phase 0.2: preserve additive fields
export type ExtractionMetadataT = z.infer<typeof ExtractionMetadata>;

/**
 * Raw intervention value - supports numeric, categorical, or boolean.
 */
export const RawInterventionValue = z.union([
  z.number(),
  z.string(),
  z.boolean(),
]);
export type RawInterventionValueT = z.infer<typeof RawInterventionValue>;

/**
 * Option status values for analysis-ready payload.
 * - ready: All interventions encoded as numbers, ready for PLoT
 * - needs_user_mapping: Missing factor matches or values
 * - needs_encoding: Has raw values (categorical/boolean) awaiting numeric encoding
 */
export const OptionForAnalysisStatus = z.enum(["ready", "needs_user_mapping", "needs_encoding"]);
export type OptionForAnalysisStatusT = z.infer<typeof OptionForAnalysisStatus>;

// Compile-time guard: needs_user_input is payload-level only, never option-level (CIL Step 12)
type _AssertNeedsUserInputNotOptionStatus =
  "needs_user_input" extends OptionForAnalysisStatusT ? never : true;
const _assertOptionStatusExcludesNeedsUserInput: _AssertNeedsUserInputNotOptionStatus = true;
void _assertOptionStatusExcludesNeedsUserInput;

/**
 * Option ready for analysis - interventions are plain numbers.
 *
 * Supports the Raw+Encoded pattern for categorical/boolean interventions:
 * - interventions: Record<string, number> (always numeric for PLoT compatibility)
 * - raw_interventions: Record<string, number|string|boolean> (original values)
 *
 * For purely numeric decisions, raw_interventions is omitted.
 * For categorical/boolean, raw_interventions preserves "UK", true, etc.
 */
export const OptionForAnalysis = z.object({
  /** Option ID - must match a node in graph.nodes where kind="option" */
  id: z.string(),
  /** Human-readable label */
  label: z.string(),
  /** Option readiness status - required for UI to know if option can be used */
  status: OptionForAnalysisStatus,
  /** Reason for status determination (for debugging/transparency) */
  status_reason: z.string().optional(),
  /** Interventions: factor_id -> numeric value (ALWAYS numeric for PLoT) */
  interventions: z.record(z.string(), z.number()),
  // --- Raw+Encoded pattern: parallel raw values (additive field) ---
  /** Raw intervention values before encoding (for categorical/boolean) */
  raw_interventions: z.record(z.string(), RawInterventionValue).optional(),
  /** Extraction metadata for transparency */
  extraction_metadata: ExtractionMetadata.optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields
export type OptionForAnalysisT = z.infer<typeof OptionForAnalysis>;

// ============================================================================
// Analysis Blockers (Phase 2B)
// ============================================================================

/**
 * Blocker type for analysis-ready payload.
 * Identifies why an option-factor pair can't produce an intervention magnitude.
 */
export const AnalysisBlockerType = z.enum(["missing_value", "ambiguous_value", "missing_connection", "constraint_dropped"]);

/**
 * Suggested action to resolve a blocker.
 */
export const AnalysisBlockerAction = z.enum(["add_value", "confirm_value", "add_edge", "review_constraint"]);

/**
 * Blocker entry for an option-factor pair that can't produce an intervention magnitude.
 * Emitted when a controllable factor connected to an option has neither
 * observed_state.value nor data.value.
 */
export const AnalysisBlocker = z.object({
  /** Which option needs this input (undefined = applies to all) */
  option_id: z.string().optional(),
  /** Human-readable option label */
  option_label: z.string().optional(),
  /** Factor node ID */
  factor_id: z.string(),
  /** Human-readable factor label */
  factor_label: z.string(),
  /** Type of blocker */
  blocker_type: AnalysisBlockerType,
  /** Actionable message for the user */
  message: z.string(),
  /** Suggested action to resolve */
  suggested_action: AnalysisBlockerAction,
});
export type AnalysisBlockerT = z.infer<typeof AnalysisBlocker>;

// ============================================================================
// Model Adjustments (Phase 2C)
// ============================================================================

/**
 * User-facing code describing what the system adjusted.
 * Maps from internal STRP/repair codes to human-friendly labels.
 */
export const ModelAdjustmentCode = z.enum([
  "category_reclassified",
  "connectivity_repaired",
  "risk_coefficient_corrected",
  "data_filled",
  "enum_corrected",
]);

/**
 * A model adjustment surfaced to the user.
 * Represents a repair or reconciliation mutation made by the pipeline.
 */
export const ModelAdjustment = z.object({
  /** User-facing adjustment code */
  code: ModelAdjustmentCode,
  /** Affected node ID */
  node_id: z.string().optional(),
  /** Affected edge ID */
  edge_id: z.string().optional(),
  /** Field that was modified */
  field: z.string(),
  /** Value before adjustment */
  before: z.unknown().optional(),
  /** Value after adjustment */
  after: z.unknown().optional(),
  /** Human-readable explanation */
  reason: z.string(),
});
export type ModelAdjustmentT = z.infer<typeof ModelAdjustment>;

// ============================================================================
// Analysis Ready Payload
// ============================================================================

/**
 * Status enum for analysis-ready payload.
 * - ready: All interventions encoded, ready for PLoT analysis
 * - needs_user_mapping: Missing factor matches or values
 * - needs_encoding: Has raw values (categorical/boolean) awaiting numeric encoding
 * - needs_user_input: Blockers exist — user must provide missing factor values
 */
export const AnalysisReadyStatus = z.enum([
  "ready",
  "needs_user_mapping",
  "needs_encoding",
  "needs_user_input",
]);
export type AnalysisReadyStatusT = z.infer<typeof AnalysisReadyStatus>;

/**
 * Complete analysis-ready payload.
 * Can be sent directly to PLoT without transformation.
 *
 * Supports the Raw+Encoded pattern at the payload level:
 * - When status is "ready", all options have encoded numeric interventions
 * - When status is "needs_encoding", some options have raw values awaiting encoding
 * - When status is "needs_user_input", blockers identify missing factor values
 */
export const AnalysisReadyPayload = z.object({
  /** Options with numeric interventions */
  options: z.array(OptionForAnalysis),
  /** Goal node ID - must match a goal node in graph */
  goal_node_id: z.string(),
  /** Status: ready, needs_user_mapping, needs_encoding, or needs_user_input */
  status: AnalysisReadyStatus,
  /** Questions for user when status is needs_user_mapping */
  user_questions: z.array(z.string()).optional(),
  /** Blockers identifying missing factor values (Phase 2B) */
  blockers: z.array(AnalysisBlocker).optional(),
  /** Model adjustments surfaced from STRP/repair mutations (Phase 2C) */
  model_adjustments: z.array(ModelAdjustment).optional(),
}).passthrough(); // CIL Phase 0: preserve additive fields
export type AnalysisReadyPayloadT = z.infer<typeof AnalysisReadyPayload>;

// ============================================================================
// Extended Response Type
// ============================================================================

/**
 * Draft-graph response with analysis_ready payload.
 * This extends the existing response with the new field.
 */
export interface DraftGraphResponseWithAnalysisReady {
  /** Causal graph for canvas visualisation */
  graph: {
    nodes: Array<{
      id: string;
      kind: string;
      label?: string;
      body?: string;
      data?: Record<string, unknown>;
    }>;
    edges: Array<{
      id?: string;
      from: string;
      to: string;
      weight?: number;
      belief?: number;
      effect_direction?: "positive" | "negative";
      provenance?: string | { source: string; quote?: string };
    }>;
  };

  /** NEW: Ready-to-use analysis payload */
  analysis_ready: AnalysisReadyPayloadT;

  /** Quality metrics */
  quality?: {
    overall: number;
    structure?: number;
    coverage?: number;
    causality?: number;
    safety?: number;
  };

  /** Validation issues */
  validation_issues?: Array<{
    code: string;
    message: string;
    severity?: string;
  }>;

  /** Trace metadata */
  trace?: {
    request_id?: string;
    correlation_id?: string;
    engine?: Record<string, unknown>;
  };
}
