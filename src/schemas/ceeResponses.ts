import { z } from "zod";
import { DraftGraphOutput } from "./assist.js";
import { PreferenceQuestionSchema, UserPreferencesSchema } from "./cee.js";

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

// Graph Readiness Assessment schemas

export const CEEQualityFactorV1Schema = z.object({
  factor: z.enum([
    "causal_detail",
    "weight_refinement",
    "risk_coverage",
    "outcome_balance",
    "option_diversity",
  ]),
  current_score: z.number().int().min(0).max(100),
  impact: z.enum(["high", "medium", "low"]),
  recommendation: z.string(),
  potential_improvement: z.number().int().min(0).max(100),
});

export type CEEQualityFactorV1T = z.infer<typeof CEEQualityFactorV1Schema>;

export const CEEGraphReadinessResponseV1Schema = z
  .object({
    readiness_score: z.number().int().min(0).max(100),
    readiness_level: z.enum(["ready", "fair", "needs_work"]),
    confidence_level: z.enum(["high", "medium", "low"]),
    confidence_explanation: z.string(),
    quality_factors: z.array(CEEQualityFactorV1Schema),
    can_run_analysis: z.boolean(),
    blocker_reason: z.string().optional(),
    trace: CEETraceMetaSchema,
  })
  .passthrough();

export type CEEGraphReadinessResponseV1T = z.infer<typeof CEEGraphReadinessResponseV1Schema>;

// Headline structured data for flexible UI rendering
export const CEEHeadlineStructuredV1Schema = z.object({
  goal_text: z.string().nullable(),
  action: z.string(),
  outcome_type: z.enum(["positive", "negative", "neutral"]),
  likelihood: z.number().min(0).max(1),
  vs_baseline: z.number().nullable(),
  vs_baseline_direction: z.enum(["better", "worse", "same"]).nullable(),
  ranking_confidence: z.enum(["low", "medium", "high"]),
  is_close_race: z.boolean(),
});

export type CEEHeadlineStructuredV1T = z.infer<typeof CEEHeadlineStructuredV1Schema>;

// Key Insight Response schema
export const CEEKeyInsightResponseV1Schema = z
  .object({
    headline: z.string(),
    headline_structured: CEEHeadlineStructuredV1Schema.optional(),
    primary_driver: z.string(),
    confidence_statement: z.string(),
    caveat: z.string().optional(),
    evidence: z.array(z.string()).optional(),
    next_steps: z.array(z.string()).optional(),
    // Recommendation status based on identifiability
    // actionable = causal effects confirmed, proceed with confidence
    // exploratory = treat as scenario analysis, gather more data
    recommendation_status: z.enum(["actionable", "exploratory"]).optional(),
    // Identifiability acknowledgement for transparency
    identifiability_note: z.string().optional(),
    quality: CEEQualityMetaSchema,
    trace: CEETraceMetaSchema,
    provenance: z.literal("cee"),
  })
  .passthrough();

export type CEEKeyInsightResponseV1T = z.infer<typeof CEEKeyInsightResponseV1Schema>;

// Belief Elicitation Response schema
export const CEEElicitBeliefOptionSchema = z.object({
  label: z.string(),
  value: z.number().min(0).max(1),
});

export const CEEElicitBeliefResponseV1Schema = z
  .object({
    suggested_value: z.number().min(0).max(1),
    confidence: z.enum(["high", "medium", "low"]),
    reasoning: z.string(),
    needs_clarification: z.boolean(),
    clarifying_question: z.string().optional(),
    options: z.array(CEEElicitBeliefOptionSchema).optional(),
    provenance: z.literal("cee"),
    trace: CEETraceMetaSchema.optional(),
  })
  .passthrough();

export type CEEElicitBeliefResponseV1T = z.infer<typeof CEEElicitBeliefResponseV1Schema>;

// Utility Weight Suggestion schemas
export const CEEWeightSuggestionItemV1Schema = z.object({
  node_id: z.string(),
  node_label: z.string(),
  suggested_weight: z.number().min(0).max(1),
  reasoning: z.string(),
});

