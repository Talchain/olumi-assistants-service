/**
 * Structural Edge Normaliser
 *
 * Coerces option→factor edges to canonical values before validation.
 * These edges represent structural wiring (not causal beliefs) and must have
 * deterministic values. The LLM occasionally generates non-canonical values
 * (e.g., mean=0.95 instead of 1.0) which would trigger validation errors.
 *
 * This normaliser runs AFTER Zod parsing but BEFORE graph validation,
 * ensuring structural edges always pass the STRUCTURAL_EDGE_NOT_CANONICAL_ERROR check.
 *
 * @module cee/structural-edge-normaliser
 */

import type { GraphT } from "../schemas/graph.js";
import { CANONICAL_EDGE } from "../validators/graph-validator.types.js";
import { log } from "../utils/telemetry.js";

// =============================================================================
// Types
// =============================================================================

export interface StructuralEdgeNormaliseResult {
  /** The graph with normalised structural edges */
  graph: GraphT;
  /** Count of edges that were normalised */
  normalisedCount: number;
  /** Details of each normalised edge for observability */
  normalisedEdges: NormalisedEdgeRecord[];
}

export interface NormalisedEdgeRecord {
  edgeId: string;
  from: string;
  to: string;
  original: {
    mean?: number;
    std?: number;
    prob?: number;
    direction?: string;
  };
  canonical: {
    mean: number;
    std: number;
    prob: number;
    direction: string;
  };
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Normalise option→factor edges to canonical values.
 *
 * Only modifies edges where:
 * - `from` node has `kind === 'option'`
 * - `to` node has `kind === 'factor'`
 *
 * All other edges (factor→factor, factor→goal, etc.) are left untouched.
 *
 * @param graph - The parsed graph from LLM
 * @returns Graph with normalised structural edges and observability metadata
 */
export function normaliseStructuralEdges(graph: GraphT): StructuralEdgeNormaliseResult {
  // Build node kind lookup map
  const nodeKindMap = new Map<string, string>();
  for (const node of graph.nodes) {
    nodeKindMap.set(node.id, node.kind);
  }

  const normalisedEdges: NormalisedEdgeRecord[] = [];

  const edges = graph.edges.map((edge) => {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);

    // Only normalise option→factor edges (structural wiring)
    if (fromKind !== "option" || toKind !== "factor") {
      return edge;
    }

    // Extract current values (handle various field names)
    const currentMean = edge.strength_mean ?? (edge as any).weight;
    const currentStd = edge.strength_std;
    const currentProb = edge.belief_exists ?? (edge as any).belief;
    const currentDirection = edge.effect_direction;

    // Check if already canonical
    const isCanonical =
      currentMean === CANONICAL_EDGE.mean &&
      currentStd === CANONICAL_EDGE.std &&
      currentProb === CANONICAL_EDGE.prob &&
      currentDirection === CANONICAL_EDGE.direction;

    if (isCanonical) {
      return edge;
    }

    // Record what we're normalising for observability
    const edgeId = (edge as any).id ?? `${edge.from}->${edge.to}`;
    normalisedEdges.push({
      edgeId,
      from: edge.from,
      to: edge.to,
      original: {
        mean: currentMean,
        std: currentStd,
        prob: currentProb,
        direction: currentDirection,
      },
      canonical: {
        mean: CANONICAL_EDGE.mean,
        std: CANONICAL_EDGE.std,
        prob: CANONICAL_EDGE.prob,
        direction: CANONICAL_EDGE.direction,
      },
    });

    // Return edge with canonical values
    return {
      ...edge,
      strength_mean: CANONICAL_EDGE.mean,
      strength_std: CANONICAL_EDGE.std,
      belief_exists: CANONICAL_EDGE.prob,
      effect_direction: CANONICAL_EDGE.direction,
    };
  });

  // Log if any edges were normalised
  if (normalisedEdges.length > 0) {
    log.info(
      {
        event: "STRUCTURAL_EDGE_NORMALISED",
        count: normalisedEdges.length,
        edges: normalisedEdges.map((e) => ({
          edge_from: e.from,
          edge_to: e.to,
          original_values: e.original,
          canonical_values: e.canonical,
        })),
      },
      `Normalised ${normalisedEdges.length} structural edge(s) to canonical values`
    );
  }

  return {
    graph: { ...graph, edges },
    normalisedCount: normalisedEdges.length,
    normalisedEdges,
  };
}
