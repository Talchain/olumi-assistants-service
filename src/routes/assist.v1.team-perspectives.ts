import type { FastifyInstance } from "fastify";
import type { components } from "../generated/openapi.d.ts";
import { CEETeamPerspectivesInput, type CEETeamPerspectivesInputT } from "../schemas/cee.js";
import { summariseTeam } from "../cee/team/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { buildCeeGuidance, type ResponseLimitsLike } from "../cee/guidance/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId } from "../plugins/auth.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

type CEETeamPerspectivesResponseV1 = components["schemas"]["CEETeamPerspectivesResponseV1"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeTeamBuckets = new Map<string, BucketState>();

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

function checkCeeTeamLimit(
  key: string,
  limit: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeTeamBuckets, now);
  let state = ceeTeamBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeTeamBuckets.set(key, state);
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
  const TEAM_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_TEAM_PERSPECTIVES_RATE_LIMIT_RPM");
  const FEATURE_VERSION =
    process.env.CEE_TEAM_PERSPECTIVES_FEATURE_VERSION || "team-perspectives-1.0.0";

  app.post("/assist/v1/team-perspectives", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as any;
    const participantCountRaw =
      rawBody && Array.isArray((rawBody as any).perspectives)
        ? (rawBody as any).perspectives.length
        : 0;

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);

    emit(TelemetryEvents.CeeTeamPerspectivesRequested, {
      request_id: requestId,
      feature: "cee_team_perspectives",
      participant_count: participantCountRaw,
      api_key_present: apiKeyPresent,
    });

    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeTeamLimit(rateKey, TEAM_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Team Perspectives rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.CeeTeamPerspectivesFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_team_perspectives",
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

    const parsed = CEETeamPerspectivesInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeTeamPerspectivesFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_team_perspectives",
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

    const input = parsed.data as CEETeamPerspectivesInputT;

    try {
      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      const perspectives = input.perspectives as any[];

      const summary = summariseTeam(perspectives as any);

      const validationIssues: CEEValidationIssue[] = [];

      const participantCount = summary.participant_count;

      let confidence = 0.6;
      if (participantCount >= 3) {
        confidence += 0.05;
      }

      let confidenceSum = 0;
      let confidenceSeen = 0;
      for (const p of perspectives) {
        const c = (p as any).confidence;
        if (typeof c === "number" && Number.isFinite(c)) {
          confidenceSum += c;
          confidenceSeen += 1;
        }
      }

      const meanConfidence = confidenceSeen > 0 ? confidenceSum / confidenceSeen : undefined;
      if (meanConfidence !== undefined && meanConfidence >= 0.7) {
        confidence += 0.05;
      }

      if (!Number.isFinite(confidence)) {
        confidence = 0.6;
      }
      confidence = Math.max(0.3, Math.min(0.95, confidence));

      const quality = computeQuality({
        graph: undefined,
        confidence,
        engineIssueCount: 0,
        ceeIssues: validationIssues,
      });

      const limits: ResponseLimitsLike = {};
      const guidance = buildCeeGuidance({
        quality,
        validationIssues,
        limits,
      });

      const ceeResponse: CEETeamPerspectivesResponseV1 = {
        trace,
        quality,
        validation_issues: validationIssues.length ? validationIssues : undefined,
        summary: summary as any,
        guidance,
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeTeamPerspectivesSucceeded, {
        request_id: requestId,
        latency_ms: latencyMs,
        quality_overall: quality.overall,
        participant_count: summary.participant_count,
        disagreement_score: summary.disagreement_score,
        has_validation_issues: validationIssues.length > 0,
      });

      logCeeCall({
        requestId,
        capability: "cee_team_perspectives",
        latencyMs,
        status: validationIssues.length > 0 ? "degraded" : "ok",
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

      emit(TelemetryEvents.CeeTeamPerspectivesFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: "cee_team_perspectives",
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
