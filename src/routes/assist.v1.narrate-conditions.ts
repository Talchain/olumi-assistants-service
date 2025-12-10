/**
 * POST /assist/v1/narrate-conditions
 *
 * Generates conditional recommendation narratives ("If X then Y, otherwise Z").
 * Template-based (no LLM calls) for fast, deterministic output.
 */

import type { FastifyInstance } from "fastify";
import { CEENarrateConditionsInput } from "../schemas/cee.js";
import type { CEENarrateConditionsResponseV1T } from "../schemas/ceeResponses.js";
import { narrateConditions } from "../cee/recommendation-narrative/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { getCeeFeatureRateLimiter } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

export default async function route(app: FastifyInstance) {
  const rateLimiter = getCeeFeatureRateLimiter(
    "narrate_conditions",
    "CEE_NARRATE_CONDITIONS_RATE_LIMIT_RPM"
  );
  const FEATURE_VERSION = "narrate-conditions-1.0.0";

  app.post("/assist/v1/narrate-conditions", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.CeeNarrateConditionsRequested, {
      ...telemetryCtx,
      feature: "cee_narrate_conditions",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = rateLimiter.tryConsume(rateKey);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Narrate Conditions rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.CeeNarrateConditionsFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_narrate_conditions",
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

    // Input validation
    const parsed = CEENarrateConditionsInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeNarrateConditionsFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_narrate_conditions",
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

    const input = parsed.data;

    try {
      // Generate conditional narrative (deterministic, no LLM calls)
      const result = narrateConditions({
        conditions: input.conditions,
        primary_recommendation: input.primary_recommendation,
        context: input.context,
      });

      const response: CEENarrateConditionsResponseV1T = {
        narrative: result.narrative,
        conditions_summary: result.conditions_summary,
        key_decision_points: result.key_decision_points,
        trace: {
          request_id: requestId,
          correlation_id: requestId,
          engine: {},
        },
        quality: {
          overall: 80, // Template-based, consistent quality
          structure: 90,
          coverage: 80,
        },
        provenance: "cee",
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeNarrateConditionsCompleted, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        condition_count: input.conditions.length,
      });

      logCeeCall({
        requestId,
        capability: "cee_narrate_conditions",
        latencyMs,
        status: "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (err) {
      const errorBody = buildCeeErrorResponse(
        "CEE_INTERNAL_ERROR",
        err instanceof Error ? err.message : "Internal error",
        {
          retryable: true,
          requestId,
        },
      );

      emit(TelemetryEvents.CeeNarrateConditionsFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
        error_message: err instanceof Error ? err.message : String(err),
      });

      logCeeCall({
        requestId,
        capability: "cee_narrate_conditions",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_INTERNAL_ERROR",
        httpStatus: 500,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
