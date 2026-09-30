/**
 * ⛔ A CARD THAT SIZES A LINK SAYS WHAT ITS SOURCE MEANS IN THE MODEL (AIQ 5914532431; R3 5914500931).
 *
 * SERVED (Paul's funding scenario 3b047ee4, 13:21–13:28Z): Paul called "Fundraising overhead" → funding "strong", reading
 * the factor as EFFORT ("more effort equates to more potential funding opportunities"). In the model the same node — hours
 * a week — cut investment-firm outreach and raised runway exhaustion. The card read only 'Record "Fundraising overhead" →
 * "securing funding" as strong …', so his approval stored his size on a meaning he was never shown.
 *
 * Now the card names the source's unit and what else it drives, so the approval carries that reading. The graph below is
 * the served build's shape (R3 accept-paul `base-1449Z/02-cold-after-build.json`), by node id.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, sourceMeaningInModel, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '3b047ee4-0000-4000-8000-000000000001';
const said = (text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: text, user_turn_text: text });

const NODES = [
  { id: 'decision_securing_funding', kind: 'decision', label: 'Decision: securing funding' },
  { id: 'securing_funding', kind: 'goal', label: 'securing funding' },
  { id: 'angel_bridge_outreach', kind: 'option', label: 'Angel bridge outreach' },
  { id: 'funding_process_overhead', kind: 'factor', label: 'Funding process overhead', observed_state: { value: 0.1, raw_value: 8, unit: 'hours/week' } },
  { id: 'warm_introductions', kind: 'factor', label: 'Warm introductions', observed_state: { value: 0.08, raw_value: 4, unit: 'introductions/month' } },
  { id: 'fundraising_distraction', kind: 'risk', label: 'Fundraising distraction' },
  { id: 'qualified_investor_conversations', kind: 'outcome', label: 'Qualified investor conversations' },
];
const edge = (from: string, to: string, mean: number) => ({
  from, to, strength: { mean, std: 0.125 }, effect_direction: mean < 0 ? 'negative' : 'positive', exists_probability: 0.8,
  provenance: { source: 'cee_hypothesis' }, defaulted: true,
});
const EDGES = [
  { from: 'decision_securing_funding', to: 'angel_bridge_outreach', strength: { mean: 1, std: 0.01 } },
  { from: 'angel_bridge_outreach', to: 'funding_process_overhead', strength: { mean: 1, std: 0.01 } },
  edge('funding_process_overhead', 'qualified_investor_conversations', -0.5),
  edge('funding_process_overhead', 'fundraising_distraction', 0.5),
  edge('funding_process_overhead', 'securing_funding', 0.5),          // the link Paul sized
  edge('warm_introductions', 'qualified_investor_conversations', 0.5),
  edge('qualified_investor_conversations', 'securing_funding', 0.5),
  edge('fundraising_distraction', 'securing_funding', -0.5),
];

function caps() {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: NODES, edges: EDGES }, graph_hash: 'h1' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
}

const MEANING = ' In the model, "Funding process overhead" (hours/week) also lowers "Qualified investor conversations" and raises "Fundraising distraction".';
const PAUL = "I think it's strong — more effort equates to more potential funding opportunities.";

describe("a link-sizing card names its source's meaning in the model (AIQ 5914532431)", () => {
  it("RED: Paul's \"strong\" on overhead → funding: the card says the unit and that it also lowers conversations and raises distraction", async () => {
    const p = await caps().proposeLinkStrength!(said(PAUL), {
      from_label: 'Funding process overhead', to_label: 'securing funding', strength: 'strong', rationale: PAUL,
    });
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label)).toMatch(/^Record "Funding process overhead" → "securing funding" as strong/);
    expect(String(p.public_label).endsWith(`.${MEANING}`)).toBe(true);
  });

  it('RED: the same reading on the several-links card, for the user\'s own size; CONTROL: none for Olumi\'s estimate', async () => {
    const words = 'Funding process overhead is strong';
    const mine = await caps().proposeLinkStrengths!(said(`${words} for securing funding.`), {
      links: [{ from_label: 'Funding process overhead', to_label: 'securing funding', strength: 'strong', from_words: words }],
      rationale: words,
    });
    expect(mine.ok, JSON.stringify(mine)).toBe(true);
    expect(String(mine.public_label)).toMatch(/reviewed by you|your estimate/);
    expect(String(mine.public_label).endsWith(`.${MEANING}`)).toBe(true);

    const olumis = await caps().proposeLinkStrengths!(said('What would you suggest for that link?'), {
      links: [{ from_label: 'Funding process overhead', to_label: 'securing funding', strength: 'strong' }],
      rationale: 'The user asked for a suggestion.',
    });
    expect(olumis.ok, JSON.stringify(olumis)).toBe(true);
    expect(String(olumis.public_label)).toContain('Olumi\u2019s estimate');
    expect(String(olumis.public_label)).not.toContain('In the model,');
  });

  it('CONTROL: a source that drives nothing else keeps today\'s card, byte for byte', () => {
    expect(sourceMeaningInModel({ nodes: NODES, edges: EDGES }, 'warm_introductions', 'qualified_investor_conversations')).toBe('');
  });

  it('CONTROL: the options that SET the source are not "driven" by it, and the link being sized is not repeated', () => {
    const m = sourceMeaningInModel({ nodes: NODES, edges: EDGES }, 'funding_process_overhead', 'securing_funding');
    expect(m).toBe(MEANING);
    expect(m).not.toContain('Angel bridge outreach');
    expect(m).not.toContain('"securing funding"');
  });
});
