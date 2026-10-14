import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  inverseStandardNormal,
  statedRangeSpread,
  unitIntervalNormalFitApplies,
} from '../stated-range-spread.js';

describe('statedRangeSpread', () => {
  it('PARITY: unprompted [80, 250] matches ISL range_fit_disclosures mu/sigma', () => {
    const fit = statedRangeSpread(80, 250, 0.5);
    expect(fit).toMatchObject({ ok: true, mean: 165, coverage: 0.5 });
    if (!fit.ok) throw new Error(fit.refusal);
    // External oracle: scipy.stats.norm.ppf(0.75), not a width constant from CEE.
    expect(Math.abs(fit.std - 170 / (2 * 0.6744897501960817))).toBeLessThan(1e-6);
  });

  it('uses 90% coverage for the explicitly elicited surprise range', () => {
    const fit = statedRangeSpread(80, 250, 0.9);
    expect(fit).toMatchObject({ ok: true, mean: 165, coverage: 0.9 });
    if (!fit.ok) throw new Error(fit.refusal);
    expect(Math.abs(fit.std - 170 / (2 * 1.6448536269514722))).toBeLessThan(1e-6);
  });

  it('MUTANT-DISCRIMINATING: the middle half cannot use the 90% width divisor', () => {
    const fit = statedRangeSpread(80, 250, 0.5);
    if (!fit.ok) throw new Error(fit.refusal);
    expect(Math.abs(fit.std - 170 / 3.29)).toBeGreaterThanOrEqual(1e-3);
  });

  it.each([
    ['null low', null, 250, 'unbounded', 'RANGE_OPEN_ENDED'],
    ['undefined low', undefined, 250, 'unbounded', 'RANGE_OPEN_ENDED'],
    ['null high', 80, null, 'unbounded', 'RANGE_OPEN_ENDED'],
    ['undefined high', 80, undefined, 'unbounded', 'RANGE_OPEN_ENDED'],
    ['NaN', NaN, 250, 'unbounded', 'RANGE_NON_FINITE'],
    ['infinite high', 80, Infinity, 'unbounded', 'RANGE_NON_FINITE'],
    ['infinite low', -Infinity, 250, 'unbounded', 'RANGE_NON_FINITE'],
    ['inverted bounds', 250, 80, 'unbounded', 'RANGE_INVALID_ORDER'],
    ['equal bounds', 80, 80, 'unbounded', 'RANGE_ZERO_WIDTH'],
    ['below unit interval', -0.1, 0.5, 'unit_interval', 'RANGE_OUT_OF_DOMAIN'],
    ['above unit interval', 0.2, 1.2, 'unit_interval', 'RANGE_OUT_OF_DOMAIN'],
    ['open before non-finite', null, Infinity, 'unit_interval', 'RANGE_OPEN_ENDED'],
    ['non-finite before order/domain', Infinity, -0.1, 'unit_interval', 'RANGE_NON_FINITE'],
    ['order before domain', 1.2, -0.1, 'unit_interval', 'RANGE_INVALID_ORDER'],
    ['zero width before domain', -0.1, -0.1, 'unit_interval', 'RANGE_ZERO_WIDTH'],
  ] as const)('refuses %s in ISL order', (_name, low, high, domain, refusal) => {
    expect(statedRangeSpread(low, high, 0.5, domain)).toEqual({ ok: false, refusal });
  });

  it('refuses a non-finite derived spread', () => {
    expect(statedRangeSpread(-Number.MAX_VALUE, Number.MAX_VALUE, 0.5))
      .toEqual({ ok: false, refusal: 'RANGE_NON_FINITE' });
  });

  it('refuses an underflowed zero spread', () => {
    expect(statedRangeSpread(0, Number.MIN_VALUE, 0.9))
      .toEqual({ ok: false, refusal: 'RANGE_NON_FINITE' });
  });

  it('refuses a non-finite derived mean', () => {
    expect(statedRangeSpread(Number.MAX_VALUE / 2, Number.MAX_VALUE, 0.5))
      .toEqual({ ok: false, refusal: 'RANGE_NON_FINITE' });
  });

  it('admits finite negative bounds in the default unbounded domain', () => {
    expect(statedRangeSpread(-0.1, 0.5, 0.5)).toMatchObject({ ok: true, mean: 0.2 });
  });

  it.each([
    [0.30, 0.40, true],
    [0.02, 0.10, false],
  ])('records [%s, %s] and applies its normal fit only when leakage permits', (low, high, applies) => {
    const fit = statedRangeSpread(low, high, 0.5, 'unit_interval');
    expect(fit.ok).toBe(true);
    if (!fit.ok) throw new Error(fit.refusal);
    expect(unitIntervalNormalFitApplies(fit.mean, fit.std)).toBe(applies);
  });

  it('SOURCE-LITERAL: has no rounded quantile or fixed width divisor', () => {
    const source = readFileSync(new URL('../stated-range-spread.ts', import.meta.url), 'utf8');
    for (const literal of ['1.349', '0.6745', '3.29', '1.645']) expect(source).not.toContain(literal);
  });
});

