import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../leading-option-egress-guard.js';

const NOUN_ONLY = [
  'The lead time on hiring doubled.',
  'Lead times rose last quarter.',
  'The lead-time for parts is 6 weeks.',
  'Hiring lead time is the constraint.',
  'Our lead times have doubled since March.',
  'Reduce the lead time before choosing.',
  '* The lead time on hiring doubled.',
  'The lead  time doubled.',
  'Supplier lead times are about 6 weeks.',
  'A longer lead time would delay the launch.',
];

// Each positive control was measured true on the unmodified real exports.
// A noun elsewhere in the sentence must not exempt a genuine leader claim.
const LEADER_CLAIMS = [
  'Raise prices 10% leads.',
  'Raise prices leads on lead time.',
  'The lead time is short, so the starter tier leads.',
  'Option A has the lead.',
  'The starter tier is the leading option.',
  'Option A leads, despite its lead time.',
];

const TIMING_SHAPES = [
  ['20k spaces', 'The lead' + ' '.repeat(20_000) + 'time'],
  ['2000 noun phrases', 'lead time '.repeat(2000)],
  ['20k newlines', 'The lead' + '\n'.repeat(20_000)],
] as const;

describe.each([
  ['textAssertsLeadingOption', textAssertsLeadingOption],
  ['textNamesLeadingOption', textNamesLeadingOption],
] as const)('%s: lead-time noun', (_name, classify) => {
  it.each(NOUN_ONLY)('does not fire on %s', (text) => {
    expect(classify(text)).toBe(false);
  });

  it.each(LEADER_CLAIMS)('still fires on %s', (text) => {
    expect(classify(text)).toBe(true);
  });

  it.each(TIMING_SHAPES)('scans %s in under 50 ms', (_shape, text) => {
    const start = performance.now();
    const result = classify(text);
    const elapsed = performance.now() - start;
    // Only one/two spaces or hyphens directly before time(s) denote the noun.
    expect(result).toBe(_shape !== '2000 noun phrases');
    expect(elapsed).toBeLessThan(50);
  });

  it('scales below 8x from 5,000 to 20,000 characters (minimum of five)', () => {
    const minimumTiming = (length: number): number => {
      const text = 'The lead' + '\n'.repeat(length - 'The lead'.length);
      const timings = Array.from({ length: 5 }, () => {
        const start = performance.now();
        const result = classify(text);
        const elapsed = performance.now() - start;
        expect(result).toBe(true);
        return elapsed;
      });
      return Math.min(...timings);
    };

    const n = minimumTiming(5000);
    const fourN = minimumTiming(20_000);
    expect(fourN / n).toBeLessThan(8);
  });
});
