import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assessGraphReadiness } from "../cee/graph-readiness/index.js";
import type { GraphReadinessAssessment } from "../cee/graph-readiness/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents, log } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { Graph } from "../schemas/graph.js";
import { AnalysisReadyPayload, type AnalysisReadyPayloadT } from "../schemas/analysis-ready.js";

import type { GraphV1 } from "../contracts/plot/engine.js";

interface CEETraceMeta {
  request_id?: string;
  correlation_id?: string;
  engine?: Record<string, unknown>;
}

interface CEEGraphReadinessResponseV1 {
  readiness_score: number;
  readiness_level: "ready" | "fair" | "needs_work";
  confidence_level: "high" | "medium" | "low";
  confidence_explanation: string;
  quality_factors: GraphReadinessAssessment["quality_factors"];
  can_run_analysis: boolean;
  blocker_reason?: string;
  trace?: CEETraceMeta;
}

// Input validation schema - supports both V1/V2 (options in graph) and V3 (options in analysis_ready)
const GraphReadinessInput = z.object({
  graph: Graph,
  analysis_ready: AnalysisReadyPayload.optional(),
});

type GraphReadinessInputT = z.infer<typeof GraphReadinessInput>;

// ============================================================================
// V3 Analysis-Ready Assessment
// ============================================================================

interface V3ReadinessResult {
  ready: boolean;
  readiness_score: number;
  readiness_level: "ready" | "fair" | "needs_work";
  confidence_level: "high" | "medium" | "low";
  confidence_explanation: string;
  options_ready: number;
  options_total: number;
  goal_node_valid: boolean;
  issues: string[];
  can_run_analysis: boolean;
  blocker_reason?: string;
}

/**
 * Assess graph readiness for V3 payloads where options are in analysis_ready.
 * In V3, options are NOT graph nodes - they live in analysis_ready.options.
 */
function assessV3Readiness(
  graph: GraphV1,
  analysisReady: AnalysisReadyPayloadT,
): V3ReadinessResult {
  const issues: string[] = [];
  const nodeIds = new Set(graph.nodes?.map((n) => n.id) ?? []);

  // Check goal node exists in graph
  const goalNodeId = analysisReady.goal_node_id;
  const goalNode = graph.nodes?.find((n) => n.id === goalNodeId);
  const goalNodeValid = !!goalNode;
  if (!goalNodeValid) {
    issues.push(`Goal node "${goalNodeId}" not found in graph`);
  }

  // Check options
  const options = analysisReady.options ?? [];
  const readyOptions: string[] = [];

  for (const opt of options) {
    // Check status
    if (opt.status !== "ready") {
      issues.push(`Option "${opt.id}" has status "${opt.status}" instead of "ready"`);
      continue;
    }

    // Check interventions exist
    const interventionKeys = Object.keys(opt.interventions ?? {});
    if (interventionKeys.length === 0) {
      issues.push(`Option "${opt.id}" has no interventions`);
      continue;
    }

    // Check intervention targets exist in graph
    const missingTargets = interventionKeys.filter((targetId) => !nodeIds.has(targetId));
    if (missingTargets.length > 0) {
      issues.push(
        `Option "${opt.id}" has interventions targeting non-existent nodes: ${missingTargets.join(", ")}`,
      );
      continue;
    }

    readyOptions.push(opt.id);
  }

  // Determine overall readiness
  const optionsReady = readyOptions.length;
  const optionsTotal = options.length;
  const hasEnoughOptions = optionsReady >= 2;
  const isReady = hasEnoughOptions && goalNodeValid && issues.length === 0;

  // Calculate readiness score (0-100)
  let readinessScore = 0;
  if (goalNodeValid) readinessScore += 30;
  if (optionsTotal > 0) {
    const optionRatio = optionsReady / optionsTotal;
    readinessScore += Math.round(optionRatio * 50);
  }
  if (hasEnoughOptions) readinessScore += 20;

  // Determine readiness level
  let readinessLevel: "ready" | "fair" | "needs_work";
  if (readinessScore >= 80) {
    readinessLevel = "ready";
  } else if (readinessScore >= 50) {
    readinessLevel = "fair";
  } else {
    readinessLevel = "needs_work";
  }

  // Determine confidence level
  let confidenceLevel: "high" | "medium" | "low";
  if (optionsTotal >= 2 && goalNodeValid && issues.length === 0) {
    confidenceLevel = "high";
  } else if (optionsTotal >= 1 && goalNodeValid) {
    confidenceLevel = "medium";
  } else {
    confidenceLevel = "low";
  }

  // Build blocker reason if not ready
  let blockerReason: string | undefined;
  if (!isReady) {
    if (!goalNodeValid) {
      blockerReason = `Goal node "${goalNodeId}" not found in graph`;
    } else if (!hasEnoughOptions) {
      blockerReason = `Only ${optionsReady} options ready (need at least 2)`;
    } else if (issues.length > 0) {
      blockerReason = issues[0];
    }
  }

  return {
    ready: isReady,
    readiness_score: readinessScore,
    readiness_level: readinessLevel,
    confidence_level: confidenceLevel,
    confidence_explanation: isReady
      ? `V3 analysis ready with ${optionsReady} options and valid goal node`
      : `V3 analysis not ready: ${blockerReason || "unknown issue"}`,
    options_ready: optionsReady,
    options_total: optionsTotal,
    goal_node_valid: goalNodeValid,
    issues,
    can_run_analysis: isReady,
    blocker_reason: blockerReason,
  };
}

