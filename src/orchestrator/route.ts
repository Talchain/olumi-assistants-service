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
import type { OrchestratorTurnRequest, SystemEvent, TypedConversationBlock } from "./types.js";
import { getHttpStatusForError } from "./types.js";
import { config, isProduction } from "../config/index.js";
import { handleTurnV2 } from "./pipeline/route-v2.js";
import { inferTurnType, validateTurnContract } from "./turn-contract.js";
import { handleParallelGenerate } from "./parallel-generate.js";
import { createOrchestratorRateLimitHook } from "../middleware/rate-limit.js";
import { DailyBudgetExceededError } from "../adapters/llm/errors.js";
import { TurnRequestSchema, MAX_MESSAGE_LENGTH } from "./route-schemas.js";
import { ceeOrchestratorStreamRouteV1 } from "./route-stream.js";
import { getIdempotentResponse, setIdempotentResponse } from "./idempotency.js";
import { ORCHESTRATOR_TURN_BUDGET_MS, DRAFT_GRAPH_TURN_BUDGET_MS } from "../config/timeouts.js";
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
  envelope: { blocks: TypedConversationBlock[] },
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

    // ── V4_DISABLED guard (v5-exclusive-cee brief §3 Task 1) ────────────
    // Runs BEFORE payload validation so a V1 client calling a disabled
    // endpoint gets the migration signal regardless of what shape its
    // payload has. The staging-rollout intent is that V4 off means V5
    // is the only supported path; any V1-route caller is looking at a
    // stale UI or a direct API client that must migrate to
    // `/orchestrate/v2/turn`. A loud 410 surfaces the migration gap
    // immediately — silently falling through to the legacy V2/V1
    // pipelines would route traffic to degraded legacy code nobody
    // has tested in months.
    if (!config.features.pipelineV4Enabled) {
      log.warn(
        { request_id: requestId, route: '/orchestrate/v1/turn' },
        'V1 non-streaming turn rejected: V4 disabled — use /orchestrate/v2/turn',
      );
      reply.code(410);
      return reply.send({
        error: 'V4_DISABLED',
        message: 'V4 orchestration is disabled. Use /orchestrate/v2/turn.',
        retryable: false,
      });
    }

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

    // Forced-tool synthesis for empty-message run_analysis turns. Keep
    // parity with the streaming route so both transports handle the UI's
    // buildRunAnalysisTurnRequest shape (analysis_inputs at top level, no
    // message, no chip_metadata). Without this the LLM path is called with
    // empty user content and Anthropic rejects the request.
    let chipMetadata = parsed.data.chip_metadata as OrchestratorTurnRequest['chip_metadata'];
    let effectiveTurnMessage: string = parsed.data.message ?? '';
    const effectiveMessage = effectiveTurnMessage.trim();
    // Synthesis trigger: top-level analysis_inputs ONLY. The UI's
    // buildRunAnalysisTurnRequest sends this field explicitly at the request
    // root to signal "please run analysis now". Nested context.analysis_inputs
    // means "here is prior analysis state for context" and must NOT trigger
    // synthesis — it is present on any post-analysis conversation turn,
    // which would cause false-positive forcing on every such empty message.
    const hasTopLevelAnalysisInputs = !!parsed.data.analysis_inputs;
    const noExistingForce = !chipMetadata && !systemEvent;
    if (hasTopLevelAnalysisInputs && effectiveMessage === '' && noExistingForce) {
      chipMetadata = { action_type: 'run_analysis' };
      effectiveTurnMessage = 'Run the analysis.';
      log.info(
        { request_id: requestId, client_turn_id: parsed.data.client_turn_id },
        'Route: synthesised chip_metadata:run_analysis for empty-message + analysis_inputs turn',
      );
    } else if (effectiveMessage === '' && noExistingForce && !hasTopLevelAnalysisInputs) {
      log.warn(
        { request_id: requestId, client_turn_id: parsed.data.client_turn_id },
        'Route: empty-message turn with no chip_metadata, system_event, or analysis_inputs — LLM path will reject',
      );
    }

    const turnRequest: OrchestratorTurnRequest = {
      message: effectiveTurnMessage,
      context,
      scenario_id: parsed.data.scenario_id,
      system_event: systemEvent,
      client_turn_id: parsed.data.client_turn_id,
      graph_state: parsed.data.graph_state as OrchestratorTurnRequest['graph_state'],
      analysis_state: parsed.data.analysis_state as OrchestratorTurnRequest['analysis_state'],
      generate_model: generateModel,
      session_state: parsed.data.session_state ?? undefined,
      chip_metadata: chipMetadata,
    };

    try {
      // ── Pipeline V4: native tool-use (highest priority) ──────────────
      // When enabled, ALL turns route to the V4 pipeline — no fall-through
      // to V2 or V1. Mirrors the streaming path (pipeline-stream.ts:109).
      // The pre-validation V4_DISABLED guard above (brief §3 Task 1)
      // ensures we never reach here when the flag is false, so the inner
      // check is now structurally redundant but kept for diff minimality
      // until a later clean-up.
      if (config.features.pipelineV4Enabled) {
        // Idempotency — return cached envelope on retry (parity with streaming path)
        const cached = getIdempotentResponse(turnRequest.scenario_id, turnRequest.client_turn_id);
        if (cached) {
          log.info(
            { request_id: requestId, client_turn_id: turnRequest.client_turn_id, pipeline: 'v4' },
            "V4 idempotency cache hit",
          );
          reply.code(200);
          return reply.send(cached);
        }

        // Budget timeout — draft_graph turns get a longer budget (parity with streaming path)
        const graphNodes = (turnRequest.context?.graph as Record<string, unknown> | null)?.nodes;
        const hasGraph = turnRequest.context?.graph != null && Array.isArray(graphNodes) && (graphNodes as unknown[]).length > 0;
        const likelyDraftGraph = turnRequest.generate_model || !hasGraph;
        const effectiveBudgetMs = likelyDraftGraph ? DRAFT_GRAPH_TURN_BUDGET_MS : ORCHESTRATOR_TURN_BUDGET_MS;
        const budgetController = new AbortController();
        const budgetTimeout = setTimeout(() => budgetController.abort(), effectiveBudgetMs);

        try {
          const { executePipelineV4 } = await import("./deterministic/pipeline-v4.js");

          let v4Envelope: import("./pipeline/types.js").OrchestratorResponseEnvelopeV2 | undefined;
          for await (const event of executePipelineV4(turnRequest, requestId, budgetController.signal, req)) {
            if (event.type === 'turn_complete') {
              v4Envelope = event.envelope;
            }
          }

          if (!v4Envelope) {
            log.error({ request_id: requestId }, 'V4 pipeline produced no turn_complete event');
            reply.code(500);
            return reply.send({
              turn_id: 'error',
              assistant_text: null,
              blocks: [],
              lineage: { context_hash: '' },
              error: { code: 'UNKNOWN', message: 'Pipeline produced no response', recoverable: false },
            });
          }

          // Cache for idempotency (parity with streaming path route-stream.ts:253)
          setIdempotentResponse(
            turnRequest.scenario_id,
            turnRequest.client_turn_id,
            v4Envelope as unknown as import("./types.js").OrchestratorResponseEnvelope,
          );

          const v4HttpStatus = v4Envelope.error
            ? getHttpStatusForError(v4Envelope.error as import("./types.js").OrchestratorError)
            : 200;

          log.info(
            {
              request_id: requestId,
              scenario_id: turnRequest.scenario_id,
              elapsed_ms: Date.now() - startTime,
              http_status: v4HttpStatus,
              has_error: Boolean(v4Envelope.error),
              pipeline: 'v4',
            },
            "Orchestrator V4 turn completed",
          );

          logAnalysisReadyDiagnostics(v4Envelope, requestId);

          reply.code(v4HttpStatus);
          return reply.send(v4Envelope);
        } finally {
          clearTimeout(budgetTimeout);
        }
      }

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
