/**
 * POST /orchestrate/v1/turn/stream
 *
 * SSE streaming endpoint for the CEE conversational orchestrator.
 * Feature-gated behind ENABLE_ORCHESTRATOR_STREAMING (default false).
 *
 * Reuses the same auth, validation, and idempotency as the non-streaming route.
 * Streams OrchestratorStreamEvent events as SSE to the client.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getOrGenerateRequestId } from "../utils/request-id.js";
import { log, emit } from "../utils/telemetry.js";
import type { OrchestratorTurnRequest, SystemEvent } from "./types.js";
import { config } from "../config/index.js";
import { createOrchestratorRateLimitHook } from "../middleware/rate-limit.js";
import { TurnRequestSchema, MAX_MESSAGE_LENGTH } from "./route-schemas.js";
import {
  normalizeContext,
  normalizeSystemEvent,
  normalizeGenerateModel,
  warnAnalysisStateOnNonAnalysisTurn,
  warnDirectAnalysisRunDetails,
} from "./request-normalization.js";
import {
  getIdempotentResponse,
  setIdempotentResponse,
  getInflightRequest,
  registerInflightRequest,
} from "./idempotency.js";
import { ORCHESTRATOR_TURN_BUDGET_MS } from "../config/timeouts.js";
import { SSE_HEARTBEAT_INTERVAL_MS, SSE_WRITE_TIMEOUT_MS } from "../config/timeouts.js";
import { executePipelineStream } from "./pipeline/pipeline-stream.js";
import { createProductionLLMClient } from "./pipeline/llm-client.js";
import { createProductionToolDispatcher } from "./pipeline/phase4-tools/index.js";
import { createPLoTClient } from "./plot-client.js";
import type { PLoTClientRunOpts } from "./plot-client.js";
import type { OrchestratorStreamEvent } from "./pipeline/stream-events.js";
import { DailyBudgetExceededError } from "../adapters/llm/errors.js";

// ============================================================================
// SSE Constants
// ============================================================================

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "connection": "keep-alive",
  "cache-control": "no-cache",
  "x-accel-buffering": "no",
} as const;

// ============================================================================
// Streaming Route Registration
// ============================================================================

export async function ceeOrchestratorStreamRouteV1(app: FastifyInstance): Promise<void> {
  app.post(
    "/orchestrate/v1/turn/stream",
    { preHandler: createOrchestratorRateLimitHook() },
    async (req, reply) => {
      // Feature gate
      if (!config.features.orchestratorStreaming) {
        reply.code(404);
        return reply.send({ error: "Not found" });
      }

      const startTime = Date.now();
      const requestId = getOrGenerateRequestId(req);
      const streamMetrics = {
        time_to_first_event_ms: 0,
        time_to_first_text_delta_ms: 0,
        time_to_first_block_ms: 0,
        total_stream_duration_ms: 0,
        completion_status: 'unknown' as 'complete' | 'error' | 'disconnect' | 'unknown',
        disconnect_reason: null as string | null,
        event_count: 0,
        text_delta_count: 0,
      };

      // Validate request — same schema as non-streaming
      const parsed = TurnRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        const errorDetail = parsed.error.flatten();
        log.warn(
          { request_id: requestId, errors: errorDetail },
          "Orchestrator stream request validation failed",
        );
        reply.code(400);
        return reply.send({
          turn_id: 'validation-error',
          assistant_text: null,
          blocks: [],
          lineage: { context_hash: '' },
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request validation failed',
            recoverable: false,
            validation_errors: errorDetail,
          },
        });
      }

      // Message length guard
      if (parsed.data.message.length > MAX_MESSAGE_LENGTH) {
        reply.code(400);
        return reply.send({
          turn_id: 'validation-error',
          assistant_text: "Your message is too long. Try breaking it into shorter messages, or focus on the key points of your decision.",
          blocks: [],
          lineage: { context_hash: '' },
          error: {
            code: 'INVALID_REQUEST',
            message: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters.`,
            recoverable: true,
          },
        });
      }

      // Boundary diagnostics (parity with non-streaming route)
      warnAnalysisStateOnNonAnalysisTurn(parsed.data, requestId);

      // Normalise context and system event
      const context = normalizeContext(parsed.data);
      const systemEvent = normalizeSystemEvent(parsed.data.system_event as SystemEvent | undefined);

      // Boundary diagnostic for direct_analysis_run
      warnDirectAnalysisRunDetails(systemEvent, requestId);

      const turnRequest: OrchestratorTurnRequest = {
        message: parsed.data.message,
        context,
        scenario_id: parsed.data.scenario_id,
        system_event: systemEvent,
        client_turn_id: parsed.data.client_turn_id,
        graph_state: parsed.data.graph_state as OrchestratorTurnRequest['graph_state'],
        analysis_state: parsed.data.analysis_state as OrchestratorTurnRequest['analysis_state'],
        generate_model: normalizeGenerateModel(parsed.data),
      };

      // Idempotency check — cache hit returns JSON, not SSE
      const cached = getIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id);
      if (cached) {
        log.info(
          { request_id: requestId, client_turn_id: turnRequest.client_turn_id },
          "Stream: idempotency cache hit — returning JSON",
        );
        reply.code(200);
        return reply.send(cached);
      }

      // Budget controller
      const budgetController = new AbortController();
      const budgetTimeout = setTimeout(() => budgetController.abort(), ORCHESTRATOR_TURN_BUDGET_MS);

      // Client disconnect → abort
      req.raw.on('close', () => {
        if (!reply.raw.writableEnded) {
          streamMetrics.completion_status = 'disconnect';
          budgetController.abort();
        }
      });

      const plotOpts: PLoTClientRunOpts = {
        turnSignal: budgetController.signal,
        turnStartedAt: Date.now(),
        turnBudgetMs: ORCHESTRATOR_TURN_BUDGET_MS,
      };

      // Disable socket timeout — SSE streams may outlive the global requestTimeout.
      // The budget controller (ORCHESTRATOR_TURN_BUDGET_MS) is the authoritative timeout.
      req.raw.socket?.setTimeout?.(0);

      // Commit to SSE response
      reply.raw.writeHead(200, SSE_HEADERS);

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(': heartbeat\n\n');
        }
      }, SSE_HEARTBEAT_INTERVAL_MS);

      let firstEventEmitted = false;

      try {
        const deps = {
          llmClient: createProductionLLMClient(),
          toolDispatcher: createProductionToolDispatcher(requestId, plotOpts, req),
          plotClient: createPLoTClient(),
          plotOpts,
        };

        for await (const event of executePipelineStream(turnRequest, requestId, deps, budgetController.signal)) {
          if (budgetController.signal.aborted) break;

          // Track metrics
          streamMetrics.event_count++;
          if (!firstEventEmitted) {
            streamMetrics.time_to_first_event_ms = Date.now() - startTime;
            firstEventEmitted = true;

            // If the very first event is an error, this is a preflight failure
            // (e.g. phase1 enrichment threw). Emit telemetry so it's distinguishable
            // from mid-stream errors in observability dashboards.
            if (event.type === 'error') {
              emit('streaming.generator_preflight_failure' as any, {
                request_id: requestId,
                error: event.error.code,
              });
            }
          }
          if (event.type === 'text_delta') {
            streamMetrics.text_delta_count++;
            if (streamMetrics.time_to_first_text_delta_ms === 0) {
              streamMetrics.time_to_first_text_delta_ms = Date.now() - startTime;
            }
          }
          if (event.type === 'block' && streamMetrics.time_to_first_block_ms === 0) {
            streamMetrics.time_to_first_block_ms = Date.now() - startTime;
          }

          // Cache envelope on turn_complete
          if (event.type === 'turn_complete') {
            setIdempotentResponse(
              turnRequest.scenario_id,
              turnRequest.client_turn_id,
              event.envelope as unknown as import("./types.js").OrchestratorResponseEnvelope,
            );
          }

          // Write SSE event with backpressure handling
          const ok = writeSSEEvent(reply, event);
          if (!ok) {
            // Backpressure: wait for drain
            const drained = await waitForDrain(reply, SSE_WRITE_TIMEOUT_MS);
            if (!drained) {
              // Emit error event before closing so UI knows the reason
              writeSSEEvent(reply, {
                type: 'error',
                seq: streamMetrics.event_count,
                error: { code: 'STREAM_WRITE_TIMEOUT', message: 'Stream write timed out.' },
                recoverable: true,
              });
              streamMetrics.completion_status = 'error';
              streamMetrics.disconnect_reason = 'write_timeout';
              break;
            }
          }
        }

        if (streamMetrics.completion_status === 'unknown') {
          streamMetrics.completion_status = 'complete';
        }
      } catch (error) {
        if (!firstEventEmitted) {
          // Pre-yield error — emit telemetry and error event
          emit('streaming.generator_preflight_failure' as any, {
            request_id: requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // Yield error event to client
        const errorEvent: OrchestratorStreamEvent = {
          type: 'error',
          seq: streamMetrics.event_count,
          error: {
            code: error instanceof DailyBudgetExceededError ? 'DAILY_BUDGET_EXCEEDED' : 'PIPELINE_ERROR',
            message: 'Something went wrong.',
          },
          recoverable: error instanceof DailyBudgetExceededError,
        };
        writeSSEEvent(reply, errorEvent);
        streamMetrics.completion_status = 'error';
      } finally {
        clearInterval(heartbeat);
        clearTimeout(budgetTimeout);
        budgetController.abort();

        streamMetrics.total_stream_duration_ms = Date.now() - startTime;

        // Emit observability telemetry
        log.info(
          {
            event: 'orchestrator.stream.completed',
            request_id: requestId,
            scenario_id: turnRequest.scenario_id,
            ...streamMetrics,
          },
          'Orchestrator stream completed',
        );

        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    },
  );
}

// ============================================================================
// SSE Helpers
// ============================================================================

/**
 * Write a single SSE event to the response stream.
 * Returns true if write was accepted, false if backpressure (need to wait for drain).
 */
function writeSSEEvent(reply: FastifyReply, event: OrchestratorStreamEvent): boolean {
  const data = JSON.stringify(event);
  const frame = `event: ${event.type}\ndata: ${data}\nid: ${event.seq}\n\n`;
  return reply.raw.write(frame);
}

/**
 * Wait for the response stream to drain, with a timeout.
 */
function waitForDrain(reply: FastifyReply, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    reply.raw.once('drain', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
