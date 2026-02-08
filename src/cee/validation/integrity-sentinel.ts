/**
 * CIL Phase 0 — Sentinel Integrity Checks
 *
 * Compares LLM raw graph output against the final V3 response to detect
 * silent data loss between pipeline stages. Debug-only, non-blocking.
 *
 * Gated on `config.cee.debugLoggingEnabled` — zero cost in production.
 *
 * Warning codes:
 * - CATEGORY_STRIPPED: factor node has category in raw but not in V3
 * - INTERVENTIONS_STRIPPED: option node has data.interventions in raw but V3 option interventions empty
 * - NODE_DROPPED: node in raw but missing from V3 (matched by normalised ID)
 * - SYNTHETIC_NODE_INJECTED: node in V3 but no corresponding raw node
 * - GOAL_THRESHOLD_STRIPPED: goal_threshold fields present in raw but absent in V3
 * - ENRICHMENT_STRIPPED: enrichment fields (raw_value/cap/factor_type/uncertainty_drivers) in raw but absent in V3 observed_state
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

/** Minimal shape of a raw LLM node (pre-transform). */
interface RawNode {
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

// ============================================================================
// ID Normalisation (for matching raw ↔ V3 nodes)
// ============================================================================

/**
 * Normalise an ID for matching between raw LLM output and V3 output.
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
 * Run sentinel integrity checks comparing LLM raw graph against V3 output.
 *
 * @param rawNodes - Nodes from the earliest raw LLM representation
 * @param v3Nodes - Nodes from the final V3 response
 * @param v3Options - Options from the final V3 response
 * @returns Array of integrity warnings (empty if everything matches)
 */
export function runIntegrityChecks(
  rawNodes: RawNode[],
  v3Nodes: V3Node[],
  v3Options: V3Option[],
): IntegrityWarning[] {
  const warnings: IntegrityWarning[] = [];

  // Build lookup maps by normalised ID.
  // Use arrays to handle collisions — multiple raw nodes may normalise to the
  // same key (e.g. dedup suffixes __2, __3 stripped by normaliseIdBase).
  const rawByNormId = new Map<string, RawNode[]>();
  for (const node of rawNodes) {
    const key = normaliseIdForMatch(node.id);
    const arr = rawByNormId.get(key) ?? [];
    arr.push(node);
    rawByNormId.set(key, arr);
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
  for (const [normId, rawArr] of rawByNormId) {
    if (!v3ByNormId.has(normId)) {
      for (const rawNode of rawArr) {
        warnings.push({
          code: "NODE_DROPPED",
          node_id: rawNode.id,
          details: `Node "${rawNode.id}" (kind=${rawNode.kind ?? "unknown"}) exists in LLM raw but missing from V3 output`,
        });
      }
    }
  }

  // ── Check 2: SYNTHETIC_NODE_INJECTED ───────────────────────────────────
  for (const [normId, v3Arr] of v3ByNormId) {
    if (!rawByNormId.has(normId)) {
      for (const v3Node of v3Arr) {
        warnings.push({
          code: "SYNTHETIC_NODE_INJECTED",
          node_id: v3Node.id,
          details: `Node "${v3Node.id}" (kind=${v3Node.kind ?? "unknown"}) in V3 output has no corresponding node in LLM raw`,
        });
      }
    }
  }

  // ── Per-node checks (matched pairs) ────────────────────────────────────
  // Compare the first raw node against the first V3 node for each normalised
  // key. When collisions exist, all raw entries are checked.
  for (const [normId, rawArr] of rawByNormId) {
    const v3Arr = v3ByNormId.get(normId);
    if (!v3Arr || v3Arr.length === 0) continue; // Already reported as NODE_DROPPED

    for (const rawNode of rawArr) {
      // Find best-matching V3 node (prefer exact ID match, fall back to first)
      const v3Node = v3Arr.find((n) => n.id === rawNode.id) ?? v3Arr[0];

      // ── Check 3: CATEGORY_STRIPPED ─────────────────────────────────────
      if (rawNode.category && !v3Node.category) {
        warnings.push({
          code: "CATEGORY_STRIPPED",
          node_id: rawNode.id,
          details: `Factor "${rawNode.id}" has category="${rawNode.category}" in LLM raw but category is absent in V3 output`,
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
        (f) => rawNode[f] !== undefined && v3Node[f] === undefined
      );
      if (strippedThresholds.length > 0) {
        warnings.push({
          code: "GOAL_THRESHOLD_STRIPPED",
          node_id: rawNode.id,
          details: `Node "${rawNode.id}" has ${strippedThresholds.join(", ")} in LLM raw but absent in V3 output`,
        });
      }

      // ── Check 5: ENRICHMENT_STRIPPED ────────────────────────────────────
      // Compare raw node data fields against V3 observed_state
      if (rawNode.data) {
        const enrichmentFields = [
          "raw_value",
          "cap",
          "factor_type",
          "uncertainty_drivers",
        ] as const;
        const strippedEnrichment = enrichmentFields.filter(
          (f) => rawNode.data![f] !== undefined &&
            (v3Node.observed_state === undefined || v3Node.observed_state[f] === undefined)
        );
        if (strippedEnrichment.length > 0) {
          warnings.push({
            code: "ENRICHMENT_STRIPPED",
            node_id: rawNode.id,
            details: `Node "${rawNode.id}" has ${strippedEnrichment.join(", ")} in LLM raw data but absent from V3 observed_state`,
          });
        }
      }

      // ── Check 6: INTERVENTIONS_STRIPPED ─────────────────────────────────
      // Only for option nodes: check if raw has data.interventions but V3 option is empty
      if (rawNode.kind === "option" && rawNode.data?.interventions) {
        const rawInterventionCount = Object.keys(rawNode.data.interventions).length;
        if (rawInterventionCount > 0) {
          const v3OptArr = v3OptionByNormId.get(normId) ?? [];
          const v3Option = v3OptArr.find((o) => o.id === rawNode.id) ?? v3OptArr[0];
          const v3InterventionCount = v3Option?.interventions
            ? Object.keys(v3Option.interventions).length
            : 0;
          if (v3InterventionCount === 0) {
            warnings.push({
              code: "INTERVENTIONS_STRIPPED",
              node_id: rawNode.id,
              details: `Option "${rawNode.id}" has ${rawInterventionCount} interventions in LLM raw but V3 option has 0 interventions`,
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

  return warnings;
}
