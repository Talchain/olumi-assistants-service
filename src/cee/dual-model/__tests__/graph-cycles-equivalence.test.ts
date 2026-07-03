/**
 * Equivalence proofs for the shared wouldCreateCycle candidate against BOTH
 * live implementations:
 *   1. src/utils/graphGuards.ts detectCycles — property: for every enumerated
 *      acyclic base graph and candidate edge, the candidate predicts exactly
 *      whether detectCycles finds a cycle after adding the edge;
 *   2. src/cee/dual-draft/merge.ts wouldCreateCycle (module-private) —
 *      behavioural: added_causal_link proposals produce edge_creates_cycle
 *      exactly when the candidate says true (all other guards held green).
 *
 * Divergence pin (documented, not resolved): detectCycles DROPS edges whose
 * endpoints are missing from the node list; the merge's version has no node
 * list at all (endpoint existence is guarded earlier). The candidate follows
 * the merge's edge-list-only semantics — callers own endpoint validation.
 */
import { describe, it, expect } from 'vitest';
import { detectCycles } from '../../../utils/graphGuards.js';
import type { NodeT, EdgeT } from '../../../schemas/graph.js';
import { mergeProposals } from '../../dual-draft/merge.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { wouldCreateCycle, hasDirectedPath, type DirectedEdgeLike } from '../graph-cycles.js';

interface Family {
  readonly name: string;
  readonly nodes: readonly string[];
  readonly edges: readonly DirectedEdgeLike[];
}

// Enumerated acyclic base families. Every ordered node pair of each family is
// tried as a candidate edge, so both accept and reject arms are exercised.
const FAMILIES: readonly Family[] = [
  { name: 'chain-2', nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b' }] },
  {
    name: 'chain-4',
    nodes: ['a', 'b', 'c', 'd'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ],
  },
  {
    name: 'diamond',
    nodes: ['a', 'b', 'c', 'd'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ],
  },
  {
    name: 'mixed directed/bidirected',
    nodes: ['a', 'b', 'c', 'd'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c', edge_type: 'bidirected' },
      { from: 'c', to: 'd' },
    ],
  },
  {
    name: 'bidirected-only "cycle"',
    nodes: ['a', 'b', 'c'],
    edges: [
      { from: 'a', to: 'b', edge_type: 'bidirected' },
      { from: 'b', to: 'c', edge_type: 'bidirected' },
      { from: 'c', to: 'a', edge_type: 'bidirected' },
    ],
  },
  {
    name: 'disconnected components',
    nodes: ['a', 'b', 'x', 'y'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'x', to: 'y' },
    ],
  },
  {
    name: 'duplicate parallel edges',
    nodes: ['a', 'b', 'c'],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
  },
];

function toGuardTypes(family: Family, extraEdge?: DirectedEdgeLike): { nodes: NodeT[]; edges: EdgeT[] } {
  const nodes = family.nodes.map((id) => ({ id, label: id, type: 'factor' })) as unknown as NodeT[];
  const edges = [...family.edges, ...(extraEdge ? [extraEdge] : [])] as unknown as EdgeT[];
  return { nodes, edges };
}

describe('candidate vs graphGuards.detectCycles — full pairwise property over acyclic families', () => {
  for (const family of FAMILIES) {
    it(`${family.name}: candidate prediction === detectCycles verdict for every ordered pair`, () => {
      const base = toGuardTypes(family);
      expect(detectCycles(base.nodes, base.edges)).toEqual([]); // precondition: base is acyclic

      for (const from of family.nodes) {
        for (const to of family.nodes) {
          if (from === to) continue; // self-loops: detectCycles counts them; the merge rejects earlier — out of scope
          const predicted = wouldCreateCycle(family.edges, from, to);
          const withEdge = toGuardTypes(family, { from, to });
          const actual = detectCycles(withEdge.nodes, withEdge.edges).length > 0;
          expect({ from, to, predicted }).toEqual({ from, to, predicted: actual });
        }
      }
    });
  }
});

