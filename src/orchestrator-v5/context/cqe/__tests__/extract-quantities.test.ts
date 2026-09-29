import { describe, expect, it } from 'vitest';
import { extractQuantities, runExtraction } from '../extract-quantities.js';
import {
  cqeFixtures,
  FIXTURE_COUNT,
  type CqeFixture,
} from '../../../../../tests/fixtures/cqe-fixtures.js';
import type { QuantityExtractionResult } from '@talchain/schemas/orchestrator';

describe('CQE extract-quantities', () => {
  it('has 68 fixtures per CQE Design v1.1 §8', () => {
    expect(FIXTURE_COUNT).toBe(68);
  });

  describe.each(cqeFixtures)('fixture $id [$category]', (fixture: CqeFixture) => {
    it(`${JSON.stringify(fixture.input)} -> ${fixture.expected.length} result(s)`, () => {
      const results = extractQuantities(fixture.input);
      const failures = matchFailures(fixture, results);
      if (failures.length > 0) {
        const message = [
          `Fixture ${fixture.id} failed:`,
          `  input: ${JSON.stringify(fixture.input)}`,
          `  expected: ${JSON.stringify(fixture.expected, null, 2)}`,
          `  actual:   ${JSON.stringify(results, null, 2)}`,
          ...failures.map((f) => `  - ${f}`),
        ].join('\n');
        expect.fail(message);
      }
    });
  });

  it('returns an empty array for non-string input without throwing', () => {
    // @ts-expect-error exercise runtime contract for defensive callers
    expect(extractQuantities(null)).toEqual([]);
    // @ts-expect-error exercise runtime contract for defensive callers
    expect(extractQuantities(undefined)).toEqual([]);
    // @ts-expect-error exercise runtime contract for defensive callers
    expect(extractQuantities(123)).toEqual([]);
  });

  it('runExtraction returns a summary with the expected shape', () => {
    const out = runExtraction('set X to 5%');
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.summary.message_length).toBe('set X to 5%'.length);
    expect(out.summary.duration_ms).toBeGreaterThanOrEqual(0);
    expect(out.summary.timeout).toBe(false);
    expect(out.summary.message_too_long).toBe(false);
  });

  it('flags message_too_long for inputs over 2000 chars', () => {
    const long = 'set X to 5% '.repeat(200);
    const out = runExtraction(long);
    expect(out.summary.message_too_long).toBe(true);
  });
});

function matchFailures(
  fixture: CqeFixture,
  results: readonly QuantityExtractionResult[],
): string[] {
  const failures: string[] = [];
  // Exact result count per brief §6 Gate 7 (deep equality per fixture).
  // Over-matches are failures, not warnings, so phantom extractions can't
  // hide behind a permissive "at least N" check.
  if (results.length !== fixture.expected.length) {
    failures.push(
      `expected ${fixture.expected.length} result(s), got ${results.length}`,
    );
    return failures;
  }
  // Positional ordering required: results must align index-by-index with
  // expectations. Each expected result is a Partial<>: only listed fields
  // are compared; unlisted fields are not asserted but must still sit at
  // the matching index.
  for (let i = 0; i < fixture.expected.length; i++) {
    const expected = fixture.expected[i]!;
    const actual = results[i]!;
    for (const key of Object.keys(expected) as Array<keyof QuantityExtractionResult>) {
      const expectedValue = (expected as Record<string, unknown>)[key];
      const actualValue = actual[key];
      if (!deepEqual(expectedValue, actualValue)) {
        failures.push(
          `result[${i}].${String(key)} expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
        );
      }
    }
  }
  return failures;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-6;
  }
  return false;
}
