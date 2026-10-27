/**
 * ⭐ ATTRIBUTION FROM THE USER'S PRESS, NEVER FROM PARSING (B2-c; DL re-scope 12 Oct after the third free-text attribution
 * failure; PL #94 6131809231; AIE #94 6132054663). One mechanism for ANY figure Olumi reads out of the user's own words: team
 * time today, factor ranges next (DL: "I accept the consultant's range of 20% to 30%" was stamped the user's by sentence
 * parsing). Three parts, each the only one of its kind:
 *   1. {@link verbatimSourceLine} proves only that the quoted words exist VERBATIM in one of the user's own typed lines
 *      (anti-fabrication) and returns that complete line. It never decides whose figure it is.
 *   2. The card says {@link confirmationQuoteLine} (the AIE's exact quote line) before its own question. Until the press it is
 *      a proposed interpretation, never "your forecast" or "your range".
 *   3. An operation that carries a `confirmation` is CARD-ONLY ({@link carriesQuoteConfirmation}, read by
 *      `hasCardOnlyOperations`): only the press on that card adopts it — never the Agent's reading of a typed yes, a reseeded
 *      message or another card. The write records a NEW selection ({@link confirmedSelection}) made at the press, linked to the
 *      source line and to Olumi's reading of it; the source is unchanged and never relabelled as an earlier human fact.
 */
import { quoteSpansIn } from './quote-spans.js';

/** The user's complete source line, exactly as typed (qualifiers, negation, bounds kept), and the words quoted from it. */
export interface QuoteConfirmation {
  readonly source: string;
  readonly quote: string;
}

/** Typographic quotes, dashes and runs of spaces read alike; nothing else is normalised. */
export const plainQuoteWords = (t: string): string =>
  t.replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/[ \t]+/g, ' ').trim();

/** The MOST RECENT line of the user's own typed words that holds `quote` verbatim; `undefined` when none does. */
export function verbatimSourceLine(texts: { readonly now?: string | null; readonly conversation?: string | null }, quote: string): string | undefined {
  const q = plainQuoteWords(quote);
  if (q === '') return undefined;
  const lines = [texts.conversation, texts.now].flatMap((t) => (typeof t === 'string' ? t.split('\n') : []));
  const source = [...lines].reverse().find((l) => quoteSpansIn(plainQuoteWords(l), q).length > 0)?.trim();
  return source === undefined || source === '' ? undefined : source;
}

/** The AIE's exact quote line (#94 6132054663): "From your message: ‘{complete_verbatim_source}’". */
export function confirmationQuoteLine(c: QuoteConfirmation): string {
  return `From your message: ‘${c.source}’`;
}

/** The selection the press records: the user's, made at the press, of Olumi's reading of their source line. */
export function confirmedSelection(c: QuoteConfirmation): { readonly by: 'user_press'; readonly interpretation: 'olumi'; readonly source: string; readonly quote: string } {
  return { by: 'user_press', interpretation: 'olumi', source: c.source, quote: c.quote };
}

/** Any operation whose value carries a `confirmation` is adopted only by its own card's press (fail closed on its shape). */
export function carriesQuoteConfirmation(op: { readonly value?: unknown }): boolean {
  return op.value !== null && typeof op.value === 'object' && Object.hasOwn(op.value, 'confirmation');
}
