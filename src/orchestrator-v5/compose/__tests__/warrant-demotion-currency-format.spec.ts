/**
 * P2 — raw machine numbers in prose.
 *
 * Paul's manual test caught CEE-authored chat prose reading:
 *
 *   "a limit keeping Hiring spend at or below 200000 GBP"
 *
 * Two defects, both in `formatBound` (deterministic CEE copy — NOT LLM
 * output, so this is a formatting fix and not an NL rewriter):
 *   - the ISO CODE is printed where the SYMBOL belongs
 *   - a six-figure amount is printed with no thousands separators, so the
 *     reader has to count digits to learn what their own limit is
 *
 * ⚠ THE CORPUS IS HAND-WRITTEN AND COMES FROM REAL UNIT SPELLINGS, not from
 * the module's own map (CLAUDE.md trap 12d: a guard derived from the list can
 * only prove agreement, never that the list is complete). Every currency
 * spelling below is one the drafter prompt or the extractor actually
 * produces — `defaults-v15.ts` stores `unit: "£"`, `provenance/stated-amounts
 * .ts` documents `unit: "GBP"` from `parseNumericValue`.
 */
import { describe, expect, it } from 'vitest';

import { buildWarrantDemotion } from '../warrant-demotion.js';
import type { ProposalAction } from '../../routing/types.js';

function addConstraint(value: number, unit: string | undefined, label = 'Hiring spend'): ProposalAction {
  return {
    handler_id: 'add_constraint',
    entity: { id: 'fac_hiring_spend', label },
    parameters: [
      { name: 'constraint_type', value: 'at_most' },
      { name: 'value', value, ...(unit !== undefined ? { unit } : {}) },
      ...(unit !== undefined ? [{ name: 'unit', value: unit }] : []),
    ],
  } as unknown as ProposalAction;
}

function describeOf(action: ProposalAction): string {
  const built = buildWarrantDemotion(action, []);
  if (!built.ok) throw new Error(`expected a demotion, got ${built.reason}`);
  return built.changeDescription;
}

describe('E — the witnessed sentence', () => {
  it('renders £200,000, not "200000 GBP"', () => {
    const text = describeOf(addConstraint(200000, 'GBP'));
    // The exact defect Paul saw.
    expect(text).not.toContain('200000');
    expect(text).not.toContain('GBP');
    expect(text).toContain('£200,000');
    // Bound by identity to the entity this action names.
    expect(text).toContain('Hiring spend');
  });
});

describe('E — currency spellings the producers actually emit', () => {
  it.each([
    ['GBP', 200000, '£200,000'],
    ['£', 200000, '£200,000'],
    ['gbp', 50000, '£50,000'],
    ['USD', 1250000, '$1,250,000'],
    ['$', 1250000, '$1,250,000'],
    ['EUR', 999, '€999'],
    ['€', 1000, '€1,000'],
  ])('unit %s with %d renders %s', (unit, value, expected) => {
    expect(describeOf(addConstraint(value, unit))).toContain(expected);
  });

  it('puts the sign OUTSIDE the symbol', () => {
    expect(describeOf(addConstraint(-5000, 'GBP'))).toContain('-£5,000');
  });

  it('keeps a decimal fraction intact', () => {
    expect(describeOf(addConstraint(1234.56, 'GBP'))).toContain('£1,234.56');
  });
});

describe('E — DISCRIMINATING CONTROLS: non-currency bounds are unchanged below 1,000', () => {
  it('a percentage still renders as it always did', () => {
    // The suite pins `at or below 3%`; grouping is invisible under 1,000, so
    // this must be byte-identical to the pre-fix output.
    expect(describeOf(addConstraint(3, '%'))).toContain('at or below 3%');
  });

  it('a bare number with no unit is unchanged', () => {
    expect(describeOf(addConstraint(42, undefined))).toContain('at or below 42');
  });

  it('a non-currency unit keeps its space and gains separators only above 1,000', () => {
    expect(describeOf(addConstraint(40, 'people'))).toContain('40 people');
    // …and the same readability fix applies where it matters. "200000 users"
    // is exactly as unreadable as "200000 GBP".
    expect(describeOf(addConstraint(200000, 'users'))).toContain('200,000 users');
  });

  it('a non-numeric value still degrades to "that level"', () => {
    expect(describeOf(addConstraint('not a number' as unknown as number, 'GBP'))).toContain(
      'that level',
    );
  });

  it('an UNKNOWN currency code degrades to the old rendering, never to a wrong number', () => {
    // The failure direction of a short map: a missing entry loses the symbol,
    // it does not corrupt the amount. Grouping still applies.
    const text = describeOf(addConstraint(200000, 'JPY'));
    expect(text).toContain('200,000 JPY');
  });
});
