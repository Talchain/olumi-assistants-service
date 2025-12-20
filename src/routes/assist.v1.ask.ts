/**
 * /assist/v1/ask Route
 *
 * CEE endpoint for UI-facing "ask about this decision" experience.
 * Accepts questions anchored to the graph and returns model-bound responses.
 *
 * Key features:
 * - Intent inference if not provided
 * - Graph ID validation for all responses
 * - Model-bound invariant (always returns actionable content)
 * - Redis session caching with graceful degradation
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { WorkingSetRequest, type WorkingSetRequestT, isRequestIdSafe } from "../schemas/working-set.js";
import { processAskRequest, type AskAdapterOpts } from "../adapters/ask/index.js";
import { retrieveSession, appendTurn } from "../services/session-cache.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import type { TurnT } from "../schemas/working-set.js";

// ============================================================================
// Request ID Resolution
// ============================================================================

/**
 * Resolve request ID from multiple sources with safety validation.
 *
 * Priority:
 * 1. X-Request-Id header (if present and safe charset)
 * 2. request_id from body (if present and safe charset - already validated by schema)
 * 3. Fastify auto-generated req.id (if safe)
 * 4. Generate new UUID as fallback
 *
 * Note: Fastify may pre-populate req.id from X-Request-Id header, so we
 * must also validate req.id to prevent log injection attacks.
 *
 * @param req Fastify request
 * @param bodyRequestId Optional request_id from parsed body
 * @returns Safe request ID string
 */
function resolveRequestId(req: FastifyRequest, bodyRequestId?: string): string {
  // Check X-Request-Id header first
  const headerRequestId = req.headers["x-request-id"];
  if (typeof headerRequestId === "string" && headerRequestId.length > 0) {
    if (isRequestIdSafe(headerRequestId)) {
      return headerRequestId;
    }
    // Unsafe header - log and generate new ID
    // Do NOT fall through to req.id since Fastify may have copied the unsafe header there
    log.warn(
      { raw_request_id: headerRequestId.substring(0, 100) },
      "Rejected unsafe X-Request-Id header, generating new ID"
    );
    return randomUUID();
  }

  // Check body request_id second (already validated by schema if present)
  if (bodyRequestId) {
    return bodyRequestId;
  }

  // Use Fastify's auto-generated ID if safe
  if (req.id && typeof req.id === "string" && isRequestIdSafe(req.id)) {
    return req.id;
  }

  // Final fallback
  return randomUUID();
}

// ============================================================================
// Rate Limiting
// ============================================================================

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const PRUNE_INTERVAL = 100;

type BucketState = {
  count: number;
  windowStart: number;
};

const askBuckets = new Map<string, BucketState>();
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

function checkAskLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(askBuckets, now);
  let state = askBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    askBuckets.set(key, state);
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

// ============================================================================
// Error Response Builder
// ============================================================================

function buildAskErrorResponse(
  requestId: string,
  code: string,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>
): { request_id: string; error: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> } } {
  return {
    request_id: requestId,
    error: {
      code,
      message,
      retryable,
      details,
    },
  };
}

// ============================================================================
// Route Handler
// ============================================================================

const ASK_RATE_LIMIT_RPM = 30; // Requests per minute per key
const ASK_TIMEOUT_MS = 30_000;
const FEATURE_VERSION = "ask-v1.0.0";

export default async function route(app: FastifyInstance) {
  app.post("/assist/v1/ask", async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();

    // Resolve request ID from header first (before body validation)
    // This provides a preliminary ID for early telemetry/error responses
    let requestId = resolveRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    // Emit request started event
    emit(TelemetryEvents.CeeAskRequested, {
      ...telemetryCtx,
      feature: "cee_ask",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkAskLimit(rateKey, ASK_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildAskErrorResponse(
        requestId,
        "CEE_ASK_RATE_LIMITED",
        "Rate limit exceeded",
        true,
        { retry_after_seconds: retryAfterSeconds }
      );

      emit(TelemetryEvents.CeeAskFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_ASK_RATE_LIMITED",
        http_status: 429,
      });

      log.warn({ request_id: requestId, rate_key: rateKey }, "Ask rate limit exceeded");

      reply.header("Retry-After", retryAfterSeconds.toString());
      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    // Validate request body
    const parsed = WorkingSetRequest.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildAskErrorResponse(
        requestId,
        "CEE_ASK_INVALID_GRAPH",
        "Invalid request body",
        false,
        { field_errors: parsed.error.flatten() }
      );

      emit(TelemetryEvents.CeeAskFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_ASK_INVALID_GRAPH",
        http_status: 400,
      });

      log.warn(
        { request_id: requestId, errors: parsed.error.flatten() },
        "Ask request validation failed"
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const request: WorkingSetRequestT = parsed.data;

    // Load session context if available (for conversation history)
    const sessionResult = await retrieveSession(request.scenario_id);
    if (sessionResult.degraded) {
      log.info(
        { request_id: requestId, scenario_id: request.scenario_id },
        "Operating in degraded mode (Redis unavailable)"
      );
    }

    // Merge session turns with request turns if not provided
    const turnsRecent = request.turns_recent?.length
      ? request.turns_recent
      : sessionResult.session?.turns_recent || [];

    // Build adapter options
    const adapterOpts: AskAdapterOpts = {
      requestId,
      timeoutMs: ASK_TIMEOUT_MS,
    };

    try {
      // Process the ask request
      const result = await processAskRequest(
        {
          ...request,
          turns_recent: turnsRecent,
        },
        adapterOpts
      );

      const { response, inferredIntent, intentConfidence } = result;

      // Store the conversation turn in session cache
      const userTurn: TurnT = {
        role: "user",
        content: request.message,
        timestamp: new Date().toISOString(),
      };
      const assistantTurn: TurnT = {
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
      };

      // Append turns to session (non-blocking) - use inferred intent
      appendTurn(
        request.scenario_id,
        userTurn,
        response.updated_decision_state_summary,
        inferredIntent
      ).catch((err) => {
        log.warn({ error: err, scenario_id: request.scenario_id }, "Failed to append user turn");
      });

      appendTurn(request.scenario_id, assistantTurn).catch((err) => {
        log.warn({ error: err, scenario_id: request.scenario_id }, "Failed to append assistant turn");
      });

      const latencyMs = Date.now() - start;

      // Use inferred intent for telemetry (not request.intent which may be undefined)
      emit(TelemetryEvents.CeeAskCompleted, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        scenario_id: request.scenario_id,
        intent: inferredIntent,
        intent_confidence: intentConfidence,
        intent_was_explicit: !!request.intent,
        has_model_actions: !!(response.model_actions && response.model_actions.length > 0),
        has_highlights: !!(response.highlights && response.highlights.length > 0),
        has_follow_up: !!response.follow_up_question,
      });

      log.info(
        {
          request_id: requestId,
          scenario_id: request.scenario_id,
          latency_ms: latencyMs,
          intent: inferredIntent,
          intent_confidence: intentConfidence,
        },
        "Ask request completed"
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (error) {
      const latencyMs = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      emit(TelemetryEvents.CeeAskFailed, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        error_code: "CEE_ASK_LLM_ERROR",
        http_status: 500,
        error_message: errorMessage,
      });

      log.error(
        { error, request_id: requestId, scenario_id: request.scenario_id },
        "Ask request failed"
      );

      const errorBody = buildAskErrorResponse(
        requestId,
        "CEE_ASK_LLM_ERROR",
        "Failed to process request",
        true,
        { error_message: errorMessage }
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
