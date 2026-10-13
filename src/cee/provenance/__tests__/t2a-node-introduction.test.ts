import { describe, expect, it } from 'vitest';
import { nodeIntroductionOf } from '../provenance-of.js';
import { markOlumiOptions } from '../../../orchestrator-v5/agent-lane/olumi-option-marker.js';
import type { CandidateModel } from '../../../orchestrator-v5/agent-lane/admit-model.js';
import { applyOlumiOptionAdoption } from '../../../orchestrator-v5/system-events/olumi-option-adoption.js';
import { createAgentCapabilities, type InternalDispatch } from '../../../orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../orchestrator-v5/agent-lane/proposal.js';
import { computeExpectedGraphCasHashes } from '../../../orchestrator-v5/context/graph-cas-conflict.js';

describe('T2-A node introduction verdict, read-only', () => {
  it('(c) admission -> proposal -> card approval -> canonical adoption -> JSON readback', async () => {
    const candidate = { factors: [], options: [{ label: 'Pilot', provenance: 'ai_proposed',
      interventions: [{ factor_label: 'Price', value: 54, unit: 'GBP' }] }] } as unknown as CandidateModel;
    const nodes = markOlumiOptions([
      { id: 'price', kind: 'factor', label: 'Price' },
      { id: 'pilot', kind: 'option', label: 'Pilot', interventions: { price: { value: 54, source: 'cee_hypothesis' } } },
    ], candidate, 'Keep the current plan.');
    const graph = { nodes, edges: [{ from: 'pilot', to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' }] };
    const before = JSON.stringify(graph);
    expect(nodeIntroductionOf(nodes[1])).toEqual({ origin: 'olumi_added', adopted: false });
    expect(JSON.stringify(graph)).toBe(before);
    let bytes = before;
    let commits = 0;
    const read = () => JSON.parse(bytes);
    const dispatch: InternalDispatch = async path => {
      expect(path.endsWith('/graph')).toBe(true);
      const hashes = computeExpectedGraphCasHashes(read());
      return { status: 200, json: { graph: read(), graph_hash: hashes.expectedGraphAnalysisHash,
        graph_identity_hash: hashes.expectedGraphIdentityHash } };
    };
    const proposals = new ProposalStore();
    const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, {
      commitOlumiOptionAdoption: async input => {
        const adopted = applyOlumiOptionAdoption(read(), input);
        expect(adopted.kind, JSON.stringify(adopted)).toBe('mutated');
        if (adopted.kind !== 'mutated') throw new Error(JSON.stringify(adopted));
        commits += 1;
        bytes = JSON.stringify(adopted.graph);
        return { status: 'committed', graph_hash: adopted.graph_hash };
      },
    });
    const ctx = { scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', authenticated_user_id: null,
      request_id: 't2a-node', user_text: 'Add Pilot to the comparison.', user_turn_text: 'Add Pilot to the comparison.' };
    const proposed = await caps.proposeNewOption!(ctx, { label: 'Pilot' });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    expect(commits).toBe(0);
    expect(nodeIntroductionOf(read().nodes[1])).toEqual({ origin: 'olumi_added', adopted: false });
    const card = proposals.get(String(proposed.proposal_id))!;
    const words = (card.operations[0]!.value as { approval_message: string }).approval_message;
    const approved = await caps.authoriseChange({ ...ctx, typed_approval_of: card.proposal_id, typed_approval_words: words },
      { proposal_id: card.proposal_id });
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    expect(approved.applied).toBe(true);
    expect(commits).toBe(1);
    expect(nodeIntroductionOf(read().nodes[1])).toEqual({ origin: 'olumi_added', adopted: true });
    expect(JSON.stringify(graph)).toBe(before);
  });
  it.each([undefined, {}, { provenance: 'ai_inferred' }, { extractionType: 'inferred' },
    { observed_state: { source: 'cee_inference' } }, { kind: 'option', analysis_participation: 'included' }])(
    '(c) no positive introduction evidence stays unknown: %j', node => {
      expect(nodeIntroductionOf(node)).toEqual({ origin: 'unknown', adopted: false });
    });
  it('later exclusion retains adoption', () => {
    expect(nodeIntroductionOf({ kind: 'option', proposed_by: 'olumi', analysis_participation: 'retained_excluded', option_status: 'removed' }))
      .toEqual({ origin: 'olumi_added', adopted: true });
  });
});
