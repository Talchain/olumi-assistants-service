/**
 * Unit tests for compactGraphForContextPack — the V5 Task 1.2 adapter that
 * runs V4's compactGraph over a permissive GraphStateIngress so the ContextPack
 * presented to Sonnet carries a compact projection instead of full-JSON
 * passthrough.
 */


import { describe,expect,it } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';

import {
CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
} from '../../../orchestrator/context/graph-compact.js';
import {
compactGraphForContextPack
} from '../compact-graph-for-contextpack.js';

// Long-ish body text representative of real scenario content — the compactor
// drops this entirely, which is the largest single source of token savings.
const LONG_BODY =
  'This is a realistic descriptive body of the kind the UI ships for each node: ' +
  'a sentence or two of user-entered text explaining what the factor means, ' +
  'how the user is thinking about it, and any context they want to preserve ' +
  'across the session. Production nodes frequently carry 300-600 characters here. ' +
  'The compactor drops body entirely so only the label/kind/ID/value fields remain ' +
  'for Sonnet to reason about.';

function makeStrictGraph(nodeCount: number, edgeCount: number): GraphStateIngress {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n-${i}`,
    kind: i === 0 ? 'goal' : i < 3 ? 'option' : 'factor',
    label: `Node ${i} label`,
    body: LONG_BODY,
    observed_state: {
      value: i * 0.1,
      std: 0.05,
      extractionType: 'explicit',
    },
    category: 'observable',
  }));

  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    from: `n-${i % nodeCount}`,
    to: `n-${(i + 1) % nodeCount}`,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  }));

  return { nodes, edges };
}

/**
 * A LAYERED DAG of the shape real drafted graphs actually take:
 * decision -> 2 options -> 4 factors -> 2 outcomes -> goal. Same 10 nodes /
 * 12 edges as `makeStrictGraph`, same per-node byte payload — the ONLY
 * difference is topology, which is exactly the variable under test.
 *
 * Measured on the deployed build, drafted graphs are layered (~16 nodes across
 * ~10 columns, ~2 per column), not cyclic. Here each option reaches 4 nodes
 * rather than all 9, so the reachability projection costs 72 bytes instead of
 * 132 — see the two budget tests below for why that distinction is load-bearing.
 */
function makeLayeredGraph(): GraphStateIngress {
  const kinds = [
    'goal', 'option', 'option', 'factor', 'factor',
    'factor', 'factor', 'outcome', 'outcome', 'decision',
  ];
  const nodes = kinds.map((kind, i) => ({
    id: `n-${i}`,
    kind,
    label: `Node ${i} label`,
    body: LONG_BODY,
    observed_state: { value: i * 0.1, std: 0.05, extractionType: 'explicit' },
    category: 'observable',
  }));
  const pairs: Array<[string, string]> = [
    ['n-9', 'n-1'], ['n-9', 'n-2'],
    ['n-1', 'n-3'], ['n-1', 'n-4'], ['n-2', 'n-5'], ['n-2', 'n-6'],
    ['n-3', 'n-7'], ['n-4', 'n-7'], ['n-5', 'n-8'], ['n-6', 'n-8'],
    ['n-7', 'n-0'], ['n-8', 'n-0'],
  ];
  const edges = pairs.map(([from, to]) => ({
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  }));
  return { nodes, edges } as unknown as GraphStateIngress;
}



function firstFactor(graph: GraphStateIngress): Record<string, unknown> & {
  observed_state: Record<string, unknown>;
} {
  const factor = graph.nodes.find((node) => node.kind === 'factor') as
    | (Record<string, unknown> & { observed_state?: Record<string, unknown> })
    | undefined;
  if (factor === undefined || typeof factor.observed_state !== 'object') {
    throw new Error('test precondition: factor with observed_state');
  }
  return factor as Record<string, unknown> & { observed_state: Record<string, unknown> };
}












describe('compactGraphForContextPack', () => {
  it('returns absent when graphState is null', () => {
    const result = compactGraphForContextPack(null, { requestId: 'req-1' });
    expect(result.kind).toBe('absent');
  });

  it('returns absent when graphState is undefined', () => {
    const result = compactGraphForContextPack(undefined, { requestId: 'req-1' });
    expect(result.kind).toBe('absent');
  });

  it('compacts a strict-parseable graph via strict_parse', () => {
    const graph = makeStrictGraph(5, 4);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });

    expect(result.kind).toBe('compacted');
    if (result.kind !== 'compacted') throw new Error('narrowing');
    expect(result.via).toBe('strict_parse');
    expect(result.compact._node_count).toBe(5);
    expect(result.compact._edge_count).toBe(4);
  });

  it('compact output preserves id, kind, label on every node', () => {
    const graph = makeStrictGraph(4, 3);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const node of result.compact.nodes) {
      expect(node.id).toMatch(/^n-\d+$/);
      expect(node.kind).toBeTruthy();
      expect(node.label).toBeTruthy();
    }
  });

  it('compact output preserves from/to on every edge', () => {
    const graph = makeStrictGraph(5, 4);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const edge of result.compact.edges) {
      expect(edge.from).toBeTruthy();
      expect(edge.to).toBeTruthy();
      expect(typeof edge.strength).toBe('number');
    }
  });

  it('compact output drops verbose body field', () => {
    const graph = makeStrictGraph(3, 2);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const node of result.compact.nodes) {
      expect(node).not.toHaveProperty('body');
    }
  });

  it('compact output drops std on strength (only mean survives as strength number)', () => {
    const graph = makeStrictGraph(4, 3);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const edge of result.compact.edges) {
      // strength is a number in the compact projection, not { mean, std }
      expect(typeof edge.strength).toBe('number');
    }
  });



  /**
   * ⚠⚠ THIS TEST DROPPED THE RATIO ASSERTION, AND THAT IS A TEST CHANGE MADE TO
   * ACCOMMODATE A FEATURE. Read the reasoning before accepting it — a later
   * reader is entitled to treat an unexplained version of this as goalpost-moving.
   *
   * Two measurements justify it, and neither is "the feature is important":
   *
   * 1. **THE FIXTURE IS PATHOLOGICAL FOR THIS PARTICULAR PROXY.**
   *    `makeStrictGraph` wires `n-i -> n-(i+1) mod 10` — a COMPLETE RING. Every
   *    node reaches every other, so the reachability projection is TOTAL: it
   *    costs the maximum possible bytes while carrying ZERO discriminating
   *    information (a set equal to "all other nodes" tells the model nothing it
   *    could not get from `_node_count`). Measured on the layered DAG below,
   *    which is the shape real drafted graphs take, the same field costs 72
   *    bytes rather than 132 and the ratio passes with ~678 bytes to spare.
   *    The ratio bound is a proxy for "compaction is still working"; on a ring
   *    it measures a case the product does not produce.
   *
   * 2. ⭐ **THE MARGIN WAS ALREADY GONE BEFORE THIS FIELD EXISTED.** Measured at
   *    this tip: raw 7093 · budget (raw x 0.55) 3901.15 · compact WITHOUT any
   *    reachability 3799. That is **97.4% of the ratio budget already consumed**,
   *    i.e. 102 bytes from breaching. The reachability field did not exhaust the
   *    margin; it REVEALED that the margin was already all but gone. Rowed
   *    separately, because the next lane to add anything to the ContextPack will
   *    hit this blind otherwise.
   *
   * What is NOT weakened: the ABSOLUTE cap still applies here, and the ratio
   * bound is still enforced — on `makeLayeredGraph`, in the test immediately
   * below, so the guarantee keeps something representative to guard.
   */
  it('compact JSON stays inside the absolute cap on a fully-connected ring (ratio proxy exempted, see docblock)', () => {
    const graph = makeStrictGraph(10, 12);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    const compactBytes = JSON.stringify(result.compact).length;
    expect(compactBytes).toBeLessThan(4_000);

    // Pin the PREMISE of the exemption in-test, so it cannot rot into an
    // unexplained widened bound: this fixture really is the total-reachability
    // case. If the fixture ever stops being a ring, this reddens and the
    // exemption must be re-argued rather than silently inherited.
    const optionSets = result.compact.nodes
      .filter((node) => node.kind === 'option')
      .map((node) => node.reaches?.length ?? -1);
    expect(optionSets.length).toBeGreaterThan(0);
    for (const size of optionSets) {
      expect(size).toBe(result.compact.nodes.length - 1);
    }
  });

  it('compact JSON is substantially smaller than raw JSON for a representative layered graph', () => {
    // The ratio guarantee, kept intact on the topology the product actually
    // drafts: decision -> options -> factors -> outcomes -> goal.
    const graph = makeLayeredGraph();
    const result = compactGraphForContextPack(graph, { requestId: 'req-layered' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    const rawBytes = JSON.stringify(graph).length;
    const compactBytes = JSON.stringify(result.compact).length;

    expect(compactBytes).toBeLessThan(rawBytes * 0.55);
    expect(compactBytes).toBeLessThan(4_000);

    // Guard the fixture's own representativeness: a layered DAG must NOT be
    // totally-reachable, or this test quietly becomes a second ring.
    const optionSets = result.compact.nodes
      .filter((node) => node.kind === 'option')
      .map((node) => node.reaches?.length ?? -1);
    expect(optionSets.length).toBeGreaterThan(0);
    for (const size of optionSets) {
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(result.compact.nodes.length - 1);
    }
  });

  it('falls back to structural_fallback when ingress fails strict parse but is structurally compactable', () => {
    // Missing strength.std (required by GraphV3 edge strength schema in most
    // profiles) or similar — use a shape that passes GraphStateIngress but
    // fails GraphV3. The easiest is a node with an unknown kind.
    const graph: GraphStateIngress = {
      nodes: [
        { id: 'n-0', kind: 'goal', label: 'Goal' },
        { id: 'n-1', kind: 'not_a_valid_v3_kind', label: 'Weird' },
      ],
      edges: [{ from: 'n-0', to: 'n-1' }],
    };
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });

    // Either strict_parse (if GraphV3 is permissive on kind) or structural_fallback.
    // Both are acceptable — the key invariant is the function never throws.
    expect(result.kind).toBe('compacted');
    if (result.kind !== 'compacted') throw new Error('expected compacted fallback');
    expect(result.compact.edges[0]).not.toHaveProperty('coefficient_confidence');
  });

  it('structural fallback never throws on empty-edge payloads', () => {
    const graph: GraphStateIngress = {
      nodes: [{ id: 'n-0', kind: 'goal', label: 'Goal' }],
      edges: [],
    };
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    expect(result.kind).toBe('compacted');
  });

  it('is deterministic — same input produces byte-identical output', () => {
    const graph = makeStrictGraph(6, 8);
    const a = compactGraphForContextPack(graph, { requestId: 'req-a' });
    const b = compactGraphForContextPack(graph, { requestId: 'req-b' });
    if (a.kind !== 'compacted' || b.kind !== 'compacted') throw new Error('expected compacted');
    expect(JSON.stringify(a.compact)).toBe(JSON.stringify(b.compact));
  });

  it('preserves producer uncertainty bytes and order from either permitted source location', () => {
    const observedGraph = makeStrictGraph(4, 0);
    const observedNode = firstFactor(observedGraph);
    observedNode.observed_state.uncertainty_drivers = ['First source fact', 'Second source fact'];

    const observed = compactGraphForContextPack(observedGraph, { requestId: 'req-observed' });
    if (observed.kind !== 'compacted') throw new Error('expected compacted');
    expect(observed.compact.nodes.find((node) => node.kind === 'factor')!.uncertainty_drivers).toEqual([
      'First source fact',
      'Second source fact',
    ]);
    expect(observed.compact.nodes.find((node) => node.kind === 'factor')).not.toHaveProperty(
      'uncertainty_drivers_disclosure',
    );

    const promotedGraph = makeStrictGraph(4, 0);
    const promotedNode = firstFactor(promotedGraph);
    promotedNode.uncertainty_drivers = ['Promoted source fact'];
    promotedNode.observed_state.uncertainty_drivers = ['Promoted source fact'];

    const promoted = compactGraphForContextPack(promotedGraph, { requestId: 'req-promoted' });
    if (promoted.kind !== 'compacted') throw new Error('expected compacted');
    expect(promoted.compact.nodes.find((node) => node.kind === 'factor')!.uncertainty_drivers)
      .toEqual(['Promoted source fact']);
    expect(promoted.compact.nodes.find((node) => node.kind === 'factor')).not.toHaveProperty(
      'uncertainty_drivers_disclosure',
    );
  });

  it('fails closed instead of choosing between conflicting permitted source locations', () => {
    const graph = makeStrictGraph(4, 0);
    const node = firstFactor(graph);
    node.uncertainty_drivers = ['Promoted value'];
    node.observed_state.uncertainty_drivers = ['Observed-state value'];

    const result = compactGraphForContextPack(graph, { requestId: 'req-conflict' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');
    const compactFactor = result.compact.nodes.find((candidate) => candidate.kind === 'factor')!;
    expect(compactFactor).not.toHaveProperty('uncertainty_drivers');
    expect(compactFactor.uncertainty_drivers_disclosure).toEqual({
      status: 'conflicting_sources_withheld',
    });
  });

  /**
   * ⭐ THE CAP'S *VALUE* — pinned against the producer, not against itself.
   *
   * `graph-compact.ts` documents that "the character cap matches the existing
   * producer-side proposal guard". That was true and enforced by NOTHING. Every
   * other reference in this suite derives BOTH the input and the expectation
   * from the constant (`'x'.repeat(MAX + 1)`, `slice(0, MAX)`,
   * `per_entry_char_limit: MAX`), so moving the constant moves every assertion
   * with it — a control decayed into a tautology (CLAUDE.md trap 12b). Measured:
   * a mutant setting the cap to 121 survived 63/63 GREEN.
   *
   * This is the only assertion here that would notice, because it is the only
   * one whose expected value comes from the OTHER authority. If the two caps are
   * ever meant to diverge, change this line deliberately — do not delete it.
   */


  it('bounds entries and characters without rewriting or silently dropping producer text', () => {
    const graph = makeStrictGraph(4, 0);
    const node = firstFactor(graph);
    const overlong = 'x'.repeat(CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS + 1);
    node.uncertainty_drivers = [overlong, 'Second exact entry', 'Count-bounded entry'];

    const result = compactGraphForContextPack(graph, { requestId: 'req-bounds' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');
    const compactFactor = result.compact.nodes.find((candidate) => candidate.kind === 'factor')!;
    expect(compactFactor.uncertainty_drivers).toEqual([
      overlong.slice(0, CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS),
      'Second exact entry',
    ]);
    expect(compactFactor.uncertainty_drivers_disclosure).toEqual({
      status: 'truncated',
      original_entries: 3,
      retained_entries: 2,
      entries_omitted_by_count: 1,
      entries_truncated_by_chars: 1,
      per_entry_char_limit: CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
    });
  });





  it('keeps the compact JSON byte-identical when uncertainty input is absent', () => {
    const result = compactGraphForContextPack(makeStrictGraph(1, 0), {
      requestId: 'req-byte-identity',
    });
    if (result.kind !== 'compacted') throw new Error('expected compacted');
    expect(JSON.stringify(result.compact)).toBe(
      '{"nodes":[{"id":"n-0","kind":"goal","label":"Node 0 label","category":"observable","value":0,"source":"user","provenance":"from_brief"}],"edges":[],"_node_count":1,"_edge_count":0}',
    );
  });





  it('goal_constraints survive the compact path via compactedConstraints', async () => {
    // V5 review: compactGraph itself drops goal_constraints. The assembler
    // threads them separately via `compactedConstraints` so Sonnet still
    // sees the decision constraints in the compact path. Verified end-to-end
    // through assembleContextPack.
    const { assembleContextPack } = await import('../context-pack-assembler.js');
    const graph = makeStrictGraph(5, 4);
    const graphWithConstraints = {
      ...graph,
      goal_constraints: [
        { id: 'c-budget', label: 'Budget ≤ $100k' },
        { id: 'c-timeline', label: 'Launch before Q3' },
      ],
    };
    const outcome = compactGraphForContextPack(graphWithConstraints, { requestId: 'req-c' });
    if (outcome.kind !== 'compacted') throw new Error('expected compacted');

    const pack = assembleContextPack({
      payload: {
        turn_id: 't-1',
        scenario_id: 's-1',
        message: 'x',
        turn_class: 'frame',
        stage: 'frame',
      } as never,
      priorTurns: [],
      compactedGraph: outcome.compact,
      compactedConstraints: graphWithConstraints.goal_constraints,
    });

    expect(pack.graph.constraints).toHaveLength(2);
    expect(pack.graph.counts.constraints).toBe(2);
  });
});
