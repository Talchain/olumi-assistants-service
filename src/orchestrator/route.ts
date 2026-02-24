/**
 * POST /orchestrate/v1/turn
 *
 * Fastify route for the CEE conversational orchestrator.
 * Feature-gated behind ENABLE_ORCHESTRATOR.
 *
 * Validates request with Zod, extracts requestId, calls handleTurn(),
 * and returns the envelope with correct HTTP status.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getOrGenerateRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
import { handleTurn } from "./turn-handler.js";
import type { OrchestratorTurnRequest, ConversationContext, SystemEvent, DecisionStage } from "./types.js";
import { getHttpStatusForError } from "./types.js";

// ============================================================================
// Request Validation Schema
// ============================================================================

const SystemEventSchema = z.object({
  type: z.enum(['patch_accepted', 'patch_dismissed', 'feedback_submitted', 'direct_graph_edit', 'direct_analysis_run']),
  payload: z.record(z.unknown()),
});

const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  tool_calls: z.array(z.object({
    name: z.string(),
    input: z.record(z.unknown()),
  })).optional(),
});

const FramingSchema = z.object({
  stage: z.enum(['frame', 'ideate', 'evaluate', 'decide', 'optimise']),
  goal: z.string().optional(),
  constraints: z.array(z.unknown()).optional(),
}).nullable();

const AnalysisInputsSchema = z.object({
  options: z.array(z.object({
    option_id: z.string(),
    label: z.string(),
    interventions: z.record(z.unknown()),
  })),
  constraints: z.array(z.unknown()).optional(),
  seed: z.number().optional(),
  n_samples: z.number().optional(),
}).passthrough().nullable().optional();

const ConversationContextSchema = z.object({
  graph: z.unknown().nullable(),
  analysis_response: z.unknown().nullable(),
  framing: FramingSchema,
  messages: z.array(ConversationMessageSchema),
  event_log_summary: z.string().optional(),
  selected_elements: z.array(z.string()).optional(),
  scenario_id: z.string(),
  analysis_inputs: AnalysisInputsSchema,
});

const TurnRequestSchema = z.object({
  message: z.string().min(1).max(10_000),
  context: ConversationContextSchema,
  scenario_id: z.string().min(1).max(200),
  system_event: SystemEventSchema.optional(),
  client_turn_id: z.string().min(1).max(64),
});

// ============================================================================
// Route Registration
// ============================================================================

export async function ceeOrchestratorRouteV1(app: FastifyInstance): Promise<void> {
  app.post("/orchestrate/v1/turn", async (req, reply) => {
    const startTime = Date.now();
    const requestId = getOrGenerateRequestId(req);

    // Validate request
    const parsed = TurnRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorDetail = parsed.error.flatten();
      log.warn(
        { request_id: requestId, errors: errorDetail },
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
        },
      };

      reply.code(400);
      return reply.send(errorEnvelope);
    }

    // Map validated data to turn request
    const turnRequest: OrchestratorTurnRequest = {
      message: parsed.data.message,
      context: parsed.data.context as unknown as ConversationContext,
      scenario_id: parsed.data.scenario_id,
      system_event: parsed.data.system_event as SystemEvent | undefined,
      client_turn_id: parsed.data.client_turn_id,
    };

    try {
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

      reply.code(result.httpStatus);
      return reply.send(result.envelope);
    } catch (error) {
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
