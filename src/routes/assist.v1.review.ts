/**
 * CEE Review endpoint - /assist/v1/review
 *
 * M1 CEE Orchestrator: Shape-complete response with blocks and readiness assessment
 * Called by PLoT after inference to get comprehensive review of decision model
 */

import type { FastifyInstance } from "fastify";
import {
  validateReviewRequest,
  isValidRequestId,
  type ReviewResponseT,
  type ReviewErrorResponseT,
  type ReviewErrorCodeT,
  type ReviewBlockT,
} from "../schemas/review.js";
import {
  buildAllBlocks,
  buildReadinessBlock,
  generateRobustnessSynthesis,
  computeDecisionQuality,
  countMissingBaselines,
  aggregateInsights,
  generateImprovementGuidance,
  generateRationale,
  type BlockBuilderContext,
} from "../services/review/index.js";
import { computeQuality } from "../cee/quality/index.js";
import { detectBiases } from "../cee/bias/index.js";
import { checkDomainCompleteness } from "../cee/graph-readiness/domain-completeness.js";
import { computeEvidenceQualityDistribution } from "../cee/graph-readiness/factors.js";
import type { GraphV1 } from "../contracts/plot/engine.js";
import { inferArchetype } from "../cee/archetypes/index.js";
import { generateRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, log, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";
import { getCeeFeatureRateLimiter } from "../cee/config/limits.js";
import { config } from "../config/index.js";
import type { GraphT } from "../schemas/graph.js";

// =============================================================================
// Error Response Builder
// =============================================================================

function buildReviewErrorResponse(
  code: ReviewErrorCodeT,
  message: string,
  requestId: string,
  correlationId: string | undefined,
  options: {
    retryable?: boolean;
    details?: Record<string, unknown>;
  } = {}
): ReviewErrorResponseT {
  return {
    trace: {
      request_id: requestId,
      correlation_id: correlationId,
    },
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      details: options.details,
    },
  };
}

// =============================================================================
// Request ID Resolution
// =============================================================================

/**
 * Resolve request ID with CEE-safe pattern validation
 * Priority: header > body > fastify > generate
 */
function resolveRequestId(
  headerValue: string | undefined,
  bodyValue: string | undefined,
  fastifyId: string | undefined
): string {
  // 1. Check header
  if (headerValue && isValidRequestId(headerValue)) {
    return headerValue;
  }
  if (headerValue) {
    log.warn({ header_value: headerValue }, "Unsafe X-Request-Id header, generating new ID");
  }

  // 2. Check body
  if (bodyValue && isValidRequestId(bodyValue)) {
    return bodyValue;
  }

  // 3. Check Fastify ID (only if safe)
  if (fastifyId && isValidRequestId(fastifyId)) {
    return fastifyId;
  }

  // 4. Generate new UUID
  return generateRequestId();
}

/**
 * Resolve correlation ID - prefer caller's correlation_id over request_id
 */
function resolveCorrelationId(
  bodyCorrelationId: string | undefined,
  requestId: string
): string {
  // Use caller's correlation ID if provided
  if (bodyCorrelationId && typeof bodyCorrelationId === "string" && bodyCorrelationId.trim()) {
    return bodyCorrelationId;
  }
  // Fall back to request ID for local tracing
  return requestId;
}

// =============================================================================
// Route Handler
// =============================================================================

