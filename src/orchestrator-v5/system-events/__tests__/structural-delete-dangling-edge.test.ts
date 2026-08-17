/**
 * `hasDanglingEdge` — the structural_delete atomicity POSTCONDITION, unit-pinned.
 *
 * ⭐ WHY THIS FILE EXISTS, stated honestly rather than implied.
 *
 * A mutation battery on the delete writer turned this guard into `return false`
 * and the whole route-level suite stayed GREEN. That is a true result, not a
 * coverage failure to paper over: `applyRemoveNode` cascades every incident edge
 * as its documented contract, so NO input the route accepts can currently produce
 * a dangling edge. The guard is defence-in-depth against a change one seam past
 * it — `projectGraphForPersistence` runs AFTER the applier and repairs,
 * normalises and reconciles the graph, so the bytes that land are not the bytes
 * the applier produced.
 *
 * The honest options were: delete a guard whose trigger is unreachable, invent a
 * fake path to make it reachable, or pin the PREDICATE directly and disclose that
 * its integration-level trigger is unreachable by construction at this tip. This
 * file is the third. It means the predicate cannot silently rot into a tautology
 * (a guard too slack to fail is the same defect one level up), while nothing
 * pretends the integration path exercises it.
 *
 * ⚠ IF A FUTURE CHANGE MAKES A DANGLING EDGE REACHABLE — a projection pass that
 * adds edges, a cascade relaxation, an applier that stops cascading — the
 * reachability claim above is void and the route-level suite needs a case, not
 * just this unit test.
 */
import { describe, it, expect } from 'vitest';

import { hasDanglingEdge } from '../structural-delete.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

function graph(
  nodeIds: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
): GraphV3T {
  return {
    nodes: nodeIds.map((id) => ({ id, kind: 'option', label: `Label ${id}` })),
    edges: edges.map(([from, to]) => ({
      from,
      to,
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    })),
  } as unknown as GraphV3T;
}

describe('hasDanglingEdge — every surviving edge must have both endpoints', () => {
  it('a coherent graph has no dangling edge', () => {
    expect(hasDanglingEdge(graph(['a', 'b'], [['a', 'b']]))).toBe(false);
  });

  it('an empty graph has no dangling edge', () => {
    expect(hasDanglingEdge(graph([], []))).toBe(false);
  });

  it('a graph with nodes and no edges has no dangling edge', () => {
    expect(hasDanglingEdge(graph(['a', 'b', 'c'], []))).toBe(false);
  });

  // BOTH DIRECTIONS. The predicate is `!ids.has(e.from) || !ids.has(e.to)`, and a
  // one-sided version would pass every test that only ever breaks one endpoint —
  // the asymmetry defect this estate has shipped before (a guard written with the
  // same blind spot as the code it tests).
  it('detects a missing SOURCE endpoint', () => {
    expect(hasDanglingEdge(graph(['b'], [['a', 'b']]))).toBe(true);
  });

  it('detects a missing TARGET endpoint', () => {
    expect(hasDanglingEdge(graph(['a'], [['a', 'b']]))).toBe(true);
  });

  it('detects BOTH endpoints missing', () => {
    expect(hasDanglingEdge(graph(['c'], [['a', 'b']]))).toBe(true);
  });

  it('detects one dangling edge among otherwise coherent edges', () => {
    // The realistic shape: a cascade that took the node but missed one edge.
    expect(
      hasDanglingEdge(graph(['a', 'b'], [['a', 'b'], ['b', 'a'], ['a', 'gone']])),
    ).toBe(true);
  });
});
