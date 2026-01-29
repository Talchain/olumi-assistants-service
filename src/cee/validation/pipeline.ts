import type { FastifyRequest } from "fastify";
import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import { runCeeDraftPipeline } from "../draft-pipeline-adapter.js";
import { SSE_DEGRADED_HEADER_NAME_LOWER } from "../../utils/degraded-mode.js";
import type { DraftGraphInputT } from "../../schemas/assist.js";
import { validateResponse } from "../../utils/responseGuards.js";
import { getRequestId } from "../../utils/request-id.js";
import { emit, log, TelemetryEvents } from "../../utils/telemetry.js";
import { isSchemaValidationError, calculateBackoffDelay, SCHEMA_VALIDATION_RETRY_CONFIG } from "../../utils/retry.js";
import { config, isProduction } from "../../config/index.js";
import { logCeeCall } from "../logging.js";
import { persistDraftFailureBundle } from "../draft-failures/store.js";
import { CEEDraftGraphResponseV1Schema } from "../../schemas/ceeResponses.js";
import { verificationPipeline } from "../verification/index.js";
import { createValidationIssue } from "./classifier.js";
import { computeQuality } from "../quality/index.js";
import { inferArchetype } from "../archetypes/index.js";
import { buildCeeGuidance, ceeAnyTruncated } from "../guidance/index.js";
import {
  CEE_BIAS_FINDINGS_MAX,
  CEE_OPTIONS_MAX,
  CEE_EVIDENCE_SUGGESTIONS_MAX,
  CEE_SENSITIVITY_SUGGESTIONS_MAX,
} from "../config/limits.js";
import { detectStructuralWarnings, detectUniformStrengths, normaliseDecisionBranchBeliefs, validateAndFixGraph, ensureGoalNode, hasGoalNode, wireOutcomesToGoal, type StructuralMeta } from "../structure/index.js";
import { sortBiasFindings } from "../bias/index.js";
import { enrichGraphWithFactorsAsync } from "../factor-extraction/enricher.js";
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
import { randomUUID, createHash } from "node:crypto";
import { buildLLMRawTrace, storeLLMOutput } from "../llm-output-store.js";
import { createCorrectionCollector } from "../corrections.js";
import { SERVICE_VERSION } from "../../version.js";
import {
  createObservabilityCollector,
  createNoOpObservabilityCollector,
  isObservabilityEnabled,
  isRawIOCaptureEnabled,
  type CEEObservability,
} from "../observability/index.js";

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
  raw_output?: boolean;
};

/**
 * Get cost cap from centralized config (deferred for testability)
 */
function getCostMaxUsd(): number {
  return config.graph.costMaxUsd;
}

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

function extractNodeKinds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as any;
  const nodes = Array.isArray(obj) ? obj : obj.nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes
    .map((n: any) => n?.kind ?? n?.type ?? "unknown")
    .filter(Boolean);
}

/**
 * Count nodes by kind for LLM observability trace.
 * Returns a Record<string, number> with counts for each node kind.
 */
