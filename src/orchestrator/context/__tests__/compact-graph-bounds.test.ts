/**
 * The compact graph the model reads stays small: inside an absolute cap, and well under the raw graph on the shape the
 * product drafts.
 *
 * Deletion 11 (22 Oct 2026, Codex r2 on #3620): these rows pinned the bounds through the deleted
 * `compactGraphForContextPack` wrapper (its strict arm: `GraphV3` parse, then `compactGraph`). `compactGraph` is live
 * (graph-compact.ts, reached via decision-review-graph-projection), so the rows are re-pointed, inputs and bounds unchanged.
 * The ring fixture's exemption from the ratio bound is argued in the deleted spec (evidence/track2-deletion11-20261022/deleted/).
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { compactGraph } from '../graph-compact.js';

type Rec = Record<string, any>;

const LONG_BODY =
  'This is a realistic descriptive body of the kind the UI ships for each node: ' +
  'a sentence or two of user-entered text explaining what the factor means, ' +
  'how the user is thinking about it, and any context they want to preserve ' +
  'across the session. Production nodes frequently carry 300-600 characters here. ' +
  'The compactor drops body entirely so only the label/kind/ID/value fields remain ' +
  'for Sonnet to reason about.';

function ringGraph(nodeCount: number, edgeCount: number): Rec {
  return {
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      id: `n-${i}`, kind: i === 0 ? 'goal' : i < 3 ? 'option' : 'factor', label: `Node ${i} label`, body: LONG_BODY,
      observed_state: { value: i * 0.1, std: 0.05, extractionType: 'explicit' }, category: 'observable',
    })),
    edges: Array.from({ length: edgeCount }, (_, i) => ({ from: `n-${i % nodeCount}`, to: `n-${(i + 1) % nodeCount}`,
      strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' })),
  };
}

function layeredGraph(): Rec {
  const kinds = ['goal', 'option', 'option', 'factor', 'factor', 'factor', 'factor', 'outcome', 'outcome', 'decision'];
  const pairs: Array<[string, string]> = [['n-9', 'n-1'], ['n-9', 'n-2'], ['n-1', 'n-3'], ['n-1', 'n-4'], ['n-2', 'n-5'], ['n-2', 'n-6'],
    ['n-3', 'n-7'], ['n-4', 'n-7'], ['n-5', 'n-8'], ['n-6', 'n-8'], ['n-7', 'n-0'], ['n-8', 'n-0']];
  return {
    nodes: kinds.map((kind, i) => ({ id: `n-${i}`, kind, label: `Node ${i} label`, body: LONG_BODY,
      observed_state: { value: i * 0.1, std: 0.05, extractionType: 'explicit' }, category: 'observable' })),
    edges: pairs.map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' })),
  };
}

const optionReach = (compact: Rec): number[] => compact.nodes.filter((n: Rec) => n.kind === 'option').map((n: Rec) => n.reaches?.length ?? -1);

describe('compact graph size bounds', () => {
  it('stays inside the absolute cap on a fully-connected ring (the ratio proxy is exempted there)', () => {
    const compact = compactGraph(GraphV3.parse(ringGraph(10, 12))) as Rec;
    expect(JSON.stringify(compact).length).toBeLessThan(4_000);
    // The exemption's premise: this fixture is the total-reachability case.
    const sets = optionReach(compact);
    expect(sets.length).toBeGreaterThan(0);
    for (const size of sets) expect(size).toBe(compact.nodes.length - 1);
  });

  it('is substantially smaller than the raw JSON for a representative layered graph', () => {
    const graph = layeredGraph();
    const compact = compactGraph(GraphV3.parse(graph)) as Rec;
    const compactBytes = JSON.stringify(compact).length;
    expect(compactBytes).toBeLessThan(JSON.stringify(graph).length * 0.55);
    expect(compactBytes).toBeLessThan(4_000);
    // The fixture must not become a second ring.
    const sets = optionReach(compact);
    expect(sets.length).toBeGreaterThan(0);
    for (const size of sets) { expect(size).toBeGreaterThan(0); expect(size).toBeLessThan(compact.nodes.length - 1); }
  });
});
