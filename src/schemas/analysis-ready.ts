/**
 * Analysis-Ready Output Schema
 *
 * Contract owner: CEE
 * Canonical fixture: tools/fixtures/canonical/analysis-ready.json
 * UI boundary validator: DecisionGuideAI/src/canvas/conversation/validateAnalysisReadyContract.ts
 *
 * ANY shape change requires simultaneous updates to all three:
 * 1. This schema (version bump)
 * 2. Canonical fixture (regenerate via npm run generate:analysis-ready-fixture)
 * 3. UI adapter tests (update expectations in analysisReadyContract.spec.ts)
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

/**
 * Contract version for the analysis-ready payload shape.
 * Bump on any breaking change. See governance rule in header comment.
 */
export const ANALYSIS_READY_CONTRACT_VERSION = '1.0.0';

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
  /**
   * Interventions: factor_id -> numeric value (flat shape) OR rich object
   * { value, source?, display_value? } when a human-readable display string
   * is available. PLoT always receives the flat numeric form — callers that
   * forward to PLoT MUST flatten via flattenInterventions() first. The rich
   * form lets the UI render unit-aware display strings without a separate
   * intervention_details lookup.
   */
  interventions: z.record(
    z.string(),
    z.union([
      z.number(),
      z
        .object({
          value: z.number(),
          source: z.string().optional(),
          display_value: z.string().optional(),
        })
        .passthrough(),
    ]),
  ),
  // --- Raw+Encoded pattern: parallel raw values (additive field) ---
  /** Raw intervention values before encoding (for categorical/boolean) */
  raw_interventions: z.record(z.string(), RawInterventionValue).optional(),
  /** Extraction metadata for transparency */
  extraction_metadata: ExtractionMetadata.optional(),
  /** Marks the status-quo / baseline option. Propagated from OptionV3.is_baseline
   * or detected by label keyword in buildAnalysisReadyPayload (CEE-2). */
  is_baseline: z.boolean().optional(),
  /** Richer display-oriented intervention entries alongside the numeric-only
   * `interventions` map. Added by buildAnalysisReadyPayload (CEE-9/CEE-6). */
  intervention_details: z.record(z.string(), z.object({
    display_value: z.string(),
    normalised_value: z.number(),
    raw_value: z.number().optional(),
    unit: z.string().optional(),
  })).optional(),
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
  /** Origin of the adjustment (e.g., "strp", "deterministic_sweep") */
  source: z.string().optional(),
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
 * - blocked: Validation failure prevents analysis (invalid graph structure)
 */
