/**
 * Shared Zod schemas for orchestrator turn request validation.
 *
 * Used by both the non-streaming route (route.ts) and
 * the streaming route (route-stream.ts).
 */

import { z } from "zod";

// Shared base fields for all system event shapes
const SystemEventBase = {
  timestamp: z.string(),
  event_id: z.string().min(1),
};

export const SystemEventSchema = z.discriminatedUnion('event_type', [
  z.object({
    event_type: z.literal('patch_accepted'),
    ...SystemEventBase,
    details: z.object({
      patch_id: z.string().min(1).optional(),
      block_id: z.string().min(1).optional(),
      operations: z.array(z.record(z.unknown())),
      applied_graph_hash: z.string().optional(),
    }).superRefine((val, ctx) => {
      if (!val.patch_id && !val.block_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['details'],
          message: 'At least one of patch_id or block_id must be provided',
        });
      }
    }),
  }),
  z.object({
    event_type: z.literal('patch_dismissed'),
    ...SystemEventBase,
    details: z.object({
      patch_id: z.string().optional(),
      block_id: z.string().optional(),
      reason: z.string().optional(),
    }),
  }),
  z.object({
    event_type: z.literal('direct_graph_edit'),
    ...SystemEventBase,
    details: z.object({
      changed_node_ids: z.array(z.string()),
      changed_edge_ids: z.array(z.string()),
      operations: z.array(z.enum(['add', 'update', 'remove'])),
    }),
  }),
  z.object({
    event_type: z.literal('direct_analysis_run'),
    ...SystemEventBase,
    details: z.object({}).passthrough(),
  }),
  z.object({
    event_type: z.literal('feedback_submitted'),
    ...SystemEventBase,
    details: z.object({
      turn_id: z.string(),
      rating: z.enum(['up', 'down']),
      comment: z.string().optional(),
    }),
  }),
]);

const ToolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.unknown()),
});

export const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().nullable().optional().transform((v) => v ?? ''),
  tool_calls: z.array(ToolCallSchema).optional(),
  assistant_tool_calls: z.array(ToolCallSchema).optional(),
}).transform((message) => ({
  role: message.role,
  content: message.content,
  ...(message.tool_calls
    ? { tool_calls: message.tool_calls }
    : message.assistant_tool_calls
      ? { tool_calls: message.assistant_tool_calls }
      : {}),
}));

const FramingSchema = z.object({
  stage: z.enum(['frame', 'ideate', 'evaluate', 'decide', 'optimise']),
  goal: z.string().optional(),
  constraints: z.array(z.string().max(200)).max(20).optional(),
  options: z.array(z.string().max(200)).max(20).optional(),
}).nullable();

const AnalysisInputsSchema = z.object({
  options: z.array(z.object({
    option_id: z.string(),
    label: z.string(),
    interventions: z.record(z.unknown()),
  }).passthrough()),
  constraints: z.array(z.unknown()).optional(),
  seed: z.number().optional(),
  n_samples: z.number().optional(),
}).passthrough().nullable().optional();

export const GraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
}).passthrough().nullable();

const AnalysisResponseSchema = z.object({
  analysis_status: z.string(),
}).passthrough().nullable();

export const AnalysisStateSchema = z.object({
  meta: z.object({
    response_hash: z.string().min(1),
    seed_used: z.number().optional(),
    n_samples: z.number().optional(),
  }).passthrough(),
  results: z.array(z.unknown()),
  analysis_status: z.string().optional(),
  fact_objects: z.array(z.unknown()).optional(),
  review_cards: z.array(z.unknown()).optional(),
  response_hash: z.string().optional(),
}).passthrough().nullable();

const ConversationContextSchema = z.object({
  graph: GraphSchema,
  analysis_response: AnalysisResponseSchema,
  framing: FramingSchema,
  messages: z.array(ConversationMessageSchema),
  event_log_summary: z.string().optional(),
  selected_elements: z.array(z.string()).optional(),
  scenario_id: z.string(),
  analysis_inputs: AnalysisInputsSchema,
});

export const TurnRequestSchema = z.object({
  message: z.string().min(0).max(10_000).default(''),
  context: ConversationContextSchema.optional(),
  scenario_id: z.string().min(1).max(200),
  system_event: SystemEventSchema.optional(),
  client_turn_id: z.string().min(1).max(64),
  turn_nonce: z.number().int().min(0).optional(),
  /** Full graph state from UI — required when system_event.details.applied_graph_hash is set. */
  graph_state: GraphSchema.optional(),
  /** Full analysis response from UI — present for direct_analysis_run Path A. */
  analysis_state: AnalysisStateSchema.optional(),
  /** Flat conversation history from UI — mapped to context.messages when context is absent. */
  conversation_history: z.array(ConversationMessageSchema).optional(),
  /** When true, fires draft_graph and orchestrator coaching in parallel. */
  generate_model: z.boolean().optional().default(false),
});

/** Maximum user message length (friendly limit below Zod's 10,000 cap). */
export const MAX_MESSAGE_LENGTH = 4000;
