/**
 * ⭐ G — A CHANGE TARGET'S CONDITIONAL CHANCE ON A STATIC MODEL (AIE #94 6128697025, "S4/S8 — D timing decision"; amendments
 * 6131950992 (b)–(d) and 6133027121, 12 Oct 2026).
 *
 * A static model may support a CONDITIONAL chance of a change target "by month N" under a disclosed assumption that its
 * estimated effects have occurred by then. The assumption is OLUMI'S, never the person's: the stored basis keeps
 * `effects_at_period_end: false` (it is never flipped as human evidence), and the chance carries {@link periodEndAssumptionNote}.
 * The licence decides whether the reading applies (`periodEndConditionalOf`, `goal-chance-licence.ts`); this module holds
 * only its two pieces of words-and-grammar:
 *
 *  · the AIE's note, exactly, for the STATIC timing-assumption reading only (amendment (b): a producer that models arrival,
 *    or sizes its effects at the period, says its own timing instead);
 *  · the ONE contradiction the brief can state (amendment (c)): THIS goal's effect only PARTLY in place by the period, or
 *    arriving AFTER it. A later START alone ("the hires start in month 2") is not one: the assumption is about where the
 *    effects stand by the period, not when the hires begin.
 *
 * THE AIE TIMING CORPUS (#94 6133027121, `tests/fixtures/batch-g/AIE-G-TIMING-PHRASES-20261012.json`) sets what the grammar
 * reads, clause by clause (a `;` ends a clause):
 *  · partial by the period, in either order ("only half the productivity gain by month 3"; "at the end of month three, …
 *    just half of the productivity gain"), or none of it ("none of the modelled productivity benefit … during the first three
 *    months");
 *  · late: the effect starts, arrives or is full only after the period ("will only start to materialise in month four";
 *    "won't see the full gain until month 6"; "takes six months to reach the full productivity improvement"; "won't be fully
 *    productive by month 3");
 *  · NOT a contradiction: a negated partial ("not expecting only half…"), a clause about the past ("last year's programme…"),
 *    another quantity ("the full marketing benefit … until month five"), an upper bound ("the full gain by month six" may
 *    still arrive earlier), and a start alone.
 *
 * THE INVARIANT (the same as `time-class.ts`): A DETECTION CAN ONLY WITHHOLD. It never credits, computes or licenses anything,
 * and NOT_A_CONTRADICTION never attests arrival: a brief the closed grammar does not recognise behaves as if it stated no
 * contradiction, the chance still says Olumi's assumption, and amendment (d) (an unread source is never "no contradiction") is
 * the caller's. Pure.
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
/** "month 3", "month three", "3 months", "the first three months", "the end of month 3". */
const MONTH_REF = `(?:(?:the\\s+)?end\\s+of\\s+)?(?:month\\s+(?<mn>${COUNT})|(?:the\\s+(?:first|next)\\s+)?(?<mc>${COUNT})\\s+months?)`;
/** An effect that a hire or change brings, as a person names it. */
const EFFECT = '(?<eff>(?:gain|effect|benefit|improvement|impact|increase|uplift|boost)s?|difference)';
const WORDS = (n: number): string => `(?:[\\p{L}'’-]+\\s+){0,${n}}?`;
/** A share of the effect that is not all of it: intrinsically partial, or a figure qualified by "only"/"just". */
const PARTIAL = '(?:(?:only|just)\\s+(?:about\\s+|around\\s+|roughly\\s+)?(?:\\d{1,2}(?:\\.\\d+)?\\s?(?:%|per\\s?cent)|half|a\\s+third|a\\s+quarter|two\\s+thirds|some|part|a\\s+(?:fraction|portion|part))'
  + '|half|a\\s+third|a\\s+quarter|two\\s+thirds|partial|part(?=\\s+of\\b)|some(?=\\s+of\\b)|a\\s+(?:fraction|portion|part)(?=\\s+of\\b))';
const FULL = '(?:full|fully|whole|entire|complete|completely|entirely)';
const ONSET = '(?:start(?:s|ing)?|begin(?:s|ning)?|materiali[sz]e[sd]?|kick(?:s|ing)?\\s+in|takes?\\s+effect|arrives?|appears?|comes?\\s+through|shows?\\s+up)';

