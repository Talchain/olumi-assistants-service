/**
 * ⛔ A GOAL CERTAINTY (P = 0 or 1) STANDS ONLY IF NO UNSIZED LINK COULD REVERSE IT (AI Quality 5882366427, R3's two
 * corrections 5882389030 ACKed in 5882498938; the DL assigns the typed decision to MG, 5882387398).
 *
 * SERVED (R3's strict journey on CEE 5411da8 / PLoT 4837917 / ISL 707a816, Paul's brief: "raise Pro from £49 to £59 …
 * 1,500 paying subscribers and £75k MRR … MRR above £85k"): "Raise price to £59" reads P(goal) = 1. MRR = price ×
 * subscribers is a declared identity, so £59 gives about £90.3k IF subscribers hold. The only path that can pull MRR
 * down, `price → price sensitivity → churn → subscribers`, has no sized link on it (`olumi_placeholder`, and two links
 * with no magnitude at all). So "100%" is set by a default, not by anything Olumi or the user knows.
 *
 * Every row binds options by id and nodes by id, on the served bytes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { goalCertaintyDecisions, goalCertaintyOfStoredResult, placeholderGoalPaths } from '../goal-certainty.js';

type Json = Record<string, any>;
const FX = JSON.parse(
  readFileSync(new URL('../../__tests__/fixtures/served-strict-journey-5411da8-goal-certainty.json', import.meta.url), 'utf8'),
) as { paul: Run; equality: Run };
type Run = { graph: Json; option_comparison: Json[]; analysis_identity_evaluated_node_ids: string[]; identity_evaluations: Json[] };

/** The run's identity evaluations (served ids ["mrr"]; `level_source` DERIVED from R3's ISL code-read, see the fixture). */
const decide = (run: Run) => goalCertaintyDecisions(run.graph, run.option_comparison, run.identity_evaluations);
const byId = (ds: ReturnType<typeof decide>, id: string) => ds.find((d) => d.option_id === id);

describe('accumulation cannot enter the product-ratio or sum-delta break-even reader', () => {
  // Defensive read of a misplaced carrier: writers keep accumulation on a derived node, never on the goal.
  // A stored malformed declaration must still not manufacture either kind of exact break-even.
  const reading = (operation: 'accumulation' | 'product' | 'sum') => {
    const accumulation = operation === 'accumulation';
    const parts = accumulation ? ['stock_today', 'monthly_churn', 'monthly_inflow'] : ['stock_today', 'monthly_inflow'];
    const graph = { nodes: [
      { id: 'growth_driver', kind: 'factor', label: 'Growth effort', observed_state: { value: 0.1, raw_value: 1, unit: 'points' } },
      { id: 'stock_today', kind: 'factor', label: 'Subscribers today', observed_state: { value: 0.75, raw_value: 1500, unit: 'subscribers', source: 'brief_extraction' } },
      { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, unit: '%', source: 'user_override' } },
      { id: 'monthly_inflow', kind: 'factor', label: 'New subscribers per month', observed_state: { value: 0.2, raw_value: 100, unit: 'subscribers per month', source: 'user_override' } },
      { id: 'stock_month_12', kind: 'goal', label: 'Subscribers at month 12', goal_horizon_months: 12, goal_direction: '>', goal_threshold_raw: 1800,
        observed_state: { value: 0.5, raw_value: 2000, unit: 'subscribers', source: 'brief_extraction' },
        nonlinear_identity: { operation, factor_ids: parts, stated_in_brief: true,
          ...(accumulation ? { horizon_months: 12, rate_scale: 0.01 } : {}) } },
      { id: 'raise_effort', kind: 'option', label: 'Increase growth effort', interventions: { growth_driver: { value: 0.2, raw_value: 2 } } },
    ], edges: [
      { from: 'growth_driver', to: 'stock_today', strength: { mean: -0.2, std: 0.1 }, effect_direction: 'negative' },
      ...parts.map((from) => ({ from, to: 'stock_month_12', strength: { mean: 1, std: 0.1 }, effect_direction: 'positive' })),
    ] };
    return goalCertaintyDecisions(graph, [{ option_id: 'raise_effort', probability_of_goal: 1 }],
      [{ node_id: 'stock_month_12', evaluated: true, level_source: 'stated_level', ...(accumulation ? { horizon_months: 12 } : {}) }])
      .find((d) => d.option_id === 'raise_effort')!;
  };

  it('ACCUMULATION: the node-bound reversal path gets neither ratio nor delta', () => {
    const d = reading('accumulation');
    expect(d).toMatchObject({ option_id: 'raise_effort', earned: false, no_break_even: 'no_exact_figure',
      unsized_path: { from: 'growth_driver', enters_goal_through: 'stock_today' } });
    expect(d.break_even).toBeUndefined();
  });

  it('PRODUCT CONTROL: the same node-bound path keeps its product ratio', () => {
    expect(reading('product').break_even).toMatchObject({ kind: 'product', operand_id: 'stock_today', projected_if_held: 2000, threshold: 1800 });
    expect(reading('product').break_even?.fraction).toBeCloseTo(0.1);
  });

  it('SUM CONTROL: the same node-bound path keeps its sum delta', () => {
    expect(reading('sum').break_even).toMatchObject({ kind: 'sum', operand_id: 'stock_today', projected_if_held: 2000, threshold: 1800, margin: 200 });
  });
});

