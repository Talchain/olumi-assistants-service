import { z } from "zod";
import { DraftGraphOutput } from "./assist.js";

// Minimal Zod schemas for CEE response envelopes used by the verification
// pipeline. These are intentionally conservative and focus on required
// structural fields while allowing additional properties to avoid drift with
// the OpenAPI contract.

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