export const CEEAlternativeWeightingV1Schema = z.object({
  name: z.string(),
  description: z.string(),
  weights: z.array(
    z.object({
      node_id: z.string(),
      weight: z.number().min(0).max(1),
    })
  ),
});

export const CEEUtilityWeightResponseV1Schema = z
  .object({
    suggestions: z.array(CEEWeightSuggestionItemV1Schema),
    reasoning: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    alternatives: z.array(CEEAlternativeWeightingV1Schema).optional(),
    provenance: z.literal("cee"),
    trace: CEETraceMetaSchema.optional(),
  })
  .passthrough();

export type CEEUtilityWeightResponseV1T = z.infer<typeof CEEUtilityWeightResponseV1Schema>;

// Risk Tolerance Elicitation schemas

// Option for a risk tolerance question
export const CEERiskToleranceOptionV1Schema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  risk_score: z.number().min(0).max(100),
});

// Question for risk tolerance assessment
export const CEERiskToleranceQuestionV1Schema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(CEERiskToleranceOptionV1Schema),
});

// Response for get_questions mode
export const CEERiskToleranceGetQuestionsResponseV1Schema = z
  .object({
    questions: z.array(CEERiskToleranceQuestionV1Schema),
    provenance: z.literal("cee"),
    trace: CEETraceMetaSchema.optional(),
  })
  .passthrough();

// Risk profile
export const CEERiskProfileV1Schema = z.object({
  type: z.enum(["risk_averse", "risk_neutral", "risk_seeking"]),
  score: z.number().min(0).max(100),
  reasoning: z.string(),
  recommended_coefficient: z.number().min(0).max(1),
});

// Risk breakdown by category
export const CEERiskBreakdownV1Schema = z.object({
  certainty: z.number().min(0).max(100),
  loss_aversion: z.number().min(0).max(100),
  time_preference: z.number().min(0).max(100),
});

// Response for process_responses mode
export const CEERiskToleranceProcessResponsesResponseV1Schema = z
  .object({
    profile: CEERiskProfileV1Schema,
    breakdown: CEERiskBreakdownV1Schema,
    confidence: z.enum(["high", "medium", "low"]),
    provenance: z.literal("cee"),
    trace: CEETraceMetaSchema.optional(),
  })
  .passthrough();

export type CEERiskToleranceGetQuestionsResponseV1T = z.infer<
  typeof CEERiskToleranceGetQuestionsResponseV1Schema
>;
export type CEERiskToleranceProcessResponsesResponseV1T = z.infer<
  typeof CEERiskToleranceProcessResponsesResponseV1Schema
>;

// Edge Function Suggestion schemas

export const EdgeFunctionTypeSchema = z.enum([
  "linear",
  "diminishing_returns",
  "threshold",
  "s_curve",
]);

export const EdgeFunctionParamsSchema = z.object({
  k: z.number().optional(),
  threshold: z.number().optional(),
  slope: z.number().optional(),
  midpoint: z.number().optional(),
});

export const EdgeFunctionAlternativeSchema = z.object({
  function_type: EdgeFunctionTypeSchema,
  params: EdgeFunctionParamsSchema,
  reasoning: z.string(),
});

export const CEEEdgeFunctionSuggestionResponseV1Schema = z
  .object({
    suggested_function: EdgeFunctionTypeSchema,
    suggested_params: EdgeFunctionParamsSchema,
    reasoning: z.string(),
    alternatives: z.array(EdgeFunctionAlternativeSchema),
    confidence: z.enum(["high", "medium", "low"]),
    provenance: z.literal("cee"),
    trace: CEETraceMetaSchema.optional(),
  })
  .passthrough();

export type CEEEdgeFunctionSuggestionResponseV1T = z.infer<
  typeof CEEEdgeFunctionSuggestionResponseV1Schema
>;

