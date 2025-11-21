import type { FastifyInstance } from "fastify";
import type { components } from "../generated/openapi.d.ts";
import { CEEOptionsInput, type CEEOptionsInputT } from "../schemas/cee.js";
import { generateOptions } from "../cee/options/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { buildCeeGuidance, type ResponseLimitsLike } from "../cee/guidance/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId } from "../plugins/auth.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

import type { GraphV1 } from "../contracts/plot/engine.js";

type CEEOptionsResponseV1 = components["schemas"]["CEEOptionsResponseV1"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeOptionsBuckets = new Map<string, BucketState>();

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

function checkCeeOptionsLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeOptionsBuckets, now);
  let state = ceeOptionsBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeOptionsBuckets.set(key, state);
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
  const OPTIONS_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_OPTIONS_RATE_LIMIT_RPM");
  const FEATURE_VERSION = process.env.CEE_OPTIONS_FEATURE_VERSION || "options-1.0.0";

  app.post("/assist/v1/options", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as any;
    const hasArchetype = rawBody && typeof rawBody === "object" && rawBody.archetype != null;

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);

    emit(TelemetryEvents.CeeOptionsRequested, {
      request_id: requestId,
      feature: "cee_options",
      has_archetype: hasArchetype,
      api_key_present: apiKeyPresent,
    });

    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeOptionsLimit(rateKey, OPTIONS_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Options rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeOptionsFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_options",
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

    const parsed = CEEOptionsInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeOptionsFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_options",
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

    const input = parsed.data as CEEOptionsInputT;

    try {
      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      const graph = input.graph as unknown as GraphV1;

      const validationIssues: CEEValidationIssue[] = [];

      const nodeCount = Array.isArray((graph as any).nodes) ? (graph as any).nodes.length : 0;
      if (nodeCount < 2) {
        validationIssues.push({
          code: "trivial_graph",
          severity: "info",
          field: "graph",
          details: { node_count: nodeCount },
        } as any);
      }

      const options = generateOptions(graph, (input as any).archetype ?? null);

      const OPTIONS_MAX = 6;
      let optionsTruncated = false;
      let cappedOptions = options;
      if (options.length > OPTIONS_MAX) {
        cappedOptions = options.slice(0, OPTIONS_MAX);
        optionsTruncated = true;
      }

      let confidence = 0.65;
      const optionCount = Array.isArray((graph as any).nodes)
        ? (graph as any).nodes.filter((n: any) => n && n.kind === "option").length
        : 0;
      if (optionCount === 0) {
        confidence -= 0.1;
      } else if (optionCount >= 2 && optionCount <= 6) {
        confidence += 0.1;
      }
      confidence = Math.max(0.3, Math.min(0.95, confidence));

      const quality = computeQuality({
        graph,
        confidence,
        engineIssueCount: 0,
        ceeIssues: validationIssues,
      });

      const responseLimits = {
        options_max: OPTIONS_MAX,
        options_truncated: optionsTruncated,
      } as CEEOptionsResponseV1["response_limits"];

      const limits: ResponseLimitsLike = {
        options_truncated: optionsTruncated,
      };
      const guidance = buildCeeGuidance({
        quality,
        validationIssues,
        limits,
      });

      const ceeResponse: CEEOptionsResponseV1 = {
        trace,
        quality,
        validation_issues: validationIssues.length ? validationIssues : undefined,
        options: cappedOptions as any,
        response_limits: responseLimits,
        guidance,
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeOptionsSucceeded, {
        request_id: requestId,
        latency_ms: latencyMs,
        quality_overall: quality.overall,
        option_count: options.length,
        any_truncated: optionsTruncated,
        has_validation_issues: validationIssues.length > 0,
      });

      logCeeCall({
        requestId,
        capability: "cee_options",
        latencyMs,
        status:
          optionsTruncated || validationIssues.length > 0
            ? "degraded"
            : "ok",
        anyTruncated: optionsTruncated,
        hasValidationIssues: validationIssues.length > 0,
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(ceeResponse);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");

      emit(TelemetryEvents.CeeOptionsFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: "cee_options",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_INTERNAL_ERROR",
        httpStatus: 500,
      });

      const errorBody = buildCeeErrorResponse(
        "CEE_INTERNAL_ERROR",
        err.message || "internal error",
        {
          retryable: false,
          requestId,
        }
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
