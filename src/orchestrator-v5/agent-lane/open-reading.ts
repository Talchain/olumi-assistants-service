/**
 * ⭐ AIE 6186002237 (S5 amend of the DL's neighbour ruling; DL ruling (a)): a figure the user ALSO qualified, read the same way at
 * construction (the draft's source map) and on the Run (the statements recorded on the subject). A leaf: the licence and
 * admission both read it, so it imports nothing that could close a cycle. Pure.
 */
import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { CARDINAL_AMOUNT_SOURCE, parseCardinalAmount } from '../../utils/cardinal-words.js';
import { singular } from './same-unit.js';
import type { UserStatement } from './user-statements.js';

/** Figure-free forms that state a condition, never a qualification of a figure. */
const CONDITION_FORMS = new Set<string>(['holds_now']);

/** Whether a sentence writes this magnitude, in digits or spelled (the source map's own reading of a quote's figures). */
function writesFigure(quote: string, figure: number): boolean {
  const spelled = [...quote.matchAll(new RegExp(`\\b(?:${CARDINAL_AMOUNT_SOURCE})\\b`, 'gi'))].map((m) => parseCardinalAmount(m[0]));
  return [...findStatedAmounts(quote).map((a) => a.magnitude), ...spelled].some((m) => m !== null && Math.abs(m) === Math.abs(figure));
}

/**
 * The user's statements on ONE subject and field that qualify its figure without one ("That's last year's figure, though."): a
 * statement with no figure, in a sentence that does not write the figure. The figure stays the user's, flagged as not settled.
 * A sentence writing the same figure again is no conflict; a condition that holds now is not a qualification.
 */
export function openReadingsOf(statements: readonly UserStatement[], figure: number): readonly UserStatement[] {
  return statements.filter((s) => s.low === undefined && s.high === undefined && !CONDITION_FORMS.has(s.form) && !writesFigure(s.quote, figure));
}

/** The DL's ruled words (ruling (a)) for such a figure: asked on the build, and noted on the Run's licence. */
export function openReadingQuestion(quote: string, amount: number, perUnit: string | undefined): string {
  const per = typeof perUnit === 'string' && perUnit.trim() !== '' ? ` per ${singular(perUnit.trim())}` : '';
  return `You also said ‘${quote.trim()}’: is ${amount}${per} still right?`;
}
