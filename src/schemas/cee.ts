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
