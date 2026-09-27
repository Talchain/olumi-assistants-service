/**
 * ⛔ A FIELD PATH IS NOT USER COPY (AIC #70 5852012649). The served item on CEE `5668902` (Paul's brief), verbatim, is
 * dropped from the drafter's open questions; plain questions — including "e.g." — are kept, in order.
 */
import { describe, it, expect } from 'vitest';
import { userFacingDrafterQuestions } from '../runtime/build-model.js';

const SERVED_NOTE = 'The current MRR level was not stated, so goal.baseline_value is intentionally null rather than estimated.';

describe('the drafter\'s open questions never carry a field path', () => {
  it('RED (served 5668902): the drafter note naming goal.baseline_value is dropped', () => {
    expect(userFacingDrafterQuestions([SERVED_NOTE])).toEqual([]);
  });

  it('RED: the UI class (node-id prefixes, 3+-segment snake_case) is dropped too', () => {
    expect(userFacingDrafterQuestions(['Should fac_monthly_churn be modelled per cohort?'])).toEqual([]);
    expect(userFacingDrafterQuestions(['Is monthly_churn_rate measured per cohort?'])).toEqual([]);
  });

  it('CONTRAST: plain questions stay, verbatim and in order — "e.g." and "i.e." are not field paths', () => {
    const plain = [
      'Does "MRR" mean Pro-plan MRR or MRR across all plans, e.g. including Team?',
      'What is current Pro-plan MRR, i.e. before the price change?',
      'How many paying Pro subscribers are there today?',
    ];
    expect(userFacingDrafterQuestions([plain[0], SERVED_NOTE, plain[1], plain[2]])).toEqual(plain);
  });

  it('CONTRAST: not a list, or blank items, gives the empty list it gave before', () => {
    expect(userFacingDrafterQuestions(undefined)).toEqual([]);
    expect(userFacingDrafterQuestions(['', '  ', 3])).toEqual([]);
  });
});
