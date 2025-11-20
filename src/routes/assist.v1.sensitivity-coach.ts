import type { FastifyInstance } from "fastify";
import type { components } from "../generated/openapi.d.ts";
import { CEESensitivityCoachInput, type CEESensitivityCoachInputT } from "../schemas/cee.js";
import { buildSensitivitySuggestions } from "../cee/sensitivity/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { buildCeeGuidance, type ResponseLimitsLike } from "../cee/guidance/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId } from "../plugins/auth.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";

import type { GraphV1 } from "../contracts/plot/engine.js";

type CEESensitivityCoachResponseV1 = components["schemas"]["CEESensitivityCoachResponseV1"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeSensitivityBuckets = new Map<string, BucketState>();

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

function checkCeeSensitivityLimit(
  key: string,
  limit: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeSensitivityBuckets, now);
  let state = ceeSensitivityBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeSensitivityBuckets.set(key, state);
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
  const SENSITIVITY_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_SENSITIVITY_COACH_RATE_LIMIT_RPM");
  const FEATURE_VERSION = process.env.CEE_SENSITIVITY_COACH_FEATURE_VERSION || "sensitivity-coach-1.0.0";

  app.post("/assist/v1/sensitivity-coach", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as any;
    const hasInference = rawBody && typeof rawBody === "object" && rawBody.inference != null;

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);

    emit(TelemetryEvents.CeeSensitivityCoachRequested, {
      request_id: requestId,
      feature: "cee_sensitivity_coach",
      has_inference: hasInference,
      api_key_present: apiKeyPresent,
    });

    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeSensitivityLimit(rateKey, SENSITIVITY_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Sensitivity Coach rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.CeeSensitivityCoachFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      reply.header("Retry-After", retryAfterSeconds.toString());
      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    const parsed = CEESensitivityCoachInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeSensitivityCoachFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const input = parsed.data as CEESensitivityCoachInputT;

    try {
      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      const graph = input.graph as unknown as GraphV1;

      const validationIssues: CEEValidationIssue[] = [];

      const rawDrivers = input.inference?.explain?.top_drivers ?? [];
      const driverCount = Array.isArray(rawDrivers) ? rawDrivers.length : 0;

      let confidence = 0.6;
      if (driverCount === 0) {
        confidence -= 0.1;
      } else if (driverCount >= 1 && driverCount <= 5) {
        confidence += 0.05;
      } else if (driverCount > 5) {
        confidence += 0.1;
      }
      confidence = Math.max(0.3, Math.min(0.95, confidence));

      const suggestions = buildSensitivitySuggestions(graph, input.inference as any);

      const SUGGESTIONS_MAX = 10;
      let suggestionsTruncated = false;
      let cappedSuggestions = suggestions;
      if (suggestions.length > SUGGESTIONS_MAX) {
        cappedSuggestions = suggestions.slice(0, SUGGESTIONS_MAX);
        suggestionsTruncated = true;
      }

      const quality = computeQuality({
        graph,
        confidence,
        engineIssueCount: 0,
        ceeIssues: validationIssues,
      });

      const responseLimits = {
        sensitivity_suggestions_max: SUGGESTIONS_MAX,
        sensitivity_suggestions_truncated: suggestionsTruncated,
      } as CEESensitivityCoachResponseV1["response_limits"];

      const limits: ResponseLimitsLike = {
        sensitivity_suggestions_truncated: suggestionsTruncated,
      };
      const guidance = buildCeeGuidance({
        quality,
        validationIssues,
        limits,
      });

      const ceeResponse: CEESensitivityCoachResponseV1 = {
        trace,
        quality,
        validation_issues: validationIssues.length ? validationIssues : undefined,
        sensitivity_suggestions: cappedSuggestions as any,
        response_limits: responseLimits,
        guidance,
      };

      emit(TelemetryEvents.CeeSensitivityCoachSucceeded, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        quality_overall: quality.overall,
        driver_count: driverCount,
        any_truncated: suggestionsTruncated,
        has_validation_issues: validationIssues.length > 0,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(ceeResponse);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");

      emit(TelemetryEvents.CeeSensitivityCoachFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      const errorBody = buildCeeErrorResponse("CEE_INTERNAL_ERROR", err.message || "internal error", {
        retryable: false,
        requestId,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
