import { describe, expect, it } from 'vitest';

import {
  formatConstraintAdded,
  formatEdgeAdjustment,
  formatEdgeStrengthConfirmed,
  formatFactorChange,
  formatGoalTargetUnchanged,
  formatValueWithUnit,
} from '../format-confirmation.js';

const RAW_DECIMAL = /[0-9]+\.[0-9]+/;
const SPACE_BEFORE_PERCENT = /\d\s+%/;

describe('formatValueWithUnit', () => {
  it('formats percentage with no space before %', () => {
    expect(formatValueWithUnit(5, '%')).toBe('5%');
    expect(formatValueWithUnit(0.05, '%')).toBe('0.05%');
  });

  it('formats currency without space and with thousands separators', () => {
    expect(formatValueWithUnit(50000, '£')).toBe('£50,000');
    expect(formatValueWithUnit(1234567, '$')).toBe('$1,234,567');
  });

  it('formats other units with a single space', () => {
    expect(formatValueWithUnit(12, 'months')).toBe('12 months');
    expect(formatValueWithUnit(800, 'customers')).toBe('800 customers');
  });

  it('singularises a regular plural unit when the count is exactly 1', () => {
    expect(formatValueWithUnit(1, 'months')).toBe('1 month');
    expect(formatValueWithUnit(1, 'weeks')).toBe('1 week');
    expect(formatValueWithUnit(1, 'days')).toBe('1 day');
    expect(formatValueWithUnit(1, 'years')).toBe('1 year');
    expect(formatValueWithUnit(1, 'customers')).toBe('1 customer');
  });

  it('keeps the plural form for counts other than 1', () => {
    expect(formatValueWithUnit(12, 'months')).toBe('12 months');
    expect(formatValueWithUnit(0, 'months')).toBe('0 months');
    expect(formatValueWithUnit(2, 'months')).toBe('2 months');
  });

  it('leaves an already-singular unit unchanged at count 1', () => {
    expect(formatValueWithUnit(1, 'month')).toBe('1 month');
    expect(formatValueWithUnit(1, 'day')).toBe('1 day');
  });

  it('does not mangle -ss/-us/-is units or short abbreviations at count 1', () => {
    expect(formatValueWithUnit(1, 'status')).toBe('1 status');
    expect(formatValueWithUnit(1, 'bps')).toBe('1 bps');
  });

  it('does not pluralise symbol / currency units', () => {
    expect(formatValueWithUnit(1, '%')).toBe('1%');
    expect(formatValueWithUnit(1, '£')).toBe('£1');
  });

  it('singularises units inside a constraint confirmation at count 1', () => {
    const text = formatConstraintAdded({
      targetLabel: 'Timeline',
      operator: '>=',
      value: 1,
      unit: 'months',
    });
    expect(text).toBe('Added constraint: Timeline must be at least 1 month.');
  });

  it('returns the bare number when no unit is given', () => {
    expect(formatValueWithUnit(0.8)).toBe('0.8');
    expect(formatValueWithUnit(5)).toBe('5');
  });
});

describe('formatFactorChange', () => {
  it('renders before/after with units, no raw decimals leaking', () => {
    const text = formatFactorChange({
      label: 'churn',
      before: { raw_value: 4, unit: '%' },
      after: { raw_value: 5, unit: '%' },
    });
    expect(text).toBe('Updated churn from 4% to 5%.');
    expect(text).not.toMatch(SPACE_BEFORE_PERCENT);
  });

  it('renders currency change with thousands separators', () => {
    const text = formatFactorChange({
      label: 'budget',
      before: { raw_value: 40000, unit: '£' },
      after: { raw_value: 50000, unit: '£' },
    });
    expect(text).toBe('Updated budget from £40,000 to £50,000.');
  });
});

