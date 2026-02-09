/**
 * CIL Phase 0.2 — Sentinel Integrity Checks
 *
 * Compares the post-pipeline V1 graph against the final V3 response to detect
 * silent data loss during the V3 transform. Debug-only, non-blocking.
 *
 * Note: "input"/"pipeline" refers to the post-pipeline V1 graph, not the
 * raw LLM output. Pre-pipeline losses (cycle breaking, isolated pruning,
 * graph compliance) are traced via corrections[], not the sentinel.
 * Phase 1 will capture actual LLM raw output for full-pipeline comparison.
 *
 * Gated by the debug bundle mechanism (observabilityEnabled / include_debug)
 * so sentinel output lands in debug bundles. Zero cost in production.
 *
 * Warning codes:
 * - CATEGORY_STRIPPED: factor node has category in input but not in V3
 * - INTERVENTIONS_STRIPPED: option node has data.interventions in input but V3 option interventions empty
 * - NODE_DROPPED: node in input but missing from V3 (matched by normalised ID)
 * - SYNTHETIC_NODE_INJECTED: node in V3 but no corresponding input node
 * - GOAL_THRESHOLD_STRIPPED: goal_threshold fields present in input but absent in V3
 * - ENRICHMENT_STRIPPED: enrichment fields (raw_value/cap/factor_type/uncertainty_drivers) in input but absent in V3 observed_state
 */

import { log } from "../../utils/telemetry.js";
import { normaliseIdBase } from "../utils/id-normalizer.js";
import { DEFAULT_STRENGTH_MEAN } from "../constants.js";

// ============================================================================
// Types
// ============================================================================

export interface IntegrityWarning {
  code: string;
  node_id?: string;
  edge_id?: string;
  details: string;
}

/**
 * Enriched sentinel output for debug bundles.
 *
 * Contains both individual warnings AND compact graph evidence so that
 * claims like "11 nodes became 8" are provable from a single bundle.
 */
export interface IntegrityWarningsOutput {
  warnings: IntegrityWarning[];
  /** Post-pipeline V1 graph summary (input to V3 transform) */
  input_counts: {
    node_count: number;
    edge_count: number;
    node_ids: string[];
  };
  /** Final CEE V3 output counts */
  output_counts: {
    node_count: number;
    edge_count: number;
    node_ids: string[];
  };
  /** CIL Phase 1: Strength default detection */
  strength_defaults: {
    detected: boolean;
    total_edges: number;
    defaulted_count: number;
    default_value: number | null;  // null if no defaulting detected
  };
  /**
   * @deprecated Use input_counts instead. Removal target: Phase 2 or v2.0.0.
   * Backward compatibility shim added in Phase 0.2 — raw_counts is an alias for input_counts.
   */
  raw_counts?: {
    node_count: number;
    edge_count: number;
    node_ids: string[];
  };
}

