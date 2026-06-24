import { describe, it, expect } from 'vitest';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash, isStale } from '../base-hash-gate.js';
import { buildReadyGraph } from './fixtures.js';
import { CURRENT_GRAPH_UNREADABLE, CLASSIFY_FAILED, type RenameNodeProposal } from '../proposal-types.js';

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

  it('fail-CLOSED: a graph-like but UNHASHABLE value is held, never a null-hash would_apply', () => {
    // graph-like (nodes array) but a top-level option carries a BigInt raw value,
    // so the analysis hash THROWS. With base_graph_hash:null this must NOT collapse
    // to a matching null hash and fall open to would_apply.
    const unhashable = {
      nodes: [
        { id: 'g-profit', kind: 'goal', label: 'Profit' },
        { id: 'd-choice', kind: 'decision', label: 'Which' },
        { id: 'o-a', kind: 'option', label: 'A' },
        { id: 'o-b', kind: 'option', label: 'B' },
      ],
      edges: [],
      options: [{ id: 'o-a', status: 'needs_encoding', raw_interventions: { 'f-x': BigInt(5) } }],
    };
    const r = classifyProposal(
      { kind: 'rename_node', base_graph_hash: null, node_id: 'g-profit', new_label: 'X' },
      unhashable,
    );
    expect(r.verdict).toBe('held');
    expect(r.verdict).not.toBe('would_apply');
    expect(r.blocker?.code).toBe(CURRENT_GRAPH_UNREADABLE);
    expect(r.base_hash_check.readable).toBe(false);
  });

  it('totality: a throwing getter / Proxy does not escape (held, never thrown)', () => {
    const proposal: RenameNodeProposal = {
      kind: 'rename_node',
      base_graph_hash: 'h',
      node_id: 'g',
      new_label: 'X',
    };

    const throwingGetter: Record<string, unknown> = {};
    Object.defineProperty(throwingGetter, 'nodes', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    const proxy = new Proxy({}, { get() { throw new Error('boom'); } });

    for (const evil of [throwingGetter, proxy]) {
      const r = classifyProposal(proposal, evil);
      expect(r.verdict).toBe('held');
      expect(r.blocker?.code).toBe(CURRENT_GRAPH_UNREADABLE);
    }
  });

  it('totality: a malformed proposal kind is held (CLASSIFY_FAILED), never thrown', () => {
    const graph = buildReadyGraph();
    const malformed = { kind: 'delete_node', base_graph_hash: currentAnalysisHash(graph), node_id: 'g-profit' };
    // @ts-expect-error intentionally invalid proposal kind (untrusted runtime input)
    const r = classifyProposal(malformed, graph);
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(CLASSIFY_FAILED);
  });

  it('totality: a throw inside an add_option helper (graphHasNodeId) is held (CLASSIFY_FAILED), never thrown', () => {
    const graph = buildReadyGraph();
    // .map (used by the hash) still works, so the readable gate passes; .some (used
    // by graphHasNodeId in the add_option branch) throws -> must be caught -> held.
    const evilNodes = [...graph.nodes];
    Object.defineProperty(evilNodes, 'some', {
      value: () => {
        throw new Error('trap');
      },
    });
    const evilGraph = { ...graph, nodes: evilNodes };
    const proposal = {
      kind: 'add_option' as const,
      base_graph_hash: currentAnalysisHash(evilGraph),
      option: { id: 'o-c', label: 'C', parent_decision_id: 'd-choice', edges: [{ to_factor_id: 'f-spend' }] },
    };
    const r = classifyProposal(proposal, evilGraph);
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(CLASSIFY_FAILED);
  });
});
