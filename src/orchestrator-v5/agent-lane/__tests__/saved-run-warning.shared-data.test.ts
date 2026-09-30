import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../goal-chance-withheld.js';
import { ProposalStore } from '../proposal.js';

const scenarioId = '550e8400-e29b-41d4-a716-446655440079';
const hash = '7b53bf0ada890991';
const graph = { nodes: [
  { id: 'goal', kind: 'goal', label: 'MRR' },
  { id: 'raise', kind: 'option', label: 'Raise price' },
], edges: [] };
const outcome = { mean: 77000, p10: 75000, p90: 79000 };
const optionComparison = [{ option_id: 'raise', option_label: 'Raise price', outcome }];
const withheldWarning = { code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, severity: 'warning', node_ids: ['goal'],
  message: "Not shown. 'MRR' depends on price × subscribers, but this run couldn't calculate it that way." };

async function canonicalState(kind: 'complete_current' | 'complete_stale', warning: boolean) {
  const analysis_result = { computed_against_hash: hash, enrichment: {
    option_comparison: optionComparison,
    inference_warnings: warning ? [withheldWarning] : [],
  } };
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph')
    ? { status: 200, json: { graph, graph_hash: hash,
      analysis_state: { run_state: { kind, graph_hash_at_run: hash } }, analysis_result,
    } }
    : { status: 500, json: {} };
  return createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({
    scenario_id: scenarioId, authenticated_user_id: null, request_id: 'saved-run-warning',
  }) as Promise<Record<string, any>>;
}

describe('selected saved Run withholds goal outcomes from later Agent context', () => {
  it('a current #416 warning gives the Agent the rule but no goal outcome', async () => {
    const state = await canonicalState('complete_current', true);
    expect(state.analysis.goal_chance).toMatchObject({ withheld: true, node_ids: ['goal'] });
    expect(state.analysis.goal_chance.note).toMatch(/estimated value for the goal itself/);
    expect(state.analysis.saved_run_options).toEqual([{ option_id: 'raise', option_label: 'Raise price' }]);
    expect(JSON.stringify(state.analysis.saved_run_options)).not.toMatch(/outcome|77000/);
  });

  it('a current Run without the warning retains its outcome', async () => {
    const state = await canonicalState('complete_current', false);
    expect(state.analysis).not.toHaveProperty('goal_chance');
    expect(state.analysis.saved_run_options).toEqual([{ option_id: 'raise', option_label: 'Raise price', outcome }]);
  });

  it('a stale Run does not promote its warning or outcomes', async () => {
    const state = await canonicalState('complete_stale', true);
    expect(state.analysis).not.toHaveProperty('goal_chance');
    expect(state.analysis).not.toHaveProperty('saved_run_options');
  });
});
