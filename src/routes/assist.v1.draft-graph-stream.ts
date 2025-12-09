import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { DraftGraphInput, type DraftGraphInputT } from "../schemas/assist.js";
import { sanitizeDraftGraphInput } from "./assist.draft-graph.js";
import { finaliseCeeDraftResponse, buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { config } from "../config/index.js";
import { assessBriefReadiness } from "../cee/validation/readiness.js";
import { createResumeToken } from "../utils/sse-resume-token.js";
import {
  initStreamState,
  bufferEvent,
  markStreamComplete,
  cleanupStreamState,
  getStreamState,
} from "../utils/sse-state.js";
import { getRedis } from "../platform/redis.js";
import {
  SSE_DEGRADED_HEADER_NAME,
  SSE_DEGRADED_REDIS_REASON,
  SSE_DEGRADED_KIND_REDIS_UNAVAILABLE,
} from "../utils/degraded-mode.js";

const EVENT_STREAM = "text/event-stream";
const SSE_HEADERS = {
  "content-type": EVENT_STREAM,
  connection: "keep-alive",
  "cache-control": "no-cache",
} as const;

// Simple in-memory rate limiter for CEE SSE streaming
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const PRUNE_INTERVAL = 100;

type BucketState = {
  count: number;
  windowStart: number;
};

const ceeStreamBuckets = new Map<string, BucketState>();
let pruneCounter = 0;
let oldestKnownTimestamp = Date.now();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS && now - oldestKnownTimestamp <= MAX_BUCKET_AGE_MS) {
    return;
  }

  pruneCounter++;
  if (pruneCounter < PRUNE_INTERVAL && map.size <= MAX_BUCKETS) {
    return;
  }
  pruneCounter = 0;

  let newOldest = now;
  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    } else if (state.windowStart < newOldest) {
      newOldest = state.windowStart;
    }
  }
  oldestKnownTimestamp = newOldest;

  if (map.size <= MAX_BUCKETS) return;

  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

function checkCeeStreamLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeStreamBuckets, now);
  let state = ceeStreamBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeStreamBuckets.set(key, state);
  }

  if (now - state.windowStart > WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }

  if (state.count >= limit) {
    const retryAfter = Math.ceil((state.windowStart + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  state.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

interface StageEvent {
  stage: string;
  payload?: unknown;
}

async function writeStage(reply: FastifyReply, event: StageEvent): Promise<void> {
  const line = `event: stage\ndata: ${JSON.stringify(event)}\n\n`;
  return new Promise<void>((resolve, reject) => {
    const ok = reply.raw.write(line);
    if (ok) {
      resolve();
    } else {
      const timeout = setTimeout(() => {
        reject(new Error("SSE write timeout"));
      }, 5000);

      reply.raw.once("drain", () => {
        clearTimeout(timeout);
        resolve();
      });
    }
  });
}

export default async function route(app: FastifyInstance) {
  const RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_STREAM_RATE_LIMIT_RPM") ?? 20;
  const FEATURE_VERSION = "stream-1.0.0";

  app.post("/assist/v1/draft-graph/stream", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req) ?? randomUUID();
    const keyId = getRequestKeyId(req);
    const callerContext = getRequestCallerContext(req);
    const telemetryCtx = callerContext ? contextToTelemetry(callerContext) : { request_id: requestId };

    // Rate limiting (per API key or per IP)
    const rateLimitKey = keyId ?? req.ip ?? "anonymous";
    const { allowed, retryAfterSeconds } = checkCeeStreamLimit(rateLimitKey, RATE_LIMIT_RPM);

    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Draft Stream rate limit exceeded",
        { retryable: true, requestId, details: { retry_after_seconds: retryAfterSeconds } }
      );

      emit(TelemetryEvents.CeeDraftGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_draft_graph_stream",
        latencyMs: Date.now() - start,
        status: "limited",
        errorCode: "CEE_RATE_LIMIT",
        httpStatus: 429,
      });

      reply.raw.setHeader("X-CEE-Request-ID", requestId);
      reply.raw.setHeader("Retry-After", retryAfterSeconds.toString());
      reply.raw.writeHead(429, SSE_HEADERS);
      await writeStage(reply, { stage: "COMPLETE", payload: errorBody });
      reply.raw.end();
      return reply;
    }

    // Check Redis availability for degraded mode detection
    let degradedMode = false;
    try {
      const redis = await getRedis();
      if (!redis) {
        degradedMode = true;
        reply.raw.setHeader(SSE_DEGRADED_HEADER_NAME, SSE_DEGRADED_REDIS_REASON);
        emit(TelemetryEvents.SseDegradedMode, {
          kind: SSE_DEGRADED_KIND_REDIS_UNAVAILABLE,
          correlation_id: requestId,
          endpoint: "/assist/v1/draft-graph/stream",
        });
      }
    } catch (error) {
      degradedMode = true;
      reply.raw.setHeader(SSE_DEGRADED_HEADER_NAME, SSE_DEGRADED_REDIS_REASON);
      emit(TelemetryEvents.SseDegradedMode, {
        kind: SSE_DEGRADED_KIND_REDIS_UNAVAILABLE,
        correlation_id: requestId,
        endpoint: "/assist/v1/draft-graph/stream",
      });
      log.warn({ error, correlation_id: requestId }, "Redis unavailable for v1 SSE streaming - degraded mode");
    }

    // Input validation
    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      log.warn({ correlation_id: requestId, validation_error: parsed.error.flatten() }, "v1 stream input validation failed");
      const errorBody = buildCeeErrorResponse(
        "CEE_VALIDATION_FAILED",
        "Invalid input",
        { retryable: false, requestId, details: { field_errors: parsed.error.flatten() } }
      );

      emit(TelemetryEvents.CeeDraftGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_draft_graph_stream",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_VALIDATION_FAILED",
        httpStatus: 400,
      });

      reply.raw.setHeader("X-CEE-Request-ID", requestId);
      reply.raw.writeHead(400, SSE_HEADERS);
      await writeStage(reply, { stage: "COMPLETE", payload: errorBody });
      reply.raw.end();
      return reply;
    }

    const input = sanitizeDraftGraphInput(parsed.data, req.body);

    // Preflight validation (if enabled)
    if (config.cee.preflightEnabled) {
      const readiness = assessBriefReadiness(input.brief);

      log.info({
        request_id: requestId,
        readiness_score: readiness.score,
        readiness_level: readiness.level,
        preflight_valid: readiness.preflight.valid,
        event: "cee.preflight.assessed",
      }, `Brief readiness: ${readiness.level} (score: ${readiness.score})`);

      // Clarification enforcement
      if (config.cee.clarificationEnforced) {
        const allowDirectThreshold = config.cee.clarificationThresholdAllowDirect;
        const oneRoundThreshold = config.cee.clarificationThresholdOneRound;
        const completedRounds = parsed.data.clarification_rounds_completed ?? 0;

        let requiredRounds = 0;
        if (readiness.score < allowDirectThreshold) {
          if (readiness.score >= oneRoundThreshold) {
            requiredRounds = 1;
          } else {
            requiredRounds = 2;
          }
        }

        if (requiredRounds > completedRounds) {
          const errorBody = buildCeeErrorResponse(
            "CEE_CLARIFICATION_REQUIRED",
            "Brief requires clarification before drafting",
            {
              retryable: true,
              requestId,
              details: {
                readiness_score: readiness.score,
                readiness_level: readiness.level,
                required_rounds: requiredRounds,
                completed_rounds: completedRounds,
                suggested_questions: readiness.suggested_questions,
                clarification_endpoint: "/assist/clarify-brief",
                hint: `Complete ${requiredRounds - completedRounds} more clarification round(s) before drafting`,
              },
            }
          );

          emit(TelemetryEvents.ClarificationRequired, {
            ...telemetryCtx,
            latency_ms: Date.now() - start,
            readiness_score: readiness.score,
            readiness_level: readiness.level,
            required_rounds: requiredRounds,
            completed_rounds: completedRounds,
          });

          logCeeCall({
            requestId,
            capability: "cee_draft_graph_stream",
            latencyMs: Date.now() - start,
            status: "error",
            errorCode: "CEE_CLARIFICATION_REQUIRED",
            httpStatus: 400,
          });

          reply.raw.setHeader("X-CEE-Request-ID", requestId);
          reply.raw.setHeader("X-CEE-Readiness-Score", readiness.score.toString());
          reply.raw.writeHead(400, SSE_HEADERS);
          await writeStage(reply, { stage: "COMPLETE", payload: errorBody });
          reply.raw.end();
          return reply;
        }
      }
    }

    // Initialize SSE response
    reply.raw.setHeader("X-CEE-API-Version", "v1");
    reply.raw.setHeader("X-CEE-Feature-Version", FEATURE_VERSION);
    reply.raw.setHeader("X-CEE-Request-ID", requestId);
    reply.raw.writeHead(200, SSE_HEADERS);

    // Send initial DRAFTING stage
    await writeStage(reply, { stage: "DRAFTING" });
    emit(TelemetryEvents.SSEStarted, { correlation_id: requestId, endpoint: "/assist/v1/draft-graph/stream" });

    let eventSeq = 0;

    // Initialize SSE state for resume (if Redis available)
    if (!degradedMode) {
      try {
        await initStreamState(requestId);
        await bufferEvent(requestId, {
          seq: eventSeq++,
          type: "stage",
          data: JSON.stringify({ stage: "DRAFTING" }),
          timestamp: Date.now(),
        });

        // Send resume token
        try {
          const resumeToken = createResumeToken(requestId, "DRAFTING", eventSeq);
          reply.raw.write(`event: resume\ndata: ${JSON.stringify({ token: resumeToken })}\n\n`);
          emit(TelemetryEvents.SseResumeIssued, {
            request_id: requestId,
            seq: eventSeq,
            step: "DRAFTING",
          });
          await bufferEvent(requestId, {
            seq: eventSeq++,
            type: "resume",
            data: JSON.stringify({ token: resumeToken }),
            timestamp: Date.now(),
          });
        } catch (tokenError) {
          log.debug({ error: tokenError, request_id: requestId }, "Resume token generation skipped");
        }
      } catch (stateError) {
        log.debug({ error: stateError, request_id: requestId }, "SSE state initialization skipped");
        degradedMode = true;
      }
    }

    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat\n\n`);
      } catch (error) {
        clearInterval(heartbeatInterval);
        log.debug({ error, correlation_id: requestId }, "Heartbeat failed - stopping");
      }
    }, 10000);

    let sseEndState: "complete" | "timeout" | "aborted" | "error" = "complete";

    try {
      // Run the CEE draft pipeline (includes all validations: single goal, outcome beliefs, etc.)
      const { statusCode, body, headers } = await finaliseCeeDraftResponse(input, req.body, req);

      // Add CEE headers to SSE if provided
      if (headers) {
        for (const [key, value] of Object.entries(headers)) {
          // Can't set headers after writeHead, but we can include in payload
          log.debug({ key, value }, "CEE response header (included in payload)");
        }
      }

      // Determine if this is an error response
      if (statusCode >= 400) {
        sseEndState = "error";
        emit(TelemetryEvents.SSEError, {
          correlation_id: requestId,
          status_code: statusCode,
          sse_end_state: sseEndState,
        });
      } else {
        sseEndState = "complete";
      }

      // Send complete event with payload
      await writeStage(reply, { stage: "COMPLETE", payload: body });

      // Buffer complete event for resume
      if (!degradedMode) {
        try {
          await bufferEvent(requestId, {
            seq: eventSeq++,
            type: "stage",
            data: JSON.stringify({ stage: "COMPLETE", payload: body }),
            timestamp: Date.now(),
          });
          await markStreamComplete(requestId, body, sseEndState === "complete" ? "complete" : "error");
          emit(TelemetryEvents.SseSnapshotCreated, { request_id: requestId, status: sseEndState });
        } catch (bufferError) {
          log.debug({ error: bufferError, request_id: requestId }, "Buffer/snapshot skipped");
        }
      }

      emit(TelemetryEvents.SSECompleted, {
        correlation_id: requestId,
        stream_duration_ms: Date.now() - start,
        sse_end_state: sseEndState,
        status_code: statusCode,
      });

      logCeeCall({
        requestId,
        capability: "cee_draft_graph_stream",
        latencyMs: Date.now() - start,
        status: statusCode >= 400 ? "error" : "ok",
        httpStatus: statusCode,
      });
    } catch (error) {
      sseEndState = "error";
      log.error({ err: error, correlation_id: requestId }, "v1 SSE draft graph failure");

      const errorBody = buildCeeErrorResponse(
        "CEE_INTERNAL_ERROR",
        error instanceof Error ? error.message : "Internal error",
        { retryable: true, requestId }
      );

      await writeStage(reply, { stage: "COMPLETE", payload: errorBody });

      emit(TelemetryEvents.SSEError, {
        correlation_id: requestId,
        stream_duration_ms: Date.now() - start,
        error: error instanceof Error ? error.message : "unknown",
        sse_end_state: sseEndState,
      });

      if (!degradedMode) {
        try {
          await markStreamComplete(requestId, errorBody, "error");
        } catch (snapshotError) {
          log.debug({ error: snapshotError, request_id: requestId }, "Error snapshot skipped");
        }
      }
    } finally {
      clearInterval(heartbeatInterval);

      // Cleanup SSE state
      if (!degradedMode) {
        try {
          await cleanupStreamState(requestId);
        } catch (cleanupError) {
          log.debug({ error: cleanupError, request_id: requestId }, "State cleanup skipped");
        }
      }

      reply.raw.end();
    }

    return reply;
  });
}
