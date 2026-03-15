import type { FastifyInstance, FastifyRequest } from "fastify";
import { DraftGraphInput, type DraftGraphInputT } from "../schemas/assist.js";
import { extractZodIssues } from "../schemas/llmExtraction.js";
import { sanitizeDraftGraphInput } from "./assist.draft-graph.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { config, isProduction } from "../config/index.js";
import { safeEqual } from "../utils/hash.js";
import { evaluatePreflightDecision } from "../cee/validation/preflight-decision.js";
import type { PreflightRejectPayload, NeedsClarificationPayload, PreflightDecision } from "../cee/validation/preflight-decision.js";
import { formatBriefHeader } from "../cee/signals/brief-header.js";
import { detectCurrency, buildCurrencyInstruction } from "../cee/signals/currency-signal.js";
import {
  parseSchemaVersion,
} from "../cee/transforms/index.js";
import { runUnifiedPipeline } from "../cee/unified-pipeline/index.js";

// ============================================================================
// Response contract — discriminated union on `status`
// ============================================================================
//
// The draft-graph endpoint returns one of three shapes.
// PLoT passes all three variants through unchanged.
// The UI should handle each variant as a distinct state (not an error).
//
// Discriminant field: `status` (top-level key, always present in 200 responses)
//
//   DraftGraphSuccessResponse     status: "ok"                 — graph generated (HTTP 200)
//   NeedsClarificationPayload     status: "needs_clarification" — show guidance  (HTTP 200)
//   DraftGraphErrorResponse                                     — hard error      (HTTP 400)
//
// NeedsClarificationPayload is defined in preflight-decision.ts and re-used here.

/** Graph-generated success response (V1 shape — V3 is flat nodes/edges at root). */
export interface DraftGraphSuccessResponse {
  status?: "ok";
  graph: Record<string, unknown>;
  [key: string]: unknown;
}

/** Hard-error response body (HTTP 400 / 429 / 500). */
export interface DraftGraphErrorResponse {
  schema: "cee.error.v1";
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  request_id?: string;
}

/**
 * Discriminated union of all possible response bodies from /assist/v1/draft-graph.
 *
 * Discriminate on `status`:
 *   - `"needs_clarification"` → NeedsClarificationPayload (HTTP 200)
 *   - `undefined | "ok"`      → DraftGraphSuccessResponse (HTTP 200)
 *   - absent + `code` field   → DraftGraphErrorResponse   (HTTP 400/429/500)
 */
