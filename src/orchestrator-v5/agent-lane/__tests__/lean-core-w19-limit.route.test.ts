/**
 * ⭐ LEAN CORE (#3392, W19; proof-1 dev P05 class "not a figure the user wrote" although the user wrote it): a limit's new figure is
 * the user's by THE ONE RULE (`userStated`, the AI's cited span), and WHICH limit it is stays the AI's reading of a limit the model
 * holds. The host refuses only when the cited words give the figure to ANOTHER quantity instead (DL #72). Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Rec = Record<string, unknown>;
const SCENARIO = '44444444-4444-4444-8444-444444444444';
const graph = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Customer satisfaction' },
    { id: 'ontime', kind: 'factor', label: 'Orders delivered on time', observed_state: { value: 0.9, raw_value: 90, unit: '%', cap: 100 } },
    { id: 'transit', kind: 'factor', label: 'Coastal transit time', observed_state: { value: 0.3, raw_value: 3, unit: 'days', cap: 10 } },
    { id: 'ads', kind: 'factor', label: 'Advertising share', observed_state: { value: 0.2, raw_value: 20, unit: '%', cap: 100 } },
  ],
  edges: [{ from: 'ontime', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
  goal_constraints: [{ constraint_id: 'gc-ontime', node_id: 'ontime', operator: '>=', value: 90, unit: '%', value_frame: 'level', label: 'Orders delivered on time', provenance: 'explicit' }],
};
const propose = (said: string, quote: string | undefined) => {
  const caps = createAgentCapabilities(async (path) => {
    if (!path.endsWith('/graph')) throw new Error(`No write is authorised here: ${path}`);
    return { status: 200, json: { graph: structuredClone(graph), graph_hash: 'h0' } };
  }, new ProposalStore());
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'w19', user_text: said, user_turn_text: said, verified_user_messages: [said] };
  return dispatchTool('propose_limit_change', JSON.stringify({ limit_label: 'Orders delivered on time', operator: '>=', new_value: 85, unit: '%',
    ...(quote !== undefined ? { quote } : {}), rationale: said }), ctx as never, caps) as Promise<Rec>;
};

describe('W19: a limit\'s new figure the user wrote is theirs, whatever words they use for the limit', () => {
  it('P05 class: the user\'s own name for the limit also shares a word with another quantity ("the coastal orders-delivered constraint") → prepared as theirs', async () => {
    const said = 'The coastal orders-delivered constraint should be at least 85%, not 90%; I copied the wrong line.';
    const r = await propose(said, said);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, mutated: false });
  });

  it('CONTRAST: no cited span, or a span that does not write 85, is never "your figure" → figure_not_stated', async () => {
    const said = 'The coastal on-time constraint should be at least 85%, not 90%; I copied the wrong line.';
    expect(await propose(said, undefined)).toMatchObject({ ok: false, mutated: false, refusal: 'figure_not_stated' });
    expect(await propose('Make the on-time limit a bit lower.', 'Make the on-time limit a bit lower.')).toMatchObject({ ok: false, refusal: 'figure_not_stated' });
  });

  it('CONTRAST (DL #72): words that give the figure to ANOTHER quantity instead are refused → figure_not_stated', async () => {
    const said = 'Our advertising share went to 85% this quarter.';
    expect(await propose(said, said)).toMatchObject({ ok: false, mutated: false, refusal: 'figure_not_stated' });
  });
});