describe('certainty and placeholder readers share accumulation attestation', () => {
  const graph = (): Json => ({ nodes: [
    { id: 'mrr', kind: 'goal', label: 'Monthly recurring revenue', goal_direction: '>=', goal_horizon_months: 12,
      goal_threshold_raw: 1800, goal_threshold_unit: 'GBP/month',
      observed_state: { value: 0.2, raw_value: 2000, unit: 'GBP/month' },
      nonlinear_identity: { operation: 'product', factor_ids: ['price', 'stock_month_12'], stated_in_brief: true } },
    { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.1, raw_value: 10, unit: 'GBP/subscriber/month' } },
    { id: 'stock_month_12', kind: 'outcome', label: 'Subscribers at month 12', scale_frame: 1000,
      nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'],
        horizon_months: 12, rate_scale: 0.01, stated_in_brief: false } },
    { id: 'stock_today', kind: 'factor', label: 'Subscribers today', observed_state: { value: 0.25, raw_value: 250, unit: 'subscribers', source: 'user_override' } },
    { id: 'monthly_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.03, raw_value: 3, unit: '%', source: 'user_override' } },
    { id: 'monthly_inflow', kind: 'factor', label: 'Monthly inflow', observed_state: { value: 0.1, raw_value: 10, unit: 'subscribers/month', source: 'user_override' } },
    { id: 'raise_churn', kind: 'option', label: 'Increase churn', interventions: { monthly_churn: { value: 0.04, raw_value: 4 } } },
  ], edges: [
    ...['stock_today', 'monthly_churn', 'monthly_inflow'].map(from => ({ from, to: 'stock_month_12',
      strength: { mean: from === 'monthly_churn' ? -0.5 : 0.5, std: 0.2 },
      effect_direction: from === 'monthly_churn' ? 'negative' : 'positive', provenance: { magnitude: 'olumi_placeholder' } })),
    ...['price', 'stock_month_12'].map(from => ({ from, to: 'mrr', strength: { mean: 0.5, std: 0.2 },
      effect_direction: 'positive', provenance: { magnitude: 'olumi_placeholder' } })),
  ] });
  const matching: Json = { node_id: 'stock_month_12', evaluated: true, operation: 'accumulation',
    factor_ids: ['stock_today', 'monthly_churn', 'monthly_inflow'], horizon_months: 12 };
  const goalEvaluation = { node_id: 'mrr', evaluated: true, operation: 'product',
    factor_ids: ['price', 'stock_month_12'], level_source: 'stated_level' };

  it.each([
    ['stale month', { ...matching, horizon_months: 18 }],
    ['reordered inputs', { ...matching, factor_ids: ['monthly_churn', 'stock_today', 'monthly_inflow'] }],
    ['different node', { ...matching, node_id: 'another_stock_month_12' }],
  ])('stock_month_12 with %s cannot earn certainty or hide its guessed churn link; matching attestation is the control', (_reason, withheld) => {
    const g = graph();
    const rows = [{ option_id: 'raise_churn', probability_of_goal: 1 }];
    const rejected = [goalEvaluation, withheld];
    expect(goalCertaintyDecisions(g, rows, rejected)).toEqual([expect.objectContaining({ option_id: 'raise_churn', earned: false })]);
    expect(placeholderGoalPaths(g, ['raise_churn'], rejected)).toEqual([{ option_id: 'raise_churn',
      links: [{ from: 'monthly_churn', to: 'stock_month_12' }] }]);
    const control = [goalEvaluation, matching];
    expect(goalCertaintyDecisions(g, rows, control)).toEqual([{ option_id: 'raise_churn', probability_of_goal: 1, earned: true }]);
    expect(placeholderGoalPaths(g, ['raise_churn'], control)).toEqual([]);
  });
});