export const AnalysisReadyStatus = z.enum([
  "ready",
  "needs_user_mapping",
  "needs_encoding",
  "needs_user_input",
  "blocked",
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
/**
 * V5 state-trust freshness verdict (additive on analysis_ready). Tells
 * the UI whether the analysis it can see is up to date with the current
 * graph. Populated on every primary CEE dispatch path that ships
 * analysis_ready (turn_executor, chip_click, draft_graph, edit_graph).
 * The field is `.optional()` for forward compatibility — additive
 * contract that future dispatch paths can adopt without breaking
 * existing UI consumers. Not "frequently absent in practice".
 *
 *   fresh   → analysis matches the current graph; render figures normally
 *   stale   → graph has changed since the analysis ran; UI may render a
 *             pill / rerun affordance
 *   unknown → freshness could not be derived (legacy fact missing the
 *             0.10.0 graph_hash_at_run, or no graph on this turn)
 *   none    → no successful run_analysis fact exists yet
 */
export const AnalysisFreshness = z.enum(['fresh', 'stale', 'unknown', 'none']);
export type AnalysisFreshnessT = z.infer<typeof AnalysisFreshness>;

export const AnalysisReadyPayload = z.object({
  /** Options with numeric interventions */
  options: z.array(OptionForAnalysis),
  /** Goal node ID - must match a goal node in graph */
  goal_node_id: z.string(),
  /** Status: ready, needs_user_mapping, needs_encoding, or needs_user_input */
  status: AnalysisReadyStatus,
  /**
   * ROADMAP 2.1091 / golden-journey EXT-2 — stable machine-readable code for
   * WHY this turn's analysis was refused. Present iff `status === 'blocked'`.
   * See the contract note on `GraphPatchBlockData.analysis_ready` in
   * src/orchestrator/types.ts; written only by `buildAnalysisRefusalReadiness`.
   */
  blocked_reason: z.string().min(1).optional(),
  /** Questions for user when status is needs_user_mapping */
  user_questions: z.array(z.string()).optional(),
  /** Blockers identifying missing factor values (Phase 2B) */
  blockers: z.array(AnalysisBlocker).optional(),
  /** Model adjustments surfaced from STRP/repair mutations (Phase 2C) */
  model_adjustments: z.array(ModelAdjustment).optional(),
  /** Goal threshold (normalised 0–1 probability from the goal node) */
  goal_threshold: z.number().optional(),
  /**
   * ROADMAP 2.315(a) — the RAW goal target, as the user stated it.
   *
   * `goal_threshold` above is NORMALISED (raw / cap), which is the only form
   * that reached consumers until now. A £800,000 target therefore surfaced on
   * Inspector v2 as "Success means reaching ≥ 0.8 count" — a correct
   * normalised number that no consumer could turn back into the user's own
   * figure, because the raw value, its unit and the normalisation denominator
   * never left CEE. This trio is that missing information.
   *
   * ⚠ CARRIED, NEVER RECOMPUTED. These are the values the enricher ATTESTED
   * on the goal node at mint time (see `applyGoalTargetRedirect` in
   * cee/factor-extraction/enricher.ts and the add_constraint handler, both
   * delegating to `resolveGoalThresholdCap`). A consumer — or a later CEE
   * stage — must NOT re-derive them: `raw = goal_threshold * cap` and the
   * 25%-headroom cap doctrine are each defensible but can disagree with the
   * cap the graph was ACTUALLY scored against (an existing compatible cap
   * wins over fresh headroom, and '%' normalises against 100). Re-deriving
   * silently produces a number the analysis never used.
   *
   * All three are independently optional: a qualitative goal has no numeric
   * target at all, and absence means absent — never defaulted, never 0.
   */
  /** Raw threshold in the user's own units (e.g. 800000 for "£800,000"). */
  goal_threshold_raw: z.number().optional(),
  /** Display unit for the raw threshold (e.g. "£", "%", "customers"). */
  goal_threshold_unit: z.string().optional(),
  /** Normalisation denominator: goal_threshold = goal_threshold_raw / cap. */
  goal_threshold_cap: z.number().optional(),
  /** Bias findings from structural heuristic detectors (same shape as CEEBiasFindingV1).
   *  Empty array when no biases detected. Always present for stable UI consumption. */
  bias_findings: z.array(z.object({
    id: z.string(),
    category: z.string(),
    severity: z.string(),
    node_ids: z.array(z.string()).optional(),
    explanation: z.string().optional(),
    code: z.string().optional(),
  }).passthrough()).default([]),
  // V5 state-trust additive fields (CEE → UI). All optional so
  // pre-state-trust dispatch paths still validate.
  /** Freshness verdict (see AnalysisFreshness). */
  freshness: AnalysisFreshness.optional(),
  /** Stable string code for the freshness reason. UI does NOT render
   *  this directly — surface for debugging / telemetry / contract tests. */
  freshness_reason: z.string().optional(),
  /** Hash of the analysis-affecting graph fields at the moment
   *  run_analysis executed. Present when freshness is fresh / stale. */
  graph_hash_at_run: z.string().optional(),
  /** Hash of the analysis-affecting graph fields on this turn. Present
   *  when the turn has graph state. UI compares against
   *  graph_hash_at_run to confirm freshness independently. */
  current_graph_hash: z.string().optional(),
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
    structural_proxy?: number;
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
