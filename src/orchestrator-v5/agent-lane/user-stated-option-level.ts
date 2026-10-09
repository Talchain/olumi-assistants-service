import type { CandidateModel } from './admit-model.js';
import { countsInWords } from './stated-by-user.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';

type Intervention = NonNullable<CandidateModel['options'][number]['interventions']>[number];

/** Verify unique verbatim substrings. The shared amount readers have no text normaliser: exact match. */
export function userStatedOptionLevel(intervention: Intervention, brief: string | undefined): boolean {
  const e = intervention.stated_evidence;
  if (typeof brief !== 'string' || e == null || typeof e.quote !== 'string' || typeof e.option_quote !== 'string'
    || e.quote === '' || e.option_quote === '') return false;
  const quoteAt = brief.indexOf(e.quote);
  const optionAt = e.quote.indexOf(e.option_quote);
  if (quoteAt < 0 || brief.indexOf(e.quote, quoteAt + 1) >= 0
    || optionAt < 0 || e.quote.indexOf(e.option_quote, optionAt + 1) >= 0) return false;
  // Same readers as stated-by-user.ts; offsets are model-written and are not evidence.
  return [...findStatedAmounts(e.option_quote), ...countsInWords(e.option_quote)]
    .some(a => a.magnitude === intervention.value);
}
