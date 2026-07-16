/**
 * DGAI #342(2) — a factor drafted with no observed_state got
 * `display_value: "0 to 1"` synthesised from its DEFAULT prior range, and the
 * UI rendered "Range: 0 to 1" as the factor's VALUE line (raw internals next
 * to sibling cards saying "Very low" / "No dilution").
 *
 * The full normalised domain is not an estimate — presenting it as a value is
 * dishonest. `synthesiseRangeDisplayValue` must return `undefined` (callers
 * omit the field; the honest "no value set yet" state) when the range is the
 * whole normalised domain:
 *   - unitless 0..1 ("0 to 1"), and the one-sided "Up to 1" / "At least 0";
 *   - percentage 0..1 and 0..100 ("0% to 100%"), and their one-sided forms.
 * Real estimates (currency, time, partial ranges inside the domain) keep
 * rendering exactly as before.
 */

import { describe, expect, it } from 'vitest';

import { synthesiseRangeDisplayValue } from '../../src/cee/factor-extraction/display-value.js';

describe('DGAI #342(2) — full-domain prior ranges must not masquerade as values', () => {
  it('unitless 0..1 (the live "Range: 0 to 1" case) returns undefined', () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 }),
    ).toBeUndefined();
  });

  it('unitless one-sided domain bounds return undefined', () => {
    expect(synthesiseRangeDisplayValue({ range_max: 1 })).toBeUndefined();
    expect(synthesiseRangeDisplayValue({ range_min: 0 })).toBeUndefined();
  });

  it('percentage full domain (normalised 0..1 and display 0..100) returns undefined', () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 }, '%'),
    ).toBeUndefined();
    expect(
      synthesiseRangeDisplayValue({ range_min: 0, range_max: 100 }, '%'),
    ).toBeUndefined();
    expect(synthesiseRangeDisplayValue({ range_max: 100 }, '%')).toBeUndefined();
  });

  it('keeps genuine ranges: informative sub-domain and unit-bearing bounds', () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0.1, range_max: 0.25 }, '%'),
    ).toBe('10% to 25%');
    expect(
      synthesiseRangeDisplayValue({ range_min: 200000, range_max: 500000 }, '£'),
    ).toBe('£200k to £500k');
    // A 0..1 range WITH a real-world unit is a genuine quantity, not the
    // normalised domain.
    expect(
      synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 }, 'days'),
    ).toBe('0 to 1 days');
    expect(synthesiseRangeDisplayValue({ range_max: 500000 }, '£')).toBe(
      'Up to £500k',
    );
  });
});
