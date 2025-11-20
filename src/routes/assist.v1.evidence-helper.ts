import type { FastifyInstance } from "fastify";
import type { components } from "../generated/openapi.d.ts";
import { CEEEvidenceHelperInput, type CEEEvidenceHelperInputT } from "../schemas/cee.js";
import { scoreEvidenceItems } from "../cee/evidence/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { buildCeeGuidance, type ResponseLimitsLike } from "../cee/guidance/index.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId } from "../plugins/auth.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";

type CEEEvidenceHelperResponseV1 = components["schemas"]["CEEEvidenceHelperResponseV1"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];

type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeEvidenceBuckets = new Map<string, BucketState>();

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

function checkCeeEvidenceLimit(
  key: string,
  limit: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(ceeEvidenceBuckets, now);
  let state = ceeEvidenceBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    ceeEvidenceBuckets.set(key, state);
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
  const EVIDENCE_RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_EVIDENCE_HELPER_RATE_LIMIT_RPM");
  const FEATURE_VERSION =
    process.env.CEE_EVIDENCE_HELPER_FEATURE_VERSION || "evidence-helper-1.0.0";

  app.post("/assist/v1/evidence-helper", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as any;
    const evidenceCount =
      rawBody && Array.isArray((rawBody as any).evidence) ? (rawBody as any).evidence.length : 0;

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);

    emit(TelemetryEvents.CeeEvidenceHelperRequested, {
      request_id: requestId,
      feature: "cee_evidence_helper",
      evidence_count: evidenceCount,
      api_key_present: apiKeyPresent,
    });

    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkCeeEvidenceLimit(rateKey, EVIDENCE_RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Evidence Helper rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeEvidenceHelperFailed, {
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

    const parsed = CEEEvidenceHelperInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeEvidenceHelperFailed, {
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

    const input = parsed.data as CEEEvidenceHelperInputT;

    try {
      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      const { items, unsupportedTypeIds } = scoreEvidenceItems(input.evidence as any);

      const ITEMS_MAX = 20;
      let itemsTruncated = false;
      let cappedItems = items;
      if (items.length > ITEMS_MAX) {
        cappedItems = items.slice(0, ITEMS_MAX);
        itemsTruncated = true;
      }

      const validationIssues: CEEValidationIssue[] = [];
      if (unsupportedTypeIds.length > 0) {
        validationIssues.push({
          code: "unsupported_evidence_type",
          severity: "warning",
          field: "evidence.type",
          details: { unsupported_ids: unsupportedTypeIds },
        } as any);
      }

      const strongCount = cappedItems.filter((i) => (i as any).strength === "strong").length;
      const mediumCount = cappedItems.filter((i) => (i as any).strength === "medium").length;
      const weakOrNoneCount = cappedItems.filter((i) => {
        const s = (i as any).strength as string;
        return s === "weak" || s === "none";
      }).length;

      let confidence = 0.5;
      confidence += Math.min(strongCount, 5) * 0.05;
      confidence += Math.min(mediumCount, 5) * 0.02;
      confidence -= Math.min(weakOrNoneCount, 10) * 0.01;
      confidence = Math.max(0.3, Math.min(0.95, confidence));

      const quality = computeQuality({
        graph: undefined,
        confidence,
        engineIssueCount: 0,
        ceeIssues: validationIssues,
      });

      const responseLimits = {
        items_max: ITEMS_MAX,
        items_truncated: itemsTruncated,
      } as CEEEvidenceHelperResponseV1["response_limits"];

      const limits: ResponseLimitsLike = {
        items_truncated: itemsTruncated,
      };
      const guidance = buildCeeGuidance({
        quality,
        validationIssues,
        limits,
      });

      const ceeResponse: CEEEvidenceHelperResponseV1 = {
        trace,
        quality,
        validation_issues: validationIssues.length ? validationIssues : undefined,
        items: cappedItems as any,
        response_limits: responseLimits,
        guidance,
      };

      emit(TelemetryEvents.CeeEvidenceHelperSucceeded, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        quality_overall: quality.overall,
        evidence_count: input.evidence.length,
        strong_count: strongCount,
        any_unsupported_types: unsupportedTypeIds.length > 0,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(ceeResponse);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");

      emit(TelemetryEvents.CeeEvidenceHelperFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
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
