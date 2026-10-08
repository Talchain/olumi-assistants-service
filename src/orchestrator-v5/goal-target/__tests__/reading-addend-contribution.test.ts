import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { executedReadingAddendOf } from '../reading-addend-contribution.js';

type Rec = Record<string, any>;
const PAUL = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8'));
const LOSS = 'mrr_lost_to_price_driven_churn';
const graph = (): Rec => structuredClone(PAUL);
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);
const options = [
  { id: 'keep_49_pro_price', interventions: { pro_plan_price: .245 } },
  { id: 'raise_pro_price_to_59', interventions: { pro_plan_price: .295 } },
  { id: 'test_54_pro_price', interventions: { pro_plan_price: .27 } },
];
const rawOptions = [
  { id: 'keep_49_pro_price', interventions: { pro_plan_price: 49 } },
  { id: 'raise_pro_price_to_59', interventions: { pro_plan_price: 59 } },
  { id: 'test_54_pro_price', interventions: { pro_plan_price: 54 } },
];
const contribution = (g: Rec, option = 'raise_pro_price_to_59') => executedReadingAddendOf(g, options, option, 'mrr', LOSS);

describe('GR2 executed addend contribution, ISL central config on the PLoT wire', () => {
  // ISL staging 82842bb: _propagate :2483–2510; _central_identity_scales :2578–2581;
  // _identity_value :2644–2657. These are the central config's actual arithmetic, not MC means.
  it.each([
    ['keep_49_pro_price', .245, -560.7168],
    ['raise_pro_price_to_59', .295, -598.3488],
    ['test_54_pro_price', .27, -579.5328],
  ] as const)('Paul 632b92b9 loss node %s: proves the amount actually subtracted by node id', (id, price, expected) => {
    const out = executedReadingAddendOf(graph(), rawOptions, id, 'mrr', LOSS);
    // Linear non-listed L = goal frame × loss-to-goal effective strength × propagated loss.
    const propagatedLoss = (.04 + price * .1 * .8) * .735 * .8;
    expect(out?.value).toBeCloseTo(25000 * (-.8 * .8) * propagatedLoss, 8);
    expect(out?.value).toBeCloseTo(expected, 8);
    expect(out?.sized).toBe(false);
    // Normalized all-[0,1] requests skip PLoT Phase4; same ISL values.
    expect(out?.value).toBeCloseTo(contribution(graph(), id)!.value, 8);
  });
  it('PLoT raw-scale normalization gate is request-wide, including in-range settings', () => {
    const mixed = structuredClone(rawOptions);
    mixed[1]!.interventions.pro_plan_price = .295;
    const result = executedReadingAddendOf(graph(), mixed, 'raise_pro_price_to_59', 'mrr', LOSS);
    const propagatedLoss = (.04 + (.295 / 200) * .1 * .8) * .735 * .8;
    expect(result?.value).toBeCloseTo(25000 * (-.8 * .8) * propagatedLoss, 8);
  });
  it('raw interventions follow PLoT cap clamp; missing normalization ruler withholds', () => {
    const above = structuredClone(rawOptions); above[1]!.interventions.pro_plan_price = 240;
    const clamped = executedReadingAddendOf(graph(), above, 'raise_pro_price_to_59', 'mrr', LOSS);
    expect(clamped?.value).toBeCloseTo(25000 * (-.8 * .8) * (.04 + .1 * .8) * .735 * .8, 8);
    const g = graph();
    delete node(g, 'pro_plan_price').observed_state.cap;
    delete node(g, 'pro_plan_price').observed_state.raw_value;
    expect(executedReadingAddendOf(g, rawOptions, 'raise_pro_price_to_59', 'mrr', LOSS)).toBeNull();
  });
  it('attested root no-change with distinct baseline/value withholds an ambiguous central reconstruction', () => {
    const g = graph();
    // ISL :2287–2296 attests baseline first; _in_model_frame :2709–2713 preserves
    // the root's reference value .3 for an attested "keep .2", instead of setting .2.
    Object.assign(node(g, 'pro_plan_price').observed_state, {
      baseline: .2, value: .3, raw_value: 60, source: 'user_override',
    });
    const altered = structuredClone(rawOptions);
    altered[0]!.interventions.pro_plan_price = 40; // raw40 / cap200 = held baseline .2
    expect(executedReadingAddendOf(g, altered, 'keep_49_pro_price', 'mrr', LOSS)).toBeNull();
  });
  it.each([-1000, 1000])('LISTED signed value %s ignores the negative outgoing edge', raw => {
    const g = graph();
    node(g, 'mrr').nonlinear_identity.addends = [LOSS];
    node(g, LOSS).observed_state = { value: raw / 20000, raw_value: raw, unit: '£/month', source: 'cee_inference' };
    expect(contribution(g, 'keep_49_pro_price')).toEqual({ value: raw, sized: true });
    expect(contribution(g)?.value).toBeCloseTo(raw + 47.04, 8);
  });
  it('listed levelless addend is operand_missing, never a zero contribution', () => {
    const g = graph(); node(g, 'mrr').nonlinear_identity.addends = [LOSS];
    expect(contribution(g)).toBeNull();
  });
  it('nonlisted negative-valued parent flips negative coefficient into positive executed contribution', () => {
    const g = graph();
    g.edges = g.edges.filter((e: Rec) => e.to !== LOSS);
    node(g, LOSS).observed_state = { value: -.05, raw_value: -1000, unit: '£/month', source: 'cee_inference' };
    expect(contribution(g)?.value).toBeCloseTo(800, 8);
    expect(contribution(g)?.sized).toBe(true);
  });
  it('a stated goal level executes L minus its reference, rather than the full subtraction', () => {
    const g = graph(); node(g, 'mrr').observed_state = { value: .588, raw_value: 14700, source: 'brief_extraction' };
    expect(contribution(g, 'keep_49_pro_price')).toEqual({ value: 0, sized: false });
    expect(contribution(g)?.value).toBeCloseTo(-37.632, 8);
  });
  it.each(['nonlinear', 'event', 'correlation', 'cycle', 'coefficient', 'frame', 'option'] as const)('unsupported or unresolved %s fails closed', kind => {
    const g = graph();
    if (kind === 'nonlinear') node(g, 'monthly_churn_rate').nonlinear_identity = { operation: 'sum', factor_ids: ['pro_plan_price'] };
    if (kind === 'event') node(g, LOSS).event_risk = { v: 1 };
    if (kind === 'correlation') g.factor_correlations = [{ factor_ids: ['monthly_churn_rate', 'pro_plan_price'] }];
    if (kind === 'cycle') g.edges.push({ from: LOSS, to: 'monthly_churn_rate', strength: { mean: 1 }, exists_probability: 1 });
    if (kind === 'coefficient') delete g.edges.find((e: Rec) => e.from === LOSS && e.to === 'mrr').strength;
    if (kind === 'frame') delete node(g, 'mrr').goal_threshold_cap;
    expect(contribution(g, kind === 'option' ? 'not_this_run' : undefined)).toBeNull();
  });
});
