import type { FastifyInstance } from "fastify";
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
import {
  parseSchemaVersion,
  transformResponseToV2,
  transformResponseToV3,
  validateStrictModeV3,
} from "../cee/transforms/index.js";

// Simple in-memory rate limiter for CEE Draft My Model
// Keyed by API key ID when available, otherwise client IP
const WINDOW_MS = 60_000;
// Guardrail to prevent unbounded growth of the in-memory bucket map.
const MAX_BUCKETS = 10_000;
// Buckets older than this are considered idle and may be evicted when MAX_BUCKETS is exceeded.
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
// Only prune every N requests to amortize O(n) cost
const PRUNE_INTERVAL = 100;

type BucketState = {
  count: number;
  windowStart: number;
};

const ceeDraftBuckets = new Map<string, BucketState>();
let pruneCounter = 0;
let oldestKnownTimestamp = Date.now();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  // Early exit: skip if under threshold and no old buckets exist
  if (map.size <= MAX_BUCKETS && now - oldestKnownTimestamp <= MAX_BUCKET_AGE_MS) {
    return;
  }

  // Amortize pruning: only run expensive iteration every N calls
  pruneCounter++;
  if (pruneCounter < PRUNE_INTERVAL && map.size <= MAX_BUCKETS) {
    return;
  }
  pruneCounter = 0;

  // Track new oldest timestamp during iteration
  let newOldest = now;

  // First pass: drop buckets that have been idle for multiple windows.
  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    } else if (state.windowStart < newOldest) {
      newOldest = state.windowStart;
    }
  }

  oldestKnownTimestamp = newOldest;

  if (map.size <= MAX_BUCKETS) return;

  // As a last resort, drop the oldest keys until we are back under the cap.
  let toRemove = map.size - MAX_BUCKETS;
  for (const key of map.keys()) {
    if (toRemove <= 0) break;
    map.delete(key);
    toRemove -= 1;
  }
}

function checkCeeDraftLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeDraftBuckets, now);
  let state = ceeDraftBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeDraftBuckets.set(key, state);
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
  const DRAFT_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_DRAFT_RATE_LIMIT_RPM");
  const FEATURE_VERSION = config.cee.draftFeatureVersion || "draft-model-1.0.0";

  function isUnsafeCaptureRequested(req: any): boolean {
    const query = (req.query as Record<string, unknown>) ?? {};
    const unsafeQuery = query.unsafe;
    const unsafeHeader = req.headers?.["x-olumi-unsafe"];
    return unsafeQuery === "1" || unsafeQuery === "true" || unsafeHeader === "1" || unsafeHeader === "true";
  }

  function isAdminAuthorized(req: any): boolean {
    const providedKey = req.headers?.["x-admin-key"] as string | undefined;
    if (!providedKey) return false;
    const adminKey = config.prompts?.adminApiKey;
    const adminKeyRead = config.prompts?.adminApiKeyRead;
    return Boolean((adminKey && providedKey === adminKey) || (adminKeyRead && providedKey === adminKeyRead));
  }

  app.post("/assist/v1/draft-graph", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as any;
    const hasSeed =
      rawBody && typeof rawBody === "object" && typeof (rawBody as any).seed === "string";
    const hasArchetypeHint =
      rawBody &&
      typeof rawBody === "object" &&
      typeof (rawBody as any).archetype_hint === "string";

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.CeeDraftGraphRequested, {
      ...telemetryCtx,
      feature: "cee_draft_graph",
      has_seed: hasSeed,
      has_archetype_hint: hasArchetypeHint,
      api_key_present: apiKeyPresent,
    });

    // Per-feature rate limiting for CEE Draft My Model
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeDraftLimit(rateKey, DRAFT_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse("CEE_RATE_LIMIT", "CEE Draft My Model rate limit exceeded", {
        retryable: true,
        requestId,
        details: { retry_after_seconds: retryAfterSeconds },
      });

      emit(TelemetryEvents.CeeDraftGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_draft_graph",
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

    const parsed = DraftGraphInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeDraftGraphFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_draft_graph",
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

    // Preserve CEE extras (seed, archetype_hint) via sanitizer
    const baseInput = sanitizeDraftGraphInput(parsed.data, req.body) as DraftGraphInputT & {
      seed?: string;
      archetype_hint?: string;
    };

    const unsafeCaptureEnabled = isUnsafeCaptureRequested(req) && isAdminAuthorized(req);
    // Override any client-provided include_debug. Unsafe capture is admin-only.
    (baseInput as any).include_debug = unsafeCaptureEnabled;
    if (unsafeCaptureEnabled) {
      const existingFlags = typeof (baseInput as any).flags === "object" && (baseInput as any).flags !== null
        ? ((baseInput as any).flags as Record<string, unknown>)
        : undefined;
      (baseInput as any).flags = {
        ...(existingFlags ?? {}),
        unsafe_capture: true,
      };
    }

    // Preflight validation - check brief readiness before LLM call
    if (config.cee.preflightEnabled) {
      const readiness = assessBriefReadiness(baseInput.brief);

      // Log readiness assessment
      log.info({
        request_id: requestId,
        readiness_score: readiness.score,
        readiness_level: readiness.level,
        preflight_valid: readiness.preflight.valid,
        factors: readiness.factors,
        event: "cee.preflight.assessed",
      }, `Brief readiness: ${readiness.level} (score: ${readiness.score})`);

      // If strict mode and readiness below threshold, reject with guidance
      if (config.cee.preflightStrict && readiness.score < config.cee.preflightReadinessThreshold) {
        const errorBody = buildCeeErrorResponse(
          "CEE_VALIDATION_FAILED",
          readiness.summary,
          {
            retryable: true,
            requestId,
            details: {
              rejection_reason: "preflight_rejected",
              readiness_score: readiness.score,
              readiness_level: readiness.level,
              factors: readiness.factors,
              suggested_questions: readiness.suggested_questions,
              preflight_issues: readiness.preflight.issues,
              hint: "Please provide a clearer decision statement or answer the suggested questions",
            },
          }
        );

        emit(TelemetryEvents.PreflightRejected, {
          ...telemetryCtx,
          latency_ms: Date.now() - start,
          readiness_score: readiness.score,
          readiness_level: readiness.level,
          factors: readiness.factors,
        });

        logCeeCall({
          requestId,
          capability: "cee_draft_graph",
          latencyMs: Date.now() - start,
          status: "error",
          errorCode: "CEE_PREFLIGHT_REJECTED",
          httpStatus: 400,
        });

        reply.header("X-CEE-API-Version", "v1");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.header("X-CEE-Readiness-Score", readiness.score.toString());
        reply.code(400);
        return reply.send(errorBody);
      }

      // If readiness is low but not strict mode, log warning and continue
      if (readiness.level === "not_ready" || readiness.level === "needs_clarification") {
        log.warn({
          request_id: requestId,
          readiness_score: readiness.score,
          readiness_level: readiness.level,
          suggested_questions: readiness.suggested_questions,
          event: "cee.preflight.low_readiness",
        }, `Proceeding with low readiness brief (strict mode disabled): ${readiness.summary}`);
      }

      // Clarification enforcement (Phase 5)
      // Check if clarification rounds are required based on readiness score
      if (config.cee.clarificationEnforced) {
        const allowDirectThreshold = config.cee.clarificationThresholdAllowDirect;
        const oneRoundThreshold = config.cee.clarificationThresholdOneRound;
        const completedRounds = parsed.data.clarification_rounds_completed ?? 0;

        // Calculate required rounds based on readiness score
        let requiredRounds = 0;
        if (readiness.score < allowDirectThreshold) {
          if (readiness.score >= oneRoundThreshold) {
            requiredRounds = 1; // 0.4 - 0.8 = 1 round required
          } else {
            requiredRounds = 2; // < 0.4 = 2+ rounds required
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
            capability: "cee_draft_graph",
            latencyMs: Date.now() - start,
            status: "error",
            errorCode: "CEE_CLARIFICATION_REQUIRED",
            httpStatus: 400,
          });

          reply.header("X-CEE-API-Version", "v1");
          reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
          reply.header("X-CEE-Request-ID", requestId);
          reply.header("X-CEE-Readiness-Score", readiness.score.toString());
          reply.code(400);
          return reply.send(errorBody);
        }

        // Log when direct draft is allowed despite enforced clarification
        if (requiredRounds === 0) {
          emit(TelemetryEvents.ClarificationBypassAllowed, {
            ...telemetryCtx,
            readiness_score: readiness.score,
            readiness_level: readiness.level,
          });
        }
      }
    }

    const { statusCode, body, headers } = await finaliseCeeDraftResponse(baseInput, req.body, req);

    // Check for schema version request via query parameter
    // Default is V3 (includes analysis_ready) - V1/V2 are deprecated
    const schemaVersion = parseSchemaVersion((req.query as Record<string, unknown>)?.schema);
    const strictMode = (req.query as Record<string, unknown>)?.strict === "true";

    // Log deprecation warning for legacy schema versions
    if (schemaVersion === "v1" || schemaVersion === "v2") {
      log.warn({
        request_id: requestId,
        schema_version: schemaVersion,
        event: "cee.deprecated_schema_requested",
      }, `Deprecated schema ${schemaVersion} requested - consider upgrading to V3 for analysis_ready support`);
    }

    reply.header("X-CEE-API-Version", schemaVersion);
    reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
    reply.header("X-CEE-Request-ID", requestId);

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        reply.header(key, value);
      }
    }

    reply.code(statusCode);

    // Log response delivery attempt for debugging premature close issues
    log.info({
      request_id: requestId,
      returned_response: true,
      status_code: statusCode,
      latency_ms: Date.now() - start,
      is_error: statusCode >= 400,
      schema_version: schemaVersion,
    }, "Draft-graph response ready for delivery");

    // Transform to requested schema if response is successful
    if (statusCode === 200 && body && typeof body === "object" && "graph" in body) {
      if (schemaVersion === "v3") {
        // DEBUG: Log V1 trace.pipeline before transform
        const v1Trace = (body as any).trace;
        log.info({
          request_id: requestId,
          v1_trace_keys: v1Trace ? Object.keys(v1Trace) : [],
          v1_has_pipeline: !!(v1Trace?.pipeline),
          v1_pipeline_status: v1Trace?.pipeline?.status,
          event: "cee.pipeline.debug.v1",
        }, `[DEBUG] V1 trace before V3 transform`);

        const v3Body = transformResponseToV3(body as any, {
          brief: baseInput.brief,
          requestId,
          strictMode,
        });

        // DEBUG: Log V3 trace.pipeline after transform
        log.info({
          request_id: requestId,
          v3_trace_keys: v3Body.trace ? Object.keys(v3Body.trace) : [],
          v3_has_pipeline: !!(v3Body.trace?.pipeline),
          v3_pipeline_status: (v3Body.trace as any)?.pipeline?.status,
          event: "cee.pipeline.debug.v3",
        }, `[DEBUG] V3 trace after transform`);

        // Validate in strict mode
        if (strictMode) {
          try {
            validateStrictModeV3(v3Body);
          } catch (err) {
            log.warn({
              request_id: requestId,
              error: (err as Error).message,
            }, "V3 strict mode validation failed");
            // In strict mode, return 422 with validation errors
            reply.code(422);
            return reply.send({
              error: {
                code: "CEE_V3_VALIDATION_FAILED",
                message: (err as Error).message,
                validation_warnings: v3Body.validation_warnings,
              },
            });
          }
        }

        log.debug({ request_id: requestId, schema_version: "v3" }, "Transformed response to v3 schema");
        return reply.send(v3Body);
      }

      if (schemaVersion === "v2") {
        const v2Body = transformResponseToV2(body as any);
        log.debug({ request_id: requestId, schema_version: "v2" }, "Transformed response to v2 schema");
        return reply.send(v2Body);
      }
    }

    return reply.send(body);
  });
}
