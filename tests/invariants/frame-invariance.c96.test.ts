/**
 * Rows for the frames build (AIQ 5895140735 / 5894561359; R3 5893508312 / 5894964169; MG `mg/frames-tighten-source`),
 * on the SERVED saved graph of Run `c96fc4bb`: £49 per subscriber on subscribers' frame 10,000 over MRR's 106,250 gives
 * β = 4.61, which PLoT cuts to 1. The oracle (`tests/helpers/frame-invariance.ts`) is checked here against AIQ's own
 * numbers, so MG's builder can be held to `frameInvariance(before, built) === []`.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { frameInvariance, frameOf, reframe } from '../helpers/frame-invariance.js';
import { carryStatedLevelSpread } from '../../src/orchestrator-v5/tools/handlers/stated-level-spread.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('../fixtures/served/c96fc4bb-saved-graph.json', import.meta.url), 'utf8')) as { graph: Rec };
const c96 = (): Rec => JSON.parse(JSON.stringify(FX.graph));
const edge = (g: Rec, from: string, to: string): Rec => g.edges.find((e: Rec) => e.from === from && e.to === to);
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id);

describe('frame invariance — the oracle on the served c96 graph', () => {
  it('as served, the only violation is the cut itself (4.61 > 1); a no-op re-frame changes nothing', () => {
    expect(frameInvariance(c96(), c96())).toEqual(['beta_out_of_contract paying_subscribers→mrr 4.612']);
    expect(frameInvariance(c96(), reframe(c96(), 'mrr', frameOf(node(c96(), 'mrr'))!))).toEqual(['beta_out_of_contract paying_subscribers→mrr 4.612']);
  });

  it('⭐ R9: WIDEN MRR to 500,000 (AIQ 5895140735): no cut, nothing else moves, £49 per subscriber exact', () => {
    const after = reframe(c96(), 'mrr', 500_000);
    expect(frameInvariance(c96(), after)).toEqual([]);
    expect(edge(after, 'paying_subscribers', 'mrr').strength.mean).toBeCloseTo(0.98, 12); // 49 × 10,000 / 500,000
    expect(edge(after, 'pro_plan_price', 'mrr').strength.mean).toBeCloseTo(0.10625, 12); // 0.5 × 106,250 / 500,000
    expect((edge(after, 'pro_plan_price', 'mrr').strength.mean * 500_000) / 200).toBeCloseTo(265.625, 9); // £ per £1, unchanged
    expect(edge(after, 'monthly_churn', 'paying_subscribers').strength.mean).toBe(-0.5);
    expect(edge(after, 'monthly_gross_additions', 'paying_subscribers').strength.mean).toBe(1);
    expect(node(after, 'mrr').goal_threshold_raw).toBe(85_000);
    expect(node(after, 'mrr').goal_threshold).toBeCloseTo(0.17, 12);
    expect(node(after, 'mrr').observed_state.raw_value).toBe(75_000);
  });

  it('⭐ R10: TIGHTEN subscribers to 1,875 is REFUSED, and its two new cuts are named (churn −2.67, gross additions 5.33)', () => {
    expect(frameInvariance(c96(), reframe(c96(), 'paying_subscribers', 1_875))).toEqual([
      'beta_out_of_contract monthly_churn→paying_subscribers -2.667',
      'beta_out_of_contract monthly_gross_additions→paying_subscribers 5.333',
    ]);
  });

  it('MUTANT (R8): widen MRR but HOLD β on the DEFAULT link price→MRR → its natural size moves ×4.7', () => {
    const after = reframe(c96(), 'mrr', 500_000);
    edge(after, 'pro_plan_price', 'mrr').strength.mean = 0.5;
    expect(frameInvariance(c96(), after)).toContain('natural_size_moved pro_plan_price→mrr 265.625 → 1250.00');
  });

  it('a RELATIVE goal (−15%, `change_rel`) is scale-free: re-framing keeps it exactly; scaling it is caught', () => {
    const g = c96();
    Object.assign(node(g, 'mrr'), { goal_threshold_frame: 'change_rel', goal_threshold: 0.1333, goal_threshold_raw: 0.1333 });
    const after = reframe(g, 'mrr', 500_000);
    expect(node(after, 'mrr').goal_threshold).toBe(0.1333);
    expect(frameInvariance(g, after)).toEqual([]);
    node(after, 'mrr').goal_threshold = 0.1333 * (106_250 / 500_000); // MUTANT: scaled like a level
    expect(frameInvariance(g, after)).toEqual(['level_moved mrr (relative target)']);
  });

  it('a stated amount stored ROUNDED (£48.9999) still reads back; one 1% off does not', () => {
    const g = reframe(c96(), 'mrr', 500_000);
    edge(g, 'paying_subscribers', 'mrr').provenance.natural_effect.amount = 48.9999;
    expect(frameInvariance(g, g)).toEqual([]);
    edge(g, 'paying_subscribers', 'mrr').provenance.natural_effect.amount = 49.49;
    expect(frameInvariance(g, g)).toEqual(['natural_effect_off paying_subscribers→mrr']);
  });

  it('MUTANT: the stated size\'s natural_effect.strength_mean left stale → natural_effect_off', () => {
    const after = reframe(c96(), 'mrr', 500_000);
    edge(after, 'paying_subscribers', 'mrr').provenance.natural_effect.strength_mean = 4.6117647058823525;
    expect(frameInvariance(c96(), after)).toEqual(['natural_effect_off paying_subscribers→mrr']);
  });

  it('⭐ R7 (AIQ 5895379601 (2)): a FLOOR-BOUND Olumi estimate is never given a minted std, so its re-frame is REFUSED', () => {
    const before = reframe(c96(), 'mrr', 500_000); // R9's graph: no cut left, so only the spread is under test
    const after = reframe(before, 'monthly_gross_additions', 100); // 0.15·0.06 < 0.1: PLoT's floor sets the spread (100 → 10)
    expect(node(after, 'monthly_gross_additions').observed_state.std).toBeUndefined();
    expect(frameInvariance(before, after)).toEqual(['spread_moved monthly_gross_additions 100.0 → 10.00 (floor-bound)']);
  });

  it('R7a: an EXISTING Olumi std is rescaled, keeps its natural spread and is marked with its owner; dropping it is caught', () => {
    const before = reframe(c96(), 'mrr', 500_000);
    node(before, 'monthly_gross_additions').observed_state.std = 0.1; // Olumi's own spread: 100 subscribers/month natural
    const carried = reframe(before, 'monthly_gross_additions', 100);
    expect(node(carried, 'monthly_gross_additions').observed_state.std).toBeCloseTo(1, 12);
    expect(node(carried, 'monthly_gross_additions').observed_state.std_source).toBe('olumi'); // → ISL `template`
    expect(frameInvariance(before, carried)).toEqual([]);
    delete node(carried, 'monthly_gross_additions').observed_state.std;
    expect(frameInvariance(before, carried)).toEqual(['spread_moved monthly_gross_additions 100.0 → 10.00 (floor-bound)']);
  });

  it('R7u (AIQ 5895379601 (2)): a USER\'s spread rescaled into a new frame is still the user\'s', () => {
    const before = reframe(c96(), 'mrr', 500_000);
    node(before, 'paying_subscribers').observed_state.std = 0.05; // the user's range: ±500 subscribers on a frame of 10,000
    const after = reframe(before, 'paying_subscribers', 20_000);
    expect(node(after, 'paying_subscribers').observed_state.std).toBeCloseTo(0.025, 12);
    expect(node(after, 'paying_subscribers').observed_state.std_source).toBe('user');
    expect(frameInvariance(before, after).filter((v) => v.startsWith('spread_moved'))).toEqual([]);
  });

  it('R7b (R3-B 5895208669): above the floor on BOTH frames, 0.15·value already keeps the natural spread; nothing is minted', () => {
    const g = c96();
    const n = node(g, 'monthly_gross_additions');
    n.observed_state.value = 0.75; n.observed_state.cap = 80; // 60 on a frame of 80: 0.15·0.75 = 0.1125 > the 0.1 floor
    const after = reframe(g, 'monthly_gross_additions', 70); // 60/70 = 0.857: still above the floor
    expect(node(after, 'monthly_gross_additions').observed_state.std).toBeUndefined();
    expect(frameInvariance(g, after).filter((v) => v.startsWith('spread_moved'))).toEqual([]);
  });

  it('R7c (AIQ 5895379601 (2)): a carried std that BINDS PLoT\'s 2.0 std cap moves, so that re-frame is refused', () => {
    const before = reframe(c96(), 'mrr', 500_000);
    node(before, 'monthly_churn').observed_state.std = 0.1; // 10 points natural
    const after = reframe(before, 'monthly_churn', 4); // 3% on a frame of 4: std 2.5 → PLoT sends 2.0 → 8
    expect(frameInvariance(before, after)).toEqual([
      'beta_out_of_contract pro_plan_price→monthly_churn 2.500', // tightening also makes a cut (0.1 × 100/4)
      'spread_moved monthly_churn 10.00 → 8.000',
    ]);
  });

  it('a zero held exact is never given a spread (it stays a point mass)', () => {
    const g = c96();
    node(g, 'monthly_gross_additions').observed_state.value = 0; node(g, 'monthly_gross_additions').observed_state.raw_value = 0; node(g, 'monthly_gross_additions').observed_state.cap = 1000;
    expect(node(reframe(g, 'monthly_gross_additions', 100), 'monthly_gross_additions').observed_state.std).toBeUndefined();
  });

  it('a USER-STATED level with no range keeps the minimum spread and gets no std and no marker', () => {
    const after = reframe(c96(), 'paying_subscribers', 20_000);
    expect(node(after, 'paying_subscribers').observed_state.std).toBeUndefined();
    expect(node(after, 'paying_subscribers').observed_state.std_source).toBeUndefined();
  });

  it('⭐ bounded_scale (AIQ 5895590866 (1)): CSAT "out of 5" widened 5 → 10 is refused; MRR widened (money) is not', () => {
    const g: Rec = { nodes: [
      { id: 'sla', kind: 'factor', observed_state: { value: 4 / 24, raw_value: 4, cap: 24, unit: 'hours', source: 'brief_extraction' } },
      { id: 'csat', kind: 'factor', observed_state: { value: 0.84, raw_value: 4.2, cap: 5, unit: 'out of 5', source: 'brief_extraction' } },
    ], edges: [{ from: 'sla', to: 'csat', strength: { mean: -1.44 } }] }; // the served support brief: −0.3 points per SLA hour
    expect(frameInvariance(g, reframe(g, 'csat', 10))).toEqual(['bounded_scale csat 5 → 10 (top 5)']);
    expect(frameInvariance(c96(), reframe(c96(), 'mrr', 500_000))).toEqual([]); // control: money is not bounded
    expect(frameInvariance(g, reframe(g, 'sla', 12))).toEqual([]); // tightening the source fits it without touching CSAT
  });

  it('PR Review CR 5898213793: a STATED factor widened keeps its wire spread exact (1e-4 both); Olumi\'s estimate moves 10 → 50 and is refused', () => {
    const row = (source: string): Rec => ({ nodes: [
      { id: 'x', kind: 'factor', label: 'X', observed_state: { value: 0.2, raw_value: 20, cap: 100, source: 'brief_extraction' } },
      { id: 'y', kind: 'factor', label: 'Y', observed_state: { value: 0.4, raw_value: 40, cap: 100, source } },
    ], edges: [{ from: 'x', to: 'y', strength: { mean: 3 } }] });
    const wireStd = (g: Rec): unknown => (carryStatedLevelSpread(g) as Rec).nodes.find((n: Rec) => n.id === 'y').observed_state.std;
    // Stated: the Run's wire (carryStatedLevelSpread) sends Y at 1e-4 on BOTH frames, so PLoT samples it exactly both times.
    const stated = row('brief_extraction');
    const widened = reframe(stated, 'y', 500);
    expect([wireStd(stated), wireStd(widened)]).toEqual([1e-4, 1e-4]);
    expect(frameInvariance(stated, widened)).toEqual([]);
    // Olumi's estimate: no wire std, so PLoT's default max(0.1, 0.15·value) on the frame: 10 → 50 natural → refused.
    const olumi = row('cee_inference');
    const widenedOlumi = reframe(olumi, 'y', 500);
    expect([wireStd(olumi), wireStd(widenedOlumi)]).toEqual([undefined, undefined]);
    expect(frameInvariance(olumi, widenedOlumi)).toEqual(['spread_moved y 10.00 → 50.00 (floor-bound)']);
  });

  it('⭐ R3: no frame below the node\'s own level or an option\'s value for it', () => {
    const before = reframe(c96(), 'mrr', 500_000);
    expect(frameInvariance(before, reframe(before, 'paying_subscribers', 1_000))).toContain('frame_below_level paying_subscribers 1000 < 1500');
    expect(frameInvariance(before, reframe(before, 'pro_plan_price', 55))).toEqual(['frame_below_level pro_plan_price 55 < 59']); // the £59 option
  });

  it('R3b: re-framing a factor carries every option\'s value for it; leaving them on the old frame moves £59 → £29.50', () => {
    const before = reframe(c96(), 'mrr', 500_000);
    const after = reframe(before, 'pro_plan_price', 100);
    expect(frameInvariance(before, after)).toEqual([]);
    expect(node(after, 'raise_price_to_59').interventions.pro_plan_price.value).toBeCloseTo(0.59, 12);
    node(after, 'raise_price_to_59').interventions.pro_plan_price.value = 0.295; // MUTANT: not carried
    expect(frameInvariance(before, after)).toEqual(['level_moved raise_price_to_59→pro_plan_price (intervention ≠ raw/F)']);
  });


});