/** Minimal shape of a pipeline V1 node (input to V3 transform). */
interface InputNode {
  id: string;
  kind?: string;
  category?: string;
  goal_threshold?: number;
  goal_threshold_raw?: number;
  goal_threshold_unit?: string;
  goal_threshold_cap?: number;
  data?: {
    value?: number;
    raw_value?: number;
    cap?: number;
    factor_type?: string;
    uncertainty_drivers?: string[];
    interventions?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Minimal shape of a V3 output node. */
interface V3Node {
  id: string;
  kind?: string;
  category?: string;
  goal_threshold?: number;
  goal_threshold_raw?: number;
  goal_threshold_unit?: string;
  goal_threshold_cap?: number;
  observed_state?: {
    raw_value?: number;
    cap?: number;
    factor_type?: string;
    uncertainty_drivers?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Minimal shape of a V3 option. */
interface V3Option {
  id: string;
  interventions?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Minimal shape of a pipeline V1 edge (input to V3 transform). */
interface InputEdge {
  from: string;
  to: string;
  [key: string]: unknown;
}

/** Minimal shape of a V3 output edge. Must match EdgeV3 schema field names (from/to). */
interface V3Edge {
  from: string;
  to: string;
  [key: string]: unknown;
}

// ============================================================================
// ID Normalisation (for matching pipeline V1 ↔ V3 nodes)
// ============================================================================

/**
 * Normalise an ID for matching between pipeline V1 input and V3 output.
 *
 * Delegates to the production normaliseIdBase (steps 1-7 of normalizeToId,
 * without dedup suffix) so that matching uses the exact same algorithm that
 * produced the V3 IDs. This avoids false NODE_DROPPED / SYNTHETIC_NODE_INJECTED
 * warnings from normalisation divergence.
 */
export function normaliseIdForMatch(id: string): string {
  return normaliseIdBase(id);
}

// ============================================================================
// Core Check
// ============================================================================

/**
 * Run sentinel integrity checks comparing pipeline V1 graph against V3 output.
 *
 * Note: "input"/"pipeline" refers to the post-pipeline V1 graph, not the
 * raw LLM output. Pre-pipeline losses (cycle breaking, isolated pruning,
 * graph compliance) are traced via corrections[], not the sentinel.
 * Phase 1 will capture actual LLM raw output for full-pipeline comparison.
 *
 * Returns an enriched output containing both individual warnings and compact
 * graph evidence (input_counts / output_counts) so that node/edge delta claims
 * are provable from a single debug bundle.
 *
 * @param inputNodes - Nodes from the post-pipeline V1 graph (input to V3 transform)
 * @param v3Nodes - Nodes from the final V3 response
 * @param v3Options - Options from the final V3 response
 * @param inputEdges - Edges from the post-pipeline V1 graph (optional)
 * @param v3Edges - Edges from the final V3 response (optional)
 * @returns IntegrityWarningsOutput with warnings + evidence counts
 */
export function runIntegrityChecks(
  inputNodes: InputNode[],
  v3Nodes: V3Node[],
  v3Options: V3Option[],
  inputEdges: InputEdge[] = [],
  v3Edges: V3Edge[] = [],
): IntegrityWarningsOutput {
  const warnings: IntegrityWarning[] = [];

  // Build lookup maps by normalised ID.
  // Use arrays to handle collisions — multiple input nodes may normalise to the
  // same key (e.g. dedup suffixes __2, __3 stripped by normaliseIdBase).
  const inputByNormId = new Map<string, InputNode[]>();
  for (const node of inputNodes) {
    const key = normaliseIdForMatch(node.id);
    const arr = inputByNormId.get(key) ?? [];
    arr.push(node);
    inputByNormId.set(key, arr);
  }

  const v3ByNormId = new Map<string, V3Node[]>();
  for (const node of v3Nodes) {
    const key = normaliseIdForMatch(node.id);
    const arr = v3ByNormId.get(key) ?? [];
    arr.push(node);
    v3ByNormId.set(key, arr);
  }

  // Build V3 options lookup by normalised ID
  const v3OptionByNormId = new Map<string, V3Option[]>();
  for (const opt of v3Options) {
    const key = normaliseIdForMatch(opt.id);
    const arr = v3OptionByNormId.get(key) ?? [];
    arr.push(opt);
    v3OptionByNormId.set(key, arr);
  }

  // ── Check 1: NODE_DROPPED ──────────────────────────────────────────────
  for (const [normId, inputArr] of inputByNormId) {
    if (!v3ByNormId.has(normId)) {
      for (const inputNode of inputArr) {
        warnings.push({
          code: "NODE_DROPPED",
          node_id: inputNode.id,
          details: `Node "${inputNode.id}" (kind=${inputNode.kind ?? "unknown"}) exists in pipeline input but missing from V3 output`,
        });
      }
    }
  }

  // ── Check 2: SYNTHETIC_NODE_INJECTED ───────────────────────────────────
  for (const [normId, v3Arr] of v3ByNormId) {
    if (!inputByNormId.has(normId)) {
      for (const v3Node of v3Arr) {
        warnings.push({
          code: "SYNTHETIC_NODE_INJECTED",
          node_id: v3Node.id,
          details: `Node "${v3Node.id}" (kind=${v3Node.kind ?? "unknown"}) in V3 output has no corresponding node in pipeline input`,
        });
      }
    }
  }

  // ── Per-node checks (matched pairs) ────────────────────────────────────
  // Compare each input node against the corresponding V3 node for each normalised
  // key. When collisions exist, all input entries are checked.
  for (const [normId, inputArr] of inputByNormId) {
    const v3Arr = v3ByNormId.get(normId);
    if (!v3Arr || v3Arr.length === 0) continue; // Already reported as NODE_DROPPED

    for (const inputNode of inputArr) {
      // Find best-matching V3 node (prefer exact ID match, fall back to first)
      const v3Node = v3Arr.find((n) => n.id === inputNode.id) ?? v3Arr[0];

      // ── Check 3: CATEGORY_STRIPPED ─────────────────────────────────────
      if (inputNode.category && !v3Node.category) {
        warnings.push({
          code: "CATEGORY_STRIPPED",
          node_id: inputNode.id,
          details: `Factor "${inputNode.id}" has category="${inputNode.category}" in pipeline input but category is absent in V3 output`,
        });
      }

      // ── Check 4: GOAL_THRESHOLD_STRIPPED ────────────────────────────────
      const thresholdFields = [
        "goal_threshold",
        "goal_threshold_raw",
        "goal_threshold_unit",
        "goal_threshold_cap",
      ] as const;
      const strippedThresholds = thresholdFields.filter(
        (f) => inputNode[f] !== undefined && v3Node[f] === undefined
      );
      if (strippedThresholds.length > 0) {
        warnings.push({
          code: "GOAL_THRESHOLD_STRIPPED",
          node_id: inputNode.id,
          details: `Node "${inputNode.id}" has ${strippedThresholds.join(", ")} in pipeline input but absent in V3 output`,
        });
      }

      // ── Check 5: ENRICHMENT_STRIPPED ────────────────────────────────────
      // Compare input node data fields against V3 observed_state
      if (inputNode.data) {
        const enrichmentFields = [
          "raw_value",
          "cap",
          "factor_type",
          "uncertainty_drivers",
        ] as const;
        const strippedEnrichment = enrichmentFields.filter(
          (f) => inputNode.data![f] !== undefined &&
            (v3Node.observed_state === undefined || v3Node.observed_state[f] === undefined)
        );
        if (strippedEnrichment.length > 0) {
          warnings.push({
            code: "ENRICHMENT_STRIPPED",
            node_id: inputNode.id,
            details: `Node "${inputNode.id}" has ${strippedEnrichment.join(", ")} in pipeline input data but absent from V3 observed_state`,
          });
        }
      }

      // ── Check 6: INTERVENTIONS_STRIPPED ─────────────────────────────────
      // Only for option nodes: check if input has data.interventions but V3 option is empty
      if (inputNode.kind === "option" && inputNode.data?.interventions) {
        const inputInterventionCount = Object.keys(inputNode.data.interventions).length;
        if (inputInterventionCount > 0) {
          const v3OptArr = v3OptionByNormId.get(normId) ?? [];
          const v3Option = v3OptArr.find((o) => o.id === inputNode.id) ?? v3OptArr[0];
          const v3InterventionCount = v3Option?.interventions
            ? Object.keys(v3Option.interventions).length
            : 0;
          if (v3InterventionCount === 0) {
            warnings.push({
              code: "INTERVENTIONS_STRIPPED",
              node_id: inputNode.id,
              details: `Option "${inputNode.id}" has ${inputInterventionCount} interventions in pipeline input but V3 option has 0 interventions`,
            });
          }
        }
      }
    }
  }

  // ── CIL Phase 1: Strength Default Detection ────────────────────────────
  // Note: STRENGTH_DEFAULT_APPLIED warning is added to validation_warnings in
  // schema-v3.ts (production-enabled, not debug-gated). Here we only populate
  // the counter for debug bundle evidence.
  const strengthDefaults = detectStrengthDefaults(v3Nodes, v3Edges);

  if (warnings.length > 0) {
    log.info(
      {
        warning_count: warnings.length,
        codes: [...new Set(warnings.map((w) => w.code))],
        event: "cee.integrity_sentinel.warnings_detected",
      },
      `Integrity sentinel detected ${warnings.length} warning(s)`,
    );
  }

  return {
    warnings,
    input_counts: {
      node_count: inputNodes.length,
      edge_count: inputEdges.length,
      node_ids: inputNodes.map((n) => n.id),
    },
    output_counts: {
      node_count: v3Nodes.length,
      edge_count: v3Edges.length,
      node_ids: v3Nodes.map((n) => n.id),
    },
    strength_defaults: {
      detected: strengthDefaults.detected,
      total_edges: strengthDefaults.total_edges,
      defaulted_count: strengthDefaults.defaulted_count,
      default_value: strengthDefaults.default_value,
    },
    // Backward compatibility shim (deprecated, remove in Phase 2)
    raw_counts: {
      node_count: inputNodes.length,
      edge_count: inputEdges.length,
      node_ids: inputNodes.map((n) => n.id),
    },
  };
}

// ============================================================================
// Strength Default Detection (CIL Phase 1)
// ============================================================================

/** Result of strength default detection. */
export interface StrengthDefaultsResult {
  /** Whether uniform defaulting was detected (≥80% threshold met) */
  detected: boolean;
  /** Total number of causal edges analyzed (excludes structural edges) */
  total_edges: number;
  /** Count of edges with default strength value (0.5) */
  defaulted_count: number;
  /** The default value detected, or null if no defaulting */
  default_value: number | null;
}

/**
 * Detect uniform strength defaults in V3 edges.
 *
 * Checks if ≥80% of causal edges have strength_mean === 0.5, indicating the
 * LLM did not output varied strength coefficients (strength data was missing
 * and fell back to the default in schema-v3.ts).
 *
 * Excludes structural edges (decision→option, option→*) from analysis,
 * as these are synthetic edges added by the pipeline, not LLM output.
 *
 * Minimum threshold: 3 edges required to avoid false positives on tiny graphs.
 *
 * @param v3Nodes - V3 nodes (used to identify option nodes)
 * @param v3Edges - V3 edges to analyze
 * @returns Detection result with counts and detected flag
 */
export function detectStrengthDefaults(
  v3Nodes: V3Node[],
  v3Edges: V3Edge[],
): StrengthDefaultsResult {
  const THRESHOLD = 0.8; // 80%
  const MIN_EDGES = 3; // Minimum edges required for detection

  // Build lookup maps for O(1) node kind checks (performance optimization)
  const nodeKindMap = new Map<string, string>();
  for (const node of v3Nodes) {
    if (node.kind) {
      nodeKindMap.set(node.id, node.kind);
    }
  }

  const optionIds = new Set(
    v3Nodes.filter((n) => n.kind === "option").map((n) => n.id)
  );

  // Filter to causal edges only (exclude structural edges)
  const causalEdges = v3Edges.filter((edge) => {
    const edgeData = edge as { from: string; to: string; [key: string]: unknown };

    // Defensively exclude edges with missing nodes (malformed graphs)
    const fromKind = nodeKindMap.get(edgeData.from);
    const toKind = nodeKindMap.get(edgeData.to);
    if (!fromKind || !toKind) return false; // Missing from or to node - exclude

    // Option nodes are organisational (not causal). Per Platform Contract v2.6 Appendix A,
    // option nodes do not participate in inference. All option-outgoing edges are synthetic
    // pipeline edges and excluded from strength quality analysis.
    if (optionIds.has(edgeData.from)) return false;

    // Exclude decision→option edges (synthetic pipeline edges)
    const isDecisionToOption = fromKind === "decision" && optionIds.has(edgeData.to);
    if (isDecisionToOption) return false;

    return true;
  });

  const totalEdges = causalEdges.length;

  // If too few edges, don't flag as issue (avoid false positives)
  if (totalEdges < MIN_EDGES) {
    return {
      detected: false,
      total_edges: totalEdges,
      defaulted_count: 0,
      default_value: null,
    };
  }

  // Count edges with default strength value (both positive and negative)
  // Use Math.abs() because transform applies sign adjustment based on effect_direction,
  // so defaulted edges may be +0.5 or -0.5 depending on polarity.
  let defaultedCount = 0;
  for (const edge of causalEdges) {
    const edgeData = edge as { strength_mean?: number; [key: string]: unknown };
    const strengthMean = edgeData.strength_mean;

    if (strengthMean !== undefined && Math.abs(strengthMean) === DEFAULT_STRENGTH_MEAN) {
      defaultedCount++;
    }
  }

  const defaultPercentage = defaultedCount / totalEdges;
  const detected = defaultPercentage >= THRESHOLD;

  return {
    detected,
    total_edges: totalEdges,
    defaulted_count: defaultedCount,
    default_value: detected ? DEFAULT_STRENGTH_MEAN : null,
  };
}
