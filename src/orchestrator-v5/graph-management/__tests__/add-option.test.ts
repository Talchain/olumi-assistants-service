import { describe, it, expect } from 'vitest';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph } from './fixtures.js';
import { OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE } from '../proposal-types.js';
import type { AddOptionProposal, AddOptionInterventionSpec } from '../proposal-types.js';

function addOption(
  baseHash: string | null,
  interventions?: Record<string, AddOptionInterventionSpec>,
): AddOptionProposal {
  return {
    kind: 'add_option',
    base_graph_hash: baseHash,
    option: {
      id: 'o-c',
      label: 'Plan C',
      parent_decision_id: 'd-choice',
      edges: [{ to_factor_id: 'f-spend' }],
      ...(interventions ? { interventions } : {}),
    },
  };
}

describe('add_option — HELD-only (OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE)', () => {
  it('held with the model-state blocker even when the intervention IS cleanly encodable', () => {
    const graph = buildReadyGraph();
    const baseHash = currentAnalysisHash(graph);

    const r = classifyProposal(addOption(baseHash, { 'f-spend': { value: 0.5 } }), graph);

    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE);

    // The candidate WAS constructed — the option exists as a graph node...
    const cand = r.candidate as { nodes: Array<{ id: string; kind: string }>; options?: unknown };
    expect(cand.nodes.some((n) => n.id === 'o-c' && n.kind === 'option')).toBe(true);
    // ...but NOT in the canonical options[] model-state.
    const inOptions = Array.isArray(cand.options)
      ? (cand.options as Array<{ id?: string }>).some((o) => o.id === 'o-c')
      : false;
    expect(inOptions).toBe(false);

    // INV-4: EP2 (reading the option NODE) would NOT block — yet the spike holds
    // on model-state. This is the "no accidental analysis-ready false positive".
    expect(['ready', 'repaired_for_analysis']).toContain(r.ep2_state);
  });

  it('held with the model-state blocker when interventions are missing', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(addOption(currentAnalysisHash(graph)), graph);
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(OPTION_NOT_REPRESENTABLE_IN_MODEL_STATE);
  });

  it('never returns would_apply for add_option', () => {
    const graph = buildReadyGraph();
    const baseHash = currentAnalysisHash(graph);
    for (const intv of [undefined, { 'f-spend': { value: 0.5 } }, { 'f-spend': { raw_value: 999 } }]) {
      const r = classifyProposal(addOption(baseHash, intv), graph);
      expect(r.verdict).not.toBe('would_apply');
    }
  });
});
