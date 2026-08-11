/**
 * BYTE-EQUALITY OF THE THREE THOUSANDS-GROUPING COPIES, SETTLED BY EXECUTION.
 *
 * `\B(?=(\d{3})+(?!\d))` was spelled in three modules: `format-factor-value.ts`
 * (`thousands`), `unified-pipeline/stages/repair/unreachable-factors.ts`
 * (`formatStatedMagnitude`) and `orchestrator-v5/label-value-divergence.ts`
 * (`withThousands`). Two of them now IMPORT the first. That collapse is only
 * legitimate if the outputs are identical, and "identical" is a claim that must
 * be MEASURED, never inspected (CLAUDE.md: every byte-equal claim is settled by
 * execution).
 *
 * So this spec keeps the two OLD INLINE FORMS, verbatim, and runs them beside
 * the imported one over a corpus plus a deterministic sweep. If a future edit to
 * `thousands` changes what either caller emits, this REDs by name.
 *
 * ⚠ IT PINS THE CALLERS' WHOLE EXPRESSION, NOT JUST THE REGEX. The callers do
 * NOT simply group a number: `unreachable-factors` rounds to two decimals and
 * splits at the point first, `label-value-divergence` guards exponent notation
 * and re-attaches the fraction. Those are each caller's OWN rules and stay
 * local; only the grouping is shared. Comparing the regex alone would have
 * proven the wrong thing.
 */

import { describe, it, expect } from 'vitest';

import { thousands } from '../format-factor-value.js';
import { formatStatedMagnitude } from '../../../cee/unified-pipeline/stages/repair/unreachable-factors.js';
import { detectLabelValueDivergences } from '../../label-value-divergence.js';

/** The regex exactly as all three modules spelled it before the collapse. */
const GROUP_RE = /\B(?=(\d{3})+(?!\d))/g;

