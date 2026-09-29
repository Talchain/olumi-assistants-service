/**
 * Wave 3 — preflight unit tests for `wouldExceedAddRiskLimits`.
 *
 * Pure synchronous arithmetic over CEE's graph-size authority. Asserts both
 * edge and node limit cases plus the under-limit pass-through.
 *
 * ⚠ 2026-08-18: the boundaries here were hard-typed as 20 / 30, mirroring
 * constants that used to live in `graph-structure-validator.ts`. Those
 * constants are gone — absolute graph size is `config/graphCaps.ts`' question
 * now (see that validator's file header) — so every boundary below is DERIVED
 * from `GRAPH_MAX_NODES` / `GRAPH_MAX_EDGES`. The assertions are unchanged in
 * meaning: at-the-limit overflows, one-below passes, both axes report
 * independently. Deriving them also removes the mirror that let the two
 * authorities drift apart in the first place.
 */

import { describe, expect, it } from 'vitest';

import { wouldExceedAddRiskLimits } from '../graph-structure-validator.js';
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from '../../config/graphCaps.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

/** The add-risk projection: +1 node, +2 edges (see the preflight's docblock). */
const PROJECTED_NODES = 1;
const PROJECTED_EDGES = 2;

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
    // A graph sitting exactly at the node limit: +1 puts it over.
    const r = wouldExceedAddRiskLimits(graph(GRAPH_MAX_NODES, 5));
    expect(r.over_node_limit).toBe(true);
    expect(r.projected_nodes).toBe(GRAPH_MAX_NODES + PROJECTED_NODES);
    expect(r.node_limit).toBe(GRAPH_MAX_NODES);
  });

  it('graph at edge limit flags edge overflow on add-risk projection (+2 edges)', () => {
    // One below the edge limit: +2 puts it one over.
    const r = wouldExceedAddRiskLimits(graph(5, GRAPH_MAX_EDGES - 1));
    expect(r.over_edge_limit).toBe(true);
    expect(r.projected_edges).toBe(GRAPH_MAX_EDGES + 1);
    expect(r.edge_limit).toBe(GRAPH_MAX_EDGES);
  });

  it('under both limits at the boundary (+1 node, +2 edges projection sits exactly at limits) → pass', () => {
    const r = wouldExceedAddRiskLimits(
      graph(GRAPH_MAX_NODES - PROJECTED_NODES, GRAPH_MAX_EDGES - PROJECTED_EDGES),
    );
    expect(r.projected_nodes).toBe(GRAPH_MAX_NODES);
    expect(r.projected_edges).toBe(GRAPH_MAX_EDGES);
    expect(r.over_node_limit).toBe(false);
    expect(r.over_edge_limit).toBe(false);
  });

  it('reports both axes when both would exceed', () => {
    const r = wouldExceedAddRiskLimits(graph(GRAPH_MAX_NODES, GRAPH_MAX_EDGES));
    expect(r.over_node_limit).toBe(true);
    expect(r.over_edge_limit).toBe(true);
  });

  it('does NOT flag a realistic draft the analysis gate now admits (24 nodes / 46 edges)', () => {
    // The size class this whole change exists for: a real captured draft that
    // the removed 20/30 clause refused. A preflight that still refused an add
    // here would decline an action the rest of CEE would honour.
    const r = wouldExceedAddRiskLimits(graph(24, 46));
    expect(r.over_node_limit).toBe(false);
    expect(r.over_edge_limit).toBe(false);
  });
});
