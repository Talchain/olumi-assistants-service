/**
 * POST /orchestrate/v1/turn
 *
 * Fastify route for the CEE conversational orchestrator.
 * Feature-gated behind CEE_ORCHESTRATOR_ENABLED.
 *
 * Validates request with Zod, extracts requestId, calls handleTurn(),
 * and returns the envelope with correct HTTP status.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getOrGenerateRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
import { handleTurn } from "./turn-handler.js";
import type { OrchestratorTurnRequest, ConversationContext, SystemEvent, DecisionStage, V2RunResponseEnvelope, ConversationBlock } from "./types.js";
import { getHttpStatusForError } from "./types.js";
import { config, isProduction } from "../config/index.js";
import { handleTurnV2 } from "./pipeline/route-v2.js";
import { inferTurnType, validateTurnContract } from "./turn-contract.js";
import { handleParallelGenerate } from "./parallel-generate.js";
import { createOrchestratorRateLimitHook } from "../middleware/rate-limit.js";
import { DailyBudgetExceededError } from "../adapters/llm/errors.js";

// ============================================================================
// Request Validation Schema
// ============================================================================

// Shared base fields for all system event shapes
const SystemEventBase = {
  timestamp: z.string(),
  event_id: z.string().min(1),
};

const SystemEventSchema = z.discriminatedUnion('event_type', [
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

const ConversationMessageSchema = z.object({
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

const GraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
}).passthrough().nullable();

const AnalysisResponseSchema = z.object({
  analysis_status: z.string(),
}).passthrough().nullable();

const AnalysisStateSchema = z.object({
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

const TurnRequestSchema = z.object({
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

// ============================================================================
// Response-path diagnostics
// ============================================================================

/**
 * Emit diagnostic logs for full_draft graph_patch blocks.
 * Checks analysis_ready presence and option status fields.
 * Diagnostic only — never rejects the response.
 */
function logAnalysisReadyDiagnostics(
  envelope: { blocks: ConversationBlock[] },
  requestId: string,
): void {
  const blocks = envelope.blocks;
  if (!Array.isArray(blocks)) return;

  for (const block of blocks) {
    if (block.block_type !== 'graph_patch') continue;
    const data = block.data as unknown as Record<string, unknown>;
    if (!data || data.patch_type !== 'full_draft') continue;

    const ar = data.analysis_ready as Record<string, unknown> | undefined;
    if (!ar) {
      // Distinguish between "pipeline didn't produce it" and "validation failed".
      // extractAnalysisReady already logs the specific reason, so here we log
      // a summary-level warning on the response path.
      log.warn(
        { request_id: requestId, omission_reason: 'absent_on_block' },
        'analysis_ready absent from full_draft block',
      );
      continue;
    }

    // Check option status fields
    const opts = (ar.options ?? []) as Array<Record<string, unknown>>;
    const missingStatus = opts.filter(o => !o.status).length;
    if (missingStatus > 0) {
      log.warn(
        { request_id: requestId, options_without_status: missingStatus },
        'analysis_ready contract warning: options missing status field',
      );
    }
  }
}

// ============================================================================
// Route Registration
// ============================================================================

