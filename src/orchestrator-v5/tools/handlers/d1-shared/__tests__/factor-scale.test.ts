/**
 * ROADMAP 2.159 — the scale derivation itself.
 *
 * The derivation is the whole fix: there is no scale field anywhere (CEE's
 * `ObservedStateV3`, the boundary `observed_state` in `@talchain/schemas@0.30.0`,
 * and the `.strict()` `factor_value_edit` wire event all lack one), so the bound
 * is derived from already-declared state. These tests pin BOTH directions:
 * what it classifies as normalised, and — at least as important — every case
 * where it must fail toward `unbounded` so nothing that works today is newly
 * refused.
 */
import { describe, it, expect } from 'vitest';

import { resolveFactorScale } from '../factor-scale.js';

describe('resolveFactorScale — normalised (the class the live 1.5 defect hit)', () => {
  it('classifies an uncapped, unitless factor sitting inside [0,1] as the unit interval', () => {
    expect(resolveFactorScale({ value: 0.65 })).toEqual({ kind: 'unit_interval' });
  });

  it('classifies the boundary values 0 and 1 as the unit interval', () => {
    expect(resolveFactorScale({ value: 0 })).toEqual({ kind: 'unit_interval' });
    expect(resolveFactorScale({ value: 1 })).toEqual({ kind: 'unit_interval' });
  });

  it('classifies a binary/one-hot indicator (value 0 or 1, raw_value mirroring it)', () => {
    expect(resolveFactorScale({ value: 1, raw_value: 1 })).toEqual({ kind: 'unit_interval' });
  });

  it('classifies the inferred neutral midpoint (prompt EXTRACTION_RULES: value 0.5)', () => {
    expect(resolveFactorScale({ value: 0.5 })).toEqual({ kind: 'unit_interval' });
  });
});

describe('resolveFactorScale — capped (unchanged; the existing cap-range guard owns it)', () => {
  it('a cap IS the scale declaration', () => {
    expect(resolveFactorScale({ value: 0.4, raw_value: 40000, unit: '£', cap: 100000 })).toEqual({
      kind: 'capped',
      cap: 100000,
    });
  });

  it('a cap wins even when the factor would otherwise read as normalised', () => {
    expect(resolveFactorScale({ value: 0.65, cap: 1 })).toEqual({ kind: 'capped', cap: 1 });
  });

  it('a non-positive cap stays `capped` so `cap_non_positive` remains the rejection the user sees', () => {
    expect(resolveFactorScale({ value: 0.5, cap: 0 })).toEqual({ kind: 'capped', cap: 0 });
  });
});

describe('resolveFactorScale — fails toward `unbounded` (nothing working today is newly refused)', () => {
  it('a unit-bearing uncapped factor is a raw user-unit magnitude, never a proportion', () => {
    expect(resolveFactorScale({ value: 12, unit: 'months' })).toEqual({ kind: 'unbounded' });
  });

  it('LEAVES THE %-UNIT CASE ALONE — a bounded percentage and an NRR-style ratio are indistinguishable', () => {
    // `prompts/defaults-v187.ts:402-411`: ratios that can exceed 100% (NRR,
    // growth, ROI) are explicitly NOT normalised. A `%` factor at 0.9 could be
    // either. Guessing here would refuse legitimate NRR edits.
    expect(resolveFactorScale({ value: 0.9, unit: '%' })).toEqual({ kind: 'unbounded' });
    expect(resolveFactorScale({ value: 1.1, unit: '%' })).toEqual({ kind: 'unbounded' });
  });

  it('LEAVES SMALL COUNTS ALONE — an uncapped unitless factor already outside [0,1]', () => {
    // `prompts/defaults-v187.ts:301`: "Small count (0-10) | raw integer | same".
    expect(resolveFactorScale({ value: 3, raw_value: 3 })).toEqual({ kind: 'unbounded' });
  });

  it('refuses to guess when raw_value and value disagree on an uncapped factor', () => {
    // Uncapped stores them identically; a disagreeing pair is off-contract and
    // its scale provenance is unknown.
    expect(resolveFactorScale({ value: 0.5, raw_value: 50000 })).toEqual({ kind: 'unbounded' });
  });

  it('is inert when the factor carries no value at all', () => {
    expect(resolveFactorScale({})).toEqual({ kind: 'unbounded' });
  });

  it('is inert for an off-contract value already outside [0,1]', () => {
    expect(resolveFactorScale({ value: 1.5 })).toEqual({ kind: 'unbounded' });
    expect(resolveFactorScale({ value: -0.2 })).toEqual({ kind: 'unbounded' });
  });

  it('is inert for a non-finite stored value', () => {
    expect(resolveFactorScale({ value: Number.NaN })).toEqual({ kind: 'unbounded' });
  });

  it('treats an empty-string unit as no unit (so it can still be classified)', () => {
    expect(resolveFactorScale({ value: 0.65, unit: '' })).toEqual({ kind: 'unit_interval' });
  });
});