describe('formatConstraintAdded', () => {
  it('uses "at most" for <=', () => {
    const text = formatConstraintAdded({
      targetLabel: 'churn',
      operator: '<=',
      value: 5,
      unit: '%',
    });
    expect(text).toBe('Added constraint: churn must be at most 5%.');
    expect(text).not.toMatch(SPACE_BEFORE_PERCENT);
  });

  it('uses "at least" for >=', () => {
    const text = formatConstraintAdded({
      targetLabel: 'quality',
      operator: '>=',
      value: 80,
      unit: '%',
    });
    expect(text).toBe('Added constraint: quality must be at least 80%.');
  });
});

describe('formatEdgeAdjustment', () => {
  it('uses bands instead of raw decimals', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'churn',
      toLabel: 'revenue',
      beforeMean: 0.3,
      afterMean: 0.55,
    });
    expect(text).toContain('moderate');
    expect(text).toContain('strong');
    expect(text).not.toMatch(RAW_DECIMAL);
  });

  it('flags direction reversal when sign flips', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'churn',
      toLabel: 'revenue',
      beforeMean: 0.3,
      afterMean: -0.2,
    });
    expect(text).toContain('Direction reversed');
    expect(text).toContain('negative');
  });

  it('uses "no material influence" for near-zero', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'churn',
      toLabel: 'revenue',
      beforeMean: 0.4,
      afterMean: 0,
    });
    expect(text).toContain('no material influence');
    expect(text).not.toMatch(RAW_DECIMAL);
  });

  it('marks negative bands without leaking the raw value', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'churn',
      toLabel: 'revenue',
      beforeMean: -0.3,
      afterMean: -0.55,
    });
    expect(text).toContain('moderate (negative)');
    expect(text).toContain('strong (negative)');
    expect(text).not.toMatch(RAW_DECIMAL);
  });

  it('describes a direction-only change at zero without inventing influence', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'churn',
      toLabel: 'revenue',
      beforeMean: 0,
      afterMean: 0,
      beforeDirection: 'positive',
      afterDirection: 'negative',
    });
    expect(text).toContain('direction');
    expect(text).toContain('negative');
    expect(text).toContain('strength remains zero');
    expect(text).toContain('no material influence');
    expect(text).not.toContain('Direction reversed');
  });

  it('does not call a move away from zero an influence reversal', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'churn',
      toLabel: 'revenue',
      beforeMean: 0,
      afterMean: 0.3,
      beforeDirection: 'negative',
      afterDirection: 'positive',
    });
    expect(text).toContain('moderate');
    expect(text).not.toContain('Direction reversed');
  });
});

describe('formatEdgeStrengthConfirmed', () => {
  it('names the provenance act without fabricating a number or direction', () => {
    const text = formatEdgeStrengthConfirmed({
      fromLabel: 'Demand',
      toLabel: 'Growth',
    });
    expect(text).toBe(
      'Confirmed the current strength of the link between Demand and Growth as your judgement.',
    );
    expect(text).not.toMatch(RAW_DECIMAL);
    expect(text).not.toMatch(/positive|negative/i);
    expect(text).not.toContain('Adjusted');
  });
});

describe('formatGoalTargetUnchanged', () => {
  // Overnight review N1: the set-pair (formatGoalTargetSet) reads "at
  // least 15%" — the registered `>=` contract — but the unchanged-restate
  // sibling dropped the operator qualifier and read as an exact-value
  // target ("already 15%"), under-specifying the >= contract.
  it('carries the operator qualifier, matching formatGoalTargetSet\'s phrasing', () => {
    const text = formatGoalTargetUnchanged({
      goalLabel: 'Revenue',
      value: 15,
      unit: '%',
    });
    expect(text).toMatch(/\bat least 15%/);
    expect(text).not.toMatch(/is already 15%/);
  });
});

