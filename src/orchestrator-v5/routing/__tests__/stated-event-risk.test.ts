/** event_risk.v1 slice 2a. */
import { describe, it, expect } from 'vitest';
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';
import { isFactorNamedByUser, readStatedEventRisk, readStatedLikelihoodWithoutWindow } from '../stated-event-risk.js';

describe('event_risk.v1 slice 2a — stated occurrence', () => {
  it.each([
    ['range', 'key developer might leave, maybe 10–30% in the next 6 months', 0.1, 0.3, 6],
    ['single', 'about 20% within a year', 0.2, 0.2, 12],
    ['between-percent', 'between 5 and 15 percent over the next 18 months', 0.05, 0.15, 18],
    ['hyphen', '10-30% within 12 months', 0.1, 0.3, 12],
    ['to', '10 to 30% within 2 years', 0.1, 0.3, 24],
    ['both-percent', '10% to 30% within 2 years', 0.1, 0.3, 24],
    ['weeks', '20% within 6 weeks', 0.2, 0.2, 1.4],
    ['week-minimum', '20% within 0.1 weeks', 0.2, 0.2, 0.1],
    ['zero', '0% within a year', 0, 0, 12],
    ['hundred', '100% in the next month', 1, 1, 1],
    ['decimal', '12.5% within 6 months', 0.125, 0.125, 6],
    ['one-in-five', '1 in 5 within 6 months', 0.2, 0.2, 6],
    ['one-in-four-words', 'one in 4 over the next year', 0.25, 0.25, 12],
    ['one-in-three-rounded', '1 in 3 within 6 months', 0.3333, 0.3333, 6],
    ['one-in-two-boundary', '1 in 2 within 6 months', 0.5, 0.5, 6],
    ['one-in-thousand-boundary', '1 in 1000 within 6 months', 0.001, 0.001, 6],
  ])('2a-positive-%s', (_id, text, low, high, months) => {
    const result = readStatedEventRisk(text)!;
    expect(result.event_risk).toEqual({ version: 1, occurrence: { p_low: low, p_high: high, basis: 'user', meaning: 'at_least_once_within_horizon' }, horizon: { months } });
    expect(text).toContain(result.quote);
  });
  it.each([
    ['no-number', 'maybe the developer leaves within 6 months'],
    ['no-horizon', 'about 20%'],
    ['calendar', '20% this year'],
    ['two-ranges', '10–30% or 20–40% within 6 months'],
    ['two-points', '20% or 30% within 6 months'],
    ['two-horizons', '20% within 6 months or within a year'],
    ['descending', '40–20% within 6 months'],
    ['over-hundred', '150% within 6 months'],
    ['negative', '-10% within 6 months'],
    ['negative-range', '-10–20% within 6 months'],
    ['past', '20% over the last 6 months'],
    ['zero-horizon', '20% within 0 months'],
    ['missing-duration', '20% within months'],
    ['huge-figure', '99999999999920% within 6 months'],
    ['one-in-zero', '1 in 0 within 6 months'],
    ['one-in-million', 'Supplier fails with a 1 in 2 million chance within 6 months'],
    ['one-in-thousand-word', '1 in 3 thousand within 6 months'],
    ['one-in-range-dash', '1 in 5–10 within 6 months'],
    ['one-in-range-to', '1 in 5 to 10 within 6 months'],
    ['one-in-amount-is-window', 'If supplier fails, we lose £1 in 5 months.'],
    ['one-in-after-currency', 'We lose $1 in 5 cases within 6 months'],
    ['one-in-one', '1 in 1 within 6 months'],
    ['one-in-over-thousand', '1 in 1001 within 6 months'],
    ['one-in-long-integer', '1 in 10001 within 6 months'],
    ['one-in-huge-integer', '1 in 999999999999 within 6 months'],
    ['one-in-decimal', '1 in 5.5 within 6 months'],
    ['one-in-negative', '1 in -5 within 6 months'],
    ['one-in-positive-sign', '1 in +5 within 6 months'],
    ['one-in-word-suffix', '1 in 5ème within 6 months'],
    ['two-one-in-probabilities', '1 in 5 or 1 in 10 within 6 months'],
    ['one-in-and-percent', '1 in 5 or 30% within 6 months'],
    ['invalid-one-in-and-percent', '1 in 0 or 20% within 6 months'],
    ['huge-one-in-and-percent', '1 in 999999999999 or 20% within 6 months'],
  ])('2a-refuse-%s', (_id, text) => expect(readStatedEventRisk(text)).toBeUndefined());

  it('said-door-one-in-quote-spans-probability-and-window', () => {
    const result = readStatedEventRisk('A competitor might respond: 1 in 5 chance within 6 months. Add it.')!;
    expect(result.quote).toBe('1 in 5 chance within 6 months');
  });

  it.each([
    ['named', 'Price', 'The risk grows because our price goes up.', true],
    ['not-named', 'Price', 'There is a risk of a competitive response.', false],
    ['prefix', 'Price', 'Competitors react when our prices rise.', true],
    ['all-label-words', 'Price rise', 'Our price rises may provoke a response.', true],
    ['missing-label-word', 'Price rise', 'Our price may provoke a response.', false],
    ['case-insensitive', 'PRICE RISE', 'Our price rises may provoke a response.', true],
    ['whole-word-boundary', 'Price', 'They mispriced their product.', false],
    ['short-label-words-ignored', 'Price of AI', 'Our prices may provoke a response.', true],
    ['punctuation', 'Price rise', 'Our PRICE: RISE; could provoke a response.', true],
    ['empty-label', '', 'Our price rises.', false],
    ['all-short-label', 'AI of IT', 'AI of IT might provoke a response.', true],
    ['short-label-whole-word', 'AI', 'AI causes competitive response that lowers revenue, 20% within 6 months.', true],
    ['short-label-not-a-prefix', 'AI', 'Aim for a competitive response, 20% within 6 months.', false],
    ['digit-label', 'Q3forecast', 'The Q3forecast drives it, 20% within 6 months.', true],
    ['digit-label-absent', 'Q3forecast', 'The forecast drives it, 20% within 6 months.', false],
    ['accented-label-prefix', 'Coût élevé', 'Nos coûts sont élevés.', true],
    ['accented-label-case', 'COÛT ÉLEVÉ', 'Nos coûts sont élevés.', true],
    ['accented-word-boundary', 'Coût', 'Les surcoûts pourraient augmenter.', false],
  ])('said-door-factor-named-%s', (_id, label, text, named) => {
    expect(isFactorNamedByUser(label, text)).toBe(named);
  });

  it.each([
    ['percent-only', 'about 20%, add it', true],
    ['range-only', 'between 15 and 25 percent, add it', true],
    ['one-in-only', '1 in 5 chance, add it', true],
    ['percent-with-window', 'about 20% within 6 months', false],
    ['one-in-with-window', 'one in 4 over the next year', false],
    ['two-percent-probabilities', '20% or 30%, add it', false],
    ['two-one-in-probabilities', '1 in 5 or 1 in 10, add it', false],
    ['no-likelihood', 'Add a risk of a competitive response.', false],
    ['verbal-likelihood', 'It is likely to happen within 6 months.', false],
    ['empty', '', false],
  ])('said-door-likelihood-without-window-%s', (_id, text, expected) => {
    expect(readStatedLikelihoodWithoutWindow(text)).toBe(expected);
  });

  it.each([
    ['digits', (n: number) => '9'.repeat(n)],
    ['spaces', (n: number) => `between ${' '.repeat(n)}10% within 6 months`],
    ['near-matches', (n: number) => '10- within '.repeat(Math.ceil(n / 10)).slice(0, n)],
    ['one-in-matches', (n: number) => '1 in 5 '.repeat(Math.ceil(n / 7)).slice(0, n)],
    ['one-in-near-matches', (n: number) => 'one in '.repeat(Math.ceil(n / 7)).slice(0, n)],
    ['one-in-long-denominator', (n: number) => `1 in ${'9'.repeat(n)} within 6 months`],
  // Calibrated batches (scalingRatio): single-call min-of-5 read 8.18× on CI for near-matches (7 Oct). Linear ≈ 4×, quadratic ≈ 16×.
  ])('2a-LINEAR TIME-%s: 5k to 20k, min of 7 calibrated batches, ratio < 8', (_id, make) => {
    const [small, large] = [make(5000), make(20000)];
    const m = scalingRatio(() => readStatedEventRisk(small), () => readStatedEventRisk(large));
    expect(m.ratio, m.detail).toBeLessThan(8);
  });

  it('said-door-factor-named-LINEAR TIME: 5k to 20k, ratio < 8', () => {
    const make = (n: number) => 'prices '.repeat(Math.ceil(n / 7)).slice(0, n);
    const [small, large] = [make(5000), make(20000)];
    const m = scalingRatio(() => isFactorNamedByUser('Price rise', small), () => isFactorNamedByUser('Price rise', large));
    expect(m.ratio, m.detail).toBeLessThan(8);
  });

  it('said-door-likelihood-without-window-LINEAR TIME: 5k to 20k, ratio < 8', () => {
    const make = (n: number) => '1 in 5 '.repeat(Math.ceil(n / 7)).slice(0, n);
    const [small, large] = [make(5000), make(20000)];
    const m = scalingRatio(() => readStatedLikelihoodWithoutWindow(small), () => readStatedLikelihoodWithoutWindow(large));
    expect(m.ratio, m.detail).toBeLessThan(8);
  });
});
