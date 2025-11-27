import type { FastifyInstance } from "fastify";
import type { components } from "../generated/openapi.d.ts";
import { CEEExplainGraphInput, type CEEExplainGraphInputT } from "../schemas/cee.js";
import { buildExplanation } from "../cee/explain/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { buildCeeGuidance, type ResponseLimitsLike } from "../cee/guidance/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { config } from "../config/index.js";

type CEEExplainGraphResponseV1 = components["schemas"]["CEEExplainGraphResponseV1"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeExplainBuckets = new Map<string, BucketState>();

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

function checkCeeExplainLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeExplainBuckets, now);
  let state = ceeExplainBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeExplainBuckets.set(key, state);
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
  const EXPLAIN_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_EXPLAIN_RATE_LIMIT_RPM");
  const FEATURE_VERSION = config.cee.explainFeatureVersion || "explain-model-1.0.0";

  app.post("/assist/v1/explain-graph", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as any;
    const hasContextId =
      rawBody && typeof rawBody === "object" && typeof (rawBody as any).context_id === "string";

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.CeeExplainGraphRequested, {
      ...telemetryCtx,
      feature: "cee_explain_graph",
      has_context_id: hasContextId,
      api_key_present: apiKeyPresent,
    });

    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeExplainLimit(rateKey, EXPLAIN_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Explain Graph rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeExplainGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_graph",
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

    const parsed = CEEExplainGraphInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeExplainGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_graph",
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

    const input = parsed.data as CEEExplainGraphInputT;

    try {
      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      const provider =
        typeof input.inference.model_card?.provider === "string"
          ? input.inference.model_card.provider
          : undefined;
      const model =
        typeof input.inference.model_card?.model === "string"
          ? input.inference.model_card.model
          : undefined;

      if (provider || model) {
        trace.engine = {
          ...(trace.engine || {}),
          provider,
          model,
        };
      }

      const validationIssues: CEEValidationIssue[] = [];

      const quality = computeQuality({
        graph: input.graph as any,
        confidence: 0.8,
        engineIssueCount: 0,
        ceeIssues: validationIssues,
      });

      const explanation = buildExplanation(input.graph as any, input.inference as any);

      const limits: ResponseLimitsLike = {};
      const guidance = buildCeeGuidance({
        quality,
        validationIssues,
        limits,
      });

      const ceeResponse: CEEExplainGraphResponseV1 = {
        trace,
        quality,
        validation_issues: validationIssues.length ? validationIssues : undefined,
        explanation,
        guidance,
      };

      const latencyMs = Date.now() - start;
      const hasValidationIssues = validationIssues.length > 0;
      const engineProvider = trace.engine?.provider ?? "unknown";
      const engineModel = trace.engine?.model ?? "unknown";
      const engineDegraded = Boolean(trace.engine && (trace.engine as any).degraded);

      emit(TelemetryEvents.CeeExplainGraphSucceeded, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        quality_overall: quality.overall,
        target_count: explanation.targets ? Object.keys(explanation.targets).length : 0,
        driver_count: Array.isArray(explanation.top_drivers) ? explanation.top_drivers.length : 0,
        engine_provider: engineProvider,
        engine_model: engineModel,
        has_validation_issues: hasValidationIssues,
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_graph",
        provider: engineProvider,
        model: engineModel,
        latencyMs,
        status: engineDegraded || hasValidationIssues ? "degraded" : "ok",
        hasValidationIssues,
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(ceeResponse);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");

      emit(TelemetryEvents.CeeExplainGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: "cee_explain_graph",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_INTERNAL_ERROR",
        httpStatus: 500,
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
