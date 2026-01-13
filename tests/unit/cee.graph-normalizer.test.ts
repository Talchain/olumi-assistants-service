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

describe('normalizeGraphForISL - parameter_uncertainties', () => {
  describe('uncertainty derivation', () => {
    it('derives std using conservative default (20%) when no extraction metadata', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_price',
            kind: 'factor',
            label: 'Price Factor',
            observed_state: {
              value: 100,
              // No source specified - no extraction metadata
            },
          } as unknown as GraphV1['nodes'][0],
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      // Should derive std = 0.2 * |100| = 20
      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties).toHaveLength(1);
      expect(normalized.parameter_uncertainties![0].node_id).toBe('fac_price');
      expect(normalized.parameter_uncertainties![0].std).toBe(20);
      expect(normalized.parameter_uncertainties![0].distribution).toBe('normal');
    });

    it('derives std from explicit extraction metadata with confidence', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_price',
            kind: 'factor',
            label: 'Price Factor',
            data: {
              value: 59,
              extractionType: 'explicit',
              confidence: 0.9,
            },
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      // With explicit type and 0.9 confidence:
      // baseCV = 0.2 * (1 - 0.9) + 0.05 = 0.07
      // std = 0.07 * 59 * 1.0 = 4.13
      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties).toHaveLength(1);
      expect(normalized.parameter_uncertainties![0].node_id).toBe('fac_price');
      expect(normalized.parameter_uncertainties![0].std).toBeCloseTo(4.13, 1);
      expect(normalized.parameter_uncertainties![0].distribution).toBe('normal');

      // Factor node should also have value_std populated
      const factorNode = normalized.nodes.find((n) => n.id === 'fac_price');
      expect((factorNode as any)?.data?.value_std).toBeCloseTo(4.13, 1);
    });

    it('derives std from inferred extraction metadata with higher multiplier', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_revenue',
            kind: 'factor',
            label: 'Revenue Factor',
            data: {
              value: 100,
              extractionType: 'inferred',
              confidence: 0.7,
            },
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      // With inferred type and 0.7 confidence:
      // baseCV = 0.2 * (1 - 0.7) + 0.05 = 0.11
      // std = 0.11 * 100 * 1.5 = 16.5
      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties![0].std).toBeCloseTo(16.5, 1);
    });

    it('uses existing value_std when already present', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_price',
            kind: 'factor',
            label: 'Price Factor',
            data: {
              value: 100,
              value_std: 5, // Pre-computed std
            },
          } as unknown as GraphV1['nodes'][0],
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      // Should use existing value_std, not derive new one
      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties![0].std).toBe(5);
    });

    it('applies minimum floor for small values', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_ratio',
            kind: 'factor',
            label: 'Ratio Factor',
            observed_state: {
              value: 0.01, // Very small value
            },
          } as unknown as GraphV1['nodes'][0],
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      // Conservative: 0.2 * 0.01 = 0.002, but floor is 0.01
      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties![0].std).toBeGreaterThanOrEqual(0.01);
    });
  });

  describe('parameter_uncertainties array building', () => {
    it('builds array with multiple factors', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_a',
            kind: 'factor',
            label: 'Factor A',
            data: { value: 50 },
          },
          {
            id: 'fac_b',
            kind: 'factor',
            label: 'Factor B',
            observed_state: { value: 100 },
          } as unknown as GraphV1['nodes'][0],
          {
            id: 'goal_1',
            kind: 'goal',
            label: 'Goal',
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties).toHaveLength(2);
      expect(normalized.parameter_uncertainties!.map((p) => p.node_id)).toContain('fac_a');
      expect(normalized.parameter_uncertainties!.map((p) => p.node_id)).toContain('fac_b');
    });

    it('excludes factors without values from parameter_uncertainties', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_with_value',
            kind: 'factor',
            label: 'Factor with value',
            data: { value: 100 },
          },
          {
            id: 'fac_without_value',
            kind: 'factor',
            label: 'Factor without value',
            // No data or observed_state
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties).toHaveLength(1);
      expect(normalized.parameter_uncertainties![0].node_id).toBe('fac_with_value');
    });

    it('returns undefined parameter_uncertainties when no factors have values', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          {
            id: 'fac_no_value',
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

      const normalized = normalizeGraphForISL(graph);

      expect(normalized.parameter_uncertainties).toBeUndefined();
    });
  });

  describe('handles mixed scenarios', () => {
    it('handles factors with mixed metadata availability', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          // Factor with full metadata
          {
            id: 'fac_full',
            kind: 'factor',
            label: 'Full Metadata Factor',
            data: {
              value: 59,
              extractionType: 'explicit',
              confidence: 0.95,
            },
          },
          // Factor with partial metadata (no confidence)
          {
            id: 'fac_partial',
            kind: 'factor',
            label: 'Partial Metadata Factor',
            observed_state: {
              value: 100,
              source: 'brief_extraction',
            },
          } as unknown as GraphV1['nodes'][0],
          // Factor with no metadata
          {
            id: 'fac_none',
            kind: 'factor',
            label: 'No Metadata Factor',
            data: { value: 50 },
          },
        ],
        edges: [],
      };

      const normalized = normalizeGraphForISL(graph);

      expect(normalized.parameter_uncertainties).toBeDefined();
      expect(normalized.parameter_uncertainties).toHaveLength(3);

      // Full metadata: uses derivation formula
      const fullUncertainty = normalized.parameter_uncertainties!.find(
        (p) => p.node_id === 'fac_full'
      );
      // baseCV = 0.2 * (1 - 0.95) + 0.05 = 0.06
      // std = 0.06 * 59 * 1.0 = 3.54
      expect(fullUncertainty?.std).toBeCloseTo(3.54, 1);

      // Partial metadata: falls back to conservative default
      const partialUncertainty = normalized.parameter_uncertainties!.find(
        (p) => p.node_id === 'fac_partial'
      );
      // Conservative: 0.2 * 100 = 20
      expect(partialUncertainty?.std).toBe(20);

      // No metadata: uses conservative default
      const noneUncertainty = normalized.parameter_uncertainties!.find(
        (p) => p.node_id === 'fac_none'
      );
      // Conservative: 0.2 * 50 = 10
      expect(noneUncertainty?.std).toBe(10);
    });
  });
});

