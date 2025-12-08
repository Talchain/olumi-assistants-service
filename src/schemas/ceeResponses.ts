import { z } from "zod";
import { DraftGraphOutput } from "./assist.js";

// Minimal Zod schemas for CEE response envelopes used by the verification
// pipeline. These are intentionally conservative and focus on required
// structural fields while allowing additional properties to avoid drift with
// the OpenAPI contract.

// CEE Clarifier schemas for multi-turn clarification integration
export const CEEClarifierMetadataV1Schema = z.object({
  targets_ambiguity: z.string(),
  expected_improvement: z.number().min(0).max(10),
  convergence_confidence: z.number().min(0).max(1),
  information_gain: z.number().min(0).max(1),
  // Enhancement 3.2: Expose convergence status/reason to clients
  convergence_status: z.enum(["continue", "complete", "max_rounds", "confident"]).optional(),
  convergence_reason: z.enum(["quality_threshold", "stability", "max_rounds", "diminishing_returns", "continue"]).optional(),
});

export const CEEClarifierBlockV1Schema = z.object({
  needs_clarification: z.boolean(),
  round: z.number().int().min(1).max(10),
  question_id: z.string(),
  question: z.string(),
  question_type: z.enum(["binary", "multiple_choice", "open_ended"]),
  options: z.array(z.string()).optional(),
  metadata: CEEClarifierMetadataV1Schema,
});

export type CEEClarifierBlockV1T = z.infer<typeof CEEClarifierBlockV1Schema>;
export type CEEClarifierMetadataV1T = z.infer<typeof CEEClarifierMetadataV1Schema>;

// Weight suggestion schema for uniform belief/weight detection
export const CEEWeightSuggestionV1Schema = z.object({
  edge_id: z.string(),
  from_node_id: z.string(),
  to_node_id: z.string(),
  current_belief: z.number().min(0).max(1),
  reason: z.enum([
    "uniform_distribution",
    "near_zero",
    "near_one",
    // Weight-specific reasons
    "uniform_weights",
    "weight_too_low",
    "weight_too_high",
  ]),
  suggestion: z.string().optional(),
  // Phase 2 additions: LLM-generated suggestions
  suggested_belief: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  rationale: z.string().optional(),
  // Recommendation flag: true = client should auto-apply without user confirmation (confidence >= 0.7)
  // false = requires manual review (confidence < 0.7). Server does NOT modify the graph.
  auto_applied: z.boolean().optional(),
  // Weight-specific fields
  current_weight: z.number().optional(),
  suggested_weight: z.number().min(0.3).max(1.5).optional(),
});

export type CEEWeightSuggestionV1T = z.infer<typeof CEEWeightSuggestionV1Schema>;

export const CEETraceMetaSchema = z
  .object({
    request_id: z.string().optional(),
    correlation_id: z.string().optional(),
    engine: z.record(z.any()).optional(),
    context_id: z.string().optional(),
  })
  .passthrough();

export const CEEQualityMetaSchema = z.object({
  overall: z.number(),
  structure: z.number().optional(),
  coverage: z.number().optional(),
  causality: z.number().optional(),
  safety: z.number().optional(),
  details: z.record(z.any()).optional(),
});

export const CEEDraftGraphResponseV1Schema = DraftGraphOutput.and(
  z
    .object({
      trace: CEETraceMetaSchema,
      quality: CEEQualityMetaSchema,
      validation_issues: z.array(z.record(z.any())).optional(),
      archetype: z
        .object({
          decision_type: z.string().optional(),
          match: z.enum(["exact", "fuzzy", "generic"]).optional(),
          confidence: z.number().min(0).max(1).optional(),
        })
        .optional(),
      seed: z.string().optional(),
      response_hash: z.string().optional(),
      response_limits: z
        .object({
          bias_findings_max: z.number().int().optional(),
          bias_findings_truncated: z.boolean().optional(),
          options_max: z.number().int().optional(),
          options_truncated: z.boolean().optional(),
          evidence_suggestions_max: z.number().int().optional(),
          evidence_suggestions_truncated: z.boolean().optional(),
          sensitivity_suggestions_max: z.number().int().optional(),
          sensitivity_suggestions_truncated: z.boolean().optional(),
        })
        .optional(),
      draft_warnings: z.array(z.record(z.any())).optional(),
      confidence_flags: z.record(z.any()).optional(),
      guidance: z.record(z.any()).optional(),
      // Multi-turn clarifier integration (Phase 1)
      clarifier: CEEClarifierBlockV1Schema.optional(),
      // Graph quality enhancement - Phase 1
      weight_suggestions: z.array(CEEWeightSuggestionV1Schema).optional(),
      comparison_suggested: z.boolean().optional(),
    })
    .passthrough(),
);

export type CEEDraftGraphResponseV1T = z.infer<typeof CEEDraftGraphResponseV1Schema>;

// Minimal schema for CEEExplainGraphResponseV1 used by the verification
// pipeline for the explain-graph endpoint. This mirrors the required fields
// from OpenAPI (trace, quality, explanation) and allows additional properties
// to remain forwards-compatible.
export const CEEExplainGraphResponseV1Schema = z
  .object({
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    validation_issues: z.array(z.record(z.any())).optional(),
    guidance: z.record(z.any()).optional(),
    explanation: z.record(z.any()),
  })
  .passthrough();

export type CEEExplainGraphResponseV1T = z.infer<typeof CEEExplainGraphResponseV1Schema>;

// Minimal schemas for the remaining CEE v1 response envelopes. These focus on
// required trace, quality, and payload fields, and allow additional
// properties to keep parity with OpenAPI without over-constraining tests.

export const CEEOptionsResponseV1Schema = z
  .object({
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    validation_issues: z.array(z.record(z.any())).optional(),
    options: z.array(z.record(z.any())),
    response_limits: z.record(z.any()).optional(),
    guidance: z.record(z.any()).optional(),
  })
  .passthrough();

export const CEEEvidenceHelperResponseV1Schema = z
  .object({
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    validation_issues: z.array(z.record(z.any())).optional(),
    items: z.array(z.record(z.any())),
    response_limits: z.record(z.any()).optional(),
    guidance: z.record(z.any()).optional(),
  })
  .passthrough();

export const CEEBiasCheckResponseV1Schema = z
  .object({
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    validation_issues: z.array(z.record(z.any())).optional(),
    bias_findings: z.array(z.record(z.any())),
    response_limits: z.record(z.any()).optional(),
    guidance: z.record(z.any()).optional(),
  })
  .passthrough();

export const CEESensitivityCoachResponseV1Schema = z
  .object({
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    validation_issues: z.array(z.record(z.any())).optional(),
    sensitivity_suggestions: z.array(z.record(z.any())),
    response_limits: z.record(z.any()).optional(),
    guidance: z.record(z.any()).optional(),
  })
  .passthrough();

export const CEETeamPerspectivesResponseV1Schema = z
  .object({
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    validation_issues: z.array(z.record(z.any())).optional(),
    summary: z.record(z.any()),
    guidance: z.record(z.any()).optional(),
  })
  .passthrough();
