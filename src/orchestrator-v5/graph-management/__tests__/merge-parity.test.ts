import { describe, it, expect } from 'vitest';
import {
  applyAndValidateMutation,
  mergeMutatedGraphForPersistence,
} from '../../tools/handlers/d1-shared/apply-graph-mutation.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { buildAddOptionCandidate } from '../candidate-graph.js';
import { buildReadyGraph } from './fixtures.js';
import type { AddOptionProposal } from '../proposal-types.js';

describe('two-stage merge parity + options[] merge-drop proof (INV-2 / pinned C3)', () => {
  it('a representable mutation survives BOTH candidate construction AND the persist-base merge', () => {
    const persisted = buildReadyGraph();

    // Stage 1 — candidate construction via the V5-owned seam.
    const { mutatedGraph } = applyAndValidateMutation(persisted, (clone: GraphV3T) => {
      const n = clone.nodes.find((x) => x.id === 'g-profit')!;
      const before = { label: n.label };
      n.label = 'Net Profit';
      return { before, after: { label: 'Net Profit' } };
    });

    // Stage 2 — persist-base merge (no DB; pure).
    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph,
      persistedBase: persisted,
      requestId: 'test-req',
      scenarioId: 'test-scn',
    });

    const mergedNodes = merged.nodes as Array<{ id: string; label: string }>;
    expect(mergedNodes.find((n) => n.id === 'g-profit')!.label).toBe('Net Profit');
  });

  it('a NEW options[] entry does NOT survive mergeMutatedGraphForPersistence (add-option apply is infeasible over the D1 seam)', () => {
    const optA = { id: 'o-a', label: 'A', status: 'ready', interventions: {} };
    const optB = { id: 'o-b', label: 'B', status: 'ready', interventions: {} };
    const persistedBase = { nodes: [], edges: [], options: [optA, optB] };

    // An *idealised* candidate that managed to also add a new options[] entry o-c:
    const candidateWithNewOption = {
      nodes: [],
      edges: [],
      options: [optA, optB, { id: 'o-c', label: 'C', status: 'ready', interventions: {} }],
    };

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: candidateWithNewOption,
      persistedBase,
      requestId: 'test-req',
      scenarioId: 'test-scn',
    });

    // options[] comes from persistedBase verbatim -> o-c is dropped.
    expect(merged.options).toEqual([optA, optB]);
    expect((merged.options as Array<{ id: string }>).some((o) => o.id === 'o-c')).toBe(false);
  });

  it('the add-option candidate carries the option only as a node, never in options[]', () => {
    const persisted = buildReadyGraph();
    const proposal: AddOptionProposal = {
      kind: 'add_option',
      base_graph_hash: null,
      option: {
        id: 'o-c',
        label: 'C',
        edges: [{ to_factor_id: 'f-spend' }],
        interventions: { 'f-spend': { value: 0.5 } },
      },
    };

    const built = buildAddOptionCandidate(persisted, proposal);
    const cand = built.candidate as { nodes: Array<{ id: string }>; options?: unknown };

    expect(cand.nodes.some((n) => n.id === 'o-c')).toBe(true);
    const inOptions = Array.isArray(cand.options)
      ? (cand.options as Array<{ id?: string }>).some((o) => o.id === 'o-c')
      : false;
    expect(inOptions).toBe(false);
  });
});
