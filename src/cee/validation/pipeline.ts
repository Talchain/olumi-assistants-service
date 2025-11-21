import type { FastifyRequest } from "fastify";
import type { components } from "../../generated/openapi.d.ts";
import { runDraftGraphPipeline } from "../../routes/assist.draft-graph.js";
import { SSE_DEGRADED_HEADER_NAME_LOWER } from "../../utils/degraded-mode.js";
import type { DraftGraphInputT } from "../../schemas/assist.js";
import { validateResponse } from "../../utils/responseGuards.js";
import { getRequestId } from "../../utils/request-id.js";
import { emit, TelemetryEvents } from "../../utils/telemetry.js";
import { inferArchetype } from "../archetypes/index.js";
import { computeQuality } from "../quality/index.js";
import { buildCeeGuidance, ceeAnyTruncated } from "../guidance/index.js";
import {
  CEE_BIAS_FINDINGS_MAX,
  CEE_OPTIONS_MAX,
  CEE_EVIDENCE_SUGGESTIONS_MAX,
  CEE_SENSITIVITY_SUGGESTIONS_MAX,
} from "../config/limits.js";

type CEEDraftGraphResponseV1 = components["schemas"]["CEEDraftGraphResponseV1"];
type CEEErrorResponseV1 = components["schemas"]["CEEErrorResponseV1"];
type CEEErrorCode = components["schemas"]["CEEErrorCode"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];
type CEEQualityMeta = components["schemas"]["CEEQualityMeta"];

type DraftInputWithCeeExtras = DraftGraphInputT & {
  seed?: string;
  archetype_hint?: string;
};

const COST_MAX_USD = Number(process.env.COST_MAX_USD) || 1.0;

type ResponseLimitsMeta = {
  bias_findings_max: number;
  bias_findings_truncated: boolean;
  options_max: number;
  options_truncated: boolean;
  evidence_suggestions_max: number;
  evidence_suggestions_truncated: boolean;
  sensitivity_suggestions_max: number;
  sensitivity_suggestions_truncated: boolean;
};

function capList<T>(value: unknown, max: number): { list?: T[]; truncated: boolean } {
  if (!Array.isArray(value)) {
    return { list: undefined, truncated: false };
  }
  if (value.length <= max) {
    return { list: value as T[], truncated: false };
  }
  return { list: (value as T[]).slice(0, max), truncated: true };
}

function applyResponseCaps(payload: any): { cappedPayload: any; limits: ResponseLimitsMeta } {
  const cappedPayload = { ...payload };

  const bias = capList<any>(payload.bias_findings, CEE_BIAS_FINDINGS_MAX);
  if (bias.list) cappedPayload.bias_findings = bias.list;

  const opts = capList<any>(payload.options, CEE_OPTIONS_MAX);
  if (opts.list) cappedPayload.options = opts.list;

  const evidence = capList<any>(payload.evidence_suggestions, CEE_EVIDENCE_SUGGESTIONS_MAX);
  if (evidence.list) cappedPayload.evidence_suggestions = evidence.list;

  const sensitivity = capList<any>(payload.sensitivity_suggestions, CEE_SENSITIVITY_SUGGESTIONS_MAX);
  if (sensitivity.list) cappedPayload.sensitivity_suggestions = sensitivity.list;

  const limits: ResponseLimitsMeta = {
    bias_findings_max: CEE_BIAS_FINDINGS_MAX,
    bias_findings_truncated: bias.truncated,
    options_max: CEE_OPTIONS_MAX,
    options_truncated: opts.truncated,
    evidence_suggestions_max: CEE_EVIDENCE_SUGGESTIONS_MAX,
    evidence_suggestions_truncated: evidence.truncated,
    sensitivity_suggestions_max: CEE_SENSITIVITY_SUGGESTIONS_MAX,
    sensitivity_suggestions_truncated: sensitivity.truncated,
  };

  return { cappedPayload, limits };
}

