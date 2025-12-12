import { z } from "zod";
import { Graph } from "./graph.js";

export const CEEExplainGraphInput = z
  .object({
    graph: Graph,
    inference: z.object({
      summary: z.string().min(1),
      explain: z
        .object({
          top_drivers: z
            .array(
              z.object({
                node_id: z.string(),
                description: z.string().optional(),
                contribution: z.number().optional(),
              })
            )
            .default([]),
        })
        .optional(),
      model_card: z.record(z.any()).optional(),
      seed: z.string(),
      response_hash: z.string(),
    }),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEExplainGraphInputT = z.infer<typeof CEEExplainGraphInput>;

export const CEEEvidenceHelperInput = z
  .object({
    evidence: z
      .array(
        z
          .object({
            id: z.string(),
            type: z.enum([
              "experiment",
              "user_research",
              "market_data",
              "expert_opinion",
              "other",
            ]),
            source: z.string().optional(),
            content: z.string().optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

export type CEEEvidenceHelperInputT = z.infer<typeof CEEEvidenceHelperInput>;

export const CEEBiasCheckInput = z
  .object({
    graph: Graph,
    archetype: z
      .object({
        decision_type: z.string(),
        match: z.enum(["exact", "fuzzy", "generic"]),
        confidence: z.number().min(0).max(1),
      })
      .partial()
      .strict()
      .optional(),
    context_id: z.string().optional(),
    seed: z.string().optional(),
  })
  .strict();

export type CEEBiasCheckInputT = z.infer<typeof CEEBiasCheckInput>;

export const CEEOptionsInput = z
  .object({
    graph: Graph,
    archetype: z
      .object({
        decision_type: z.string(),
        match: z.enum(["exact", "fuzzy", "generic"]),
        confidence: z.number().min(0).max(1),
      })
      .partial()
      .strict()
      .optional(),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEOptionsInputT = z.infer<typeof CEEOptionsInput>;

export const CEESensitivityCoachInput = z
  .object({
    graph: Graph,
    inference: z.object({
      summary: z.string().min(1),
      explain: z
        .object({
          top_drivers: z
            .array(
              z.object({
                node_id: z.string(),
                description: z.string().optional(),
                contribution: z.number().optional(),
              }),
            )
            .default([]),
        })
        .optional(),
      model_card: z.record(z.any()).optional(),
      seed: z.string(),
      response_hash: z.string(),
    }),
    context_id: z.string().optional(),
  })
  .strict();

export type CEESensitivityCoachInputT = z.infer<typeof CEESensitivityCoachInput>;

export const CEETeamPerspectivesInput = z
  .object({
    perspectives: z
      .array(
        z
          .object({
            id: z.string(),
            stance: z.enum(["for", "against", "neutral"]),
            weight: z.number().optional(),
            confidence: z.number().min(0).max(1).optional(),
          })
          .strict(),
      )
      .min(1),
    context_id: z.string().optional(),
  })
  .strict();

export type CEETeamPerspectivesInputT = z.infer<typeof CEETeamPerspectivesInput>;

// Key Insight - ranked actions from PLoT inference
export const RankedActionSchema = z.object({
  node_id: z.string(),
  label: z.string(),
  expected_utility: z.number(),
  dominant: z.boolean().optional(),
  // Outcome quality affects headline phrasing (negative = risk-minimizing language)
  outcome_quality: z.enum(["positive", "neutral", "negative", "mixed"]).optional(),
  // Primary outcome label for context
  primary_outcome: z.string().optional(),
});

// Key Insight - drivers from PLoT inference
export const DriverSchema = z.object({
  node_id: z.string(),
  label: z.string(),
  impact_pct: z.number().min(0).max(100).optional(),
  direction: z.enum(["positive", "negative", "neutral"]).optional(),
  // Node kind helps distinguish external factors from controllable actions
  kind: z.string().optional(),
});

// Goal info for multi-goal scenarios
export const GoalInfoSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: z.enum(["binary", "continuous", "compound"]),
  is_primary: z.boolean(),
});

// Identifiability status from ISL causal analysis
export const IdentifiabilitySchema = z.object({
  // Whether causal effects are identifiable from the model structure
  identifiable: z.boolean(),
  // Method used for identification (e.g., "backdoor", "frontdoor", "instrumental")
  method: z.string().nullable().optional(),
  // Variables in the adjustment set for causal identification
  adjustment_set: z.array(z.string()).nullable().optional(),
  // Human-readable explanation of identifiability status
  explanation: z.string().nullable().optional(),
});

export const CEEKeyInsightInput = z
  .object({
    graph: Graph,
    ranked_actions: z.array(RankedActionSchema).min(1),
    top_drivers: z.array(DriverSchema).optional(),
    context_id: z.string().optional(),
    // Goal-anchored headline fields (optional for backward compatibility)
    goal_text: z.string().nullable().optional(),
    goal_type: z.enum(["binary", "continuous", "compound"]).nullable().optional(),
    goal_id: z.string().nullable().optional(),
    // Multi-goal support
    goals: z.array(GoalInfoSchema).optional(),
    primary_goal_id: z.string().optional(),
    // Identifiability from ISL - optional for backward compatibility
    // If not provided, assumes identifiable (current behaviour)
    identifiability: IdentifiabilitySchema.optional(),
  })
  .strict();

export type CEEKeyInsightInputT = z.infer<typeof CEEKeyInsightInput>;

// Belief Elicitation - convert natural language to probability
export const CEEElicitBeliefInput = z
  .object({
    node_id: z.string().min(1),
    node_label: z.string().min(1),
    user_expression: z.string(),
    target_type: z.enum(["prior", "edge_weight"]),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEElicitBeliefInputT = z.infer<typeof CEEElicitBeliefInput>;

// Utility Weight Suggestions - suggest importance weights for outcome nodes
export const CEEUtilityWeightInput = z
  .object({
    graph: Graph,
    outcome_node_ids: z.array(z.string()).min(1),
    decision_description: z.string().optional(),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEUtilityWeightInputT = z.infer<typeof CEEUtilityWeightInput>;

// Risk Tolerance Elicitation - assess user risk preferences
const RiskToleranceResponse = z.object({
  question_id: z.string(),
  option_id: z.string(),
});

export const CEERiskToleranceInput = z
  .object({
    mode: z.enum(["get_questions", "process_responses"]),
    context: z.enum(["product", "business"]).default("product"),
    responses: z.array(RiskToleranceResponse).optional(),
    context_id: z.string().optional(),
  })
  .strict()
  .refine(
    (data) => {
      // If mode is process_responses, responses should be provided
      if (data.mode === "process_responses" && (!data.responses || data.responses.length === 0)) {
        return true; // Allow empty responses (will return low confidence default)
      }
      return true;
    },
    { message: "responses array is recommended when mode is 'process_responses'" }
  );

export type CEERiskToleranceInputT = z.infer<typeof CEERiskToleranceInput>;

// Edge Function Suggestions - suggest non-linear edge function types
export const NodeInfoSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().min(1),
});

export const CEEEdgeFunctionSuggestionInput = z
  .object({
    edge_id: z.string().min(1),
    source_node: NodeInfoSchema,
    target_node: NodeInfoSchema,
    relationship_description: z.string().optional(),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEEdgeFunctionSuggestionInputT = z.infer<typeof CEEEdgeFunctionSuggestionInput>;

// Generate Recommendation - ranked actions for narrative generation
export const CEERankedActionSchema = z.object({
  node_id: z.string().min(1),
  label: z.string().min(1),
  score: z.number().min(0).max(100),
  rank: z.number().int().min(1),
});

export const CEEGenerateRecommendationInput = z
  .object({
    ranked_actions: z.array(CEERankedActionSchema).min(1),
    goal_label: z.string().optional(),
    context: z.string().optional(),
    tone: z.enum(["formal", "conversational"]).default("formal"),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEGenerateRecommendationInputT = z.infer<typeof CEEGenerateRecommendationInput>;

// Narrate Conditions - conditional logic for recommendations
export const CEEConditionBranchSchema = z.object({
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(100),
});

export const CEEConditionSchema = z.object({
  condition_id: z.string().min(1),
  condition_label: z.string().min(1),
  if_true: CEEConditionBranchSchema,
  if_false: CEEConditionBranchSchema,
});

export const CEENarrateConditionsInput = z
  .object({
    conditions: z.array(CEEConditionSchema).min(1),
    primary_recommendation: z.string().optional(),
    context: z.string().optional(),
    context_id: z.string().optional(),
  })
  .strict();

export type CEENarrateConditionsInputT = z.infer<typeof CEENarrateConditionsInput>;

// Explain Policy - sequential decision logic
export const CEEPolicyStepSchema = z.object({
  step_number: z.number().int().min(1),
  action: z.string().min(1),
  rationale: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
});

export const CEEExplainPolicyInput = z
  .object({
    policy_steps: z.array(CEEPolicyStepSchema).min(1),
    goal_label: z.string().optional(),
    context: z.string().optional(),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEExplainPolicyInputT = z.infer<typeof CEEExplainPolicyInput>;

// ============================================================================
// Preference Elicitation Schemas
// ============================================================================

// Preference Question Types
export const PreferenceQuestionTypeSchema = z.enum([
  "risk_reward", // Type 1: Risk vs Reward Trade-off
  "goal_tradeoff", // Type 2: Goal Trade-off (Multi-Goal)
  "loss_aversion", // Type 3: Loss Aversion
  "time_preference", // Type 4: Time Preference
]);

export type PreferenceQuestionTypeT = z.infer<typeof PreferenceQuestionTypeSchema>;

// Option in a preference question
export const PreferenceOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  outcome_value: z.number().optional(),
  probability: z.number().min(0).max(1).optional(),
  timeframe: z.string().optional(),
});

export type PreferenceOptionT = z.infer<typeof PreferenceOptionSchema>;

// Preference Question
export const PreferenceQuestionSchema = z.object({
  id: z.string(),
  type: PreferenceQuestionTypeSchema,
  question: z.string(),
  options: z.array(PreferenceOptionSchema).length(2),
  estimated_value: z.number().min(0).max(1),
  context_node_ids: z.array(z.string()).optional(),
});

export type PreferenceQuestionT = z.infer<typeof PreferenceQuestionSchema>;

// User Preferences (output from CEE, input to ISL)
export const UserPreferencesDerivedFromSchema = z.object({
  questions_answered: z.number().int().min(0),
  last_updated: z.string(),
});

export const UserPreferencesSchema = z.object({
  risk_aversion: z.number().min(0).max(1),
  loss_aversion: z.number().min(1).max(3),
  goal_weights: z.record(z.string(), z.number()),
  time_discount: z.number().min(0).max(1),
  confidence: z.enum(["low", "medium", "high"]),
  derived_from: UserPreferencesDerivedFromSchema,
});

export type UserPreferencesT = z.infer<typeof UserPreferencesSchema>;

// Option for elicit preferences request
export const ElicitPreferencesOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  expected_value: z.number().optional(),
  risk_level: z.number().min(0).max(1).optional(),
});

// Elicit Preferences Request
export const CEEElicitPreferencesInput = z
  .object({
    graph_id: z.string(),
    goal_ids: z.array(z.string()),
    options: z.array(ElicitPreferencesOptionSchema),
    current_preferences: UserPreferencesSchema.optional(),
    max_questions: z.number().int().min(1).max(5).default(3),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEElicitPreferencesInputT = z.infer<typeof CEEElicitPreferencesInput>;

// Elicit Preferences Answer Request
export const CEEElicitPreferencesAnswerInput = z
  .object({
    question_id: z.string(),
    answer: z.enum(["A", "B"]),
    graph_id: z.string(),
    current_preferences: UserPreferencesSchema.optional(),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEElicitPreferencesAnswerInputT = z.infer<typeof CEEElicitPreferencesAnswerInput>;

// Explain Tradeoff Request
export const CEEExplainTradeoffInput = z
  .object({
    option_a: z.string(),
    option_b: z.string(),
    user_preferences: UserPreferencesSchema,
    goal_context: z.string().optional(),
    context_id: z.string().optional(),
  })
  .strict();

export type CEEExplainTradeoffInputT = z.infer<typeof CEEExplainTradeoffInput>;
