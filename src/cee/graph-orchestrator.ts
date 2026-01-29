/**
 * Graph Generation Orchestrator
 *
 * Orchestrates the draft_graph → validate → repair loop.
 * Integrates the deterministic graph validator with LLM repair.
 *
 * Flow:
 * 1. LLM draft_graph → Zod parse → validateGraph() → [errors?]
 * 2. If errors: Repair prompt with brief + graph + errors → LLM retry
 * 3. Repeat up to maxRetries times
 * 4. On success: normalise → validateGraphPostNormalisation → return
 *
 * @module cee/graph-orchestrator
 */

import { Graph, type GraphT } from "../schemas/graph.js";
import {
  validateGraph,
  validateGraphPostNormalisation,
} from "../validators/graph-validator.js";
import type { ValidationIssue, GraphValidationResult } from "../validators/graph-validator.types.js";
import { zodToValidationErrors, isZodError } from "../validators/zod-error-mapper.js";
import { log, emit, TelemetryEvents } from "../utils/telemetry.js";

// =============================================================================
// Types
// =============================================================================

export interface GenerateGraphInput {
  /** The decision brief text */
  brief: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Maximum repair retries (default: 1) */
  maxRetries?: number;
}

export interface GenerateGraphResult {
  /** The validated and normalised graph */
  graph: GraphT;
  /** Number of attempts made (1 = first try worked) */
  attempts: number;
  /** Whether repair was needed */
  repairUsed: boolean;
  /** Warnings from validation (non-blocking) */
  warnings: ValidationIssue[];
  /** Debug info about repair attempts */
  repairHistory?: RepairAttempt[];
}

export interface RepairAttempt {
  attempt: number;
  errors: ValidationIssue[];
  phase: "zod" | "validate" | "post_norm";
}