function countNodeKinds(nodes: Array<{ kind?: string; type?: string }> | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!nodes || !Array.isArray(nodes)) return counts;
  for (const node of nodes) {
    const kind = (node.kind ?? node.type ?? "unknown") as string;
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

/**
 * Convert node kinds string array to counts object.
 * Used for backwards compatibility with existing node_kinds arrays.
 */
function nodeKindsArrayToCounts(kinds: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const kind of kinds) {
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return counts;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function truncatePreview(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function isUnsafeCaptureRequested(request: FastifyRequest): boolean {
  const query = (request.query as Record<string, unknown>) ?? {};
  const unsafeQuery = query.unsafe;
  const unsafeHeader = request.headers["x-olumi-unsafe"];
  return unsafeQuery === "1" || unsafeQuery === "true" || unsafeHeader === "1" || unsafeHeader === "true";
}

function isAdminAuthorized(request: FastifyRequest): boolean {
  const providedKey = request.headers["x-admin-key"] as string | undefined;
  if (!providedKey) return false;
  const adminKey = config.prompts?.adminApiKey;
  const adminKeyRead = config.prompts?.adminApiKeyRead;
  return Boolean((adminKey && providedKey === adminKey) || (adminKeyRead && providedKey === adminKeyRead));
}

type MinimumStructureResult = {
  valid: boolean;
  missing: string[];
  counts: Record<string, number>;
  /** Connectivity diagnostic - only populated if kind counts pass */
  connectivity?: ConnectivityDiagnostic;
  /** Whether connectivity check specifically failed (kinds present but not connected) */
  connectivity_failed?: boolean;
  /** Whether outcome OR risk requirement failed (needs at least one) */
  outcome_or_risk_missing?: boolean;
};

/**
 * Connectivity diagnostic result
 */
type ConnectivityDiagnostic = {
  passed: boolean;
  decision_ids: string[];
  reachable_options: string[];
  reachable_goals: string[];
  unreachable_nodes: string[];
  all_option_ids: string[];
  all_goal_ids: string[];
};

/**
 * Check if graph has connected minimum structure with diagnostic info.
 * Returns both pass/fail and detailed diagnostics for observability.
 */
function checkConnectedMinimumStructure(graph: GraphV1 | undefined): ConnectivityDiagnostic {
  const emptyDiagnostic: ConnectivityDiagnostic = {
    passed: false,
    decision_ids: [],
    reachable_options: [],
    reachable_goals: [],
    unreachable_nodes: [],
    all_option_ids: [],
    all_goal_ids: [],
  };

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray((graph as any).edges)) {
    return emptyDiagnostic;
  }

  const nodes = graph.nodes;
  const edges = (graph as any).edges as Array<{ from?: string; to?: string }>;

  const kinds = new Map<string, string>();
  const decisions: string[] = [];
  const options: string[] = [];
  const goals: string[] = [];
  const adjacency = new Map<string, Set<string>>();
  const allNodeIds: string[] = [];

  for (const node of nodes) {
    const id = typeof (node as any).id === "string" ? ((node as any).id as string) : undefined;
    const kind = node.kind as unknown as string | undefined;
    if (!id || !kind) {
      continue;
    }

    kinds.set(id, kind);
    allNodeIds.push(id);
    if (!adjacency.has(id)) {
      adjacency.set(id, new Set());
    }
    if (kind === "decision") {
      decisions.push(id);
    } else if (kind === "option") {
      options.push(id);
    } else if (kind === "goal") {
      goals.push(id);
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
    return {
      ...emptyDiagnostic,
      all_option_ids: options,
      all_goal_ids: goals,
      unreachable_nodes: [...options, ...goals],
    };
  }

  // Track all reachable nodes from any decision
  const allReachable = new Set<string>();
  let foundValidPath = false;

  for (const decisionId of decisions) {
    const visited = new Set<string>();
    const queue: string[] = [decisionId];
    let hasGoal = false;
    let hasOption = false;
    const reachableFromDecision = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      reachableFromDecision.add(current);
      allReachable.add(current);

      const kind = kinds.get(current);
      if (kind === "goal") {
        hasGoal = true;
      } else if (kind === "option") {
        hasOption = true;
      }

      if (hasGoal && hasOption) {
        foundValidPath = true;
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

  // Compute reachable options and goals
  const reachableOptions = options.filter(id => allReachable.has(id));
  const reachableGoals = goals.filter(id => allReachable.has(id));

  // Compute unreachable nodes (options and goals not reachable from any decision)
  const unreachableNodes = allNodeIds.filter(id => {
    const kind = kinds.get(id);
    // Only report options and goals as "unreachable" since they're the key targets
    return (kind === "option" || kind === "goal") && !allReachable.has(id);
  });

  return {
    passed: foundValidPath,
    decision_ids: decisions,
    reachable_options: reachableOptions,
    reachable_goals: reachableGoals,
    unreachable_nodes: unreachableNodes,
    all_option_ids: options,
    all_goal_ids: goals,
  };
}

/**
 * Simple boolean check for backward compatibility.
 */
function _hasConnectedMinimumStructure(graph: GraphV1 | undefined): boolean {
  return checkConnectedMinimumStructure(graph).passed;
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

  // Only check connectivity if kind counts pass
  if (!hasMinimumCounts) {
    return {
      valid: false,
      missing,
      counts,
    };
  }

  // Check outcome OR risk requirement (at least one must exist)
  // This check happens BEFORE connectivity to give a clearer error message.
  // Outcomes and risks are the bridges between factors and goal in the topology.
  const outcomeCount = counts["outcome"] ?? 0;
  const riskCount = counts["risk"] ?? 0;
  if (outcomeCount + riskCount === 0) {
    return {
      valid: false,
      missing: [], // All required kinds are present, but outcome/risk bridge is missing
      counts,
      outcome_or_risk_missing: true,
    };
  }

  // Get full connectivity diagnostic
  const connectivity = checkConnectedMinimumStructure(graph);
  const connectivityFailed = !connectivity.passed;

  return {
    valid: connectivity.passed,
    missing,
    counts,
    connectivity,
    connectivity_failed: connectivityFailed,
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
        // Normalize and validate refined graph BEFORE quality computation (W's suggestion)
        // This ensures convergence decisions use the same canonical representation as the final response
        // AND maintains all graph invariants (single goal, outcome beliefs, decision branches)
        let normalizedRefinedGraph = normaliseCeeGraphVersionAndProvenance(result.refined_graph);
        const refinedValidation = validateAndFixGraph(normalizedRefinedGraph, undefined, {
          checkSizeLimits: false, // Pipeline has existing size guards
          enforceSingleGoal: config.cee.enforceSingleGoal,
        });
        refinedGraph = refinedValidation.graph ?? result.refined_graph;

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
    node_count: options.nodeCount,
    edge_count: options.edgeCount,
    missing_kinds: options.missingKinds,
    // Legacy fields
    trace: Object.keys(trace).length ? trace : undefined,
    details: baseDetails && Object.keys(baseDetails).length ? baseDetails : undefined,
  };

  return response;
}

// Pipeline stage for trace
type PipelineStageEntry = {
  name: "llm_draft" | "coefficient_normalisation" | "node_validation" | "connectivity_check" | "goal_repair" | "edge_repair" | "edge_wiring" | "final_validation";
  status: "success" | "failed" | "skipped" | "success_with_repairs";
  duration_ms: number;
  details?: Record<string, unknown>;
};

// Risk coefficient correction record
type RiskCoefficientCorrection = {
  source: string;
  target: string;
  original: number;
  corrected: number;
};

// Transform record for pipeline observability
type TransformEntry = {
  stage: string;
  kind: "normalisation" | "repair";
  trigger: string;
  changes_summary: string;
  repair_attempted: boolean;
  repair_success: boolean;
  before_counts: Record<string, number>;
  after_counts: Record<string, number>;
  coefficients_modified?: Array<{
    edge_id: string;
    field: string;
    before: number;
    after: number;
    reason: string;
  }>;
  nodes_added_count?: number;
  nodes_removed_count?: number;
  edges_added_count?: number;
  edges_removed_count?: number;
};

// Validation summary for explicit missing_kinds reporting
type ValidationSummaryEntry = {
  status: "valid" | "invalid";
  required_kinds: string[];
  present_kinds: string[];
  missing_kinds: string[];
  message?: string;
  suggestion?: string;
};

/**
 * Normalise risk coefficients: risk→goal and risk→outcome edges should have negative strength_mean.
 * LLM sometimes generates positive coefficients for risks, which is semantically incorrect.
 * This follows the "trust but verify" pattern used by goal repair.
 */
export function normaliseRiskCoefficients(
  nodes: Array<{ id: string; kind?: string }>,
  edges: Array<{ from?: string; to?: string; strength_mean?: number; strength?: { mean?: number } }>
): { edges: typeof edges; corrections: RiskCoefficientCorrection[] } {
  const nodeKindMap = new Map(nodes.map(n => [n.id, n.kind?.toLowerCase()]));
  const corrections: RiskCoefficientCorrection[] = [];

  const normalisedEdges = edges.map(edge => {
    const sourceKind = nodeKindMap.get(edge.from ?? "");
    const targetKind = nodeKindMap.get(edge.to ?? "");

    // Only process risk→goal and risk→outcome edges
    if (sourceKind === "risk" && (targetKind === "goal" || targetKind === "outcome")) {
      // Get the current strength_mean (checking both flat and nested formats)
      const original = edge.strength_mean ?? edge.strength?.mean ?? 0.5;

      // If positive, make it negative (risks should have negative impact on goals/outcomes)
      if (original > 0) {
        const corrected = -Math.abs(original);
        corrections.push({
          source: edge.from ?? "",
          target: edge.to ?? "",
          original,
          corrected,
        });
        return { ...edge, strength_mean: corrected };
      }
    }
    return edge;
  });

  return { edges: normalisedEdges, corrections };
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

  // Pipeline stage timing for trace.pipeline
  const pipelineStages: PipelineStageEntry[] = [];
  let llmDraftStart = start;
  let llmCallCount = 0;

  const briefHash = sha256Hex(input.brief);
  const unsafeCaptureEnabled = isUnsafeCaptureRequested(request) && isAdminAuthorized(request);
  // Prefer adapter-reported raw node kinds when available.
  let nodeKindsRawJsonFromAdapter: string[] = [];
  let nodeKindsPostNormalisation: string[] = [];
  let nodeKindsPreValidation: string[] = [];
  let llmMeta: any | undefined;
  let failureBundleId: string | undefined;

  // Enhanced trace tracking for LLM observability
  const transforms: TransformEntry[] = [];
  let nodeCountsRaw: Record<string, number> = {};
  let nodeCountsNormalised: Record<string, number> = {};
  let nodeCountsValidated: Record<string, number> = {};
  let validationSummary: ValidationSummaryEntry | undefined;

  // Corrections collector for tracking all graph modifications
  const collector = createCorrectionCollector();

  // Observability collector for debug panel visibility
  // Enabled via CEE_OBSERVABILITY_ENABLED=true or include_debug=true in request
  const includeDebug = (input as any).include_debug === true;
  const observabilityEnabled = isObservabilityEnabled(includeDebug);
  const rawIOEnabled = isRawIOCaptureEnabled(includeDebug);
  const observabilityCollector = observabilityEnabled
    ? createObservabilityCollector({
        requestId,
        ceeVersion: SERVICE_VERSION,
        captureRawIO: rawIOEnabled,
      })
    : createNoOpObservabilityCollector(requestId);

  // Check for cache bypass via URL param (?supa=1) or header (X-CEE-Refresh-Prompt: true)
  // URL param is easier for frontend testing: https://staging--olumi.netlify.app/#/canvas?diag=1&supa=1
  const query = (request.query as Record<string, unknown>) ?? {};
  const supaQueryParam = query.supa === '1' || query.supa === 'true' || query.Supa === '1' || query.Supa === 'true';
  const refreshPromptsHeader = request.headers?.['x-cee-refresh-prompt'];
  const refreshPrompts = supaQueryParam || refreshPromptsHeader === '1' || refreshPromptsHeader === 'true';
  if (refreshPrompts) {
    log.info({ requestId, source: supaQueryParam ? 'url_param_supa' : 'header' }, 'Prompt cache bypass requested - will force fresh load from Supabase');
  }

  // Check for force default prompt via URL param (?default=1)
  // Useful for A/B testing store prompts vs hardcoded defaults
  const defaultQueryParam = query.default === '1' || query.default === 'true';
  if (defaultQueryParam) {
    log.info({ requestId }, 'Force default prompt requested via ?default=1 - will skip store lookup');
  }

  // Run pipeline with single retry for schema validation failures
  let pipelineResult: any;
  let lastError: Error | null = null;
  let schemaRetryAttempted = false;

  for (let attempt = 1; attempt <= SCHEMA_VALIDATION_RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      pipelineResult = await runCeeDraftPipeline(input, rawBody, requestId, { refreshPrompts, forceDefault: defaultQueryParam });
      lastError = null;
      break; // Success - exit retry loop
    } catch (error) {
      const err = error instanceof Error ? error : new Error("unexpected error");
      lastError = err;

      // Only retry on schema validation failures, and only once
      if (isSchemaValidationError(err) && attempt < SCHEMA_VALIDATION_RETRY_CONFIG.maxAttempts) {
        schemaRetryAttempted = true;
        const delay = calculateBackoffDelay(attempt, SCHEMA_VALIDATION_RETRY_CONFIG);

        log.warn({
          request_id: requestId,
          attempt,
          max_attempts: SCHEMA_VALIDATION_RETRY_CONFIG.maxAttempts,
          delay_ms: delay,
          error_message: err.message?.substring(0, 100),
          event: 'cee.schema_validation.retry',
        }, `Schema validation failed, retrying in ${delay}ms (attempt ${attempt}/${SCHEMA_VALIDATION_RETRY_CONFIG.maxAttempts})`);

        emit(TelemetryEvents.LlmRetry, {
          adapter: 'cee_pipeline',
          model: 'draft_graph',
          operation: 'schema_validation',
          attempt,
          max_attempts: SCHEMA_VALIDATION_RETRY_CONFIG.maxAttempts,
          delay_ms: delay,
          reason: 'schema_validation_failed',
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        continue; // Retry
      }

      // Not retryable or max attempts reached - break and handle error below
      break;
    }
  }

  // Handle error if pipeline failed
  if (lastError) {
    const err = lastError;
    const isTimeout = err.name === "UpstreamTimeoutError";
    const isSchemaValidationFailure = isSchemaValidationError(err);

    let statusCode: number;
    let code: CEEErrorCode;
    let retryable: boolean;

    if (isTimeout) {
      statusCode = 504;
      code = "CEE_TIMEOUT";
      retryable = true;
    } else if (isSchemaValidationFailure) {
      // LLM returned malformed JSON that failed Zod validation
      statusCode = 502; // Bad Gateway - upstream returned invalid response
      code = "CEE_LLM_VALIDATION_FAILED";
      retryable = false; // Already retried once, don't suggest client retry
    } else {
      statusCode = 500;
      code = "CEE_INTERNAL_ERROR";
      retryable = false;
    }

    // Determine stage from error context if available
    const stage = (err as any).stage || "llm_draft";

    // Emit exhausted event if we retried
    if (schemaRetryAttempted && isSchemaValidationFailure) {
      emit(TelemetryEvents.LlmRetryExhausted, {
        adapter: 'cee_pipeline',
        model: 'draft_graph',
        operation: 'schema_validation',
        total_attempts: SCHEMA_VALIDATION_RETRY_CONFIG.maxAttempts,
        error_message: err.message?.substring(0, 100) || 'unknown',
      });
    }

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: Date.now() - start,
      error_code: code,
      http_status: statusCode,
      stage,
      schema_retry_attempted: schemaRetryAttempted,
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
        retryable,
        requestId,
        stage,
      }),
    };
  }

  if (!pipelineResult || pipelineResult.kind === "error") {
    const envelope = pipelineResult?.envelope;
    const statusCode: number = pipelineResult?.statusCode ?? 500;
    // Extract stage from pipeline result if available
    const stage = pipelineResult?.stage || "pipeline";

    if (!envelope) {
      emit(TelemetryEvents.CeeDraftGraphFailed, {
        request_id: requestId,
        latency_ms: Date.now() - start,
        error_code: "CEE_INTERNAL_ERROR" as CEEErrorCode,
        http_status: statusCode,
        stage,
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
          stage,
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
      stage,
    });
    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      latencyMs: Date.now() - start,
      status: ceeCode === "CEE_RATE_LIMIT" ? "limited" : "error",
      errorCode: ceeCode,
      httpStatus: statusCode,
    });

    // Build minimal pipeline trace for early errors
    // At this point we may only have partial stage info, but it's better than nothing
    const earlyErrorPipelineTrace = {
      status: "failed" as const,
      total_duration_ms: Date.now() - start,
      stages: pipelineStages.length > 0 ? pipelineStages : [{
        name: "llm_draft" as const,
        status: "failed" as const,
        duration_ms: Date.now() - start,
      }],
    };

    return {
      statusCode,
      body: buildCeeErrorResponse(ceeCode, envelope.message, {
        retryable,
        requestId,
        details: envelope.details as Record<string, unknown> | undefined,
        stage,
        pipelineTrace: earlyErrorPipelineTrace,
      }),
    };
  }

  // LLM draft stage completed successfully
  const llmDraftEnd = Date.now();
  llmCallCount = schemaRetryAttempted ? 2 : 1; // Count retry if attempted
  pipelineStages.push({
    name: "llm_draft",
    status: "success",
    duration_ms: llmDraftEnd - llmDraftStart,
    details: schemaRetryAttempted ? { schema_retry_attempted: true } : undefined,
  });

  const { payload, cost_usd, provider, model, repro_mismatch, structural_meta, llm_meta } = pipelineResult as {
    payload: any;
    cost_usd: number;
    provider: string;
    model: string;
    repro_mismatch?: boolean;
    structural_meta?: StructuralMeta;
    llm_meta?: any;
  };

  llmMeta = llm_meta;
  nodeKindsRawJsonFromAdapter = Array.isArray(llmMeta?.node_kinds_raw_json) ? llmMeta.node_kinds_raw_json : [];
  // Compute raw node counts from adapter-reported kinds
  nodeCountsRaw = nodeKindsArrayToCounts(nodeKindsRawJsonFromAdapter);

  // Record LLM draft call for observability
  if (observabilityEnabled && llmMeta) {
    const tokenUsage = llmMeta.token_usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    observabilityCollector.recordLLMCall({
      step: "draft_graph",
      model: llmMeta.model ?? model ?? "unknown",
      provider: (provider === "anthropic" || provider === "openai") ? provider : "openai",
      tokens: {
        input: tokenUsage.prompt_tokens ?? 0,
        output: tokenUsage.completion_tokens ?? 0,
        total: tokenUsage.total_tokens ?? 0,
      },
      latency_ms: llmMeta.provider_latency_ms ?? (llmDraftEnd - llmDraftStart),
      attempt: schemaRetryAttempted ? 2 : 1,
      success: true,
      started_at: new Date(llmDraftStart).toISOString(),
      completed_at: new Date(llmDraftEnd).toISOString(),
      prompt_version: llmMeta.prompt_version,
      cache_hit: Boolean(llmMeta.cache_status === "fresh" || llmMeta.cache_read_input_tokens > 0),
      raw_prompt: rawIOEnabled ? llmMeta.raw_prompt : undefined,
      raw_response: rawIOEnabled ? llmMeta.raw_llm_text : undefined,
    });
  }

  // Store LLM output for admin retrieval (always store, but full output only accessible via admin endpoint)
  if (llmMeta?.raw_llm_text) {
    storeLLMOutput(requestId, llmMeta.raw_llm_text, payload.graph, {
      model: llmMeta.model ?? model,
      promptVersion: llmMeta.prompt_version,
    });
  }

  let graph = normaliseCeeGraphVersionAndProvenance(payload.graph as GraphV1 | undefined);

  // Node extraction (post-LLM parse) - safe
  nodeKindsPostNormalisation = extractNodeKinds(graph);
  // Compute normalized node counts (after version normalization)
  nodeCountsNormalised = countNodeKinds(graph?.nodes as any);

  // === RAW OUTPUT MODE ===
  // When raw_output: true, skip all post-processing (factor enrichment, goal repair, etc.)
  // and return LLM output directly after basic schema validation
  if (input.raw_output === true) {
    log.info({
      request_id: requestId,
      event: "cee.draft_graph.raw_output",
      node_count: Array.isArray(graph?.nodes) ? graph!.nodes.length : 0,
      edge_count: Array.isArray(graph?.edges) ? graph!.edges.length : 0,
    }, "Raw output mode: skipping post-processing repairs");

    emit(TelemetryEvents.CeeDraftGraphSucceeded, {
      request_id: requestId,
      latency_ms: Date.now() - start,
      quality_overall: 0, // Not computed in raw mode
      graph_nodes: Array.isArray(graph?.nodes) ? graph!.nodes.length : 0,
      graph_edges: Array.isArray(graph?.edges) ? graph!.edges.length : 0,
      has_validation_issues: false,
      any_truncated: false,
      draft_warning_count: 0,
      uncertain_node_count: 0,
      simplification_applied: false,
      cost_usd: typeof cost_usd === "number" && Number.isFinite(cost_usd) ? cost_usd : 0,
      engine_provider: provider,
      engine_model: model,
      raw_output_mode: true,
    });

    logCeeCall({
      requestId,
      capability: "cee_draft_graph",
      provider,
      model,
      latencyMs: Date.now() - start,
      costUsd: cost_usd,
      status: "ok",
      anyTruncated: false,
      hasValidationIssues: false,
      httpStatus: 200,
    });

    // Build minimal response with raw LLM output
    const rawResponse: CEEDraftGraphResponseV1 = {
      ...payload,
      trace: {
        request_id: requestId,
        correlation_id: requestId,
        engine: { provider, model, version: SERVICE_VERSION },
        pipeline: {
          status: "success",
          total_duration_ms: Date.now() - start,
          raw_output_mode: true,
          stages: [{
            name: "llm_draft",
            status: "success",
            duration_ms: Date.now() - start,
          }],
        },
      } as any,
      quality: { overall: 0, completeness: 0, coherence: 0, clarity: 0 },
      seed: input.seed,
    };

    // Add observability for raw-output mode
    if (observabilityEnabled) {
      observabilityCollector.setOrchestratorEnabled(true);
      observabilityCollector.recordOrchestratorStep({
        step: "llm_draft",
        executed: true,
        latency_ms: Date.now() - start,
        metadata: { raw_output_mode: true },
      });
      (rawResponse as any)._observability = observabilityCollector.build();
    }

    return {
      statusCode: 200,
      body: rawResponse,
    };
  }

  // === RISK COEFFICIENT NORMALISATION ===
  // LLM sometimes generates positive coefficients for risk→goal/outcome edges.
  // Normalise these to negative values (risks reduce goal attainment).
  // This follows the "trust but verify" pattern used by goal repair.
  let riskCoefficientCorrections: RiskCoefficientCorrection[] = [];
  if (graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
    const coeffNormStart = Date.now();
    const normResult = normaliseRiskCoefficients(graph.nodes as any[], graph.edges as any[]);
    const coeffNormEnd = Date.now();

    if (normResult.corrections.length > 0) {
      const beforeCounts = countNodeKinds(graph.nodes as any);
      graph = { ...graph, edges: normResult.edges as any };
      payload.graph = graph as any;
      riskCoefficientCorrections = normResult.corrections;
      const afterCounts = countNodeKinds(graph.nodes as any);

      log.info({
        request_id: requestId,
        corrections_count: normResult.corrections.length,
        corrections: normResult.corrections,
      }, `Pipeline stage: Coefficient normalisation complete, ${normResult.corrections.length} risk→goal/outcome edges corrected`);

      // Add transform entry for observability
      transforms.push({
        stage: "coefficient_normalisation",
        kind: "normalisation",
        trigger: `${normResult.corrections.length} edges had positive risk→goal/outcome coefficients`,
        changes_summary: `Corrected ${normResult.corrections.length} edge coefficients to negative values`,
        repair_attempted: true,
        repair_success: true,
        before_counts: beforeCounts,
        after_counts: afterCounts,
        coefficients_modified: normResult.corrections.map(c => ({
          edge_id: `${c.source}::${c.target}`,
          field: "strength_mean",
          before: c.original,
          after: c.corrected,
          reason: "risk edges should have negative impact on goals/outcomes",
        })),
      });
    }

    // Add coefficient_normalisation stage to pipeline trace
    pipelineStages.push({
      name: "coefficient_normalisation",
      status: normResult.corrections.length > 0 ? "success_with_repairs" : "success",
      duration_ms: coeffNormEnd - coeffNormStart,
      details: normResult.corrections.length > 0 ? {
        corrections_count: normResult.corrections.length,
        corrections: normResult.corrections,
      } : undefined,
    });
  }

  // === FACTOR ENRICHMENT: Extract quantitative factors from brief ===
  // This runs after LLM graph generation but before validation, matching the legacy endpoint's order.
  // Ensures factor nodes have value/baseline/unit data for ISL sensitivity analysis.
  // Uses LLM-first extraction when CEE_LLM_FIRST_EXTRACTION_ENABLED=true
  if (graph) {
    const enrichmentResult = await enrichGraphWithFactorsAsync(graph as any, input.brief, { collector });
    graph = enrichmentResult.graph as GraphV1;
    payload.graph = graph as any;

    if (enrichmentResult.factorsAdded > 0 || enrichmentResult.factorsEnhanced > 0) {
      log.debug(
        {
          request_id: requestId,
          factors_added: enrichmentResult.factorsAdded,
          factors_enhanced: enrichmentResult.factorsEnhanced,
          factors_skipped: enrichmentResult.factorsSkipped,
          extraction_mode: enrichmentResult.extractionMode,
          llm_success: enrichmentResult.llmSuccess,
        },
        "Factor enrichment applied to graph"
      );
    }
  }

  // Run graph validation and auto-corrections (single goal, outcome beliefs, decision branches)
  // Uses checkSizeLimits: false since the pipeline already has size guards downstream
  const nodeValidationStart = Date.now();
  const validationResult = validateAndFixGraph(graph, structural_meta, {
    checkSizeLimits: false, // Pipeline has existing size guards
    enforceSingleGoal: config.cee.enforceSingleGoal, // Configurable via CEE_ENFORCE_SINGLE_GOAL
  });
  const nodeValidationEnd = Date.now();

  // Emit telemetry for validation results
  const { fixes } = validationResult;

  // Determine node_validation stage status
  const nodeValidationStatus = fixes.singleGoalApplied || fixes.outcomeBeliefsFilled > 0 || fixes.decisionBranchesNormalized
    ? "success_with_repairs" as const
    : "success" as const;
  pipelineStages.push({
    name: "node_validation",
    status: nodeValidationStatus,
    duration_ms: nodeValidationEnd - nodeValidationStart,
    details: nodeValidationStatus === "success_with_repairs" ? {
      single_goal_applied: fixes.singleGoalApplied,
      outcome_beliefs_filled: fixes.outcomeBeliefsFilled,
      decision_branches_normalized: fixes.decisionBranchesNormalized,
    } : undefined,
  });
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

  // Node extraction (pre-validation) - safe
  nodeKindsPreValidation = extractNodeKinds(graph);
  // Track validated node counts (after node validation fixes)
  nodeCountsValidated = countNodeKinds(graph?.nodes as any);
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
      body: (() => {
        const errBody = buildCeeErrorResponse(ceeCode, "Draft graph is empty; unable to construct model", {
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
        pipelineTrace: {
          status: "failed",
          total_duration_ms: latencyMs,
          stages: pipelineStages,
        },
      });
        (errBody as any).trace = {
          ...((errBody as any).trace || {}),
          request_id: requestId,
          correlation_id: requestId,
          prompt_version: llmMeta?.prompt_version,
          prompt_hash: llmMeta?.prompt_hash,
          model: llmMeta?.model ?? model,
          temperature: llmMeta?.temperature,
          token_usage: llmMeta?.token_usage,
          finish_reason: llmMeta?.finish_reason,
          brief_hash: briefHash,
        };
        return errBody;
      })(),
    };
  }

  // Post-response guard: graph caps and cost (CEE must honour the same limits)
  const guardResult = (graph
    ? validateResponse(graph as any, cost_usd, getCostMaxUsd())
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
      body: (() => {
        const errBody = buildCeeErrorResponse(ceeCode, violation.message, {
        retryable: false,
        requestId,
        details: {
          guard_violation: violation,
          validation_issues: [issue],
        },
        pipelineTrace: {
          status: "failed",
          total_duration_ms: latencyMs,
          stages: pipelineStages,
        },
      });
        (errBody as any).trace = {
          ...((errBody as any).trace || {}),
          request_id: requestId,
          correlation_id: requestId,
          prompt_version: llmMeta?.prompt_version,
          prompt_hash: llmMeta?.prompt_hash,
          model: llmMeta?.model ?? model,
          temperature: llmMeta?.temperature,
          token_usage: llmMeta?.token_usage,
          finish_reason: llmMeta?.finish_reason,
          brief_hash: briefHash,
        };
        return errBody;
      })(),
    };
  }

  // === FAULT INJECTION (Dev/Test only) ===
  // Strip specified node kinds for deterministic testing of repair paths
  // Header: X-Debug-Force-Missing-Kinds: goal,decision (comma-separated)
  if (!isProduction() && graph) {
    const forceMissingHeader = request.headers["x-debug-force-missing-kinds"];
    if (typeof forceMissingHeader === "string" && forceMissingHeader.length > 0) {
      const kindsToStrip = forceMissingHeader.split(",").map(k => k.trim().toLowerCase());
      const originalNodeCount = graph.nodes.length;

      graph = {
        ...graph,
        nodes: graph.nodes.filter((n: any) => !kindsToStrip.includes(n.kind?.toLowerCase())),
      };
      payload.graph = graph as any;

      log.info({
        request_id: requestId,
        kinds_stripped: kindsToStrip,
        nodes_before: originalNodeCount,
        nodes_after: graph.nodes.length,
        event: "cee.fault_injection.applied",
      }, "Fault injection: stripped node kinds for testing");
    }
  }

  // Enforce minimum structure requirements for usable graphs.
  // If goal is missing, attempt deterministic repair before failing.
  const connectivityCheckStart = Date.now();
  let structure = validateMinimumStructure(graph);
  nodeKindsPreValidation = extractNodeKinds(graph);
  const connectivityCheckEnd = Date.now();
  let goalInferenceWarning: CEEStructuralWarningV1 | undefined;

  // Goal handling observability
  type GoalSource = "llm_generated" | "retry_generated" | "inferred" | "placeholder";
  let goalSource: GoalSource = "llm_generated";
  const originalMissingKinds = structure.valid ? [] : [...structure.missing];
  let goalNodeId: string | undefined;
  let goalRepairDurationMs = 0;
  let goalRepairPerformed = false;

  // Check if LLM generated goal
  const llmGeneratedGoal = hasGoalNode(graph);
  if (llmGeneratedGoal) {
    goalSource = "llm_generated";
  }

  if (!structure.valid && structure.missing.includes("goal")) {
    // Goal missing - attempt deterministic repair (no retry, just infer)
    const goalRepairStart = Date.now();
    const explicitGoal = Array.isArray(input.context?.goals) && input.context.goals.length > 0
      ? input.context.goals[0]
      : undefined;

    const goalResult = ensureGoalNode(graph!, input.brief, explicitGoal, collector);

    if (goalResult.goalAdded) {
      graph = goalResult.graph;
      payload.graph = graph as any;
      goalNodeId = goalResult.goalNodeId;
      goalRepairPerformed = true;

      // Re-validate after goal addition
      structure = validateMinimumStructure(graph);
      goalRepairDurationMs = Date.now() - goalRepairStart;

      // Determine goal source based on how it was obtained
      if (goalResult.inferredFrom === "explicit") {
        // Explicit from context.goals - treat as llm_generated equivalent
        goalSource = "llm_generated";
      } else if (goalResult.inferredFrom === "brief") {
        goalSource = "inferred";
      } else {
        goalSource = "placeholder";
      }

      // Only add warning if goal was inferred (not explicit from context.goals)
      if (goalResult.inferredFrom !== "explicit") {
        goalInferenceWarning = {
          id: "goal_inferred",
          severity: "medium",
          node_ids: goalResult.goalNodeId ? [goalResult.goalNodeId] : [],
          edge_ids: [],
          explanation: goalResult.inferredFrom === "brief"
            ? "Goal was inferred from your description. Review to ensure it captures your intended objective."
            : "A placeholder goal was added because one could not be inferred. Please update it to reflect your actual objective.",
        } as CEEStructuralWarningV1;

        emit(TelemetryEvents.CeeGoalInferred, {
          request_id: requestId,
          inferred_from: goalResult.inferredFrom,
          goal_node_id: goalResult.goalNodeId,
          goal_source: goalSource,
        });
      }

      log.info({
        request_id: requestId,
        goal_added: true,
        inferred_from: goalResult.inferredFrom,
        goal_node_id: goalResult.goalNodeId,
        goal_source: goalSource,
      }, "Goal node added to graph via inference");
    }
  }

  // === EDGE REPAIR: Wire outcomes/risks to goal when connectivity fails ===
  // LLM sometimes generates goal node but forgets to connect outcomes/risks to it.
  // This causes connectivity check to fail with "goal unreachable".
  // Fix by programmatically adding missing outcome→goal and risk→goal edges.
  let edgeRepairCalled = false;
  let edgeRepairCandidatesFound = 0;
  let edgeRepairDurationMs = 0;
  let edgesAddedByRepair = 0;
  let edgeRepairNoopReason: string | undefined;

  // Check if connectivity failed due to unreachable goal
  const goalExistsButUnreachable =
    !structure.valid &&
    structure.connectivity_failed &&
    structure.connectivity?.reachable_goals?.length === 0 &&
    hasGoalNode(graph);

  if (goalExistsButUnreachable && graph) {
    const edgeRepairStart = Date.now();
    edgeRepairCalled = true;

    // Find the goal node ID
    const goalNode = graph.nodes.find((n: any) => n.kind === "goal");
    const foundGoalId = goalNode?.id as string | undefined;

    if (foundGoalId) {
      // Count candidates (outcome/risk nodes) before wiring
      edgeRepairCandidatesFound = (graph.nodes as any[]).filter(
        (n: any) => n.kind === "outcome" || n.kind === "risk"
      ).length;

      const edgeCountBefore = graph.edges?.length ?? 0;

      // Wire outcomes and risks to the goal
      graph = wireOutcomesToGoal(graph, foundGoalId, collector);
      payload.graph = graph as any;

      const edgeCountAfter = graph.edges?.length ?? 0;
      edgesAddedByRepair = edgeCountAfter - edgeCountBefore;
      edgeRepairDurationMs = Date.now() - edgeRepairStart;

      if (edgesAddedByRepair > 0) {
        // Re-validate after edge repair
        structure = validateMinimumStructure(graph);

        log.info({
          request_id: requestId,
          edges_added: edgesAddedByRepair,
          candidates_found: edgeRepairCandidatesFound,
          goal_node_id: foundGoalId,
          connectivity_passed_after_repair: structure.connectivity?.passed,
        }, "Edge repair: wired outcomes/risks to goal");
      } else if (edgeRepairCandidatesFound === 0) {
        edgeRepairNoopReason = "no_outcome_or_risk_nodes";
        log.info({
          request_id: requestId,
          candidates_found: 0,
          goal_node_id: foundGoalId,
        }, "Edge repair: no outcome/risk nodes to wire");
      } else {
        edgeRepairNoopReason = "all_candidates_already_wired";
      }
    } else {
      // Goal node exists (per hasGoalNode check) but has no valid ID
      edgeRepairNoopReason = "goal_node_missing_id";
      edgeRepairDurationMs = Date.now() - edgeRepairStart;
      log.warn({
        request_id: requestId,
        goal_node_present: !!goalNode,
      }, "Edge repair: goal node exists but has no ID");
    }
  }

  // Build goal_handling trace object
  const goalHandling = {
    goal_source: goalSource,
    retry_attempted: false, // No LLM retry in current implementation
    original_missing_kinds: originalMissingKinds.length > 0 ? originalMissingKinds : undefined,
    ...(goalNodeId && { goal_node_id: goalNodeId }),
  };

  // Add connectivity_check stage
  const connectivityPassed = structure.valid || (structure.connectivity?.passed ?? false);
  pipelineStages.push({
    name: "connectivity_check",
    status: connectivityPassed ? "success" : "failed",
    duration_ms: connectivityCheckEnd - connectivityCheckStart,
    details: structure.connectivity ? {
      decision_count: structure.connectivity.decision_ids.length,
      reachable_options: structure.connectivity.reachable_options.length,
      reachable_goals: structure.connectivity.reachable_goals.length,
      unreachable_count: structure.connectivity.unreachable_nodes.length,
    } : undefined,
  });

  // Add goal_repair stage if it was attempted
  if (goalRepairPerformed) {
    pipelineStages.push({
      name: "goal_repair",
      status: structure.valid ? "success_with_repairs" : "failed",
      duration_ms: goalRepairDurationMs,
      details: {
        goal_source: goalSource,
        goal_node_id: goalNodeId,
      },
    });
  } else if (originalMissingKinds.includes("goal")) {
    // Goal was missing but repair wasn't performed (shouldn't happen, but track it)
    pipelineStages.push({
      name: "goal_repair",
      status: "skipped",
      duration_ms: 0,
    });
  }

  // Add edge_repair stage if it was called (regardless of whether edges were added)
  if (edgeRepairCalled) {
    pipelineStages.push({
      name: "edge_repair",
      status: edgesAddedByRepair > 0 ? (structure.valid ? "success_with_repairs" : "failed") : "skipped",
      duration_ms: edgeRepairDurationMs,
      details: {
        called: true,
        candidates_found: edgeRepairCandidatesFound,
        edges_added: edgesAddedByRepair,
        ...(edgeRepairNoopReason && { noop_reason: edgeRepairNoopReason }),
        repair_reason: "goal_unreachable",
        connectivity_restored: edgesAddedByRepair > 0 && (structure.connectivity?.passed ?? false),
      },
    });
  }

  // Emit connectivity check telemetry with counts and failure classification
  if (structure.connectivity) {
    // Compute failure_class for alerting and dashboarding
    const reachableOptionCount = structure.connectivity.reachable_options.length;
    const reachableGoalCount = structure.connectivity.reachable_goals.length;
    const connectivityPassed = structure.connectivity.passed;

    let failureClass: "none" | "no_path_to_options" | "no_path_to_goal" | "neither_reachable" | "partial";
    if (connectivityPassed) {
      failureClass = "none";
    } else if (reachableOptionCount === 0 && reachableGoalCount === 0) {
      failureClass = "neither_reachable";
    } else if (reachableOptionCount === 0) {
      failureClass = "no_path_to_options";
    } else if (reachableGoalCount === 0) {
      failureClass = "no_path_to_goal";
    } else {
      failureClass = "partial";
    }

    emit(TelemetryEvents.CeeConnectivityCheck, {
      request_id: requestId,
      // Counts only (avoid high-cardinality arrays in telemetry)
      decision_count: structure.connectivity.decision_ids.length,
      option_count: structure.connectivity.all_option_ids.length,
      goal_count: structure.connectivity.all_goal_ids.length,
      reachable_option_count: reachableOptionCount,
      reachable_goal_count: reachableGoalCount,
      unreachable_count: structure.connectivity.unreachable_nodes.length,
      edges_in_graph: edgeCount,
      // Classification for alerting
      connectivity_passed: connectivityPassed,
      failure_class: failureClass,
      all_kinds_present: structure.missing.length === 0,
      repair_called: edgeRepairCalled,
      repair_candidates_found: edgeRepairCandidatesFound,
      repair_succeeded: edgesAddedByRepair > 0 && (structure.connectivity?.passed ?? false),
      edges_added_by_repair: edgeRepairCalled ? edgesAddedByRepair : undefined,
      repair_noop_reason: edgeRepairNoopReason,
    });
  }

  if (!structure.valid) {
    const latencyMs = Date.now() - start;

    // Build validation_summary for LLM observability trace
    const requiredKinds = Object.keys(MINIMUM_STRUCTURE_REQUIREMENT);
    const presentKinds = Object.keys(structure.counts).filter(k => (structure.counts[k] ?? 0) > 0);
    validationSummary = {
      status: "invalid",
      required_kinds: requiredKinds,
      present_kinds: presentKinds,
      missing_kinds: structure.missing,
      message: structure.outcome_or_risk_missing
        ? "Graph missing required outcome or risk nodes"
        : structure.connectivity_failed
          ? "Graph has all required node types but they are not connected via edges"
          : `Graph missing required elements: ${structure.missing.join(", ")}`,
      suggestion: structure.outcome_or_risk_missing
        ? "Add at least one outcome or risk node to connect factors to your goal"
        : structure.connectivity_failed
          ? "Ensure there is a path from decision through options to outcomes/risks and finally to goal"
          : `Add at least ${structure.missing.map(k => `1 ${k} node`).join(", ")}`,
    };

    // Determine failure type: outcome/risk missing takes precedence over connectivity
    const isOutcomeOrRiskMissing = structure.outcome_or_risk_missing === true;
    const isConnectivityFailure = !isOutcomeOrRiskMissing && structure.connectivity_failed && structure.missing.length === 0;

    // Use distinct error code for connectivity failures (clients should branch on `code`)
    // outcome/risk missing uses CEE_GRAPH_INVALID since it's a structural requirement
    const ceeCode: CEEErrorCode = isConnectivityFailure
      ? "CEE_GRAPH_CONNECTIVITY_FAILED"
      : "CEE_GRAPH_INVALID";

    // Extract observability fields for error diagnosis
    // Use adapter-reported raw node kinds (from LLM output BEFORE normalisation)
    // Fallback to graph extraction only if adapter didn't provide raw kinds
    const rawNodeKinds = nodeKindsRawJsonFromAdapter.length > 0
      ? nodeKindsRawJsonFromAdapter
      : (Array.isArray(graph?.nodes)
          ? (graph!.nodes as any[]).map((n: any) => n?.kind).filter(Boolean)
          : []);
    // Count nodes with labels for observability (avoid PII in telemetry)
    const labeledNodeCount = Array.isArray(graph?.nodes)
      ? (graph!.nodes as any[]).filter((n: any) => typeof n?.label === "string" && n.label.length > 0).length
      : 0;

    // Compute unreachable_kinds for telemetry (deduplicated list of kinds)
    let unreachableKindsTelemetry: string[] = [];
    if (isConnectivityFailure && graph && Array.isArray(graph.nodes) && structure.connectivity) {
      const unreachableSet = new Set(structure.connectivity.unreachable_nodes);
      const kindsSet = new Set<string>();
      for (const node of graph.nodes as any[]) {
        if (unreachableSet.has(node.id) && node.kind) {
          kindsSet.add(node.kind);
        }
      }
      unreachableKindsTelemetry = Array.from(kindsSet);
    }

    emit(TelemetryEvents.CeeDraftGraphFailed, {
      request_id: requestId,
      latency_ms: latencyMs,
      error_code: ceeCode,
      http_status: 400,
      graph_nodes: nodeCount,
      graph_edges: edgeCount,
      missing_kinds: structure.missing,
      raw_node_kinds: rawNodeKinds,
      connectivity_failed: isConnectivityFailure,
      outcome_or_risk_missing: isOutcomeOrRiskMissing,
      // Use count instead of array for node IDs to avoid high-cardinality telemetry
      unreachable_node_count: structure.connectivity?.unreachable_nodes?.length ?? 0,
      // Additional connectivity diagnostics (kinds are low-cardinality, safe for telemetry)
      all_kinds_present: isConnectivityFailure && structure.missing.length === 0,
      unreachable_kinds: unreachableKindsTelemetry,
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

    // Use different message and reason based on failure type
    let message: string;
    let reason: string;

    if (isOutcomeOrRiskMissing) {
      message = "Your model needs at least one outcome or risk to connect factors to your goal";
      reason = "missing_outcome_or_risk";
    } else if (isConnectivityFailure) {
      message = "Graph has all required node types but they are not connected via edges";
      reason = "connectivity_failed";
    } else if (structure.missing.length) {
      message = `Graph missing required elements: ${structure.missing.join(", ")}`;
      reason = "incomplete_structure";
    } else {
      message = "Graph does not meet minimum structure requirements";
      reason = "incomplete_structure";
    }

    // Build conditional hint based on actual diagnostic counts
    const reachableOptionCount = structure.connectivity?.reachable_options.length ?? 0;
    const reachableGoalCount = structure.connectivity?.reachable_goals.length ?? 0;

    let connectivityHint: string;
    if (reachableOptionCount === 0 && reachableGoalCount === 0) {
      connectivityHint = "Neither options nor goal are reachable from decision via edges";
    } else if (reachableOptionCount === 0) {
      connectivityHint = "No option is reachable from decision via edges";
    } else if (reachableGoalCount === 0) {
      connectivityHint = "Options are reachable but goal is not connected to the causal chain";
    } else {
      connectivityHint = "Graph has partial connectivity — some nodes are unreachable";
    }

    // Build recovery guidance based on failure type
    let recovery: { suggestion: string; hints: string[]; example?: string };

    if (isOutcomeOrRiskMissing) {
      recovery = {
        suggestion: "Your model needs outcomes or risks to connect factors to your goal. These describe what success or failure looks like.",
        hints: [
          "Try adding: 'Success would mean...' or 'The desired outcome is...'",
          "Try adding: 'The main risk is...' or 'What could go wrong is...'",
          "Outcomes and risks bridge factors to goals in the causal chain.",
        ],
        example:
          "Should we raise prices? Success would mean higher revenue. The risk is customer churn.",
      };
    } else if (isConnectivityFailure) {
      recovery = {
        suggestion: "The graph has all required node types but they are not connected. Ensure outcomes and risks connect to the goal node.",
        hints: [
          "Check that outcome nodes have edges leading to the goal node.",
          "Check that risk nodes have edges leading to the goal node.",
          "Ensure there is a path from the decision through options to outcomes/risks and finally to the goal.",
        ],
        example:
          "Edges should flow: decision → options → factors → outcomes/risks → goal",
      };
    } else {
      recovery = {
        suggestion:
          "Your description needs to specify the decision being made, the options being considered, and at least one goal.",
        hints: [
          "State what choice you're trying to make (the decision).",
          "List at least one alternative you're considering (options).",
          "Describe the goal or outcome you are trying to achieve.",
        ],
        example:
          "Should we hire a contractor or build in-house? Options: (1) Hire contractors, (2) Outsource to agency, (3) Build with current team.",
      };
    }

    // Build details including connectivity diagnostic when available
    // Note: Use counts only for labels to avoid PII in error responses
    const details: Record<string, unknown> = {
      missing_kinds: structure.missing,
      node_count: nodeCount,
      edge_count: edgeCount,
      counts: structure.counts,
      raw_node_kinds: rawNodeKinds,
      labeled_node_count: labeledNodeCount,
      has_labels: labeledNodeCount > 0,
    };

    // Add connectivity diagnostic for connectivity failures (counts only, no PII)
    if (isConnectivityFailure && structure.connectivity) {
      // Compute unreachable_kinds from unreachable nodes (for debugging without PII)
      const unreachableKinds: string[] = [];
      if (graph && Array.isArray(graph.nodes)) {
        const unreachableSet = new Set(structure.connectivity.unreachable_nodes);
        for (const node of graph.nodes as any[]) {
          if (unreachableSet.has(node.id) && node.kind && !unreachableKinds.includes(node.kind)) {
            unreachableKinds.push(node.kind);
          }
        }
      }

      // Enhanced observability: identify which outcome/risk nodes exist and their goal edges
      const outcomeNodes: string[] = [];
      const riskNodes: string[] = [];
      const goalNodes: string[] = [];
      const nodesWithGoalEdges: string[] = [];
      const nodesMissingGoalEdges: string[] = [];

      if (graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
        // Collect nodes by kind
        for (const node of graph.nodes as any[]) {
          if (node.kind === "outcome") outcomeNodes.push(node.id);
          else if (node.kind === "risk") riskNodes.push(node.id);
          else if (node.kind === "goal") goalNodes.push(node.id);
        }

        // Find which outcomes/risks have edges to goal
        const goalSet = new Set(goalNodes);
        for (const edge of graph.edges as any[]) {
          if (goalSet.has(edge.to) && (outcomeNodes.includes(edge.from) || riskNodes.includes(edge.from))) {
            if (!nodesWithGoalEdges.includes(edge.from)) {
              nodesWithGoalEdges.push(edge.from);
            }
          }
        }

        // Find which outcomes/risks are missing goal edges
        for (const nodeId of [...outcomeNodes, ...riskNodes]) {
          if (!nodesWithGoalEdges.includes(nodeId)) {
            nodesMissingGoalEdges.push(nodeId);
          }
        }
      }

      details.connectivity_failed = true;
      details.all_kinds_present = structure.missing.length === 0;
      details.unreachable_kinds = unreachableKinds;
      details.connectivity = {
        decision_count: structure.connectivity.decision_ids.length,
        reachable_option_count: structure.connectivity.reachable_options.length,
        reachable_goal_count: structure.connectivity.reachable_goals.length,
        unreachable_count: structure.connectivity.unreachable_nodes.length,
      };

      // Part 3 Observability: detailed breakdown of goal wiring
      details.goal_wiring = {
        outcome_nodes_found: outcomeNodes.length,
        risk_nodes_found: riskNodes.length,
        goal_nodes_found: goalNodes.length,
        nodes_with_goal_edges: nodesWithGoalEdges.length,
        nodes_missing_goal_edges: nodesMissingGoalEdges.length,
        missing_edge_sources: nodesMissingGoalEdges, // Which nodes need edges to goal
      };

      // Edge repair status with improved semantics
      details.edge_repair = {
        called: edgeRepairCalled,
        candidates_found: edgeRepairCandidatesFound,
        edges_added: edgesAddedByRepair,
        ...(edgeRepairNoopReason && { noop_reason: edgeRepairNoopReason }),
        connectivity_restored: edgesAddedByRepair > 0 && (structure.connectivity?.passed ?? false),
      };

      // Use conditional hint based on diagnostic counts
      details.hint = connectivityHint;
    }

    // Build llm_raw trace for error response (storeLLMOutput is idempotent)
    const errorLlmRawTrace = llmMeta?.raw_llm_text
      ? buildLLMRawTrace(requestId, llmMeta.raw_llm_text, payload.graph, {
          model: llmMeta.model ?? model,
          promptVersion: llmMeta.prompt_version,
          storeOutput: true, // Idempotent - won't re-store if already stored
        })
      : undefined;

    // Build pipeline trace for error response (shows stages completed before failure)
    const errorPipelineTrace = {
      status: "failed" as const,
      total_duration_ms: latencyMs,
      stages: pipelineStages,
      llm_quality: riskCoefficientCorrections.length > 0 ? {
        risk_coefficient_corrections: riskCoefficientCorrections.length,
        corrections: riskCoefficientCorrections,
      } : undefined,
      // Enhanced LLM metadata for observability
      llm_metadata: llmMeta ? {
        model: llmMeta.model ?? model,
        prompt_version: llmMeta.prompt_version,
        prompt_hash: llmMeta.prompt_hash,
        duration_ms: llmMeta.provider_latency_ms,
        finish_reason: llmMeta.finish_reason,
        response_chars: llmMeta.raw_llm_text?.length,
        token_usage: llmMeta.token_usage,
        temperature: llmMeta.temperature,
        max_tokens: llmMeta.max_tokens,
        seed: llmMeta.seed,
        reasoning_effort: llmMeta.reasoning_effort,
        // Prompt cache diagnostics for debugging multi-instance issues
        instance_id: llmMeta.instance_id,
        cache_age_ms: llmMeta.cache_age_ms,
        cache_status: llmMeta.cache_status,
        use_staging_mode: llmMeta.use_staging_mode,
      } : {
        model,
      },
      // Node extraction counts at each pipeline stage
      node_extraction: {
        raw: nodeCountsRaw,
        normalised: nodeCountsNormalised,
        validated: nodeCountsValidated,
      },
      // Validation summary with explicit missing_kinds
      validation_summary: validationSummary,
      // Transforms applied during pipeline
      transforms: transforms.length > 0 ? transforms : undefined,
      // LLM raw output preview
      llm_raw: errorLlmRawTrace,
    } as any;

    // Best-effort persistence of failure bundle (bounded await; never blocks response)
    try {
      const persistResult = await persistDraftFailureBundle({
        requestId,
        correlationId: requestId,
        briefHash,
        briefPreview: unsafeCaptureEnabled ? truncatePreview(input.brief, 500) : undefined,
        brief: unsafeCaptureEnabled ? input.brief : undefined,
        rawLLMOutput: unsafeCaptureEnabled ? llmMeta?.raw_llm_json : undefined,
        rawLLMText: unsafeCaptureEnabled ? llmMeta?.raw_llm_text : undefined,
        validationError: message,
        statusCode: 400,
        missingKinds: structure.missing,
        nodeKindsRawJson: nodeKindsRawJsonFromAdapter,
        nodeKindsPostNormalisation: nodeKindsPostNormalisation,
        nodeKindsPreValidation: nodeKindsPreValidation,
        promptVersion: llmMeta?.prompt_version,
        promptHash: llmMeta?.prompt_hash,
        model: llmMeta?.model ?? model,
        temperature: llmMeta?.temperature,
        tokenUsage: llmMeta?.token_usage,
        finishReason: llmMeta?.finish_reason,
        llmDurationMs: (pipelineStages.find(s => s.name === 'llm_draft')?.duration_ms) as any,
        totalDurationMs: latencyMs,
        unsafeCaptureEnabled,
      });
      failureBundleId = persistResult.failureBundleId;
      if (failureBundleId) {
        errorPipelineTrace.failure_bundle_id = failureBundleId;
      }
    } catch {
      // non-fatal
    }

    return {
      statusCode: 400,
      body: (() => {
        const errBody = buildCeeErrorResponse(ceeCode, message, {
        retryable: false,
        requestId,
        reason,
        nodeCount,
        edgeCount,
        missingKinds: structure.missing,
        recovery,
        details,
        pipelineTrace: errorPipelineTrace,
      });
        (errBody as any).trace = {
          ...((errBody as any).trace || {}),
          request_id: requestId,
          correlation_id: requestId,
          prompt_version: llmMeta?.prompt_version,
          prompt_hash: llmMeta?.prompt_hash,
          model: llmMeta?.model ?? model,
          temperature: llmMeta?.temperature,
          token_usage: llmMeta?.token_usage,
          finish_reason: llmMeta?.finish_reason,
          brief_hash: briefHash,
        };
        return errBody;
      })(),
    };
  }

  const trace: CEETraceMeta = {
    request_id: requestId,
    correlation_id: requestId,
    engine: {
      provider,
      model,
      version: SERVICE_VERSION,
    },
    ...(llmMeta ? {
      prompt_version: llmMeta.prompt_version,
      prompt_hash: llmMeta.prompt_hash,
      model: llmMeta.model ?? model,
      temperature: llmMeta.temperature,
      token_usage: llmMeta.token_usage,
      finish_reason: llmMeta.finish_reason,
      brief_hash: briefHash,
    } : { brief_hash: briefHash }),
    // Goal handling observability
    goal_handling: goalHandling as any,
  } as any;

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

  // Detect uniform edge strengths (LLM output quality check)
  const uniformStrengthResult = detectUniformStrengths(graph);
  if (uniformStrengthResult.detected) {
    emit(TelemetryEvents.CeeUniformStrengthsDetected, {
      request_id: requestId,
      total_edges: uniformStrengthResult.totalEdges,
      default_strength_count: uniformStrengthResult.defaultStrengthCount,
      default_strength_percentage: uniformStrengthResult.defaultStrengthPercentage,
      // Additional context for diagnosis
      model,
      provider,
    });

    // Append warning to draft_warnings
    if (uniformStrengthResult.warning) {
      if (!draftWarnings) {
        draftWarnings = [];
      }
      draftWarnings.push(uniformStrengthResult.warning);
    }
  }

  // Add goal inference warning if present
  if (goalInferenceWarning) {
    if (!draftWarnings) {
      draftWarnings = [];
    }
    draftWarnings.push(goalInferenceWarning);
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
  const finalValidationStart = Date.now();
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
    const finalValidationEnd = Date.now();

    // Add final_validation stage
    pipelineStages.push({
      name: "final_validation",
      status: "success",
      duration_ms: finalValidationEnd - finalValidationStart,
    });

    // Build pipeline trace and add to response
    const totalDurationMs = finalValidationEnd - start;
    const pipelineStatus = pipelineStages.some(s => s.status === "failed")
      ? "failed" as const
      : pipelineStages.some(s => s.status === "success_with_repairs")
        ? "success_with_repairs" as const
        : "success" as const;

    // Build connectivity diagnostic for pipeline trace
    const connectivityDiagnostic = structure.connectivity ? {
      checked: true,
      passed: structure.connectivity.passed,
      decision_ids: structure.connectivity.decision_ids,
      reachable_options: structure.connectivity.reachable_options,
      reachable_goals: structure.connectivity.reachable_goals,
      unreachable_nodes: structure.connectivity.unreachable_nodes,
    } : {
      checked: false,
      passed: false,
      decision_ids: [],
      reachable_options: [],
      reachable_goals: [],
      unreachable_nodes: [],
    };

    // Build validation_summary for success case
    const requiredKinds = Object.keys(MINIMUM_STRUCTURE_REQUIREMENT);
    const presentKinds = Object.keys(structure.counts).filter(k => (structure.counts[k] ?? 0) > 0);
    validationSummary = {
      status: "valid",
      required_kinds: requiredKinds,
      present_kinds: presentKinds,
      missing_kinds: [],
    };

    // Build llm_raw trace with preview pattern (storeLLMOutput is idempotent)
    const llmRawTrace = llmMeta?.raw_llm_text
      ? buildLLMRawTrace(requestId, llmMeta.raw_llm_text, payload.graph, {
          model: llmMeta.model ?? model,
          promptVersion: llmMeta.prompt_version,
          storeOutput: true, // Idempotent - won't re-store if already stored
        })
      : undefined;

    const pipelineTrace: Record<string, unknown> = {
      status: pipelineStatus,
      total_duration_ms: totalDurationMs,
      llm_call_count: llmCallCount,
      stages: pipelineStages,
      connectivity: connectivityDiagnostic,
      // LLM quality metrics: tracks corrections made to LLM output
      llm_quality: {
        risk_coefficient_corrections: riskCoefficientCorrections.length,
        corrections: riskCoefficientCorrections.length > 0 ? riskCoefficientCorrections : undefined,
      },
      // Enhanced LLM metadata for observability
      llm_metadata: llmMeta ? {
        model: llmMeta.model ?? model,
        prompt_version: llmMeta.prompt_version,
        prompt_hash: llmMeta.prompt_hash,
        duration_ms: llmMeta.provider_latency_ms,
        finish_reason: llmMeta.finish_reason,
        response_chars: llmMeta.raw_llm_text?.length,
        token_usage: llmMeta.token_usage,
        temperature: llmMeta.temperature,
        max_tokens: llmMeta.max_tokens,
        seed: llmMeta.seed,
        reasoning_effort: llmMeta.reasoning_effort,
        // Prompt cache diagnostics for debugging multi-instance issues
        instance_id: llmMeta.instance_id,
        cache_age_ms: llmMeta.cache_age_ms,
        cache_status: llmMeta.cache_status,
        use_staging_mode: llmMeta.use_staging_mode,
      } : {
        model,
      },
      // Node extraction counts at each pipeline stage (for LLM observability)
      node_extraction: {
        raw: nodeCountsRaw,
        normalised: nodeCountsNormalised,
        validated: nodeCountsValidated,
      },
      // Validation summary with explicit missing_kinds
      validation_summary: validationSummary,
      // Transforms applied during pipeline
      transforms: transforms.length > 0 ? transforms : undefined,
      // LLM raw output preview (safe to include in all responses)
      llm_raw: llmRawTrace,
      // Graph corrections made during pipeline (all post-LLM modifications)
      corrections: collector.hasCorrections() ? collector.getCorrections() : undefined,
      corrections_summary: collector.hasCorrections() ? collector.getSummary() : undefined,
    };

    // Include final graph summary for debugging (safe)
    pipelineTrace.final_graph = {
      node_count: nodeCount,
      edge_count: edgeCount,
      node_kinds: Array.isArray(graph?.nodes)
        ? [...new Set((graph!.nodes as any[]).map(n => n?.kind).filter(Boolean))]
        : [],
    };

    // Unsafe additions: only when explicitly gated
    if (unsafeCaptureEnabled && llmMeta) {
      pipelineTrace.unsafe = {
        raw_output_preview: llmMeta.raw_output_preview,
      };
    }

    // Attach pipeline trace to response
    verifiedResponse.trace = {
      ...verifiedResponse.trace,
      pipeline: pipelineTrace,
    } as any;

    // Diagnostic log: confirms all pipeline stages that executed
    log.debug({
      request_id: requestId,
      event: "cee.pipeline.stages_summary",
      stages: pipelineStages.map(s => s.name),
      stage_count: pipelineStages.length,
      status: pipelineStatus,
      coefficient_normalisation_executed: pipelineStages.some(s => s.name === "coefficient_normalisation"),
      risk_corrections: riskCoefficientCorrections.length,
    }, `Pipeline complete: ${pipelineStages.map(s => s.name).join(" → ")}`);
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

  // Diagnostic log for edge coefficient values at CEE output boundary
  const responseEdges = (verifiedResponse as any).graph?.edges ?? [];
  const sampleEdges = responseEdges.slice(0, 3).map((e: any) => ({
    from: e.from,
    to: e.to,
    strength_mean: e.strength_mean ?? e.strength?.mean ?? 'MISSING',
    strength_std: e.strength_std ?? e.strength?.std ?? 'MISSING',
    belief_exists: e.belief_exists ?? e.exists_probability ?? 'MISSING',
  }));
  log.info({
    request_id: requestId,
    event: 'cee.boundary.edge_values',
    edge_count: responseEdges.length,
    sample_edges: sampleEdges,
  }, '[BOUNDARY-CEE-OUT] Edge coefficient values in response');

  // Add observability metadata when enabled (CEE_OBSERVABILITY_ENABLED=true or include_debug=true)
  // This provides debug panel visibility into LLM calls, validation, and orchestrator activity
  if (observabilityEnabled) {
    // Record validation attempt summary
    const validationAttemptCount = schemaRetryAttempted ? 2 : 1;
    observabilityCollector.recordValidationAttempt({
      passed: true,
      rules_checked: pipelineStages.length,
      rules_failed: [],
      repairs_triggered: pipelineStages.some(s => s.status === "success_with_repairs"),
      repair_types: pipelineStages
        .filter(s => s.status === "success_with_repairs")
        .map(s => s.name),
      retry_triggered: schemaRetryAttempted,
      latency_ms: latencyMs,
      validator: "cee_pipeline",
      warnings: validationIssues.map(i => i.code),
    });

    // Record orchestrator steps from pipeline stages
    observabilityCollector.setOrchestratorEnabled(true);
    for (const stage of pipelineStages) {
      observabilityCollector.recordOrchestratorStep({
        step: stage.name,
        executed: true,
        latency_ms: stage.duration_ms,
        metadata: stage.details,
      });
    }

    // Build and attach observability to response
    const observability = observabilityCollector.build();
    (verifiedResponse as any)._observability = observability;
  }

  return {
    statusCode: 200,
    body: verifiedResponse,
  };
}
