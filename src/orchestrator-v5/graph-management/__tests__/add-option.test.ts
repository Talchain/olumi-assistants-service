import { describe, it, expect } from 'vitest';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph, buildReadyGraphWithTopLevelOptions } from './fixtures.js';
import {
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  OPTION_ID_COLLISION,
} from '../proposal-types.js';
import type { AddOptionProposal, AddOptionInterventionSpec } from '../proposal-types.js';

function addOption(
  baseHash: string | null,
  opts: { id?: string; interventions?: Record<string, AddOptionInterventionSpec> } = {},
): AddOptionProposal {
  return {
    kind: 'add_option',
    base_graph_hash: baseHash,
    option: {
      id: opts.id ?? 'o-c',
      label: 'Plan C',
      parent_decision_id: 'd-choice',
      edges: [{ to_factor_id: 'f-spend' }],
      ...(opts.interventions ? { interventions: opts.interventions } : {}),
    },
  };
}

describe('add_option — HELD-only (top-level options[] divergence)', () => {
  it('held with the divergence blocker even when the intervention IS cleanly encodable', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(addOption(currentAnalysisHash(graph), { interventions: { 'f-spend': { value: 0.5 } } }), graph);

    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE);

    // The candidate WAS constructed — the option exists as a graph node...
    const cand = r.candidate as { nodes: Array<{ id: string; kind: string }>; options?: unknown };
    expect(cand.nodes.some((n) => n.id === 'o-c' && n.kind === 'option')).toBe(true);

    // Reframed INV-4: run-analysis derives options from NODES, so EP2 (which does
    // the same) reads this candidate as ready — yet the spike still holds, because
    // applying would diverge the top-level options[] from the node-derived set.
    expect(['ready', 'repaired_for_analysis']).toContain(r.ep2_state);
  });

  it('held with the divergence blocker when interventions are missing', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(addOption(currentAnalysisHash(graph)), graph);
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE);
  });

  it('never returns would_apply for add_option', () => {
    const graph = buildReadyGraph();
    const baseHash = currentAnalysisHash(graph);
    for (const interventions of [undefined, { 'f-spend': { value: 0.5 } }, { 'f-spend': { raw_value: 999 } }]) {
      const r = classifyProposal(addOption(baseHash, { interventions }), graph);
      expect(r.verdict).not.toBe('would_apply');
    }
  });

  it('P1 regression: reusing an existing option id is HELD (id collision), never would_apply', () => {
    // The reviewer's repro: a graph that carries top-level options[] [o-a, o-b];
    // proposing add_option with the existing id `o-a` previously fell through to
    // would_apply. It must be held (id collision) now.
    const graph = buildReadyGraphWithTopLevelOptions();
    const r = classifyProposal(addOption(currentAnalysisHash(graph), { id: 'o-a' }), graph);
    expect(r.verdict).toBe('held');
    expect(r.verdict).not.toBe('would_apply');
    expect(r.blocker?.code).toBe(OPTION_ID_COLLISION);
  });
});
