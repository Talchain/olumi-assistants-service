/**
 * Validation Pipeline — Shared Utilities
 *
 * Structural edge filtering and graph-structure extraction for Pass 2.
 * Centralises the definition of what constitutes a "structural" edge so the
 * same rule is used everywhere without duplication.
 */

import type { EdgeV3T, NodeV3T } from '../../schemas/cee-v3.js';
import { readEdgeParams } from '../unified-pipeline/utils/edge-format.js';
import type { Pass2NodeInput, Pass2EdgeInput } from './types.js';

// ============================================================================
// Structural edge detection
// ============================================================================

/**
 * Returns true if an edge is structural (decision→option or option→factor).
 *
 * Structural edges carry sentinel parameter values: mean=1.0, std=0.01, ep=1.0.
 * They are excluded from the validation pipeline because o4-mini should not
 * be asked to independently estimate these — they carry no epistemic content.
 *
 * Detection is based on parameter values rather than node kinds, so it reads
 * through `readEdgeParams` — the canonical owner of "which fields on this edge
 * hold its numbers".
 *
 * ⚠ THIS COMMENT USED TO ASSERT THE OPPOSITE, AND THE ASSERTION WAS FALSE:
 * "at the point the validation pipeline runs, we work with the V3 edge shape
 * which carries nested strength.mean". It does not. This pipeline runs at
 * Stage 4b, where the graph is still V1_FLAT; the nested shape is produced
 * later by `transformResponseToV3`. The old body read `edge.strength?.mean ?? 0`
 * on that false premise and therefore matched NOTHING on a real graph:
 * measured on the 19 Aug capture it skipped 0 of 7 structural edges in flat
 * shape against 7 of 7 in nested shape. The consequence is not cosmetic —
 * this predicate gates `index.ts:135` (which edges are sent to o4-mini) and
 * `index.ts:250` (which are skipped in comparison), so seven scaffolding edges
 * were being sent to a model the design says must never be asked to estimate
 * them. The comment is recorded here rather than deleted because a stale
 * premise left in place is what licenses the next reader to reintroduce
 * the `?? 0`.
 */
export function isStructuralEdge(edge: EdgeV3T): boolean {
  const p = readEdgeParams(edge);

  // Each field must be READABLE as well as sentinel-valued. This preserves the
  // old defaults' fail-closed behaviour (`std ?? 1` made an absent std
  // non-structural) without reintroducing a fabricated value to compare against.
  return (
    p.mean !== undefined && Math.abs(p.mean - 1.0) < 0.001 &&
    p.std !== undefined && p.std < 0.02 &&
    p.existence !== undefined && p.existence > 0.99
  );
}

// ============================================================================
// Graph structure extraction for Pass 2
// ============================================================================

/**
 * Extracts the minimal node and edge descriptors to send to o4-mini.
 *
 * Nodes: id, kind, label, and optionally category (all parameter values omitted).
 * Edges: from, to, and optionally label (strength and ep values omitted).
 * Structural edges (decision→option, option→factor) are excluded entirely.
 * Bidirected edges (unmeasured confounders) are also excluded.
 */
export function extractGraphStructureForPass2(
  nodes: NodeV3T[],
  edges: EdgeV3T[],
): { nodes: Pass2NodeInput[]; edges: Pass2EdgeInput[] } {
  const nodeInputs: Pass2NodeInput[] = nodes.map((n) => {
    const node: Pass2NodeInput = {
      id: n.id,
      kind: n.kind,
      label: n.label,
    };
    // Only include category when set — avoids sending undefined to the LLM.
    if (n.category) {
      node.category = n.category;
    }
    return node;
  });

  const edgeInputs: Pass2EdgeInput[] = edges
    .filter((e) => {
      // Exclude structural sentinel edges (decision→option, option→factor).
      if (isStructuralEdge(e)) return false;
      // Exclude bidirected edges (unmeasured confounders — not causal estimates).
      if (e.edge_type === 'bidirected') return false;
      return true;
    })
    .map((e) => {
      const edge: Pass2EdgeInput = { from: e.from, to: e.to };
      // Include label if present (passthrough field) — helps o4-mini understand
      // the relationship. Access via Record index to avoid an unsafe cast.
      const label = (e as Record<string, unknown>).label;
      if (typeof label === 'string' && label) edge.label = label;
      return edge;
    });

  return { nodes: nodeInputs, edges: edgeInputs };
}
