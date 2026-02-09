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
  };
}
