import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assessGraphReadiness } from "../cee/graph-readiness/index.js";
import type { GraphReadinessAssessment } from "../cee/graph-readiness/index.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { resolveCeeRateLimit } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { Graph } from "../schemas/graph.js";
import { AnalysisReadyPayload } from "../schemas/analysis-ready.js";
import {
  assessRouteAdmission,
  type RouteReadinessBlocker,
  type RouteReadinessCritique,
  type RouteScaffoldPlan,
} from "../cee/graph-readiness/canonical-readiness.js";

import type { GraphV1 } from "../contracts/plot/engine.js";

interface CEETraceMeta {
  request_id?: string;
  correlation_id?: string;
  engine?: Record<string, unknown>;
}

/**
 * ONE response, from ONE assessor.
 *
 * The route used to return two different shapes under two different
 * `X-CEE-API-Version` values, chosen by the REQUEST BODY SHAPE. Both are gone:
 * the fields that were "V3-only" are now always present, because they are
 * always derivable — they come from the graph, not from the caller's cache.
 *
 * The two halves answer DIFFERENT QUESTIONS and are grouped that way
 * deliberately. Conflating them is what allowed a quality heuristic to answer
 * an admission question for as long as it did.
 */
interface CEEGraphReadinessResponseV1 {
  // ── Coaching: "how good is this model?" (legacy quality assessor) ──
  readiness_score: number;
  readiness_level: "ready" | "fair" | "needs_work";
  confidence_level: "high" | "medium" | "low";
  confidence_explanation: string;
  quality_factors: GraphReadinessAssessment["quality_factors"];

  // ── Admission: "may analysis run?" (canonical assessor, sole authority) ──
  can_run_analysis: boolean;
  blocker_reason?: string;
  ready: boolean;
  options_ready: number;
  options_total: number;
  goal_node_valid: boolean;
  issues: string[];
  critiques?: RouteReadinessCritique[];
  scaffold_plan: RouteScaffoldPlan;
  /**
   * Per-option, per-factor blockers. Additive, and the reason a blocked verdict
   * is actionable: `option_id` + `factor_id` + a human message let the UI name
   * the option and the field instead of rendering a count.
   */
  readiness_issues: RouteReadinessBlocker[];
  evidence_quality?: {
    /** Count of edges with strong evidence */
    strong: number;
    /** Count of edges with moderate evidence */
    moderate: number;
    /** Count of edges with weak evidence (assumptions/hypotheses) */
    weak: number;
    /** Count of edges with no provenance */
    none: number;
    /** Human-readable summary */
    summary: string;
  };
  // DEPRECATED: use total_factor_count and user_question_count. Remove after next release.
  factor_count?: number;
  /** Count of nodes with kind === "factor" (all categories) */
  total_factor_count: number;
  /** Count of quality assessment dimensions (legacy quality_factors.length) */
  user_question_count: number;
  trace?: CEETraceMeta;
}

// Input validation schema - supports both V1/V2 (options in graph) and V3 (options in analysis_ready)
const GraphReadinessInput = z.object({
  graph: Graph,
  analysis_ready: AnalysisReadyPayload.optional(),
});

type GraphReadinessInputT = z.infer<typeof GraphReadinessInput>;

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

      // ======================================================================
      // ONE ASSESSOR.
      //
      // The admission verdict ("may analysis run?") comes from
      // `assessRouteAdmission` → `assessCanonicalAnalysisReadiness`, the same
      // whole-model authority the TURN path uses. It reads the GRAPH and
      // nothing else, so the route and the turn cannot answer the same
      // question with different predicates on one deploy.
      //
      // `input.analysis_ready` is still ACCEPTED — the deployed UI sends it
      // whenever its cache is warm — but is deliberately NOT read. It is client
      // cache, and letting it select the assessor was the defect: a fresh
      // session and a warmed session received OPPOSITE verdicts for the same
      // graph, because the UI populates it only from its own cached state.
      //
      // The legacy assessor still runs, for COACHING ONLY: quality factors,
      // evidence quality, the confidence prose. It can no longer answer the
      // admission question — `GraphReadinessAssessment` no longer carries
      // `can_run_analysis` or `blocker_reason` at all, so the hardcoded `true`
      // literal is not merely unread, it is unrepresentable.
      // ======================================================================
      const admission = assessRouteAdmission(input.graph);
      const coaching = assessGraphReadiness(graph);

      const totalFactorCount = (graph.nodes ?? []).filter(
        (n: any) => n.kind === "factor",
      ).length;

      const response: CEEGraphReadinessResponseV1 = {
        readiness_score: coaching.readiness_score,
        readiness_level: coaching.readiness_level,
        confidence_level: coaching.confidence_level,
        confidence_explanation: coaching.confidence_explanation,
        quality_factors: coaching.quality_factors,

        can_run_analysis: admission.can_run_analysis,
        blocker_reason: admission.blocker_reason,
        ready: admission.can_run_analysis,
        options_ready: admission.options_ready,
        options_total: admission.options_total,
        goal_node_valid: admission.goal_node_valid,
        issues: admission.issues,
        critiques: admission.critiques,
        scaffold_plan: admission.scaffold_plan,
        readiness_issues: admission.readiness_issues,

        evidence_quality: coaching.evidence_quality,
        // DEPRECATED: use total_factor_count and user_question_count.
        factor_count: coaching.quality_factors.length,
        total_factor_count: totalFactorCount,
        user_question_count: coaching.quality_factors.length,
        trace,
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeGraphReadinessCompleted, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        readiness_score: coaching.readiness_score,
        readiness_level: coaching.readiness_level,
        can_run_analysis: admission.can_run_analysis,
        // DEPRECATED: use total_factor_count and user_question_count.
        factor_count: coaching.quality_factors.length,
        total_factor_count: totalFactorCount,
        user_question_count: coaching.quality_factors.length,
        options_ready: admission.options_ready,
        options_total: admission.options_total,
        // The payload no longer selects an assessor. Recorded so a live capture
        // can CONFIRM the two request shapes converge on one verdict, rather
        // than that being an assumption about deployed behaviour.
        analysis_ready_present: Boolean(input.analysis_ready?.options?.length),
      });

      logCeeCall({
        requestId,
        capability: "cee_graph_readiness",
        latencyMs,
        status: "ok",
        httpStatus: 200,
      });

      // ONE version. The route previously emitted `v3` or `v1` according to the
      // request shape — two versions for two assessors. There is one assessor
      // now, so `v1` is the honest single value: the response is a superset of
      // the old v1 body, and every field the old v3 body carried is still here.
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
