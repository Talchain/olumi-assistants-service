/**
 * Graph Compact Serialisation
 *
 * Produces a deterministic, compact representation of GraphV3 for LLM context.
 * Full graph goes to PLoT; this compact form fits the context budget.
 *
 * Output is deterministic: same graph input → byte-identical JSON output.
 * Nodes sorted by id, edges sorted by from then to.
 *
 * Token budget target: ~800–1200 tokens for a 10-node, 15-edge graph
 * (vs 3000–5000 for full GraphV3).
 */

import type { GraphV3T } from "../../schemas/cee-v3.js";
import { DEFAULT_EXISTS_PROBABILITY } from "./constants.js";

// ============================================================================
// Output Types
// ============================================================================

export interface CompactNode {
  id: string;
  kind: string;
  label: string;
  type?: string;
  category?: string;
  value?: number;  // from observed_state.value
}

export interface CompactEdge {
  from: string;
  to: string;
  strength: number;   // mean only
  exists: number;     // exists_probability (defaulted to 0.8 if absent)
}

export interface GraphV3Compact {
  nodes: CompactNode[];
  edges: CompactEdge[];
  _node_count: number;  // convenience for template/logging
  _edge_count: number;
}

// Re-export so existing importers of this module don't break
export { DEFAULT_EXISTS_PROBABILITY } from "./constants.js";

// ============================================================================
// Compact Graph
// ============================================================================

/**
 * Compact a V3 graph for LLM context.
 *
 * Kept per node: id, kind, label, type (if present), category (if present),
 * observed_state.value (if present).
 *
 * Dropped per node: body, state_space, goal_threshold, observed_state.std,
 * observed_state.baseline, observed_state.unit, observed_state.source.
 *
 * Kept per edge: from, to, strength.mean, exists_probability (defaulted to 0.8).
 * Dropped per edge: strength.std, effect_direction, label.
 *
 * Output is sorted: nodes by id, edges by from then to.
 */
export function compactGraph(graph: GraphV3T): GraphV3Compact {
  const nodes: CompactNode[] = graph.nodes
    .map((node) => {
      const n: CompactNode = {
        id: node.id,
        kind: node.kind,
        label: node.label ?? node.id,
      };

      // type — not in canonical NodeV3T schema but may be present via passthrough
      const anyNode = node as Record<string, unknown>;
      if (typeof anyNode.type === 'string') {
        n.type = anyNode.type;
      }

      // category
      if (node.category) {
        n.category = node.category;
      }

      // observed_state.value only
      if (node.observed_state !== undefined && node.observed_state !== null) {
        const obsState = node.observed_state as Record<string, unknown>;
        if (typeof obsState.value === 'number') {
          n.value = obsState.value;
        }
      }

      return n;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges: CompactEdge[] = graph.edges
    .map((edge) => ({
      from: edge.from,
      to: edge.to,
      strength: edge.strength?.mean ?? 0,
      exists: edge.exists_probability ?? DEFAULT_EXISTS_PROBABILITY,
    }))
    .sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      if (fromCmp !== 0) return fromCmp;
      return a.to.localeCompare(b.to);
    });

  return {
    nodes,
    edges,
    _node_count: nodes.length,
    _edge_count: edges.length,
  };
}
