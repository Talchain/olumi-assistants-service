/**
 * ⭐ GEN D4 ITEM B: A CALENDAR DEADLINE IS ASKED, NEVER COUNTED (DL GO 14 Oct; AIE D4_B text, packet fc17c200).
 *
 * The drafter leaves `goal.horizon_months` null for a calendar point ("by the end of that quarter"), but null also means
 * "no deadline", and `attestHorizon` does not read every calendar point (its CALENDAR_POINT misses "that quarter", and stays
 * as it is: no word ladder). So the drafter CLAIMS the point (`goal.deadline_words`) and the host checks the claim against
 * the goal's own verified statement (the source contract, `recovery/gen/PLAN.md` 02:0xZ): `goal.source_quote` is a whole
 * statement of the brief (`wholeStatementIn`, #3022), and the claimed words sit, whole words, INSIDE that quote. Words found
 * only elsewhere in the brief (a forecast's "next quarter") are another statement, never the goal's deadline.
 *
 * TRANSIENT (DL condition (a)): the result is only asked, in this construction turn, as Olumi's reading (the AIE's question).
 * Nothing is stored on the goal: no deadline words and no horizon. Any claim that fails a check is not asked.
 */
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { quoteSpansIn } from './stated-by-user.js';

type GoalReading = {
  readonly metric?: unknown; readonly operator?: unknown; readonly value?: unknown; readonly unit?: unknown;
  readonly kind?: unknown; readonly deliverable?: unknown;
  readonly horizon_months?: unknown; readonly source_quote?: unknown; readonly deadline_words?: unknown;
} | null | undefined;

export interface CalendarDeadlineClaim {
  /** The drafter's words for the deadline, verbatim inside `quote`. */
  readonly words: string;
  /** The goal's own statement, a whole statement of the brief: what identifies "that quarter". */
  readonly quote: string;
  /** The adopted goal's name, the one the question asks about. */
  readonly goal: string;
}

/** The governing goal, field by field: a retry that changed any of these re-chose the goal. */
const GOVERNING = ['metric', 'operator', 'value', 'unit', 'kind', 'deliverable'] as const;

/**
 * `first` is the first draft's goal (it alone carries the claim and the quote); `adopted` is the goal the build keeps.
 * ⛔ BOUND TO THE ADOPTED GOAL (AIE #94 6164650110): a first-draft quote is never attached to a governing goal a retry
 * changed; that claim is not asked.
 */
export function calendarDeadlineClaim(brief: string, first: GoalReading, adopted: GoalReading = first): CalendarDeadlineClaim | undefined {
  const words = typeof first?.deadline_words === 'string' ? first.deadline_words.trim() : '';
  const quote = typeof first?.source_quote === 'string' ? first.source_quote.trim() : '';
  const goal = typeof adopted?.metric === 'string' ? adopted.metric.trim() : '';
  // A month count is the attested path's, never this one's: a claim beside one is incoherent and not asked.
  if (words === '' || quote === '' || goal === '' || first?.horizon_months !== null) return undefined;
  if (GOVERNING.some((k) => (first?.[k] ?? null) !== (adopted?.[k] ?? null))) return undefined;
  if (!wholeStatementIn(brief, quote)) return undefined;
  return quoteSpansIn(quote, words).length > 0 ? { words, quote, goal } : undefined;
}
