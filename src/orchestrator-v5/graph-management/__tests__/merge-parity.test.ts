import { describe, it, expect } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import {
  applyAndValidateMutation,
  mergeMutatedGraphForPersistence,
} from '../../tools/handlers/d1-shared/apply-graph-mutation.js';
import { computeStructuralReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { buildAddOptionCandidate } from '../candidate-graph.js';
import { buildReadyGraph, buildReadyGraphWithTopLevelOptions } from './fixtures.js';
import type { AddOptionProposal } from '../proposal-types.js';

function addOption(id: string): AddOptionProposal {
  return {
    kind: 'add_option',
    base_graph_hash: null,
    option: {
      id,
      label: 'Plan C',
      parent_decision_id: 'd-choice',
      edges: [{ to_factor_id: 'f-spend' }],
      interventions: { 'f-spend': { value: 0.5 } },
    },
  };
}

describe('two-stage merge parity + model-state divergence (INV-2, real flow)', () => {
  it('a representable mutation survives BOTH candidate construction AND the persist-base merge', () => {
    const persisted = buildReadyGraph();
    const { mutatedGraph } = applyAndValidateMutation(persisted, (clone: GraphV3T) => {
      const n = clone.nodes.find((x) => x.id === 'g-profit')!;
      const before = { label: n.label };
      n.label = 'Net Profit';
      return { before, after: { label: 'Net Profit' } };
    });
    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph,
      persistedBase: persisted,
      requestId: 'test-req',
      scenarioId: 'test-scn',
    });
    const mergedNodes = merged.nodes as Array<{ id: string; label: string }>;
    expect(mergedNodes.find((n) => n.id === 'g-profit')!.label).toBe('Net Profit');
  });

  it('REAL FLOW: a new option survives both stages as a NODE and is analysable, while top-level options[] stays base-only (the divergence)', () => {
    // Rich persisted base: option NODES + canonical top-level options[] [o-a, o-b].
    const persistedBase = buildReadyGraphWithTopLevelOptions();
    expect(persistedBase.options.map((o) => o.id)).toEqual(['o-a', 'o-b']);

    // Stage 1: real candidate construction via the spike (uses applyAndValidateMutation).
    const built = buildAddOptionCandidate(persistedBase, addOption('o-c'));
    const candidate = built.candidate as Record<string, unknown>;

    // Stage 2: real persist-base merge.
    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: candidate,
      persistedBase,
      requestId: 'test-req',
      scenarioId: 'test-scn',
    });

    // (a) The new option SURVIVES both stages as a node.
    const mergedNodes = merged.nodes as Array<{ id: string; kind: string }>;
    expect(mergedNodes.some((n) => n.id === 'o-c' && n.kind === 'option')).toBe(true);

    // (b) run-analysis derives options from NODES -> o-c IS analysable.
    const nodeDerived = computeStructuralReadiness(GraphV3.parse(merged));
    expect(nodeDerived?.options.map((o) => o.option_id).sort()).toEqual(['o-a', 'o-b', 'o-c']);

    // (c) BUT the top-level options[] (preferred by the context-pack assembler) is
    //     kept base-only -> o-c absent. THIS is the divergence (not infeasibility).
    expect((merged.options as Array<{ id: string }>).map((o) => o.id)).toEqual(['o-a', 'o-b']);
  });

  it('a synthetic new top-level options[] entry does NOT survive mergeMutatedGraphForPersistence (options[] is base-only)', () => {
    const optA = { id: 'o-a', label: 'A', status: 'ready', interventions: {} };
    const optB = { id: 'o-b', label: 'B', status: 'ready', interventions: {} };
    const persistedBase = { nodes: [], edges: [], options: [optA, optB] };
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
    expect(merged.options).toEqual([optA, optB]);
  });
});
