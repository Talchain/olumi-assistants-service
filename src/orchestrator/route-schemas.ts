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

// The UI's buildRunAnalysisTurnRequest emits options with `id`; CEE's
// historical shape uses `option_id`. Accept either, normalise downstream.
const AnalysisInputsSchema = z.object({
  options: z.array(
    z.object({
      option_id: z.string().optional(),
      id: z.string().optional(),
      label: z.string(),
      interventions: z.record(z.unknown()),
    }).passthrough().refine(
      (o) => typeof o.option_id === 'string' || typeof o.id === 'string',
      { message: 'option must have option_id or id' },
    ),
  ),
  constraints: z.array(z.unknown()).optional(),
  seed: z.number().optional(),
  n_samples: z.number().optional(),
}).passthrough().nullable().optional();

export const GraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
}).passthrough().nullable();

const AnalysisResponseSchema = z.object({
  analysis_status: z.string().optional(),
  results: z.array(z.unknown()).optional(),
  meta: z.object({ response_hash: z.string() }).passthrough().optional(),
}).passthrough().refine(
  (val) => val.analysis_status || val.results || val.meta,
  { message: 'analysis_response must include at least one of: analysis_status, results, meta' },
).nullable();

// AnalysisStateSchema: permissive passthrough — top level must be object.
// The UI sends several evolving shapes (results as array or object,
// option_comparison, robustness as object, etc.). Typing individual fields
// as z.array() caused repeated "Expected array, received object" regressions.
// Downstream code (analysis-state.ts) duck-types these fields, so the route
// schema validates structural shape only; meta is optional because some valid
// payloads carry usable analysis data (option_comparison/results) without it.
export const AnalysisStateSchema = z.object({
  meta: z.object({
    response_hash: z.string().min(1),
  }).passthrough().optional(),
}).passthrough().nullable();

const ConversationContextSchema = z.object({
  graph: GraphSchema,
  analysis_response: AnalysisResponseSchema,
  framing: FramingSchema,
  messages: z.array(ConversationMessageSchema),
  event_log_summary: z.string().optional(),
  selected_elements: z.union([
    z.array(z.string()),
    z.object({ node_ids: z.array(z.string()).optional(), edge_ids: z.array(z.string()).optional() }),
  ]).optional(),
  scenario_id: z.string(),
  analysis_inputs: AnalysisInputsSchema,
});

/**
 * Chip-click metadata — present when the user clicked a chip rather than
 * typing a free-form message. `action_type` forces the target tool, and
 * `parameters.chip_id` lets the pipeline exempt the clicked chip from the
 * 2-turn suppression window.
 */
export const ChipMetadataSchema = z.object({
  action_type: z.string().min(1).max(64),
  parameters: z.record(z.unknown()).optional(),
}).optional();

/**
 * Session decision state schema — validates session_state round-tripped from the UI.
 * Permissive: accepts partial state and falls back to defaults in the pipeline.
 */
export const SessionStateSchema = z.object({
  prediction: z.string().nullable().optional(),
  calibrations_provided: z.array(z.string()).optional(),
  plays_fired: z.array(z.string()).optional(),
  questions_asked: z.array(z.string()).optional(),
  accepted_patches: z.number().int().min(0).optional(),
  dismissed_patches: z.number().int().min(0).optional(),
  last_chip_ids_shown: z.array(z.string()).optional(),
  chip_ids_shown_prev_turn: z.array(z.string()).optional(),
  chip_ids_clicked: z.array(z.string()).optional(),
  last_question_turn: z.number().int().min(0).optional(),
  preferred_option: z.string().nullable().optional(),
  convergence_signal: z.enum(['exploring', 'narrowing', 'converging']).optional(),
  // Analysis-rehydration cache (S6). Cleared by the pipeline on graph-
  // mutating actions; populated after successful run_analysis so a
  // follow-up evaluate turn that drops analysis_state can be backfilled.
  // Envelope validated permissively — consumer normalises it.
  analysis_graph_hash: z.string().nullable().optional(),
  analysis_scenario_id: z.string().nullable().optional(),
  prior_analysis_envelope: z.object({}).passthrough().nullable().optional(),
}).optional();

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
  /**
   * Top-level analysis_inputs — the UI's buildRunAnalysisTurnRequest emits
   * this shape (see DecisionGuideAI/src/services/turn-request-builder.ts).
   * Normalised into context.analysis_inputs by normalizeContext. Presence
   * implies a forced run_analysis turn even when `message` is empty.
   */
  analysis_inputs: AnalysisInputsSchema,
  /** When true, fires draft_graph and orchestrator coaching in parallel. */
  generate_model: z.boolean().optional().default(false),
  /** UI alias for generate_model — accepted for backward compatibility. */
  explicit_generate: z.boolean().optional(),
  /** Session decision state — echoed from previous turn's updated_session_state. */
  session_state: SessionStateSchema,
  /** Chip-click metadata — set by the UI when the user clicks a suggested action. */
  chip_metadata: ChipMetadataSchema,
});

/** Maximum user message length (friendly limit below Zod's 10,000 cap). */
export const MAX_MESSAGE_LENGTH = 4000;
