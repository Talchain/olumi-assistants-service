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
  attachment_payloads: z.record(z.any()).optional(), // Attachment content (base64 or { data, encoding })
  constraints: z.record(z.any()).optional(),
  flags: z.record(z.boolean()).optional(),
  include_debug: z.boolean().optional(),
  focus_areas: z
    .array(z.enum(["structure", "completeness", "feasibility", "provenance"]))
    .optional(),
  // Optional structured context for graph generation
  context: z.object({
    goals: z.array(z.string().min(5).max(200)).max(5).optional(),
  }).optional(),
  // Optional refinement context for iterative drafting (Phase B)
  previous_graph: Graph.optional(),
  refinement_mode: z
    .enum(["auto", "expand", "prune", "clarify"])
    .optional(),
  refinement_instructions: z.string().min(1).max(2000).optional(),
  preserve_nodes: z.array(z.string()).max(50).optional(),
  // Clarification enforcement (Phase 5)
  clarification_rounds_completed: z.number().int().min(0).max(3).optional(),
  // Multi-turn clarifier integration
  clarifier_response: z.object({
    question_id: z.string(),
    answer: z.string(),
  }).optional(),
  conversation_history: z.array(z.object({
    question_id: z.string(),
    question: z.string(),
    answer: z.string(),
  })).optional(),
  max_clarifier_rounds: z.number().int().min(0).max(10).default(5).optional(),
  // Raw output mode - skip all post-processing repairs (factor enrichment, goal repair, etc.)
  // Returns LLM output directly after basic schema validation
  raw_output: z.boolean().optional(),
  // Model selection for different pipeline operations
  // All models must be enabled in MODEL_REGISTRY. Use CLIENT_BLOCKED_MODELS env var to block specific models.
  // Main graph generation model (default: gpt-4o)
  model: z.string().optional(),
  // Graph repair model - used when initial draft needs fixing (default: claude-sonnet-4-20250514)
  repair_model: z.string().optional(),
  // Bias detection model (default: claude-sonnet-4-20250514)
  bias_model: z.string().optional(),
  // Factor enrichment model (default: claude-sonnet-4-20250514)
  enrichment_model: z.string().optional(),
});

// Graph correction tracking schema
export const GraphCorrectionSchema = z.object({
  id: z.string(),
  stage: z.number().int().min(1).max(25),
  stage_name: z.string(),
  layer: z.enum(["adapter", "pipeline", "guards"]),
  type: z.enum([
    "node_added", "node_removed", "node_modified",
    "edge_added", "edge_removed", "edge_modified",
    "kind_normalised", "coefficient_adjusted"
  ]),
  target: z.object({
    node_id: z.string().optional(),
    edge_id: z.string().optional(),
    kind: z.string().optional(),
  }),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string(),
});

export const CorrectionsSummarySchema = z.object({
  total: z.number().int().min(0),
  by_layer: z.object({
    adapter: z.number().int().min(0),
    pipeline: z.number().int().min(0),
    guards: z.number().int().min(0),
  }),
  by_type: z.record(z.string(), z.number().int().min(0)),
});

/**
 * Goal constraint schema for compound goal extraction (Phase 3).
 * Defines a threshold constraint on a target node.
 * PLoT merges explicit goal_constraints[] with compiled constraint nodes.
 */
// .passthrough() — preserves constraint metadata (source_quote, confidence, provenance, deadline_metadata)
export const GoalConstraintSchema = z.object({
  /** Unique constraint identifier */
  constraint_id: z.string().min(1),
  /** ID of the target node (factor/outcome) this constraint applies to */
  node_id: z.string().min(1),
  /** Comparison operator - ASCII only (>= or <=) */
  operator: z.enum([">=", "<="]),
  /** Threshold value in user units - PLoT normalises */
  value: z.number(),
  /** Human-readable constraint label */
  label: z.string().optional(),
  /** Unit of measurement if known */
  unit: z.string().optional(),
  /** Source quote from brief */
  source_quote: z.string().max(200).optional(),
  /** Extraction confidence (0-1) */
  confidence: z.number().min(0).max(1).optional(),
  /** Provenance marker for UI display */
  provenance: z.enum(["explicit", "inferred", "proxy"]).optional(),
  /** Deadline metadata for temporal constraints */
  deadline_metadata: z.object({
    deadline_date: z.string().optional(),
    reference_date: z.string().optional(),
    assumed_reference_date: z.boolean().optional(),
  }).optional(),
}).passthrough();

export type GoalConstraintT = z.infer<typeof GoalConstraintSchema>;

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
  confidence: z.number().min(0).max(1).optional(),
  /**
   * Goal constraints extracted from compound goals (Phase 3).
   * Populated when brief contains multiple quantitative targets.
   * PLoT merges these with compiled constraint nodes (explicit wins on conflict).
   */
  goal_constraints: z.array(GoalConstraintSchema).optional(),
  /** LLM coaching output — optional decision-quality insights */
  coaching: z.object({
    summary: z.string(),
    strengthen_items: z.array(z.object({
      id: z.string(),
      label: z.string(),
      detail: z.string(),
      action_type: z.string(),
      bias_category: z.string().optional(),
    }).passthrough()),
  }).passthrough().optional(),
  // Graph corrections tracking + pipeline repair observability
  trace: z.object({
    // Pipeline repair tracking fields
    draft_graph_produced: z.boolean().optional(),
    simple_repair_executed: z.boolean().optional(),
    repair_loop_attempts: z.number().optional(),
    repair_attempted: z.boolean().optional(),
    // Graph corrections
    corrections: z.array(GraphCorrectionSchema).optional(),
    corrections_summary: CorrectionsSummarySchema.optional(),
  }).passthrough().optional(),
}).passthrough();

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

export const ReadinessFactors = z.object({
  length_score: z.number().min(0).max(1),
  clarity_score: z.number().min(0).max(1),
  decision_relevance_score: z.number().min(0).max(1),
  specificity_score: z.number().min(0).max(1),
  context_score: z.number().min(0).max(1),
});

export const ClarifyBriefOutput = z.object({
  questions: z.array(z.object({
    question: z.string().min(10),
    choices: z.array(z.string()).optional(),
    why_we_ask: z.string().min(20),
    impacts_draft: z.string().min(20),
    targets_factor: z.enum(["length", "clarity", "decision_relevance", "specificity", "context"]).optional()
  })).min(1).max(5),
  confidence: z.number().min(0).max(1),
  should_continue: z.boolean(),
  round: z.number().int().min(0).max(2),
  // Enhanced readiness assessment (Phase 5)
  readiness: z.object({
    score: z.number().min(0).max(1),
    level: z.enum(["ready", "needs_clarification", "not_ready"]),
    factors: ReadinessFactors,
    weakest_factor: z.enum(["length", "clarity", "decision_relevance", "specificity", "context"]).optional()
  }).optional()
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
