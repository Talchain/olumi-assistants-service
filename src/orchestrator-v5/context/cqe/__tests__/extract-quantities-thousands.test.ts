/**
 * V5 edit_graph P0 — currency + thousands-separator regression lock.
 *
 * The staging audit reported "Change annual support cost to £120,000" no-opping
 * (the comma mis-tokenised, splitting into two quantities → the deterministic
 * value-update's `ambiguous_quantity` skip). This proves that the audited symptom
 * does NOT reproduce on current code: `preNormalise.stripThousandSeparators` plus
 * the shared currency/suffix grammar (P7/P8) extract exactly ONE quantity with the
 * intended value for every listed form. No parser code change was required for this
 * lane; this file locks the behaviour against regression.
 *
 * NOTE: kept in a SEPARATE file (not cqe-fixtures.ts) so it does not perturb the
 * `FIXTURE_COUNT === 68` gate in extract-quantities.test.ts.
 */
import { describe, it, expect } from 'vitest';

import { extractQuantities } from '../extract-quantities.js';
import { preNormalise } from '../pre-normalise.js';

describe('CQE currency + thousands-separator regression (V5 edit_graph P0)', () => {
  it('preNormalise strips thousands separators inside numbers (single and multi-comma)', () => {
    expect(preNormalise('£120,000').text).toBe('£120000');
    expect(preNormalise('120,000').text).toBe('120000');
    expect(preNormalise('£1,200,000').text).toBe('£1200000');
    expect(preNormalise('£120,000.').text).toBe('£120000.');
  });

  it('the exact audited phrase extracts a SINGLE 120000 quantity (no comma split, no no-op)', () => {
    const q = extractQuantities('Change annual support cost to £120,000');
    expect(q).toHaveLength(1); // not 2 — the "000." split does not happen
    expect(q[0]!.value).toBe(120000);
    expect(q[0]!.unit).toBe('GBP');
    expect(q[0]!.operator).toBe('set');
  });

  // The value-edit phrasing the deterministic pre-route consumes: a single quantity
  // with the intended value is the gate for a `set_factor_value` dispatch.
  const VALUE_EDIT_CASES: ReadonlyArray<{ input: string; value: number; unit: string | null }> = [
    { input: 'Set Annual Support Cost to £120,000', value: 120000, unit: 'GBP' },
    { input: 'Set Annual Support Cost to 120,000', value: 120000, unit: null },
    { input: 'Set Annual Support Cost to 120k', value: 120000, unit: null },
    { input: 'Set Annual Support Cost to £1.2m', value: 1200000, unit: 'GBP' },
    { input: 'Set Annual Support Cost to £1,200,000', value: 1200000, unit: 'GBP' },
  ];

  it.each(VALUE_EDIT_CASES)('value-edit "$input" → one quantity value=$value', ({ input, value, unit }) => {
    const q = extractQuantities(input);
    expect(q).toHaveLength(1);
    expect(q[0]!.value).toBe(value);
    expect(q[0]!.unit).toBe(unit);
    expect(q[0]!.operator).toBe('set');
  });

  // Currency literals (no verb) — exactly one quantity, correct magnitude.
  const CURRENCY_LITERAL_CASES: ReadonlyArray<{ input: string; value: number }> = [
    { input: '£120,000', value: 120000 },
    { input: '£1,200,000', value: 1200000 },
    { input: '£120k', value: 120000 },
    { input: '£1.2m', value: 1200000 },
  ];

  it.each(CURRENCY_LITERAL_CASES)('currency literal "$input" → one quantity value=$value', ({ input, value }) => {
    const q = extractQuantities(input);
    expect(q).toHaveLength(1);
    expect(q[0]!.value).toBe(value);
    expect(q[0]!.unit).toBe('GBP');
  });
});
