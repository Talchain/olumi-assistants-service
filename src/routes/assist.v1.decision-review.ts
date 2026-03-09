/**
 * Decision Review Route (M2)
 *
 * POST /assist/v1/decision-review
 *
 * Accepts a deterministic data package from PLoT and returns an LLM-generated
 * decision review as structured JSON.
 *
 * CEE acts as LLM worker only:
 * - NO ISL calls
 * - NO strict validation (PLoT handles that)
 * - Lightweight shape check only
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { config } from "../config/index.js";
import { getSystemPrompt, getSystemPromptMeta } from "../adapters/llm/prompt-loader.js";
import { extractJsonFromResponse } from "../utils/json-extractor.js";
import { getAdapter, getMaxTokensFromConfig } from "../adapters/llm/router.js";
import type { LLMAdapter, CallOpts, ChatResult } from "../adapters/llm/types.js";
import { UpstreamHTTPError } from "../adapters/llm/errors.js";
import { HTTP_CLIENT_TIMEOUT_MS } from "../config/timeouts.js";
import { buildLLMRawTrace } from "../cee/llm-output-store.js";
import { buildScienceClaimsSection, injectScienceClaimsSection } from "../cee/decision-review/science-claims.js";
import { performShapeCheck } from "../cee/decision-review/shape-check.js";

// ============================================================================
// Feature Flag
// ============================================================================

function isDecisionReviewEnabled(): boolean {
  return config.cee.decisionReviewEnabled;
}

function isRawOutputEnabled(): boolean {
  return config.cee.observabilityRawIO;
}

// ============================================================================
// Input Schema (Deterministic Data Package from PLoT)
// ============================================================================

const DecisionReviewInputSchema = z
  .object({
    /** Raw decision brief text */
    brief: z.string(),

    /** Hash of the brief from PLoT */
    brief_hash: z.string(),

    /** Graph snapshot with nodes and edges */
    graph: z
      .object({
        nodes: z.array(z.record(z.unknown())),
        edges: z.array(z.record(z.unknown())).optional(),
      })
      .passthrough(),

    /** ISL deterministic output */
    isl_results: z
      .object({
        option_comparison: z.array(z.record(z.unknown())),
        factor_sensitivity: z.array(z.record(z.unknown())),
        fragile_edges: z.array(z.record(z.unknown())).optional(),
        robustness: z.record(z.unknown()).optional(),
      })
      .passthrough(),

    /** M1 coaching from PLoT */
    deterministic_coaching: z
      .object({
        readiness: z.string(),
        headline_type: z.string(),
        evidence_gaps: z.array(z.record(z.unknown())),
        model_critiques: z.array(z.record(z.unknown())),
      })
      .passthrough(),

    /** Winning option (accepts id/label or option_id/option_label) */
    winner: z
      .object({
        id: z.string(),
        label: z.string(),
        win_probability: z.number(),
        outcome_mean: z.number().optional(),
      })
      .passthrough(),

    /** Runner-up option (null for single-option decisions) */
    runner_up: z
      .object({
        id: z.string(),
        label: z.string(),
        win_probability: z.number(),
        outcome_mean: z.number().optional(),
      })
      .passthrough()
      .nullable(),

    /** PLoT-computed flip threshold data (max 2) */
    flip_threshold_data: z
      .array(
        z
          .object({
            factor_id: z.string(),
            factor_label: z.string(),
            current_value: z.number(),
            flip_value: z.number().nullable(),
            direction: z.string(),
          })
          .passthrough()
      )
      .optional(),

    /** Correlation ID for tracing */
    correlation_id: z.string().optional(),

    /** Configuration options */
    config: z
      .object({
        /** Include raw LLM output in response (requires CEE_OBSERVABILITY_RAW_IO=true) */
        include_raw: z.boolean().default(false),
      })
      .optional(),
  })
  .passthrough();

type DecisionReviewInput = z.infer<typeof DecisionReviewInputSchema>;

// ============================================================================
// Rate Limiting
// ============================================================================

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const decisionReviewBuckets = new Map<string, BucketState>();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS) return;

  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    }
  }

  if (map.size <= MAX_BUCKETS) return;

  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