// Generate Recommendation Response schema
export const CEEGenerateRecommendationResponseV1Schema = z
  .object({
    headline: z.string(),
    recommendation_narrative: z.string(),
    confidence_statement: z.string(),
    alternatives_summary: z.string().optional(),
    caveat: z.string().optional(),
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    provenance: z.literal("cee"),
  })
  .passthrough();

export type CEEGenerateRecommendationResponseV1T = z.infer<
  typeof CEEGenerateRecommendationResponseV1Schema
>;

// Narrate Conditions Response schema
export const CEEConditionSummaryV1Schema = z.object({
  condition: z.string(),
  if_true_action: z.string(),
  if_false_action: z.string(),
});

export const CEENarrateConditionsResponseV1Schema = z
  .object({
    narrative: z.string(),
    conditions_summary: z.array(CEEConditionSummaryV1Schema),
    key_decision_points: z.array(z.string()),
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    provenance: z.literal("cee"),
  })
  .passthrough();

export type CEENarrateConditionsResponseV1T = z.infer<
  typeof CEENarrateConditionsResponseV1Schema
>;

// Explain Policy Response schema
export const CEEStepExplanationV1Schema = z.object({
  step: z.number().int(),
  action: z.string(),
  explanation: z.string(),
});

export const CEEExplainPolicyResponseV1Schema = z
  .object({
    policy_narrative: z.string(),
    steps_explained: z.array(CEEStepExplanationV1Schema),
    dependencies_explained: z.string().optional(),
    trace: CEETraceMetaSchema,
    quality: CEEQualityMetaSchema,
    provenance: z.literal("cee"),
  })
  .passthrough();

export type CEEExplainPolicyResponseV1T = z.infer<
  typeof CEEExplainPolicyResponseV1Schema
>;

// ============================================================================
// Preference Elicitation Response Schemas
// ============================================================================

// Elicit Preferences Response
export const CEEElicitPreferencesResponseV1Schema = z
  .object({
    questions: z.array(PreferenceQuestionSchema),
    estimated_value: z.number().min(0).max(1),
    trace: CEETraceMetaSchema,
    provenance: z.literal("cee"),
  })
  .passthrough();

export type CEEElicitPreferencesResponseV1T = z.infer<
  typeof CEEElicitPreferencesResponseV1Schema
>;

// Elicit Preferences Answer Response
export const CEEElicitPreferencesAnswerResponseV1Schema = z
  .object({
    updated_preferences: UserPreferencesSchema,
    recommendation_impact: z.string(),
    remaining_questions: z.number().int().min(0),
    next_question: PreferenceQuestionSchema.optional(),
    trace: CEETraceMetaSchema,
    provenance: z.literal("cee"),
  })
  .passthrough();

export type CEEElicitPreferencesAnswerResponseV1T = z.infer<
  typeof CEEElicitPreferencesAnswerResponseV1Schema
>;

// Key Factor for trade-off explanation
export const CEEKeyFactorV1Schema = z.object({
  factor: z.string(),
  impact: z.string(),
});

export type CEEKeyFactorV1T = z.infer<typeof CEEKeyFactorV1Schema>;

// Preference Alignment for trade-off explanation
export const CEEPreferenceAlignmentV1Schema = z.object({
  option_a_score: z.number(),
  option_b_score: z.number(),
  recommended: z.enum(["A", "B", "neutral"]),
});

export type CEEPreferenceAlignmentV1T = z.infer<typeof CEEPreferenceAlignmentV1Schema>;

// Explain Tradeoff Response
export const CEEExplainTradeoffResponseV1Schema = z
  .object({
    explanation: z.string(),
    key_factors: z.array(CEEKeyFactorV1Schema),
    preference_alignment: CEEPreferenceAlignmentV1Schema,
    trace: CEETraceMetaSchema,
    provenance: z.literal("cee"),
  })
  .passthrough();

export type CEEExplainTradeoffResponseV1T = z.infer<
  typeof CEEExplainTradeoffResponseV1Schema
>;
