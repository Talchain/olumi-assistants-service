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
 * TRANSIENT (DL condition (a)): the result is only asked, in this construction turn, through the existing deadline question.
 * Nothing is stored: no `goal_deadline_as_stated`, no `goal_horizon_months`. Any claim that fails a check is not asked.
 */
import { wholeStatementIn } from '../goal-target/input-claim-context.js';
import { quoteSpansIn } from './stated-by-user.js';

export interface CalendarDeadlineClaim {
  /** The drafter's words for the deadline, verbatim inside `quote`. */
  readonly words: string;
  /** The goal's own statement, a whole statement of the brief: what identifies "that quarter". */
  readonly quote: string;
}

export function calendarDeadlineClaim(
  brief: string,
  goal: { readonly horizon_months?: unknown; readonly source_quote?: unknown; readonly deadline_words?: unknown } | null | undefined,
): CalendarDeadlineClaim | undefined {
  const words = typeof goal?.deadline_words === 'string' ? goal.deadline_words.trim() : '';
  const quote = typeof goal?.source_quote === 'string' ? goal.source_quote.trim() : '';
  // A month count is the attested path's, never this one's: a claim beside one is incoherent and not asked.
  if (words === '' || quote === '' || goal?.horizon_months !== null) return undefined;
  if (!wholeStatementIn(brief, quote)) return undefined;
  return quoteSpansIn(quote, words).length > 0 ? { words, quote } : undefined;
}
