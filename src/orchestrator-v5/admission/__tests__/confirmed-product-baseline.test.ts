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

describe('confirmed-product baseline requires dimensional proof in the target unit', () => {
  it('an ambiguous rate without the count denominator still needs the goal current level', () => {
    const g = graph('£/month');
    const verdict = targetTestabilityOf(g);
    expect(verdict).toEqual({ kind: 'not_testable', goal_id: 'mrr',
      failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
    expect(targetNotTestableWarning(g, verdict, [], 'GOAL_FIGURES_TARGET_NOT_TESTABLE')?.level_only_say)
      .toBe("What's today's level of MRR?");
  });

  it('a rate per subscriber composes with subscriber count and does not ask for the derived level', () => {
    const g = graph('£/subscriber/month');
    const verdict = targetTestabilityOf(g);
    expect(verdict).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
    expect(targetNotTestableWarning(g, verdict, [], 'GOAL_FIGURES_TARGET_NOT_TESTABLE')).toBeNull();
  });
});
