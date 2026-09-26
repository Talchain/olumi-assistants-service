/**
 * ⛔ A LEVEL'S LINK IS NOT A STRENGTH TO ASK ABOUT (AI Conversation #70 5849437163 U2b, served c35801a turns[3]): the
 * user gave "it lowers Monthly churn to 6%" for an option not yet linked to churn, and the model left the level out to
 * ask "how strong is that effect". Both level tools now say a level brings its own link and is sent as is — and the
 * capability does exactly that (the tool text never promises what the product does not do).
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, LEVEL_BRINGS_ITS_LINK } from '../runtime/agent-tools.js';
import { createAgentCapabilitiesWithLevelsPort as createAgentCapabilities } from './fixtures/levels-port.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const tool = (name: string) => AGENT_TOOLS.find((t) => t.name === name)!;

describe('a level on an unlinked factor brings its own link; the model is told never to ask how strong it is', () => {
  it('RED: both level tools carry the rule', () => {
    expect(LEVEL_BRINGS_ITS_LINK).toMatch(/brings that link with it, in the same change/);
    expect(LEVEL_BRINGS_ITS_LINK).toMatch(/never ask how strong it is/);
    expect(tool('propose_option_interventions').description).toContain(LEVEL_BRINGS_ITS_LINK);
    expect(tool('propose_starting_point').description).toContain(LEVEL_BRINGS_ITS_LINK);
  });

  it('CONTROL (the promise is true): the served shape — a churn level for an option not linked to churn — is proposed WITH its link, no strength asked', async () => {
    const nodes = [
      { id: 'mrr', kind: 'goal', label: 'MRR' },
      { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.05, unit: 'share per month' } },
      { id: 'cohort', kind: 'option', label: 'Test £54 versus £59 by customer cohort before rollout' },
    ];
    const d: InternalDispatch = async () => ({ status: 200, json: { graph: { nodes, edges: [{ from: 'churn', to: 'mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' }] }, graph_hash: 'h0' } });
    const store = new ProposalStore();
    const r = await createAgentCapabilities(d, store).proposeOptionInterventions(
      { scenario_id: '550e8400-e29b-41d4-a716-446655440099', authenticated_user_id: 'user-a', request_id: 'r', user_text: 'it lowers Monthly churn to 6%' },
      { interventions: [{ option_label: 'Test £54 versus £59 by customer cohort before rollout', factor_label: 'Monthly churn', value: 0.06, basis: 'the user: 6%', user_stated: true }] },
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const ops = store.get(String(r.proposal_id))!.operations;
    expect(ops.find((o) => o.op === 'add_edge' && o.path === 'cohort::churn')?.value).toMatchObject({ link_for_level: true });
    expect(ops.some((o) => o.op === 'set_option_intervention' && o.path === 'cohort::churn')).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/how strong/i);
  });
});
