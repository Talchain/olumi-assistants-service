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
 * This normalizer bridges the gap by copying observed_state values to data
 * and deriving parameter_uncertainties for ISL sensitivity analysis.
 */

import type { GraphV1 } from '../../contracts/plot/engine.js';
import { logger } from '../../utils/simple-logger.js';
import { deriveValueUncertainty, type ExtractionType } from '../transforms/value-uncertainty-derivation.js';
import type { ParameterUncertainty } from '../transforms/schema-v2.js';

/**
 * Conservative default coefficient of variation (20%)
 * Used when factor has value but no extraction metadata
 */
const CONSERVATIVE_DEFAULT_CV = 0.2;

/**
 * Minimum std floor to avoid point mass
 */
const STD_FLOOR = 0.01;

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
 * Extended graph result with parameter uncertainties for ISL
 */
export interface NormalizedGraphForISL extends GraphV1 {
  parameter_uncertainties?: ParameterUncertainty[];
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
    value_std?: number;
  };
}

/**
 * Normalize a graph for ISL consumption.
 *
 * Ensures factor nodes have `data` populated from `observed_state` if needed.
 * Also derives `parameter_uncertainties` array for ISL sensitivity analysis.
 * This allows ISL to read factor values regardless of whether the input
 * graph uses V1 (data) or V3 (observed_state) format.
 *
 * @param graph - Input graph (may be V1 or V3 format)
 * @returns Normalized graph with data populated on factor nodes and parameter_uncertainties
 */
export function normalizeGraphForISL(graph: GraphV1): NormalizedGraphForISL {
  if (!graph || !graph.nodes) {
    return graph as NormalizedGraphForISL;
  }

  let normalizedCount = 0;
  const parameterUncertainties: ParameterUncertainty[] = [];

  // Deep clone nodes to avoid mutating the original
  const normalizedNodes = graph.nodes.map((node) => {
    const nodeWithState = node as unknown as NodeWithObservedState;

    // Only process factor nodes
    if (nodeWithState.kind !== 'factor') {
      return node;
    }

    // Get the effective value from data or observed_state
    const existingValue = nodeWithState.data?.value;
    const observedValue = nodeWithState.observed_state?.value;
    const effectiveValue = existingValue ?? observedValue;

    // Skip factors without values
    if (effectiveValue === undefined) {
      return node;
    }

    // Get extraction metadata for uncertainty derivation
    const extractionType = nodeWithState.data?.extractionType ??
      (nodeWithState.observed_state?.source === 'brief_extraction' ? 'explicit' : 'inferred');
    const confidence = nodeWithState.data?.confidence;
    const range = nodeWithState.data?.range;

    // Derive value_std
    let valueStd: number;

    if (nodeWithState.data?.value_std !== undefined) {
      // Already has std, use it
      valueStd = nodeWithState.data.value_std;
    } else if (confidence !== undefined) {
      // Has extraction metadata, use derivation formula
      const result = deriveValueUncertainty({
        value: effectiveValue,
        extractionType: extractionType as ExtractionType,
        confidence,
        rangeMin: range?.min,
        rangeMax: range?.max,
      });
      valueStd = result.valueStd;
    } else {
      // No metadata, use conservative default (20% of value)
      valueStd = Math.max(STD_FLOOR, CONSERVATIVE_DEFAULT_CV * Math.abs(effectiveValue));
    }

    // Add to parameter_uncertainties array
    parameterUncertainties.push({
      node_id: nodeWithState.id,
      std: valueStd,
      distribution: 'normal',
    });

    // If node already has data.value with all needed fields, just add value_std
    if (existingValue !== undefined) {
      return {
        ...node,
        data: {
          ...nodeWithState.data,
          value_std: valueStd,
        },
      };
    }

    // If node has observed_state.value, copy to data format with std
    normalizedCount++;
    return {
      ...node,
      data: {
        value: nodeWithState.observed_state!.value,
        baseline: nodeWithState.observed_state!.baseline,
        unit: nodeWithState.observed_state!.unit,
        extractionType: extractionType,
        value_std: valueStd,
      },
    };
  });

  if (normalizedCount > 0 || parameterUncertainties.length > 0) {
    logger.debug({
      event: 'isl.graph_normalized',
      normalized_count: normalizedCount,
      uncertainties_count: parameterUncertainties.length,
      total_nodes: graph.nodes.length,
      message: `Normalized ${normalizedCount} factor node(s), derived ${parameterUncertainties.length} uncertainty(ies)`,
    });
  }

  // Return graph with normalized nodes and parameter_uncertainties
  return {
    ...graph,
    nodes: normalizedNodes,
    parameter_uncertainties: parameterUncertainties.length > 0 ? parameterUncertainties : undefined,
  } as NormalizedGraphForISL;
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
