/**
 * ⭐ G — A CHANGE TARGET'S CONDITIONAL CHANCE ON A STATIC MODEL (AIE #94 6128697025, "S4/S8 — D timing decision"; amendments
 * 6131950992 (b)–(d), 12 Oct 2026).
 *
 * A static model may support a CONDITIONAL chance of a change target "by month N" under a disclosed assumption that its
 * estimated effects have occurred by then. The assumption is OLUMI'S, never the person's: the stored basis keeps
 * `effects_at_period_end: false` (it is never flipped as human evidence), and the chance carries {@link periodEndAssumptionNote}.
 * The licence decides whether the reading applies (`periodEndConditionalOf`, `goal-chance-licence.ts`); this module holds
 * only its two pieces of words-and-grammar:
 *
 *  · the AIE's note, exactly, for the STATIC timing-assumption reading only (amendment (b): a producer that models arrival,
 *    or sizes its effects at the period, says its own timing instead);
 *  · the ONE contradiction the brief can state (amendment (c)): a stated PARTIAL or LATE EFFECT by the period — "only half the
 *    productivity gain by month 3", "we won't see the full gain until month 6". A later START alone ("the hires start in
 *    month 2") is NOT a contradiction: the assumption is about where the effects stand by the period, not when they begin.
 *
 * THE INVARIANT (the same as `time-class.ts`): A DETECTION CAN ONLY WITHHOLD. It never credits, computes or licenses anything;
 * a brief the closed grammar below does not recognise behaves as if it stated no contradiction, and amendment (d) (an unread
 * source is never "no contradiction") is the caller's: no readable brief, no conditional chance. Pure.
 */
import { periodEndWords, type GoalTargetBasis } from './goal-target-basis.js';

/** The AIE's note, verbatim, with {period} as the period-end words E's withhold uses ("month three"). Said once per result. */
export const PERIOD_END_ASSUMPTION_NOTE_TEMPLATE = 'Provisional: this calculation assumes the estimated effects are in place by {period}. It does not model when they arrive.';

export function periodEndAssumptionNote(basis: Pick<GoalTargetBasis, 'reference' | 'period_months'>): string {
  return PERIOD_END_ASSUMPTION_NOTE_TEMPLATE.replace('{period}', periodEndWords(basis));
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const COUNT = `(?:\\d{1,3}|${NUMBER_WORDS.join('|')})`;
const countOf = (word: string): number => (/^\d+$/.test(word) ? Number(word) : NUMBER_WORDS.indexOf(word.toLowerCase()));
/** "month 3", "month three", "3 months", "three months", "the first three months", "the end of month 3". */
const MONTH_REF = `(?:(?:the\\s+)?end\\s+of\\s+)?(?:month\\s+(${COUNT})|(?:the\\s+first\\s+)?(${COUNT})\\s+months?)`;
/** An effect that a hire or change brings, as a person names it. */
const EFFECT = '(?:gains?|effects?|benefits?|improvements?|impacts?|increases?|uplifts?|boosts?|difference)';
/** A share of the effect that is not all of it: intrinsically partial, or a figure qualified by "only"/"just". */
const PARTIAL = '(?:(?:only|just)\\s+(?:about\\s+|around\\s+|roughly\\s+)?(?:\\d{1,2}(?:\\.\\d+)?\\s?(?:%|per\\s?cent)|half|a\\s+third|a\\s+quarter|two\\s+thirds|some|part|a\\s+(?:fraction|portion|part))'
  + '|half|a\\s+third|a\\s+quarter|two\\s+thirds|partial|part(?=\\s+of\\b)|some(?=\\s+of\\b)|a\\s+(?:fraction|portion|part)(?=\\s+of\\b))';
/** "Only half the productivity gain by month 3"; "a partial effect by the end of month three". */
const PARTIAL_BY = new RegExp(`\\b${PARTIAL}\\s+(?:of\\s+)?(?:the\\s+|its\\s+|their\\s+|that\\s+|this\\s+)?(?:[\\p{L}-]+\\s+){0,2}?${EFFECT}\\b[^.;!?]{0,60}?\\b(?:by|in|within|at)\\s+${MONTH_REF}`, 'giu');
/** "We won't see the full gain until month 6"; "the full effect only arrives after month 4". */
const FULL_LATE = new RegExp(`\\b(?:full|whole|entire|complete)\\s+(?:[\\p{L}-]+\\s+){0,2}?${EFFECT}\\b[^.;!?]{0,40}?\\b(until|after|from|not\\s+before|by)\\s+${MONTH_REF}`, 'giu');
/** "won't be fully productive by month 3"; "the developers will not be up to full speed until month five". */
const NOT_FULL_BY = new RegExp(`\\b(?:not|never|won['’]t|wouldn['’]t|isn['’]t|aren['’]t|can['’]t|cannot)\\b[^.;!?]{0,30}?\\b(?:fully|full|completely|entirely)\\b[^.;!?]{0,30}?\\b(by|until)\\s+${MONTH_REF}`, 'giu');

/** The period a month reference names, or undefined. */
function monthsOf(match: RegExpMatchArray, from: number): number | undefined {
  const word = match[from] ?? match[from + 1];
  if (word === undefined) return undefined;
  const n = countOf(word);
  return n >= 0 ? n : undefined;
}

/**
 * The person's own phrase stating that the effects are only PARTLY in place by the period, or arrive AFTER it; undefined when
 * the brief states neither (or cannot be read: the caller then withholds, amendment (d)). Bound to the basis' own period.
 */
export function statedPartialOrLateEffect(brief: string, basis: Pick<GoalTargetBasis, 'period_months'>): string | undefined {
  const period = basis.period_months;
  const said = (m: RegExpMatchArray): string => m[0].replace(/\s+/gu, ' ').trim();
  for (const m of brief.matchAll(PARTIAL_BY)) {
    const n = monthsOf(m, 1);
    // Only part of it by the period, or by a later month (so less still by the period); "half by month 2" says nothing of month 3.
    if (n !== undefined && n >= period) return said(m);
  }
  for (const m of brief.matchAll(FULL_LATE)) {
    const n = monthsOf(m, 2);
    const word = m[1]!.toLowerCase().replace(/\s+/gu, ' ');
    // The full effect only after a month at or past the period, or from / by / not until / not before a month past it.
    if (n !== undefined && (word === 'after' ? n >= period : n > period)) return said(m);
  }
  for (const m of brief.matchAll(NOT_FULL_BY)) {
    const n = monthsOf(m, 2);
    // Not full BY a month at or past the period; not full UNTIL a month past it.
    if (n !== undefined && (m[1]!.toLowerCase() === 'by' ? n >= period : n > period)) return said(m);
  }
  return undefined;
}
