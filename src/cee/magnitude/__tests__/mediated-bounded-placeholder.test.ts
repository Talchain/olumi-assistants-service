/**
 * ⭐ MAGNITUDE CONTRACT PR1b — the SERVED shape PR1 left at ±0.5 (#70 5848092404, CEE 4202cda, Paul's brief):
 * churn's baseline is Olumi's own estimate (7%, `cee_inference`) and both of churn's parents are MEDIATORS no option
 * moves. PR1's D6 needed a KNOWN baseline and an option swing, so every link into churn kept the frame-blind ±0.5 and
 * churn draws stayed impossible. A link into a BOUNDED target with no usable size now gets the frame-aware placeholder
 * sized against whatever baseline the model holds, over the source's full range when no option moves it — still
 * Olumi's (`olumi_placeholder`) and still asked about.
 */
import { describe, expect, it } from 'vitest';
import { sizeLink, type MagnitudeNode } from '../link-effect.js';

const churnEstimated: MagnitudeNode = {
  label: 'Monthly churn', kind: 'factor', scale_frame: 100,
  observed_state: { unit: 'percent per month', value: 0.07, raw_value: 7, source: 'cee_inference', extractionType: 'inferred' },
  option_levels: [],
};
const perceivedValue: MagnitudeNode = {
  label: 'Customer perceived value', kind: 'factor', scale_frame: 100,
  observed_state: { unit: 'value perception score out of 100', value: 0.5, raw_value: 50, source: 'cee_inference', extractionType: 'inferred' },
  option_levels: [],
};
const NULL_SIZE = { effect_amount: null, effect_per_source_change: null, user_stated: false } as const;

describe('PR1b: a link into a bounded target is sized to its frame even when the baseline is Olumi\'s and the source a mediator', () => {
  it('RED (served): perceived value -> churn (7% estimated, mediator source) is the placeholder −0.0175 / 0.00875, stamped, asked — not ±0.5', () => {
    const s = sizeLink({ direction: 'negative', ...NULL_SIZE }, perceivedValue, churnEstimated);
    expect(s.outcome).toBe('placeholder');
    expect(s.mean).toBeCloseTo(-0.0175, 12);
    expect(s.std).toBeCloseTo(0.00875, 12);
    expect(s.magnitude).toBe('olumi_placeholder');
    expect(s.question).toContain('"Monthly churn"');
  });

  it('RED (served): a POSITIVE mediator into churn (price-driven churn) is bounded by the headroom above 7%: +min(0.5, 0.93/4, 0.07/4) = +0.0175', () => {
    const s = sizeLink({ direction: 'positive', ...NULL_SIZE }, { ...perceivedValue, label: 'Price-driven churn' }, churnEstimated);
    expect(s.outcome).toBe('placeholder');
    expect(s.mean).toBeCloseTo(0.0175, 12);
  });

  it('CONTRAST: an UNBOUNDED target (a count) keeps today\'s ±0.5 / 0.125 exactly, unstamped', () => {
    const subscribers: MagnitudeNode = { label: 'Paying subscribers', kind: 'factor', observed_state: { unit: 'subscribers', value: 1200, raw_value: 1200, source: 'cee_inference' }, option_levels: [] };
    const s = sizeLink({ direction: 'negative', ...NULL_SIZE }, churnEstimated, subscribers);
    expect(s.outcome).toBe('unchanged');
    expect(s).toMatchObject({ mean: -0.5, std: 0.125 });
    expect(s.magnitude).toBeUndefined();
  });

  it('CONTRAST: a bounded target with NO baseline at all keeps ±0.5 (nothing to size against)', () => {
    const noBase: MagnitudeNode = { ...churnEstimated, observed_state: { unit: 'percent per month' } };
    const s = sizeLink({ direction: 'negative', ...NULL_SIZE }, perceivedValue, noBase);
    expect(s.outcome).toBe('unchanged');
    expect(s.mean).toBe(-0.5);
  });

  it('CONTROL: Olumi\'s STATED estimate is still not domain-checked against Olumi\'s own baseline guess (D4 stays known-only)', () => {
    const s = sizeLink({ direction: 'negative', effect_amount: -1, effect_per_source_change: 10, user_stated: false }, perceivedValue, churnEstimated);
    expect(s.outcome).toBe('estimate');
    expect(s.mean).toBeCloseTo(-0.1, 12);
  });
});
