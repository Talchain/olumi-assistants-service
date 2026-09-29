import type { FastifyInstance } from "fastify";
import { CEERiskToleranceInput, type CEERiskToleranceInputT } from "../schemas/cee.js";
import {
  CEERiskToleranceGetQuestionsResponseV1Schema,
  CEERiskToleranceProcessResponsesResponseV1Schema,
  type CEERiskToleranceGetQuestionsResponseV1T,
  type CEERiskToleranceProcessResponsesResponseV1T,
} from "../schemas/ceeResponses.js";
import { elicitRiskTolerance } from "../cee/risk-tolerance-elicitation/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents, log } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeRiskToleranceBuckets = new Map<string, BucketState>();

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

function checkCeeRiskToleranceLimit(
  key: string,
  limit: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeRiskToleranceBuckets, now);
  let state = ceeRiskToleranceBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeRiskToleranceBuckets.set(key, state);
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
  const RISK_TOLERANCE_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_RISK_TOLERANCE_RATE_LIMIT_RPM") ?? 60;
  const FEATURE_VERSION = "risk-tolerance-1.0.0";

  app.post("/assist/v1/elicit-risk-tolerance", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx
      ? contextToTelemetry(callerCtx)
      : { request_id: requestId };

    emit(TelemetryEvents.CeeRiskToleranceRequested, {
      ...telemetryCtx,
      feature: "cee_risk_tolerance",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeRiskToleranceLimit(
      rateKey,
      RISK_TOLERANCE_RATE_LIMIT_RPM
    );

    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Risk Tolerance rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeRiskToleranceFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_risk_tolerance",
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
    const parsed = CEERiskToleranceInput.safeParse(req.body);
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

      emit(TelemetryEvents.CeeRiskToleranceFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_risk_tolerance",
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

    const input = parsed.data as CEERiskToleranceInputT;

    try {
      // Elicit risk tolerance based on mode
      const result = elicitRiskTolerance({
        mode: input.mode,
        context: input.context,
        responses: input.responses,
      });

      const latencyMs = Date.now() - start;

      // Build and validate response based on mode
      if (input.mode === "get_questions") {
        const response: CEERiskToleranceGetQuestionsResponseV1T = {
          questions: (result as { questions: Array<{ id: string; question: string; options: Array<{ id: string; label: string; description?: string; risk_score: number }> }> }).questions,
          provenance: "cee",
          trace: {
            request_id: requestId,
            correlation_id: requestId,
            context_id: input.context_id,
          },
        };

        const validationResult = CEERiskToleranceGetQuestionsResponseV1Schema.safeParse(response);
        if (!validationResult.success) {
          log.error(
            { error: validationResult.error, request_id: requestId },
            "Risk tolerance get_questions response schema validation failed"
          );
          throw new Error("Internal response validation failed");
        }

        emit(TelemetryEvents.CeeRiskToleranceSucceeded, {
          ...telemetryCtx,
          latency_ms: latencyMs,
          mode: "get_questions",
          context: input.context,
          question_count: response.questions.length,
        });

        logCeeCall({
          requestId,
          capability: "cee_risk_tolerance",
          latencyMs,
          status: "ok",
          httpStatus: 200,
        });

        reply.header("X-CEE-API-Version", "v1");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.code(200);
        return reply.send(response);
      } else {
        // process_responses mode
        const processResult = result as {
          profile: { type: string; score: number; reasoning: string; recommended_coefficient: number };
          breakdown: { certainty: number; loss_aversion: number; time_preference: number };
          confidence: string;
        };

        const response: CEERiskToleranceProcessResponsesResponseV1T = {
          profile: processResult.profile as CEERiskToleranceProcessResponsesResponseV1T["profile"],
          breakdown: processResult.breakdown,
          confidence: processResult.confidence as "high" | "medium" | "low",
          provenance: "cee",
          trace: {
            request_id: requestId,
            correlation_id: requestId,
            context_id: input.context_id,
          },
        };

        const validationResult = CEERiskToleranceProcessResponsesResponseV1Schema.safeParse(response);
        if (!validationResult.success) {
          log.error(
            { error: validationResult.error, request_id: requestId },
            "Risk tolerance process_responses response schema validation failed"
          );
          throw new Error("Internal response validation failed");
        }

        emit(TelemetryEvents.CeeRiskToleranceSucceeded, {
          ...telemetryCtx,
          latency_ms: latencyMs,
          mode: "process_responses",
          context: input.context,
          response_count: input.responses?.length ?? 0,
          profile_type: response.profile.type,
          profile_score: response.profile.score,
          confidence: response.confidence,
        });

        logCeeCall({
          requestId,
          capability: "cee_risk_tolerance",
          latencyMs,
          status: "ok",
          httpStatus: 200,
        });

        reply.header("X-CEE-API-Version", "v1");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.code(200);
        return reply.send(response);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");

      emit(TelemetryEvents.CeeRiskToleranceFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
      });

      logCeeCall({
        requestId,
        capability: "cee_risk_tolerance",
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
