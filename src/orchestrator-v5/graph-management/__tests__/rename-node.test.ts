import { describe, it, expect } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph, buildReadyGraphWithTopLevelOptions } from './fixtures.js';
import type { RenameNodeProposal } from '../proposal-types.js';

describe('rename_node — would_apply', () => {
  it('renames a node label, classifies would_apply with EP2 ready, candidate == base with only the label changed', () => {
    const graph = buildReadyGraph();
    const baseHash = currentAnalysisHash(graph);
    const proposal: RenameNodeProposal = {
      kind: 'rename_node',
      base_graph_hash: baseHash,
      node_id: 'g-profit',
      new_label: 'Net Profit',
    };

    const r = classifyProposal(proposal, graph);

    expect(r.verdict).toBe('would_apply');
    expect(['ready', 'repaired_for_analysis']).toContain(r.ep2_state);

    // Candidate-graph equality (parsed-vs-parsed to ignore schema normalisation):
    const parsedBase = GraphV3.parse(buildReadyGraph());
    const expectedNodes = parsedBase.nodes.map((n) =>
      n.id === 'g-profit' ? { ...n, label: 'Net Profit' } : n,
    );
    const cand = r.candidate as { nodes: unknown[]; edges: unknown[] };
    expect(cand.nodes).toEqual(expectedNodes);
    expect(cand.edges).toEqual(parsedBase.edges);

    // Hash-neutral: a label rename does not move the analysis-affecting hash.
    expect(currentAnalysisHash(r.candidate)).toBe(baseHash);

    // Zero persistence: the input graph object is untouched.
    expect(graph.nodes.find((n) => n.id === 'g-profit')!.label).toBe('Profit');
  });

  it('held (no false would_apply) when the target node does not exist', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(
      {
        kind: 'rename_node',
        base_graph_hash: currentAnalysisHash(graph),
        node_id: 'does-not-exist',
        new_label: 'X',
      },
      graph,
    );
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe('ENTITY_NOT_FOUND');
    expect(r.candidate).toBeUndefined();
  });

  it('the exposed candidate is fully referentially separate from the input (rich graph: top-level options[])', () => {
    const graph = buildReadyGraphWithTopLevelOptions();
    const r = classifyProposal(
      { kind: 'rename_node', base_graph_hash: currentAnalysisHash(graph), node_id: 'g-profit', new_label: 'Net' },
      graph,
    );
    const cand = r.candidate as { options?: unknown[]; nodes: Array<{ label: string }> };

    // Distinct top-level options[] array (the V5 helper shallow-copies it; the spike deep-clones).
    expect(cand.options).not.toBe(graph.options);

    // Mutating the candidate must not bleed into the input.
    (cand.options as unknown[]).push({ id: 'injected' });
    cand.nodes[0].label = 'MUTATED';
    expect(graph.options.some((o) => (o as { id?: string }).id === 'injected')).toBe(false);
    expect(graph.nodes[0].label).toBe('Profit');
  });
});
