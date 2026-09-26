/**
 * ⭐ AX1 — the arithmetic answer when the analysis cannot rank a price × volume goal (DL #70 5850280205).
 *
 * FIXTURE: the served model DL's joined run `f-20260926T201724Z` ran on at 05-F8-run (graph_hash 783e01ff): MRR carries
 * the product identity Pro plan price × Pro paying subscribers (inferred, not stated in the brief), today's price is
 * £49 (the brief's), today's subscribers 300 (Olumi's figure, approved as an assumption), and the options set £59 (brief), £54 (Olumi's)
 * and £49 (brief). That Run's reply led with "No option can be put forward…" and gave no arithmetic at all.
 *
 * Expected figures, by hand: 49 × 300 = 14,700. 14,700 ÷ 59 = 249.2 → 250 must stay (a loss of at most 50);
 * 14,700 ÷ 54 = 272.2 → 273. The £20,000 target: ÷ 59 = 339.0 → 339; ÷ 54 = 370.4 → 371; ÷ 49 = 408.2 → 409.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { breakEvenFor, breakEvenLine } from '../break-even.js';
import { deriveEmittedGoalDirection } from '../../goal-target/goal-direction.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-f8-run-graph-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: Record<string, unknown>[]; edges: unknown[] };
const graph = (change?: (nodes: Record<string, unknown>[]) => void) => {
  const g = structuredClone(served);
  change?.(g.nodes);
  return g;
};
const node = (nodes: Record<string, unknown>[], id: string) => nodes.find((n) => n.id === id)!;

describe('AX1: the price × volume arithmetic on the served F8 model', () => {
  it('RED (served F8): today, the break-even subscribers per price, and the subscribers the £20,000 target needs — each figure\'s owner named', () => {
    const be = breakEvenFor(graph());
    expect(be).toEqual({
      goal: 'MRR', price_factor: 'Pro plan price', volume_factor: 'Pro paying subscribers', unit: 'GBP/month',
      identity_stated_in_brief: false,
      baseline_price: 49, baseline_price_by: 'user', baseline_volume: 300, baseline_volume_by: 'approved', baseline_goal: 14_700,
      options: [
        { option: 'Raise Pro to £59', price: 59, price_by: 'user', keep_at_least: 250 },
        { option: 'Hold £49 with AI release', price: 49, price_by: 'user' },
        { option: 'Raise Pro to £54', price: 54, price_by: 'olumi', keep_at_least: 273 },
      ],
      target: { value: 20_000, needs: [{ price: 59, volume: 339 }, { price: 54, volume: 371 }, { price: 49, volume: 409 }] },
    });
  });

  it('RED (served F8): the paragraph the user reads answers the question, with the figures and whose they are', () => {
    const said = breakEvenLine(breakEvenFor(graph())!);
    expect(said).toContain('If MRR is Pro plan price × Pro paying subscribers (Olumi’s reading of your goal)');
    expect(said).toContain('at £49/month and 300 Pro paying subscribers (an assumption you approved), MRR is £14,700/month today.');
    expect(said).toContain('At £59/month, MRR stays at least that while 250 or more of the 300 stay (a loss of at most 50).');
    expect(said).toContain('At £54/month (Olumi’s estimate), MRR stays at least that while 273 or more');
    expect(said).toContain('£20,000/month needs 339 at £59/month, 371 at £54/month or 409 at £49/month.');
    expect(said).toContain('not the analysis ranking the options');
  });

  it('CONTRAST: no product identity on the goal → nothing (an additive goal is the analysis\'s to answer)', () => {
    expect(breakEvenFor(graph((ns) => { delete node(ns, 'mrr').nonlinear_identity; }))).toBeNull();
  });

  it('CONTRAST: a figure that is not exact or not anyone\'s → nothing, never an approximate answer', () => {
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_paying_subscribers').observed_state as Record<string, unknown>).raw_value = undefined; }))).toBeNull();
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_plan_price').observed_state as Record<string, unknown>).source = 'unknown_source'; }))).toBeNull();
  });

  it('CONTRAST: a target in another unit gives no target line (the break-even still stands)', () => {
    const be = breakEvenFor(graph((ns) => { node(ns, 'mrr').goal_threshold_unit = 'GBP/year'; }));
    expect(be?.target).toBeUndefined();
    expect(be?.options[0]).toMatchObject({ keep_at_least: 250 });
  });

  /**
   * MG's maths review (#2051 5850436075, Model Generation 71229dfd): three input shapes stated a false figure. Adopted
   * verbatim as RED rows (P1, P2, P4); P3 pins the exact-division boundary.
   */
  it('RED (MG P1): a DELTA-framed target ("grow MRR by £5,000/month") is not stated as an absolute £5,000 target', () => {
    const be = breakEvenFor(graph((ns) => { const g = node(ns, 'mrr'); g.goal_threshold_frame = 'delta'; g.goal_threshold_raw = 5000; }));
    expect(be).not.toBeNull();
    expect(be!.target === undefined || be!.target.value === 19_700).toBe(true);
  });

  it('RED (MG P1, fail-closed): a target with no stated frame is not assumed to be a level', () => {
    const be = breakEvenFor(graph((ns) => { delete node(ns, 'mrr').goal_threshold_frame; }));
    expect(be).not.toBeNull();
    expect(be!.target).toBeUndefined();
  });

  it('RED (MG P2): a goal to REDUCE gets no "stays at least that" / "needs" answer', () => {
    const g = graph((ns) => { node(ns, 'mrr').label = 'Reduce monthly hosting cost'; });
    expect(deriveEmittedGoalDirection(g, 'mrr')).toBe('minimise');
    expect(breakEvenFor(g)).toBeNull();
  });

  it('BOUNDARY (MG P3): exact division — 14,700 ÷ £60 = 245 exactly → keep 245, not 246', () => {
    const be = breakEvenFor(graph((ns) => { (node(ns, 'raise_pro_to_59').interventions as Record<string, unknown>).pro_plan_price = { value: 0.3, source: 'brief_extraction' }; }));
    expect(be!.options[0]).toMatchObject({ price: 60, keep_at_least: 245 });
  });

  it('RED (MG P4): a volume that is not a count (a % rate) is never multiplied by a price', () => {
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_paying_subscribers').observed_state as Record<string, unknown>).unit = '%'; }))).toBeNull();
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_paying_subscribers').observed_state as Record<string, unknown>).unit = ''; }))).toBeNull();
  });
});
