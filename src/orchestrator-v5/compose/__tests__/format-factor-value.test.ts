import { describe, it, expect } from 'vitest';
import { formatFactorValue, formatFactorValueApprox } from '../format-factor-value.js';

describe('formatFactorValue — conservative, no raw-decimal leakage', () => {
  it('renders percentages as whole numbers; skips sub-1 and >100', () => {
    expect(formatFactorValue(30, '%')).toEqual({ display: '30%', value: 30 });
    expect(formatFactorValue(30, 'percent')).toEqual({ display: '30%', value: 30 });
    expect(formatFactorValue(0.7, '%')).toBeNull(); // would be "0.7%" — ambiguous
    expect(formatFactorValue(150, '%')).toBeNull();
  });

  it('renders currency with a symbol and thousands separator; skips sub-1', () => {
    expect(formatFactorValue(50000, '£')).toEqual({ display: '£50,000', value: 50000 });
    expect(formatFactorValue(50000, 'GBP')).toEqual({ display: '£50,000', value: 50000 });
    expect(formatFactorValue(0.5, '$')).toBeNull();
  });

  it('renders time units with singular/plural; skips sub-1', () => {
    expect(formatFactorValue(12, 'months')).toEqual({ display: '12 months', value: 12 });
    expect(formatFactorValue(1, 'months')).toEqual({ display: '1 month', value: 1 });
    expect(formatFactorValue(0.5, 'months')).toBeNull();
  });

  it('renders other explicit units; skips sub-1', () => {
    expect(formatFactorValue(20, 'engineers')).toEqual({ display: '20 engineers', value: 20 });
    expect(formatFactorValue(1, 'engineers')).toEqual({ display: '1 engineer', value: 1 });
    expect(formatFactorValue(0.6, 'engineers')).toBeNull();
  });

  it('renders plain unitless integers; SKIPS bare decimals (no raw normalised decimal)', () => {
    expect(formatFactorValue(30)).toEqual({ display: '30', value: 30 });
    expect(formatFactorValue(0.62)).toBeNull();
    expect(formatFactorValue(0.62, '')).toBeNull();
    expect(formatFactorValue(0.62, null)).toBeNull();
  });

  it('skips non-finite values', () => {
    expect(formatFactorValue(Number.NaN, '%')).toBeNull();
    expect(formatFactorValue(Number.POSITIVE_INFINITY, '£')).toBeNull();
  });

  it('skips non-integer values rather than rounding them (exact-only guardrail)', () => {
    expect(formatFactorValue(30.5, '%')).toBeNull();
    expect(formatFactorValue(49999.5, '£')).toBeNull();
    expect(formatFactorValue(20.5, 'engineers')).toBeNull();
    expect(formatFactorValue(11.5, 'months')).toBeNull();
    expect(formatFactorValue(30.7)).toBeNull();
  });

  it('never emits a string containing a raw 0.xx decimal', () => {
    for (const [v, u] of [[30, '%'], [50000, '£'], [12, 'months'], [20, 'engineers'], [30, null]] as const) {
      const out = formatFactorValue(v, u);
      if (out) expect(out.display).not.toMatch(/\d\.\d/);
    }
  });

  it('humanises underscored machine units (story_points → story points)', () => {
    expect(formatFactorValue(6, 'story_points')).toEqual({ display: '6 story points', value: 6 });
    expect(formatFactorValue(1, 'story_points')).toEqual({ display: '1 story point', value: 1 });
  });
});

describe('formatFactorValueApprox — readable display-scale rounding', () => {
  it('rounds to one decimal place and flags approximation (6.055 → 6.1)', () => {
    expect(formatFactorValueApprox(6.055000000000001, 'story_points')).toEqual({
      display: '6.1 story points',
      rounded: 6.1,
      approximate: true,
    });
  });

  it('reports approximate=false when no rounding occurs (display === exact)', () => {
    expect(formatFactorValueApprox(6, 'story_points')).toEqual({
      display: '6 story points',
      rounded: 6,
      approximate: false,
    });
    expect(formatFactorValueApprox(6.1, 'story_points')).toEqual({
      display: '6.1 story points',
      rounded: 6.1,
      approximate: false,
    });
  });

  it('singularises at exactly 1', () => {
    expect(formatFactorValueApprox(1, 'story_points')?.display).toBe('1 story point');
  });

  it('keeps unit faithfulness: percent guarded to 0–100, currency + time supported', () => {
    expect(formatFactorValueApprox(12.567, '%')?.display).toBe('12.6%');
    expect(formatFactorValueApprox(150, '%')).toBeNull();
    expect(formatFactorValueApprox(20000.5, '£')?.display).toBe('£20,000.5');
    expect(formatFactorValueApprox(2.5, 'weeks')?.display).toBe('2.5 weeks');
  });

  it('skips unsafe shapes: non-finite, rounds-to-zero, and bare unitless fractions', () => {
    expect(formatFactorValueApprox(Number.NaN, 'story_points')).toBeNull();
    expect(formatFactorValueApprox(0.04, 'story_points')).toBeNull(); // rounds to 0
    expect(formatFactorValueApprox(6.055, null)).toBeNull(); // bare decimal, no unit
    expect(formatFactorValueApprox(6, null)).toEqual({ display: '6', rounded: 6, approximate: false });
  });
});
