// Load the Run producer first (the existing S6 import-order guard).
import { withholdGoalFiguresForUntestableTarget } from '../../tools/handlers/run-analysis.js';
import { describe, expect, it } from 'vitest';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE as TARGET } from '../../../orchestrator/context/option-result-source.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { optionPathsOf, perOptionTargetReasonsForRun } from '../target-testability-per-option.js';
import { GOAL_CHANCE_LICENSED, goalChanceDisplayForAgent, withGoalChanceLicence } from '../goal-chance-licence.js';

type Rec = Record<string, any>;
const keep = 'keep_pro_price', raise = 'raise_pro_price';
const ids = [keep, raise];
const stock = 'pro_subscribers_at_month_12';
const operands = ['pro_subscribers_today', 'monthly_pro_churn', 'monthly_new_pro_subscribers'];
const unsized = [{ from: 'pro_price', to: 'price_sensitivity' }, { from: 'price_sensitivity', to: 'monthly_pro_churn' }];
const edge = (from: string, to: string): Rec => ({ from, to, strength: { mean: 0.5, std: 0.125 },
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }, exists_probability: 0.8 });
const level = (raw_value: number, cap: number, unit: string): Rec => ({ raw_value, cap, unit,
  value: raw_value / cap, source: 'brief_extraction' });

// Core stored draft_graph from b1-mid-run2.turn.json (CEE 03018723), retaining its IDs, units, levels and carriers.
// Monthly new Pro subscribers is the capture's ID for the stated new-subscribers-per-month input.
const fixture = (): Rec => ({
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', goal_direction: '>=', goal_threshold: 0.8,
      goal_threshold_raw: 20000, goal_threshold_cap: 25000, goal_threshold_unit: '£/month',
      goal_threshold_frame: 'level', threshold_source: 'brief_extraction', goal_horizon_months: 12,
      observed_state: { ...level(12250, 25000, '£/month'), baseline: 0.49 },
      nonlinear_identity: { operation: 'product', factor_ids: ['pro_price', stock], stated_in_brief: true } },
    { id: keep, kind: 'option', label: 'Keep Pro Price', is_baseline: true },
    { id: raise, kind: 'option', label: 'Raise Pro Price', interventions: {
      pro_price: { value: 0.295, raw_value: 59, unit: '£/subscriber/month', source: 'brief_extraction' },
    } },
    { id: 'pro_price', kind: 'factor', label: 'Pro price', observed_state: level(49, 200, '£/subscriber/month') },
    { id: 'price_sensitivity', kind: 'risk', label: 'Price sensitivity' },
    { id: operands[0], kind: 'factor', label: 'Pro subscribers today', observed_state: level(250, 2000, 'subscribers') },
    { id: operands[1], kind: 'factor', label: 'Monthly Pro churn', observed_state: level(3, 13, '%') },
    { id: operands[2], kind: 'factor', label: 'Monthly new Pro subscribers', observed_state: level(20, 200, 'subscribers/month') },
    { id: stock, kind: 'outcome', label: 'Pro subscribers at month 12', scale_frame: 2000,
      observed_state: { unit: 'subscribers', value: 0.125, source: 'brief_extraction', raw_value: 250 },
      nonlinear_identity: { operation: 'accumulation', factor_ids: operands, rate_scale: 0.01,
        horizon_months: 12, stated_in_brief: true } },
  ],
  edges: [
    // Keep's stored connectivity-repair edge is not an intervention seed.
    { ...edge(keep, 'pro_price'), origin: 'repair' }, edge(raise, 'pro_price'),
    ...unsized.map(l => edge(l.from, l.to)), ...operands.map(id => edge(id, stock)),
    edge('pro_price', 'mrr'), edge(stock, 'mrr'),
  ],
});
const envelope = (): Rec => ({
  option_comparison: ids.map(option_id => ({ option_id, probability_of_goal: option_id === keep ? 0.6 : 0.7,
    win_probability: 0.5 })),
  inference_warnings: [],
  identity_evaluations: [
    { node_id: 'mrr', operation: 'product', factor_ids: ['pro_price', stock], evaluated: true, level_source: 'identity_inputs' },
    { node_id: stock, operation: 'accumulation', factor_ids: operands, evaluated: true, level_source: 'identity_inputs' },
  ],
});
const warning = (out: Rec, code = TARGET): Rec | undefined => out.inference_warnings.find((w: Rec) => w.code === code);
const reasons = (g: Rec, body = envelope()) => {
  const verdict = targetTestabilityOf(g, body.identity_evaluations, 'mrr');
  expect(verdict).toMatchObject({ kind: 'not_testable', failures: [{ case: 'c' }] });
  if (verdict.kind !== 'not_testable') throw new Error(`fixture must fail P5: ${verdict.kind}`);
  expect(verdict.failures.every(f => f.case === 'c')).toBe(true);
  return perOptionTargetReasonsForRun(g, verdict, ids, body.identity_evaluations);
};
const run = (g: Rec, body = envelope()): Rec => withholdGoalFiguresForUntestableTarget(body, g, 'mrr');
const licensed = (g: Rec): Rec => withGoalChanceLicence(run(g), g, 'mrr');
const treatment = (g: Rec) => {
  const out = licensed(g);
  return {
    reasons: JSON.stringify(reasons(g)[keep] ?? null),
    optionIds: JSON.stringify(warning(out)?.option_ids),
    licence: JSON.stringify(warning(out, GOAL_CHANCE_LICENSED)),
    display: JSON.stringify(goalChanceDisplayForAgent(out)),
  };
};

