/**
 * Diagnostic Checks — Debug Bundle Integrity Verifier
 *
 * Computes a `diagnostic_checks` object from a V3 response body,
 * verifying that key data fields are populated at the correct paths.
 * Attached to `trace.pipeline.diagnostic_checks` in the package stage
 * so debug bundles reflect the actual data state (not stale heuristics).
 *
 * Each check reads from the canonical V3 response structure and reports
 * a boolean plus supporting detail where applicable.
 */

// ============================================================================
// Types
// ============================================================================

export interface DiagnosticChecks {
  /** Whether pipeline.llm_raw is populated (truthy). */
  llm_raw_available: boolean;

  /** Whether cee_provenance is present on the pipeline trace. */
  cee_trace_present: boolean;

  /**
   * Whether causal edges have differentiated exists_probability values.
   * True when ≥2 distinct non-1.0 values exist on causal edges.
   */
  confidence_differentiated: boolean;

  /** Sorted unique exists_probability values from causal edges (excludes structural 1.0). */
  confidence_unique_values: number[];

  /**
   * Whether any non-external factor node has a non-null `intercept` value.
   * Checks both top-level `node.intercept` and `observed_state.intercept`.
   */
  intercept_populated: boolean;

  /**
   * Whether `is_baseline` is set on any option in the `options[]` array.
   * True when at least one option has `is_baseline === true`.
   */
  is_baseline_present: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Edge types considered structural (exists_probability is always 1.0 by design). */
const STRUCTURAL_EDGE_TYPES = new Set(['structural', 'decision_option', 'option_factor']);

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute diagnostic checks from a V3 response body and its pipeline trace.
 *
 * @param v3Body - The V3 response body (contains `graph`, `options`, etc.)
 * @param pipelineTrace - The pipeline trace object (contains `llm_raw`, `cee_provenance`, etc.)
 * @returns DiagnosticChecks object with boolean results and supporting detail.
 */
export function computeDiagnosticChecks(
  v3Body: Record<string, unknown>,
  pipelineTrace: Record<string, unknown>,
): DiagnosticChecks {
  return {
    llm_raw_available: checkLlmRawAvailable(pipelineTrace),
    cee_trace_present: checkCeeTracePresent(pipelineTrace),
    ...checkConfidenceDifferentiation(v3Body),
    intercept_populated: checkInterceptPopulated(v3Body),
    is_baseline_present: checkIsBaselinePresent(v3Body),
  };
}

// ============================================================================
// Individual Checks
// ============================================================================

/**
 * Check whether `pipeline.llm_raw` is populated.
 * Reads from the pipeline trace (not the top-level response).
 */
function checkLlmRawAvailable(pipelineTrace: Record<string, unknown>): boolean {
  return !!pipelineTrace.llm_raw;
}

/**
 * Check whether `cee_provenance` is present on the pipeline trace.
 * This is the provenance/lineage block set by the package stage.
 */
function checkCeeTracePresent(pipelineTrace: Record<string, unknown>): boolean {
  return !!pipelineTrace.cee_provenance;
}

/**
 * Check edge confidence differentiation from `edges[]`.
 *
 * Returns true when ≥2 distinct exists_probability values exist among
 * causal (non-structural) edges. Structural edges are excluded by
 * edge_type, not by value — a causal edge at 1.0 is valid evidence
 * of a high-confidence relationship and must be counted.
 */
function checkConfidenceDifferentiation(
  v3Body: Record<string, unknown>,
): { confidence_differentiated: boolean; confidence_unique_values: number[] } {
  const graph = v3Body.graph as Record<string, unknown> | undefined;
  const edges = (graph?.edges ?? v3Body.edges) as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(edges) || edges.length === 0) {
    return { confidence_differentiated: false, confidence_unique_values: [] };
  }

  const uniqueValues = new Set<number>();

  for (const edge of edges) {
    if (!edge) continue;

    // Skip structural edges — their exists_probability is always 1.0 by design
    const edgeType = edge.edge_type as string | undefined;
    if (edgeType && STRUCTURAL_EDGE_TYPES.has(edgeType)) continue;

    const prob = edge.exists_probability;
    if (typeof prob === 'number') {
      // Round to 3 decimal places to avoid float noise
      uniqueValues.add(Math.round(prob * 1000) / 1000);
    }
  }

  const sorted = [...uniqueValues].sort((a, b) => a - b);
  return {
    confidence_differentiated: sorted.length >= 2,
    confidence_unique_values: sorted,
  };
}

/**
 * Check whether any non-external factor node has a non-null `intercept`.
 *
 * Reads from `graph.nodes[]` in the V3 body. Checks both top-level
 * `node.intercept` and `node.observed_state.intercept` (the latter
 * is a future-proofing path that may be used by ISL).
 */
function checkInterceptPopulated(v3Body: Record<string, unknown>): boolean {
  const graph = v3Body.graph as Record<string, unknown> | undefined;
  const nodes = (graph?.nodes ?? v3Body.nodes) as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(nodes)) return false;

  for (const node of nodes) {
    if (!node) continue;
    if (node.kind !== 'factor') continue;
    // Skip external factors — they don't participate in inference with intercepts
    if (node.category === 'external') continue;

    // Check top-level intercept
    if (node.intercept != null && typeof node.intercept === 'number') {
      return true;
    }

    // Check observed_state.intercept (future-proofing)
    const os = node.observed_state as Record<string, unknown> | undefined;
    if (os?.intercept != null && typeof os.intercept === 'number') {
      return true;
    }
  }

  return false;
}

/**
 * Check whether `is_baseline` is set to `true` on any option.
 * Reads from the `options[]` array on the V3 body.
 */
function checkIsBaselinePresent(v3Body: Record<string, unknown>): boolean {
  const options = v3Body.options as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(options)) return false;

  return options.some((opt) => opt?.is_baseline === true);
}
