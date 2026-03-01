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
import type { OrchestratorTurnRequest, ConversationContext, SystemEvent, DecisionStage } from "./types.js";
import { getHttpStatusForError } from "./types.js";
import { config } from "../config/index.js";
import { handleTurnV2 } from "./pipeline/route-v2.js";

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

const GraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
}).passthrough().nullable();

const AnalysisResponseSchema = z.object({
  analysis_status: z.string(),
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
  message: z.string().min(1).max(10_000),
  context: ConversationContextSchema,
  scenario_id: z.string().min(1).max(200),
  system_event: SystemEventSchema.optional(),
  client_turn_id: z.string().min(1).max(64),
  turn_nonce: z.number().int().min(0).optional(),
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