export interface LLMDraftResult {
  graph: unknown;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LLMRepairResult {
  graph: unknown;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Adapter interface for LLM calls.
 * Allows dependency injection for testing.
 */
export interface GraphLLMAdapter {
  draftGraph(brief: string, requestId?: string): Promise<LLMDraftResult>;
  repairGraph(
    brief: string,
    failedGraph: GraphT,
    errors: ValidationIssue[],
    requestId?: string
  ): Promise<LLMRepairResult>;
}

export class GraphValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationIssue[],
    public readonly attempts: number,
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
 * Normalise graph values (clamp strength_mean to [-1, 1], etc.)
 * This is a minimal normaliser for the orchestrator.
 * Full normalisation happens downstream in the pipeline.
 */
function normaliseGraph(graph: GraphT): GraphT {
  return {
    ...graph,
    edges: graph.edges.map((edge) => ({
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
    })),
  };
}

// =============================================================================
// Error Formatting for Repair Prompt
// =============================================================================

/**
 * Format errors for the repair prompt.
 * Creates a concise, actionable summary for the LLM.
 */
export function formatErrorsForRepair(errors: ValidationIssue[]): string {
  if (errors.length === 0) return "No errors";

  const lines = errors.map((error, index) => {
    const location = error.path ? ` at ${error.path}` : "";
    return `${index + 1}. [${error.code}]${location}: ${error.message}`;
  });

  return lines.join("\n");
}

// =============================================================================
// Orchestrator
// =============================================================================

/**
 * Generate a validated graph from a brief with automatic repair.
 *
 * @param input - Brief and configuration
 * @param adapter - LLM adapter for draft and repair calls
 * @returns Validated and normalised graph
 * @throws GraphValidationError if all retries exhausted
 *
 * @example
 * ```typescript
 * const result = await generateGraph(
 *   { brief: "Should we hire a contractor?", maxRetries: 2 },
 *   myLLMAdapter
 * );
 * console.log(result.graph, result.attempts, result.warnings);
 * ```
 */
export async function generateGraph(
  input: GenerateGraphInput,
  adapter: GraphLLMAdapter
): Promise<GenerateGraphResult> {
  const { brief, requestId, maxRetries = 1 } = input;
  const totalAttempts = maxRetries + 1; // Initial attempt + retries

  let lastGraph: GraphT | undefined;
  let lastErrors: ValidationIssue[] = [];
  let lastPhase: "zod" | "validate" | "post_norm" = "zod";
  const repairHistory: RepairAttempt[] = [];

  log.info(
    {
      event: "graph_orchestrator.start",
      requestId,
      maxRetries,
    },
    "Starting graph generation"
  );

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const isRetry = attempt > 0;
    const attemptRequestId = isRetry && requestId
      ? `${requestId}_repair_${attempt}`
      : requestId;

    log.info(
      {
        event: "graph_orchestrator.attempt",
        requestId: attemptRequestId,
        attempt: attempt + 1,
        isRetry,
        previousErrorCount: lastErrors.length,
      },
      isRetry ? "Attempting repair" : "Initial draft attempt"
    );

    try {
      // Step 1: Get graph from LLM (draft or repair)
      let rawGraph: unknown;

      if (isRetry && lastGraph && lastErrors.length > 0) {
        // Repair attempt
        const repairResult = await adapter.repairGraph(
          brief,
          lastGraph,
          lastErrors,
          attemptRequestId
        );
        rawGraph = repairResult.graph;
      } else {
        // Initial draft
        const draftResult = await adapter.draftGraph(brief, attemptRequestId);
        rawGraph = draftResult.graph;
      }

      // Step 2: Zod parse
      const parseResult = Graph.safeParse(rawGraph);

      if (!parseResult.success) {
        lastErrors = zodToValidationErrors(parseResult.error);
        lastPhase = "zod";

        // Try to preserve graph structure for repair even if Zod fails
        if (
          rawGraph &&
          typeof rawGraph === "object" &&
          "nodes" in rawGraph &&
          "edges" in rawGraph
        ) {
          // Attempt lenient parse for repair context
          try {
            lastGraph = rawGraph as GraphT;
          } catch {
            // Can't preserve, lastGraph stays as previous value
          }
        }

        log.warn(
          {
            event: "graph_orchestrator.zod_failed",
            requestId: attemptRequestId,
            attempt: attempt + 1,
            errorCount: lastErrors.length,
          },
          "Zod validation failed"
        );

        repairHistory.push({
          attempt: attempt + 1,
          errors: [...lastErrors],
          phase: "zod",
        });

        continue;
      }

      const graph = parseResult.data;
      lastGraph = graph;

      // Step 3: Graph validator (pre-normalisation)
      const validationResult = validateGraph({ graph, requestId: attemptRequestId });

      if (!validationResult.valid) {
        lastErrors = validationResult.errors;
        lastPhase = "validate";

        log.warn(
          {
            event: "graph_orchestrator.validation_failed",
            requestId: attemptRequestId,
            attempt: attempt + 1,
            errorCount: lastErrors.length,
          },
          "Graph validation failed"
        );

        repairHistory.push({
          attempt: attempt + 1,
          errors: [...lastErrors],
          phase: "validate",
        });

        continue;
      }

      // Step 4: Normalise
      const normalisedGraph = normaliseGraph(graph);

      // Step 5: Post-normalisation validation
      const postNormResult = validateGraphPostNormalisation({
        graph: normalisedGraph,
        requestId: attemptRequestId,
      });

      if (!postNormResult.valid) {
        lastErrors = postNormResult.errors;
        lastPhase = "post_norm";
        lastGraph = normalisedGraph;

        log.warn(
          {
            event: "graph_orchestrator.post_norm_failed",
            requestId: attemptRequestId,
            attempt: attempt + 1,
            errorCount: lastErrors.length,
          },
          "Post-normalisation validation failed"
        );

        repairHistory.push({
          attempt: attempt + 1,
          errors: [...lastErrors],
          phase: "post_norm",
        });

        continue;
      }

      // Success!
      log.info(
        {
          event: "graph_orchestrator.success",
          requestId,
          attempts: attempt + 1,
          repairUsed: isRetry,
          warningCount: validationResult.warnings.length,
        },
        "Graph generation succeeded"
      );

      // Log warnings but don't fail
      if (validationResult.warnings.length > 0) {
        log.info(
          {
            event: "graph_orchestrator.warnings",
            requestId,
            warningCount: validationResult.warnings.length,
            warnings: validationResult.warnings.map((w) => w.code),
          },
          "Graph has non-blocking warnings"
        );
      }

      return {
        graph: normalisedGraph,
        attempts: attempt + 1,
        repairUsed: isRetry,
        warnings: validationResult.warnings,
        repairHistory: repairHistory.length > 0 ? repairHistory : undefined,
      };
    } catch (error) {
      // Handle unexpected errors (LLM timeout, network, etc.)
      const err = error instanceof Error ? error : new Error(String(error));

      log.error(
        {
          event: "graph_orchestrator.unexpected_error",
          requestId: attemptRequestId,
          attempt: attempt + 1,
          errorName: err.name,
          errorMessage: err.message,
        },
        "Unexpected error during graph generation"
      );

      // If it's a Zod error that wasn't caught by safeParse, convert it
      if (isZodError(error)) {
        lastErrors = zodToValidationErrors(error);
        lastPhase = "zod";
        repairHistory.push({
          attempt: attempt + 1,
          errors: [...lastErrors],
          phase: "zod",
        });
        continue;
      }

      // Re-throw non-validation errors
      throw error;
    }
  }

  // All retries exhausted
  log.error(
    {
      event: "graph_orchestrator.exhausted",
      requestId,
      totalAttempts,
      lastErrorCount: lastErrors.length,
      lastPhase,
    },
    "Graph generation failed after all retries"
  );

  throw new GraphValidationError(
    `Graph validation failed after ${totalAttempts} attempts`,
    lastErrors,
    totalAttempts,
    lastGraph
  );
}

// =============================================================================
// Validate and Repair Existing Graph
// =============================================================================

/**
 * Input for validateAndRepairGraph
 */
export interface ValidateAndRepairInput {
  /** The graph to validate (already generated by LLM) */
  graph: unknown;
  /** Original brief for repair context */
  brief: string;
  /** Request ID for tracing */
  requestId?: string;
  /** Maximum repair retries (default: 1) */
  maxRetries?: number;
}

/**
 * Result from validateAndRepairGraph
 */
export interface ValidateAndRepairResult {
  /** The validated (and possibly repaired) graph */
  graph: GraphT;
  /** Whether repair was needed */
  repairUsed: boolean;
  /** Number of repair attempts made */
  repairAttempts: number;
  /** Warnings from validation (non-blocking) */
  warnings: ValidationIssue[];
}

/**
 * Repair-only adapter interface.
 * Used when the graph is already generated and only repair is needed.
 */
export interface RepairOnlyAdapter {
  repairGraph(
    brief: string,
    failedGraph: GraphT,
    errors: ValidationIssue[],
    requestId?: string
  ): Promise<LLMRepairResult>;
}

/**
 * Validate an existing graph and optionally repair it.
 *
 * This function is for pipelines that generate the graph separately
 * and want to use the orchestrator's validation and repair logic
 * without making a new LLM draft call.
 *
 * Flow:
 * 1. Zod parse the input graph
 * 2. Run validateGraph() (deterministic)
 * 3. Normalise edge values
 * 4. Run validateGraphPostNormalisation()
 * 5. If any errors: call repair adapter and retry
 * 6. On success: return validated graph
 * 7. On max retries exceeded: throw GraphValidationError
 *
 * @param input - Graph to validate and optional repair config
 * @param repairAdapter - Adapter for repair calls (optional - if not provided, throws on validation failure)
 * @returns Validated graph with repair info
 * @throws GraphValidationError if validation fails and no repair adapter provided, or after max retries
 */
export async function validateAndRepairGraph(
  input: ValidateAndRepairInput,
  repairAdapter?: RepairOnlyAdapter
): Promise<ValidateAndRepairResult> {
  const { graph: rawGraph, brief, requestId, maxRetries = 1 } = input;

  let currentGraph: GraphT | undefined;
  let lastErrors: ValidationIssue[] = [];
  let lastPhase: "zod" | "validate" | "post_norm" = "zod";
  let repairAttempts = 0;

  const totalAttempts = maxRetries + 1;

  log.info(
    {
      event: "graph_orchestrator.validate_repair.start",
      requestId,
      maxRetries,
      hasRepairAdapter: !!repairAdapter,
    },
    "Starting graph validation with optional repair"
  );

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const isRetry = attempt > 0;
    const attemptRequestId = isRetry && requestId
      ? `${requestId}_repair_${attempt}`
      : requestId;

    // Get the graph to validate (raw on first attempt, repaired on retries)
    const graphToValidate = isRetry && currentGraph ? currentGraph : rawGraph;

    // Phase 1: Zod parse
    const zodResult = Graph.safeParse(graphToValidate);
    if (!zodResult.success) {
      lastErrors = zodToValidationErrors(zodResult.error);
      lastPhase = "zod";

      log.warn(
        {
          event: "graph_orchestrator.validate_repair.zod_failed",
          requestId: attemptRequestId,
          attempt: attempt + 1,
          errorCount: lastErrors.length,
        },
        "Zod validation failed"
      );

      if (!repairAdapter || attempt >= totalAttempts - 1) {
        break; // No repair available or max retries exceeded
      }

      // Call repair
      repairAttempts++;
      try {
        const repairResult = await repairAdapter.repairGraph(
          brief,
          graphToValidate as GraphT,
          lastErrors,
          attemptRequestId
        );
        currentGraph = Graph.parse(repairResult.graph);
      } catch (repairError) {
        log.error(
          { event: "graph_orchestrator.validate_repair.repair_failed", error: repairError },
          "Repair call failed"
        );
        break;
      }
      continue;
    }

    currentGraph = zodResult.data;

    // Phase 2: Deterministic validation
    const validationResult = validateGraph({ graph: currentGraph });
    const errors = validationResult.errors;
    const warnings = validationResult.warnings;

    if (errors.length > 0) {
      lastErrors = errors;
      lastPhase = "validate";

      log.warn(
        {
          event: "graph_orchestrator.validate_repair.validation_failed",
          requestId: attemptRequestId,
          attempt: attempt + 1,
          errorCount: errors.length,
        },
        "Deterministic validation failed"
      );

      if (!repairAdapter || attempt >= totalAttempts - 1) {
        break;
      }

      // Call repair
      repairAttempts++;
      try {
        const repairResult = await repairAdapter.repairGraph(
          brief,
          currentGraph,
          errors,
          attemptRequestId
        );
        currentGraph = Graph.parse(repairResult.graph);
      } catch (repairError) {
        log.error(
          { event: "graph_orchestrator.validate_repair.repair_failed", error: repairError },
          "Repair call failed"
        );
        break;
      }
      continue;
    }

    // Phase 3: Normalise
    const normalised = normaliseGraph(currentGraph);

    // Phase 4: Post-normalisation validation
    const postNormResult = validateGraphPostNormalisation({ graph: normalised });
    const postNormErrors = postNormResult.errors;
    const allWarnings = [...warnings, ...postNormResult.warnings];

    if (postNormErrors.length > 0) {
      lastErrors = postNormErrors;
      lastPhase = "post_norm";

      log.warn(
        {
          event: "graph_orchestrator.validate_repair.post_norm_failed",
          requestId: attemptRequestId,
          attempt: attempt + 1,
          errorCount: postNormErrors.length,
        },
        "Post-normalisation validation failed"
      );

      if (!repairAdapter || attempt >= totalAttempts - 1) {
        break;
      }

      // Call repair
      repairAttempts++;
      try {
        const repairResult = await repairAdapter.repairGraph(
          brief,
          normalised,
          postNormErrors,
          attemptRequestId
        );
        currentGraph = Graph.parse(repairResult.graph);
      } catch (repairError) {
        log.error(
          { event: "graph_orchestrator.validate_repair.repair_failed", error: repairError },
          "Repair call failed"
        );
        break;
      }
      continue;
    }

    // All validations passed!
    log.info(
      {
        event: "graph_orchestrator.validate_repair.success",
        requestId,
        repairUsed: repairAttempts > 0,
        repairAttempts,
        warningCount: allWarnings.length,
      },
      "Graph validation succeeded"
    );

    return {
      graph: normalised,
      repairUsed: repairAttempts > 0,
      repairAttempts,
      warnings: allWarnings,
    };
  }