describe('normalizeGraphForISL - option edge filtering', () => {
  describe('filters out option-originated edges', () => {
    it('removes option→factor edges from normalized graph', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'opt_1', kind: 'option', label: 'Option A' },
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
          { id: 'fac_2', kind: 'factor', label: 'Factor 2', data: { value: 20 } },
        ],
        edges: [
          { id: 'e1', from: 'opt_1', to: 'fac_1', weight: 0.5 }, // Should be removed
          { id: 'e2', from: 'fac_1', to: 'fac_2', weight: 0.8 }, // Should be kept
        ],
      };

      const result = normalizeGraphForISL(graph);

      expect(result.edges).toHaveLength(1);
      expect(result.edges![0].id).toBe('e2');
    });

    it('removes multiple option→factor edges', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'opt_a', kind: 'option', label: 'Option A' },
          { id: 'opt_b', kind: 'option', label: 'Option B' },
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
          { id: 'fac_2', kind: 'factor', label: 'Factor 2', data: { value: 20 } },
          { id: 'out_1', kind: 'outcome', label: 'Outcome' },
        ],
        edges: [
          { id: 'e1', from: 'opt_a', to: 'fac_1', weight: 0.5 }, // Should be removed
          { id: 'e2', from: 'opt_b', to: 'fac_1', weight: 0.3 }, // Should be removed
          { id: 'e3', from: 'opt_a', to: 'fac_2', weight: 0.7 }, // Should be removed
          { id: 'e4', from: 'fac_1', to: 'out_1', weight: 0.8 }, // Should be kept
          { id: 'e5', from: 'fac_2', to: 'out_1', weight: 0.6 }, // Should be kept
        ],
      };

      const result = normalizeGraphForISL(graph);

      expect(result.edges).toHaveLength(2);
      expect(result.edges!.map(e => e.id).sort()).toEqual(['e4', 'e5']);
    });

    it('preserves all edges when no option nodes exist', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
          { id: 'fac_2', kind: 'factor', label: 'Factor 2', data: { value: 20 } },
          { id: 'out_1', kind: 'outcome', label: 'Outcome' },
        ],
        edges: [
          { id: 'e1', from: 'fac_1', to: 'fac_2', weight: 0.8 },
          { id: 'e2', from: 'fac_2', to: 'out_1', weight: 0.6 },
        ],
      };

      const result = normalizeGraphForISL(graph);

      expect(result.edges).toHaveLength(2);
    });

    it('handles graph with no edges', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'opt_1', kind: 'option', label: 'Option A' },
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
        ],
        edges: [],
      };

      const result = normalizeGraphForISL(graph);

      expect(result.edges).toEqual([]);
    });

    it('handles graph with undefined edges', () => {
      const graph = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'opt_1', kind: 'option', label: 'Option A' },
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
        ],
        // No edges property
      } as unknown as GraphV1;

      const result = normalizeGraphForISL(graph);

      expect(result.edges).toBeUndefined();
    });

    it('handles graph where all edges originate from options', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'opt_1', kind: 'option', label: 'Option A' },
          { id: 'opt_2', kind: 'option', label: 'Option B' },
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
        ],
        edges: [
          { id: 'e1', from: 'opt_1', to: 'fac_1', weight: 0.5 },
          { id: 'e2', from: 'opt_2', to: 'fac_1', weight: 0.3 },
        ],
      };

      const result = normalizeGraphForISL(graph);

      expect(result.edges).toHaveLength(0);
    });

    it('preserves edges where option is the target (not source)', () => {
      // Edge case: factor → option edge (unusual but possible)
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'opt_1', kind: 'option', label: 'Option A' },
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
        ],
        edges: [
          { id: 'e1', from: 'fac_1', to: 'opt_1', weight: 0.5 }, // Factor → Option, should be kept
        ],
      };

      const result = normalizeGraphForISL(graph);

      expect(result.edges).toHaveLength(1);
      expect(result.edges![0].id).toBe('e1');
    });
  });

  describe('does not mutate original graph edges', () => {
    it('original graph edges remain unchanged', () => {
      const graph: GraphV1 = {
        version: '1',
        default_seed: 42,
        nodes: [
          { id: 'opt_1', kind: 'option', label: 'Option A' },
          { id: 'fac_1', kind: 'factor', label: 'Factor 1', data: { value: 10 } },
        ],
        edges: [
          { id: 'e1', from: 'opt_1', to: 'fac_1', weight: 0.5 },
          { id: 'e2', from: 'fac_1', to: 'fac_1', weight: 0.8 },
        ],
      };

      const originalEdgeCount = graph.edges.length;
      normalizeGraphForISL(graph);

      // Original graph should be unchanged
      expect(graph.edges).toHaveLength(originalEdgeCount);
      expect(graph.edges[0].from).toBe('opt_1');
    });
  });
});