describe('Science 93 §(aa): derived-baseline target scope follows the source for each option', () => {
  it('R1: Keep has no target reason; Raise keeps the unsized links and existing ask', () => {
    const g = fixture(), body = envelope();
    const paths = optionPathsOf(g, ids, body.identity_evaluations, 'mrr');
    expect(paths.get(keep)).toEqual([]);
    for (const link of unsized) expect(paths.get(raise)).toContainEqual(link);
    const own = reasons(g);
    expect(Object.keys(own)).toEqual([raise]);
    expect(own[raise]!.message).toBe("Not shown. It can't yet be tested against your target (at least £20,000 / month), "
      + 'because it needs a size for the links from Price sensitivity to Monthly Pro churn and from Pro price to Price sensitivity. '
      + 'Roughly how much does Monthly Pro churn change when Price sensitivity changes?');
    const out = licensed(g);
    expect(warning(out)?.option_ids).toEqual([raise]);
    expect(warning(out)?.per_option).toEqual(own);
    expect(warning(out)?.say).not.toContain('‘Keep Pro Price’');
    expect(goalChanceDisplayForAgent(out)).toEqual({ [keep]: 'about 60%' });
    expect(warning(out, GOAL_CHANCE_LICENSED)?.withheld_option_ids).toEqual([raise]);
  });

  it.each([{ mean: -0.9, std: 0.01 }, { mean: 0, std: 0.8 }, { mean: 0.95, std: 0.4 }])(
    'R2: both unsized strength mutations %j leave Keep reasons, warning IDs and licence byte-identical', strength => {
      const g = fixture(), before = treatment(g);
      for (const link of unsized) g.edges.find((e: Rec) => e.from === link.from && e.to === link.to).strength = { ...strength };
      expect(treatment(g)).toEqual(before);
      expect(before.reasons).toBe('null');
      expect(before.optionIds).toBe(JSON.stringify([raise]));
    },
  );

  it.each([49, 50])('R3: is_baseline with a Pro price intervention at £%s is still withheld', price => {
    const g = fixture();
    g.nodes.find((n: Rec) => n.id === keep).interventions = { pro_price: {
      value: price / 200, raw_value: price, source: 'brief_extraction', unit: '£/subscriber/month',
    } };
    expect(reasons(g)[keep]?.message).toContain('from Pro price to Price sensitivity');
    expect(warning(run(g))?.option_ids).toEqual(ids);
  });

  it.each([stock, 'after_accumulation'])('R4: an unsized source at/downstream of the carrier (%s) still withholds Keep', source => {
    const g = fixture();
    g.nodes.push({ id: 'baseline_feed', kind: 'factor', label: 'Baseline feed', observed_state: level(250, 2000, 'subscribers') });
    if (source !== stock) {
      g.nodes.push({ id: source, kind: 'factor', label: 'After accumulation' });
      g.edges.push(edge(stock, source));
    }
    // Replace the stock operand with its downstream feed, keeping the graph acyclic.
    const body = envelope(), factor_ids = ['pro_price', 'baseline_feed'];
    g.nodes.find((n: Rec) => n.id === 'mrr').nonlinear_identity.factor_ids = factor_ids;
    body.identity_evaluations[0].factor_ids = factor_ids;
    g.edges = g.edges.filter((e: Rec) => e.from !== stock || e.to !== 'mrr');
    g.edges.push(edge(source, 'baseline_feed'), edge('baseline_feed', 'mrr'));
    expect(optionPathsOf(g, ids, body.identity_evaluations, 'mrr').get(keep))
      .toContainEqual({ from: source, to: 'baseline_feed' });
    expect(reasons(g, body)[keep]).toBeDefined();
    expect(warning(run(g, body))?.option_ids).toEqual(ids);
  });

  it('the exemption also applies without is_baseline; an intervention ancestor still reaches its source', () => {
    const g = fixture();
    delete g.nodes.find((n: Rec) => n.id === keep).is_baseline;
    expect(reasons(g)[keep]).toBeUndefined();
    g.nodes.push({ id: 'upstream', kind: 'factor', label: 'Upstream' });
    g.edges.push(edge('upstream', 'pro_price'));
    g.nodes.find((n: Rec) => n.id === keep).interventions = { upstream: { value: 0.5 } };
    expect(reasons(g)[keep]?.message).toContain('Pro price');
    expect(warning(run(g))?.option_ids).toEqual(ids);
  });
});