  // All attempts failed
  log.error(
    {
      event: "graph_orchestrator.validate_repair.exhausted",
      requestId,
      repairAttempts,
      errorCount: lastErrors.length,
      lastPhase,
    },
    "Graph validation failed after all attempts"
  );

  throw new GraphValidationError(
    `Graph validation failed after ${repairAttempts + 1} attempt(s)`,
    lastErrors,
    repairAttempts + 1,
    currentGraph
  );
}

// =============================================================================
// Repair Prompt Builder
// =============================================================================

/**
 * Build a repair prompt with context from the failed graph.
 * Used by LLM adapters to construct the repair request.
 */
export function buildRepairPromptContext(
  brief: string,
  failedGraph: GraphT,
  errors: ValidationIssue[]
): string {
  const errorList = formatErrorsForRepair(errors);

  return `## Original Brief
${brief}

## Failed Graph (JSON)
${JSON.stringify(failedGraph, null, 2)}

## Validation Errors
${errorList}

## Instructions
Fix ALL the errors listed above. Return ONLY the corrected JSON graph.
Do not explain the changes. Output valid JSON with "nodes" and "edges" keys only.`;
}

// =============================================================================
// LLM Adapter Bridge
// =============================================================================

/**
 * Context for bridging to the existing LLM adapters.
 * Captures the extra arguments needed by the underlying adapters.
 */
