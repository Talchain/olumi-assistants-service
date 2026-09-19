import { describe, expect, it } from 'vitest';
import { deriveBaselineLimitChange, hasBaselineIndependentMutationWarrant } from '../baseline-answer-mutation.js';

describe('independent instruction on a baseline-answer turn', () => {
  it.each(['Churn rate is 30%.', 'Churn rate is at 30%.', 'Churn is about 30% today.'])(
    'does not borrow an edit warrant from the current-level statement: %s', (message) => {
      expect(hasBaselineIndependentMutationWarrant(message)).toBe(false);
      expect(deriveBaselineLimitChange(message, 'Churn rate', [])).toBeUndefined();
    },
  );

  it.each([
    'Churn rate is 30%. Set the limit to at most 25%.',
    'Churn rate is at 30%. Set the limit to at most 25%.',
    'Churn rate is 30% today. Set the limit to at most 25%.',
    'Churn rate is 30% right now. Set the limit to at most 25%.',
    'Churn rate is 30%. Keep churn under 25%.',
  ])('binds the independent percentage limit: %s', (message) => {
    expect(hasBaselineIndependentMutationWarrant(message)).toBe(true);
    expect(deriveBaselineLimitChange(message, 'Churn rate', ['Win rate'])).toEqual({
      constraint_type: 'at_most', value: 25, unit: '%', value_frame: 'level',
    });
  });

  it.each([
    'Churn rate is 30%. Rename the pilot to Launch.',
    'Churn rate is 30%. Keep win rate under 25%.',
    'Churn rate is 30%. Keep competitor churn under 25%.',
    'Churn rate is 30%. Rename the pilot. Churn under 25%.',
    'Churn rate is 30%. Set the limit to at most 25% or 35%.',
    'Churn rate is 30%. Set the limit to at most £25.',
    'Churn rate is 30%. Do not change the limit to at most 25%.',
  ])('does not turn a general warrant into authority over this limit: %s', (message) => {
    expect(deriveBaselineLimitChange(message, 'Churn rate', ['Win rate'])).toBeUndefined();
  });
});
