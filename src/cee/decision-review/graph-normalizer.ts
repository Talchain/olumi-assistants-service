/**
 * Graph Normalizer for ISL
 *
 * Transforms graphs with V3 `observed_state` to V1 `data` format for ISL compatibility.
 *
 * ISL expects GraphV1 format where factor nodes have:
 *   node.data: { value, baseline, unit, ... }
 *
 * CEE produces V3 format where factor nodes have:
 *   node.observed_state: { value, baseline, unit, source }
 *
 * This normalizer bridges the gap by copying observed_state values to data.
 */

import type { GraphV1 } from '../../contracts/plot/engine.js';
import { logger } from '../../utils/simple-logger.js';

/**
 * V3 observed_state format (may be present on nodes from CEE output)
 */
interface ObservedStateV3 {
  value: number;
  baseline?: number;
  unit?: string;
  source?: 'brief_extraction' | 'cee_inference';
}

/**
 * Extended node type that may have observed_state (V3) or data (V1)
 */
interface NodeWithObservedState {
  id: string;
  kind: string;
  label?: string;
  body?: string;
  title?: string;
  description?: string;
  observed_state?: ObservedStateV3;
  data?: {
    value?: number;
    baseline?: number;
    unit?: string;
    range?: { min?: number; max?: number };
    extractionType?: string;
    confidence?: number;
  };
}

/**
 * Normalize a graph for ISL consumption.
 *
 * Ensures factor nodes have `data` populated from `observed_state` if needed.
 * This allows ISL to read factor values regardless of whether the input
 * graph uses V1 (data) or V3 (observed_state) format.
 *
 * @param graph - Input graph (may be V1 or V3 format)
 * @returns Normalized graph with data populated on factor nodes
 */
export function normalizeGraphForISL(graph: GraphV1): GraphV1 {
  if (!graph || !graph.nodes) {
    return graph;
  }

  let normalizedCount = 0;

  // Deep clone nodes to avoid mutating the original
  const normalizedNodes = graph.nodes.map((node) => {
    const nodeWithState = node as unknown as NodeWithObservedState;

    // Only process factor nodes
    if (nodeWithState.kind !== 'factor') {
      return node;
    }

    // If node already has data.value, keep it as-is
    if (nodeWithState.data?.value !== undefined) {
      return node;
    }

    // If node has observed_state.value, copy to data format
    if (nodeWithState.observed_state?.value !== undefined) {
      normalizedCount++;

      // Create new node with data populated from observed_state
      return {
        ...node,
        data: {
          value: nodeWithState.observed_state.value,
          baseline: nodeWithState.observed_state.baseline,
          unit: nodeWithState.observed_state.unit,
          // Map source to extractionType for consistency
          extractionType: nodeWithState.observed_state.source === 'brief_extraction'
            ? 'explicit'
            : 'inferred',
        },
      };
    }

    return node;
  });

  if (normalizedCount > 0) {
    logger.debug({
      event: 'isl.graph_normalized',
      normalized_count: normalizedCount,
      total_nodes: graph.nodes.length,
      message: `Normalized ${normalizedCount} factor node(s) from observed_state to data format`,
    });
  }

  // Return graph with normalized nodes, cast to preserve type
  return {
    ...graph,
    nodes: normalizedNodes,
  } as GraphV1;
}

/**
 * Check if a graph has any factor nodes with values.
 *
 * Checks both V1 (data.value) and V3 (observed_state.value) formats.
 *
 * @param graph - Graph to check
 * @returns True if at least one factor node has a value
 */
export function hasFactorValues(graph: GraphV1): boolean {
  if (!graph || !graph.nodes) {
    return false;
  }

  return graph.nodes.some((node) => {
    const nodeWithState = node as unknown as NodeWithObservedState;

    if (nodeWithState.kind !== 'factor') {
      return false;
    }

    return (
      nodeWithState.data?.value !== undefined ||
      nodeWithState.observed_state?.value !== undefined
    );
  });
}

/**
 * Get factor value statistics for a graph.
 *
 * @param graph - Graph to analyze
 * @returns Statistics about factor values
 */
export function getFactorValueStats(graph: GraphV1): {
  factorCount: number;
  withValue: number;
  withDataValue: number;
  withObservedState: number;
  missingValue: number;
} {
  if (!graph || !graph.nodes) {
    return {
      factorCount: 0,
      withValue: 0,
      withDataValue: 0,
      withObservedState: 0,
      missingValue: 0,
    };
  }

  const factors = graph.nodes.filter((n) => n.kind === 'factor');
  let withDataValue = 0;
  let withObservedState = 0;

  for (const node of factors) {
    const nodeWithState = node as unknown as NodeWithObservedState;

    if (nodeWithState.data?.value !== undefined) {
      withDataValue++;
    }
    if (nodeWithState.observed_state?.value !== undefined) {
      withObservedState++;
    }
  }

  const withValue = new Set([
    ...factors.filter((n) => (n as unknown as NodeWithObservedState).data?.value !== undefined).map((n) => n.id),
    ...factors.filter((n) => (n as unknown as NodeWithObservedState).observed_state?.value !== undefined).map((n) => n.id),
  ]).size;

  return {
    factorCount: factors.length,
    withValue,
    withDataValue,
    withObservedState,
    missingValue: factors.length - withValue,
  };
}
