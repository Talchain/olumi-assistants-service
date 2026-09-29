import { describe, expect, it } from 'vitest';
import {
  extractCompoundGoals, normaliseConstraintUnits, remapConstraintTargets, toGoalConstraints,
} from '../extractor.js';

describe('noun-form amount occurrence identity', () => {
  it.each([
    'We have a £1500 budget.',
    'We have a budget of £1500.',
    'Our cost ceiling: £1500.',
    'Our budget is £1500.',
  ])('retains the existing amount capture for %s', (brief) => {
    const row = extractCompoundGoals(brief, { includeProxies: false }).constraints.find((c) => c.sourceAmountSpan);
    expect(row).toMatchObject({ value: 1500, unit: '£', operator: '<=', valueFrame: 'level', sourceQuote: brief });
    expect(row!.sourceAmountSpan).toEqual({ start: brief.indexOf('£1500'), end: brief.indexOf('£1500') + 5 });
  });

  it('retains the selected amount position when the evidence sentence has two budgets', () => {
    const brief = '  We have a $40,000 budget for travel and a $20,000 budget for hiring.  ';
    const row = extractCompoundGoals(brief, { includeProxies: false }).constraints.find((c) => c.targetName === 'budget')!;
    expect(row).toMatchObject({ value: 20000, unit: '$', sourceQuote: brief.trim() });
    expect(row.sourceAmountSpan).toEqual({ start: brief.indexOf('$20,000'), end: brief.indexOf('$20,000') + 7 });
    expect(brief.slice(row.sourceAmountSpan!.start, row.sourceAmountSpan!.end)).toBe('$20,000');
    const remapped = remapConstraintTargets([row], ['budget_node'], new Map([['budget_node', 'Budget']]));
    const normalized = normaliseConstraintUnits(remapped.constraints);
    expect(normalized[0]).toMatchObject({ targetNodeId: 'budget_node', sourceAmountSpan: row.sourceAmountSpan });
    expect(toGoalConstraints(normalized)[0]).not.toHaveProperty('sourceAmountSpan');
  });

  it('preserves the actual selected occurrence when identical amounts repeat', () => {
    const brief = 'We have a $20,000 budget for travel and a $20,000 budget for hiring.';
    const row = extractCompoundGoals(brief, { includeProxies: false }).constraints.find((c) => c.targetName === 'budget')!;
    expect(row.sourceAmountSpan).toEqual({ start: brief.indexOf('$20,000'), end: brief.indexOf('$20,000') + 7 });
    expect(row.sourceAmountSpan!.start).not.toBe(brief.lastIndexOf('$20,000'));
  });
});
