/**
 * Graph Normalizer Tests
 *
 * Tests for normalizing graphs with V3 observed_state to V1 data format for ISL.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeGraphForISL,
  hasFactorValues,
  getFactorValueStats,
} from '../../src/cee/decision-review/graph-normalizer.js';
import type { GraphV1 } from '../../src/contracts/plot/engine.js';

describe('normalizeGraphForISL', () => {
  describe('V3 observed_state → V1 data transformation', () => {
    it('converts observed_state to data format for factor nodes', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test Goal',
          },
          {
            id: 'fac_price',
            kind: 'factor',
            label: 'Price Factor',
            // V3 format: observed_state instead of data
            observed_state: {
              value: 49,
              baseline: 49,
              unit: '£',
              source: 'brief_extraction',
            },
          } as unknown as GraphV1['nodes'][0],
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      // Factor node should now have data field
      const factorNode = normalized.nodes.find((n) => n.id === 'fac_price');
      expect(factorNode).toBeDefined();
      expect(factorNode?.data).toBeDefined();
      expect(factorNode?.data?.value).toBe(49);
      expect(factorNode?.data?.baseline).toBe(49);
      expect(factorNode?.data?.unit).toBe('£');
      expect(factorNode?.data?.extractionType).toBe('explicit');
    });

    it('preserves existing data field when present', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_price',
            kind: 'factor',
            label: 'Price Factor',
            // V1 format: already has data
            data: {
              value: 59,
              baseline: 49,
              unit: '£',
            },
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      const factorNode = normalized.nodes.find((n) => n.id === 'fac_price');
      expect(factorNode?.data?.value).toBe(59); // Unchanged
    });

    it('does not add data to non-factor nodes', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Test Goal',
          },
          {
            id: 'outcome_1',
            kind: 'outcome',
            label: 'Test Outcome',
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      expect(normalized.nodes[0].data).toBeUndefined();
      expect(normalized.nodes[1].data).toBeUndefined();
    });

    it('handles factor nodes without observed_state or data', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_abstract',
            kind: 'factor',
            label: 'Abstract Factor',
            // No data or observed_state
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      const factorNode = normalized.nodes.find((n) => n.id === 'fac_abstract');
      expect(factorNode?.data).toBeUndefined();
    });

    it('maps inferred source to inferred extractionType', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_inferred',
            kind: 'factor',
            label: 'Inferred Factor',
            observed_state: {
              value: 100,
              source: 'cee_inference',
            },
          } as unknown as GraphV1['nodes'][0],
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      const factorNode = normalized.nodes.find((n) => n.id === 'fac_inferred');
      expect(factorNode?.data?.extractionType).toBe('inferred');
    });
  });

  describe('edge cases', () => {
    it('handles null graph', () => {
      // @ts-expect-error - testing null input
      const result = normalizeGraphForISL(null);
      expect(result).toBeNull();
    });

    it('handles undefined graph', () => {
      // @ts-expect-error - testing undefined input
      const result = normalizeGraphForISL(undefined);
      expect(result).toBeUndefined();
    });

    it('handles graph with no nodes', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [],
        edges: [],
      };

      const result = normalizeGraphForISL(graph);
      expect(result.nodes).toEqual([]);
    });

    it('does not mutate original graph', () => {
      const original: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_price',
            kind: 'factor',
            label: 'Price',
            observed_state: { value: 49 },
          } as unknown as GraphV1['nodes'][0],
        ],
        edges: [],
      };

      const originalNode = original.nodes[0];
      const normalized = normalizeGraphForISL(original);

      // Original should be unchanged
      expect(originalNode.data).toBeUndefined();
      // Normalized should have data
      expect(normalized.nodes[0].data).toBeDefined();
    });
  });
});

describe('hasFactorValues', () => {
  it('returns true when factor has data.value', () => {
    const graph: GraphV1 = {
      version: '1',
      default_seed: 42,
      nodes: [
        {
          id: 'fac_1',
          kind: 'factor',
          label: 'Factor',
          data: { value: 100 },
        },
      ],
      edges: [],
    };

    expect(hasFactorValues(graph)).toBe(true);
  });

  it('returns true when factor has observed_state.value', () => {
    const graph: GraphV1 = {
      version: '1',
      default_seed: 42,
      nodes: [
        {
          id: 'fac_1',
          kind: 'factor',
          label: 'Factor',
          observed_state: { value: 100 },
        } as unknown as GraphV1['nodes'][0],
      ],
      edges: [],
    };

    expect(hasFactorValues(graph)).toBe(true);
  });

  it('returns false when no factors have values', () => {
    const graph: GraphV1 = {
      version: '1',
      default_seed: 42,
      nodes: [
        {
          id: 'fac_1',
          kind: 'factor',
          label: 'Factor without value',
        },
        {
          id: 'goal_1',
          kind: 'goal',
          label: 'Goal',
        },
      ],
      edges: [],
    };

    expect(hasFactorValues(graph)).toBe(false);
  });

  it('returns false for empty graph', () => {
    const graph: GraphV1 = {
      version: '1',
      default_seed: 42,
      nodes: [],
      edges: [],
    };

    expect(hasFactorValues(graph)).toBe(false);
  });
});

describe('getFactorValueStats', () => {
  it('returns correct stats for mixed graph', () => {
    const graph: GraphV1 = {
      version: '1',
      default_seed: 42,
      nodes: [
        // Factor with data.value
        {
          id: 'fac_1',
          kind: 'factor',
          label: 'Factor 1',
          data: { value: 100 },
        },
        // Factor with observed_state.value
        {
          id: 'fac_2',
          kind: 'factor',
          label: 'Factor 2',
          observed_state: { value: 200 },
        } as unknown as GraphV1['nodes'][0],
        // Factor without value
        {
          id: 'fac_3',
          kind: 'factor',
          label: 'Factor 3',
        },
        // Non-factor node
        {
          id: 'goal_1',
          kind: 'goal',
          label: 'Goal',
        },
      ],
      edges: [],
    };

    const stats = getFactorValueStats(graph);

    expect(stats.factorCount).toBe(3);
    expect(stats.withValue).toBe(2);
    expect(stats.withDataValue).toBe(1);
    expect(stats.withObservedState).toBe(1);
    expect(stats.missingValue).toBe(1);
  });

  it('returns zeros for empty graph', () => {
    const stats = getFactorValueStats({ version: '1', default_seed: 42, nodes: [], edges: [] });

    expect(stats.factorCount).toBe(0);
    expect(stats.withValue).toBe(0);
    expect(stats.missingValue).toBe(0);
  });
});
