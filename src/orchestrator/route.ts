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
import { getOrGenerateRequestId } from "../utils/request-id.js";
import { log } from "../utils/telemetry.js";
import { handleTurn } from "./turn-handler.js";
import type { OrchestratorTurnRequest, SystemEvent, ConversationBlock } from "./types.js";
import { getHttpStatusForError } from "./types.js";
import { config, isProduction } from "../config/index.js";
import { handleTurnV2 } from "./pipeline/route-v2.js";
import { inferTurnType, validateTurnContract } from "./turn-contract.js";
import { handleParallelGenerate } from "./parallel-generate.js";
import { createOrchestratorRateLimitHook } from "../middleware/rate-limit.js";
import { DailyBudgetExceededError } from "../adapters/llm/errors.js";
import { TurnRequestSchema, MAX_MESSAGE_LENGTH } from "./route-schemas.js";
import { ceeOrchestratorStreamRouteV1 } from "./route-stream.js";
import {
  normalizeContext,
  normalizeSystemEvent,
  normalizeGenerateModel,
  warnAnalysisStateOnNonAnalysisTurn,
  warnDirectAnalysisRunDetails,
} from "./request-normalization.js";

// Request validation schemas imported from route-schemas.ts
// (shared with route-stream.ts for the streaming endpoint)

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

    // Boundary diagnostics
    warnAnalysisStateOnNonAnalysisTurn(parsed.data, requestId);

    // Normalise context and system event
    const context = normalizeContext(parsed.data);
    const systemEvent = normalizeSystemEvent(parsed.data.system_event as SystemEvent | undefined);

    // Boundary diagnostic for direct_analysis_run
    warnDirectAnalysisRunDetails(systemEvent, requestId);

    // ── Message length guard (cf-v11.1) ────────────────────────────────────
    // Canonical check at route boundary — applies to V1, V2, and parallel paths.
    // Zod caps at 10,000 (schema); this enforces the friendly 4,000-char limit.
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
    const generateModel = normalizeGenerateModel(parsed.data);
    const turnRequest: OrchestratorTurnRequest = {
      message: parsed.data.message,
      context,
      scenario_id: parsed.data.scenario_id,
      system_event: systemEvent,
      client_turn_id: parsed.data.client_turn_id,
      graph_state: parsed.data.graph_state as OrchestratorTurnRequest['graph_state'],
      analysis_state: parsed.data.analysis_state as OrchestratorTurnRequest['analysis_state'],
      generate_model: generateModel,
    };

    try {
      // V1 parallel generate path — only used when V2 pipeline is NOT active.
      // When V2 is active, generate_model flows through the V2 pipeline via
      // intent gate override → buildExplicitGenerateRoute → draft_graph.
      if (generateModel && !config.features.orchestratorV2) {
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

  // Register streaming endpoint alongside the non-streaming route
  await ceeOrchestratorStreamRouteV1(app);
}
