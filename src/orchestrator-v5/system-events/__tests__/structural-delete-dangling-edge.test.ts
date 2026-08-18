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

import {
  findOrphanedNodeReference,
  hasDanglingEdge,
  pruneDanglingNodeReferences,
} from '../structural-delete.js';
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

/**
 * `pruneDanglingNodeReferences` / `findOrphanedNodeReference` — the
 * intervention-level twin of the edge cascade, and its postcondition.
 *
 * ⭐ WHY THE POSTCONDITION IS UNIT-PINNED RATHER THAN MUTANT-KILLED, disclosed
 * for the same reason as `hasDanglingEdge` above. A mutant that makes
 * `findOrphanedNodeReference` always-clean cannot be killed through the route:
 * the prune runs first and no projection pass re-adds an intervention, so the
 * postcondition has nothing to catch. That is a TRUE result about reachability,
 * not missing coverage — the guard exists for a change one seam past the prune.
 * The prune ITSELF is route-level and mutant-killed (removing it, or narrowing
 * it to the option nodes only, REDs the C2 pair).
 *
 * WHY IT IS NOT COSMETIC — measured end to end, not argued: an intervention
 * keyed on a deleted factor loses its cap, so `{value: 0.4, raw_value: 40000}`
 * reaches the wire as 40000; PLoT's `needsNormalisation` is a WHOLE-REQUEST
 * gate; one stranded value re-scales every other factor's value at ISL.
 */
describe('pruneDanglingNodeReferences — a delete must not leave references behind', () => {
  function graphWithRefs(): Record<string, unknown> {
    return {
      goal_node_id: 'g',
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        {
          id: 'o1',
          kind: 'option',
          label: 'Option 1',
          interventions: { 'f-gone': { value: 0.4 }, 'f-stays': { value: 0.7 } },
        },
      ],
      options: [
        {
          id: 'o1',
          interventions: { 'f-gone': { value: 0.4 }, 'f-stays': { value: 0.7 } },
          raw_interventions: { 'f-gone': { value: 40000 } },
        },
      ],
      meta: { roots: ['f-gone', 'f-stays'], leaves: ['g'] },
    };
  }

  it('drops intervention keys on removed nodes from option NODES', () => {
    const g = graphWithRefs();
    pruneDanglingNodeReferences(g, new Set(['f-gone']));
    const node = (g.nodes as Array<Record<string, unknown>>)[1]!;
    expect(Object.keys(node.interventions as object)).toEqual(['f-stays']);
  });

  it('drops them from the TOP-LEVEL options[] mirror too, including raw_interventions', () => {
    const g = graphWithRefs();
    pruneDanglingNodeReferences(g, new Set(['f-gone']));
    const option = (g.options as Array<Record<string, unknown>>)[0]!;
    expect(Object.keys(option.interventions as object)).toEqual(['f-stays']);
    expect(Object.keys(option.raw_interventions as object)).toEqual([]);
  });

  it('filters meta.roots / meta.leaves', () => {
    const g = graphWithRefs();
    pruneDanglingNodeReferences(g, new Set(['f-gone']));
    expect((g.meta as { roots: string[] }).roots).toEqual(['f-stays']);
    expect((g.meta as { leaves: string[] }).leaves).toEqual(['g']);
  });

  // THE OPPOSITE-DIRECTION TWIN. A prune that took survivors too would silently
  // unconfigure the user's model — worse than the defect being fixed.
  it('takes ONLY the removed ids, never a survivor', () => {
    const g = graphWithRefs();
    const counts = pruneDanglingNodeReferences(g, new Set(['f-gone']));
    expect(counts.interventionsPruned).toBe(3); // node + option + raw_interventions
    expect(counts.metaIdsPruned).toBe(1);
    const option = (g.options as Array<Record<string, unknown>>)[0]!;
    expect((option.interventions as Record<string, { value: number }>)['f-stays'].value).toBe(0.7);
  });

  it('is a no-op on a graph that references nothing removed', () => {
    const g = graphWithRefs();
    const before = JSON.stringify(g);
    const counts = pruneDanglingNodeReferences(g, new Set(['not-present']));
    expect(counts).toEqual({ interventionsPruned: 0, metaIdsPruned: 0 });
    expect(JSON.stringify(g)).toBe(before);
  });

  it('is total against hostile shapes — never throws', () => {
    expect(() =>
      pruneDanglingNodeReferences(
        { nodes: 'not-an-array', options: [null, 7], meta: { roots: 'nope' } } as never,
        new Set(['x']),
      ),
    ).not.toThrow();
  });
});

describe('findOrphanedNodeReference — the postcondition on the projected bytes', () => {
  it('returns null for a clean graph', () => {
    expect(
      findOrphanedNodeReference({ goal_node_id: 'g', nodes: [], options: [] }, new Set(['f-gone'])),
    ).toBeNull();
  });

  it('names goal_node_id when the goal itself was removed', () => {
    expect(findOrphanedNodeReference({ goal_node_id: 'g' }, new Set(['g']))).toBe('goal_node_id');
  });

  it('names a surviving intervention key on a node', () => {
    expect(
      findOrphanedNodeReference(
        { nodes: [{ id: 'o1', interventions: { 'f-gone': { value: 1 } } }] },
        new Set(['f-gone']),
      ),
    ).toBe('nodes[].interventions');
  });

  it('names a surviving intervention key on the top-level options mirror', () => {
    expect(
      findOrphanedNodeReference(
        { options: [{ id: 'o1', raw_interventions: { 'f-gone': { value: 1 } } }] },
        new Set(['f-gone']),
      ),
    ).toBe('options[].raw_interventions');
  });

  it('does NOT fire on a reference to a node that was not removed', () => {
    expect(
      findOrphanedNodeReference(
        { goal_node_id: 'g', nodes: [{ id: 'o1', interventions: { 'f-stays': { value: 1 } } }] },
        new Set(['f-gone']),
      ),
    ).toBeNull();
  });
});
