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
});

// Key Insight - drivers from PLoT inference
export const DriverSchema = z.object({
  node_id: z.string(),
  label: z.string(),
  impact_pct: z.number().min(0).max(100).optional(),
  direction: z.enum(["positive", "negative", "neutral"]).optional(),
});

export const CEEKeyInsightInput = z
  .object({
    graph: Graph,
    ranked_actions: z.array(RankedActionSchema).min(1),
    top_drivers: z.array(DriverSchema).optional(),
    context_id: z.string().optional(),
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
