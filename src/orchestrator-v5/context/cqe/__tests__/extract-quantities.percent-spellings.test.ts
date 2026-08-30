import { describe, expect, it } from 'vitest';

import { runExtraction } from '../extract-quantities.js';
import { PATTERN_RULES } from '../rules.js';

const SPELLINGS = ['%', 'percent', 'per cent'] as const;

function healthySingle(message: string, pattern: string) {
  const out = runExtraction(message);
  expect(out.summary.degraded).toBe(false);
  expect(out.summary.timeout).toBe(false);
  expect(out.summary.patterns_matched).toContain(pattern);
  expect(out.results).toHaveLength(1);
  expect(out.results[0]!.source).toBe('cqe');
  return out.results[0]!;
}

describe('explicit percent spellings retain the CQE quantity and operator', () => {
  it.each(SPELLINGS)('P12 sets 12 %s to the same fraction without losing the authored span', (spelling) => {
    const message = `set churn to 12 ${spelling}`;
    expect(healthySingle(message, 'P12')).toMatchObject({
      value: 0.12,
      unit: 'percentage',
      operator: 'set',
      direction: 'set',
      raw_text: message,
      value_origin: 'literal',
    });
  });

  it('the opposite bare-number statement stays 12 with no unit', () => {
    expect(healthySingle('set churn to 12', 'P12')).toMatchObject({
      value: 12,
      unit: null,
      operator: 'set',
      direction: 'set',
      raw_text: 'set churn to 12',
    });
  });

  it.each(SPELLINGS)('a bare 12 %s quantity retains its percentage convention', (spelling) => {
    expect(healthySingle(`the assumption is 12 ${spelling}`, 'P9')).toMatchObject({
      value: 0.12,
      unit: 'percentage',
      operator: null,
      direction: null,
    });
  });

  it.each(SPELLINGS)('a range in %s retains both endpoints and the comparator', (spelling) => {
    expect(healthySingle(`between 5 ${spelling} and 12 ${spelling}`, 'P1')).toMatchObject({
      range_min: 0.05,
      range_max: 0.12,
      comparator: 'between',
      unit: 'percentage',
      value: null,
    });
  });

  it.each(SPELLINGS)('a lower limit in %s stays a limit, not a point-value edit', (spelling) => {
    expect(healthySingle(`at least 12 ${spelling}`, 'P3')).toMatchObject({
      value: 0.12,
      comparator: 'at_least',
      unit: 'percentage',
      operator: null,
    });
  });

  it.each(SPELLINGS)('a relative reduction by 12 %s keeps the decrement', (spelling) => {
    expect(healthySingle(`reduce churn by 12 ${spelling}`, 'P6')).toMatchObject({
      value: 0.12,
      unit: 'percentage',
      direction: 'down',
      operator: 'decrement',
    });
  });

  it.each(SPELLINGS)('the no-by increase in %s retains P6b ownership and its increment', (spelling) => {
    expect(healthySingle(`grow revenue 12 ${spelling}`, 'P6b')).toMatchObject({
      value: 0.12,
      unit: 'percentage',
      direction: 'up',
      operator: 'increment',
    });
  });

  it.each(['12 percentile', '12 per centile', '12 percentage points'])('does not claim a percentage prefix inside "%s"', (message) => {
    const barePercentage = PATTERN_RULES.find((rule) => rule.id === 'P9');
    expect(barePercentage).toBeDefined();
    expect(barePercentage!.apply(message, { wordNumberReplacements: [] })).toEqual([]);
    const out = runExtraction(message);
    expect(out.summary.degraded).toBe(false);
    expect(out.summary.timeout).toBe(false);
    expect(out.results.filter((quantity) => quantity.unit === 'percentage')).toEqual([]);
  });

  it.each([
    ['increase by 12 percentage points', 'up', 'increment'],
    ['reduce by 12 percentage points', 'down', 'decrement'],
  ] as const)('preserves the distinct points amount and operator: %s', (message, direction, operator) => {
    expect(healthySingle(message, 'P13')).toMatchObject({
      value: 12,
      unit: 'percentage_points',
      direction,
      operator,
    });
  });
});
