/**
 * Rows for the frames build (AIQ 5895140735 / 5894561359; R3 5893508312 / 5894964169; MG `mg/frames-tighten-source`),
 * on the SERVED saved graph of Run `c96fc4bb`: £49 per subscriber on subscribers' frame 10,000 over MRR's 106,250 gives
 * β = 4.61, which PLoT cuts to 1. The oracle (`tests/helpers/frame-invariance.ts`) is checked here against AIQ's own
 * numbers, so MG's builder can be held to `frameInvariance(before, built) === []`.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { frameInvariance, frameOf, naturalSpread, reframe } from '../helpers/frame-invariance.js';

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

  it('MUTANT: the stated size\'s natural_effect.strength_mean left stale → natural_effect_off', () => {
    const after = reframe(c96(), 'mrr', 500_000);
    edge(after, 'paying_subscribers', 'mrr').provenance.natural_effect.strength_mean = 4.6117647058823525;
    expect(frameInvariance(c96(), after)).toEqual(['natural_effect_off paying_subscribers→mrr']);
  });

  it('⭐ R7 (R3 5894964169): re-framing an OLUMI-estimated source carries its natural spread; not carrying it narrows it 10×', () => {
    const before = reframe(c96(), 'mrr', 500_000); // R9's graph: no cut left, so only the spread is under test
    const carried = reframe(before, 'monthly_gross_additions', 100);
    expect(naturalSpread(node(carried, 'monthly_gross_additions'))).toBeCloseTo(naturalSpread(node(before, 'monthly_gross_additions'))!, 9);
    expect(node(carried, 'monthly_gross_additions').observed_state.std_source).toBe('olumi'); // its original owner → ISL `template`
    expect(frameInvariance(before, carried)).toEqual([]);
    const dropped = JSON.parse(JSON.stringify(carried));
    delete node(dropped, 'monthly_gross_additions').observed_state.std;
    expect(frameInvariance(before, dropped)).toEqual(['spread_moved monthly_gross_additions 100.0 → 10.00']);
  });

  it('R7b (R3-B 5895208669): where 0.15·value already keeps the natural spread, NOTHING is minted (PLoT keeps its own default)', () => {
    const g = c96();
    const n = node(g, 'monthly_gross_additions');
    n.observed_state.value = 0.75; n.observed_state.cap = 80; // 60 on a frame of 80: 0.15·0.75 = 0.1125 > the 0.1 floor
    const after = reframe(g, 'monthly_gross_additions', 70); // 60/70 = 0.857: still above the floor
    expect(node(after, 'monthly_gross_additions').observed_state.std).toBeUndefined();
    expect(frameInvariance(g, after).filter((v) => v.startsWith('spread_moved'))).toEqual([]);
  });

  it('R7c (R3-B 5895208669): a carried spread that BINDS PLoT\'s 2.0 std cap moves, so that re-frame is refused', () => {
    const before = reframe(c96(), 'mrr', 500_000);
    const after = reframe(before, 'monthly_gross_additions', 40); // 100 natural / 40 = std 2.5 → PLoT sends 2.0 → 80
    expect(frameInvariance(before, after)).toEqual(['spread_moved monthly_gross_additions 100.0 → 80.00']);
  });

  it('a zero held exact is never given a spread (it stays a point mass)', () => {
    const g = c96();
    node(g, 'monthly_gross_additions').observed_state.value = 0; node(g, 'monthly_gross_additions').observed_state.raw_value = 0; node(g, 'monthly_gross_additions').observed_state.cap = 1000;
    expect(node(reframe(g, 'monthly_gross_additions', 100), 'monthly_gross_additions').observed_state.std).toBeUndefined();
  });

  it('a USER-STATED level keeps the minimum spread and is never given a carried spread or label', () => {
    const after = reframe(c96(), 'paying_subscribers', 20_000);
    expect(node(after, 'paying_subscribers').observed_state.std_source).toBeUndefined();
  });
});
