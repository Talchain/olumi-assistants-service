import { describe, expect, it } from 'vitest';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_USER_EFFECT_CLAMPED,
  GOAL_FIGURES_WITHHELD_CODES } from '../../../orchestrator/context/option-result-source.js';
import { goalChanceSideOf } from '../goal-chance-sides.js';
import { goalChanceRangeDisplayForAgent } from '../goal-chance-range-agent.js';

const licence = (pct: unknown = 45, rounding?: unknown) => ({ code: 'GOAL_CHANCE_LICENSED', form: 'each',
  option_ids: ['opt-a', 'opt-b'], pct_by_option: { 'opt-a': pct, 'opt-b': 70 },
  ...(rounding === undefined ? {} : { display_rounding_by_option: { 'opt-a': rounding } }) });
const range = { code: 'GOAL_CHANCE_RANGE', severity: 'info', message: 'An unsized link.', option_ids: ['opt-a'],
  range_by_option: { 'opt-a': { low_pct: 25, high_pct: 61, low_rounding: 'nearest_5', high_rounding: 'whole',
    kind: 'link_strength', from: 'factor', to: 'goal', among: 'all' } } };
const stored = (warnings: unknown[], location: 'enrichment' | 'result' = 'enrichment') => location === 'enrichment'
  ? { enrichment: { inference_warnings: warnings } } : { inference_warnings: warnings };

describe('goalChanceSideOf — each Run’s own stored display licence', () => {
  it.each(['enrichment', 'result'] as const)('P2-f: stated_time without basis fails closed in both readers at %s', location => {
    const warning = { ...range, range_by_option: { 'opt-a': { ...range.range_by_option['opt-a'],
      kind: 'stated_time', quantity: 'months_to_finish', low: 0.25, high: 0.61 } } };
    const result = stored([warning], location), graph = { nodes: [{ id: 'factor', label: 'Team' }, { id: 'goal', label: 'Launch' }] };
    expect(goalChanceRangeDisplayForAgent(result, graph)).toBeUndefined();
    expect(goalChanceSideOf(result, 'opt-a')).toEqual({ kind: 'withheld' });
  });
  it.each([
    ['valid', {}, 'range'],
    ['equal displayed endpoints', { low_pct: 25, high_pct: 25, low: 0.249, high: 0.251 }, 'withheld'],
    ['wrong basis', { basis: 'link_strength' }, 'withheld'],
    ['wrong quantity', { quantity: 'days_to_finish' }, 'withheld'],
    ['missing exact endpoint', { low: undefined }, 'withheld'],
    ['non-finite endpoint', { high: Infinity }, 'withheld'],
    ['rounding disagrees', { high: 0.8 }, 'withheld'],
  ] as const)('P2-e/P2-f: stated-time reader parity — %s', (_name, change, expected) => {
    const warning = { ...range, range_by_option: { 'opt-a': { ...range.range_by_option['opt-a'],
      kind: 'stated_time', basis: 'stated_time', quantity: 'months_to_finish', low: 0.25, high: 0.61, ...change } } };
    const graph = { nodes: [{ id: 'factor', label: 'Team' }, { id: 'goal', label: 'Launch' }] };
    for (const location of ['enrichment', 'result'] as const) {
      const result = stored([warning], location);
      expect(goalChanceSideOf(result, 'opt-a').kind).toBe(expected);
      expect(goalChanceRangeDisplayForAgent(result, graph)?.['opt-a'] !== undefined).toBe(expected === 'range');
    }
  });
  it.each(['enrichment', 'result'] as const)('reads point and range licences at %s', (location) => {
    expect(goalChanceSideOf(stored([licence(45, 'nearest_5')], location), 'opt-a'))
      .toStrictEqual({ kind: 'point', pct: 45, rounding: 'nearest_5' });
    expect(goalChanceSideOf(stored([range], location), 'opt-a'))
      .toStrictEqual({ kind: 'range', low_pct: 25, high_pct: 61, low_rounding: 'nearest_5', high_rounding: 'whole' });
  });

  it.each([undefined, 'whole', 'invalid', null])('defaults display rounding %j to whole', (step) => {
    expect(goalChanceSideOf(stored([licence(47, step)]), 'opt-a'))
      .toStrictEqual({ kind: 'point', pct: 47, rounding: 'whole' });
  });

  it('prefers a point to a range, and a range to a missing point', () => {
    expect(goalChanceSideOf(stored([licence(), range]), 'opt-a').kind).toBe('point');
    expect(goalChanceSideOf(stored([licence(undefined), range]), 'missing').kind).toBe('withheld');
    expect(goalChanceSideOf(stored([licence(47.5), range]), 'opt-a').kind).toBe('range');
  });

  it.each([47.5, 101, -1, '47'])('a malformed pct %j is withheld, never a point', (shown) => {
    expect(goalChanceSideOf(stored([licence(shown)]), 'opt-a')).toStrictEqual({ kind: 'withheld' });
  });

  it('fails closed on malformed and conflicting licence records', () => {
    expect(goalChanceSideOf(stored([{ code: 'GOAL_CHANCE_LICENSED' }]), 'opt-a')).toStrictEqual({ kind: 'withheld' });
    expect(goalChanceSideOf({ ...stored([licence()]), inference_warnings: [licence()] }, 'opt-a'))
      .toStrictEqual({ kind: 'withheld' });
    expect(goalChanceSideOf(stored([range, range]), 'opt-a')).toStrictEqual({ kind: 'withheld' });
    expect(goalChanceSideOf(stored([range]), 'opt-b')).toStrictEqual({ kind: 'withheld' });
  });

  it.each([
    { low_pct: 80 }, { high_pct: 101 }, { low_pct: 25.5 }, { high_rounding: 'invalid' },
  ])('a malformed range %j is withheld', (change) => {
    const bad = { ...range, range_by_option: { 'opt-a': { ...range.range_by_option['opt-a'], ...change } } };
    expect(goalChanceSideOf(stored([bad]), 'opt-a')).toStrictEqual({ kind: 'withheld' });
  });

  it('reuses the range withhold scope and compatible-withhold rule', () => {
    const compatible = { code: GOAL_FIGURES_PLACEHOLDER_PATH, option_ids: ['opt-a'] };
    expect(goalChanceSideOf(stored([range, compatible]), 'opt-a').kind).toBe('range');
    expect(goalChanceSideOf(stored([range, { code: GOAL_FIGURES_USER_EFFECT_CLAMPED }]), 'opt-a'))
      .toStrictEqual({ kind: 'withheld' });
  });

  it.each([...GOAL_FIGURES_WITHHELD_CODES])('a %s withhold alone is withheld in either location', (code) => {
    for (const location of ['enrichment', 'result'] as const) {
      expect(goalChanceSideOf(stored([{ code }], location), 'opt-a')).toStrictEqual({ kind: 'withheld' });
    }
  });

  it('never re-licenses a pre-licence raw probability; the same record with a licence is a point', () => {
    const enrichment = { option_comparison: [{ option_id: 'opt-a', probability_of_goal: 0.471 }] };
    const result = { enrichment };
    const before = JSON.stringify(result);
    expect(goalChanceSideOf(result, 'opt-a')).toStrictEqual({ kind: 'not_recorded' });
    expect(goalChanceSideOf({ enrichment: { ...enrichment, inference_warnings: [licence(45)] } }, 'opt-a'))
      .toStrictEqual({ kind: 'point', pct: 45, rounding: 'whole' });
    expect(JSON.stringify(result)).toBe(before);
    expect(goalChanceSideOf(null, 'opt-a')).toStrictEqual({ kind: 'not_recorded' });
  });
});
