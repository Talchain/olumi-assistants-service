/**
 * Track 3 — merge-parity: pins the REAL persistence merge seam
 * `mergeMutatedGraphForPersistence` BY IDENTITY (not a spy), and proves the
 * candidate-build seam and the persistence-merge seam compose faithfully.
 *
 * This is the ONLY module that imports `mergeMutatedGraphForPersistence` — the
 * production referee/candidate-graph never do (import-boundary guard, Paul #1).
 * The invariant: the referee builds candidates through `applyAndValidateMutation`;
 * merge-parity fixtures pin the persistence merge seam; the two never co-mingle in
 * production.
 */
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

const REQ = { requestId: 'test-req', scenarioId: 'test-scn' } as const;
const addOptionPayload = (id: string) => ({
  option: {
    id,
    label: 'Plan C',
    parent_decision_id: 'd-choice',
    edges: [{ to_factor_id: 'f-spend' }],
    interventions: { 'f-spend': { value: 0.5 } },
  },
});

describe('merge parity (pins the REAL mergeMutatedGraphForPersistence by identity)', () => {
  it('a representable mutation survives BOTH candidate construction AND the persist-base merge', () => {
    const persisted = buildReadyGraph();
    const { mutatedGraph } = applyAndValidateMutation(persisted, (clone: GraphV3T) => {
      const n = clone.nodes.find((x) => x.id === 'g-profit')!;
      const before = { label: n.label };
      n.label = 'Net Profit';
      return { before, after: { label: 'Net Profit' } };
    });
    const merged = mergeMutatedGraphForPersistence({ mutatedGraph, persistedBase: persisted, ...REQ });
    // Identity pin: the merged structural arrays ARE the mutated arrays (same reference),
    // not a spy assertion that the function "was called".
    expect(merged.nodes).toBe(mutatedGraph.nodes);
    const mergedNodes = merged.nodes as Array<{ id: string; label: string }>;
    expect(mergedNodes.find((n) => n.id === 'g-profit')!.label).toBe('Net Profit');
  });

  it('REAL FLOW: a new option survives both stages as a NODE and is analysable, while top-level options[] stays base-only (the divergence)', () => {
    const persistedBase = buildReadyGraphWithTopLevelOptions();
    expect(persistedBase.options.map((o) => o.id)).toEqual(['o-a', 'o-b']);

    // Stage 1: real candidate construction via the referee's seam.
    const built = buildAddOptionCandidate(persistedBase, addOptionPayload('o-c'));
    const candidate = built.candidate as Record<string, unknown>;

    // Stage 2: real persist-base merge.
    const merged = mergeMutatedGraphForPersistence({ mutatedGraph: candidate, persistedBase, ...REQ });

    // (a) new option survives both stages as a node.
    const mergedNodes = merged.nodes as Array<{ id: string; kind: string }>;
    expect(mergedNodes.some((n) => n.id === 'o-c' && n.kind === 'option')).toBe(true);

    // (b) run-analysis derives options from NODES → o-c IS analysable.
    const nodeDerived = computeStructuralReadiness(GraphV3.parse(merged));
    expect(nodeDerived?.options.map((o) => o.option_id).sort()).toEqual(['o-a', 'o-b', 'o-c']);

    // (c) top-level options[] (preferred by the context-pack assembler) stays base-only → o-c absent.
    //     THIS is the divergence that keeps add_option HELD.
    expect((merged.options as Array<{ id: string }>).map((o) => o.id)).toEqual(['o-a', 'o-b']);
  });

  it('a synthetic new top-level options[] entry does NOT survive the merge (options[] base-only, byte-for-byte)', () => {
    const optA = { id: 'o-a', label: 'A', status: 'ready', interventions: {} };
    const optB = { id: 'o-b', label: 'B', status: 'ready', interventions: {} };
    const persistedBase = { nodes: [], edges: [], options: [optA, optB] };
    const candidateWithNewOption = {
      nodes: [],
      edges: [],
      options: [optA, optB, { id: 'o-c', label: 'C', status: 'ready', interventions: {} }],
    };
    const merged = mergeMutatedGraphForPersistence({ mutatedGraph: candidateWithNewOption, persistedBase, ...REQ });
    expect(merged.options).toEqual([optA, optB]);
    expect(JSON.stringify(merged.options)).toBe(JSON.stringify(persistedBase.options));
  });
});
