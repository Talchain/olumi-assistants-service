import type { FastifyRequest } from "fastify";
import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import { runCeeDraftPipeline } from "../draft-pipeline-adapter.js";
import { SSE_DEGRADED_HEADER_NAME_LOWER } from "../../utils/degraded-mode.js";
import type { DraftGraphInputT } from "../../schemas/assist.js";
import { validateResponse } from "../../utils/responseGuards.js";
import { getRequestId } from "../../utils/request-id.js";
import { emit, log, TelemetryEvents } from "../../utils/telemetry.js";
import { inferArchetype } from "../archetypes/index.js";
import { computeQuality } from "../quality/index.js";
import { buildCeeGuidance, ceeAnyTruncated } from "../guidance/index.js";
import { logCeeCall } from "../logging.js";
import { CEEDraftGraphResponseV1Schema } from "../../schemas/ceeResponses.js";
import { verificationPipeline } from "../verification/index.js";
import { createValidationIssue } from "./classifier.js";
import {
  CEE_BIAS_FINDINGS_MAX,
  CEE_OPTIONS_MAX,
  CEE_EVIDENCE_SUGGESTIONS_MAX,
  CEE_SENSITIVITY_SUGGESTIONS_MAX,
} from "../config/limits.js";
import { detectStructuralWarnings, normaliseDecisionBranchBeliefs, validateAndFixGraph, type StructuralMeta } from "../structure/index.js";
import { sortBiasFindings } from "../bias/index.js";
import { config } from "../../config/index.js";
import {
  detectAmbiguities,
  detectConvergence,
  generateQuestionCandidates,
  selectBestQuestion,
  cacheQuestion,
  retrieveQuestion,
  incorporateAnswer,
  type ConversationHistoryEntry,
} from "../clarifier/index.js";
import { randomUUID } from "node:crypto";

type CEEDraftGraphResponseV1 = components["schemas"]["CEEDraftGraphResponseV1"];
type CEEErrorResponseV1 = components["schemas"]["CEEErrorResponseV1"];
type CEEErrorCode = components["schemas"]["CEEErrorCode"];
type CEETraceMeta = components["schemas"]["CEETraceMeta"];
type CEEValidationIssue = components["schemas"]["CEEValidationIssue"];
type CEEQualityMeta = components["schemas"]["CEEQualityMeta"];
type CEEStructuralWarningV1 = components["schemas"]["CEEStructuralWarningV1"];
type CEEConfidenceFlagsV1 = components["schemas"]["CEEConfidenceFlagsV1"];

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

// Minimum structure requirements for draft graphs.
// A usable decision model must include at least one goal, one decision, and one option.
const MINIMUM_STRUCTURE_REQUIREMENT: Readonly<Record<string, number>> = {
  goal: 1,
  decision: 1,
  option: 1,
};

type MinimumStructureResult = {
  valid: boolean;
  missing: string[];
  counts: Record<string, number>;
};

function hasConnectedMinimumStructure(graph: GraphV1 | undefined): boolean {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray((graph as any).edges)) {
    return false;
  }

  const nodes = graph.nodes;
  const edges = (graph as any).edges as Array<{ from?: string; to?: string }>;

  const kinds = new Map<string, string>();
  const decisions: string[] = [];
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    const id = typeof (node as any).id === "string" ? ((node as any).id as string) : undefined;
    const kind = node.kind as unknown as string | undefined;
    if (!id || !kind) {
      continue;
    }

    kinds.set(id, kind);
    if (!adjacency.has(id)) {
      adjacency.set(id, new Set());
    }
    if (kind === "decision") {
      decisions.push(id);
    }
  }

  for (const edge of edges) {
    const from = typeof edge.from === "string" ? (edge.from as string) : undefined;
    const to = typeof edge.to === "string" ? (edge.to as string) : undefined;
    if (!from || !to) {
      continue;
    }

    if (!adjacency.has(from)) {
      adjacency.set(from, new Set());
    }
    if (!adjacency.has(to)) {
      adjacency.set(to, new Set());
    }

    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  }

  if (decisions.length === 0) {
    return false;
  }

  for (const decisionId of decisions) {
    const visited = new Set<string>();
    const queue: string[] = [decisionId];
    let hasGoal = false;
    let hasOption = false;

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const kind = kinds.get(current);
      if (kind === "goal") {
        hasGoal = true;
      } else if (kind === "option") {
        hasOption = true;
      }

      if (hasGoal && hasOption) {
        return true;
      }

      const neighbours = adjacency.get(current);
      if (!neighbours) {
        continue;
      }

      for (const next of neighbours) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
  }

  return false;
}

