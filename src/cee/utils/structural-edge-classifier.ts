/**
 * Structural Edge Classifier
 *
 * Shared helper for classifying graph edges as "structural" or "causal".
 *
 * Structural edges are definitional wiring — they connect the decision to its
 * options and options to their target factors. They carry hard
 * exists_probability = 1.0 and are excluded from causal diagnostics.
 *
 * Only two edge patterns are legal structural edges:
 *   - decision → option
 *   - option → factor
 *
 * All other edges (including forbidden patterns like option→outcome or
 * decision→factor) are classified as "causal" so they remain visible to
 * validation and diagnostics.
 *
 * @module cee/utils/structural-edge-classifier
 */

import { log } from "../../utils/telemetry.js";

/**
 * Classify an edge as structural or causal based on endpoint node kinds.
 *
 * Returns `"structural"` only for the two legal structural patterns:
 *   - `decision → option`
 *   - `option → factor`
 *
 * Returns `"causal"` for everything else, including:
 *   - Forbidden patterns (option→outcome, decision→factor, etc.)
 *   - Edges with unresolvable node kinds (missing from the node map)
 *
 * When an unexpected outbound edge from a decision/option node is detected
 * (e.g. option→outcome), a debug log is emitted to surface prompt or
 * transform bugs rather than hiding them.
 */
export function classifyEdgeByKind(
  fromKind: string | undefined,
  toKind: string | undefined,
  context?: { edgeFrom?: string; edgeTo?: string },
): "structural" | "causal" {
  // Unknown kinds → treat as causal (visible to validation)
  if (!fromKind || !toKind) return "causal";

  // Legal structural patterns
  if (fromKind === "decision" && toKind === "option") return "structural";
  if (fromKind === "option" && toKind === "factor") return "structural";

  // Log unexpected decision/option outbound edges that are NOT structural.
  // These indicate forbidden topology that should not be silently hidden.
  if (fromKind === "decision" || fromKind === "option") {
    log.debug({
      event: "cee.diagnostics.unexpected_structural_topology",
      from_kind: fromKind,
      to_kind: toKind,
      edge_from: context?.edgeFrom,
      edge_to: context?.edgeTo,
    }, `Unexpected ${fromKind}→${toKind} edge — not classified as structural`);
  }

  return "causal";
}

/**
 * Convenience predicate: returns `true` only for legal structural edges.
 */
export function isLegalStructuralEdge(
  fromKind: string | undefined,
  toKind: string | undefined,
): boolean {
  return classifyEdgeByKind(fromKind, toKind) === "structural";
}
