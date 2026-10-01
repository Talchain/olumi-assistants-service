/**
 * ⭐ F5 D1 (R3 #85 5930715560; DL 5930770727 — PRODUCT RULINGS (b) and the derived figure, F1 spec §4): Paul's own second
 * message "We're aiming to double that within the next 6 months." dead-ended on "say 'at least'" with no card, on staging
 * `29a37d18`. Two doors refused it: the DIRECTION (no "at least" word — but "double" states an increase) and the FIGURE
 * (£200,000 is not a figure he wrote — but it is twice his own £100,000, written the turn before).
 * The rows below are Paul's words verbatim (R3's replay script `output/r3-successor-996ec64d/f5/d1-script.json`).
 */
import { describe, it, expect } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { comparatorTheUserWrote, derivedFigureTheUserWrote, userWordsOf } from '../stated-by-user.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440d01';
const S1 = 'Our quarterly revenue is £100,000.';
const S2 = "We're aiming to double that within the next 6 months.";
const ctxOf = (turn: string, earlier: readonly string[] = []) =>
  ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: userWordsOf(earlier, turn), user_turn_text: turn });

type Node = { id: string; kind: string; label: string; [k: string]: unknown };
const GRAPH = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'Sprint priority' },
    { id: 'sprint', kind: 'factor', label: 'Sprint capacity for AI reporting', observed_state: { value: 0.5, raw_value: 50, unit: '%', cap: 100 } },
    { id: 'quarterly_revenue', kind: 'goal', label: 'Quarterly revenue' } as Node,
  ],
  edges: [{ from: 'sprint', to: 'quarterly_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
};
const dispatch: InternalDispatch = async (path) => {
  if (path.endsWith('/graph')) return { status: 200, json: { graph: GRAPH, graph_hash: 'h1' } };
  throw new Error(`unexpected dispatch ${path}`);
};

describe('F5 D1: Paul\'s "aiming to double that" is a target card, at least, worded from his own figure', () => {
  it('RED: "double that" after "£100,000" → ONE proposal: at least £200,000, labelled as double his £100,000', async () => {
    const p = await createAgentCapabilities(dispatch, new ProposalStore()).proposeGoalTarget!(ctxOf(S2, [S1]),
      { constraint_type: 'at_least', value: 200000, unit: '£', rationale: 'Double the current quarterly revenue.' });
    expect(p, JSON.stringify(p)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(p.public_label).toBe('Set the goal "Quarterly revenue" to at least £200,000 (double your £100,000)');
  });

  it('CONTROL: the Agent\'s own figure is still refused — triple (£300,000) is not what Paul said', async () => {
    const p = await createAgentCapabilities(dispatch, new ProposalStore()).proposeGoalTarget!(ctxOf(S2, [S1]),
      { constraint_type: 'at_least', value: 300000, unit: '£', rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'target_not_stated' }));
  });

  it('CONTROL: "at most" is still refused against an increase ("double" binds at least)', async () => {
    const p = await createAgentCapabilities(dispatch, new ProposalStore()).proposeGoalTarget!(ctxOf(S2, [S1]),
      { constraint_type: 'at_most', value: 200000, unit: '£', rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'direction_not_stated' }));
  });

  it('RED (c): neutral wording is asked with decision buttons — a typed `needs: direction` ask, nothing prepared', async () => {
    const p = await createAgentCapabilities(dispatch, new ProposalStore()).proposeGoalTarget!(ctxOf('Our target is £200,000 a quarter.', [S1]),
      { constraint_type: 'at_least', value: 200000, unit: '£', rationale: 'x' });
    expect(p).toEqual(expect.objectContaining({ ok: false, refusal: 'direction_not_stated', needs: 'direction', direction_options: ['at_least', 'at_most'] }));
  });
});

describe('comparatorTheUserWrote — an increase binds at least, a decrease at most (DL 5930770727 (b))', () => {
  it.each([
    [S2, 'at_least'],
    ['We want to reach £200k a quarter.', 'at_least'],
    ['Grow it to £200k by March.', 'at_least'],
    ['We need to hit £1m ARR.', 'at_least'],
    ['Triple our signups.', 'at_least'],
    ['Cut it to £40k a month.', 'at_most'],
    ['Bring it down to 3%.', 'at_most'],
    ['Halve our churn.', 'at_most'],
  ])('RED: %j → %s', (text, want) => {
    expect(comparatorTheUserWrote(text)).toBe(want);
  });
  it.each([
    'Our target is £200k.',
    'Should we double it?',
    "We can't double it this quarter.",
    'Double it, but keep costs under £10k.',
  ])('CONTROL: neutral, asked, denied or both ways → null (%j)', (text) => {
    expect(comparatorTheUserWrote(text)).toBeNull();
  });
});

describe('derivedFigureTheUserWrote — bound to the user\'s own base by exact arithmetic', () => {
  it('RED: double / twice / half / N times of a figure the user wrote', () => {
    expect(derivedFigureTheUserWrote(200000, '£', userWordsOf([S1], S2), S2)).toEqual({ base: 100000, multiplier: 2, word: 'double' });
    expect(derivedFigureTheUserWrote(50000, '£', userWordsOf([S1], 'Halve it.'), 'Halve it.')).toEqual({ base: 100000, multiplier: 0.5, word: 'halve' });
    expect(derivedFigureTheUserWrote(300000, '£', userWordsOf([S1], 'Make it 3 times that.'), 'Make it 3 times that.')).toEqual(expect.objectContaining({ base: 100000, multiplier: 3 }));
  });
  it.each([
    ['no multiplier word this turn', 200000, 'We want more.'],
    ['a multiplier only asked', 200000, 'Should we double it?'],
    ['a multiplier denied', 200000, "We won't double it."],
    ['no base the user wrote', 400000, S2],
    ['another currency', 200000, S2, '$'],
  ])('CONTROL: %s → null', (_name, value, turn, unit = '£') => {
    expect(derivedFigureTheUserWrote(value as number, unit, userWordsOf([S1], turn as string), turn as string)).toBeNull();
  });
});
