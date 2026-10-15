/**
 * ⛔ CASE ONLY (served cohort witness 2026-10-15T064726Z, CEE 87d5f90e): the saved goal is ‘conversion rate’; the same-people
 * answer named it ‘Conversion rate’ and `propose_statement` refused `subject_not_found`, so the cohort chain never started.
 * A label differing only by letter case names ONE node when exactly one matches; two such matches stay ambiguous; an exact
 * match always wins; nothing else is loosened (DL 15 Oct: no fuzzy, spacing or wording match).
 */
import { describe, expect, it } from 'vitest';
import { resolveSubject } from '../subject.js';

const graph = {
  nodes: [
    { id: 'conversion_rate', kind: 'goal', label: 'conversion rate' },
    { id: 'price_a', kind: 'factor', label: 'Price' },
    { id: 'price_b', kind: 'factor', label: 'price' },
  ],
  edges: [],
};
const goal = (label: string) => resolveSubject(graph, { kind: 'goal', label, field: 'relation' } as never);
const factor = (label: string) => resolveSubject(graph, { kind: 'factor', label, field: 'level' } as never);

describe('resolveSubject: a case-only label difference resolves when unique, and nothing else is loosened', () => {
  it('RED (served): ‘Conversion rate’ names the goal ‘conversion rate’', () => {
    expect(goal('Conversion rate')).toMatchObject({ kind: 'resolved', subject: { id: 'conversion_rate' } });
    expect(goal('CONVERSION RATE')).toMatchObject({ kind: 'resolved', subject: { id: 'conversion_rate' } });
  });
  it('CONTRAST: two nodes differing only by case are ambiguous for a third spelling; an exact match still wins', () => {
    expect(factor('PRICE')).toEqual({ kind: 'unresolved', reason: 'ambiguous' });
    expect(factor('Price')).toMatchObject({ kind: 'resolved', subject: { id: 'price_a' } });
    expect(factor('price')).toMatchObject({ kind: 'resolved', subject: { id: 'price_b' } });
  });
  it('CONTRAST: no fuzzy, spacing or wording match', () => {
    for (const near of ['Conversion rates', 'conversion  rate', 'conversion-rate', 'Conversion']) {
      expect(goal(near), near).toEqual({ kind: 'unresolved', reason: 'not_found' });
    }
  });
});