/** Paul's graph with the lowering path's links SIZED (price → churn in points, churn → subscribers in subscribers). */
function sizedPaul(): Run {
  const run = structuredClone(FX.paul);
  const g = run.graph;
  g.nodes = (g.nodes as Json[]).filter((n) => n.id !== 'price_sensitivity');
  g.edges = (g.edges as Json[]).filter((e) => e.from !== 'price_sensitivity' && e.to !== 'price_sensitivity');
  const sized = (from: string, to: string, mean: number, unit: string) => ({
    from, to, strength: { mean, std: Math.abs(mean) / 2 }, exists_probability: 0.9, effect_direction: mean > 0 ? 'positive' : 'negative',
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 1, amount_unit: unit, per_source_change: 10, per_source_change_unit: 'GBP/month', strength_mean: mean, strength_mean_frame: 'edge_strength' } },
  });
  g.edges = (g.edges as Json[]).filter((e) => !(e.from === 'monthly_churn' && e.to === 'paying_subscribers'));
  g.edges.push(sized('monthly_pro_price', 'monthly_churn', 0.2, 'percentage points'), sized('monthly_churn', 'paying_subscribers', -0.5, 'subscribers'));
  return run;
}

describe('PRECONDITIONS — the served bytes', () => {
  it('Paul: £59 reads P = 1, £54 and carrying on read 0; MRR is a declared product of price and subscribers; the goal is "above £85k"', () => {
    expect(FX.paul.option_comparison.map((o) => [o.option_id, o.probability_of_goal])).toEqual([
      ['raise_price_to_59', 1], ['raise_price_to_54', 0], ['carry_on_as_now', 0],
    ]);
    const goal = (FX.paul.graph.nodes as Json[]).find((n) => n.kind === 'goal')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['monthly_pro_price', 'paying_subscribers'] });
    expect([goal.goal_direction, goal.goal_threshold_raw, goal.observed_state.raw_value]).toEqual(['>', 85000, 75000]);
  });
  it('Paul: the lowering path carries one olumi_placeholder link and two with NO magnitude at all', () => {
    const e = (from: string, to: string) => (FX.paul.graph.edges as Json[]).find((x) => x.from === from && x.to === to)!;
    expect(e('monthly_pro_price', 'price_sensitivity').provenance?.magnitude).toBeUndefined();
    expect(e('price_sensitivity', 'monthly_churn').provenance.magnitude).toBe('olumi_placeholder');
    expect(e('monthly_churn', 'paying_subscribers').provenance?.magnitude).toBeUndefined();
  });
});

describe('the rule on Paul\'s served run', () => {
  it('RED — £59\'s P = 1 is NOT earned: a path through unsized links can lower MRR', () => {
    const d = byId(decide(FX.paul), 'raise_price_to_59')!;
    expect(d).toMatchObject({ option_id: 'raise_price_to_59', probability_of_goal: 1, earned: false });
    expect(d.unsized_path).toEqual({ from: 'monthly_pro_price', enters_goal_through: 'paying_subscribers' });
  });
  it('the break-even is exact arithmetic on the user\'s own figures, counted on the STATED operand (1,500 → 88, not 90 of 1,530)', () => {
    const d = byId(decide(FX.paul), 'raise_price_to_59')!;
    expect(d.break_even?.kind).toBe('product');
    expect(d.break_even?.projected_if_held).toBeCloseTo(75000 * 59 / 49, 6);
    expect(d.break_even?.fraction).toBeCloseTo(1 - 85000 / (75000 * 59 / 49), 9);
    expect(d.break_even?.operand_count).toBe(88);
  });
  it('it is said as the conditional result plus the break-even — never "100%" or "certain"', () => {
    const d = byId(decide(FX.paul), 'raise_price_to_59')!;
    expect(d.say).toBe(
      '‘Raise price to £59’ gives about £90,300 MRR if ‘Paying subscribers’ holds. It misses £85,000 MRR if raising ‘Monthly Pro price’ loses more than '
      + 'about 5.9% of ‘Paying subscribers’ (about 88 of your 1,500 subscribers). Olumi hasn’t sized how ‘Monthly Pro price’ '
      + 'moves ‘Paying subscribers’, so it can’t yet say how likely that is.',
    );
    expect(d.say).not.toMatch(/100\s?%|certain/i);
  });
  it('NEGATIVE CONTROL — £54\'s P = 0 IS earned: it misses even if subscribers hold, and no unsized path can raise MRR', () => {
    expect(byId(decide(FX.paul), 'raise_price_to_54')).toMatchObject({ probability_of_goal: 0, earned: true });
  });
  it('NEGATIVE CONTROL — carrying on\'s P = 0 IS earned: nothing moves', () => {
    expect(byId(decide(FX.paul), 'carry_on_as_now')).toMatchObject({ probability_of_goal: 0, earned: true });
  });
});

