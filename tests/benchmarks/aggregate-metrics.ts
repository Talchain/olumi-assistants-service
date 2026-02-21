/**
 * Per-Brief Aggregate Metrics (Task 4)
 *
 * - Does the option set change across runs? (count, labels)
 * - Would the recommended option likely change? (stub for ISL)
 */

import type { NodeV3T, OptionV3T } from "../../src/schemas/cee-v3.js";
import { normaliseLabel } from "./matching.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptionSetStability {
  /** Are option counts identical across all runs? */
  count_stable: boolean;
  /** Per-run option counts */
  counts: number[];
  /** Are option label sets identical across all runs? */
  labels_stable: boolean;
  /** Union of all option labels seen */
  all_labels: string[];
  /** Labels that appear in every run */
  common_labels: string[];
  /** Labels that appear in some but not all runs */
  varying_labels: string[];
}

export interface BriefAggregateMetrics {
  brief_id: string;
  option_set_stability: OptionSetStability;
  /**
   * Stub: ISL outcome stability (Task 7).
   * Set to `null` (not `undefined`) so it appears in JSON output as a stable
   * schema placeholder. ISL team populates this field separately.
   */
  isl_outcome_stability: ISLOutcomeStabilityStub | null;
}

/** Task 7 stub — ISL team implements actual computation */
export interface ISLOutcomeStabilityStub {
  recommended_option_changes: boolean;
  outcome_mean_cv: number;
  option_rank_stability: number;
}

// ---------------------------------------------------------------------------
// Option Set Extraction
// ---------------------------------------------------------------------------

interface RunResponse {
  nodes?: NodeV3T[];
  options?: OptionV3T[];
}

/**
 * Extract normalised option labels from a CEE response.
 * Prefers top-level options[], falls back to option-kind nodes.
 */
function extractOptionLabels(response: RunResponse): string[] {
  // Prefer top-level options array (V3)
  if (response.options && response.options.length > 0) {
    return response.options
      .map((o) => normaliseLabel(o.label))
      .sort();
  }
  // Fallback: option-kind nodes
  if (response.nodes) {
    return response.nodes
      .filter((n) => n.kind === "option")
      .map((n) => normaliseLabel(n.label))
      .sort();
  }
  return [];
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute aggregate metrics for a brief across multiple run responses.
 */
export function computeAggregateMetrics(
  briefId: string,
  responses: RunResponse[],
): BriefAggregateMetrics {
  const perRunLabels = responses.map(extractOptionLabels);
  const perRunCounts = perRunLabels.map((labels) => labels.length);

  // Count stability
  const countStable = new Set(perRunCounts).size === 1;

  // Label stability
  const allLabelsSet = new Set<string>();
  for (const labels of perRunLabels) {
    for (const l of labels) allLabelsSet.add(l);
  }
  const allLabels = [...allLabelsSet].sort();

  const commonLabels = allLabels.filter((label) =>
    perRunLabels.every((runLabels) => runLabels.includes(label)),
  );
  const varyingLabels = allLabels.filter((label) =>
    !perRunLabels.every((runLabels) => runLabels.includes(label)),
  );
  const labelsStable = varyingLabels.length === 0;

  return {
    brief_id: briefId,
    option_set_stability: {
      count_stable: countStable,
      counts: perRunCounts,
      labels_stable: labelsStable,
      all_labels: allLabels,
      common_labels: commonLabels,
      varying_labels: varyingLabels,
    },
    // ISL stub — null placeholder so field appears in JSON output
    isl_outcome_stability: null,
  };
}
