import type { FastifyRequest } from "fastify";
import type { components } from "../../generated/openapi.d.ts";
import type { DraftGraphInputT } from "../../schemas/assist.js";
import { log } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";
import { safeEqual } from "../../utils/hash.js";
import { normaliseRiskCoefficients } from "../transforms/risk-normalisation.js";

type CEEDraftGraphResponseV1 = components["schemas"]["CEEDraftGraphResponseV1"];
type CEEErrorResponseV1 = components["schemas"]["CEEErrorResponseV1"];
/**
 * CEEErrorCode — full set of CEE error codes from OpenAPI spec.
 *
 * Note: @talchain/schemas exports a narrower CeeErrorCode covering LLM-layer
 * errors only (6 codes). The pipeline uses the full OpenAPI set (12 codes
 * including CEE_GRAPH_INVALID, CEE_TIMEOUT, etc.) so we keep the OpenAPI type.
 */
type CEEErrorCode = components["schemas"]["CEEErrorCode"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];

type DraftInputWithCeeExtras = DraftGraphInputT & {
  seed?: string;
  archetype_hint?: string;
  raw_output?: boolean;
  /** Pre-formatted BriefSignals header to append to user message (from preflight decision). */
  briefSignalsHeader?: string;
  /** Deterministic bias signals from BriefSignals v1 — persisted in response payload + trace. */
  bias_signals?: Array<{ type: string; confidence: string; evidence: string }>;
  /** Pre-formatted currency context instruction to append to LLM prompts. */
  currencyInstruction?: string;
};

export function isAdminAuthorized(request: FastifyRequest): boolean {
  const providedKey = request.headers["x-admin-key"] as string | undefined;
  if (!providedKey) return false;
  const adminKey = config.prompts?.adminApiKey;
  const adminKeyRead = config.prompts?.adminApiKeyRead;
  return Boolean((adminKey && safeEqual(providedKey, adminKey)) || (adminKeyRead && safeEqual(providedKey, adminKeyRead)));
}

// The Stage-4 multi-turn clarifier (integrateClarifier) was RETIRED
// 2026-07-16 (ROADMAP 1.94, Option A). Verified triple-dead on staging:
// its convergence gate (drafter self-confidence ≥ 8/10) suppressed question
// generation on 100% of firings, the V5 draft tool discarded its output
// block, and the answer-incorporation loop was unreachable from the live
// turn path. The standalone POST /assist/clarify-brief route is a separate
// surface and is unaffected.

export function buildCeeErrorResponse(
  code: CEEErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    requestId?: string;
    details?: Record<string, unknown>;
    engineDegraded?: boolean;
    reason?: string;
    recovery?: {
      hints: string[];
      suggestion: string;
      example?: string;
    };
    nodeCount?: number;
    edgeCount?: number;
    missingKinds?: string[];
    stage?: string;  // Pipeline stage where error occurred (for debugging)
    pipelineTrace?: {
      status: "success" | "failed";
      total_duration_ms: number;
      stages: Array<{
        name: string;
        status: string;
        duration_ms: number;
        details?: Record<string, unknown>;
      }>;
      llm_quality?: Record<string, unknown>;
    };
  } = {}
): CEEErrorResponseV1 {
  const trace: CEETraceMeta = {};

  if (options.requestId) {
    trace.request_id = options.requestId;
    trace.correlation_id = options.requestId;
  }

  if (options.engineDegraded) {
    trace.engine = {
      ...(trace.engine || {}),
      degraded: true,
    };
  }

  // Include pipeline trace for debugging (shows stages completed before failure)
  if (options.pipelineTrace) {
    (trace as any).pipeline = options.pipelineTrace;
  }

  type CeeErrorDetails = Record<string, unknown> & {
    reason?: string;
    node_count?: number;
    edge_count?: number;
    missing_kinds?: string[];
    stage?: string;
  };

  let baseDetails: CeeErrorDetails | undefined = options.details
    ? ({ ...options.details } as CeeErrorDetails)
    : undefined;

  const ensureDetails = (): CeeErrorDetails => {
    if (!baseDetails) {
      baseDetails = {} as CeeErrorDetails;
    }
    return baseDetails;
  };

  // Mirror key domain fields into details for backward compatibility with older clients
  if (options.reason) {
    const details = ensureDetails();
    if (details.reason === undefined) {
      details.reason = options.reason;
    }
  }
  if (typeof options.nodeCount === "number") {
    const details = ensureDetails();
    if (details.node_count === undefined) {
      details.node_count = options.nodeCount;
    }
  }
  if (typeof options.edgeCount === "number") {
    const details = ensureDetails();
    if (details.edge_count === undefined) {
      details.edge_count = options.edgeCount;
    }
  }
  if (Array.isArray(options.missingKinds) && options.missingKinds.length > 0) {
    const details = ensureDetails();
    if (details.missing_kinds === undefined) {
      details.missing_kinds = options.missingKinds;
    }
  }
  // Add stage to details for debugging
  if (options.stage) {
    const details = ensureDetails();
    if (details.stage === undefined) {
      details.stage = options.stage;
    }
  }

  const response: CEEErrorResponseV1 = {
    // Backward-compat schema marker used by existing clients
    schema: "cee.error.v1",
    // OlumiErrorV1 core fields
    code,
    message,
    retryable: options.retryable ?? false,
    source: "cee",
    request_id: options.requestId,
    degraded: options.engineDegraded || undefined,
    // Additional domain-level hints
    reason: options.reason,
    recovery: options.recovery,
    // Wave-2 ask 7 (@talchain/schemas 0.19.0, routed from DGAI #383): the
    // PINNED flat field name for the recovery sentence. Mirrors
    // recovery.suggestion so consumers stop passthrough-sniffing fallback
    // names; present exactly when the structured suggestion is.
    recovery_suggestion: options.recovery?.suggestion,
    node_count: options.nodeCount,
    edge_count: options.edgeCount,
    missing_kinds: options.missingKinds,
    // Legacy fields
    trace: Object.keys(trace).length ? trace : undefined,
    details: baseDetails && Object.keys(baseDetails).length ? baseDetails : undefined,
  };

  // Layer 2 guard: log if required fields are missing (should never happen)
  if (!response.code || !response.message) {
    log.error(
      { event: "CEE_ERROR_BODY_INCOMPLETE", code: response.code, message: response.message },
      "buildCeeErrorResponse produced incomplete error body — this is a bug",
    );
  }

  return response;
}

// normaliseRiskCoefficients → imported from transforms/risk-normalisation.ts (re-exported for backwards compat)
export { normaliseRiskCoefficients };

/**
 * Legacy Pipeline B entry point — ARCHIVED.
 *
 * This function previously contained ~2,350 lines of the original draft-graph
 * pipeline (Pipeline A + B). It has been replaced by the unified 6-stage
 * pipeline (`runUnifiedPipeline`). The function signature is preserved for
 * type-compatibility with any remaining imports.
 */
export async function finaliseCeeDraftResponse(
  _input: DraftInputWithCeeExtras,
  _rawBody: unknown,
  _request: FastifyRequest
): Promise<{
  statusCode: number;
  body: CEEDraftGraphResponseV1 | CEEErrorResponseV1;
  headers?: Record<string, string>;
}> {
  throw new Error("Pipeline B has been removed. Use the unified pipeline (runUnifiedPipeline) instead.");
}
