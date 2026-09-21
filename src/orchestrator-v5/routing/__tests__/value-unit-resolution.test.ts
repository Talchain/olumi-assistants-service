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
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to £300k for', '£').resolved).toBe(true);
    expect(classifyValueUnitAgainstFactor('Set the factor to £2 instead', '£').resolved).toBe(true);
  });

  it('BLOCKS an UNRECOGNISED value-attached unit token ("5 widgets") on a typed factor (fail closed)', () => {
    const v = classifyValueUnitAgainstFactor('Set Marketing budget to 5 widgets', '£');
    expect(v.resolved).toBe(false);
    if (!v.resolved) {
      expect(v.reason).toBe('unresolved_unit_token');
      expect(v.factor_unit_family).toBe('currency');
    }
  });

  it('BLOCKS a leading-dot value with an incompatible unit (".5 agents")', () => {
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to .5 agents', '£').resolved).toBe(false);
  });

  it('does NOT block an unrecognised word against an UNTYPED factor', () => {
    expect(classifyValueUnitAgainstFactor('Set Product quality to 5 widgets', undefined).resolved).toBe(true);
  });
});

describe('classifyValueUnitAgainstFactor — proposed-value attribution (compound turns)', () => {
  it('binds to the PROPOSED value: "...Cost to 5 agents and ...Programme to 0.5" blocks the cost-factor value (5)', () => {
    const msg = 'Set Cost to 5 agents and set Programme to 0.5';
    // Cost (£) proposal applies value 5 → "5 agents" is its token → block.
    expect(classifyValueUnitAgainstFactor(msg, '£', 5).resolved).toBe(false);
  });

  it('does NOT block the OTHER clause: the same message judged on value 0.5 (no trailing unit) resolves', () => {
    const msg = 'Set Cost to 5 agents and set Programme to 0.5';
    expect(classifyValueUnitAgainstFactor(msg, '£', 0.5).resolved).toBe(true);
  });

  it('does not over-block an explanatory number: "to £500,000 — that is 5 times..." judged on 500000 resolves', () => {
    const msg = 'Set Marketing budget to £500,000 — that is 5 times our current £100,000 baseline';
    expect(classifyValueUnitAgainstFactor(msg, '£', 500000).resolved).toBe(true);
  });

  it('does not over-block a legitimate compound currency edit: "...£5000 and headcount to 5 agents" on the £5000 value', () => {
    const msg = 'Set Cost to £5000 and headcount to 5 agents';
    expect(classifyValueUnitAgainstFactor(msg, '£', 5000).resolved).toBe(true);
  });

  it('expands magnitude suffixes when attributing (proposed 120000 matches "120k")', () => {
    expect(classifyValueUnitAgainstFactor('Set Marketing budget to 120k', '£', 120000).resolved).toBe(true);
  });

  it('multi-quantity fallback (proposed value not in text): blocks a KNOWN-incompatible unit, ignores unknown words', () => {
    // Proposed 0.8 is not literally in the message; still, an explicit "5 agents"
    // (known count) against a £ factor must fail closed.
    expect(classifyValueUnitAgainstFactor('Set Cost to 5 agents and Programme to 50%', '£', 0.8).resolved).toBe(false);
    // ...but an unattributable UNKNOWN word does not block in fallback.
    expect(classifyValueUnitAgainstFactor('Set Cost to 5 widgets and Programme to 50000', '£', 0.8).resolved).toBe(true);
  });
});
