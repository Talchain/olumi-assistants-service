/**
 * Analysis-Ready Output Schema
 *
 * P0 Schema for direct pass-through to PLoT analysis engine.
 * Key requirement: interventions must be Record<string, number> (plain numbers).
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
});
export type ExtractionMetadataT = z.infer<typeof ExtractionMetadata>;

/**
 * Option ready for analysis - interventions are plain numbers.
 */
export const OptionForAnalysis = z.object({
  /** Option ID - must match a node in graph.nodes where kind="option" */
  id: z.string(),
  /** Human-readable label */
  label: z.string(),
  /** Interventions: factor_id -> numeric value (NOT objects) */
  interventions: z.record(z.string(), z.number()),
  /** Extraction metadata for transparency */
  extraction_metadata: ExtractionMetadata.optional(),
});
export type OptionForAnalysisT = z.infer<typeof OptionForAnalysis>;

// ============================================================================
// Analysis Ready Payload
// ============================================================================

/**
 * Status enum for analysis-ready payload.
 * Aligned with UI vocabulary: 'ready' | 'needs_user_mapping'
 *
 * Accepts 'needs_user_input' as backwards-compatible input alias,
 * but ALWAYS outputs 'needs_user_mapping'.
 */
export const AnalysisReadyStatus = z
  .enum(["ready", "needs_user_mapping", "needs_user_input"])
  .transform((val) => (val === "needs_user_input" ? "needs_user_mapping" : val)) as z.ZodType<
  "ready" | "needs_user_mapping"
>;

/**
 * Complete analysis-ready payload.
 * Can be sent directly to PLoT without transformation.
 */
export const AnalysisReadyPayload = z.object({
  /** Options with numeric interventions */
  options: z.array(OptionForAnalysis),
  /** Goal node ID - must match a goal node in graph */
  goal_node_id: z.string(),
  /** Suggested seed for reproducibility */
  suggested_seed: z.string().default("42"),
  /** Status: ready to run or needs_user_mapping (requires user input) */
  status: AnalysisReadyStatus,
  /** Questions for user when status is needs_user_mapping */
  user_questions: z.array(z.string()).optional(),
});
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
