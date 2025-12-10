import type { FastifyInstance } from "fastify";
import { CEEKeyInsightInput, type CEEKeyInsightInputT } from "../schemas/cee.js";
import {
  CEEKeyInsightResponseV1Schema,
  type CEEKeyInsightResponseV1T,
} from "../schemas/ceeResponses.js";
import { generateKeyInsight, type RankedAction, type Driver } from "../cee/key-insight/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents, log } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import type { GraphV1 } from "../contracts/plot/engine.js";

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeKeyInsightBuckets = new Map<string, BucketState>();

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

function checkCeeKeyInsightLimit(
  key: string,
  limit: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeKeyInsightBuckets, now);
  let state = ceeKeyInsightBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeKeyInsightBuckets.set(key, state);
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
  const KEY_INSIGHT_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_KEY_INSIGHT_RATE_LIMIT_RPM") ?? 30;
  const FEATURE_VERSION = "key-insight-1.0.0";

  app.post("/assist/v1/key-insight", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx
      ? contextToTelemetry(callerCtx)
      : { request_id: requestId };

    emit(TelemetryEvents.CeeKeyInsightRequested, {
      ...telemetryCtx,
      feature: "cee_key_insight",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeKeyInsightLimit(
      rateKey,
      KEY_INSIGHT_RATE_LIMIT_RPM
    );

    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Key Insight rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeKeyInsightFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_key_insight",
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
    const parsed = CEEKeyInsightInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse(
        "CEE_VALIDATION_FAILED",
        "invalid input",
        {
          retryable: false,
          requestId,
          details: { field_errors: parsed.error.flatten() },
        }
      );

      emit(TelemetryEvents.CeeKeyInsightFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_key_insight",
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

    const input = parsed.data as CEEKeyInsightInputT;

    try {
      // Map input to key insight types
      const rankedActions: RankedAction[] = input.ranked_actions.map((a) => ({
        node_id: a.node_id,
        label: a.label,
        expected_utility: a.expected_utility,
        dominant: a.dominant,
      }));

      const topDrivers: Driver[] | undefined = input.top_drivers?.map((d) => ({
        node_id: d.node_id,
        label: d.label,
        impact_pct: d.impact_pct,
        direction: d.direction,
      }));

      // Generate key insight
      const insight = generateKeyInsight({
        graph: input.graph as GraphV1,
        ranked_actions: rankedActions,
        top_drivers: topDrivers,
      });

      // Compute quality
      const quality = computeQuality({
        graph: input.graph as GraphV1,
        confidence: rankedActions[0]?.expected_utility ?? 0.5,
        engineIssueCount: 0,
        ceeIssues: [],
      });

      // Build response
      const response: CEEKeyInsightResponseV1T = {
        headline: insight.headline,
        primary_driver: insight.primary_driver,
        confidence_statement: insight.confidence_statement,
        caveat: insight.caveat,
        quality,
        trace: {
          request_id: requestId,
          correlation_id: requestId,
          context_id: input.context_id,
        },
        provenance: "cee",
      };

      // Validate response schema
      const validationResult = CEEKeyInsightResponseV1Schema.safeParse(response);
      if (!validationResult.success) {
        log.error(
          { error: validationResult.error, request_id: requestId },
          "Key insight response schema validation failed"
        );
        throw new Error("Internal response validation failed");
      }

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeKeyInsightSucceeded, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        quality_overall: quality.overall,
        has_caveat: Boolean(insight.caveat),
        ranked_action_count: rankedActions.length,
        driver_count: topDrivers?.length ?? 0,
      });

      logCeeCall({
        requestId,
        capability: "cee_key_insight",
        latencyMs,
        status: "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");

      emit(TelemetryEvents.CeeKeyInsightFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: "cee_key_insight",
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
