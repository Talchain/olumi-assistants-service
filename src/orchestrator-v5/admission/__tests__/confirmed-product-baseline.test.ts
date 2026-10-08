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

/** The goal stays a binary product; ISL derives the stock at its horizon from three levelled inputs. */
const accumulationGraph = (): Rec => {
  const g = graph('£/subscriber/month');
  g.nodes[0].goal_horizon_months = 12;
  g.nodes[0].nonlinear_identity.factor_ids = ['price', 'subscribers_at_12'];
  g.nodes[2] = { id: 'subscribers_at_12', kind: 'outcome', label: 'Subscribers at month 12', scale_frame: 5000,
    nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'churn', 'inflow'],
      horizon_months: 12, rate_scale: 0.01, stated_in_brief: false } };
  g.nodes.push(
    { id: 'stock_today', kind: 'factor', label: 'Subscribers today', observed_state: { raw_value: 250, value: 0.125, cap: 2000, unit: 'subscribers' } },
    { id: 'churn', kind: 'factor', label: 'Monthly churn', observed_state: { raw_value: 3, value: 0.03, cap: 100, unit: '%' } },
    { id: 'inflow', kind: 'factor', label: 'New subscribers each month', observed_state: { raw_value: 30, value: 0.15, cap: 200, unit: 'subscribers/month' } },
  );
  g.edges = [{ from: 'price', to: 'mrr' }, { from: 'subscribers_at_12', to: 'mrr' },
    ...['stock_today', 'churn', 'inflow'].map(from => ({ from, to: 'subscribers_at_12' }))];
  return g;
};

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

  it('accumulation subscribers_at_12 with all three input levels meets P1 without a made-up derived level', () => {
    const g = accumulationGraph();
    const verdict = targetTestabilityOf(g);
    expect(verdict).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
    expect(g.nodes.find((n: Rec) => n.id === 'subscribers_at_12')).not.toHaveProperty('observed_state');
    expect(targetNotTestableWarning(g, verdict, [], 'GOAL_FIGURES_TARGET_NOT_TESTABLE')).toBeNull();
  });

  it('a user-stated 0% churn with no raw_value supplies the accumulation input level', () => {
    const g = accumulationGraph();
    g.nodes.find((n: Rec) => n.id === 'churn').observed_state = { value: 0, unit: '%', source: 'user' };
    const verdict = targetTestabilityOf(g);
    expect(verdict).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
    expect(targetNotTestableWarning(g, verdict, [], 'GOAL_FIGURES_TARGET_NOT_TESTABLE')).toBeNull();
    delete g.nodes.find((n: Rec) => n.id === 'churn').observed_state.value;
    expect(targetTestabilityOf(g)).toEqual({ kind: 'not_testable', goal_id: 'mrr',
      failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
  });

  it.each(['stock_today', 'churn', 'inflow'])('accumulation subscribers_at_12 missing the level of %s cannot supply the goal baseline', id => {
    const g = accumulationGraph();
    delete g.nodes.find((n: Rec) => n.id === id).observed_state.raw_value;
    delete g.nodes.find((n: Rec) => n.id === id).observed_state.value;
    expect(targetTestabilityOf(g)).toEqual({ kind: 'not_testable', goal_id: 'mrr',
      failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
    // CONTROL: this same carrier with that part levelled meets the precondition.
    expect(targetTestabilityOf(accumulationGraph())).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
  });

  it('accumulation subscribers_at_12 at an old deadline cannot supply the current horizon baseline', () => {
    const g = accumulationGraph();
    g.nodes[0].goal_horizon_months = 18;
    expect(targetTestabilityOf(g)).toEqual({ kind: 'not_testable', goal_id: 'mrr',
      failures: [{ precondition: 'P1', case: 'a', code: 'missing_goal_baseline' }] });
    g.nodes.find((n: Rec) => n.id === 'subscribers_at_12').nonlinear_identity.horizon_months = 18;
    expect(targetTestabilityOf(g)).toEqual({ kind: 'unchecked', goal_id: 'mrr', unchecked: ['P5'] });
  });
});
