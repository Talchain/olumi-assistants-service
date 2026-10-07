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
  'If the lead time doubles, the launch slips.',
  'Cutting the lead time helps both options.',
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
  // r1 review (complement bound): after a possession verb, "the lead time(s)" is the leader idiom.
  'Raise prices takes the lead time and again.',
  'Raise prices has held the lead time after time.',
  'Raise prices takes the lead times two to one.',
  'It has held the lead -times are good.',
  'Option A holds the lead time on every run.',
  'Raise prices will take the lead times over.',
  'Starter has the lead time and time again across runs.',
  'Hire now has the lead-time advantage in most runs.',
  'Option B took the lead  times three.',
  'Hire now is in the lead time and again.',
  'Raise prices has taken the lead time.',
];

const TIMING_SHAPES = [
  ['20k spaces', 'The lead' + ' '.repeat(20_000) + 'time', true],
  ['2000 noun phrases', 'lead time '.repeat(2000), false],
  ['20k newlines', 'The lead' + '\n'.repeat(20_000), true],
  ['2000 possession phrases', 'holds the lead time '.repeat(2000), true],
  // Beyond the possession limb's bounded gap (\s{1,4}) the phrase reads as the noun.
  ['possession + 20k spaces', 'holds' + ' '.repeat(20_000) + 'the lead time', false],
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

  it.each(TIMING_SHAPES)('scans %s in under 50 ms', (_shape, text, expected) => {
    const start = performance.now();
    const result = classify(text);
    const elapsed = performance.now() - start;
    // Only one/two spaces or hyphens directly before time(s) denote the noun.
    expect(result).toBe(expected);
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
