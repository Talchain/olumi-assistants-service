import { describe, it, expect } from 'vitest';
import { classifyProposal } from '../classify-proposal.js';
import { assessCandidate } from '../readiness-parity.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph, buildUnconfiguredGraph } from './fixtures.js';
import { assessAnalysisReadiness, ep2State } from '../../tools/handlers/analysis-ready-core.js';

describe('EP2 readiness parity (INV-3)', () => {
  it('would_apply  <=>  EP2 ready/repaired  (across a ready and an unconfigured base)', () => {
    for (const graph of [buildReadyGraph(), buildUnconfiguredGraph()]) {
      const r = classifyProposal(
        {
          kind: 'rename_node',
          base_graph_hash: currentAnalysisHash(graph),
          node_id: 'g-profit',
          new_label: 'Renamed',
        },
        graph,
      );

      // Independent EP2 read of the spike's own candidate.
      const direct = ep2State(assessAnalysisReadiness(r.candidate));
      const wouldApply = r.verdict === 'would_apply';
      const ep2Green = direct === 'ready' || direct === 'repaired_for_analysis';

      expect(wouldApply).toBe(ep2Green); // the biconditional
      expect(r.ep2_state).toBe(direct); // spike reports EP2 verbatim
    }
  });

  it('the verdict is DERIVED from assessAnalysisReadiness (no bespoke V6 readiness rule)', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(
      {
        kind: 'rename_node',
        base_graph_hash: currentAnalysisHash(graph),
        node_id: 'o-a',
        new_label: 'Plan A2',
      },
      graph,
    );
    const a = assessCandidate(r.candidate);
    expect(r.ep2_state).toBe(a.state);
  });

  it('ready base => would_apply/ready; unconfigured base => not-would_apply/blocked', () => {
    const ready = buildReadyGraph();
    const rReady = classifyProposal(
      { kind: 'rename_node', base_graph_hash: currentAnalysisHash(ready), node_id: 'g-profit', new_label: 'R' },
      ready,
    );
    expect(rReady.verdict).toBe('would_apply');
    expect(rReady.ep2_state).toBe('ready');

    const unconfigured = buildUnconfiguredGraph();
    const rUnconf = classifyProposal(
      { kind: 'rename_node', base_graph_hash: currentAnalysisHash(unconfigured), node_id: 'g-profit', new_label: 'R' },
      unconfigured,
    );
    expect(rUnconf.verdict).not.toBe('would_apply');
    expect(rUnconf.ep2_state).toBe('blocked');
  });
});
