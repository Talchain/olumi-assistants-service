/**
 * Paul 21 Oct + DL rulings: what each option most likely gives, in the goal's own units, and whether the likely ranges
 * separate. Fixture = the served weekly-orders Run (staging pair b5e08181 → eee5c6ef): goal "at least 150 orders a week",
 * cap 187.5, outcomes normalised on that cap; the goal-chance licence quotes A about 78%, B about 16%.
 */
import { describe, expect, it } from 'vitest';
import { GOAL_CHANCE_LICENSED, type SentGoalThreshold } from '../goal-chance-licence.js';
import { OPTION_OUTCOME_WORDS, RANGES_OVERLAP, RANGES_SEPARATE, optionOutcomeWordsOf, withOptionOutcomeWords } from '../option-outcome-words.js';

const goal = { id: 'goal', kind: 'goal', label: 'Weekly orders', goal_threshold: 0.8, goal_threshold_raw: 150, goal_threshold_cap: 187.5,
  goal_threshold_unit: 'orders a week' };
const graph = (g: Record<string, unknown> = goal) => ({ nodes: [g,
  { id: 'option_a', kind: 'option', label: 'Option A (a referral programme)' },
  { id: 'option_b', kind: 'option', label: 'Option B (a price cut)' },
  { id: 'carry_on', kind: 'option', label: 'Carrying on as now', is_baseline: true }], edges: [] });
const SERVED_A = { p10: 0.7365072309597751, p50: 0.9071666412037307, p90: 1.0787897506139434 };
const SERVED_B = { p10: 0.67927555552557, p50: 0.7467293144607441, p90: 0.8164261097477908 };
const envelope = (b = SERVED_B, licensed = true) => ({
  option_comparison: [
    { option_id: 'option_a', outcome: SERVED_A, probability_of_goal: 0.7807 },
    { option_id: 'option_b', outcome: b, probability_of_goal: 0.1617 },
    // The status quo held by assumption: no spread, so no sentence and no part in the separation.
    { option_id: 'carry_on', outcome: { p50: 0.64, mean: 0.64 } },
  ],
  inference_warnings: licensed ? [{ code: GOAL_CHANCE_LICENSED, severity: 'info', message: '', form: 'each',
    option_ids: ['option_a', 'option_b'], pct_by_option: { option_a: 78, option_b: 16 } }] : [],
});
const LEVEL: SentGoalThreshold = { value: 0.8, field: 'goal_threshold', frame: 'level' };

describe('option outcome words — the served shape', () => {
  it('each option in the goal\'s units, p50 with its p10–p90, the licensed chance; the ranges overlap', () => {
    const w = optionOutcomeWordsOf(envelope(), graph(), 'goal', LEVEL)!;
    expect(w.code).toBe(OPTION_OUTCOME_WORDS);
    expect(w.options).toEqual([
      { option_id: 'option_a', words: 'With the data provided, Option A (a referral programme) most likely gives about 170 orders a week (likely 140–200 orders a week), about 78% chance of meeting your goal.' },
      { option_id: 'option_b', words: 'With the data provided, Option B (a price cut) most likely gives about 140 orders a week (likely 130–150 orders a week), about 16% chance of meeting your goal.' },
    ]);
    expect([w.separation, w.message]).toEqual(['overlap', RANGES_OVERLAP]);
    expect(JSON.stringify(w)).not.toMatch(/\b(best|winner|top|leads?|ahead|recommend)\b/i);
  });

  it('ranges that do not overlap → "clearly separate" (contrast: the served pair overlaps)', () => {
    const w = optionOutcomeWordsOf(envelope({ p10: 0.5, p50: 0.6, p90: 0.7 }), graph(), 'goal', LEVEL)!;
    expect([w.separation, w.message]).toEqual(['separate', RANGES_SEPARATE]);
  });

  it('no licence → no chance clause, the figures stay', () => {
    const w = optionOutcomeWordsOf(envelope(SERVED_B, false), graph(), 'goal', LEVEL)!;
    expect(w.options[0].words).toBe('With the data provided, Option A (a referral programme) most likely gives about 170 orders a week (likely 140–200 orders a week).');
  });

  it('stored with the Run as ONE info entry beside the licence', () => {
    const out = withOptionOutcomeWords(envelope(), graph(), 'goal', LEVEL);
    expect(out.inference_warnings.map((w) => (w as { code: string }).code)).toEqual([GOAL_CHANCE_LICENSED, OPTION_OUTCOME_WORDS]);
  });
});

describe('NUMBERS ONLY IN THE GOAL\'S REAL UNITS — otherwise only whether the ranges separate', () => {
  it.each([
    ['no dispatched threshold (no target / not recorded)', graph(), undefined],
    ['a change goal', graph(), { ...LEVEL, frame: 'delta' } as SentGoalThreshold],
    ['a cap that does not convert to the stated target', graph({ ...goal, goal_threshold_cap: 200 }), LEVEL],
    ['no unit on the goal', graph({ ...goal, goal_threshold_unit: '' }), LEVEL],
    ['a dispatched threshold that is not the goal\'s', graph(), { ...LEVEL, value: 0.7 }],
  ])('%s → no option sentence; the separation stays', (_, g, sent) => {
    const w = optionOutcomeWordsOf(envelope(), g, 'goal', sent)!;
    expect(w.options).toEqual([]);
    expect([w.separation, w.message]).toEqual(['overlap', RANGES_OVERLAP]);
  });

  it('CONTROL: the raw-frame threshold reads the figures as they are (factor 1)', () => {
    const raw = { option_comparison: [{ option_id: 'option_a', outcome: { p10: 138, p50: 170, p90: 202 } }], inference_warnings: [] };
    expect(optionOutcomeWordsOf(raw, graph(), 'goal', { value: 150, field: 'goal_threshold_raw', frame: 'level' })!.options[0].words)
      .toBe('With the data provided, Option A (a referral programme) most likely gives about 170 orders a week (likely 140–200 orders a week).');
  });

  it('a Run with no ranged option → nothing', () => {
    expect(optionOutcomeWordsOf({ option_comparison: [{ option_id: 'carry_on', outcome: { p50: 0.64 } }] }, graph(), 'goal', LEVEL)).toBeNull();
  });
});