// Rate limiting
type BucketState = {
  count: number;
  windowStart: number;
};

const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const graphReadinessBuckets = new Map<string, BucketState>();

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

function checkRateLimit(key: string, limit: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneBuckets(graphReadinessBuckets, now);
  let state = graphReadinessBuckets.get(key);

  if (!state) {
    state = { count: 0, windowStart: now };
    graphReadinessBuckets.set(key, state);
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
  const RATE_LIMIT_RPM = resolveCeeRateLimit("CEE_GRAPH_READINESS_RATE_LIMIT_RPM");
  const FEATURE_VERSION = "graph-readiness-1.0.0";

  app.post("/assist/v1/graph-readiness", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.CeeGraphReadinessRequested, {
      ...telemetryCtx,
      feature: "cee_graph_readiness",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = checkRateLimit(rateKey, RATE_LIMIT_RPM);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE Graph Readiness rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.CeeGraphReadinessFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
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
    const parsed = GraphReadinessInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.CeeGraphReadinessFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
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

    const input = parsed.data as GraphReadinessInputT;

    try {
      const graph = input.graph as unknown as GraphV1;

      const trace: CEETraceMeta = {
        request_id: requestId,
        correlation_id: requestId,
        engine: {},
      };

      // Check if this is a V3 request with analysis_ready
      // In V3, options are NOT graph nodes - they live in analysis_ready.options
      if (input.analysis_ready?.options && input.analysis_ready.options.length > 0) {
        log.info(
          {
            request_id: requestId,
            event: "cee.graph_readiness.v3_mode",
            options_count: input.analysis_ready.options.length,
            goal_node_id: input.analysis_ready.goal_node_id,
          },
          "Using V3 analysis_ready mode for graph readiness",
        );

        const v3Result = assessV3Readiness(graph, input.analysis_ready);

        // Return V3-specific response with extended fields
        const v3Response = {
          readiness_score: v3Result.readiness_score,
          readiness_level: v3Result.readiness_level,
          confidence_level: v3Result.confidence_level,
          confidence_explanation: v3Result.confidence_explanation,
          quality_factors: [], // V3 doesn't use legacy quality factors
          can_run_analysis: v3Result.can_run_analysis,
          blocker_reason: v3Result.blocker_reason,
          // V3-specific fields
          ready: v3Result.ready,
          options_ready: v3Result.options_ready,
          options_total: v3Result.options_total,
          goal_node_valid: v3Result.goal_node_valid,
          issues: v3Result.issues,
          trace,
        };

        const latencyMs = Date.now() - start;

        emit(TelemetryEvents.CeeGraphReadinessCompleted, {
          ...telemetryCtx,
          latency_ms: latencyMs,
          readiness_score: v3Result.readiness_score,
          readiness_level: v3Result.readiness_level,
          can_run_analysis: v3Result.can_run_analysis,
          factor_count: 0,
          v3_mode: true,
          options_ready: v3Result.options_ready,
          options_total: v3Result.options_total,
        });

        logCeeCall({
          requestId,
          capability: "cee_graph_readiness",
          latencyMs,
          status: "ok",
          httpStatus: 200,
        });

        reply.header("X-CEE-API-Version", "v3");
        reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
        reply.header("X-CEE-Request-ID", requestId);
        reply.code(200);
        return reply.send(v3Response);
      }

      // Fall back to legacy V1/V2 assessment (options in graph nodes)
      const assessment = assessGraphReadiness(graph);

      const response: CEEGraphReadinessResponseV1 = {
        readiness_score: assessment.readiness_score,
        readiness_level: assessment.readiness_level,
        confidence_level: assessment.confidence_level,
        confidence_explanation: assessment.confidence_explanation,
        quality_factors: assessment.quality_factors,
        can_run_analysis: assessment.can_run_analysis,
        blocker_reason: assessment.blocker_reason,
        trace,
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeGraphReadinessCompleted, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        readiness_score: assessment.readiness_score,
        readiness_level: assessment.readiness_level,
        can_run_analysis: assessment.can_run_analysis,
        factor_count: assessment.quality_factors.length,
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
        latencyMs,
        status: "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (err) {
      const errorBody = buildCeeErrorResponse(
        "CEE_INTERNAL_ERROR",
        err instanceof Error ? err.message : "Internal error",
        {
          retryable: true,
          requestId,
        },
      );

      emit(TelemetryEvents.CeeGraphReadinessFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
        error_message: err instanceof Error ? err.message : String(err),
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_INTERNAL_ERROR",
        httpStatus: 500,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