export interface AdapterBridgeContext {
  docs?: Array<{ path: string; preview: string }>;
  seed?: number;
  flags?: Record<string, unknown>;
  includeDebug?: boolean;
  timeoutMs?: number;
  collector?: unknown; // CorrectionCollector
  bypassCache?: boolean;
  forceDefault?: boolean;
}

/**
 * Factory for creating a GraphLLMAdapter from existing LLM adapters.
 *
 * Bridges the richer LLMAdapter interface to the simpler GraphLLMAdapter
 * interface used by the orchestrator.
 *
 * @param draftAdapter - Adapter for draft_graph calls (has draftGraph method)
 * @param repairAdapter - Adapter for repair_graph calls (has repairGraph method)
 * @param context - Additional context (docs, flags, timeouts, etc.)
 * @returns An adapter implementing GraphLLMAdapter
 */
export function createAdapterBridge(
  draftAdapter: {
    draftGraph(
      args: { brief: string; docs?: unknown[]; seed?: number; flags?: Record<string, unknown>; includeDebug?: boolean },
      opts: { requestId: string; timeoutMs: number; collector?: unknown; bypassCache?: boolean; forceDefault?: boolean }
    ): Promise<{ graph: GraphT; usage: { input_tokens: number; output_tokens: number } }>;
  },
  repairAdapter: {
    repairGraph(
      args: { graph: GraphT; violations: string[]; brief?: string; docs?: unknown[] },
      opts: { requestId: string; timeoutMs: number }
    ): Promise<{ graph: GraphT; usage: { input_tokens: number; output_tokens: number } }>;
  },
  context: AdapterBridgeContext
): GraphLLMAdapter {
  const {
    docs,
    seed = 17,
    flags,
    includeDebug = false,
    timeoutMs = 30000,
    collector,
    bypassCache,
    forceDefault,
  } = context;

  return {
    async draftGraph(brief: string, requestId?: string): Promise<LLMDraftResult> {
      const result = await draftAdapter.draftGraph(
        { brief, docs, seed, flags, includeDebug },
        {
          requestId: requestId || `draft_${Date.now()}`,
          timeoutMs,
          collector,
          bypassCache,
          forceDefault,
        }
      );
      return {
        graph: result.graph,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        },
      };
    },

    async repairGraph(
      brief: string,
      failedGraph: GraphT,
      errors: ValidationIssue[],
      requestId?: string
    ): Promise<LLMRepairResult> {
      // Convert ValidationIssue[] to string[] for the legacy repair adapter
      const violations = errors.map((e) => {
        const location = e.path ? ` at ${e.path}` : "";
        return `[${e.code}]${location}: ${e.message}`;
      });

      const result = await repairAdapter.repairGraph(
        { graph: failedGraph, violations, brief, docs },
        {
          requestId: requestId || `repair_${Date.now()}`,
          timeoutMs,
        }
      );
      return {
        graph: result.graph,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        },
      };
    },
  };
}
