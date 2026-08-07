/**
 * Graph Validation Orchestrator (DETERMINISTIC)
 *
 * Validates an already-generated graph:
 *   1. Zod parse
 *   2. Normalise structural (option→factor) edges to canonical values
 *   3. validateGraph() — deterministic
 *   4. Normalise edge values (clamp, default origin)
 *   5. validateGraphPostNormalisation()
 *   6. On success: return the normalised graph + warnings
 *      On failure: throw GraphValidationError
 *
 * ⚠ THERE IS NO LLM IN THIS MODULE, BY DESIGN (ROADMAP 2.740a).
 *
 * This file used to host the draft_graph → validate → repair loop. Everything
 * LLM-shaped in it has been removed, in two waves:
 *
 *   - 2.731 (#846) removed the draft pipeline's LLM repair call, which left
 *     `generateGraph` / `GraphLLMAdapter` / `createAdapterBridge` and the
 *     repair-prompt builders with zero callers anywhere in the repo.
 *   - 2.740a removed the last live LLM limb: the `repairAdapter` argument of
 *     `validateAndRepairGraph`, whose sole caller was the gated substep 1b
 *     (`unified-pipeline/stages/repair/orchestrator-validation.ts`). That
 *     limb was measured at 0 invocations over a controlled 7-day window
 *     while being one env-var flip from running a 60 s gpt-4.1 call on 100 %
 *     of draft turns, and it adopted the LLM's graph even when repair failed.
 *     The orphaned machinery above went with it.
 *
 * The retry loop went too, and could not have survived the adapter: with no
 * adapter every trigger point broke out on the first pass, so `maxRetries`
 * had no reachable effect. The single deterministic pass below is exactly
 * what the loop did.
 *
 * Do NOT re-introduce an LLM call here. The evidence is
 * PHASE0-EVIDENCE-2026-07-28/substep1b-repair-measurement-2026-08-08.md, and
 * the guard is tests/unit/cee.substep1b-llm-repair-removed.test.ts.
 *
 * @module cee/graph-orchestrator
 */

import { Graph, type GraphT } from "../schemas/graph.js";
import {
  validateGraph,
  validateGraphPostNormalisation,
} from "../validators/graph-validator.js";
import type { ValidationIssue } from "../validators/graph-validator.types.js";
import { zodToValidationErrors } from "../validators/zod-error-mapper.js";
import { extractZodIssues } from "../schemas/llmExtraction.js";
import { log } from "../utils/telemetry.js";
import type { ObservabilityCollector } from "./observability/collector.js";
import { normaliseStructuralEdges } from "./structural-edge-normaliser.js";

// =============================================================================
// Types
// =============================================================================

export class GraphValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationIssue[],
    public readonly attempts: number,
    /**
     * The furthest-processed graph at the point of failure.
     *
     * Since 2.740a this is ALWAYS a deterministic derivative of the caller's
     * own input (Zod-parsed + structural-edge-normalised), or undefined when
     * the input failed Zod parsing. It can never be an LLM-authored graph —
     * there is no adapter in this module that could produce one.
     */
    public readonly lastGraph?: GraphT
  ) {
    super(message);
    this.name = "GraphValidationError";
  }
}

// =============================================================================
// Normalisation
// =============================================================================

/**
 * Result of graph normalisation, including observability metadata.
 */
export interface NormaliseGraphResult {
  graph: GraphT;
  /** Edge IDs that had their origin defaulted to 'ai' */
  edgesWithDefaultedOrigin: string[];
}

/**
 * Normalise graph values (clamp strength_mean to [-1, 1], etc.)
 * This is a minimal normaliser for the orchestrator.
 * Full normalisation happens downstream in the pipeline.
 */
