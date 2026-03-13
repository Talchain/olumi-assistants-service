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

export type CompactNodeSource = 'user' | 'assumption' | 'system';

export interface CompactNode {
  id: string;
  kind: string;
  label: string;
  type?: string;
  category?: string;
  value?: number;  // from observed_state.value
  raw_value?: number;  // from observed_state.raw_value
  unit?: string;       // from observed_state.unit
  cap?: number;        // from observed_state.cap
  /** Provenance: how this node's value was determined. */
  source?: CompactNodeSource;
  /** Human-readable summary of option interventions (option nodes only). */
  intervention_summary?: string;
}

export interface CompactEdge {
  from: string;
  to: string;
  strength: number;   // mean only
  exists: number;     // exists_probability (defaulted to 0.8 if absent)
  /** Human-readable causal interpretation (causal edges only, omitted for structural/bidirected). */
  plain_interpretation?: string;
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
// Helpers
// ============================================================================

/** Max interventions shown before truncation. */
const MAX_INTERVENTION_ENTRIES = 5;

/**
 * Build a human-readable intervention summary for an option node.
 * Format: "sets Label1=0.9, Label2=0.7" (capped at 5 entries).
 *
 * @param interventions - factor_id → numeric value map (from data.interventions)
 * @param labelMap - node id → label lookup built from graph nodes
 * @returns summary string, or undefined if no interventions
 */
function buildInterventionSummary(
  interventions: Record<string, number>,
  labelMap: Map<string, string>,
): string | undefined {
  const entries = Object.entries(interventions);
  if (entries.length === 0) return undefined;

  // Sort by key for determinism
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  // Only include interventions whose factor ID resolves to a label — never surface raw IDs
  const resolved = entries.filter(([factorId]) => labelMap.has(factorId));
  if (resolved.length === 0) return undefined;

  const shown = resolved.slice(0, MAX_INTERVENTION_ENTRIES);
  const remaining = resolved.length - shown.length;

  const parts = shown.map(([factorId, value]) => `${labelMap.get(factorId)!}=${value}`);

  let summary = `sets ${parts.join(', ')}`;
  if (remaining > 0) {
    summary += ` ...and ${remaining} more`;
  }
  return summary;
}

/**
 * Determine whether an edge is structural (non-causal) based on endpoint node kinds.
 * Structural edges connect decision→option or option→factor — they represent
 * graph connectivity, not causal influence.
 */
function isStructuralEdge(
  edge: GraphV3T['edges'][number],
  kindMap: Map<string, string>,
): boolean {
  const fromKind = kindMap.get(edge.from);
  const toKind = kindMap.get(edge.to);
  // decision→option or option→factor are structural
  if (fromKind === 'decision' && toKind === 'option') return true;
  if (fromKind === 'option') return true; // option→anything is structural
  return false;
}

/**
 * Derive a plain-language interpretation from edge parameters.
 *
 * Direction from effect_direction or sign of mean.
 * Magnitude from |mean|: [0.7, 1.0] strongly, [0.4, 0.7) moderately, [0.1, 0.4) weakly.
 * Confidence from std: [0.05, 0.10) high, [0.10, 0.20) moderate, [0.20, ∞) uncertain.
 *
 * Skips structural edges (by node kind), bidirected edges, and sub-threshold edges.
 */
function buildPlainInterpretation(
  edge: GraphV3T['edges'][number],
  labelMap: Map<string, string>,
  kindMap: Map<string, string>,
): string | undefined {
  // Skip bidirected edges
  const anyEdge = edge as Record<string, unknown>;
  if (anyEdge.edge_type === 'bidirected') return undefined;

  // Skip structural edges based on endpoint node kinds
  if (isStructuralEdge(edge, kindMap)) return undefined;

  const mean = edge.strength?.mean ?? 0;
  const std = edge.strength?.std ?? 0;

  // Skip zero-mean edges (no direction to interpret)
  if (mean === 0) return undefined;

  const absMean = Math.abs(mean);

  // Skip sub-threshold edges
  if (absMean < 0.1) return undefined;

  // Direction: prefer explicit effect_direction, fall back to sign of mean
  const direction = edge.effect_direction === 'positive' || edge.effect_direction === 'negative'
    ? edge.effect_direction
    : (mean > 0 ? 'positive' : 'negative');
  const verb = direction === 'positive' ? 'increases' : 'decreases';

  // Magnitude from |mean|: [0.7, 1.0] strongly, [0.4, 0.7) moderately, [0.1, 0.4) weakly
  let magnitude: string;
  if (absMean >= 0.7) {
    magnitude = 'strongly';
  } else if (absMean >= 0.4) {
    magnitude = 'moderately';
  } else {
    magnitude = 'weakly';
  }

  // Confidence from std: [0.05, 0.10) high, [0.10, 0.20) moderate, [0.20, ∞) uncertain
  let confidence: string;
  if (std >= 0.20) {
    confidence = '(uncertain)';
  } else if (std >= 0.10) {
    confidence = '(moderate confidence)';
  } else if (std >= 0.05) {
    confidence = '(high confidence)';
  } else {
    confidence = '';
  }

  const fromLabel = labelMap.get(edge.from) ?? edge.from;
  const toLabel = labelMap.get(edge.to) ?? edge.to;

  return `${fromLabel} ${magnitude} ${verb} ${toLabel}${confidence ? ' ' + confidence : ''}`;
}

// ============================================================================
// Compact Graph
// ============================================================================

/**
 * Compact a V3 graph for LLM context.
 *
 * Kept per node: id, kind, label, type (if present), category (if present),
 * observed_state.value, raw_value, unit, cap (if present), source (derived from extractionType),
 * intervention_summary (option nodes with data.interventions).
 *
 * Dropped per node: body, state_space, goal_threshold, observed_state.std,
 * observed_state.baseline, observed_state.extractionType (projected to source).
 *
 * Kept per edge: from, to, strength.mean, exists_probability (defaulted to 0.8),
 * plain_interpretation (causal edges only).
 * Dropped per edge: strength.std, effect_direction, label.
 *
 * Output is sorted: nodes by id, edges by from then to.
 */
export function compactGraph(graph: GraphV3T): GraphV3Compact {
  // Build lookup maps for resolving factor IDs to labels and node kinds
  const labelMap = new Map<string, string>();
  const kindMap = new Map<string, string>();
  for (const node of graph.nodes) {
    labelMap.set(node.id, node.label ?? node.id);
    kindMap.set(node.id, node.kind);
  }

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

      // observed_state fields: value, raw_value, unit, cap, extractionType → source
      if (node.observed_state !== undefined && node.observed_state !== null) {
        const obsState = node.observed_state as Record<string, unknown>;
        if (typeof obsState.value === 'number') {
          n.value = obsState.value;
        }
        if (typeof obsState.raw_value === 'number') {
          n.raw_value = obsState.raw_value;
        }
        if (typeof obsState.unit === 'string') {
          n.unit = obsState.unit;
        }
        if (typeof obsState.cap === 'number') {
          n.cap = obsState.cap;
        }

        // Provenance: derive from extractionType
        // explicit  → user      (value was stated directly by the user)
        // inferred  → assumption (value was derived/estimated by the LLM)
        // range/observed/absent → system (everything else is treated as system-provided)
        const et = obsState.extractionType;
        if (et === 'explicit') {
          n.source = 'user';
        } else if (et === 'inferred') {
          n.source = 'assumption';
        } else {
          n.source = 'system';
        }
      } else {
        // No observed_state — treat as system-derived
        n.source = 'system';
      }

      // Intervention summary for option nodes with data.interventions
      if (node.kind === 'option') {
        const data = anyNode.data as Record<string, unknown> | undefined;
        if (data && typeof data.interventions === 'object' && data.interventions !== null) {
          const summary = buildInterventionSummary(
            data.interventions as Record<string, number>,
            labelMap,
          );
          if (summary) {
            n.intervention_summary = summary;
          }
        }
      }

      return n;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const edges: CompactEdge[] = graph.edges
    .map((edge) => {
      const e: CompactEdge = {
        from: edge.from,
        to: edge.to,
        strength: edge.strength?.mean ?? 0,
        exists: edge.exists_probability ?? DEFAULT_EXISTS_PROBABILITY,
      };

      const interpretation = buildPlainInterpretation(edge, labelMap, kindMap);
      if (interpretation) {
        e.plain_interpretation = interpretation;
      }

      return e;
    })
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
