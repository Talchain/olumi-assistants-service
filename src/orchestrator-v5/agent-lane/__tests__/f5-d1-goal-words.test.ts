/**
 * ⭐ F5 D1 (R3 #85 5930715560; product rulings DL 5930770727; SHAPE DL 380e54 on #2447: TYPED, NO WORD LISTS). Paul's own
 * second message "We're aiming to double that within the next 6 months." dead-ended on "say 'at least'" with no card, on
 * staging `29a37d18`. Two doors refused it:
 *   · DIRECTION — the Agent's typed `constraint_type` is its reading; the user's words were silent, so the card is now a
 *     DECISION (the reading primary, the other direction beside it), never a refusal. Only the user's own literal
 *     comparator words can overrule it, by contradicting it.
 *   · FIGURE — £200,000 is typed by the Agent as `derived_from {base: 100000, multiplier: 2}`; code checks the base with the
 *     ordinary figure door and the value by exact arithmetic.
 * Paul's words are verbatim (R3's replay script `output/r3-successor-996ec64d/f5/d1-script.json`).
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { comparatorTheUserWrote, userWordsOf } from '../stated-by-user.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440d01';
const S1 = 'Our quarterly revenue is £100,000.';
const S2 = "We're aiming to double that within the next 6 months.";
const ctxOf = (turn: string, earlier: readonly string[] = []) =>
  ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf(earlier, turn), user_turn_text: turn });

const GRAPH = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Sprint priority' },
    { id: 'sprint', kind: 'factor', label: 'Sprint capacity for AI reporting', observed_state: { value: 0.5, raw_value: 50, unit: '%', cap: 100 } },
    { id: 'quarterly_revenue', kind: 'goal', label: 'Quarterly revenue' },
  ],
  edges: [{ from: 'sprint', to: 'quarterly_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
};
const dispatch: InternalDispatch = async (path) => {
  if (path.endsWith('/graph')) return { status: 200, json: { graph: GRAPH, graph_hash: 'h1' } };
  throw new Error(`unexpected dispatch ${path}`);
};
const propose = (turn: string, earlier: readonly string[], args: Record<string, unknown>, store = new ProposalStore()) =>
  createAgentCapabilities(dispatch, store).proposeGoalTarget!(ctxOf(turn, earlier), { rationale: 'x', unit: '£', ...args } as never);

describe('F5 D1: Paul\'s "aiming to double that" is a target card — a decision, from his own figure', () => {
  it('RED: "double that" after "£100,000" → ONE card "at least £200,000 (2 × your £100,000)", offered as a decision', async () => {
    const store = new ProposalStore();
    const p = await propose(S2, [S1], { constraint_type: 'at_least', value: 200000, derived_from: { base: 100000, multiplier: 2 } }, store);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false, direction_choice: { chosen: 'at_least', alternative: 'at_most' } }));
    expect(p.public_label).toBe('Set the goal "Quarterly revenue" to at least £200,000 (2 × your £100,000)');
    const chips = approvalChipsFor([{ name: 'propose_goal_target', ok: true, mutated: false, proposal_id: String(p.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: p }));
    expect(chips.map((c) => c.label)).toEqual(['Yes, at least', 'At most instead', 'Change something first']);
    expect(chips[0]!.detail).toBe(p.public_label);
    expect(chips[1]).toEqual(expect.objectContaining({ id: 'agent-direction-alternative', message: 'No, the goal should be at most that figure.' }));
  });

  it('RED: neutral wording ("our target is £200,000") takes the SAME path — a decision, never a refusal', async () => {
    const p = await propose('Our target is £200,000 a quarter.', [S1], { constraint_type: 'at_least', value: 200000 });
    expect(p).toEqual(expect.objectContaining({ ok: true, direction_choice: { chosen: 'at_least', alternative: 'at_most' } }));
  });

  it('RED (DL #2447 follow-up 5931593767): a CONTRADICTION is a decision too — "at most £200k" while the Agent reads at least → the literal reading primary', async () => {
    const store = new ProposalStore();
    const p = await propose('It should be at most £200,000.', [S1], { constraint_type: 'at_least', value: 200000 }, store);
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false, direction_choice: { chosen: 'at_most', alternative: 'at_least' } }));
    expect(p.public_label).toBe('Set the goal "Quarterly revenue" to at most £200,000');
    const chips = approvalChipsFor([{ name: 'propose_goal_target', ok: true, mutated: false, proposal_id: String(p.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: p }));
    expect(chips.map((c) => c.label)).toEqual(['Yes, at most', 'At least instead', 'Change something first']);
  });

  it('RED (the DL\'s row): "cut costs to £34k over the next year" — `over` reads a direction against the Agent\'s at most → a decision, never a dead end', async () => {
    const turn = 'We need to cut costs to £34k over the next year.';
    expect(comparatorTheUserWrote(turn), 'precondition: the literal reading is at least (the old `over`)').toBe('at_least');
    const p = await propose(turn, [], { constraint_type: 'at_most', value: 34000 });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false, direction_choice: { chosen: 'at_least', alternative: 'at_most' } }));
  });

  it('CONTROL: the user\'s own literal words carry it — no decision is offered, the card is theirs', async () => {
    const p = await propose('We need at least £200,000 a quarter.', [S1], { constraint_type: 'at_least', value: 200000 });
    expect(p.ok).toBe(true);
    expect(p).not.toHaveProperty('direction_choice');
  });

  it.each([
    ['a derivation that does not add up (2 × £100,000 ≠ £300,000)', { value: 300000, derived_from: { base: 100000, multiplier: 2 } }, 'derivation_mismatch'],
    ['a base the user never wrote (£150,000)', { value: 300000, derived_from: { base: 150000, multiplier: 2 } }, 'target_not_stated'],
    ['no derivation and a figure the user never wrote', { value: 200000 }, 'target_not_stated'],
    ['an unreadable derivation', { value: 200000, derived_from: { base: 100000, multiplier: 'twice' } }, 'unreadable_derivation'],
  ])('CONTROL: %s → refused, nothing prepared', async (_n, args, refusal) => {
    const p = await propose(S2, [S1], { constraint_type: 'at_least', ...args });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal }));
  });
});

describe('no word list over the user\'s wording (DL 380e54): the comparator reads only literal comparator words', () => {
  it.each([
    "We want to reduce churn to reach 2% by March.",
    'Let me double-check: our target is £200k.',
    'Sales took a hit last quarter. Our target is £200k.',
    'We need to cut costs to £34k a month.',
    S2,
  ])('NEGATIVE: %j reads no direction (the Agent\'s typed reading + the decision buttons carry it)', (text) => {
    expect(comparatorTheUserWrote(text)).toBeNull();
  });
});
