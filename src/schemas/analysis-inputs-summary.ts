/**
 * Analysis Inputs Summary — post-analysis intelligence for UI consumption.
 * Contract owner: CEE
 * UI is the sole production assembler (has V2RunResponse in store).
 * CEE provides reference implementation for testing only.
 * Canonical fixture: tools/fixtures/canonical/analysis-inputs-summary.json
 * Shape changes require: version bump + UI type update.
 */

import { z } from "zod";

/**
 * Contract version for the analysis-inputs summary payload.
 * Bump on any breaking change. See governance rule in header comment.
 */
export const ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION = '1.0.0';

// ============================================================================
// Sub-schemas
// ============================================================================

const RecommendationSchema = z.object({
  option_id: z.string(),
  option_label: z.string(),
  win_probability: z.number().min(0).max(1),
});

const OptionSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  win_probability: z.number().min(0).max(1),
});

const DriverSchema = z.object({
  factor_id: z.string(),
  factor_label: z.string(),
  elasticity: z.number(),
});

const RobustnessSchema = z.object({
  level: z.enum(['robust', 'moderate', 'fragile']),
  recommendation_stability: z.number().min(0).max(1).nullable(),
});

const ConstraintStatusSchema = z.object({
  label: z.string(),
  satisfied: z.boolean(),
  probability: z.number().min(0).max(1).optional(),
});

const RunMetadataSchema = z.object({
  seed: z.number(),
  quality_mode: z.string(),
  timestamp: z.string(),
});

// ============================================================================
// Main payload
// ============================================================================

export const AnalysisInputsSummaryPayload = z.object({
  contract_version: z.literal(ANALYSIS_INPUTS_SUMMARY_CONTRACT_VERSION),
  recommendation: RecommendationSchema,
  options: z.array(OptionSummarySchema).min(1),
  top_drivers: z.array(DriverSchema).max(3),
  sensitivity_concentration: z.number().min(0).max(1),
  confidence_band: z.enum(['low', 'medium', 'high']).nullable(),
  robustness: RobustnessSchema,
  constraints_status: z.array(ConstraintStatusSchema).max(5),
  run_metadata: RunMetadataSchema,
}).refine(
  (val) => new TextEncoder().encode(JSON.stringify(val)).length <= 2048,
  { message: 'Serialized payload exceeds 2048 byte limit' },
);

export type AnalysisInputsSummary = z.infer<typeof AnalysisInputsSummaryPayload>;
