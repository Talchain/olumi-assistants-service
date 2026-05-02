/**
 * V5 D1 golden-path closure (A3.1 Task 4) — strict rejection of
 * `raw_value` in proposal parameters.
 *
 * Pre-fix `StructuredValueSchema` declared `raw_value` as an optional
 * field but `parseProposalValue` ignored it. A proposal carrying
 * `{ value: 5, raw_value: 0.05 }` silently used the model-unit value
 * (5) and dropped raw_value — a footgun for any future caller that
 * intended raw_value to be authoritative.
 *
 * Post-fix the schema removes `raw_value`. With `.strict()` already
 * enforced, Zod now rejects unknown keys explicitly.
 */

import { describe, it, expect } from 'vitest';

import { SetFactorValueValueSchema } from '../set-factor-value.js';

describe('A3.1 Task 4 — SetFactorValueValueSchema rejects raw_value', () => {
  it('structured value with raw_value → Zod failure with "unrecognized" message', () => {
    const result = SetFactorValueValueSchema.safeParse({
      value: 5,
      raw_value: 0.05,
      unit: '%',
      cap: 100,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = result.error.issues;
    expect(issues.length).toBeGreaterThan(0);
    // Zod reports unknown-key strictness as `unrecognized_keys`.
    expect(
      issues.some((iss) => iss.code === 'unrecognized_keys'),
    ).toBe(true);
  });

  it('structured value WITHOUT raw_value → still accepted', () => {
    const result = SetFactorValueValueSchema.safeParse({
      value: 5,
      unit: '%',
      cap: 100,
    });
    expect(result.success).toBe(true);
  });

  it('primitive number → still accepted (bare-number proposal path)', () => {
    expect(SetFactorValueValueSchema.safeParse(0.5).success).toBe(true);
    expect(SetFactorValueValueSchema.safeParse(50000).success).toBe(true);
  });

  it('structured value with unit only → accepted', () => {
    const result = SetFactorValueValueSchema.safeParse({
      value: 50000,
      unit: '£',
    });
    expect(result.success).toBe(true);
  });
});
