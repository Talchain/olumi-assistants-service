import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import { buildRunDelta } from '../build-run-delta.js';
import { projectModelFacingRunDelta } from '../../context/model-facing-run-delta.js';

function fact(current: boolean, ids: string[], chances?: Record<string, number>, entitled = true,
  withShares = true, topLevelLicence = false): HandlerFact {
  const warnings = chances === undefined ? [] : [{ code: 'GOAL_CHANCE_LICENSED', form: 'each',
    option_ids: ids, pct_by_option: chances, display_rounding_by_option: { 'opt-b': 'nearest_5' } }];
  return { fact_type: 'run_analysis', noop: false, result: {
    computed_at: current ? '2026-10-07T12:00:00.000Z' : '2026-10-07T11:00:00.000Z',
    run_id: current ? 'current' : 'prior', graph_hash_at_run: current ? 'hash-current' : 'hash-prior',
    constraint_verdict: { may_name_leading_option: entitled, constraint_verdict_state: 'evaluated_feasible' },
    ...(topLevelLicence ? { inference_warnings: warnings } : {}),
    enrichment: { analysis_status: 'completed', meta: { seed_used: current ? '222' : '111', n_samples: 10000 },
      ...(topLevelLicence ? {} : { inference_warnings: warnings }),
      option_comparison: ids.map((option_id, i) => ({ option_id, option_label: option_id,
        probability_of_goal: 0.999, ...(withShares ? { win_probability: i === 0 ? 0.6 : 0.4 } : {}) })) },
  } } as unknown as HandlerFact;
}
const build = (prior: HandlerFact, current: HandlerFact, mayName = true) => {
  const result = buildRunDelta({ priorFacts: [current, prior], mayNameLeadingOption: mayName });
  if (result.kind !== 'ok') throw new Error(`Expected a comparable pair: ${JSON.stringify(result)}`);
  expect(RunDeltaSchema.safeParse(result.delta).success).toBe(true);
  return result.delta;
};

describe('buildRunDelta — Compare goal chances keep their own licence and record order', () => {
  it('pairs a pre-licence Run with the latest licensed Run without deriving old figures', () => {
    const delta = build(fact(false, ['opt-a', 'opt-b']), fact(true, ['opt-a', 'opt-b'], { 'opt-a': 47, 'opt-b': 70 }));
    expect(delta.goal_chances).toStrictEqual([
      { option_id: 'opt-a', prior: { kind: 'not_recorded' }, current: { kind: 'point', pct: 47, rounding: 'whole' } },
      { option_id: 'opt-b', prior: { kind: 'not_recorded' }, current: { kind: 'point', pct: 70, rounding: 'nearest_5' } },
    ]);
    expect(projectModelFacingRunDelta(delta)).not.toHaveProperty('goal_chances');
  });

  it.each(['prior', 'current', 'turn'] as const)('retains goal chances when the %s leader is withheld', (side) => {
    const prior = fact(false, ['opt-a', 'opt-b'], { 'opt-a': 47, 'opt-b': 70 }, side !== 'prior');
    const current = fact(true, ['opt-a', 'opt-b'], { 'opt-a': 62, 'opt-b': 35 }, side !== 'current', true, true);
    const before = JSON.stringify([prior, current]);
    const delta = build(prior, current, side !== 'turn');
    expect(delta.win_probabilities).toStrictEqual([]);
    expect(delta.goal_chances).toStrictEqual([
      { option_id: 'opt-a', prior: { kind: 'point', pct: 47, rounding: 'whole' }, current: { kind: 'point', pct: 62, rounding: 'whole' } },
      { option_id: 'opt-b', prior: { kind: 'point', pct: 70, rounding: 'nearest_5' }, current: { kind: 'point', pct: 35, rounding: 'nearest_5' } },
    ]);
    expect(JSON.stringify([prior, current])).toBe(before);
  });

  it.each([{ 'opt-b': 20, 'opt-a': 90 }, { 'opt-b': 95, 'opt-a': 10 }])(
    'keeps current record order with shuffled chances %j and excludes single-Run options', (chances) => {
      const delta = build(fact(false, ['opt-a', 'prior-only', 'opt-b']),
        fact(true, ['opt-b', 'current-only', 'opt-a'], chances));
      expect(delta.goal_chances?.map((row) => row.option_id)).toStrictEqual(['opt-b', 'opt-a']);
      expect(delta.goal_chances?.map((row) => row.current)).toStrictEqual([
        { kind: 'point', pct: chances['opt-b'], rounding: 'nearest_5' },
        { kind: 'point', pct: chances['opt-a'], rounding: 'whole' },
      ]);
    });

  it('uses option identities even when neither Run records win shares', () => {
    const delta = build(fact(false, ['opt-a', 'opt-b'], undefined, false, false),
      fact(true, ['opt-b', 'opt-a'], { 'opt-a': 47, 'opt-b': 70 }, false, false));
    expect(delta.win_probabilities).toStrictEqual([]);
    expect(delta.goal_chances?.map((row) => row.option_id)).toStrictEqual(['opt-b', 'opt-a']);
  });
});