function validateMinimumStructure(graph: GraphV1 | undefined): MinimumStructureResult {
  const counts: Record<string, number> = {};

  if (graph?.nodes) {
    for (const node of graph.nodes) {
      const kind = node.kind as unknown as string | undefined;
      if (typeof kind === "string" && kind.length > 0) {
        counts[kind] = (counts[kind] ?? 0) + 1;
      }
    }
  }

  const missing: string[] = [];
  for (const [kind, min] of Object.entries(MINIMUM_STRUCTURE_REQUIREMENT)) {
    if ((counts[kind] ?? 0) < min) {
      missing.push(kind);
    }
  }

  const hasMinimumCounts = missing.length === 0;
  const hasConnectivity = hasMinimumCounts ? hasConnectedMinimumStructure(graph) : false;

  return {
    valid: hasMinimumCounts && hasConnectivity,
    missing,
    counts,
  };
}

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

function normaliseCeeGraphVersionAndProvenance(graph: GraphV1 | undefined): GraphV1 | undefined {
  if (!graph) {
    return graph;
  }

  const edges = Array.isArray((graph as any).edges) ? ((graph as any).edges as any[]) : undefined;

  if (!edges) {
    return {
      ...graph,
      version: "1.2",
    };
  }

  const normalisedEdges = edges.map((edge: any) => {
    if (!edge || edge.provenance_source) {
      return edge;
    }

    const cloned = { ...edge };

    // If there is no provenance at all, treat this as an engine-originated edge.
    if (cloned.provenance === undefined || cloned.provenance === null) {
      cloned.provenance_source = "engine";
      return cloned;
    }

    const prov = cloned.provenance;

    // Lightweight inference for hypothesis provenance when structured provenance is present.
    if (prov && typeof prov === "object" && typeof (prov as any).source === "string") {
      const src = ((prov as any).source as string).toLowerCase();
      if (src === "hypothesis") {
        cloned.provenance_source = "hypothesis";
      }
      return cloned;
    }

    // Legacy string provenance: infer "hypothesis" when clearly marked, otherwise leave undefined.
    if (typeof prov === "string") {
      const src = prov.toLowerCase();
      if (src.includes("hypothesis")) {
        cloned.provenance_source = "hypothesis";
      }
      return cloned;
    }

    return cloned;
  });

  return {
    ...graph,
    version: "1.2",
    edges: normalisedEdges as any,
  };
}

function archetypesEnabled(): boolean {
  return config.cee.draftArchetypesEnabled;
}

function clarifierEnabled(): boolean {
  return config.cee.clarifierEnabled;
}

type CEEClarifierBlockV1 = components["schemas"]["CEEClarifierBlockV1"];

interface ClarifierIntegrationResult {
  clarifier?: CEEClarifierBlockV1;
  refinedGraph?: GraphV1;
  previousQuality?: number;
  /** Convergence status for backward compatibility with clarifier_status field */
  convergenceStatus?: "complete" | "max_rounds" | "confident";
}

