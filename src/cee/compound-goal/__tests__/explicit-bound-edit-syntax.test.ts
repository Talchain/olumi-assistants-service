import { describe, expect, it } from 'vitest';
import { extractCompoundGoals } from '../extractor.js';

const extract = (input: string) => extractCompoundGoals(input, { includeProxies: false }).constraints;

function expectAmountSpan(input: string, start: number, amount: string, row = extract(input)[0]) {
  expect(row.sourceAmountSpan).toEqual({ start, end: start + amount.length });
  expect(input.slice(row.sourceAmountSpan!.start, row.sourceAmountSpan!.end)).toBe(amount);
}

describe('explicit subject-first bound syntax', () => {
  it('retains the complete subject and one bound from the captured assistant offer', () => {
    const input = 'Nothing has been changed. I want to confirm this with you before I edit the model, and a limit keeping "Funding Amount Secured" at or above £1,300,000 looks like it would help. Say the word and I will make it. - Make this update.';
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetName: 'Funding Amount Secured', targetNodeId: 'fac_funding_amount_secured',
      operator: '>=', value: 1300000, unit: '£', valueFrame: 'level',
      sourceQuote: 'keeping "Funding Amount Secured" at or above £1,300,000',
    });
    expectAmountSpan(input, input.indexOf('£1,300,000'), '£1,300,000', rows[0]);
  });

  it.each([
    'Keep Funding Amount Secured at or above £1,300,000.',
    'Set the minimum Funding Amount Secured to £1,300,000.',
  ])('preserves the full command quote and raw amount occurrence: %s', (input) => {
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetName: 'Funding Amount Secured', targetNodeId: 'fac_funding_amount_secured',
      operator: '>=', value: 1300000, unit: '£', valueFrame: 'level',
      sourceQuote: input.slice(0, -1),
    });
    expectAmountSpan(input, input.indexOf('£1,300,000'), '£1,300,000', rows[0]);
  });

  it.each([
    'Keep Customer Support Operating Cost at or below £1,300,000.',
    'Keep Customer Support Operating Cost at most £1,300,000.',
    'Keep Customer Support Operating Cost below £1,300,000.',
    'Keep Customer Support Operating Cost under £1,300,000.',
    'Set the maximum Customer Support Operating Cost to £1,300,000.',
  ])('retains the inverse ceiling direction: %s', (input) => {
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetName: 'Customer Support Operating Cost', operator: '<=',
      value: 1300000, unit: '£', valueFrame: 'level', sourceQuote: input.slice(0, -1),
    });
    expectAmountSpan(input, input.indexOf('£1,300,000'), '£1,300,000', rows[0]);
  });

  it.each([
    ['Keep Cash at least £0.', '£0', 0, '£'],
    ['Set minimum Annual Revenue to $1.25m.', '$1.25m', 1250000, '$'],
    ['Keep Margin at least 30%.', '30%', 0.3, '%'],
  ] as const)('uses existing amount arithmetic without inventing a baseline: %s', (input, amount, value, unit) => {
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ operator: '>=', value, unit, valueFrame: 'level' });
    expectAmountSpan(input, input.indexOf(amount), amount, rows[0]);
  });

  it('retains the ordinary above command for direct grounding', () => {
    const input = 'Keep Funding Amount Secured above £1.3m.';
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetName: 'Funding Amount Secured', operator: '>=', value: 1300000,
      unit: '£', valueFrame: 'level', sourceQuote: input.slice(0, -1),
    });
    expectAmountSpan(input, input.indexOf('£1.3m'), '£1.3m', rows[0]);
  });

  it.each([
    'Keep at or above £1,300,000.',
    'Keep it at or above £1,300,000.',
    'Keep Revenue or Cash at or above £1,300,000.',
    'Keep Revenue and Cash at or above £1,300,000.',
    'Keep "Funding Amount Secured at or above £1,300,000.',
    'Set the minimum to £1,300,000.',
    'Set the maximum to £1,300,000.',
    'Do not keep Funding Amount Secured at or above £1,300,000.',
    'Do not keep Cost at most £1,300,000.',
  ])('withholds malformed, ambiguous or negated subjects without fallback guesses: %s', (input) => {
    expect(extract(input)).toEqual([]);
  });

  it.each([
    'Keep revenue at or above £2m and keep costs at or below £1m.',
    'Keep costs at or below £1m and keep revenue at or above £2m.',
    'Set the minimum revenue to £2m and set the maximum costs to £1m.',
    'Set the maximum costs to £1m and set the minimum revenue to £2m.',
  ])('keeps each complete command separate in either pass order: %s', (input) => {
    const rows = extract(input);
    expect(rows).toHaveLength(2);
    const revenue = rows.find((row) => row.targetName === 'revenue')!;
    const costs = rows.find((row) => row.targetName === 'costs')!;
    expect(revenue).toMatchObject({ operator: '>=', value: 2000000, unit: '£', valueFrame: 'level' });
    expect(costs).toMatchObject({ operator: '<=', value: 1000000, unit: '£', valueFrame: 'level' });
    expect(revenue.sourceQuote).not.toMatch(/\band\b/);
    expect(costs.sourceQuote).not.toMatch(/\band\b/);
    expectAmountSpan(input, input.indexOf('£2m'), '£2m', revenue);
    expectAmountSpan(input, input.indexOf('£1m'), '£1m', costs);
  });

  it('uses capture positions when identical amounts occur more than once', () => {
    const input = '  Keep Revenue at least £2m and keep Cash at least £2m.';
    const rows = extract(input);
    expect(rows).toHaveLength(2);
    expectAmountSpan(input, input.indexOf('£2m'), '£2m', rows.find((row) => row.targetName === 'Revenue')!);
    expectAmountSpan(input, input.lastIndexOf('£2m'), '£2m', rows.find((row) => row.targetName === 'Cash')!);
  });

  it('preserves a quoted label with operator words and punctuation', () => {
    const input = 'Keep "Revenue above £2m, net of costs" at least £1m.';
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetName: 'Revenue above £2m, net of costs', value: 1000000, unit: '£' });
    expectAmountSpan(input, input.indexOf('£1m'), '£1m', rows[0]);
  });

  it.each([
    ['Keep "Costs below £2m" at or above £1m.', 'Costs below £2m', '>='],
    ['Keep   "Costs below £2m" at or above £1m.', 'Costs below £2m', '>='],
    ['Keep "Revenue above £2m" at or below £1m.', 'Revenue above £2m', '<='],
  ] as const)('claims the full quoted target before either legacy direction: %s', (input, targetName, operator) => {
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetName, operator, value: 1000000, unit: '£', sourceQuote: input.slice(0, -1) });
    expectAmountSpan(input, input.indexOf('£1m'), '£1m', rows[0]);
  });

  it('does not truncate a new command quote before its supporting amount', () => {
    const target = `Revenue ${'for the operating region '.repeat(10)}forecast`.trim();
    const input = `Keep "${target}" at or above £2m.`;
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetName: target, sourceQuote: input.slice(0, -1), value: 2000000 });
    expect(rows[0].sourceQuote.length).toBeGreaterThan(200);
    expectAmountSpan(input, input.indexOf('£2m'), '£2m', rows[0]);
  });

  // The extractor reports factual syntax, including proposals and quotations.
  // Its existing `explicit` provenance is not user adoption: the caller must
  // establish that separately from the complete conversational context.
  it.each([
    'If we keep Funding Amount Secured at or above £1,300,000, we could proceed.',
    'She proposed: "Keep Funding Amount Secured at or above £1,300,000."',
  ])('retains a syntax candidate without resolving conversational authority: %s', (input) => {
    const rows = extract(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetName: 'Funding Amount Secured', operator: '>=', value: 1300000, unit: '£' });
    expectAmountSpan(input, input.indexOf('£1,300,000'), '£1,300,000', rows[0]);
  });
});
