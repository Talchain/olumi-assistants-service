import { describe, expect, it } from 'vitest';

import {
  formatConstraintAdded,
  formatEdgeAdjustment,
  formatFactorChange,
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
      beforeMean: 0.4,
      afterMean: 0.7,
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
      beforeMean: -0.4,
      afterMean: -0.7,
    });
    expect(text).toContain('moderate (negative)');
    expect(text).toContain('strong (negative)');
    expect(text).not.toMatch(RAW_DECIMAL);
  });
});
