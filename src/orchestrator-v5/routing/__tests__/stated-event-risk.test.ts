/** event_risk.v1 slice 2a. */
import { describe, it, expect } from 'vitest';
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';
import { readStatedEventRisk } from '../stated-event-risk.js';

describe('event_risk.v1 slice 2a — stated occurrence', () => {
  it.each([
    ['range', 'key developer might leave, maybe 10–30% in the next 6 months', 0.1, 0.3, 6],
    ['single', 'about 20% within a year', 0.2, 0.2, 12],
    ['between-percent', 'between 5 and 15 percent over the next 18 months', 0.05, 0.15, 18],
    ['hyphen', '10-30% within 12 months', 0.1, 0.3, 12],
    ['to', '10 to 30% within 2 years', 0.1, 0.3, 24],
    ['both-percent', '10% to 30% within 2 years', 0.1, 0.3, 24],
    ['weeks', '20% within 6 weeks', 0.2, 0.2, 1.4],
    ['week-minimum', '20% within 0.1 weeks', 0.2, 0.2, 0.1],
    ['zero', '0% within a year', 0, 0, 12],
    ['hundred', '100% in the next month', 1, 1, 1],
    ['decimal', '12.5% within 6 months', 0.125, 0.125, 6],
  ])('2a-positive-%s', (_id, text, low, high, months) => {
    const result = readStatedEventRisk(text)!;
    expect(result.event_risk).toEqual({ version: 1, occurrence: { p_low: low, p_high: high, basis: 'user', meaning: 'at_least_once_within_horizon' }, horizon: { months } });
    expect(text).toContain(result.quote);
  });
  it.each([
    ['no-number', 'maybe the developer leaves within 6 months'],
    ['no-horizon', 'about 20%'],
    ['calendar', '20% this year'],
    ['two-ranges', '10–30% or 20–40% within 6 months'],
    ['two-points', '20% or 30% within 6 months'],
    ['two-horizons', '20% within 6 months or within a year'],
    ['descending', '40–20% within 6 months'],
    ['over-hundred', '150% within 6 months'],
    ['negative', '-10% within 6 months'],
    ['negative-range', '-10–20% within 6 months'],
    ['past', '20% over the last 6 months'],
    ['zero-horizon', '20% within 0 months'],
    ['missing-duration', '20% within months'],
    ['huge-figure', '99999999999920% within 6 months'],
  ])('2a-refuse-%s', (_id, text) => expect(readStatedEventRisk(text)).toBeUndefined());

  it.each([
    ['digits', (n: number) => '9'.repeat(n)],
    ['spaces', (n: number) => `between ${' '.repeat(n)}10% within 6 months`],
    ['near-matches', (n: number) => '10- within '.repeat(Math.ceil(n / 10)).slice(0, n)],
  // Calibrated batches (scalingRatio): single-call min-of-5 read 8.18× on CI for near-matches (7 Oct).
  ])('2a-LINEAR TIME-%s: 5k to 40k, min of 7 calibrated batches, ratio < 22', (_id, make) => {
    const [small, large] = [make(5000), make(40000)];
    const m = scalingRatio(() => readStatedEventRisk(small), () => readStatedEventRisk(large));
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
    expect(m.ratio, m.detail).toBeLessThan(22);
  });
});
