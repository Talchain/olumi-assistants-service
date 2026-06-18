/**
 * P0-A value/unit fail-closed containment — unit tests for the
 * `classifyValueUnitAgainstFactor` predicate.
 *
 * The predicate is the unit-token-aware check the upstream pipeline lacks: it
 * fails closed when the value's unit token belongs to a different family than
 * the target factor's stored unit, while leaving every legitimate phrasing
 * (bare numbers, matching units, untyped factors, count factors) untouched.
 */
import { describe, it, expect } from 'vitest';

import {
  classifyValueUnitAgainstFactor,
  lastValueTrailingToken,
  unitFamilyOf,
} from '../value-unit-resolution.js';

describe('unitFamilyOf', () => {
  it('classifies currency symbols, codes, and words', () => {
    for (const t of ['£', '$', '€', 'GBP', 'pounds', 'pound', 'dollars', 'euro', 'grand', 'quid']) {
      expect(unitFamilyOf(t)).toBe('currency');
    }
  });
  it('classifies percent forms', () => {
    for (const t of ['%', 'pp', 'percent', 'percentage']) {
      expect(unitFamilyOf(t)).toBe('percent');
    }
  });
  it('classifies time and metric units (singular + plural)', () => {
    expect(unitFamilyOf('month')).toBe('time');
    expect(unitFamilyOf('months')).toBe('time');
    expect(unitFamilyOf('km')).toBe('metric');
    expect(unitFamilyOf('miles')).toBe('metric');
  });
  it('classifies headcount nouns (singular + plural) as count', () => {
    for (const t of ['agent', 'agents', 'people', 'person', 'staff', 'hire', 'hires', 'fte', 'engineers']) {
      expect(unitFamilyOf(t)).toBe('count');
    }
  });
  it('returns null for ordinary words and noise', () => {
    for (const t of ['now', 'instead', 'next', 'please', 'and', 'to', 'budget', 'revenue', undefined, '']) {
      expect(unitFamilyOf(t)).toBeNull();
    }
  });
});

describe('lastValueTrailingToken', () => {
  it('extracts a trailing unit noun on the last value', () => {
    expect(lastValueTrailingToken('Set Incremental Hiring Cost to 5 agents')).toBe('agents');
  });
  it('returns null for a bare number', () => {
    expect(lastValueTrailingToken('Set Marketing budget to 50000')).toBeNull();
    expect(lastValueTrailingToken('Set the win rate to 0.5')).toBeNull();
  });
  it('ignores a unit word inside the label, anchoring on the LAST value', () => {
    // "3 month" is part of the label; the value being set is 5 (no trailing unit).
    expect(lastValueTrailingToken('Set the 3 month runway factor to 5')).toBeNull();
  });
  it('captures the magnitude-suffixed value\'s trailing token, not the suffix', () => {
    expect(lastValueTrailingToken('Set Hiring Cost to 5k agents')).toBe('agents');
  });
  it('does not mis-split a metric word as a magnitude suffix', () => {
    // "5 miles" must not parse as value 5m + token "iles".
    expect(lastValueTrailingToken('Set distance to 5 miles')).toBe('miles');
  });
  it('captures a trailing percent symbol with no space', () => {
    expect(lastValueTrailingToken('Set churn to 50%')).toBe('%');
  });
});

describe('classifyValueUnitAgainstFactor', () => {
  it('BLOCKS the live failure: "5 agents" (count) against a £ factor (currency)', () => {
    const v = classifyValueUnitAgainstFactor('Set Incremental Hiring Cost to 5 agents', '£');
    expect(v.resolved).toBe(false);
    if (!v.resolved) {
      expect(v.reason).toBe('incompatible_unit');
      expect(v.user_unit_family).toBe('count');
      expect(v.factor_unit_family).toBe('currency');
    }
  });

  it('BLOCKS a percent word CQE drops ("50 percent") against a £ factor', () => {
    const v = classifyValueUnitAgainstFactor('Set Marketing budget to 50 percent', '£');
    expect(v.resolved).toBe(false);
    if (!v.resolved) expect(v.user_unit_family).toBe('percent');
  });

  it('BLOCKS a time unit against a £ factor', () => {
    expect(classifyValueUnitAgainstFactor('Set budget to 5 months', '£').resolved).toBe(false);
  });

  it('RESOLVES a bare number against a typed factor (reuse-existing-unit convention)', () => {
    // The locked predicate behaviour: a bare number against a unit-bearing
    // factor is a legitimate edit. The guard must not block it.
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to 50000', '£').resolved).toBe(true);
  });

  it('RESOLVES a matching-unit value ("£50,000" — symbol precedes, no trailing token)', () => {
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to £50,000', '£').resolved).toBe(true);
  });

  it('RESOLVES a same-family trailing word ("5 pounds" against a £ factor)', () => {
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to 5 pounds', '£').resolved).toBe(true);
  });

  it('RESOLVES a percent value against a percent factor', () => {
    expect(classifyValueUnitAgainstFactor('Set churn to 5%', '%').resolved).toBe(true);
    expect(classifyValueUnitAgainstFactor('Set churn to 5 percent', '%').resolved).toBe(true);
  });

  it('RESOLVES a count value against a count factor (does not break count factors)', () => {
    expect(classifyValueUnitAgainstFactor('Set Headcount to 5 agents', 'people').resolved).toBe(true);
  });

  it('RESOLVES against an untyped factor (no stored unit → no family to conflict with)', () => {
    expect(classifyValueUnitAgainstFactor('Set Product quality to 5 agents', undefined).resolved).toBe(true);
  });

  it('RESOLVES a ratio update with no unit ("to 0.5")', () => {
    expect(classifyValueUnitAgainstFactor('Set the win rate to 0.5', '£').resolved).toBe(true);
  });

  it('RESOLVES when the trailing word is an ordinary connective, not a unit', () => {
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to 50000 now', '£').resolved).toBe(true);
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to 50000 instead', '£').resolved).toBe(true);
  });
});