export async function ceeOrchestratorRouteV1(app: FastifyInstance): Promise<void> {
  app.post("/orchestrate/v1/turn", { preHandler: createOrchestratorRateLimitHook() }, async (req, reply) => {
    const startTime = Date.now();
    const requestId = getOrGenerateRequestId(req);

    // Validate request
    const parsed = TurnRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorDetail = parsed.error.flatten();
      const rawBody = (req.body ?? {}) as Record<string, unknown>;
      const inferredTurnType = inferTurnType(rawBody);
      const contractCheck = validateTurnContract(inferredTurnType, rawBody);

      log.warn(
        { request_id: requestId, errors: errorDetail, inferred_turn_type: inferredTurnType },
        "Orchestrator turn request validation failed",
      );

      const errorEnvelope = {
        turn_id: 'validation-error',
        assistant_text: null,
        blocks: [],
        lineage: { context_hash: '' },
        error: {
          code: 'INVALID_REQUEST' as const,
          message: 'Request validation failed',
          recoverable: false,
          validation_errors: errorDetail,
          // Verbose diagnostics — non-production only
          ...(!isProduction() && {
            inferred_turn_type: contractCheck.inferred_turn_type,
            contract_version: contractCheck.contract_version,
            forbidden_fields_present: contractCheck.forbidden_fields_present,
            missing_required_fields: contractCheck.missing_required_fields,
            partial_fields: contractCheck.partial_fields,
          }),
        },
      };

      reply.code(400);
      return reply.send(errorEnvelope);
    }

    // ── Boundary warning: analysis_state on non-analysis turns (non-production only) ──
    if (!isProduction() && parsed.data.analysis_state) {
      const turnType = inferTurnType(parsed.data as unknown as Record<string, unknown>);
      if (turnType === 'conversation' || turnType === 'explicit_generate') {
        log.warn(
          { request_id: requestId, turn_type: turnType },
          `[BOUNDARY WARNING] analysis_state present on ${turnType} turn — likely client-side request construction issue`,
        );
      }
    }

    // Normalise context: if absent, construct from flat UI fields
    const context = parsed.data.context ?? {
      graph: parsed.data.graph_state ?? null,
      analysis_response: parsed.data.analysis_state ?? null,
      framing: null,
      messages: (parsed.data.conversation_history ?? []) as z.infer<typeof ConversationMessageSchema>[],
      scenario_id: parsed.data.scenario_id,
      analysis_inputs: null,
    };

    // Normalise system event: if only block_id is provided (no patch_id), copy it to patch_id
    let systemEvent = parsed.data.system_event as SystemEvent | undefined;
    if (
      systemEvent &&
      (systemEvent.event_type === 'patch_accepted' || systemEvent.event_type === 'patch_dismissed')
    ) {
      const det = systemEvent.details as { patch_id?: string; block_id?: string };
      // Precedence: if both present, patch_id wins, block_id is ignored.
      if (!det.patch_id && det.block_id) {
        systemEvent = {
          ...systemEvent,
          details: { ...det, patch_id: det.block_id },
        } as SystemEvent;
      }
    }

    // Log extra fields in direct_analysis_run details (schema expects empty object;
    // passthrough preserves them instead of 400ing, but we surface them for observability).
    if (systemEvent?.event_type === 'direct_analysis_run') {
      const detailKeys = Object.keys((systemEvent as Record<string, unknown>).details ?? {});
      if (detailKeys.length > 0) {
        log.warn(
          { request_id: requestId, extra_keys: detailKeys },
          'direct_analysis_run: details contains extra fields beyond empty-object contract',
        );
      }
    }

    // ── Message length guard (cf-v11.1) ────────────────────────────────────
    // Canonical check at route boundary — applies to V1, V2, and parallel paths.
    // Zod caps at 10,000 (schema); this enforces the friendly 4,000-char limit.
    const MAX_MESSAGE_LENGTH = 4000;
    if (parsed.data.message.length > MAX_MESSAGE_LENGTH) {
      log.warn(
        { request_id: requestId, message_length: parsed.data.message.length, max: MAX_MESSAGE_LENGTH },
        'Orchestrator message length exceeded',
      );
      reply.code(400);
      return reply.send({
        turn_id: 'validation-error',
        assistant_text: "Your message is too long. Try breaking it into shorter messages, or focus on the key points of your decision.",
        blocks: [],
        lineage: { context_hash: '' },
        error: {
          code: 'INVALID_REQUEST' as const,
          message: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
          recoverable: true,
        },
      });
    }

    // Map validated data to turn request
    const turnRequest: OrchestratorTurnRequest = {
      message: parsed.data.message,
      context: context as unknown as ConversationContext,
      scenario_id: parsed.data.scenario_id,
      system_event: systemEvent,
      client_turn_id: parsed.data.client_turn_id,
      graph_state: parsed.data.graph_state as unknown as typeof turnRequest.graph_state,
      analysis_state: parsed.data.analysis_state as unknown as V2RunResponseEnvelope | null | undefined,
    };

    try {
      // Parallel generation: draft_graph + orchestrator coaching concurrently
      // Guard: parallel path produces V1 envelopes; block when V2 is active
      // to prevent mixed-envelope contracts on the same endpoint.
      if (parsed.data.generate_model && config.features.orchestratorV2) {
        log.warn(
          { request_id: requestId, scenario_id: turnRequest.scenario_id },
          "generate_model rejected: parallel path not yet compatible with V2 envelope contract",
        );
        reply.code(501);
        return reply.send({
          turn_id: 'not-implemented',
          assistant_text: null,
          blocks: [],
          lineage: { context_hash: '' },
          error: {
            code: 'NOT_IMPLEMENTED' as const,
            message: 'generate_model is not yet supported when the V2 pipeline is active',
            recoverable: false,
          },
        });
      }

      if (parsed.data.generate_model) {
        const parallelResult = await handleParallelGenerate(
          turnRequest,
          req,
          requestId,
        );

        log.info(
          {
            request_id: requestId,
            scenario_id: turnRequest.scenario_id,
            elapsed_ms: Date.now() - startTime,
            http_status: parallelResult.httpStatus,
            has_error: Boolean(parallelResult.envelope.error),
            pipeline: 'parallel_generate',
          },
          "Parallel generate_model turn completed",
        );

        logAnalysisReadyDiagnostics(parallelResult.envelope, requestId);

        reply.code(parallelResult.httpStatus);
        return reply.send(parallelResult.envelope);
      }

      // V2 pipeline (feature-flagged)
      if (config.features.orchestratorV2) {
        const turnNonce = parsed.data.turn_nonce;
        const v2Result = await handleTurnV2(turnRequest, req, requestId, turnNonce);

        log.info(
          {
            request_id: requestId,
            scenario_id: turnRequest.scenario_id,
            elapsed_ms: Date.now() - startTime,
            http_status: v2Result.httpStatus,
            has_error: Boolean(v2Result.envelope.error),
            pipeline: 'v2',
          },
          "Orchestrator V2 turn completed",
        );

        logAnalysisReadyDiagnostics(v2Result.envelope, requestId);

        reply.code(v2Result.httpStatus);
        return reply.send(v2Result.envelope);
      }

      // V1 pipeline (existing)
      const result = await handleTurn(turnRequest, req, requestId);

      log.info(
        {
          request_id: requestId,
          scenario_id: turnRequest.scenario_id,
          elapsed_ms: Date.now() - startTime,
          http_status: result.httpStatus,
          has_error: Boolean(result.envelope.error),
        },
        "Orchestrator turn completed",
      );

      logAnalysisReadyDiagnostics(result.envelope, requestId);

      reply.code(result.httpStatus);
      return reply.send(result.envelope);
    } catch (error) {
      // Daily token budget exceeded — return 429 with cee.error.v1 shape
      if (error instanceof DailyBudgetExceededError) {
        log.warn(
          { event: 'daily_budget_exceeded', request_id: requestId, user_key: error.userKey },
          'Daily token budget exceeded during orchestrator turn',
        );
        reply.header('Retry-After', error.retryAfterSeconds);
        reply.code(429);
        return reply.send({
          schema: 'cee.error.v1',
          code: 'CEE_RATE_LIMIT',
          message: 'Daily token budget exceeded',
          retryable: true,
          source: 'cee',
          request_id: requestId,
          details: {
            retry_after_seconds: error.retryAfterSeconds,
          },
        });
      }

      log.error(
        { error, request_id: requestId, elapsed_ms: Date.now() - startTime },
        "Orchestrator turn unhandled error",
      );

      reply.code(500);
      return reply.send({
        turn_id: 'error',
        assistant_text: null,
        blocks: [],
        lineage: { context_hash: '' },
        error: {
          code: 'UNKNOWN',
          message: 'Internal server error',
          recoverable: false,
        },
      });
    }
  });
}
