/**
 * `goalUnitReading` (0.67.0 `unit_reading`): who read the goal's unit, quoting the brief's own sentence. AIQ 5914471584:
 * no Olumi reading ever travels as `user_stated`.
 */
import { describe, expect, it } from 'vitest';
import { goalUnitReading } from '../goal-unit-reading.js';

const MRR = 'Should we raise our Pro plan price from £49 to £59 a month? We have 1,500 paying subscribers and £75k MRR. Monthly churn must stay below 5%, and we want MRR above £85k within a year.';

describe('goalUnitReading', () => {
  it('user_stated ONLY when the brief writes the goal\'s own target in that currency (£85k), quoting its sentence', () => {
    expect(goalUnitReading({ unit: 'GBP/month', value: 85000, target_stated: true }, MRR, true)).toEqual({
      unit: 'GBP', source: 'user_stated', source_quote: 'Monthly churn must stay below 5%, and we want MRR above £85k within a year',
    });
    expect(goalUnitReading({ unit: '£k', value: 85, target_stated: true }, MRR, true)?.source).toBe('user_stated');
  });

  it('RED (AIQ): a target Olumi supplied, or one the brief never writes, is Olumi\'s reading — never user_stated', () => {
    expect(goalUnitReading({ unit: 'GBP/month', value: 85000, target_stated: false }, MRR)?.source).toBe('olumi_reading');
    expect(goalUnitReading({ unit: 'GBP/month', value: 90000, target_stated: true }, MRR, true)?.source).toBe('olumi_reading');
    // P0 PARTNER CR on #2381: the brief writes £85k, but the node does NOT hold the target as the user's → Olumi's reading.
    expect(goalUnitReading({ unit: 'GBP/month', value: 85000, target_stated: true }, MRR, false)?.source).toBe('olumi_reading');
    expect(goalUnitReading({ unit: 'GBP/month', value: 85000, target_stated: true }, MRR)?.source).toBe('olumi_reading');
  });

  it('nothing when the unit is not money, when the brief writes no amount in that currency, or when there is no unit', () => {
    expect(goalUnitReading({ unit: 'hours/week', value: 30, target_stated: true }, 'We spend 30 hours a week.')).toBeUndefined();
    expect(goalUnitReading({ unit: 'EUR', value: null, target_stated: false }, MRR)).toBeUndefined();
    expect(goalUnitReading({ unit: '', value: null }, MRR)).toBeUndefined();
    expect(goalUnitReading(null, MRR)).toBeUndefined();
  });
});