/** Which month counts against the period P: at or past it, or strictly past it (a full effect AT the period is in place). */
type MonthRule = 'at_or_after' | 'after';
interface Rule {
  readonly re: RegExp;
  /** The rule for this match's month, from its preposition where it has one. */
  readonly month: (prep: string | undefined) => MonthRule;
  /** A negation just before the phrase flips it ("not expecting only half…"); off where the negation IS the claim. */
  readonly negatable: boolean;
}
const re = (source: string): RegExp => new RegExp(source, 'giud');
const RULES: readonly Rule[] = [
  // Partial by the period: "only half the productivity gain by month 3".
  { re: re(`\\b${PARTIAL}\\s+(?:of\\s+)?${WORDS(3)}${EFFECT}\\b[^.;!?]{0,60}?\\b(?:by|in|within|at)\\s+${MONTH_REF}`), month: () => 'at_or_after', negatable: true },
  // The same, time first: "at the end of month three, we will have achieved just half of the productivity gain".
  { re: re(`\\b(?:by|in|within|at)\\s+${MONTH_REF}[^.;!?]{0,60}?\\b${PARTIAL}\\s+(?:of\\s+)?${WORDS(3)}${EFFECT}\\b`), month: () => 'at_or_after', negatable: true },
  // None of it during the period: "none of the modelled productivity benefit is available during the first three months".
  { re: re(`\\b(?:none\\s+of|no)\\s+${WORDS(3)}${EFFECT}\\b[^.;!?]{0,60}?\\b(?:during|in|within|by|before)\\s+${MONTH_REF}`), month: () => 'at_or_after', negatable: false },
  // The full effect only later: "won't see the full gain until month 6"; "only arrives after month 3". "By month six" alone is an
  // upper bound (it may arrive earlier), never "not before".
  { re: re(`\\b${FULL}\\s+${WORDS(3)}${EFFECT}\\b[^.;!?]{0,40}?\\b(?<prep>until|after|from|not\\s+before|only\\s+by)\\s+${MONTH_REF}`),
    month: (prep) => (prep === 'after' ? 'at_or_after' : 'after'), negatable: false },
  // The effect starts or arrives only later: "the assumed productivity uplift will only start to materialise in month four".
  { re: re(`\\b${WORDS(3)}${EFFECT}\\b[^.;!?]{0,40}?\\b${ONSET}\\b[^.;!?]{0,30}?\\b(?<prep>in|from|at|after|until|not\\s+before)\\s+${MONTH_REF}`),
    month: (prep) => (prep === 'after' ? 'at_or_after' : 'after'), negatable: true },
  // Time to the full effect: "it takes six months to reach the full productivity improvement".
  { re: re(`\\b(?:takes?|taking|will\\s+take|would\\s+take)\\s+(?:about\\s+|around\\s+|roughly\\s+)?(?<mc>${COUNT})\\s+months?\\s+(?:to|before|for)\\b[^.;!?]{0,40}?\\b${FULL}\\s+${WORDS(3)}${EFFECT}\\b`),
    month: () => 'after', negatable: true },
  // Not full by the period: "new developers won't be fully productive by month 3" (not until a month past it).
  { re: re(`\\b(?:not|never|won['’]t|wouldn['’]t|isn['’]t|aren['’]t|can['’]t|cannot)\\b[^.;!?]{0,30}?\\b${FULL}\\b[^.;!?]{0,30}?\\b(?<prep>by|until)\\s+${MONTH_REF}`),
    month: (prep) => (prep === 'by' ? 'at_or_after' : 'after'), negatable: false },
];

/** A negation right before the phrase ("we are not expecting only half…", "no one expects…") means it is NOT stated. */
const NEGATED_BEFORE = /(?:\b(?:not|never|no|without)|n['’]t)\s+(?:[\p{L}'’-]+\s+){0,2}$/iu;
/** A clause about another time or programme ("last year's programme had only half its benefit at month three"). */
const HISTORICAL = /\b(?:last\s+(?:year|time|quarter|round|programme|program|project)|previous(?:ly)?|in\s+the\s+past|historic(?:al(?:ly)?)?|used\s+to)\b/iu;
/** Words that may stand before the effect without naming ANOTHER quantity ("the hires' assumed productivity gain"). */
const NEUTRAL = new Set(['a', 'an', 'the', 'its', 'their', 'this', 'that', 'these', 'those', 'our', 'your', 'any', 'all', 'of', 'only', 'just',
  'about', 'around', 'roughly', 'half', 'third', 'quarter', 'thirds', 'two', 'some', 'part', 'partial', 'none', 'no', 'full', 'whole', 'entire',
  'complete', 'modelled', 'modeled', 'assumed', 'expected', 'estimated', 'entered', 'planned', 'projected', 'stored', 'overall', 'total', 'new',
  'extra', 'additional', 'hires', "hires'", "hires’", 'hire', "hire's", 'hire’s', 'hiring', "team's", 'team’s', "developers'", 'developers’', 'per',
  'cent', 'percent', 'see', 'get', 'reach', 'achieve', 'have', 'will', 'we', 'they', 'it']);

/**
 * The person's own phrase stating that THIS goal's effects are only PARTLY in place by the period, or arrive AFTER it; undefined
 * when the brief states neither. Bound to the basis' own period and to the goal's own quantity (`quantity`, its label): an
 * effect named for another quantity is not this one's. Never called on an unread brief (the caller withholds, amendment (d)).
 */
export function statedPartialOrLateEffect(brief: string, basis: Pick<GoalTargetBasis, 'period_months'>, quantity?: string): string | undefined {
  const period = basis.period_months;
  const own = new Set((quantity ?? '').toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 3));
  const clauses = brief.split(/(?<=[.!?])\s+|;/u).map((c) => c.trim()).filter((c) => c !== '' && !HISTORICAL.test(c));
  for (const clause of clauses) {
    for (const rule of RULES) {
      for (const m of clause.matchAll(rule.re)) {
        const groups = m.groups ?? {};
        const word = groups.mn ?? groups.mc;
        const n = word === undefined ? -1 : countOf(word);
        if (n < 0) continue;
        const kind = rule.month(groups.prep?.toLowerCase().replace(/\s+/gu, ' '));
        if (kind === 'after' ? n <= period : n < period) continue;
        if (rule.negatable && NEGATED_BEFORE.test(clause.slice(0, m.index))) continue;
        const at = m.indices?.groups?.eff?.[0];
        if (at !== undefined) {
          // Another quantity's effect ("the full marketing benefit") is not this goal's.
          const before = clause.slice(0, at).trim().split(/\s+/u).slice(-2).map((w) => w.toLowerCase().replace(/[,]/gu, ''));
          if (before.some((w) => w !== '' && !NEUTRAL.has(w) && !own.has(w) && !/^\d/u.test(w))) continue;
        }
        return m[0].replace(/\s+/gu, ' ').trim();
      }
    }
  }
  return undefined;
}
