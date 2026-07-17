/**
 * W2E-2 — finiteness enforcement on set_factor_value proposal parameters
 * (path b: LLM ORIENT tool-call output → mutation handler params).
 *
 * Factor values are contract-silent on range (any finite number is a legal
 * observation), but NaN/±Infinity must never enter the graph: they corrupt
 * PLoT/ISL analysis or crash late with an opaque error. Zod's z.number()
 * already rejects NaN; Infinity previously passed. A Zod failure here rides
 * the existing proposal-validation rejection mechanism — no clamp, no
 * silent drop.
 */

import { describe, it, expect } from 'vitest';

import { SetFactorValueValueSchema } from '../set-factor-value.js';

describe('W2E-2 — SetFactorValueValueSchema finiteness', () => {
  it('rejects a bare Infinity value', () => {
    expect(SetFactorValueValueSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });

  it('rejects a structured value with Infinity', () => {
    expect(
      SetFactorValueValueSchema.safeParse({ value: Number.NEGATIVE_INFINITY }).success,
    ).toBe(false);
  });

  it('rejects a structured value with an Infinity cap', () => {
    expect(
      SetFactorValueValueSchema.safeParse({ value: 5, cap: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  it('rejects NaN (already-enforced by z.number(), pinned here)', () => {
    expect(SetFactorValueValueSchema.safeParse(Number.NaN).success).toBe(false);
  });

  it('accepts finite values of any magnitude (contract-silent → no range invented)', () => {
    expect(SetFactorValueValueSchema.safeParse(5_000_000).success).toBe(true);
    expect(SetFactorValueValueSchema.safeParse({ value: -273.15, unit: '°C' }).success).toBe(true);
  });
});
