import type { CandidateModel } from './admit-model.js';
import { countsInWords } from './stated-by-user.js';
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';

type Intervention = NonNullable<CandidateModel['options'][number]['interventions']>[number];

/** Verify the draft's evidence against the original UTF-16 spans; never repair offsets or infer a level. */
export function userStatedOptionLevel(intervention: Intervention, brief: string | undefined): boolean {
  const e = intervention.stated_evidence;
  if (typeof brief !== 'string' || e == null || typeof e.quote !== 'string' || typeof e.option_quote !== 'string'
    || e.quote === '' || e.option_quote === '') return false;
  if (![e.start, e.end, e.amount_start, e.option_start, e.option_end].every(Number.isInteger)) return false;
  if (e.start < 0 || e.end > brief.length || brief.slice(e.start, e.end) !== e.quote
    || e.option_start < e.start || e.option_end > e.end
    || brief.slice(e.option_start, e.option_end) !== e.option_quote) return false;
  // Both readers are shared with stated-by-user.ts. Ownership here is the verified option span,
  // including elliptical allocations ("split them three and three"); no new prose grammar.
  return [...findStatedAmounts(e.option_quote), ...countsInWords(e.option_quote)].some(a =>
    e.option_start + a.index === e.amount_start && a.magnitude === intervention.value
    && e.amount_start + a.matchedText.length <= e.option_end);
}