function normaliseGraph(graph: GraphT): NormaliseGraphResult {
  const edgesWithDefaultedOrigin: string[] = [];

  const normalisedEdges = graph.edges.map((edge) => {
    // Track edges with defaulted origin for observability
    if (!edge.origin) {
      const edgeId = (edge as any).id ?? `${edge.from}->${edge.to}`;
      edgesWithDefaultedOrigin.push(edgeId);
    }

    return {
      ...edge,
      // Clamp strength_mean to [-1, 1]
      strength_mean:
        edge.strength_mean !== undefined
          ? Math.max(-1, Math.min(1, edge.strength_mean))
          : edge.strength_mean,
      // Clamp belief_exists to [0, 1]
      belief_exists:
        edge.belief_exists !== undefined
          ? Math.max(0, Math.min(1, edge.belief_exists))
          : edge.belief_exists,
      // Ensure std is positive
      strength_std:
        edge.strength_std !== undefined
          ? Math.max(0.01, edge.strength_std)
          : edge.strength_std,
      // Default edge origin to 'ai' for LLM-generated edges
      origin: edge.origin ?? "ai",
    };
  });

  return {
    graph: { ...graph, edges: normalisedEdges },
    edgesWithDefaultedOrigin,
  };
}

// =============================================================================
// Validate Existing Graph
// =============================================================================

/**
 * Input for validateAndRepairGraph
 */
export interface ValidateAndRepairInput {
  /** The graph to validate (already generated by LLM) */
  graph: unknown;
  /** Original brief, retained for tracing context */
  brief: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Optional observability collector for recording validation attempts */
  collector?: ObservabilityCollector;
  /** v0.11.0 schema amendment: optional coaching block to enable
   *  referential-integrity warnings (WIDENING_LOG_INVALID_REF). */
  coaching?: unknown;
  /** v0.11.0 schema amendment: optional causal claims array to enable
   *  CAUSAL_CLAIM_INVALID_REF / CAUSAL_CLAIM_BETWEEN_INVALID /
   *  CAUSAL_CLAIM_GOAL_TARGET / CAUSAL_CLAIMS_CARDINALITY_OFF warnings. */
  causalClaims?: unknown;
}

/**
 * Result from validateAndRepairGraph
 */
export interface ValidateAndRepairResult {
  /** The validated and normalised graph */
  graph: GraphT;
  /**
   * Whether repair was needed. Always false since 2.740a — kept because it
   * feeds the `llm_repair_called` field on substep 1b's 422 envelope, where
   * a hardcoded-honest `false` is the accurate disclosure.
   */
  repairUsed: boolean;
  /** Number of repair attempts made. Always 0 since 2.740a. */
  repairAttempts: number;
  /** Warnings from validation (non-blocking) */
  warnings: ValidationIssue[];
}

/**
 * Validate an existing graph.
 *
 * Deterministic and single-pass. Named `validateAndRepairGraph` for its
 * callers' sake; the "repair" it still performs is deterministic
 * normalisation (structural edges, value clamping, origin defaulting), never
 * an LLM call — see the module header.
 *
 * @param input - Graph to validate
 * @returns Validated + normalised graph with warnings
 * @throws GraphValidationError if the graph does not validate
 */