async function integrateClarifier(
  input: DraftInputWithCeeExtras,
  graph: GraphV1,
  quality: { overall: number },
  requestId: string,
  previousGraph?: GraphV1
): Promise<ClarifierIntegrationResult> {
  if (!clarifierEnabled()) {
    return {};
  }

  // Map conversation history to required format (filter out entries without questions)
  const conversationHistory: ConversationHistoryEntry[] = (input.conversation_history ?? [])
    .filter((h): h is typeof h & { question: string; answer: string } =>
      Boolean(h.question && h.answer))
    .map((h) => ({
      question_id: h.question_id,
      question: h.question,
      answer: h.answer,
    }));

  const round = conversationHistory.length + 1;
  const maxRounds = input.max_clarifier_rounds ?? config.cee.clarifierMaxRoundsDefault;

  // If clarifier_response is provided, incorporate the answer
  let refinedGraph = graph;
  let previousQuality: number | undefined;
  let currentQuality = quality.overall;

  if (input.clarifier_response) {
    emit(TelemetryEvents.CeeClarifierAnswerReceived, {
      request_id: requestId,
      round,
      question_id: input.clarifier_response.question_id,
      answer_length: input.clarifier_response.answer.length,
    });

    const cachedQuestion = await retrieveQuestion(input.clarifier_response.question_id);
    if (cachedQuestion) {
      emit(TelemetryEvents.CeeClarifierQuestionRetrieved, {
        request_id: requestId,
        question_id: input.clarifier_response.question_id,
      });

      // Capture quality BEFORE incorporation (Fix 1.1)
      previousQuality = quality.overall;

      const result = await incorporateAnswer({
        graph,
        brief: input.brief,
        clarifier_response: input.clarifier_response,
        conversation_history: input.conversation_history,
        requestId,
      });

      if (result.refined_graph) {
        // Normalize refined graph BEFORE quality computation (W's suggestion)
        // This ensures convergence decisions use the same canonical representation as the final response
        let normalizedRefinedGraph = normaliseCeeGraphVersionAndProvenance(result.refined_graph);
        normalizedRefinedGraph = normaliseDecisionBranchBeliefs(normalizedRefinedGraph);
        refinedGraph = normalizedRefinedGraph ?? result.refined_graph;

        // Recompute quality from normalized refined graph (Fix 1.1 + W's refinement)
        const refinedQuality = computeQuality({
          graph: refinedGraph,
          confidence: quality.overall / 10, // Approximate original confidence
          engineIssueCount: 0,
          ceeIssues: [],
        });
        currentQuality = refinedQuality.overall;

        log.debug(
          {
            request_id: requestId,
            previous_quality: previousQuality,
            current_quality: currentQuality,
            quality_delta: currentQuality - previousQuality,
          },
          "Recomputed quality after answer incorporation"
        );
      }
    }
  } else if (round === 1) {
    // First round - emit session start
    emit(TelemetryEvents.CeeClarifierSessionStart, {
      request_id: requestId,
      brief_length: input.brief.length,
      initial_quality: quality.overall,
    });
  }

  // Check convergence with updated quality (Fix 1.1)
  const convergence = detectConvergence({
    currentGraph: refinedGraph,
    previousGraph: previousGraph ?? null,
    qualityScore: currentQuality,
    roundCount: round,
    maxRounds,
    previousQualityScore: previousQuality,
  }, {
    qualityComplete: config.cee.clarifierQualityThreshold,
    stabilityThreshold: config.cee.clarifierStabilityThreshold,
    minImprovement: config.cee.clarifierMinImprovementThreshold,
  });

  if (!convergence.should_continue) {
    emit(TelemetryEvents.CeeClarifierConverged, {
      request_id: requestId,
      total_rounds: round,
      final_quality: currentQuality,
      quality_improvement: previousQuality ? currentQuality - previousQuality : 0,
      reason: convergence.reason,
      status: convergence.status,
    });

    // Map convergence status to clarifier_status for backward compatibility (Fix 1.4)
    const convergenceStatus = convergence.status as "complete" | "max_rounds" | "confident";

    return { refinedGraph, previousQuality, convergenceStatus };
  }

  // Generate clarifier block if we should continue
  const ambiguities = detectAmbiguities(refinedGraph, input.brief, currentQuality);

  if (ambiguities.length === 0) {
    return { refinedGraph, previousQuality };
  }

  const candidates = await generateQuestionCandidates(
    ambiguities,
    refinedGraph,
    input.brief,
    conversationHistory,
    requestId
  );

  const best = selectBestQuestion(candidates, conversationHistory);

  if (!best) {
    return { refinedGraph, previousQuality };
  }

  // Cache the question
  const questionId = randomUUID();
  await cacheQuestion(questionId, {
    question: best.question,
    question_type: best.question_type,
    options: best.options,
    targets_ambiguity: best.targets_ambiguity,
    generated_at: new Date().toISOString(),
  }, config.cee.clarifierQuestionCacheTtlSeconds);

  emit(TelemetryEvents.CeeClarifierQuestionCached, {
    request_id: requestId,
    question_id: questionId,
    question_type: best.question_type,
  });

  emit(TelemetryEvents.CeeClarifierQuestionAsked, {
    request_id: requestId,
    round,
    question_id: questionId,
    question_type: best.question_type,
    targets_ambiguity: best.targets_ambiguity,
    information_gain: best.score / 10, // Normalize score to 0-1
  });

  const clarifier: CEEClarifierBlockV1 = {
    needs_clarification: true,
    round,
    question_id: questionId,
    question: best.question,
    question_type: best.question_type,
    options: best.options,
    metadata: {
      targets_ambiguity: best.targets_ambiguity,
      expected_improvement: Math.min(best.score, 10),
      convergence_confidence: convergence.confidence,
      information_gain: best.score / 10,
      // Enhancement 3.2: Expose convergence status/reason to clients
      convergence_status: "continue",
      convergence_reason: "continue",
    },
  };

  return { clarifier, refinedGraph, previousQuality };
}