function checkDecisionReviewLimit(
  key: string,
  limit: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(decisionReviewBuckets, now);
  let state = decisionReviewBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    decisionReviewBuckets.set(key, state);
  }

  if (now - state.windowStart >= WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }

  if (state.count >= limit) {
    const resetAt = state.windowStart + WINDOW_MS;
    const diffMs = Math.max(0, resetAt - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(diffMs / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  state.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

// ============================================================================
// LLM Call (using adapter pattern)
// ============================================================================

// ChatResult type is imported from adapter types

// The adapter.chat() method provides:
// - Automatic retry with exponential backoff
// - Proper timeout handling
// - Consistent error classification (UpstreamTimeoutError, UpstreamHTTPError)
// - Telemetry integration
// - Idempotency keys for request deduplication

// Mock M2 response is now handled by the FixturesAdapter.chat() method

// ============================================================================
// User Message Builder
// ============================================================================

function buildUserMessage(input: DecisionReviewInput): string {
  const sections: string[] = [];

  // Brief (do NOT log raw brief - use brief_hash for tracing)
  sections.push("<BRIEF>");
  sections.push(input.brief);
  sections.push("</BRIEF>");

  // Graph
  sections.push("<GRAPH>");
  sections.push(JSON.stringify(input.graph, null, 2));
  sections.push("</GRAPH>");

  // ISL Results
  sections.push("<ISL_RESULTS>");
  sections.push(JSON.stringify(input.isl_results, null, 2));
  sections.push("</ISL_RESULTS>");

  // Deterministic Coaching
  sections.push("<DETERMINISTIC_COACHING>");
  sections.push(JSON.stringify(input.deterministic_coaching, null, 2));
  sections.push("</DETERMINISTIC_COACHING>");

  // Decision Context
  sections.push("<DECISION_CONTEXT>");
  sections.push(`winner: ${JSON.stringify(input.winner)}`);
  if (input.runner_up !== null) {
    sections.push(`runner_up: ${JSON.stringify(input.runner_up)}`);
  } else {
    sections.push("runner_up: null (single-option decision)");
  }
  sections.push("</DECISION_CONTEXT>");

  // Flip Threshold Data (optional)
  sections.push("<FLIP_THRESHOLD_DATA>");
  if (input.flip_threshold_data && input.flip_threshold_data.length > 0) {
    sections.push(JSON.stringify(input.flip_threshold_data, null, 2));
  } else {
    sections.push("Not available");
  }
  sections.push("</FLIP_THRESHOLD_DATA>");

  return sections.join("\n\n");
}

// performShapeCheck extracted to src/cee/decision-review/shape-check.ts

// ============================================================================
// Route Handler
// ============================================================================

export default async function route(app: FastifyInstance) {
  const RATE_LIMIT_RPM = config.cee.decisionReviewRateLimitRpm;
  const FEATURE_VERSION = "decision-review-2.0.0";

  app.post("/assist/v1/decision-review", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx
      ? contextToTelemetry(callerCtx)
      : { request_id: requestId };

    // Observability: Request received
    emit(TelemetryEvents.DecisionReviewRequested, {
      ...telemetryCtx,
      feature: "cee_decision_review",
      api_key_present: apiKeyPresent,
    });

    // Feature flag check
    if (!isDecisionReviewEnabled()) {
      const errorBody = buildCeeErrorResponse(
        "CEE_SERVICE_UNAVAILABLE",
        "Decision Review feature is not enabled",
        {
          retryable: false,
          requestId,
        }
      );

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_SERVICE_UNAVAILABLE",
        http_status: 503,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_SERVICE_UNAVAILABLE",
        httpStatus: 503,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(503);
      return reply.send(errorBody);
    }

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkDecisionReviewLimit(
      rateKey,
      RATE_LIMIT_RPM
    );
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "Decision Review rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "limited",
        errorCode: "CEE_RATE_LIMIT",
        httpStatus: 429,
      });

      reply.header("Retry-After", retryAfterSeconds.toString());
      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    // Validate input
    const parsed = DecisionReviewInputSchema.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse(
        "CEE_VALIDATION_FAILED",
        "Invalid input",
        {
          retryable: false,
          requestId,
          details: { field_errors: parsed.error.flatten() },
        }
      );

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_VALIDATION_FAILED",
        httpStatus: 400,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const input: DecisionReviewInput = parsed.data;
    const correlationId = input.correlation_id ?? requestId;

    // Log with brief_hash, not raw brief text
    log.info(
      {
        request_id: requestId,
        brief_hash: input.brief_hash,
        winner_id: input.winner.id,
        runner_up_id: input.runner_up?.id ?? null,
        readiness: input.deterministic_coaching.readiness,
      },
      "Processing decision review request"
    );

    try {
      // Get system prompt
      const rawPrompt = await getSystemPrompt("decision_review");
      const promptMeta = getSystemPromptMeta("decision_review");

      // Inject <SCIENCE_CLAIMS> section when DSK is enabled, bundle loaded,
      // and the loaded prompt does not already contain the section (store v12+ may bake it in).
      let assembledPrompt = rawPrompt;
      const scienceResult = buildScienceClaimsSection();
      if (scienceResult !== null && !rawPrompt.includes('<SCIENCE_CLAIMS>')) {
        assembledPrompt = injectScienceClaimsSection(rawPrompt, scienceResult.section);
        log.info(
          { request_id: requestId, bias_claims: scienceResult.biasCount, technique_claims: scienceResult.techniqueCount },
          `Science claims injected: ${scienceResult.biasCount} bias, ${scienceResult.techniqueCount} technique`,
        );
      } else if (scienceResult !== null) {
        // Caller-side skip: injector is the authoritative collision handler,
        // but we log here with request-scoped context the injector lacks.
        const openCount = (rawPrompt.match(/<SCIENCE_CLAIMS>/g) || []).length;
        const closeCount = (rawPrompt.match(/<\/SCIENCE_CLAIMS>/g) || []).length;
        log.warn(
          {
            request_id: requestId,
            prompt_version: promptMeta.prompt_version,
            has_open_tag: openCount > 0,
            has_close_tag: closeCount > 0,
            science_claims_tag_count: openCount,
          },
          'Skipping SCIENCE_CLAIMS injection: prompt already contains section',
        );
      }

      // Observability: Prompt loaded
      emit(TelemetryEvents.CeeDecisionReviewPromptLoaded, {
        ...telemetryCtx,
        prompt_version: promptMeta.prompt_version,
        prompt_source: promptMeta.source,
      });

      // Build user message
      const userMessage = buildUserMessage(input);

      // Get adapter for provider/model info
      const adapter = getAdapter("decision_review");

      // Call LLM
      emit(TelemetryEvents.CeeDecisionReviewLlmCallStarted, {
        ...telemetryCtx,
        user_message_chars: userMessage.length,
        provider: adapter.name,
        model: adapter.model,
      });

      // Get max tokens from config, with fallback
      const configuredMaxTokens = getMaxTokensFromConfig('decision_review');
      const maxTokens = configuredMaxTokens ?? 4096;
      if (configuredMaxTokens === undefined) {
        log.debug(
          { request_id: requestId, task: 'decision_review', default_max_tokens: 4096 },
          'CEE_MAX_TOKENS_DECISION_REVIEW not set, using default'
        );
      }

      const llmResult = await adapter.chat(
        {
          system: assembledPrompt,
          userMessage,
          temperature: 0,
          maxTokens,
        },
        {
          requestId,
          timeoutMs: HTTP_CLIENT_TIMEOUT_MS,
        }
      );

      // Observability: LLM call completed
      emit(TelemetryEvents.CeeDecisionReviewLlmCallCompleted, {
        ...telemetryCtx,
        llm_latency_ms: llmResult.latencyMs,
        model: llmResult.model,
        input_tokens: llmResult.usage.input_tokens,
        output_tokens: llmResult.usage.output_tokens,
      });

      // Extract JSON from response
      const extractionResult = extractJsonFromResponse(llmResult.content, {
        task: "decision_review",
        model: llmResult.model,
        correlationId,
      });

      // Observability: JSON extracted
      emit(TelemetryEvents.CeeDecisionReviewJsonExtracted, {
        ...telemetryCtx,
        was_extracted: extractionResult.wasExtracted,
        extraction_method: extractionResult.extractionMethod,
      });

      // Build llm_raw trace (same pattern as draft-graph)
      const llmRawTrace = buildLLMRawTrace(requestId, llmResult.content, extractionResult.json, {
        model: llmResult.model,
        promptVersion: promptMeta.prompt_version,
        storeOutput: true,
      });

      // Lightweight shape check
      const shapeCheck = performShapeCheck(extractionResult.json);

      if (!shapeCheck.valid) {
        log.warn(
          {
            request_id: requestId,
            brief_hash: input.brief_hash,
            errors: shapeCheck.errors,
          },
          "Decision review response failed shape check"
        );

        emit(TelemetryEvents.CeeDecisionReviewShapeCheckFailed, {
          ...telemetryCtx,
          errors: shapeCheck.errors,
        });

        // Return error with shape check details and llm_raw for diagnosis
        const errorBody = buildCeeErrorResponse(
          "CEE_LLM_VALIDATION_FAILED",
          "LLM response did not match expected M2 schema",
          {
            retryable: true,
            requestId,
            details: {
              shape_errors: shapeCheck.errors,
              partial_response: extractionResult.json,
              llm_raw: llmRawTrace,
            },
          }
        );

        logCeeCall({
          requestId,
          capability: "cee_decision_review",
          latencyMs: Date.now() - start,
          status: "error",
          errorCode: "CEE_LLM_VALIDATION_FAILED",
          httpStatus: 422,
        });

        reply.header("X-CEE-API-Version", "v1");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.code(422);
        return reply.send(errorBody);
      }

      if (shapeCheck.warnings.length > 0) {
        log.info(
          {
            request_id: requestId,
            brief_hash: input.brief_hash,
            warnings: shapeCheck.warnings,
          },
          "Decision review response has shape warnings"
        );

        emit(TelemetryEvents.CeeDecisionReviewShapeCheckWarnings, {
          ...telemetryCtx,
          warnings: shapeCheck.warnings,
        });
      }

      // Build response
      const reviewOutput = extractionResult.json as Record<string, unknown>;
      const latencyMs = Date.now() - start;

      const response: Record<string, unknown> = {
        review: reviewOutput,
        trace: {
          request_id: requestId,
          correlation_id: correlationId,
          brief_hash: input.brief_hash,
          prompt_version: promptMeta.prompt_version,
          prompt_source: promptMeta.source,
          pipeline: {
            llm_raw: llmRawTrace,
          },
        },
        _meta: {
          model: llmResult.model,
          latency_ms: latencyMs,
          llm_latency_ms: llmResult.latencyMs,
          token_usage: {
            input_tokens: llmResult.usage.input_tokens,
            output_tokens: llmResult.usage.output_tokens,
            total_tokens:
              llmResult.usage.input_tokens + llmResult.usage.output_tokens,
          },
          extraction_method: extractionResult.extractionMethod,
          shape_warnings: shapeCheck.warnings.length > 0 ? shapeCheck.warnings : undefined,
        },
      };

      // Include raw LLM output only if requested AND env var allows it
      if (input.config?.include_raw && isRawOutputEnabled()) {
        (response._meta as Record<string, unknown>).raw_llm_output = llmResult.content;
      } else if (input.config?.include_raw && !isRawOutputEnabled()) {
        log.debug(
          { request_id: requestId },
          "include_raw requested but CEE_OBSERVABILITY_RAW_IO is disabled"
        );
      }

      // Observability: Success
      emit(TelemetryEvents.DecisionReviewSucceeded, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        llm_latency_ms: llmResult.latencyMs,
        model: llmResult.model,
        readiness: input.deterministic_coaching.readiness,
        bias_findings_count: Array.isArray(reviewOutput.bias_findings)
          ? reviewOutput.bias_findings.length
          : 0,
        key_assumptions_count: Array.isArray(reviewOutput.key_assumptions)
          ? reviewOutput.key_assumptions.length
          : 0,
        has_pre_mortem: Boolean(reviewOutput.pre_mortem),
        has_flip_thresholds: Array.isArray(reviewOutput.flip_thresholds) && reviewOutput.flip_thresholds.length > 0,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs,
        status: shapeCheck.warnings.length > 0 ? "degraded" : "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");
      const isTimeout =
        err.name === "AbortError" || err.message.includes("timeout");
      const isUpstreamError = error instanceof UpstreamHTTPError;

      // Extract upstream error details for debug bundles
      const upstreamDetails = isUpstreamError
        ? {
            upstream_status: (error as UpstreamHTTPError).status,
            upstream_code: (error as UpstreamHTTPError).code,
            upstream_provider: (error as UpstreamHTTPError).provider,
          }
        : undefined;

      emit(TelemetryEvents.DecisionReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: isTimeout ? "CEE_TIMEOUT" : "CEE_INTERNAL_ERROR",
        http_status: isTimeout ? 504 : 500,
        error_message: err.message,
        ...upstreamDetails,
      });

      logCeeCall({
        requestId,
        capability: "cee_decision_review",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: isTimeout ? "CEE_TIMEOUT" : "CEE_INTERNAL_ERROR",
        httpStatus: isTimeout ? 504 : 500,
      });

      log.error(
        {
          request_id: requestId,
          error: err.message,
          stack: err.stack,
          ...upstreamDetails,
        },
        "Decision review failed"
      );

      const errorBody = buildCeeErrorResponse(
        isTimeout ? "CEE_TIMEOUT" : "CEE_INTERNAL_ERROR",
        err.message || "internal error",
        {
          retryable: isTimeout,
          requestId,
          // Include upstream error details so debug bundles capture the actual failure reason
          details: {
            error_detail: err.message,
            ...(upstreamDetails || {}),
          },
        }
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(isTimeout ? 504 : 500);
      return reply.send(errorBody);
    }
  });
}
