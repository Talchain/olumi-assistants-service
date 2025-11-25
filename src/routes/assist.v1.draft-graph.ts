import type { FastifyInstance } from "fastify";
import { DraftGraphInput, type DraftGraphInputT } from "../schemas/assist.js";
import { sanitizeDraftGraphInput } from "./assist.draft-graph.js";
import { finaliseCeeDraftResponse, buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId } from "../plugins/auth.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { config } from "../config/index.js";

// Simple in-memory rate limiter for CEE Draft My Model
// Keyed by API key ID when available, otherwise client IP
const WINDOW_MS = 60_000;
// Guardrail to prevent unbounded growth of the in-memory bucket map.
const MAX_BUCKETS = 10_000;
// Buckets older than this are considered idle and may be evicted when MAX_BUCKETS is exceeded.
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;

type BucketState = {
  count: number;
  windowStart: number;
};

const ceeDraftBuckets = new Map<string, BucketState>();

function pruneBuckets(map: Map<string, BucketState>, now: number): void {
  if (map.size <= MAX_BUCKETS) return;

  // First pass: drop buckets that have been idle for multiple windows.
  for (const [key, state] of map) {
    if (now - state.windowStart > MAX_BUCKET_AGE_MS) {
      map.delete(key);
    }
  }

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

    emit(TelemetryEvents.CeeDraftGraphRequested, {
      request_id: requestId,
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
        request_id: requestId,
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
        request_id: requestId,
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

    const { statusCode, body, headers } = await finaliseCeeDraftResponse(baseInput, req.body, req);

    reply.header("X-CEE-API-Version", "v1");
    reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
    reply.header("X-CEE-Request-ID", requestId);

    if (headers) {
      for (const [key, value] of Object.entries(headers)) {
        reply.header(key, value);
      }
    }

    reply.code(statusCode);
    return reply.send(body);
  });
}