/**
 * A REAL CHANGE MUST NOT BE NARRATED AS NO CHANGE.
 *
 * ⛔ MEASURED IN A USER SESSION on deployed staging, 23 Sep, scenario
 * `399c2814` at 23:46:18. After thirty-seven minutes unable to run an analysis,
 * the user wrote "just help me fix what's stopping me from running the
 * analysis" and the product replied:
 *
 *     "Adjusted the link between Two Developers and Coordination Overhead Risk
 *      from moderate to moderate."
 *
 * ── THE MECHANISM ──────────────────────────────────────────────────────────
 * `adjust-edge-strength.ts:393` computes `noop` as strict equality of `mean`
 * AND `std` AND `direction`. This formatter reports BANDS. A mean that moves
 * WITHIN a band is therefore `noop === false` — a genuine write, fact status
 * `applied` — yet renders a sentence describing no movement. The guard is FINER
 * than the sentence it guards, which is why `formatEdgeStrengthUnchanged` (the
 * honest no-op receipt, already present) never fires for this case.
 *
 * Band thresholds are `moderate: 0.3`, `strong: 0.7` (`influence-bands.ts:26`),
 * so 0.35 and 0.55 are the same band by the code's own definition, not by
 * this author's choice.
 */
describe('formatEdgeAdjustment — no false band transition', () => {
  it('a change WITHIN a band does not claim a transition', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'Two Developers',
      toLabel: 'Coordination Overhead Risk',
      beforeMean: 0.25,
      afterMean: 0.35,
    });
    expect(text).not.toMatch(/from moderate to moderate/);
    expect(text).toContain('still moderate');
    // It must still report that something WAS adjusted — this is not a no-op.
    expect(text).toContain('Adjusted the link');
  });

  it('CONTROL: a genuine band transition is still reported as one', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'churn',
      toLabel: 'revenue',
      beforeMean: 0.3,
      afterMean: 0.55,
    });
    expect(text).toContain('from moderate to strong');
    expect(text).not.toContain('still');
  });

  it('near-zero renders English, not "still no material influence"', () => {
    // `describeBandWithDirection` returns the literal 'no material influence'
    // below 0.05, so the band noun cannot be a predicate complement here.
    const text = formatEdgeAdjustment({
      fromLabel: 'a',
      toLabel: 'b',
      beforeMean: 0.01,
      afterMean: 0.04,
    });
    expect(text).not.toMatch(/is still no material influence/);
    expect(text).toContain('It still has no material influence.');
  });

  it('a reversal INSIDE one band is reported, not swallowed', () => {
    const text = formatEdgeAdjustment({
      fromLabel: 'a',
      toLabel: 'b',
      beforeMean: 0.25,
      afterMean: 0.35,
      beforeDirection: 'positive',
      afterDirection: 'negative',
    });
    // The string this PR exists to remove must not appear on ANY path.
    expect(text).not.toMatch(/from moderate to moderate/);
    expect(text).toContain('still moderate');
    expect(text).toMatch(/direction is now negative/);
  });

  it('the joined sentence carries no doubled punctuation', () => {
    // ⚠ THIS REPLACES A DUPLICATE. The test that stood here was byte-identical
    // in INPUT to the one above (0.4 → 0.5, positive → negative) with a
    // strictly weaker assertion set — a reviewer correctly called it a control
    // that controlled nothing, and it left a mutant alive: dropping the
    // `.replace(/\.$/, '')` yields "…still moderate., but the direction is now
    // negative." and nothing went red. This asserts the joint itself.
    const flipped = formatEdgeAdjustment({
      fromLabel: 'a',
      toLabel: 'b',
      beforeMean: 0.25,
      afterMean: 0.35,
      beforeDirection: 'positive',
      afterDirection: 'negative',
    });
    expect(flipped).not.toMatch(/\.,/);
    expect(flipped).not.toMatch(/\.\s*\./);
    expect(flipped).toMatch(/still moderate, but the direction is now negative\.$/);

    // The near-zero clause joins the same way, and its noun differs.
    const nearZero = formatEdgeAdjustment({
      fromLabel: 'a',
      toLabel: 'b',
      beforeMean: 0.01,
      afterMean: 0.02,
      beforeDirection: 'positive',
      afterDirection: 'negative',
    });
    expect(nearZero).not.toMatch(/\.,/);
    expect(nearZero).toMatch(/no material influence, but the direction is now negative\.$/);
  });
});
