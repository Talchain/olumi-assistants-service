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
import type { OrchestratorTurnRequest, ConversationContext, SystemEvent, DecisionStage, V2RunResponseEnvelope } from "./types.js";
import { getHttpStatusForError } from "./types.js";
import { config } from "../config/index.js";
import { handleTurnV2 } from "./pipeline/route-v2.js";

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
      patch_id: z.string().optional(),
      block_id: z.string().optional(),
      operations: z.array(z.record(z.unknown())),
      applied_graph_hash: z.string().optional(),
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
    details: z.object({}).strict(),
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
  constraints: z.array(z.string().max(200)).max(20).optional(),
  options: z.array(z.string().max(200)).max(20).optional(),
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
  message: z.string().min(0).max(10_000).default(''),
  context: ConversationContextSchema,
  scenario_id: z.string().min(1).max(200),
  system_event: SystemEventSchema.optional(),
  client_turn_id: z.string().min(1).max(64),
  turn_nonce: z.number().int().min(0).optional(),
  /** Full graph state from UI — required when system_event.details.applied_graph_hash is set. */
  graph_state: GraphSchema.optional(),
  /** Full analysis response from UI — present for direct_analysis_run Path A. */
  analysis_state: z.object({}).passthrough().nullable().optional(),
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

    // Normalise system event: if only block_id is provided (no patch_id), copy it to patch_id
    let systemEvent = parsed.data.system_event as SystemEvent | undefined;
    if (
      systemEvent &&
      (systemEvent.event_type === 'patch_accepted' || systemEvent.event_type === 'patch_dismissed')
    ) {
      const det = systemEvent.details as { patch_id?: string; block_id?: string };
      if (!det.patch_id && det.block_id) {
        systemEvent = {
          ...systemEvent,
          details: { ...det, patch_id: det.block_id },
        } as SystemEvent;
      }
    }

    // Map validated data to turn request
    const turnRequest: OrchestratorTurnRequest = {
      message: parsed.data.message,
      context: parsed.data.context as unknown as ConversationContext,
      scenario_id: parsed.data.scenario_id,
      system_event: systemEvent,
      client_turn_id: parsed.data.client_turn_id,
      graph_state: parsed.data.graph_state as unknown as typeof turnRequest.graph_state,
      analysis_state: parsed.data.analysis_state as unknown as V2RunResponseEnvelope | null | undefined,
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
