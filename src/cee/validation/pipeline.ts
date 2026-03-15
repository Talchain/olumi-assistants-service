import type { FastifyRequest } from "fastify";
import type { components } from "../../generated/openapi.d.ts";
import type { GraphV1 } from "../../contracts/plot/engine.js";
import type { DraftGraphInputT } from "../../schemas/assist.js";
import { emit, log, TelemetryEvents } from "../../utils/telemetry.js";
import { config } from "../../config/index.js";
import { safeEqual } from "../../utils/hash.js";
import { computeQuality } from "../quality/index.js";
import { normaliseCeeGraphVersionAndProvenance } from "../transforms/graph-normalisation.js";
import { normaliseRiskCoefficients } from "../transforms/risk-normalisation.js";
import {
  validateAndFixGraph,
} from "../structure/index.js";
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

function clarifierEnabled(): boolean {
  return config.cee.clarifierEnabled;
}

type CEEClarifierBlockV1 = components["schemas"]["CEEClarifierBlockV1"];

export interface ClarifierIntegrationResult {
  clarifier?: CEEClarifierBlockV1;
  refinedGraph?: GraphV1;
  previousQuality?: number;
  /** Convergence status for backward compatibility with clarifier_status field */
  convergenceStatus?: "complete" | "max_rounds" | "confident";
}

export async function integrateClarifier(
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
