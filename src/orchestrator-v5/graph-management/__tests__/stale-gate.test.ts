import { describe, it, expect } from 'vitest';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash, isStale } from '../base-hash-gate.js';
import { buildReadyGraph } from './fixtures.js';
import { CURRENT_GRAPH_UNREADABLE, type RenameNodeProposal } from '../proposal-types.js';

function rename(baseHash: string | null): RenameNodeProposal {
  return { kind: 'rename_node', base_graph_hash: baseHash, node_id: 'g-profit', new_label: 'X' };
}

describe('stale gate (INV-1)', () => {
  it('stale when base_graph_hash != current analysis hash; no candidate built', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(rename('deadbeefdeadbeef'), graph);
    expect(r.verdict).toBe('stale');
    expect(r.base_hash_check.match).toBe(false);
    expect(r.candidate).toBeUndefined();
  });

  it('proceeds (not stale) when base_graph_hash matches', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(rename(currentAnalysisHash(graph)), graph);
    expect(r.verdict).not.toBe('stale');
    expect(r.base_hash_check.match).toBe(true);
  });

  it('the gate has teeth: an analysis-affecting change moves the hash', () => {
    const graph = buildReadyGraph();
    const h1 = currentAnalysisHash(graph);

    const mutated = buildReadyGraph();
    (mutated.nodes.find((n) => n.id === 'f-spend') as { observed_state?: unknown }).observed_state = {
      value: 0.99,
    };
    const h2 = currentAnalysisHash(mutated);

    expect(h1).not.toBe(h2);
    expect(isStale(mutated, h1)).toBe(true); // a proposal validated against H is stale against H2
  });

  it('a label-only change does NOT move the hash (so rename is not self-stale)', () => {
    const graph = buildReadyGraph();
    const h1 = currentAnalysisHash(graph);
    const relabelled = buildReadyGraph();
    (relabelled.nodes.find((n) => n.id === 'g-profit') as { label: string }).label = 'Different';
    expect(currentAnalysisHash(relabelled)).toBe(h1);
  });
});

describe('totality over the declared `unknown` graph input (P2)', () => {
  it('returns held (CURRENT_GRAPH_UNREADABLE) and never throws on an unreadable graph', () => {
    const proposal: RenameNodeProposal = {
      kind: 'rename_node',
      base_graph_hash: 'somehash',
      node_id: 'g-profit',
      new_label: 'X',
    };
    for (const bad of [{}, null, undefined, 42, 'x', { nodes: 'not-an-array' }, []]) {
      const r = classifyProposal(proposal, bad);
      expect(r.verdict).toBe('held');
      expect(r.blocker?.code).toBe(CURRENT_GRAPH_UNREADABLE);
    }
  });
});
