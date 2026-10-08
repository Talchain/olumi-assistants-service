/** event_risk.v1 slice 2a. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

type CorpusRow = { id: string; message: string; label: string; reason: string; expectedOccurrence?: { p_low: number; p_high: number }; expectedHorizonMonths?: number; expectedReaderEventRisk?: null };
const corpus = JSON.parse(readFileSync(new URL('../../../../acceptance-evidence/impact-pct/corpus-labels.json', import.meta.url), 'utf8')) as CorpusRow[];
import { scalingRatio } from '../../../../tests/helpers/scaling-ratio.js';
import { isFactorNamedByUser, readStatedEventRisk, readStatedLikelihoodWithoutWindow } from '../stated-event-risk.js';

describe('event_risk.v1 slice 2a — stated occurrence', () => {
  it.each([
    ['range', 'key developer might leave, maybe 10–30% in the next 6 months', 0.1, 0.3, 6],
    ['single', 'maybe about 20% within a year', 0.2, 0.2, 12],
    ['between-percent', 'chance between 5 and 15 percent over the next 18 months', 0.05, 0.15, 18],
    ['hyphen', 'maybe 10-30% within 12 months', 0.1, 0.3, 12],
    ['to', 'maybe 10 to 30% within 2 years', 0.1, 0.3, 24],
    ['both-percent', 'maybe 10% to 30% within 2 years', 0.1, 0.3, 24],
    ['weeks', 'maybe 20% within 6 weeks', 0.2, 0.2, 1.4],
    ['week-minimum', 'maybe 20% within 0.1 weeks', 0.2, 0.2, 0.1],
    ['zero', 'maybe 0% within a year', 0, 0, 12],
    ['hundred', 'maybe 100% in the next month', 1, 1, 1],
    ['decimal', 'maybe 12.5% within 6 months', 0.125, 0.125, 6],
    ['one-in-five', 'a 1 in 5 chance within 6 months', 0.2, 0.2, 6],
    ['one-in-four-words', 'probability of one in 4 over the next year', 0.25, 0.25, 12],
    ['one-in-three-rounded', '1 in 3 odds within 6 months', 0.3333, 0.3333, 6],
    ['one-in-two-boundary', '1 in 2 chance within 6 months', 0.5, 0.5, 6],
    ['one-in-thousand-boundary', '1 in 1000 chance within 6 months', 0.001, 0.001, 6],
    ['probability-then-and', 'Supplier failure has probability 1 in 5 and lowers revenue within 6 months.', 0.2, 0.2, 6],
    ['probability-is-sentence-end', 'The probability is 1 in 5. It may happen within 6 months.', 0.2, 0.2, 6],
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
    ['one-in-zero', '1 in 0 chance within 6 months'],
    ['one-in-no-cue-version', 'We shipped version 1 in 5 days; a competitor response could lower revenue within 6 months.'],
    ['one-in-no-cue', '1 in 5 within 6 months'],
    ['one-in-trillion', 'Supplier fails with a 1 in 2 trillion chance within 6 months'],
    ['one-in-million', 'Supplier fails with a 1 in 2 million chance within 6 months'],
    ['one-in-thousand-word', '1 in 3 thousand within 6 months'],
    ['one-in-range-dash', '1 in 5–10 within 6 months'],
    ['one-in-range-to', '1 in 5 to 10 within 6 months'],
    ['one-in-amount-is-window', 'If supplier fails, we lose £1 in 5 months.'],
    ['one-in-after-currency', 'We lose $1 in 5 cases within 6 months'],
    ['one-in-one', '1 in 1 chance within 6 months'],
    ['one-in-over-thousand', '1 in 1001 chance within 6 months'],
    ['one-in-long-integer', '1 in 10001 chance within 6 months'],
    ['one-in-huge-integer', '1 in 999999999999 within 6 months'],
    ['one-in-decimal', '1 in 5.5 chance within 6 months'],
    ['one-in-negative', '1 in -5 within 6 months'],
    ['one-in-positive-sign', '1 in +5 within 6 months'],
    ['one-in-word-suffix', '1 in 5ème within 6 months'],
    ['two-one-in-probabilities', '1 in 5 chance or 1 in 10 chance within 6 months'],
    ['one-in-and-percent', '1 in 5 chance or 30% within 6 months'],
    ['invalid-one-in-and-percent', '1 in 0 chance or 20% within 6 months'],
    ['huge-one-in-and-percent', '1 in 999999999999 chance or 20% within 6 months'],
  ])('2a-refuse-%s', (_id, text) => expect(readStatedEventRisk(text)).toBeUndefined());


  // RED-first impact-pct lease: served corpus messages are verbatim; labels were read independently.
  it.each([
    ['served-cloud-cost', 'Our monthly cloud bill is currently £45,000. We need to cut it by 15% within 6 months. Should we move our steady workloads to reserved instances, or renegotiate our contract with the current provider?'],
    ['target-noun', 'Make the goal 18 percent revenue growth within 9 months.'],
    ['target-by', 'Make the target growing yearly revenue by 18% within 9 months.'],
    ['served-churn-magnitude', 'No, I mean the updates relating to the risk of 7% churn over 3 months, meaning that we end up with a cash flow problem.'],
    ['defect-cut', 'Add a risk: churn spike could cut MRR by 10% within 6 months'],
    ['defect-drop', 'Add a risk: a 10% drop in MRR within 6 months if the release slips'],
    ['defect-lower', 'Feature release slips — if it slips, MRR will be lower by 10% within 6 months.'],
    ['plural-drops', 'Revenue faces 10% drops within 6 months'],
    ['singular-reduction', 'A 10% reduction in revenue within 6 months'],
    ['plural-reductions', '10% reductions in revenue within 6 months'],
    ['fronted', 'By 10%, MRR would fall within 6 months'],
    ['predicative', 'MRR is 10% lower within 6 months'],
    ['noun-hit', 'a 10% hit to revenue over the next year'],
    ['by-about', 'MRR could fall by about 10% within 6 months'],
    ['by-range', 'MRR could fall by 10–20% within 6 months'],
    ['verb-object', 'MRR could shrink 10% within 6 months'],
    ['cue-is-impact', 'Maybe MRR could drop 10% within 6 months'],
    ['cue-in-another-clause', 'There is a chance the release slips. MRR is 10% lower within 6 months'],
    ['share', 'A customer is 10% of revenue within 6 months'],
    ['uncued', 'about 20% within a year'],
    ['uncued-range', '10–30% within 6 months'],
    ['cued-share-mrr', 'Maybe the release costs 10% of MRR within 6 months'],
    ['monthly-churn-rate', 'The risk of 7% monthly churn over 3 months is worrying.'],
    ['yearly-churn-rate', 'The risk of 7% annual churn over 3 months is worrying.'],
    ['weak-risk-of', 'The risk of churn is 7% within 6 months.'],
    ['cue-other-sentence', 'It may happen, perhaps. Revenue is 10% within 6 months'],
  ])('impact-pct-must-not-read-%s', (_id, text) => {
    expect(readStatedEventRisk(text)).toBeUndefined();
    const withoutWindow = text.replace(/\b(?:within|in|over) (?:the next )?(?:6 months|12 months|3 months|a year|year)/gi, '');
    expect(readStatedLikelihoodWithoutWindow(withoutWindow)).toBe(false);
  });

  it.each([
    ['served-developer', 'Add a risk: our key developer might leave, maybe 10–30% in the next 6 months. If they leave it would cut platform improvement throughput.', 0.1, 0.3, 6],
    ['served-competitor', 'Add a risk: a competitor might cut its prices, maybe 15 - 25% in the next 3 months. If that happens, monthly recurring revenue would drop.', 0.15, 0.25, 3],
    ['chance', '10% chance it happens within 6 months', 0.1, 0.1, 6],
    ['one-in', '1 in 10 chance within a year', 0.1, 0.1, 12],
    ['mixed', 'There is a 30% chance the release slips within 6 months and cuts MRR by 10%.', 0.3, 0.3, 6],
    ['mixed-impact-first', 'MRR would drop by 10% if the release slips; there is a 30% chance within 6 months.', 0.3, 0.3, 6],
    ['bare-event', 'The release could happen, 10% in the next 6 months', 0.1, 0.1, 6],
    ['put-it-at', "A supplier may fail. I'd put it at about 15–25% within 3 months", 0.15, 0.25, 3],
    ['verb-event-with-direct-chance', 'A competitor might cut its prices with a 10% chance within 6 months', 0.1, 0.1, 6],
    ['verb-event-with-direct-probability', 'A competitor might cut its prices with probability 10% within 6 months', 0.1, 0.1, 6],
    ['percent-risk-of', '10% risk of an outage within 6 months', 0.1, 0.1, 6],
  ])('impact-pct-must-still-read-%s', (_id, text, low, high, months) => {
    expect(readStatedEventRisk(text)?.event_risk).toEqual({ version: 1, occurrence: {
      p_low: low, p_high: high, basis: 'user', meaning: 'at_least_once_within_horizon',
    }, horizon: { months } });
  });


  it.each(corpus)('impact-pct-corpus-$id-$label', (row) => {
    const result = readStatedEventRisk(row.message);
    if (row.label !== 'LIKELIHOOD' || row.expectedReaderEventRisk === null) {
      expect(result, row.reason).toBeUndefined();
    } else {
      expect(result?.event_risk.occurrence, row.reason).toMatchObject(row.expectedOccurrence!);
      expect(result?.event_risk.horizon.months, row.reason).toBe(row.expectedHorizonMonths);
    }
  });

  it('impact-pct-does-not-borrow-an-unrelated-goal-window', () => {
    expect(readStatedEventRisk('Grow revenue within 9 months. There is a 30% chance a client leaves this year; it is 40% of revenue.')).toBeUndefined();
  });

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
    ['percent-only', 'maybe about 20%, add it', true],
    ['range-only', 'a chance between 15 and 25 percent, add it', true],
    ['one-in-only', '1 in 5 chance, add it', true],
    ['percent-with-window', 'about 20% within 6 months', false],
    ['one-in-with-window', 'probability of one in 4 over the next year', false],
    ['two-percent-probabilities', '20% or 30%, add it', false],
    ['two-one-in-probabilities', '1 in 5 chance or 1 in 10 chance, add it', false],
    ['no-likelihood', 'Add a risk of a competitive response.', false],
    ['impact-by-percent', 'Add a competitive response risk that cuts Revenue by 20%.', false],
    ['impact-cued-by-about', 'Perhaps MRR will fall by about 10%.', false],
    ['impact-cued-noun', 'Likely a 10% drop in revenue.', false],
    ['impact-cued-verb', 'Maybe revenue would shrink 10%.', false],
    ['impact-cued-lower', 'Perhaps MRR is 10% lower.', false],
    ['other-clause-cue', 'It could happen, perhaps. Revenue is 10%.', false],
    ['put-it-at', "I'd put it at about 15–25%, add it", true],
    ['mixed-impact', 'There is a 30% chance it slips and cuts MRR by 10%.', true],
    ['percent-without-cue', 'Competitive response, 20%, add it.', false],
    ['verbal-likelihood', 'It is likely to happen within 6 months.', false],
    ['empty', '', false],
  ])('said-door-likelihood-without-window-%s', (_id, text, expected) => {
    expect(readStatedLikelihoodWithoutWindow(text)).toBe(expected);
  });


  it.each([
    ['whitespace', (n: number) => ' '.repeat(n)],
    ['by-percent', (n: number) => 'by 10% '.repeat(Math.ceil(n / 7)).slice(0, n)],
  ])('impact-pct-scaling-%s: 2k to 20k, ratio < 20 for both readers', (_id, make) => {
    const [small, large] = [make(2000), make(20000)];
    for (const reader of [readStatedEventRisk, readStatedLikelihoodWithoutWindow]) {
      const m = scalingRatio(() => reader(small), () => reader(large));
      process.stdout.write(`impact-pct timing ${_id} ${reader.name}: ${m.detail}; per-call 20k ${(m.largeMs / m.calls).toFixed(3)} ms\n`);
      expect(m.ratio, m.detail).toBeLessThan(20);
    }
  });

  it.each([
    ['digits', (n: number) => '9'.repeat(n)],
    ['spaces', (n: number) => `between ${' '.repeat(n)}10% within 6 months`],
    ['near-matches', (n: number) => '10- within '.repeat(Math.ceil(n / 10)).slice(0, n)],
    ['one-in-matches', (n: number) => '1 in 5 '.repeat(Math.ceil(n / 7)).slice(0, n)],
    ['one-in-near-matches', (n: number) => 'one in '.repeat(Math.ceil(n / 7)).slice(0, n)],
    ['one-in-long-denominator', (n: number) => `1 in ${'9'.repeat(n)} within 6 months`],
    ['one-in-cue-matches', (n: number) => '1 in 5 chance '.repeat(Math.ceil(n / 14)).slice(0, n)],
    ['one-in-preceding-cue-matches', (n: number) => 'probability of 1 in 5 '.repeat(Math.ceil(n / 22)).slice(0, n)],
  // Calibrated batches (scalingRatio): single-call min-of-5 read 8.18× on CI for near-matches (7 Oct).
  ])('2a-LINEAR TIME-%s: 5k to 40k, min of 7 calibrated batches, ratio < 22', (_id, make) => {
    const [small, large] = [make(5000), make(40000)];
    const m = scalingRatio(() => readStatedEventRisk(small), () => readStatedEventRisk(large));
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
    expect(m.ratio, m.detail).toBeLessThan(22);
  });

  it('said-door-factor-named-LINEAR TIME: 5k to 40k, ratio < 22', () => {
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
    const make = (n: number) => 'prices '.repeat(Math.ceil(n / 7)).slice(0, n);
    const [small, large] = [make(5000), make(40000)];
    const m = scalingRatio(() => isFactorNamedByUser('Price rise', small), () => isFactorNamedByUser('Price rise', large));
    expect(m.ratio, m.detail).toBeLessThan(22);
  });

  it('said-door-factor-named-LINEAR TIME many label lengths (Codex r2): 5k to 40k, ratio < 22', () => {
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
    const label = Array.from({ length: 96 }, (_, i) => 'a'.repeat(i + 3)).join(' ');
    const make = (n: number) => `${'a'.repeat(199)} `.repeat(Math.ceil(n / 200)).slice(0, n);
    const [small, large] = [make(5000), make(40000)];
    const m = scalingRatio(() => isFactorNamedByUser(label, small), () => isFactorNamedByUser(label, large));
    expect(m.ratio, m.detail).toBeLessThan(22);
  });

  it('said-door-likelihood-without-window-LINEAR TIME: 5k to 40k, ratio < 22', () => {
    // 8× input, midpoint bar 22: linear ≈ 8×, quadratic ≈ 64×; slow-runner noise cannot cross it; see #2793.
    const make = (n: number) => '1 in 5 '.repeat(Math.ceil(n / 7)).slice(0, n);
    const [small, large] = [make(5000), make(40000)];
    const m = scalingRatio(() => readStatedLikelihoodWithoutWindow(small), () => readStatedLikelihoodWithoutWindow(large));
    expect(m.ratio, m.detail).toBeLessThan(22);
  });
});