export async function validateAndRepairGraph(
  input: ValidateAndRepairInput
): Promise<ValidateAndRepairResult> {
  const { graph: rawGraph, requestId, collector: _collector, coaching, causalClaims } = input;

  let currentGraph: GraphT | undefined;
  let lastErrors: ValidationIssue[] = [];
  let lastPhase: "zod" | "validate" | "post_norm" = "zod";

  log.info(
    {
      event: "graph_orchestrator.validate_repair.start",
      requestId,
    },
    "Starting deterministic graph validation"
  );

  // Phase 1: Zod parse
  const zodResult = Graph.safeParse(rawGraph);
  if (!zodResult.success) {
    lastErrors = zodToValidationErrors(zodResult.error);
    lastPhase = "zod";

    log.warn(
      {
        event: "graph_orchestrator.validate_repair.zod_failed",
        requestId,
        errorCount: lastErrors.length,
        first_issues: extractZodIssues(zodResult.error, 3),
      },
      "Zod validation failed"
    );

    throw buildValidationError(lastErrors, lastPhase, currentGraph, requestId);
  }

  const parsedGraph = zodResult.data;

  // Phase 1.5: Normalise structural edges (option→factor) to canonical values
  const { graph: structurallyNormalised, normalisedCount } = normaliseStructuralEdges(parsedGraph);
  currentGraph = structurallyNormalised;

  if (normalisedCount > 0) {
    log.info(
      {
        event: "graph_orchestrator.validate_repair.structural_edges_normalised",
        requestId,
        count: normalisedCount,
      },
      `Normalised ${normalisedCount} structural edge(s) before validation`
    );
  }

  // Phase 2: Deterministic validation. v0.11.0 schema amendment:
  // forward coaching + causal claims so the validator runs the
  // referential-integrity warnings against the post-normalisation graph.
  const validationResult = validateGraph({ graph: currentGraph, coaching, causalClaims });
  const errors = validationResult.errors;
  const warnings = validationResult.warnings;

  if (errors.length > 0) {
    lastErrors = errors;
    lastPhase = "validate";

    log.warn(
      {
        event: "graph_orchestrator.validate_repair.validation_failed",
        requestId,
        errorCount: errors.length,
      },
      "Deterministic validation failed"
    );

    throw buildValidationError(lastErrors, lastPhase, currentGraph, requestId);
  }

  // Phase 3: Normalise
  const { graph: normalised, edgesWithDefaultedOrigin } = normaliseGraph(currentGraph);

  // Track edge origin defaulting for observability
  const edgeOriginWarnings: ValidationIssue[] = [];
  if (edgesWithDefaultedOrigin.length > 0) {
    log.info(
      {
        event: "graph_orchestrator.edge_origin_defaulted",
        requestId,
        edgeCount: edgesWithDefaultedOrigin.length,
        edgeIds: edgesWithDefaultedOrigin.slice(0, 10), // Sample for logging
      },
      `Defaulted origin to 'ai' for ${edgesWithDefaultedOrigin.length} edges`
    );
    // Create info warning for observability (one aggregated warning, not per-edge)
    edgeOriginWarnings.push({
      code: "EDGE_ORIGIN_DEFAULTED",
      message: `${edgesWithDefaultedOrigin.length} edge(s) missing origin, defaulted to 'ai'`,
      severity: "info",
      path: "edges",
      context: {
        edge_count: edgesWithDefaultedOrigin.length,
        edge_ids: edgesWithDefaultedOrigin.slice(0, 5), // First 5 edge IDs per spec
      },
    });
  }

  // Phase 4: Post-normalisation validation
  const postNormResult = validateGraphPostNormalisation({ graph: normalised });
  const postNormErrors = postNormResult.errors;
  const allWarnings = [...warnings, ...postNormResult.warnings, ...edgeOriginWarnings];

  if (postNormErrors.length > 0) {
    lastErrors = postNormErrors;
    lastPhase = "post_norm";

    log.warn(
      {
        event: "graph_orchestrator.validate_repair.post_norm_failed",
        requestId,
        errorCount: postNormErrors.length,
      },
      "Post-normalisation validation failed"
    );

    throw buildValidationError(lastErrors, lastPhase, currentGraph, requestId);
  }

  // All validations passed!
  log.info(
    {
      event: "graph_orchestrator.validate_repair.success",
      requestId,
      repairUsed: false,
      repairAttempts: 0,
      warningCount: allWarnings.length,
    },
    "Graph validation succeeded"
  );

  return {
    graph: normalised,
    repairUsed: false,
    repairAttempts: 0,
    warnings: allWarnings,
  };
}

/**
 * Build the terminal GraphValidationError, logging the exhausted event.
 *
 * `lastGraph` is the deterministically-processed input, never an LLM output
 * (see GraphValidationError.lastGraph).
 */
function buildValidationError(
  lastErrors: ValidationIssue[],
  lastPhase: "zod" | "validate" | "post_norm",
  currentGraph: GraphT | undefined,
  requestId: string | undefined
): GraphValidationError {
  log.error(
    {
      event: "graph_orchestrator.validate_repair.exhausted",
      requestId,
      repairAttempts: 0,
      errorCount: lastErrors.length,
      lastPhase,
    },
    "Graph validation failed"
  );

  return new GraphValidationError(
    `Graph validation failed after 1 attempt(s)`,
    lastErrors,
    1,
    currentGraph
  );
}
