import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extractQuantities } from '../extract-quantities.js';

// Property tests per CQE Design v1.1 §5: length of input, no exception thrown,
// output is a valid array. These guard the no-throw and output-type contracts
// under adversarial input generation.

describe('CQE extract-quantities (property)', () => {
  it('never throws for arbitrary string input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 3000 }), (input) => {
        const results = extractQuantities(input);
        expect(Array.isArray(results)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('never throws for adversarial unicode + whitespace inputs', () => {
    fc.assert(
      fc.property(fc.unicodeString({ maxLength: 500 }), (input) => {
        const results = extractQuantities(input);
        expect(Array.isArray(results)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('always emits results with expected schema shape', () => {
    fc.assert(
      fc.property(fc.asciiString({ maxLength: 200 }), (input) => {
        const results = extractQuantities(input);
        for (const r of results) {
          expect(typeof r.raw_text).toBe('string');
          expect(typeof r.approximate).toBe('boolean');
          expect(['cqe', 'compromise', 'unparsed']).toContain(r.source);
        }
      }),
      { numRuns: 150 },
    );
  });
});
