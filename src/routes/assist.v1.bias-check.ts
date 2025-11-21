import type { FastifyInstance } from "fastify";
import type { components } from "../generated/openapi.d.ts";
import { CEEBiasCheckInput, type CEEBiasCheckInputT } from "../schemas/cee.js";
import { detectBiases } from "../cee/bias/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { buildCeeGuidance, type ResponseLimitsLike } from "../cee/guidance/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId } from "../plugins/auth.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

import type { GraphV1 } from "../contracts/plot/engine.js";

type CEEBiasCheckResponseV1 = components["schemas"]["CEEBiasCheckResponseV1"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeBiasBuckets = new Map<string, BucketState>();

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

function checkCeeBiasLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeBiasBuckets, now);
  let state = ceeBiasBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeBiasBuckets.set(key, state);
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
  const BIAS_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_BIAS_CHECK_RATE_LIMIT_RPM");
  const FEATURE_VERSION = process.env.CEE_BIAS_CHECK_FEATURE_VERSION || "bias-check-1.0.0";

  app.post("/assist/v1/bias-check", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as any;
    const hasArchetype = rawBody && typeof rawBody === "object" && rawBody.archetype != null;

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);

    emit(TelemetryEvents.CeeBiasCheckRequested, {
      request_id: requestId,
      feature: "cee_bias_check",
      has_archetype: hasArchetype,
      api_key_present: apiKeyPresent,
    });

    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeBiasLimit(rateKey, BIAS_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Bias Check rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeBiasCheckFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_bias_check",
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

    const parsed = CEEBiasCheckInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeBiasCheckFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_bias_check",
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

    const input = parsed.data as CEEBiasCheckInputT;

    try {
      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      const graph = input.graph as unknown as GraphV1;

      const validationIssues: CEEValidationIssue[] = [];

      const findings = detectBiases(graph, (input as any).archetype ?? null);

      const BIAS_FINDINGS_MAX = 10;
      let biasFindingsTruncated = false;
      let cappedFindings = findings;
      if (findings.length > BIAS_FINDINGS_MAX) {
        cappedFindings = findings.slice(0, BIAS_FINDINGS_MAX);
        biasFindingsTruncated = true;
      }

      // Heuristic confidence: start moderate and penalise tiny graphs
      let confidence = 0.7;
      const nodeCount = Array.isArray((graph as any).nodes) ? (graph as any).nodes.length : 0;
      if (nodeCount < 3) {
        confidence -= 0.15;
      }
      confidence = Math.max(0.3, Math.min(0.95, confidence));

      const quality = computeQuality({
        graph,
        confidence,
        engineIssueCount: 0,
        ceeIssues: validationIssues,
      });

      const responseLimits = {
        bias_findings_max: BIAS_FINDINGS_MAX,
        bias_findings_truncated: biasFindingsTruncated,
      } as CEEBiasCheckResponseV1["response_limits"];

      const limits: ResponseLimitsLike = {
        bias_findings_truncated: biasFindingsTruncated,
      };
      const guidance = buildCeeGuidance({
        quality,
        validationIssues,
        limits,
      });

      const ceeResponse: CEEBiasCheckResponseV1 = {
        trace,
        quality,
        validation_issues: validationIssues.length ? validationIssues : undefined,
        bias_findings: cappedFindings as any,
        response_limits: responseLimits,
        guidance,
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeBiasCheckSucceeded, {
        request_id: requestId,
        latency_ms: latencyMs,
        quality_overall: quality.overall,
        bias_count: findings.length,
        any_truncated: biasFindingsTruncated,
        has_validation_issues: validationIssues.length > 0,
      });

      logCeeCall({
        requestId,
        capability: "cee_bias_check",
        latencyMs,
        status:
          biasFindingsTruncated || validationIssues.length > 0
            ? "degraded"
            : "ok",
        anyTruncated: biasFindingsTruncated,
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

      emit(TelemetryEvents.CeeBiasCheckFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: "cee_bias_check",
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
