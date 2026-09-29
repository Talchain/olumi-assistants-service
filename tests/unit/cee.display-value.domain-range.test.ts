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
 *
 * ⚠⚠ THE LAST SENTENCE WAS TRUE OF PARTIAL RANGES AND FALSE OF THE UNIT-BEARING
 * DOMAIN, AND THIS FILE PINNED THE FALSE HALF. Corrected in place, with the
 * reason, rather than quietly re-expected — a changed expectation in a spec
 * someone else wrote is a claim, and it has to carry its evidence.
 *
 * The case that moved is `{0, 1}` under unit `days`, asserted here as
 * `'0 to 1 days'` on the stated ground that *"a 0..1 range WITH a real-world
 * unit is a genuine quantity, not the normalised domain."*
 *
 *   • `{range_min: 0.0, range_max: 1.0}` is THE DEFAULT PRIOR. It is the
 *     literal EXTERNAL-node example at `Prompts/canonical/draft_graph.txt:469`
 *     and the "unknown / no qualifier" row of the anchoring table at `:478`.
 *     So this case is the no-information prior with a unit glued on — the very
 *     thing DGAI #342(2) exists to stop, escaping #342(2)'s own guard purely
 *     because `isDomainScale` is `!unit || unit === "%"`.
 *   • Row 2.1207 already closed that escape for CURRENCY at a banked capture.
 *   • It is now closed for TIME, at the product owner's session of 19 Sep 2026
 *     (`olumi-debug-73d5c152-20260919.json`, node `2e6a7049` "Cash Runway",
 *     prior `{0.45, 1}`, unit `months`, rendered "0.45 to 1 months" against a
 *     brief that said "under 18 months of runway").
 *
 * The gap door this assertion was watching is still watched — by the twin
 * directly beneath it, which pins a GENUINE duration range rendering
 * unchanged. Suppression is scoped to bounds wholly inside the normalised
 * magnitude domain; `[3, 8]` and `[0.5, 8]` days are untouched.
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
    expect(synthesiseRangeDisplayValue({ range_max: 500000 }, '£')).toBe(
      'Up to £500k',
    );
  });

  // ⚠ MOVED, NOT DELETED — see the header. `{0, 1}` IS the default prior; a
  // time unit on it does not make it an estimate.
  it('the DEFAULT prior wearing a time unit is not a value either', () => {
    expect(
      synthesiseRangeDisplayValue({ range_min: 0, range_max: 1 }, 'days'),
    ).toBeUndefined();
  });

  // THE GAP DOOR the moved assertion used to watch, watched explicitly: a real
  // duration must still render, or the fix traded a lie for a degradation.
  it('a genuine duration range still renders', () => {
    expect(synthesiseRangeDisplayValue({ range_min: 3, range_max: 8 }, 'days')).toBe(
      '3 to 8 days',
    );
    expect(synthesiseRangeDisplayValue({ range_min: 0.5, range_max: 8 }, 'days')).toBe(
      '0.5 to 8 days',
    );
  });
});