export default async function route(app: FastifyInstance) {
  // Use shared rate limiter infrastructure (cluster-aware when Redis is configured)
  const rateLimiter = getCeeFeatureRateLimiter(
    "review",
    "CEE_REVIEW_RATE_LIMIT_RPM"
  );
  const FEATURE_VERSION = config.cee.reviewFeatureVersion || "review-v1.0.0";
  const MAX_BLOCKS = 10;

  app.post("/assist/v1/review", async (req, reply) => {
    const start = Date.now();

    // Resolve request ID (authoritative)
    const headerRequestId = req.headers["x-request-id"] as string | undefined;
    const bodyRequestId = (req.body as any)?.request_id;
    const requestId = resolveRequestId(headerRequestId, bodyRequestId, req.id);

    // Resolve correlation ID - preserve caller's ID for distributed tracing
    const bodyCorrelationId = (req.body as any)?.correlation_id;
    const correlationId = resolveCorrelationId(bodyCorrelationId, requestId);

    // Get auth context
    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    // Emit request event
    emit(TelemetryEvents.CeeReviewRequested, {
      ...telemetryCtx,
      feature: "cee_review",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting using shared infrastructure
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = rateLimiter.tryConsume(rateKey);

    if (!allowed) {
      const errorBody = buildReviewErrorResponse(
        "CEE_REVIEW_RATE_LIMITED",
        "CEE Review rate limit exceeded",
        requestId,
        correlationId,
        {
          retryable: true,
          details: { retry_after_seconds: retryAfterSeconds },
        }
      );

      emit(TelemetryEvents.CeeReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_REVIEW_RATE_LIMITED",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_review",
        latencyMs: Date.now() - start,
        status: "limited",
        errorCode: "CEE_REVIEW_RATE_LIMITED",
        httpStatus: 429,
      });

      reply.header("Retry-After", retryAfterSeconds.toString());
      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(429);
      return reply.send(errorBody);
    }

    // Validate request
    const validation = validateReviewRequest(req.body);
    if (!validation.success) {
      const errorBody = buildReviewErrorResponse(
        validation.error.code,
        validation.error.message,
        requestId,
        correlationId,
        {
          retryable: false,
          details: validation.error.details as Record<string, unknown>,
        }
      );

      emit(TelemetryEvents.CeeReviewFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: validation.error.code,
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_review",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: validation.error.code,
        httpStatus: 400,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(400);
      return reply.send(errorBody);
    }

    const input = validation.data;

    try {
      // Check if placeholder blocks are enabled (M1 scaffolding gating)
      const placeholdersEnabled = config.cee.reviewPlaceholdersEnabled;

      let allBlocks: ReviewBlockT[];
      let warnings: string[] = [];

      if (placeholdersEnabled) {
        // Build block context
        const blockContext: BlockBuilderContext = {
          graph: input.graph as GraphT,
          brief: input.brief,
          requestId,
          inference: input.inference,
          robustness: input.robustness,
          seed: input.seed,
        };

        // Build all blocks
        const blockResult = buildAllBlocks(blockContext);
        warnings = blockResult.warnings;

        // Build readiness block and get assessment
        const { block: readinessBlock } = buildReadinessBlock({
          graph: input.graph as GraphT,
          brief: input.brief,
          blocks: blockResult.blocks,
          requestId,
        });

        // Add readiness block to blocks array
        allBlocks = [...blockResult.blocks, readinessBlock];
      } else {
        // When placeholders are disabled, only return readiness + robustness blocks
        // Robustness is NOT a placeholder - it's computed from ISL data
        const blockContext: BlockBuilderContext = {
          graph: input.graph as GraphT,
          brief: input.brief,
          requestId,
          inference: input.inference,
          robustness: input.robustness,
          seed: input.seed,
        };

        // Always build robustness block (never fails, gracefully degrades)
        const robustnessResult = buildAllBlocks(blockContext, ["robustness"]);
        warnings = robustnessResult.warnings;

        const { block: readinessBlock } = buildReadinessBlock({
          graph: input.graph as GraphT,
          brief: input.brief,
          blocks: robustnessResult.blocks,
          requestId,
        });
        allBlocks = [...robustnessResult.blocks, readinessBlock];
      }

      // Truncate if needed
      const blocksTruncated = allBlocks.length > MAX_BLOCKS;
      const finalBlocks = blocksTruncated ? allBlocks.slice(0, MAX_BLOCKS) : allBlocks;

      // Get readiness assessment from the last block (next_steps block)
      const readinessBlock = allBlocks.find((b) => b.type === "next_steps");
      const assessment = readinessBlock && readinessBlock.type === "next_steps"
        ? {
            level: readinessBlock.level,
            score: readinessBlock.score,
            summary: readinessBlock.summary,
            recommendations: readinessBlock.recommendations || [],
          }
        : {
            level: "not_ready" as const,
            score: 0,
            summary: "Could not compute readiness assessment.",
            recommendations: [],
          };

      // Compute quality
      const confidence = input.inference?.ranked_actions ? 0.7 : 0.5;
      const quality = computeQuality({
        graph: input.graph as any,
        confidence,
        engineIssueCount: warnings.length,
        ceeIssues: [],
      });

      // Infer archetype using dedicated review flag (not draft flag)
      let archetype: ReviewResponseT["archetype"];
      if (config.cee.reviewArchetypesEnabled) {
        const { archetype: inferred } = inferArchetype({
          hint: input.archetype_hint,
          brief: input.brief,
          graph: input.graph as any,
          engineConfidence: confidence,
        });
        archetype = inferred;
      } else {
        archetype = input.archetype_hint
          ? {
              decision_type: input.archetype_hint,
              match: "fuzzy" as const,
              confidence,
            }
          : {
              decision_type: "generic",
              match: "generic" as const,
              confidence,
            };
      }

      // Build guidance with clear scaffolding indication when placeholders enabled
      const guidanceHeadline = assessment.level === "ready"
        ? "Your decision model is ready for analysis."
        : assessment.level === "caution"
        ? "Your decision model needs some attention before analysis."
        : "Your decision model requires significant improvements.";

      const guidance = {
        headline: placeholdersEnabled
          ? `[M1 Scaffolding] ${guidanceHeadline}`
          : guidanceHeadline,
        next_steps: assessment.recommendations.slice(0, 3),
        warnings: placeholdersEnabled && warnings.length > 0
          ? ["Blocks contain placeholder content (M1 scaffolding)", ...warnings.slice(0, 2)]
          : warnings.length > 0 ? warnings.slice(0, 3) : undefined,
      };

      // Generate robustness synthesis from PLoT data (if provided)
      const robustnessSynthesis = generateRobustnessSynthesis(input.robustness_data);

      // Compute decision quality for Results Panel
      const missingBaselineCount = countMissingBaselines(input.graph as any);
      const fragileEdgeCount = input.robustness_data?.fragile_edges?.length ?? 0;
      const decisionQuality = computeDecisionQuality({
        quality,
        readiness: { level: assessment.level, score: assessment.score },
        issues: warnings,
        missingBaselineCount,
        fragileEdgeCount,
      });

      // Aggregate insights for Results Panel
      const biasFindings = detectBiases(input.graph as GraphV1, archetype);
      const domainCompleteness = checkDomainCompleteness(input.graph as GraphV1, input.brief);
      const evidenceQuality = computeEvidenceQualityDistribution(input.graph as GraphV1);
      const insights = aggregateInsights({
        assumptionExplanations: robustnessSynthesis?.assumption_explanations,
        biasFindings,
        domainCompleteness,
        evidenceQuality,
      });

      // Get the next_steps block factors early for use in guidance generation
      const nextStepsBlockEarly = allBlocks.find((b) => b.type === "next_steps");
      const blockFactorsEarly = nextStepsBlockEarly && nextStepsBlockEarly.type === "next_steps"
        ? nextStepsBlockEarly.factors
        : { completeness: 0, structure: 0, evidence: 0, bias_risk: 1 };

      // Generate improvement guidance for Results Panel
      // Pass readiness to ensure guidance is never empty when model needs improvement
      const guidanceResult = generateImprovementGuidance({
        graph: input.graph as { nodes: Array<{ id: string; kind: string; label: string; observed_state?: { value?: number } }> },
        investigationSuggestions: robustnessSynthesis?.investigation_suggestions,
        biasFindings,
        readiness: {
          level: assessment.level,
          score: assessment.score,
          factors: blockFactorsEarly,
          summary: assessment.summary,
          recommendations: assessment.recommendations,
        },
      });
      const improvementGuidance = guidanceResult.items;

      // Generate rationale for Results Panel
      const goalNode = input.graph.nodes.find((n) => n.kind === "goal");
      const goal = goalNode && goalNode.label ? { id: goalNode.id, label: goalNode.label } : undefined;
      const drivers = input.robustness_data?.factor_sensitivity?.map((f: { factor_id: string; factor_label: string; elasticity: number }) => ({
        id: f.factor_id,
        label: f.factor_label,
        sensitivity: f.elasticity,
      }));
      const rationale = generateRationale({
        recommendedOption: input.robustness_data?.recommended_option as { id: string; label: string } | undefined,
        goal,
        drivers,
        stability: input.robustness_data?.recommendation_stability as number | undefined,
      });

      // Build response
      const latencyMs = Date.now() - start;

      // Get the next_steps block factors for the readiness factors array
      const nextStepsBlock = allBlocks.find((b) => b.type === "next_steps");
      const blockFactors = nextStepsBlock && nextStepsBlock.type === "next_steps"
        ? nextStepsBlock.factors
        : { completeness: 0, structure: 0, evidence: 0, bias_risk: 1 };

      // Convert numeric factors to label/status format for UI
      const readinessFactors: Array<{ label: string; status: "ok" | "warning" | "blocking" }> = [
        {
          label: "Model completeness",
          status: blockFactors.completeness >= 0.7 ? "ok" : blockFactors.completeness >= 0.4 ? "warning" : "blocking",
        },
        {
          label: "Structural integrity",
          status: blockFactors.structure >= 0.7 ? "ok" : blockFactors.structure >= 0.4 ? "warning" : "blocking",
        },
        {
          label: "Evidence coverage",
          status: blockFactors.evidence >= 0.5 ? "ok" : blockFactors.evidence >= 0.3 ? "warning" : "blocking",
        },
        {
          label: "Bias risk assessment",
          status: blockFactors.bias_risk <= 0.3 ? "ok" : blockFactors.bias_risk <= 0.6 ? "warning" : "blocking",
        },
      ];

      const response: ReviewResponseT = {
        // Required top-level fields
        intent: "selection" as const,
        analysis_state: placeholdersEnabled ? "partial" as const : "ran" as const,
        // Trace with required fields
        trace: {
          request_id: requestId,
          latency_ms: latencyMs,
          model: placeholdersEnabled ? "placeholder-m1" : FEATURE_VERSION,
          // Extra fields (backwards compatible)
          correlation_id: correlationId,
          engine: {
            provider: "cee",
            model: FEATURE_VERSION,
            degraded: placeholdersEnabled,
          },
          timestamp: new Date().toISOString(),
        },
        // Readiness with required schema
        readiness: {
          level: assessment.level,
          headline: assessment.summary, // renamed from summary
          factors: readinessFactors,
          score: assessment.score, // extra field (kept for backwards compatibility)
        },
        blocks: finalBlocks,
        // Extra fields (kept for backwards compatibility)
        quality,
        archetype,
        response_limits: {
          blocks_max: MAX_BLOCKS,
          blocks_truncated: blocksTruncated,
        },
        guidance,
        // Robustness synthesis from PLoT data
        robustness_synthesis: robustnessSynthesis,
        // Decision quality assessment for Results Panel
        decision_quality: decisionQuality,
        // Insights aggregation for Results Panel
        insights: insights.length > 0 ? insights : undefined,
        // Improvement guidance for Results Panel
        improvement_guidance: improvementGuidance.length > 0 ? improvementGuidance : undefined,
        // Guidance truncation flag (when more guidance available than shown)
        guidance_truncated: guidanceResult.truncated || undefined,
        // Plain English rationale for Results Panel
        rationale: rationale || undefined,
      };

      // Compute telemetry aggregates for dashboards (no raw content)
      const insightTypeCounts = insights.reduce((acc, i) => {
        acc[i.type] = (acc[i.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const guidanceCategoryCounts = improvementGuidance.reduce((acc, g) => {
        acc[g.source] = (acc[g.source] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const highSeverityInsightCount = insights.filter(i => i.severity === "high").length;

      // Derive decision_quality_summary for trending
      let decisionQualitySummary: "good" | "mixed" | "poor";
      if (assessment.level === "ready" && highSeverityInsightCount === 0) {
        decisionQualitySummary = "good";
      } else if (assessment.level === "not_ready" || highSeverityInsightCount >= 2) {
        decisionQualitySummary = "poor";
      } else {
        decisionQualitySummary = "mixed";
      }

      // Find dominant blocker (lowest factor if any is blocking)
      const dominantBlocker = readinessFactors
        .filter(f => f.status === "blocking")
        .map(f => f.label.toLowerCase().replace(/ /g, "_"))[0] || null;

      // Emit success telemetry with enhanced aggregates
      emit(TelemetryEvents.CeeReviewSucceeded, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        quality_overall: quality.overall,
        readiness_level: assessment.level,
        readiness_score: assessment.score,
        block_count: finalBlocks.length,
        blocks_truncated: blocksTruncated,
        graph_nodes: input.graph.nodes.length,
        graph_edges: input.graph.edges.length,
        has_inference: Boolean(input.inference),
        placeholders_enabled: placeholdersEnabled,
        has_robustness_data: Boolean(input.robustness_data),
        has_robustness_synthesis: Boolean(robustnessSynthesis),
        decision_quality_level: decisionQuality.level,
        insights_count: insights.length,
        improvement_guidance_count: improvementGuidance.length,
        has_rationale: Boolean(rationale),
        // Enhanced aggregates (Task 5)
        insight_type_counts: insightTypeCounts,
        guidance_category_counts: guidanceCategoryCounts,
        guidance_truncated: guidanceResult.truncated,
        guidance_priority_min: improvementGuidance.length > 0
          ? Math.min(...improvementGuidance.map(g => g.priority))
          : null,
        guidance_priority_max: improvementGuidance.length > 0
          ? Math.max(...improvementGuidance.map(g => g.priority))
          : null,
        decision_quality_summary: decisionQualitySummary,
        dominant_blocker: dominantBlocker,
        high_severity_insight_count: highSeverityInsightCount,
      });

      logCeeCall({
        requestId,
        capability: "cee_review",
        latencyMs,
        status: assessment.level === "not_ready" ? "degraded" : "ok",
        httpStatus: 200,
      });

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(200);
      return reply.send(response);
    } catch (error) {
      const err = error instanceof Error ? error : new Error("internal error");
      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.CeeReviewFailed, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        error_code: "CEE_REVIEW_INTERNAL_ERROR",
        http_status: 500,
        error_message: err.message,
      });

      logCeeCall({
        requestId,
        capability: "cee_review",
        latencyMs,
        status: "error",
        errorCode: "CEE_REVIEW_INTERNAL_ERROR",
        httpStatus: 500,
      });

      const errorBody = buildReviewErrorResponse(
        "CEE_REVIEW_INTERNAL_ERROR",
        err.message || "internal error",
        requestId,
        correlationId,
        { retryable: false }
      );

      reply.header("X-CEE-API-Version", "v1");
      reply.header("X-CEE-Feature-Version", FEATURE_VERSION);
      reply.header("X-CEE-Request-ID", requestId);
      reply.code(500);
      return reply.send(errorBody);
    }
  });
}