describe('inverseStandardNormal', () => {
  it('returns exactly zero at the median', () => {
    expect(inverseStandardNormal(0.5)).toBe(0);
  });

  // External scipy.stats.norm.ppf oracles span the centre and both tails.
  it.each([
    [1e-10, -6.361340902404056],
    [1e-9, -5.9978070150076865],
    [1e-6, -4.753424308822899],
    [0.001, -3.090232306167813],
    [0.025, -1.959963984540054],
    [0.75, 0.6744897501960817],
    [0.975, 1.959963984540054],
    [0.999, 3.090232306167813],
    [1 - 1e-10, 6.361340889697422],
  ])('matches the external quantile at p=%s within 1e-9', (p, expected) => {
    expect(Math.abs(inverseStandardNormal(p) - expected)).toBeLessThan(1e-9);
  });

  it.each([2 ** -32, 2 ** -24, 0.015625, 0.125, 0.25, 0.375])('is symmetric at p=%s', (p) => {
    // Dyadic inputs keep p and 1-p exactly complementary, including in the tails.
    expect(Math.abs(inverseStandardNormal(p) + inverseStandardNormal(1 - p))).toBeLessThan(1e-9);
  });

  it.each([0, 1, -0.1, 1.1, NaN, -Infinity, Infinity])('rejects p=%s with RangeError', (p) => {
    expect(() => inverseStandardNormal(p)).toThrow(RangeError);
  });
});

describe('unitIntervalNormalFitApplies', () => {
  it('uses both tails at the 2.5% boundary', () => {
    // External scipy.stats.norm.ppf(0.9875): each tail contributes 1.25%.
    const z = 2.241402727604947;
    expect(unitIntervalNormalFitApplies(0.5, 0.5 / (z + 1e-8))).toBe(true);
    expect(unitIntervalNormalFitApplies(0.5, 0.5 / (z - 1e-8))).toBe(false);
  });

  it('handles a single dominant tail on either side', () => {
    const z = 1.959963984540054;
    for (const mean of [0.1, 0.9]) {
      expect(unitIntervalNormalFitApplies(mean, 0.1 / (z + 1e-8))).toBe(true);
      expect(unitIntervalNormalFitApplies(mean, 0.1 / (z - 1e-8))).toBe(false);
    }
  });

  it('keeps a very narrow fit inside the interval when standardised bounds overflow', () => {
    expect(unitIntervalNormalFitApplies(0.5, Number.MIN_VALUE)).toBe(true);
    expect(unitIntervalNormalFitApplies(0, Number.MIN_VALUE)).toBe(false);
  });

  it.each([
    [NaN, 0.1], [Infinity, 0.1], [0.5, NaN], [0.5, Infinity], [0.5, 0], [0.5, -0.1],
  ])('does not apply an invalid fit (mean=%s, std=%s)', (mean, std) => {
    expect(unitIntervalNormalFitApplies(mean, std)).toBe(false);
  });
});
