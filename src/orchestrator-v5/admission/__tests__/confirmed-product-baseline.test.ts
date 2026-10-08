import { describe, expect, it } from 'vitest';
import { targetNotTestableWarning, targetTestabilityOf } from '../target-testability.js';

type Rec = Record<string, any>;
const graph = (priceUnit: string): Rec => ({
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_direction: '>=', goal_threshold: 0.8,
      goal_threshold_raw: 85000, goal_threshold_cap: 106250, goal_threshold_unit: '£/month',
      goal_threshold_frame: 'level', threshold_source: 'user_stated',
      nonlinear_identity: { operation: 'product', factor_ids: ['price', 'subscribers'], stated_in_brief: true } },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { raw_value: 49, value: 0.245, cap: 200, unit: priceUnit } },
    { id: 'subscribers', kind: 'factor', label: 'Subscribers', observed_state: { raw_value: 250, value: 0.125, cap: 2000, unit: 'subscribers' } },
  ],
  edges: [{ from: 'price', to: 'mrr' }, { from: 'subscribers', to: 'mrr' }],
});

describe('P45 confirmed-product baseline preserves the confirmed rate reading in the target unit', () => {
  it('a confirmed implicit per-count rate derives the goal current level without a second ask', () => {
    const g = graph('£/month');
    const verdict = targetTestabilityOf(g);
    expect(verdict).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
    expect(targetNotTestableWarning(g, verdict, [], 'GOAL_FIGURES_TARGET_NOT_TESTABLE')).toBeNull();
  });

  it.each(['$/month', '£/year', '£/seat/month'])('a confirmed incompatible rate %s still needs the current level', unit => {
    expect(targetTestabilityOf(graph(unit))).toEqual({ kind: 'not_testable', goal_id: 'mrr',
      failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
  });

  it('a rate per subscriber composes with subscriber count and does not ask for the derived level', () => {
    const g = graph('£/subscriber/month');
    const verdict = targetTestabilityOf(g);
    expect(verdict).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
    expect(targetNotTestableWarning(g, verdict, [], 'GOAL_FIGURES_TARGET_NOT_TESTABLE')).toBeNull();
  });
});
