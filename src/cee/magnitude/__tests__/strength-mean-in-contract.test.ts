/**
 * ⛔ A STORED EDGE MEAN STAYS IN THE PUBLISHED CONTRACT (Canvas #72 5893089961; P0 Shared Data 5893186777; MG 5893205866).
 *
 * Served saved Run c96fc4bb (Paul's brief, CEE 3577ee2): the user's "£49 per subscriber" read on the two frames gave
 * β = 49 × 8,000 / 85,000 = 4.6117647, and D7 stored it as `strength.mean`. `StrengthSchema.mean` is [−1, 1]; ISL clamps
 * the mean to the bound at parse, so the analysed edge was 1.0 while the saved graph said 4.61, and a fresh browser
 * refused to call them the same model. The stored mean is now the analysed one; the user's own figure is kept where it is
 * read (`stated_strength`, the "cut short" question), and the natural size said beside the edge is the analysed one.
 */
import { describe, expect, it } from 'vitest';

import { sizeLink, type MagnitudeNode } from '../link-effect.js';

const mrr: MagnitudeNode = {
  label: 'MRR', kind: 'goal', goal_threshold_cap: 25000, goal_threshold_unit: 'GBP per month', option_levels: [],
};
const subscribers: MagnitudeNode = {
  label: 'Pro paying subscribers', kind: 'factor',
  observed_state: { value: 0.2, raw_value: 400, cap: 2000, unit: 'subscribers', source: 'brief_extraction', extractionType: 'explicit' },
  option_levels: [],
};
const stated = (amount: number, direction: 'positive' | 'negative' = amount < 0 ? 'negative' : 'positive') =>
  sizeLink({ direction, effect_amount: amount, effect_per_source_change: 1, user_stated: true }, subscribers, mrr);

describe('a user-stated size beyond the frames is stored at the bound the engine analyses', () => {
  it('RED: +£49 per subscriber (β = 49 × 2,000 / 25,000 = 3.92) is stored as mean 1, the user\'s β kept as stated_strength and asked', () => {
    const s = stated(49);
    expect(s.outcome).toBe('user_stated');
    expect(s.mean).toBe(1);
    expect(s.stated_strength).toBeCloseTo(3.92, 9);
    expect(s.std).toBeCloseTo(1.96, 9);
    expect(s.problem).toBe('not_representable');
    expect(s.question).toContain('kept exactly as you said');
  });
  it('the natural size said beside the edge is the ANALYSED one, keyed to the stored mean (never the stale £49)', () => {
    const n = stated(49).natural_effect!;
    expect(n.strength_mean).toBe(1);
    expect(n.amount).toBe(12.5);
    expect(n.per_source_change).toBe(1);
  });
  it('the other sign: −£49 per subscriber is stored as −1', () => {
    expect(stated(-49).mean).toBe(-1);
    expect(stated(-49).natural_effect!.strength_mean).toBe(-1);
  });
  it('CONTROL: a user-stated size inside the frames (+£5, β 0.4) is stored exactly as before', () => {
    const s = stated(5);
    expect(s.mean).toBeCloseTo(0.4, 9);
    expect(s.stated_strength).toBeCloseTo(0.4, 9);
    expect(s.natural_effect!.strength_mean).toBe(s.mean);
    expect(s.natural_effect!.amount).toBe(5);
    expect(s.problem).toBeUndefined();
  });
  it('CONTROL: Olumi\'s own estimate beyond the frames is still set aside for the placeholder, never stored as user_stated', () => {
    const s = sizeLink({ direction: 'positive', effect_amount: 49, effect_per_source_change: 1, user_stated: false }, subscribers, mrr);
    expect(s.outcome).not.toBe('user_stated');
    expect(Math.abs(s.mean)).toBeLessThanOrEqual(1);
  });
});
