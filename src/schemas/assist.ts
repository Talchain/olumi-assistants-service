import { z } from "zod";
import { Graph } from "./graph.js";

export const DraftGraphInput = z.object({
  brief: z.string().min(30).max(5000),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["pdf", "csv", "txt", "md"]),
        name: z.string()
      })
    )
    .optional(),
  constraints: z.record(z.any()).optional(),
  flags: z.record(z.boolean()).optional(),
  include_debug: z.boolean().optional()
}).strict();

export const DraftGraphOutput = z.object({
  graph: Graph,
  patch: z
    .object({
      adds: z.object({ nodes: z.array(z.any()).default([]), edges: z.array(z.any()).default([]) }).default({ nodes: [], edges: [] }),
      updates: z.array(z.any()).default([]),
      removes: z.array(z.any()).default([])
    })
    .default({ adds: { nodes: [], edges: [] }, updates: [], removes: [] }),
  rationales: z
    .array(
      z.object({ target: z.string(), why: z.string().max(280), provenance_source: z.string().optional() })
    )
    .default([]),
  issues: z.array(z.string()).optional(),
  clarifier_status: z.enum(["complete", "max_rounds", "confident"]).optional(),
  layout: z
    .object({
      suggested_positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() }))
    })
    .optional(),
  debug: z.object({ needle_movers: z.any().optional() }).optional(),
  confidence: z.number().min(0).max(1).optional()
});

export const SuggestOptionsInput = z.object({
  goal: z.string().min(5),
  constraints: z.record(z.any()).optional(),
  graph_summary: z.object({ decision: z.string(), existing_options: z.array(z.string()) }).optional(),
  include_debug: z.boolean().optional()
});

export const SuggestOptionsOutput = z.object({
  options: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(3),
        pros: z.array(z.string()).min(2).max(3),
        cons: z.array(z.string()).min(2).max(3),
        evidence_to_gather: z.array(z.string()).min(2).max(3)
      })
    )
    .min(3)
    .max(5)
});

export const ErrorV1 = z.object({
  schema: z.literal("error.v1"),
  code: z.enum(["BAD_INPUT", "RATE_LIMITED", "INTERNAL"]),
  message: z.string(),
  details: z.record(z.any()).optional()
});

export type DraftGraphInputT = z.infer<typeof DraftGraphInput>;