function archetypesEnabled(): boolean {
  const flag = process.env.CEE_DRAFT_ARCHETYPES_ENABLED;
  if (flag === undefined) {
    return true;
  }
  return flag === "true" || flag === "1";
}

export function buildCeeErrorResponse(
  code: CEEErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    requestId?: string;
    details?: Record<string, unknown>;
    engineDegraded?: boolean;
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

  return {
    schema: "cee.error.v1",
    code,
    message,
    retryable: options.retryable,
    trace: Object.keys(trace).length ? trace : undefined,
    details: options.details,
  };
}

export async function finaliseCeeDraftResponse(
  input: DraftInputWithCeeExtras,
  rawBody: unknown,
  request: FastifyRequest
): Promise<{
  statusCode: number;
  body: CEEDraftGraphResponseV1 | CEEErrorResponseV1;
  headers?: Record<string, string>;
}> {
  const start = Date.now();
  const requestId = getRequestId(request);

  let pipelineResult: any;
  try {
    pipelineResult = await runDraftGraphPipeline(input, rawBody, requestId);
  } catch (error) {
    const err = error instanceof Error ? error : new Error("unexpected error");
    const isTimeout = err.name === "UpstreamTimeoutError";
    const statusCode = isTimeout ? 504 : 500;
    const code: CEEErrorCode = isTimeout ? "CEE_TIMEOUT" : "CEE_INTERNAL_ERROR";
    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: Date.now() - start,
      error_code: code,
      http_status: statusCode,
    });
    return {
      statusCode,
      body: buildCeeErrorResponse(code, isTimeout ? "upstream timeout" : err.message || "internal error", {
        retryable: isTimeout,
        requestId,
      }),
    };
  }

  if (!pipelineResult || pipelineResult.kind === "error") {
    const envelope = pipelineResult?.envelope;
    const statusCode: number = pipelineResult?.statusCode ?? 500;

    if (!envelope) {
      emit(TelemetryEvents.CeeDraftGraphFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR" as CEEErrorCode,
        http_status: statusCode,
      });
      return {
        statusCode,
        body: buildCeeErrorResponse("CEE_INTERNAL_ERROR", "unexpected pipeline error", {
          retryable: false,
          requestId,
        }),
      };
    }

    // Map existing error.v1 codes into CEE error codes
    let ceeCode: CEEErrorCode = "CEE_INTERNAL_ERROR";
    let retryable = false;

    if (statusCode === 503) {
      ceeCode = "CEE_SERVICE_UNAVAILABLE";
      retryable = true;
    } else {
      switch (envelope.code) {
        case "BAD_INPUT":
          ceeCode = "CEE_VALIDATION_FAILED";
          retryable = false;
          break;
        case "RATE_LIMITED":
          ceeCode = "CEE_RATE_LIMIT";
          retryable = true;
          break;
        case "INTERNAL":
        default:
          ceeCode = "CEE_INTERNAL_ERROR";
          retryable = false;
          break;
      }
    }

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: Date.now() - start,
      error_code: ceeCode,
      http_status: statusCode,
    });

    return {
      statusCode,
      body: buildCeeErrorResponse(ceeCode, envelope.message, {
        retryable,
        requestId,
        details: envelope.details as Record<string, unknown> | undefined,
      }),
    };
  }

  const { payload, cost_usd, provider, model, repro_mismatch } = pipelineResult as {
    payload: any;
    cost_usd: number;
    provider: string;
    model: string;
    repro_mismatch?: boolean;
  };

  // Post-response guard: graph caps and cost (CEE must honour the same limits)
  const guardResult = validateResponse(payload.graph, cost_usd, COST_MAX_USD);
  if (!guardResult.ok) {
    const violation = guardResult.violation;

    const ceeCode: CEEErrorCode =
      violation.code === "CAP_EXCEEDED" || violation.code === "INVALID_COST"
        ? "CEE_GRAPH_INVALID"
        : "CEE_VALIDATION_FAILED";

    const issue: CEEValidationIssue = {
      code: violation.code,
      severity: "error",
      message: violation.message,
      details: violation.details as Record<string, unknown> | undefined,
    };

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: Date.now() - start,
      error_code: ceeCode,
      http_status: 400,
    });

    return {
      statusCode: 400,
      body: buildCeeErrorResponse(ceeCode, violation.message, {
        retryable: false,
        requestId,
        details: {
          guard_violation: violation,
          validation_issues: [issue],
        },
      }),
    };
  }

  const trace: CEETraceMeta = {
    request_id: requestId,
    correlation_id: requestId,
    engine: {
      provider,
      model,
    },
  };

  const confidence: number = typeof payload.confidence === "number" ? payload.confidence : 0.7;
  const engineIssueCount = Array.isArray(payload.issues) ? payload.issues.length : 0;

  const validationIssues: CEEValidationIssue[] = [];

  if (Array.isArray(payload.issues)) {
    for (const msg of payload.issues as string[]) {
      validationIssues.push({
        code: "ENGINE_VALIDATION_WARNING",
        severity: "warning",
        message: msg,
        details: { scope: "engine_validate" },
      });
    }
  }

  if (repro_mismatch) {
    validationIssues.push({
      code: "CEE_REPRO_MISMATCH",
      severity: "warning",
      message: "Engine reported a reproducibility mismatch for this graph and seed",
      details: { scope: "engine", hint: "response_hash_mismatch" },
    });
  }

  // Hook: engine degraded mode propagated via header (future engine integration)
  const degradedHeader = request.headers[SSE_DEGRADED_HEADER_NAME_LOWER] as string | undefined;
  if (degradedHeader) {
    trace.engine = {
      ...(trace.engine || {}),
      degraded: true,
    };
    validationIssues.push({
      code: "ENGINE_DEGRADED",
      severity: "warning",
      message: "Engine reported degraded mode",
      details: { scope: "engine", source: "x-olumi-degraded", hint: degradedHeader },
    });
  }

  let archetype: CEEDraftGraphResponseV1["archetype"];

  if (archetypesEnabled() && payload.graph) {
    const { archetype: inferred, issues: archetypeIssues } = inferArchetype({
      hint: input.archetype_hint,
      brief: input.brief,
      graph: payload.graph,
      engineConfidence: confidence,
    });

    archetype = inferred;
    if (Array.isArray(archetypeIssues) && archetypeIssues.length > 0) {
      validationIssues.push(...archetypeIssues);
    }
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

  const quality: CEEQualityMeta = computeQuality({
    graph: payload.graph,
    confidence,
    engineIssueCount,
    ceeIssues: validationIssues,
  });

  const { cappedPayload, limits } = applyResponseCaps(payload);

  const guidance = buildCeeGuidance({
    quality,
    validationIssues,
    limits,
  });

  const ceeResponse: CEEDraftGraphResponseV1 = {
    ...cappedPayload,
    trace,
    quality,
    validation_issues: validationIssues.length ? validationIssues : undefined,
    archetype,
    seed: input.seed,
    response_hash: cappedPayload.response_hash as string | undefined,
    response_limits: limits,
    guidance,
  };

  emit(TelemetryEvents.CeeDraftGraphSucceeded, {
    request_id: requestId,
    latency_ms: Date.now() - start,
    quality_overall: quality.overall,
    graph_nodes: Array.isArray(payload.graph?.nodes) ? payload.graph.nodes.length : 0,
    graph_edges: Array.isArray(payload.graph?.edges) ? payload.graph.edges.length : 0,
    has_validation_issues: validationIssues.length > 0,
    any_truncated: ceeAnyTruncated(limits),
    engine_provider: provider,
    engine_model: model,
  });

  return {
    statusCode: 200,
    body: ceeResponse,
    headers: {},
  };
}
