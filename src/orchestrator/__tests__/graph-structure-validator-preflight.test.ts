/**
 * Wave 3 — preflight unit tests for `wouldExceedAddRiskLimits`.
 *
 * Pure synchronous arithmetic over the validator's MAX_NODES /
 * MAX_EDGES constants. Asserts both edge and node limit cases plus
 * the under-limit pass-through.
 */

import { describe, expect, it } from 'vitest';

import { wouldExceedAddRiskLimits } from '../graph-structure-validator.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

function graph(nodeCount: number, edgeCount: number): GraphV3T {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    kind: 'factor' as const,
    label: `Factor ${i}`,
  }));
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    from: `n${i % nodeCount}`,
    to: `n${(i + 1) % nodeCount}`,
    strength: 0.5,
  }));
  return { nodes, edges } as unknown as GraphV3T;
}

describe('wouldExceedAddRiskLimits', () => {
  it('under both limits returns over_*=false', () => {
    const r = wouldExceedAddRiskLimits(graph(5, 5));
    expect(r.over_node_limit).toBe(false);
    expect(r.over_edge_limit).toBe(false);
    expect(r.projected_nodes).toBe(6);
    expect(r.projected_edges).toBe(7);
  });

  it('exact-limit graphs flag over the corresponding axis', () => {
    // node limit 20: graph at 20 nodes → +1 = 21 > 20 → over_node_limit
    const r = wouldExceedAddRiskLimits(graph(20, 5));
    expect(r.over_node_limit).toBe(true);
    expect(r.projected_nodes).toBe(21);
    expect(r.node_limit).toBe(20);
  });

  it('graph at edge limit flags edge overflow on add-risk projection (+2 edges)', () => {
    // edge limit 30: graph at 29 edges + 2 projected = 31 > 30 → over_edge_limit
    const r = wouldExceedAddRiskLimits(graph(5, 29));
    expect(r.over_edge_limit).toBe(true);
    expect(r.projected_edges).toBe(31);
    expect(r.edge_limit).toBe(30);
  });

  it('under both limits at the boundary (+1 node, +2 edges projection sits exactly at limits) → pass', () => {
    // 19 nodes + 1 = 20 (== limit, NOT over). 28 edges + 2 = 30 (== limit, NOT over).
    const r = wouldExceedAddRiskLimits(graph(19, 28));
    expect(r.over_node_limit).toBe(false);
    expect(r.over_edge_limit).toBe(false);
  });

  it('reports both axes when both would exceed', () => {
    const r = wouldExceedAddRiskLimits(graph(20, 30));
    expect(r.over_node_limit).toBe(true);
    expect(r.over_edge_limit).toBe(true);
  });
});