describe('candidate vs merge.ts behaviour — edge_creates_cycle exactly when predicted', () => {
  function factorGraph(nodes: readonly string[], edges: readonly DirectedEdgeLike[]): GraphV3T {
    return GraphV3.parse({
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'Goal' },
        ...nodes.map((id) => ({ id: `fac_${id}`, kind: 'factor', label: `Factor ${id}` })),
      ],
      edges: edges.map((e) => ({
        from: `fac_${e.from}`,
        to: `fac_${e.to}`,
        strength: { mean: 0.3, std: 0.1 },
        exists_probability: 0.7,
        effect_direction: 'positive',
        ...(e.edge_type ? { edge_type: e.edge_type } : {}),
      })),
    });
  }

  for (const family of FAMILIES) {
    it(`${family.name}: merge verdict matches the candidate for every non-duplicate ordered pair`, () => {
      const graph = factorGraph(family.nodes, family.edges);
      const existing = new Set(family.edges.map((e) => `${e.from}→${e.to}`));

      for (const from of family.nodes) {
        for (const to of family.nodes) {
          if (from === to) continue; // merge rejects self-loops before the cycle check
          if (existing.has(`${from}→${to}`)) continue; // merge rejects duplicates before the cycle check
          const predicted = wouldCreateCycle(family.edges, from, to);
          const out = mergeProposals(graph, [
            {
              type: 'added_causal_link',
              delta: {
                edge: {
                  from: `fac_${from}`,
                  to: `fac_${to}`,
                  strength: { mean: 0.3, std: 0.1 },
                  exists_probability: 0.7,
                  effect_direction: 'positive',
                },
              },
              evidence_pointer: 'equivalence probe',
            },
          ]);
          const mergeRejectedAsCycle = out.report.failures.some(
            (f) => f.reason_code === 'edge_creates_cycle',
          );
          expect({ from, to, cycle: mergeRejectedAsCycle }).toEqual({ from, to, cycle: predicted });
          if (!predicted) expect(out.report.applied).toBe(1);
        }
      }
    });
  }
});

describe('documented divergence — dangling-endpoint edges', () => {
  it('detectCycles DROPS edges with endpoints missing from the node list; the candidate keeps them', () => {
    // a→ghost, ghost→b, b→a: through the candidate (edge-list only) adding
    // b→a is preceded by a path a→ghost→b, so it predicts a cycle.
    // detectCycles with a node list lacking "ghost" drops both ghost edges
    // and sees no cycle. The merge never faces this case — its
    // edge_endpoint_missing guard runs first. Callers of the candidate own
    // endpoint validation (pinned so a future swap cannot silently change
    // dangling-edge behaviour).
    const edges: DirectedEdgeLike[] = [
      { from: 'a', to: 'ghost' },
      { from: 'ghost', to: 'b' },
    ];
    expect(wouldCreateCycle(edges, 'b', 'a')).toBe(true);

    const nodes = [
      { id: 'a', label: 'a', type: 'factor' },
      { id: 'b', label: 'b', type: 'factor' },
    ] as unknown as NodeT[];
    const withCandidate = [...edges, { from: 'b', to: 'a' }] as unknown as EdgeT[];
    expect(detectCycles(nodes, withCandidate).length).toBe(0);
  });
});

describe('hasDirectedPath primitive', () => {
  it('zero-length paths do not count; reachability is transitive; bidirected links never carry', () => {
    const edges: DirectedEdgeLike[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd', edge_type: 'bidirected' },
    ];
    expect(hasDirectedPath(edges, 'a', 'c')).toBe(true);
    expect(hasDirectedPath(edges, 'a', 'd')).toBe(false);
    expect(hasDirectedPath(edges, 'a', 'a')).toBe(false); // no cycle through a
    expect(hasDirectedPath(edges, 'c', 'a')).toBe(false);
  });
});
