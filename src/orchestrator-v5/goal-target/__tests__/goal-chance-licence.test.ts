/**
 * D3 STEP 2 — the goal chance's OWN licence (DL 0df0e1 #87 6006078553; Science d5 6005279728 / 6005640764; c6 rulings).
 * CEE decides the form on the DISPLAYED whole percentages; the UI renders it by identity. Rows: each form, the 10-point
 * boundary on the displayed figure, every-option-or-none, an exact 0 only when earned, a level target only, model order.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { goalChanceLicenceOf, withGoalChanceLicence, GOAL_CHANCE_LICENSED } from '../goal-chance-licence.js';
import { GOAL_FIGURES_WITHHELD_CODES, runWithheldGoalFigures } from '../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const RT10B = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_without_target: Json; graph_with_target: Json;
};
const GOAL = 'monthly_cancellations';
const G = RT10B.graph_with_target; // "at most 400 cancellations/month": held "<=", its own row, minimised
const env = (...ps: Array<[string, unknown]>): Json => ({
  option_comparison: ps.map(([id, p]) => ({ option_id: id, id, probability_of_goal: p, win_probability: 0.5 })),
  inference_warnings: [],
});

describe('D3 step 2 — goalChanceLicenceOf', () => {
  it('HIGHEST: every option licensed, the top clears the next by ≥ 10 displayed points — leader and next named, target as stated', () => {
    const l = goalChanceLicenceOf(env(['b', 0.41], ['a', 0.62]), G, GOAL)!;
    expect(l).toMatchObject({ code: GOAL_CHANCE_LICENSED, severity: 'info', form: 'highest', leader_option_id: 'a', next_option_id: 'b',
      option_ids: ['b', 'a'], pct_by_option: { a: 62, b: 41 }, target: { comparator: 'at_most', value: 400, unit: 'cancellations/month' } });
  });

  it.each([
    ['about the same (4 points apart)', [0.45, 0.41], 'about_the_same'],
    ['highest, every option at or under 40%', [0.30, 0.15], 'highest_all_likely_to_miss'],
    ['all likely to miss, no superlative', [0.35, 0.31], 'all_likely_to_miss'],
    ['BOUNDARY: 52 vs 42 displayed is 10 points → highest', [0.515, 0.42], 'highest'],
    ['BOUNDARY: 51 vs 42 displayed is 9 points → about the same (the raw gap 0.094 is never read)', [0.514, 0.42], 'about_the_same'],
  ] as const)('%s', (_n, [a, b], form) => {
    const l = goalChanceLicenceOf(env(['a', a], ['b', b]), G, GOAL)!;
    expect(l.form).toBe(form);
    expect('leader_option_id' in l).toBe(form === 'highest' || form === 'highest_all_likely_to_miss');
  });

  it('H2 (DL 0df0e1 6 Oct; Rehearsal12 48 / 43 / <1): the options within 10 points of the top, in MODEL order — never ranked', () => {
    const l = goalChanceLicenceOf(env(['keep', 0.004], ['raise', 0.43], ['starter', 0.48]), G, GOAL)!;
    expect(l).toMatchObject({ form: 'about_the_same', option_ids: ['keep', 'raise', 'starter'], same_option_ids: ['raise', 'starter'],
      pct_by_option: { keep: 0, raise: 43, starter: 48 } });
    expect(l).not.toHaveProperty('leader_option_id');
    // CONTROL: 10 points apart is the superlative, never "about the same".
    expect(goalChanceLicenceOf(env(['a', 0.52], ['b', 0.42]), G, GOAL)).not.toHaveProperty('same_option_ids');
  });

  it('PER OPTION (d5 #87 6007421281): 3 options, 1 withheld for its own path → `each`, 2 lines + 1 withheld; no superlative', () => {
    const l = goalChanceLicenceOf({ option_comparison: [{ option_id: 'a', probability_of_goal: 0.62 }, { option_id: 'b', probability_of_goal: 0.41 },
      { option_id: 'c' }] }, G, GOAL)!;
    // 62 vs 41 clears 10 points, but a superlative needs every option: the form is `each`, nobody is named.
    expect(l).toMatchObject({ form: 'each', option_ids: ['a', 'b', 'c'], pct_by_option: { a: 62, b: 41 }, withheld_option_ids: ['c'] });
    expect(l).not.toHaveProperty('leader_option_id');
    expect(l.pct_by_option).not.toHaveProperty('c');
    expect(goalChanceLicenceOf(env(['a', 0.62], ['b', 0.41], ['c', 0.2]), G, GOAL)).not.toHaveProperty('withheld_option_ids'); // CONTROL
    expect(goalChanceLicenceOf(env(['a', 0.62], ['b', 0.41], ['c', 0.2]), G, GOAL)?.form).toBe('highest'); // CONTROL: all three
    // Both licensed options under 40% with one withheld: "every option is more likely to miss" would speak for the withheld one.
    expect(goalChanceLicenceOf({ option_comparison: [{ option_id: 'a', probability_of_goal: 0.35 }, { option_id: 'b', probability_of_goal: 0.31 },
      { option_id: 'c' }] }, G, GOAL)?.form).toBe('each');
    // Every option withheld: nothing to say.
    expect(goalChanceLicenceOf({ option_comparison: [{ option_id: 'a' }, { option_id: 'b' }] }, G, GOAL)).toBeNull();
  });

  it('an EXACT 0 counts only where the Run earned it (the transport strips an unearned one, so its line is withheld)', () => {
    expect(goalChanceLicenceOf(env(['a', 0.62], ['b', 0]), G, GOAL)).toMatchObject({ form: 'each', withheld_option_ids: ['b'], pct_by_option: { a: 62 } });
    expect(goalChanceLicenceOf(env(['a', 0.62], ['b', 0]), G, GOAL, (id, p) => id === 'b' && p === 0)?.form).toBe('highest');
  });

  it('NO stated target, or a target stated as a CHANGE, has no ruled sentence: no licence', () => {
    expect(goalChanceLicenceOf(env(['a', 0.62], ['b', 0.41]), RT10B.graph_without_target, GOAL)).toBeNull();
    const change = { nodes: [{ id: 'g', kind: 'goal', label: 'Spend', goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2,
      goal_threshold: -0.2, goal_threshold_unit: '£/month', goal_direction: '<=' }], edges: [] };
    expect(goalChanceLicenceOf(env(['a', 0.62], ['b', 0.41]), change, 'g')).toBeNull();
  });

  it('the record rides inference_warnings as INFO, never a withheld code, and leaves every figure untouched', () => {
    const e = env(['a', 0.62], ['b', 0.41]);
    const out = withGoalChanceLicence(e, G, GOAL) as Json;
    expect(out.option_comparison).toEqual(e.option_comparison);
    expect(out.inference_warnings).toEqual([expect.objectContaining({ code: GOAL_CHANCE_LICENSED, severity: 'info' })]);
    expect(GOAL_FIGURES_WITHHELD_CODES.has(GOAL_CHANCE_LICENSED)).toBe(false);
    expect(runWithheldGoalFigures(out)).toBe(false);
    expect(withGoalChanceLicence(env(['a', 0.62], ['b', 0.41]), RT10B.graph_without_target, GOAL)).toEqual(env(['a', 0.62], ['b', 0.41]));
  });
});
