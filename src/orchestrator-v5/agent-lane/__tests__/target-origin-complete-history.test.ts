import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { statementOrigin } from '../../../cee/provenance/provenance-of.js';

const graph = { nodes: [{ id: 'goal', kind: 'goal', label: 'MRR', goal_threshold_raw: 50000, goal_threshold_unit: '£', goal_threshold_cap: 75000, goal_threshold: 2 / 3, goal_direction: '>=', goal_threshold_frame: 'level' },
  { id: 'price', kind: 'factor', label: 'Price' }], edges: [{ from: 'price', to: 'goal', strength: { mean: .5, std: .1 }, exists_probability: 1, provenance: { source: 'cee_hypothesis' } }], goal_node_id: 'goal' };
const ctx = { scenario_id: 'scenario-origin', authenticated_user_id: null, request_id: 'r', user_text: 'Consider the planning assumptions.', user_turn_text: 'Consider the planning assumptions.', user_text_complete: true };
const dispatch: InternalDispatch = async path => {
  if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'hash' } };
  throw new Error(`Unexpected write: ${path}`);
};
describe('T2f complete-source capability origin', () => {
  it('complete history is not authorship; an absent completeness flag is incomplete', () => {
    expect(statementOrigin(false, false, true, false)).toBe('unknown');
    expect(statementOrigin(false, false)).toBe('unknown');
    expect(statementOrigin(true, true, true, true)).toBe('human');
  });
  it.each(['unverified', 'brief'])('retained %s material stays unknown despite complete history and an explicit estimate', async where => {
    const local: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'hash', ...(where === 'brief' ? { brief_text: 'We need £60k MRR.' } : {}) } });
    const caps = createAgentCapabilities(local, new ProposalStore());
    const result = await caps.proposeGoalTarget!({ ...ctx, ...(where === 'unverified' ? { unverified_user_text: 'We need £60k MRR.' } : {}) },
      { constraint_type: 'at_least', value: 60000, unit: '£', user_stated: false, rationale: 'An estimate basis.' });
    expect(result.refusal).toBe('origin_unknown');
    expect(result.input_claim).toEqual({ origin: 'unknown', basis: 'An estimate basis.', source_quote: '' });
  });
  it.each(['target', 'current', 'link', 'scope'])('%s: complete history and a blank basis do not make a new AI estimate', async kind => {
    const caps = createAgentCapabilities(dispatch, new ProposalStore());
    const result = kind === 'target' ? await caps.proposeGoalTarget!(ctx, { constraint_type: 'at_least', value: 60000, unit: '£', user_stated: false, rationale: ' ' })
      : kind === 'current' ? await caps.proposeGoalCurrentLevel!(ctx, { goal_label: 'MRR', value: 12000, unit: '£', user_stated: false, basis: ' ' })
      : kind === 'link' ? await caps.proposeLinkStrength!(ctx, { from_label: 'Price', to_label: 'MRR', strength: 'weak', user_stated: false, rationale: ' ' })
      : await caps.reconcileGoalScope!(ctx, { goal_label: 'MRR', user_stated: false, basis: ' ', scope: { modelled: 'whole business MRR', alternative: 'one segment', extent: 'total', stated_in_brief: false, source: { quote: 'MRR covers the whole business.' } } });
    expect(result.refusal, JSON.stringify(result)).toBe('origin_unknown');
  });
});