describe('controls and the variants R3 and AI Quality added', () => {
  it('an INTERIOR P (the equality run\'s 0.772) gets no decision: only a certainty is ruled on', () => {
    const ds = decide(FX.equality);
    expect(byId(ds, 'raise_to_59')).toBeUndefined();
    expect(byId(ds, 'raise_to_54')).toBeUndefined();
    expect(byId(ds, 'hold_at_49')).toMatchObject({ probability_of_goal: 0, earned: true });
  });
  it('EXACTLY 0 or 1 (PR Review on 0d45a267): 0.9999999995 and 5e-10 are interior results and get no decision; exact 1 and 0 do', () => {
    const near = [
      { option_id: 'raise_price_to_59', probability_of_goal: 0.9999999995 },
      { option_id: 'raise_price_to_54', probability_of_goal: 5e-10 },
      { option_id: 'carry_on_as_now', probability_of_goal: 0 },
    ];
    const ds = goalCertaintyDecisions(FX.paul.graph, near, FX.paul.identity_evaluations);
    expect(ds.map((d) => d.option_id)).toEqual(['carry_on_as_now']);
    expect(byId(decide(FX.paul), 'raise_price_to_59')?.probability_of_goal).toBe(1);
  });
  it('every unearned decision carries EXACTLY ONE of `unsized_path` / `identity_mismatch`, and exactly one of `break_even` / `no_break_even`', () => {
    const extra = sizedPaul();
    (extra.graph.nodes as Json[]).push({ id: 'annual_contracts', kind: 'factor', label: 'Annual contracts' });
    (extra.graph.edges as Json[]).push({ from: 'annual_contracts', to: 'mrr', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' });
    const all = [FX.paul, extra, { ...FX.paul, identity_evaluations: [] }].flatMap((r) => decide(r)).filter((d) => !d.earned);
    expect(all.length).toBeGreaterThanOrEqual(3);
    for (const d of all) {
      expect([d.unsized_path, d.identity_mismatch].filter((x) => x !== undefined)).toHaveLength(1);
      expect([d.break_even, d.no_break_even].filter((x) => x !== undefined)).toHaveLength(1);
      expect(typeof d.say).toBe('string');
    }
  });
  it('R3: with the placeholder link SIZED but the magnitude-ABSENT links left, £59 is still unearned', () => {
    const run = structuredClone(FX.paul);
    const e = (run.graph.edges as Json[]).find((x) => x.from === 'price_sensitivity' && x.to === 'monthly_churn')!;
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 0.1, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: '', strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength' } };
    expect(byId(decide(run), 'raise_price_to_59')).toMatchObject({ earned: false });
  });
  it('CONTROL — every link on the lowering path sized: £59\'s P = 1 is Olumi\'s model, and it stands (earned)', () => {
    expect(byId(decide(sizedPaul()), 'raise_price_to_59')).toMatchObject({ probability_of_goal: 1, earned: true });
  });
  it('the identity\'s own operand links count as exact: £54 does not turn unearned through price → MRR', () => {
    const into = (FX.paul.graph.edges as Json[]).filter((e) => e.to === 'mrr').map((e) => [e.from, e.provenance?.magnitude]);
    expect(into).toEqual([['monthly_pro_price', undefined], ['paying_subscribers', undefined]]);
    expect(byId(decide(FX.paul), 'raise_price_to_54')!.earned).toBe(true);
  });
});

describe('AI Quality 5882734064: an identity counts as exact only if THIS run evaluated it', () => {
  it('PRECONDITION: the served run evaluated the MRR identity', () => {
    expect(FX.paul.analysis_identity_evaluated_node_ids).toEqual(['mrr']);
  });
  it('the identity NOT evaluated (e.g. PLoT did not forward it): £59 and £54 are judged on their links, with no identity break-even', () => {
    const ds = goalCertaintyDecisions(FX.paul.graph, FX.paul.option_comparison, []);
    const d59 = byId(ds, 'raise_price_to_59')!;
    expect(d59.earned).toBe(false);
    expect(d59.break_even).toBeUndefined();
    expect(d59.no_break_even).toBe('identity_not_evaluated');
    expect(d59.say).toBe('Olumi can’t yet say how likely ‘Raise price to £59’ is to meet the goal: it depends on how ‘Monthly Pro price’ moves ‘Paying subscribers’, which isn’t sized.');
    // price → MRR is now an ordinary unsized link that can RAISE MRR, so £54's 0 is no longer earned either.
    expect(byId(ds, 'raise_price_to_54')).toMatchObject({ probability_of_goal: 0, earned: false });
  });
  it('R3 5887059128: an unsized link STRAIGHT into the goal names the goal, never "moves ‘Monthly Pro price’ moves ‘Monthly Pro price’"', () => {
    const d54 = byId(goalCertaintyDecisions(FX.paul.graph, FX.paul.option_comparison, []), 'raise_price_to_54')!;
    // PRECONDITION: the path is the moved factor's own edge into the goal.
    expect(d54.unsized_path).toEqual({ from: 'monthly_pro_price', enters_goal_through: 'monthly_pro_price' });
    expect(d54.say).toBe('Olumi can’t yet say how likely ‘Raise price to £54’ is to miss the goal: it depends on how ‘Monthly Pro price’ moves ‘MRR’, which isn’t sized.');
  });
  it('omitted evaluated set = none attested: a declaration alone never counts', () => {
    expect(byId(goalCertaintyDecisions(FX.paul.graph, FX.paul.option_comparison), 'raise_price_to_54')!.earned).toBe(false);
  });
});

describe('R3 5882943255: the break-even is exact only for a stated-level identity with no addends and no other goal parent', () => {
  const withEval = (level_source: string): Run => ({ ...structuredClone(FX.paul), identity_evaluations: [{ node_id: 'mrr', evaluated: true, level_source }] });
  it('level_source "identity_inputs" (the goal\'s level did not reach ISL: no k) → still unearned, but NO break-even figure', () => {
    const d = byId(decide(withEval('identity_inputs')), 'raise_price_to_59')!;
    expect(d.earned).toBe(false);
    expect(d.break_even).toBeUndefined();
    expect(d.no_break_even).toBe('level_from_inputs');
    expect(d.say).toMatch(/^Olumi can’t yet say how likely ‘Raise price to £59’ is to meet the goal/);
  });
  it('an identity with an ADDEND → no break-even figure', () => {
    const run = structuredClone(FX.paul);
    (run.graph.nodes as Json[]).find((n) => n.id === 'mrr')!.nonlinear_identity.addends = [{ label: 'Other revenue', value: 1000 }];
    expect(byId(decide(run), 'raise_price_to_59')).toMatchObject({ earned: false, no_break_even: 'addends' });
    expect(byId(decide(run), 'raise_price_to_59')!.break_even).toBeUndefined();
  });
  it('a goal parent OUTSIDE the identity\'s operands → no break-even figure', () => {
    const run = structuredClone(FX.paul);
    (run.graph.edges as Json[]).push({ from: 'monthly_new_subscribers', to: 'mrr', strength: { mean: 0.1, std: 0.05 }, exists_probability: 0.9, effect_direction: 'positive' });
    expect(byId(decide(run), 'raise_price_to_59')!.break_even).toBeUndefined();
    expect(byId(decide(run), 'raise_price_to_59')!.no_break_even).toBe('extra_goal_parent');
  });
  it('CONTROL: Paul\'s run passes all three (stated level, no addends, the goal\'s parents are exactly the two operands)', () => {
    expect(byId(decide(FX.paul), 'raise_price_to_59')!.break_even?.operand_count).toBe(88);
  });
});

describe('PR Review 5883209483 + R3 5883225699: the goal\'s parents must be EXACTLY its operands — else nothing is earned through it', () => {
  /** Paul's served run with ONE operand → MRR link removed; the identity still declares both operands. */
  const without = (from: string): Run => {
    const run = structuredClone(FX.paul);
    run.graph.edges = (run.graph.edges as Json[]).filter((e) => !(e.from === from && e.to === 'mrr'));
    return run;
  };
  it('RED — `paying_subscribers → mrr` removed: the unsized churn path into subscribers is HIDDEN from the walk, so £59\'s P = 1 is unearned, with no figure', () => {
    const d = byId(decide(without('paying_subscribers')), 'raise_price_to_59')!;
    expect(d).toMatchObject({ probability_of_goal: 1, earned: false, no_break_even: 'operand_not_parent' });
    expect(d.identity_mismatch).toEqual({ node_id: 'paying_subscribers', reason: 'operand_not_parent' });
    expect(d.unsized_path, 'a mismatch is not a path').toBeUndefined();
    expect(d.break_even).toBeUndefined();
    expect(d.say).toBe('Olumi can’t yet say how likely ‘Raise price to £59’ is to meet the goal: ‘MRR’ is worked out from ‘Paying subscribers’, but the model has no link from it to ‘MRR’, so it can’t follow what ‘Monthly Pro price’ does through it.');
  });
  it('RED — `monthly_pro_price → mrr` removed: the unsized path still reaches MRR through subscribers, but the parents are not the operands → NO break-even figure (the subset check emitted one)', () => {
    const d = byId(decide(without('monthly_pro_price')), 'raise_price_to_59')!;
    expect(d).toMatchObject({ earned: false, no_break_even: 'operand_not_parent' });
    expect(d.break_even).toBeUndefined();
  });
  it('the same graph: £54 moves price, so its 0 is unearned too; carrying on moves nothing, so its 0 stands', () => {
    const ds = decide(without('paying_subscribers'));
    expect(byId(ds, 'raise_price_to_54')).toMatchObject({ probability_of_goal: 0, earned: false, no_break_even: 'operand_not_parent' });
    expect(byId(ds, 'carry_on_as_now')).toMatchObject({ probability_of_goal: 0, earned: true });
  });
  it('RED — an EXTRA parent (fully sized £59 + a factor → MRR outside the operands, no price path to it): unequal sets, so the P = 1 is NOT earned, with no figure', () => {
    const run = sizedPaul();
    (run.graph.nodes as Json[]).push({ id: 'annual_contracts', kind: 'factor', label: 'Annual contracts' });
    (run.graph.edges as Json[]).push({ from: 'annual_contracts', to: 'mrr', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' });
    const d = byId(decide(run), 'raise_price_to_59')!;
    expect(d).toMatchObject({ probability_of_goal: 1, earned: false, no_break_even: 'extra_goal_parent' });
    expect(d.identity_mismatch).toEqual({ node_id: 'annual_contracts', reason: 'extra_goal_parent' });
    expect(d.unsized_path, 'no price path reaches annual_contracts: no path is claimed').toBeUndefined();
    expect(d.break_even).toBeUndefined();
    expect(d.say).toBe('Olumi can’t yet say how likely ‘Raise price to £59’ is to meet the goal: the model links ‘Annual contracts’ into ‘MRR’ beside the parts it is worked out from, so it can’t check what ‘Monthly Pro price’ does to it.');
    expect(byId(decide(run), 'carry_on_as_now')).toMatchObject({ probability_of_goal: 0, earned: true });
  });
  it('CONTROL (exact equality): the same fully sized £59 without the extra parent stands, earned', () => {
    expect(byId(decide(sizedPaul()), 'raise_price_to_59')).toMatchObject({ probability_of_goal: 1, earned: true });
  });
  it('CONTROL: an identity the run did NOT evaluate is walked as links, so an unlinked operand is not read (ISL did not read it either)', () => {
    const run = without('paying_subscribers');
    const d = byId(goalCertaintyDecisions(run.graph, run.option_comparison, []), 'raise_price_to_59');
    expect(d?.no_break_even).not.toBe('operand_not_parent');
  });
});

describe('DL 5883245872: the decision is read from the STORED Run fact (`result.enrichment`), never the transport keep-list', () => {
  /** A stored fact's result: PLoT's `/v2/run` response kept whole as `enrichment` (run-analysis.ts). */
  const stored = (run: Run) => ({ enrichment: { option_comparison: run.option_comparison, identity_evaluations: run.identity_evaluations } });
  it('the stored fact gives exactly the decisions the run\'s own inputs give (Paul\'s £59: the 88-of-1,500 break-even)', () => {
    expect(goalCertaintyOfStoredResult(FX.paul.graph, stored(FX.paul))).toEqual(decide(FX.paul));
    expect(byId(goalCertaintyOfStoredResult(FX.paul.graph, stored(FX.paul)), 'raise_price_to_59')!.break_even?.operand_count).toBe(88);
  });
  it('the keep-list shape (evaluated ids, no `identity_evaluations`, no `level_source`) is NOT a stored fact: fail closed, no figure', () => {
    const keepList = { analysis_identity_evaluated_node_ids: FX.paul.analysis_identity_evaluated_node_ids, option_comparison: FX.paul.option_comparison };
    expect(goalCertaintyOfStoredResult(FX.paul.graph, keepList)).toEqual([]);
    const noEvals = { enrichment: { option_comparison: FX.paul.option_comparison } };
    expect(byId(goalCertaintyOfStoredResult(FX.paul.graph, noEvals), 'raise_price_to_59')).toMatchObject({ earned: false, no_break_even: 'identity_not_evaluated' });
  });
});

/**
 * ⛔ #2473 CR P2 (CODEX_CLI_OVERFLOW 5937437431, DL concur): goal certainty is a reader of "is this link sized" too, so it
 * reads a unit-less node in its own LEVEL limit's unit like the limit verdict, the Agent's limit sentence and the size
 * ask do (`limitUnitsOf`). Without it, an otherwise sized path through such a node read as unsized here only: a
 * persisted `earned: false` and "isn't sized" beside readers that call the same link sized.
 */
describe('#2473 P2 — a sized path through a unit-less LIMITED node is earned (the limit\'s unit)', () => {
  /** Paul's sized run, with `monthly_churn`'s own unit removed: only its level limit can say what unit it is read in. */
  const unitLessChurn = (limitUnit: string | undefined): Run => {
    const run = sizedPaul();
    const churn = (run.graph.nodes as Json[]).find((n) => n.id === 'monthly_churn')!;
    delete churn.observed_state;
    delete churn.unit;
    run.graph.goal_constraints = (run.graph.goal_constraints as Json[]).map((c) => {
      if (c.node_id !== 'monthly_churn') return c;
      const { unit: _u, ...rest } = c;
      return limitUnit === undefined ? rest : { ...rest, unit: limitUnit };
    });
    return run;
  };

  it('PRECONDITION: the link into the node is sized in "percentage points"; the node has no unit; its limit is a level', () => {
    const run = unitLessChurn('percentage points');
    const into = (run.graph.edges as Json[]).find((e) => e.from === 'monthly_pro_price' && e.to === 'monthly_churn')!;
    expect(into.provenance).toMatchObject({ magnitude: 'olumi_estimate', natural_effect: { amount_unit: 'percentage points' } });
    const churn = (run.graph.nodes as Json[]).find((n) => n.id === 'monthly_churn')!;
    expect(churn.unit ?? churn.observed_state ?? null).toBeNull();
    expect((run.graph.goal_constraints as Json[]).find((c) => c.node_id === 'monthly_churn')).toMatchObject({ value_frame: 'level', unit: 'percentage points' });
  });

  it('RED: read in the limit\'s unit, £59\'s P = 1 is EARNED — the same link the limit readers call sized', () => {
    expect(byId(decide(unitLessChurn('percentage points')), 'raise_price_to_59')).toMatchObject({ probability_of_goal: 1, earned: true });
  });

  it('CONTROL (wrong unit): a limit in another unit sizes nothing — not earned, the unsized path named', () => {
    const d = byId(decide(unitLessChurn('hours')), 'raise_price_to_59')!;
    expect(d).toMatchObject({ probability_of_goal: 1, earned: false });
    expect(d.unsized_path?.from).toBe('monthly_pro_price');
  });

  it('CONTROL (no unit anywhere): the limit carries none — not earned', () => {
    expect(byId(decide(unitLessChurn(undefined)), 'raise_price_to_59')).toMatchObject({ probability_of_goal: 1, earned: false });
  });
});
