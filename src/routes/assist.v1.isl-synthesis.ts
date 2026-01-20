/**
 * POST /assist/v1/isl-synthesis
 *
 * Converts ISL quantitative analysis results into human-readable narratives.
 * Template-based (no LLM calls) for deterministic, fast output.
 *
 * Future enhancement: Add LLM option for richer narrative generation.
 */

import type { FastifyInstance } from "fastify";
import { CEEIslSynthesisInput, type CEEIslSynthesisInputT } from "../schemas/cee.js";
import type { CEEIslSynthesisResponseV1T } from "../schemas/ceeResponses.js";
import { buildCeeErrorResponse } from "../cee/validation/pipeline.js";
import { getCeeFeatureRateLimiter } from "../cee/config/limits.js";
import { getRequestId } from "../utils/request-id.js";
import { getRequestKeyId, getRequestCallerContext } from "../plugins/auth.js";
import { contextToTelemetry } from "../context/index.js";
import { emit, TelemetryEvents } from "../utils/telemetry.js";
import { logCeeCall } from "../cee/logging.js";

export default async function route(app: FastifyInstance) {
  const rateLimiter = getCeeFeatureRateLimiter(
    "isl_synthesis",
    "CEE_ISL_SYNTHESIS_RATE_LIMIT_RPM"
  );
  const FEATURE_VERSION = "isl-synthesis-1.0.0";

  app.post("/assist/v1/isl-synthesis", async (req, reply) => {
    const start = Date.now();
    const requestId = getRequestId(req);

    const keyId = getRequestKeyId(req) || undefined;
    const apiKeyPresent = Boolean(keyId);
    const callerCtx = getRequestCallerContext(req);
    const telemetryCtx = callerCtx ? contextToTelemetry(callerCtx) : { request_id: requestId };

    emit(TelemetryEvents.IslSynthesisRequested, {
      ...telemetryCtx,
      feature: "cee_isl_synthesis",
      api_key_present: apiKeyPresent,
    });

    // Rate limiting
    const rateKey = keyId || req.ip || "unknown";
    const { allowed, retryAfterSeconds } = rateLimiter.tryConsume(rateKey);
    if (!allowed) {
      const errorBody = buildCeeErrorResponse(
        "CEE_RATE_LIMIT",
        "CEE ISL Synthesis rate limit exceeded",
        {
          retryable: true,
          requestId,
          details: { retry_after_seconds: retryAfterSeconds },
        },
      );

      emit(TelemetryEvents.IslSynthesisFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_RATE_LIMIT",
        http_status: 429,
      });

      logCeeCall({
        requestId,
        capability: "cee_isl_synthesis",
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
    const parsed = CEEIslSynthesisInput.safeParse(req.body);
    if (!parsed.success) {
      const errorBody = buildCeeErrorResponse("CEE_VALIDATION_FAILED", "invalid input", {
        retryable: false,
        requestId,
        details: { field_errors: parsed.error.flatten() },
      });

      emit(TelemetryEvents.IslSynthesisFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_VALIDATION_FAILED",
        http_status: 400,
      });

      logCeeCall({
        requestId,
        capability: "cee_isl_synthesis",
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

    const input = parsed.data;

    try {
      // Generate narratives using templates (deterministic, no LLM)
      const narratives = generateNarratives(input);

      const response: CEEIslSynthesisResponseV1T = {
        robustness_narrative: narratives.robustness_narrative,
        sensitivity_narrative: narratives.sensitivity_narrative,
        voi_narrative: narratives.voi_narrative,
        tipping_narrative: narratives.tipping_narrative,
        executive_summary: narratives.executive_summary,
        trace: {
          request_id: requestId,
          correlation_id: requestId,
          engine: {},
        },
        quality: {
          overall: 80, // Template-based, consistent quality
          structure: 85,
          coverage: 75,
        },
        provenance: "cee",
      };

      const latencyMs = Date.now() - start;

      emit(TelemetryEvents.IslSynthesisSucceeded, {
        ...telemetryCtx,
        latency_ms: latencyMs,
        has_sensitivity: Boolean(input.sensitivity?.length),
        has_voi: Boolean(input.voi?.length),
        has_tipping: Boolean(input.tipping_points?.length),
        has_robustness: Boolean(input.robustness?.length),
      });

      logCeeCall({
        requestId,
        capability: "cee_isl_synthesis",
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

      emit(TelemetryEvents.IslSynthesisFailed, {
        ...telemetryCtx,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR",
        http_status: 500,
        error_message: err instanceof Error ? err.message : String(err),
      });

      logCeeCall({
        requestId,
        capability: "cee_isl_synthesis",
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

// =============================================================================
// Template-Based Narrative Generation
// =============================================================================

interface Narratives {
  robustness_narrative?: string;
  sensitivity_narrative?: string;
  voi_narrative?: string;
  tipping_narrative?: string;
  executive_summary: string;
}

function generateNarratives(input: CEEIslSynthesisInputT): Narratives {
  const narratives: Narratives = {
    executive_summary: "",
  };

  // Robustness narrative
  if (input.robustness?.length) {
    const top = input.robustness[0];
    const scorePercent = (top.robustness_score * 100).toFixed(0);
    const scenarioText = top.scenarios_tested
      ? ` across ${top.scenarios_dominant ?? "most"} of ${top.scenarios_tested} tested scenarios`
      : "";

    if (top.robustness_score >= 0.8) {
      narratives.robustness_narrative = `The recommendation${top.recommendation_label ? ` to ${top.recommendation_label}` : ""} is highly robust with a ${scorePercent}% confidence score${scenarioText}. The optimal choice remains stable even with significant parameter variations.`;
    } else if (top.robustness_score >= 0.5) {
      narratives.robustness_narrative = `The recommendation${top.recommendation_label ? ` to ${top.recommendation_label}` : ""} has moderate robustness (${scorePercent}%)${scenarioText}. While it performs well in most scenarios, some parameter combinations could shift the optimal choice.`;
    } else {
      narratives.robustness_narrative = `The recommendation${top.recommendation_label ? ` to ${top.recommendation_label}` : ""} shows limited robustness (${scorePercent}%)${scenarioText}. The optimal choice is sensitive to parameter variations - consider gathering more information before committing.`;
    }
  }

  // Sensitivity narrative
  if (input.sensitivity?.length) {
    const topFactors = input.sensitivity.slice(0, 3);
    const factorDescriptions = topFactors.map((s) => {
      const label = s.factor_label || s.factor_id;
      const direction = s.direction === "positive" ? "positively" : s.direction === "negative" ? "negatively" : "";
      return direction ? `${label} (${direction} correlated)` : label;
    });

    const joinedFactors = factorDescriptions.length === 1
      ? factorDescriptions[0]
      : factorDescriptions.slice(0, -1).join(", ") + " and " + factorDescriptions[factorDescriptions.length - 1];

    narratives.sensitivity_narrative = `The outcome is most sensitive to ${joinedFactors}. Small changes in these factors could significantly impact the expected value. ${topFactors.length > 1 ? "Monitor these variables closely and consider contingency plans." : "Monitor this variable closely."}`;
  }

  // VoI narrative
  if (input.voi?.length) {
    const topVoi = input.voi[0];
    const voiFormatted = topVoi.voi >= 1
      ? topVoi.voi.toFixed(0)
      : topVoi.voi.toFixed(2);
    const label = topVoi.factor_label || topVoi.factor_id;

    narratives.voi_narrative = `Resolving uncertainty about ${label} has the highest expected value of information (${voiFormatted}). ${topVoi.recommended_research || "Consider gathering more data on this factor before making a final decision."} ${input.voi.length > 1 ? `${input.voi.length - 1} additional factors also warrant investigation.` : ""}`;
  }

  // Tipping point narrative
  if (input.tipping_points?.length) {
    const tip = input.tipping_points[0];
    const label = tip.factor_label || tip.factor_id;

    let proximityText = "";
    if (tip.current_value !== undefined) {
      const distance = Math.abs(tip.current_value - tip.threshold_value);
      const percentDist = ((distance / Math.abs(tip.threshold_value)) * 100).toFixed(0);
      proximityText = ` Current value (${tip.current_value.toFixed(2)}) is ${percentDist}% away from this threshold.`;
    }

    const optionShift = tip.optimal_before && tip.optimal_after
      ? ` from ${tip.optimal_before} to ${tip.optimal_after}`
      : "";

    narratives.tipping_narrative = `Critical threshold detected: if ${label} exceeds ${tip.threshold_value.toFixed(2)}, the optimal choice shifts${optionShift}.${proximityText} ${input.tipping_points.length > 1 ? `${input.tipping_points.length - 1} additional tipping points identified.` : ""}`;
  }

  // Executive summary
  narratives.executive_summary = generateExecutiveSummary(input, narratives);

  return narratives;
}

function generateExecutiveSummary(input: CEEIslSynthesisInputT, narratives: Narratives): string {
  const parts: string[] = [];

  // Context
  if (input.goal_label) {
    parts.push(`Goal: ${input.goal_label}.`);
  }
  if (input.recommendation_label) {
    parts.push(`Recommended action: ${input.recommendation_label}.`);
  }

  // Key findings
  if (input.robustness?.length) {
    const score = (input.robustness[0].robustness_score * 100).toFixed(0);
    parts.push(`Robustness: ${score}%.`);
  }

  if (input.sensitivity?.length) {
    const topFactor = input.sensitivity[0].factor_label || input.sensitivity[0].factor_id;
    parts.push(`Most sensitive to: ${topFactor}.`);
  }

  if (input.voi?.length) {
    const topVoi = input.voi[0].factor_label || input.voi[0].factor_id;
    parts.push(`Highest VoI: ${topVoi}.`);
  }

  if (input.tipping_points?.length) {
    parts.push(`${input.tipping_points.length} critical threshold(s) detected.`);
  }

  // Default if no parts
  if (parts.length === 0) {
    return "ISL analysis complete. See detailed narratives above.";
  }

  return parts.join(" ");
}
