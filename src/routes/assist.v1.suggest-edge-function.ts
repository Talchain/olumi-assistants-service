/**
 * POST /assist/v1/suggest-edge-function
 *
 * Suggests non-linear edge function types based on pattern matching
 * of node labels and relationship descriptions.
 *
 * Pure pattern matching - no LLM calls.
 */

import type { FastifyInstance } from "fastify";
import { CEEEdgeFunctionSuggestionInput } from "../schemas/cee.js";
import { suggestEdgeFunction } from "../cee/edge-function-suggestions/index.js";
import type { EdgeFunctionSuggestionOutput } from "../cee/edge-function-suggestions/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

interface CEETraceMeta {
  request_id?: string;
  correlation_id?: string;
  engine?: Record<string, unknown>;
}

interface CEEEdgeFunctionSuggestionResponseV1 extends EdgeFunctionSuggestionOutput {
  trace?: CEETraceMeta;
}

// Rate limiting
type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const edgeFunctionBuckets = new Map<string, BucketState>();

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

function checkRateLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(edgeFunctionBuckets, now);
  let state = edgeFunctionBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    edgeFunctionBuckets.set(key, state);
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

export default async function route(app: FastifyInstance) {
  const RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_EDGE_FUNCTION_RATE_LIMIT_RPM");
  const FEATURE_VERSION = "edge-function-suggestions-1.0.0";

  app.post("/assist/v1/suggest-edge-function", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.CeeEdgeFunctionRequested, {
      ...telemetryCtx,
      feature: "cee_edge_function_suggestion",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkRateLimit(rateKey, RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Edge Function Suggestion rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.CeeEdgeFunctionFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_edge_function_suggestion",
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
    const parsed = CEEEdgeFunctionSuggestionInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeEdgeFunctionFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_edge_function_suggestion",
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
      // Perform suggestion (deterministic, no LLM calls)
      const suggestion = suggestEdgeFunction({
        edge_id: input.edge_id,
        source_node: input.source_node,
        target_node: input.target_node,
        relationship_description: input.relationship_description,
      });

      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      const response: CEEEdgeFunctionSuggestionResponseV1 = {
        ...suggestion,
        trace,
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeEdgeFunctionCompleted, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        suggested_function: suggestion.suggested_function,
        confidence: suggestion.confidence,
        alternative_count: suggestion.alternatives.length,
      });

      logCeeCall({
        requestId,
        capability: "cee_edge_function_suggestion",
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

      emit(TelemetryEvents.CeeEdgeFunctionFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
        error_message: err instanceof Error ? err.message : String(err),
      });

      logCeeCall({
        requestId,
        capability: "cee_edge_function_suggestion",
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
