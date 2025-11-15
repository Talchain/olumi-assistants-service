import { z } from "zod";
import { Graph } from "./graph.js";

export const DraftGraphInput = z
  .object({
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
    attachment_payloads: z.record(z.any()).optional(), // Attachment content (base64 or { data, encoding })
    constraints: z.record(z.any()).optional(),
    flags: z.record(z.boolean()).optional(),
    include_debug: z.boolean().optional()
  })
  // TODO: This is a temporary fix to allow for unknown keys. We should revisit this and find a more robust solution.
  // Chaos fixtures and perf harnesses add helper fields (fixtures, sim_*, etc.).
  // Accept unknown keys so degraded-mode testing doesn't 400.
  .passthrough();

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

export const ClarifyBriefInput = z.object({
  brief: z.string().min(30).max(5000),
  round: z.number().int().min(0).max(2).default(0),
  previous_answers: z.array(z.object({
    question: z.string(),
    answer: z.string()
  })).optional(),
  seed: z.number().int().optional(),
  flags: z.record(z.boolean()).optional() // Feature flags (per-request overrides)
}).strict();

export const ClarifyBriefOutput = z.object({
  questions: z.array(z.object({
    question: z.string().min(10),
    choices: z.array(z.string()).optional(),
    why_we_ask: z.string().min(20),
    impacts_draft: z.string().min(20)
  })).min(1).max(5),
  confidence: z.number().min(0).max(1),
  should_continue: z.boolean(),
  round: z.number().int().min(0).max(2)
});

export const CritiqueGraphInput = z.object({
  graph: Graph,
  brief: z.string().min(30).max(5000).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["pdf", "csv", "txt", "md"]),
        name: z.string()
      })
    )
    .optional(),
  attachment_payloads: z.record(z.any()).optional(), // Attachment content (base64 or { data, encoding })
  flags: z.record(z.boolean()).optional(), // Feature flags (per-request overrides)
  focus_areas: z.array(z.enum(["structure", "completeness", "feasibility", "provenance"])).optional()
}).strict();

export const CritiqueGraphOutput = z.object({
  issues: z.array(z.object({
    level: z.enum(["BLOCKER", "IMPROVEMENT", "OBSERVATION"]),
    note: z.string().min(10).max(280),
    target: z.string().optional()
  })),
  suggested_fixes: z.array(z.string()).max(5).default([]),
  overall_quality: z.enum(["poor", "fair", "good", "excellent"]).optional()
});

export const ExplainDiffInput = z.object({
  patch: z.object({
    adds: z.object({
      nodes: z.array(z.any()).default([]),
      edges: z.array(z.any()).default([])
    }).default({ nodes: [], edges: [] }),
    updates: z.array(z.any()).default([]),
    removes: z.array(z.any()).default([])
  }),
  brief: z.string().min(30).max(5000).optional(),
  graph_summary: z.object({
    node_count: z.number(),
    edge_count: z.number()
  }).optional()
}).strict();

export const ExplainDiffOutput = z.object({
  rationales: z.array(z.object({
    target: z.string(),
    why: z.string().max(280),
    provenance_source: z.string().optional()
  })).min(1)
});

export const ErrorV1 = z.object({
  schema: z.literal("error.v1"),
  code: z.enum(["BAD_INPUT", "RATE_LIMITED", "INTERNAL"]),
  message: z.string(),
  details: z.record(z.any()).optional()
});

export type DraftGraphInputT = z.infer<typeof DraftGraphInput>;
export type ClarifyBriefInputT = z.infer<typeof ClarifyBriefInput>;
export type CritiqueGraphInputT = z.infer<typeof CritiqueGraphInput>;
export type ExplainDiffInputT = z.infer<typeof ExplainDiffInput>;
export type ExplainDiffOutputT = z.infer<typeof ExplainDiffOutput>;