/** `unreachable-factors.ts:255-261`, verbatim as it stood at bdcba160. */
function unreachableOldGrouping(rawValue: number): string {
  const negative = rawValue < 0;
  const abs = Math.abs(rawValue);
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace(/\.?0+$/, '');
  const [whole, fraction] = fixed.split('.');
  const grouped = (whole ?? '0').replace(GROUP_RE, ',');
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** The same expression, routed through the shared formatter. */
function unreachableNewGrouping(rawValue: number): string {
  const negative = rawValue < 0;
  const abs = Math.abs(rawValue);
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace(/\.?0+$/, '');
  const [whole, fraction] = fixed.split('.');
  const grouped = thousands(Number(whole ?? '0'));
  return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** `label-value-divergence.ts:290-295`, verbatim as it stood at bdcba160. */
function withThousandsOld(value: number): string {
  const asString = Math.abs(value).toString();
  if (asString.includes('e') || asString.includes('E')) return String(value);
  const [intPart, fracPart] = asString.split('.');
  const grouped = (intPart ?? '0').replace(GROUP_RE, ',');
  return `${value < 0 ? '-' : ''}${grouped}${fracPart !== undefined ? `.${fracPart}` : ''}`;
}

/** The same expression, routed through the shared formatter. */
function withThousandsNew(value: number): string {
  const asString = Math.abs(value).toString();
  if (asString.includes('e') || asString.includes('E')) return String(value);
  const [intPart, fracPart] = asString.split('.');
  const grouped = thousands(Number(intPart ?? '0'));
  return `${value < 0 ? '-' : ''}${grouped}${fracPart !== undefined ? `.${fracPart}` : ''}`;
}

/** Integers, negatives, decimals, zero, and the large/exponent boundaries. */
const CORPUS: readonly number[] = [
  0, -0, 1, -1, 9, 12, 99, 100, 999, 1000, -1000, 1234, 12345, 123456, 1234567,
  999999, 1000000, 1.5e6, 12345678, 999999999, 1e9, 1234567890123,
  0.1, 0.35, 0.5, 1.5, 2.25, 3.14159, 1234.5, 1234.56, 1234.567, 12345.678,
  -0.35, -1.5, -1234.56, -1234567.891, 0.001, 0.0001, 0.000001, 0.0000001,
  1e20, 1e21, -1e21, 1e-7,
  Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER,
  // Written as an expression, not a literal: the literal form is unrepresentable
  // and `no-loss-of-precision` rejects it (caught by `pnpm lint`, which the
  // required check runs BEFORE the tests — trap 22e).
  Number.MAX_SAFE_INTEGER + 2,
  // The magnitudes this estate actually renders.
  78, 0.78, 0.92, 5000, 18000, 50000, 250000, 320000, 1500000, 11200000,
];

/** Deterministic sweep across the decades both callers see. */
function sweep(): number[] {
  const out: number[] = [];
  for (let decade = -3; decade <= 12; decade++) {
    const mag = Math.pow(10, decade);
    for (let k = 1; k <= 40; k++) {
      out.push(mag * k * 1.0009, -mag * k * 1.0009, mag * k, -mag * k);
    }
  }
  return out;
}

describe('thousands() — the shared grouping is byte-equal at both call sites', () => {
  it('unreachable-factors: old inline form === imported form, over the corpus', () => {
    for (const v of CORPUS) {
      expect(unreachableNewGrouping(v), `diverged at ${v}`).toBe(unreachableOldGrouping(v));
    }
  });

  it('label-value-divergence: old inline form === imported form, over the corpus', () => {
    for (const v of CORPUS) {
      expect(withThousandsNew(v), `diverged at ${v}`).toBe(withThousandsOld(v));
    }
  });

  it('both call sites agree across a deterministic decade sweep', () => {
    const values = sweep();
    expect(values.length, 'the sweep generated nothing — this proves nothing').toBeGreaterThan(2000);
    for (const v of values) {
      expect(unreachableNewGrouping(v), `unreachable-factors diverged at ${v}`).toBe(
        unreachableOldGrouping(v),
      );
      expect(withThousandsNew(v), `label-value-divergence diverged at ${v}`).toBe(
        withThousandsOld(v),
      );
    }
  });

  it('POSITIVE CONTROL: the corpus really exercises grouping', () => {
    // Trap 13b: without this, two formatters that both returned '' would agree
    // perfectly on every case above.
    const grouped = CORPUS.filter((v) => unreachableOldGrouping(v).includes(','));
    expect(grouped.length, 'no corpus member is grouped — the parity check is vacuous').toBeGreaterThan(10);
  });

  it('the LIVE callers still emit the grouped strings they emitted before', () => {
    // Bound to the exported behaviour, not to the private copies above, so a
    // change inside either caller is caught even if the copies stay in step.
    expect(formatStatedMagnitude(1500000, 0.6, '£')).toBe('£1,500,000');
    // ⚠ `£-1,234,567.89`, not `-£1,234,567.89`. That sign placement is
    // PRE-EXISTING and untouched by the grouping collapse — the sign is applied
    // to the digit string and the symbol is then prefixed to the whole thing.
    // Recorded as the measured value rather than the one a reader expects, and
    // NOT "fixed" here: changing it is a user-visible copy change with its own
    // corpus obligations, outside this pass.
    expect(formatStatedMagnitude(-1234567.891, 0.5, '£')).toBe('£-1,234,567.89');
    expect(formatStatedMagnitude(1234567.891, 0.5, '$')).toBe('$1,234,567.89');
    expect(formatStatedMagnitude(12500, 0.125, '%')).toBe('12,500%');
    // A PLAIN unit is refused outright by this formatter's own dimensioned
    // gate — the discriminating half, so "it grouped" is not read off a
    // formatter that returns a string for everything.
    expect(formatStatedMagnitude(250000, 0.25, 'users')).toBeNull();

    // `label-value-divergence`'s formatter is module-private, so it is driven
    // through its ONE public path rather than opened up with a test-only
    // export: on LEG 2 the old label carries no quantity, so `oldValueToken`
    // IS the node's rendered modelled magnitude.
    const node = (label: string) => ({
      nodes: [
        {
          id: 'fac_budget',
          kind: 'factor',
          label,
          observed_state: { value: 0.5, raw_value: 1234567, cap: 2000000, unit: '£' },
        },
      ],
      edges: [],
      options: [],
      goal_node_id: null,
    });
    const divs = detectLabelValueDivergences(
      [
        {
          op: 'update_node',
          path: 'fac_budget',
          value: { label: 'Budget of £999,000' },
          old_value: { label: 'Budget' },
        },
      ],
      node('Budget'),
      node('Budget of £999,000'),
    );
    expect(divs, 'the divergence fixture produced nothing — this assertion is vacuous').toHaveLength(1);
    expect(divs[0]!.oldValueToken).toBe('£1,234,567');
  });
});