export type DraftGraphResponse =
  | import("../cee/validation/preflight-decision.js").NeedsClarificationPayload
  | DraftGraphSuccessResponse
  | DraftGraphErrorResponse;

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

  function isUnsafeCaptureRequested(req: FastifyRequest): boolean {
    const query = (req.query as Record<string, unknown>) ?? {};
    const unsafeQuery = query.unsafe;
    const unsafeHeader = req.headers["x-olumi-unsafe"];
    return unsafeQuery === "1" || unsafeQuery === "true" || unsafeHeader === "1" || unsafeHeader === "true";
  }

  function isAdminAuthorized(req: FastifyRequest): boolean {
    const providedKey = req.headers["x-admin-key"] as string | undefined;
    if (!providedKey) return false;
    const adminKey = config.prompts?.adminApiKey;
    const adminKeyRead = config.prompts?.adminApiKeyRead;
    return Boolean((adminKey && safeEqual(providedKey, adminKey)) || (adminKeyRead && safeEqual(providedKey, adminKeyRead)));
  }

  app.post("/assist/v1/draft-graph", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const rawBody = req.body as Record<string, unknown> | undefined;
    const hasSeed =
      rawBody && typeof rawBody === "object" && typeof rawBody.seed === "string";
    const hasArchetypeHint =
      rawBody &&
      typeof rawBody === "object" &&
      typeof rawBody.archetype_hint === "string";

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
        details: { field_errors: parsed.error.flatten(), first_issues: extractZodIssues(parsed.error, 3) },
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
      include_debug?: boolean;
      flags?: Record<string, unknown>;
      raw_output?: boolean;
      briefSignalsHeader?: string;
      bias_signals?: Array<{ type: string; confidence: string; evidence: string }>;
      currencyInstruction?: string;
    };

    const unsafeCaptureEnabled = isUnsafeCaptureRequested(req) && isAdminAuthorized(req);
    // Override any client-provided include_debug. Unsafe capture is admin-only.
    baseInput.include_debug = unsafeCaptureEnabled;
    if (unsafeCaptureEnabled) {
      const existingFlags = typeof baseInput.flags === "object" && baseInput.flags !== null
        ? baseInput.flags
        : undefined;
      baseInput.flags = {
        ...(existingFlags ?? {}),
        unsafe_capture: true,
      };
    }

    // Preflight validation — delegates all policy ladder decisions to the
    // shared evaluatePreflightDecision() function (no duplicated logic here).
    let preflightDecision: PreflightDecision | undefined;
    if (config.cee.preflightEnabled) {
      const decision = preflightDecision = evaluatePreflightDecision(baseInput.brief, {
        preflightStrict: config.cee.preflightStrict,
        preflightReadinessThreshold: config.cee.preflightReadinessThreshold,
      });
      const { readiness } = decision;

      // Log readiness assessment
      log.info({
        request_id: requestId,
        readiness_score: readiness.score,
        readiness_level: readiness.level,
        preflight_valid: readiness.preflight.valid,
        factors: readiness.factors,
        event: "cee.preflight.assessed",
      }, `Brief readiness: ${readiness.level} (score: ${readiness.score})`);

      // Emit structured preflight outcome telemetry (cee.preflight.completed).
      // Fields come from the shared decision object — identical from both routes.
      emit(TelemetryEvents.PreflightCompleted, {
        ...telemetryCtx,
        ...decision.telemetry,
      });

      // Emit BriefSignals telemetry (only when signals were computed — skipped on reject)
      if (decision.briefSignals) {
        emit(TelemetryEvents.CeeBriefSignals, {
          ...telemetryCtx,
          signals_version: "v1",
          brief_strength: decision.briefSignals.brief_strength,
          option_count_estimate: decision.briefSignals.option_count_estimate,
          has_explicit_goal: decision.briefSignals.has_explicit_goal,
          has_measurable_target: decision.briefSignals.has_measurable_target,
          baseline_state: decision.briefSignals.baseline_state,
          has_constraints: decision.briefSignals.has_constraints,
          has_risks: decision.briefSignals.has_risks,
          bias_signals: decision.briefSignals.bias_signals.map((b) => b.type),
          word_count: decision.briefSignals.word_count,
          numeric_anchor_count: decision.briefSignals.numeric_anchor_count,
          questions_shown_count: (decision.payload as unknown as Record<string, unknown>)?.clarification_questions
            ? ((decision.payload as unknown as Record<string, unknown>).clarification_questions as unknown[]).length
            : 0,
          readiness_score: decision.telemetry.readiness_score,
          action: decision.action,
        });
      }

      if (decision.action === "reject") {
        const p = decision.payload as PreflightRejectPayload;

        const errorBody = buildCeeErrorResponse(
          "CEE_VALIDATION_FAILED",
          p.message,
          {
            retryable: false,
            requestId,
            details: {
              rejection_reason: p.rejection_reason,
              preflight_issues: p.preflight_issues,
            },
          }
        );

        emit(TelemetryEvents.PreflightRejected, {
          ...telemetryCtx,
          latency_ms: Date.now() - start,
          readiness_score: readiness.score,
          readiness_level: readiness.level,
          rejection_reason: p.rejection_reason,
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
        reply.code(400);
        return reply.send(errorBody);
      }

      if (decision.action === "clarify") {
        const p = decision.payload as NeedsClarificationPayload;

        emit(TelemetryEvents.PreflightRejected, {
          ...telemetryCtx,
          latency_ms: Date.now() - start,
          readiness_score: readiness.score,
          readiness_level: readiness.level,
          rejection_reason: "underspecified",
        });

        logCeeCall({
          requestId,
          capability: "cee_draft_graph",
          latencyMs: Date.now() - start,
          status: "ok",
          httpStatus: 200,
        });

        reply.header("X-CEE-API-Version", "v1");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.header("X-CEE-Readiness-Score", readiness.score.toString());
        reply.code(200);
        return reply.send(p);
      }

      // action === "proceed": brief is valid and ready (or strict mode off).
      // Low readiness but not in strict mode — log and continue to generation.
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

    // ── Thread BriefSignals into pipeline input ────────────────────────
    if (preflightDecision?.briefSignals) {
      if (config.cee.briefSignalsHeaderEnabled) {
        baseInput.briefSignalsHeader = formatBriefHeader(preflightDecision.briefSignals);
      }
      if (preflightDecision.briefSignals.bias_signals.length > 0) {
        baseInput.bias_signals = preflightDecision.briefSignals.bias_signals;
      }
    }

    // ── Currency context signal ──────────────────────────────────────
    // Detect currency from brief and build instruction for LLM prompts.
    // Always runs — lightweight string scan (<5ms).
    const currencySignal = detectCurrency(baseInput.brief);
    baseInput.currencyInstruction = buildCurrencyInstruction(currencySignal);

    // ── Unified pipeline ──────────────────────────────────────────────
    const schemaVersion = parseSchemaVersion((req.query as Record<string, unknown>)?.schema);
    const strictMode = (req.query as Record<string, unknown>)?.strict === "true";

    // Client disconnect detection.
    // IMPORTANT: Check socket.destroyed, NOT req.raw.destroyed.
    // req.raw (IncomingMessage) is always destroyed after Fastify reads the POST body.
    // The TCP socket remains alive until the client actually disconnects.
    const pipelineAbortController = new AbortController();
    const socket = req.raw?.socket;
    let socketCloseHandler: (() => void) | undefined;
    if (socket && !socket.destroyed) {
      socketCloseHandler = () => pipelineAbortController.abort();
      socket.once("close", socketCloseHandler);
    }

    // Gate raw_output: only honoured in non-production or with admin auth
    const rawOutputRequested = baseInput.raw_output === true;
    const rawOutputAllowed = rawOutputRequested && (!isProduction() || isAdminAuthorized(req));
    if (rawOutputRequested && !rawOutputAllowed) {
      log.warn({ requestId, event: "cee.raw_output.suppressed" }, "raw_output=true suppressed in production without admin auth");
    }

    try {
      const result = await runUnifiedPipeline(baseInput, req.body, req, {
        schemaVersion,
        strictMode,
        includeDebug: unsafeCaptureEnabled,
        rawOutput: rawOutputAllowed,
        refreshPrompts: (req.query as Record<string, unknown>)?.supa === "1",
        forceDefault: (req.query as Record<string, unknown>)?.forceDefault === "1",
        signal: pipelineAbortController.signal,
        requestStartMs: start,
      });

      reply.header("X-CEE-API-Version", schemaVersion);
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
      }

      // Emit succeeded/failed telemetry for observability (previously in Pipeline B finaliser)
      if (result.statusCode === 200) {
        const body = result.body as Record<string, unknown>;
        const graph = body.graph as Record<string, unknown> | undefined;
        const trace = body.trace as Record<string, unknown> | undefined;
        const quality = trace?.quality as Record<string, unknown> | undefined;
        const llmQuality = trace?.llm_quality as Record<string, unknown> | undefined;
        const graphNodes = graph?.nodes;
        const graphEdges = graph?.edges;
        emit(TelemetryEvents.CeeDraftGraphSucceeded, {
          request_id: requestId,
          latency_ms: Date.now() - start,
          quality_overall: typeof quality?.overall === "number" ? quality.overall : 0,
          graph_nodes: Array.isArray(graphNodes) ? graphNodes.length : 0,
          graph_edges: Array.isArray(graphEdges) ? graphEdges.length : 0,
          has_validation_issues: Array.isArray(body.validation_issues) && body.validation_issues.length > 0,
          any_truncated: Boolean(trace?.any_truncated),
          draft_warning_count: typeof trace?.draft_warning_count === "number" ? trace.draft_warning_count : 0,
          uncertain_node_count: typeof trace?.uncertain_node_count === "number" ? trace.uncertain_node_count : 0,
          simplification_applied: Boolean(trace?.simplification_applied),
          cost_usd: typeof llmQuality?.cost_usd === "number" ? llmQuality.cost_usd : 0,
          engine_provider: typeof llmQuality?.provider === "string" ? llmQuality.provider : "unknown",
          engine_model: typeof llmQuality?.model === "string" ? llmQuality.model : "unknown",
        });
      } else if (result.statusCode >= 400) {
        const body = result.body as Record<string, unknown>;
        emit(TelemetryEvents.CeeDraftGraphFailed, {
          request_id: requestId,
          latency_ms: Date.now() - start,
          error_code: typeof body.code === "string" ? body.code : "UNKNOWN",
          http_status: result.statusCode,
        });
      }

      reply.code(result.statusCode);
      return reply.send(result.body);
    } finally {
      if (socket && socketCloseHandler) {
        socket.removeListener("close", socketCloseHandler);
      }
    }
  });
}
