/**
 * ⭐ A REFUSAL THE USER CAN SETTLE BY CHOOSING — tool side (Paul's order #4; interface MG #85 5933547779, agreed AI HARNESS
 * 5934163980). `direction_not_stated` on a new risk or a new factor offers the link's two directions as typed choices,
 * bound to the node id; the user's PRESS (`ctx.chosen`, parsed by the host from the chip id) is taken only for this tool and
 * this node, and only as one of the two directions. Anything else changes nothing: the same refusal comes back.
 */
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { userWordsOf } from '../stated-by-user.js';
import type { HoldAddRiskInput } from '../../system-events/dispatch.js';
import {
  AGENT_CHOICE_PREFIX, MAX_REFUSAL_CHOICES, directionField, pressedValue, refusalChoiceId, refusalChoices, type ChosenAnswer,
} from '../refusal-choices.js';

const SCENARIO = '550e8400-e29b-41d4-a716-44665544c401';
const SAID = 'Add a risk: a competitor could cut prices.';

const GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Quarterly revenue' },
    { id: 'o_rev', kind: 'outcome', label: 'Enterprise revenue' },
    { id: 'o_churn', kind: 'outcome', label: 'Customer churn' },
    { id: 'f_price', kind: 'factor', label: 'Pro plan price' },
  ],
  edges: [
    { from: 'o_rev', to: 'g', strength: { mean: 0.5, std: 0.1 }, effect_direction: 'positive' },
    { from: 'o_churn', to: 'g', strength: { mean: -0.4, std: 0.1 }, effect_direction: 'negative' },
    { from: 'f_price', to: 'o_rev', strength: { mean: 0.3, std: 0.1 }, effect_direction: 'positive' },
  ],
};

const d: InternalDispatch = async (path) => {
  if (path.endsWith('/graph')) return { status: 200, json: { graph: GRAPH, graph_hash: 'h1' } };
  throw new Error(`unexpected dispatch ${path}`);
};

/** The add-risk door, faked at its typed port: it records what the tool would hold (the links and their directions). */
function caps(chosen?: ChosenAnswer) {
  const held: HoldAddRiskInput[] = [];
  const c = createAgentCapabilities(d, new ProposalStore(), undefined, 'full', undefined, {
    holdAddRisk: async (input) => { held.push(input); return { status: 'refused', reason: 'test_port' } as never; },
  });
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf([], SAID), user_turn_text: SAID,
    ...(chosen !== undefined ? { chosen } : {}) };
  return { c, ctx, held };
}

const riskArgs = (direction?: string) => ({
  label: 'Competitor price cut', rationale: SAID,
  affects: [{ target_label: 'Enterprise revenue', ...(direction !== undefined ? { direction } : {}) }],
});

describe('the pieces: ids, the cap, and the accept rule', () => {
  it('the chip id is agent-choice:<tool>:<field>:<value>', () => {
    expect(refusalChoiceId('propose_new_risk', directionField('affects', 'o_rev'), 'negative'))
      .toBe(`${AGENT_CHOICE_PREFIX}:propose_new_risk:affects/o_rev/direction:negative`);
  });
  it('more than MAX_REFUSAL_CHOICES (or none) offers no buttons', () => {
    const four = ['a', 'b', 'c', 'd'].map((v) => ({ value: v, label: v }));
    expect(refusalChoices('t', 'f', four.slice(0, MAX_REFUSAL_CHOICES))).toHaveLength(3);
    expect(refusalChoices('t', 'f', four)).toBeUndefined();
    expect(refusalChoices('t', 'f', [])).toBeUndefined();
  });
  it.each([
    ['another tool', { tool: 'propose_new_factor', field: 'x', value: 'a' }],
    ['another field', { tool: 't', field: 'y', value: 'a' }],
    ['a value not offered now', { tool: 't', field: 'x', value: 'zzz' }],
  ])('a press for %s is not taken', (_n, chosen) => {
    expect(pressedValue(chosen, 't', 'x', ['a', 'b'])).toBeNull();
  });
  it('CONTROL: the press for this tool, field and an offered value is taken', () => {
    expect(pressedValue({ tool: 't', field: 'x', value: 'b' }, 't', 'x', ['a', 'b'])).toBe('b');
  });
});

