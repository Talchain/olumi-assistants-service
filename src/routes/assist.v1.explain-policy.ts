/**
 * POST /assist/v1/explain-policy
 *
 * Explains sequential decision/policy logic.
 * Template-based (no LLM calls) for fast, deterministic output.
 */

import type { FastifyInstance } from "fastify";
import { CEEExplainPolicyInput } from "../schemas/cee.js";
import type { CEEExplainPolicyResponseV1T } from "../schemas/ceeResponses.js";
import { explainPolicy } from "../cee/recommendation-narrative/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { getCeeFeatureRateLimiter } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

export default async function route(app: FastifyInstance) {
  const rateLimiter = getCeeFeatureRateLimiter(
    "explain_policy",
    "CEE_EXPLAIN_POLICY_RATE_LIMIT_RPM"
  );
  const FEATURE_VERSION = "explain-policy-1.0.0";

  app.post("/assist/v1/explain-policy", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.CeeExplainPolicyRequested, {
      ...telemetryCtx,
      feature: "cee_explain_policy",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = rateLimiter.tryConsume(rateKey);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Explain Policy rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.CeeExplainPolicyFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_policy",
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
    const parsed = CEEExplainPolicyInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeExplainPolicyFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_policy",
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
      // Generate policy explanation (deterministic, no LLM calls)
      const result = explainPolicy({
        policy_steps: input.policy_steps,
        goal_label: input.goal_label,
        context: input.context,
      });

      const response: CEEExplainPolicyResponseV1T = {
        policy_narrative: result.policy_narrative,
        steps_explained: result.steps_explained,
        dependencies_explained: result.dependencies_explained,
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

      emit(TelemetryEvents.CeeExplainPolicyCompleted, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        step_count: input.policy_steps.length,
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_policy",
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

      emit(TelemetryEvents.CeeExplainPolicyFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
        error_message: err instanceof Error ? err.message : String(err),
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_policy",
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