function structuralWarningsEnabled(): boolean {
  return config.cee.draftStructuralWarningsEnabled;
}

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

  type CeeErrorDetails = Record<string, unknown> & {
    reason?: string;
    node_count?: number;
    edge_count?: number;
    missing_kinds?: string[];
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
    node_count: options.nodeCount,
    edge_count: options.edgeCount,
    missing_kinds: options.missingKinds,
    // Legacy fields
    trace: Object.keys(trace).length ? trace : undefined,
    details: baseDetails && Object.keys(baseDetails).length ? baseDetails : undefined,
  };

  return response;
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
    pipelineResult = await runCeeDraftPipeline(input, rawBody, requestId);
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
    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      latencyMs: Date.now() - start,
      status: isTimeout ? "timeout" : "error",
      errorCode: code,
      httpStatus: statusCode,
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
      logCeeCall({
        requestId,
        capability: "cee_draft_graph",
        latencyMs: Date.now() - start,
        status: "error",
        errorCode: "CEE_INTERNAL_ERROR",
        httpStatus: statusCode,
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
        case "BAD_INPUT": {
          const reason = (envelope.details as any)?.reason;
          // Empty draft graphs are treated as graph-level validation errors
          // so that CEE surfaces CEE_GRAPH_INVALID with reason "empty_graph".
          ceeCode = reason === "empty_graph" ? "CEE_GRAPH_INVALID" : "CEE_VALIDATION_FAILED";
          retryable = false;
          break;
        }
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
    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      latencyMs: Date.now() - start,
      status: ceeCode === "CEE_RATE_LIMIT" ? "limited" : "error",
      errorCode: ceeCode,
      httpStatus: statusCode,
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

  const { payload, cost_usd, provider, model, repro_mismatch, structural_meta } = pipelineResult as {
    payload: any;
    cost_usd: number;
    provider: string;
    model: string;
    repro_mismatch?: boolean;
    structural_meta?: StructuralMeta;
  };

  let graph = normaliseCeeGraphVersionAndProvenance(payload.graph as GraphV1 | undefined);

  // Run graph validation and auto-corrections (single goal, outcome beliefs, decision branches)
  // Uses checkSizeLimits: false since the pipeline already has size guards downstream
  const validationResult = validateAndFixGraph(graph, structural_meta, {
    checkSizeLimits: false, // Pipeline has existing size guards
  });

  // Emit telemetry for validation results
  const { fixes } = validationResult;
  emit(TelemetryEvents.CeeGraphValidation, {
    request_id: requestId,
    single_goal_applied: fixes.singleGoalApplied,
    original_goal_count: fixes.originalGoalCount,
    outcome_beliefs_filled: fixes.outcomeBeliefsFilled,
    decision_branches_normalized: fixes.decisionBranchesNormalized,
    warning_count: validationResult.warnings.length,
  });

  // Emit specific event if goals were merged
  if (fixes.singleGoalApplied && fixes.mergedGoalIds) {
    emit(TelemetryEvents.CeeGraphGoalsMerged, {
      request_id: requestId,
      original_goal_count: fixes.originalGoalCount,
      merged_goal_ids: fixes.mergedGoalIds,
    });
  }

  graph = validationResult.graph;
  if (graph) {
    payload.graph = graph as any;
  }
  const nodeCount = Array.isArray(graph?.nodes) ? graph!.nodes.length : 0;
  const edgeCount = Array.isArray(graph?.edges) ? graph!.edges.length : 0;

  // Hard invariant: a successful CEE draft response must include a non-empty graph
  if (!graph || nodeCount === 0) {
    const latencyMs = Date.now() - start;
    const ceeCode: CEEErrorCode = "CEE_GRAPH_INVALID";

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: latencyMs,
      error_code: ceeCode,
      http_status: 400,
      graph_nodes: nodeCount,
      graph_edges: edgeCount,
    });

    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      latencyMs,
      status: "error",
      errorCode: ceeCode,
      httpStatus: 400,
      anyTruncated: false,
      hasValidationIssues: true,
    });

    return {
      statusCode: 400,
      body: buildCeeErrorResponse(ceeCode, "Draft graph is empty; unable to construct model", {
        retryable: false,
        requestId,
        reason: "empty_graph",
        nodeCount,
        edgeCount,
        recovery: {
          suggestion: "Add more detail to your decision brief before drafting a model.",
          hints: [
            "State the specific decision you are trying to make (e.g., 'Should we X or Y?')",
            "List 2-3 concrete options you are considering.",
            "Describe what success looks like for this decision (key outcomes or KPIs).",
          ],
          example:
            "We need to decide whether to build the feature in-house or outsource it. Options are: hire contractors, use an agency, or build with the current team. Success means launching within 3 months under $50k.",
        },
      }),
    };
  }

  // Post-response guard: graph caps and cost (CEE must honour the same limits)
  const guardResult = (graph
    ? validateResponse(graph as any, cost_usd, COST_MAX_USD)
    : { ok: true }) as ReturnType<typeof validateResponse>;
  if (!guardResult.ok) {
    const violation = guardResult.violation;

    const ceeCode: CEEErrorCode =
      violation.code === "CAP_EXCEEDED" || violation.code === "INVALID_COST"
        ? "CEE_GRAPH_INVALID"
        : "CEE_VALIDATION_FAILED";

    const issue: CEEValidationIssue = createValidationIssue({
      code: violation.code,
      message: violation.message,
      details: violation.details as Record<string, unknown> | undefined,
      severityOverride: "error",
    });

    const latencyMs = Date.now() - start;

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: latencyMs,
      error_code: ceeCode,
      http_status: 400,
      graph_nodes: nodeCount,
      graph_edges: edgeCount,
    });
    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      latencyMs,
      status: "error",
      errorCode: ceeCode,
      anyTruncated: false,
      hasValidationIssues: true,
      httpStatus: 400,
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

  // Enforce minimum structure requirements for usable graphs.
  const structure = validateMinimumStructure(graph);
  if (!structure.valid) {
    const latencyMs = Date.now() - start;
    const ceeCode: CEEErrorCode = "CEE_GRAPH_INVALID";

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: latencyMs,
      error_code: ceeCode,
      http_status: 400,
      graph_nodes: nodeCount,
      graph_edges: edgeCount,
    });

    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      latencyMs,
      status: "error",
      errorCode: ceeCode,
      httpStatus: 400,
      anyTruncated: false,
      hasValidationIssues: true,
    });

    const missingList = structure.missing.join(", ");
    const message = structure.missing.length
      ? `Graph missing required elements: ${missingList}`
      : "Graph does not meet minimum structure requirements";

    return {
      statusCode: 400,
      body: buildCeeErrorResponse(ceeCode, message, {
        retryable: false,
        requestId,
        reason: "incomplete_structure",
        nodeCount,
        edgeCount,
        missingKinds: structure.missing,
        recovery: {
          suggestion:
            "Your description needs to specify the decision being made, the options being considered, and at least one goal.",
          hints: [
            "State what choice you're trying to make (the decision).",
            "List at least one alternative you're considering (options).",
            "Describe the goal or outcome you are trying to achieve.",
          ],
          example:
            "Should we hire a contractor or build in-house? Options: (1) Hire contractors, (2) Outsource to agency, (3) Build with current team.",
        },
        details: {
          missing_kinds: structure.missing,
          node_count: nodeCount,
          edge_count: edgeCount,
          counts: structure.counts,
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

  const validationIssues: CEEValidationIssue[] = [];

  const confidence: number = typeof payload.confidence === "number" ? payload.confidence : 0.7;
  const engineIssueCount = Array.isArray(payload.issues) ? payload.issues.length : 0;

  if (Array.isArray(payload.issues)) {
    for (const msg of payload.issues as string[]) {
      validationIssues.push(
        createValidationIssue({
          code: "ENGINE_VALIDATION_WARNING",
          message: msg,
          details: { scope: "engine_validate" },
          severityOverride: "warning",
        }),
      );
    }
  }

  if (repro_mismatch) {
    validationIssues.push(
      createValidationIssue({
        code: "CEE_REPRO_MISMATCH",
        message: "Engine reported a reproducibility mismatch for this graph and seed",
        details: { scope: "engine", hint: "response_hash_mismatch" },
        severityOverride: "warning",
      }),
    );
  }

  // Hook: engine degraded mode propagated via header (future engine integration)
  const degradedHeader = request.headers[SSE_DEGRADED_HEADER_NAME_LOWER] as string | undefined;
  if (degradedHeader) {
    trace.engine = {
      ...(trace.engine || {}),
      degraded: true,
    };
    validationIssues.push(
      createValidationIssue({
        code: "ENGINE_DEGRADED",
        message: "Engine reported degraded mode",
        details: { scope: "engine", source: "x-olumi-degraded", hint: degradedHeader },
        severityOverride: "warning",
      }),
    );
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
    graph,
    confidence,
    engineIssueCount,
    ceeIssues: validationIssues,
  });

  // Integrate multi-turn clarifier if enabled
  let clarifierResult: ClarifierIntegrationResult = {};
  if (clarifierEnabled()) {
    try {
      // Capture pre-clarifier graph for stability detection
      const preClarifierGraph = graph;

      clarifierResult = await integrateClarifier(
        input,
        graph,
        quality,
        requestId,
        preClarifierGraph // Pass previousGraph for stability rule
      );

      // If clarifier refined the graph, use the refined version and re-normalize
      if (clarifierResult.refinedGraph) {
        // Re-apply normalization to the refined graph (Fix 1.2)
        let refinedGraph = normaliseCeeGraphVersionAndProvenance(clarifierResult.refinedGraph);
        refinedGraph = normaliseDecisionBranchBeliefs(refinedGraph);

        if (refinedGraph) {
          graph = refinedGraph;
          if (payload.graph) {
            payload.graph = graph as any;
          }
        }
      }
    } catch (error) {
      // Log but don't fail the request if clarifier integration fails
      log.warn(
        { error, request_id: requestId },
        "Clarifier integration failed, continuing without clarification"
      );

      // Emit dedicated failure telemetry for ops visibility (W's suggestion)
      emit(TelemetryEvents.CeeClarifierFailed, {
        request_id: requestId,
        error_message: error instanceof Error ? error.message : String(error),
        error_type: error instanceof Error ? error.name : "unknown",
        graph_nodes: Array.isArray((graph as any).nodes) ? (graph as any).nodes.length : 0,
        graph_edges: Array.isArray((graph as any).edges) ? (graph as any).edges.length : 0,
        fallback_to_no_clarifier: true,
      });
    }
  }

  if (Array.isArray(payload.bias_findings)) {
    payload.bias_findings = sortBiasFindings(payload.bias_findings as any, input.seed);
  }

  const { cappedPayload, limits } = applyResponseCaps(payload);

  const anyTruncated = ceeAnyTruncated(limits);

  let draftWarnings: CEEStructuralWarningV1[] | undefined;
  let confidenceFlags: CEEConfidenceFlagsV1 | undefined;

  if (structuralWarningsEnabled()) {
    const structural = detectStructuralWarnings(
      graph,
      structural_meta,
    );

    if (structural.warnings.length > 0) {
      draftWarnings = structural.warnings;
    }

    const uncertain_nodes =
      structural.uncertainNodeIds.length > 0 ? structural.uncertainNodeIds : undefined;
    const simplificationApplied = Boolean(
      anyTruncated ||
        (structural_meta && (structural_meta.had_cycles || structural_meta.had_pruned_nodes)),
    );

    if (uncertain_nodes || simplificationApplied) {
      confidenceFlags = {
        ...(uncertain_nodes ? { uncertain_nodes } : {}),
        ...(simplificationApplied ? { simplification_applied: true } : {}),
      };
    }
  }

  const guidance = buildCeeGuidance({
    quality,
    validationIssues,
    limits,
  });

  // Determine clarifier_status for backward compatibility (Fix 1.4)
  // - If clarifier block present with needs_clarification: true → don't set clarifier_status
  // - If no clarifier block → set clarifier_status from convergence status (or "complete" as default)
  let clarifierStatus: "complete" | "max_rounds" | "confident" | undefined;
  if (!clarifierResult.clarifier) {
    clarifierStatus = clarifierResult.convergenceStatus ?? "complete";
  }

  const ceeResponse: CEEDraftGraphResponseV1 = {
    ...cappedPayload,
    trace,
    quality,
    validation_issues: validationIssues.length ? validationIssues : undefined,
    archetype,
    seed: input.seed,
    response_hash: cappedPayload.response_hash as string | undefined,
    response_limits: limits,
    draft_warnings: draftWarnings,
    confidence_flags: confidenceFlags,
    guidance,
    clarifier: clarifierResult.clarifier,
    // Backward compatibility: set clarifier_status when clarification is complete
    clarifier_status: clarifierStatus,
  };

  const draftWarningCount = Array.isArray(draftWarnings) ? draftWarnings.length : 0;
  const uncertainNodeCount =
    confidenceFlags && Array.isArray((confidenceFlags as any).uncertain_nodes)
      ? ((confidenceFlags as any).uncertain_nodes as string[]).length
      : 0;
  const simplificationAppliedFlag =
    Boolean(confidenceFlags && (confidenceFlags as any).simplification_applied === true);

  const latencyMs = Date.now() - start;
  const hasValidationIssues = validationIssues.length > 0;
  const engineDegraded = Boolean(trace.engine && (trace.engine as any).degraded);

  // Run the CEE verification pipeline as a final hard guard for successful
  // draft responses. This ensures the response conforms to the Zod schema and
  // attaches metadata-only verification information under trace.verification.
  let verifiedResponse: CEEDraftGraphResponseV1;
  try {
    const { response } = await verificationPipeline.verify(
      ceeResponse,
      CEEDraftGraphResponseV1Schema,
      {
        endpoint: "draft-graph",
        // Engine validation has already been enforced earlier in the pipeline
        // via validateClient and response guards.
        requiresEngineValidation: false,
        requestId,
      },
    );
    verifiedResponse = response as CEEDraftGraphResponseV1;
  } catch (error) {
    const message = error instanceof Error ? error.message || "verification failed" : "verification failed";

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: latencyMs,
      error_code: "CEE_INTERNAL_ERROR" as CEEErrorCode,
      http_status: 500,
    });

    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      latencyMs,
      status: "error",
      errorCode: "CEE_INTERNAL_ERROR",
      httpStatus: 500,
    });

    return {
      statusCode: 500,
      body: buildCeeErrorResponse("CEE_INTERNAL_ERROR", message, {
        retryable: false,
        requestId,
      }),
    };
  }

  emit(TelemetryEvents.CeeDraftGraphSucceeded, {
    request_id: requestId,
    latency_ms: latencyMs,
    quality_overall: quality.overall,
    graph_nodes: nodeCount,
    graph_edges: edgeCount,
    has_validation_issues: hasValidationIssues,
    any_truncated: anyTruncated,
    draft_warning_count: draftWarningCount,
    uncertain_node_count: uncertainNodeCount,
    simplification_applied: simplificationAppliedFlag,
    cost_usd: typeof cost_usd === "number" && Number.isFinite(cost_usd) ? cost_usd : 0,
    engine_provider: provider,
    engine_model: model,
  });

  logCeeCall({
    requestId,
    capability: "cee_draft_graph",
    provider,
    model,
    latencyMs,
    costUsd: cost_usd,
    status: engineDegraded || anyTruncated || hasValidationIssues ? "degraded" : "ok",
    anyTruncated,
    hasValidationIssues,
    httpStatus: 200,
  });

  return {
    statusCode: 200,
    body: verifiedResponse,
  };
}