describe('direction_not_stated on a NEW RISK offers the two directions; a press settles it', () => {
  it('RED: no direction → the refusal offers TWO typed choices bound to the outcome\'s id, naming it; nothing is held', async () => {
    const { c, ctx, held } = caps();
    const r = await c.proposeNewRisk!(ctx as never, riskArgs() as never);
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'direction_not_stated' });
    expect(r.choices).toEqual([
      { id: 'agent-choice:propose_new_risk:affects/o_rev/direction:negative', label: 'It would lower "Enterprise revenue"', field: 'affects/o_rev/direction', value: 'negative' },
      { id: 'agent-choice:propose_new_risk:affects/o_rev/direction:positive', label: 'It would raise "Enterprise revenue"', field: 'affects/o_rev/direction', value: 'positive' },
    ]);
    expect(held).toEqual([]);
  });

  it('RED: the user PRESSED "lower" for this risk and this outcome → the link is held with that direction', async () => {
    const { c, ctx, held } = caps({ tool: 'propose_new_risk', field: 'affects/o_rev/direction', value: 'negative' });
    await c.proposeNewRisk!(ctx as never, riskArgs() as never);
    expect(held, 'the press got past the direction question').toHaveLength(1);
    expect(held[0]!.links).toEqual([expect.objectContaining({ to_id: 'o_rev', effect_direction: 'negative' })]);
  });

  it('the press is the user\'s answer: it wins over a direction the model guessed', async () => {
    const { c, ctx, held } = caps({ tool: 'propose_new_risk', field: 'affects/o_rev/direction', value: 'negative' });
    await c.proposeNewRisk!(ctx as never, riskArgs('positive') as never);
    expect(held[0]!.links).toEqual([expect.objectContaining({ to_id: 'o_rev', effect_direction: 'negative' })]);
  });

  it.each([
    ['for another tool', { tool: 'propose_new_factor', field: 'affects/o_rev/direction', value: 'negative' }],
    ['for another node (the graph moved, or a stale chip)', { tool: 'propose_new_risk', field: 'affects/o_churn/direction', value: 'negative' }],
    ['with a forged value', { tool: 'propose_new_risk', field: 'affects/o_rev/direction', value: 'sideways' }],
    ['for the other role', { tool: 'propose_new_risk', field: 'caused_by/o_rev/direction', value: 'negative' }],
  ])('NEGATIVE: a press %s is ignored — the same refusal, with its choices, and nothing held', async (_n, chosen) => {
    const { c, ctx, held } = caps(chosen);
    const r = await c.proposeNewRisk!(ctx as never, riskArgs() as never);
    expect(r).toMatchObject({ ok: false, refusal: 'direction_not_stated' });
    expect((r.choices as unknown[]).length).toBe(2);
    expect(held).toEqual([]);
  });

  it('CONTROL: a direction the model passed (no press) still goes through as before', async () => {
    const { c, ctx, held } = caps();
    await c.proposeNewRisk!(ctx as never, riskArgs('negative') as never);
    expect(held[0]!.links).toEqual([expect.objectContaining({ to_id: 'o_rev', effect_direction: 'negative' })]);
  });

  it('caused_by: no direction → "more/less likely" choices bound to the FACTOR\'s id; a press settles it', async () => {
    const args = { ...riskArgs('negative'), caused_by: [{ factor_label: 'Pro plan price' }] };
    const first = caps();
    const r = await first.c.proposeNewRisk!(first.ctx as never, args as never);
    expect(r).toMatchObject({ refusal: 'direction_not_stated' });
    expect((r.choices as { id: string; label: string }[]).map((x) => [x.id, x.label])).toEqual([
      ['agent-choice:propose_new_risk:caused_by/f_price/direction:negative', 'More "Pro plan price" makes it less likely'],
      ['agent-choice:propose_new_risk:caused_by/f_price/direction:positive', 'More "Pro plan price" makes it more likely'],
    ]);
    const pressed = caps({ tool: 'propose_new_risk', field: 'caused_by/f_price/direction', value: 'positive' });
    await pressed.c.proposeNewRisk!(pressed.ctx as never, args as never);
    expect(pressed.held[0]!.links).toEqual(expect.arrayContaining([expect.objectContaining({ from_id: 'f_price', effect_direction: 'positive' })]));
  });
});
