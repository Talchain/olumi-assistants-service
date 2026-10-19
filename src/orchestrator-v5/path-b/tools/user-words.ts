/**
 * PATH-B: the ONE literal check the adapters make on the user's words (C5, 19 Oct 2026). The host verifies only that the
 * bytes are literally in the user's own typed messages (`quoteSpansIn`, the existing literal matcher). It proves the words
 * are the user's bytes, never who said the claim or that it is current (PL 14:41Z): authorship stays as declared and read.
 */
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import { plainQuoteWords } from '../../agent-lane/quote-confirmation.js';
import { quoteSpansIn } from '../../agent-lane/stated-by-user.js';

export type TypedWords = Pick<AgentToolContext, 'verified_user_messages' | 'user_turn_text'>;

const typedMessages = (ctx: TypedWords): string[] =>
  [...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text === undefined ? [] : [ctx.user_turn_text])];

export function inTheUsersWords(words: string, ctx: TypedWords): boolean {
  const said = plainQuoteWords(words);
  return said !== '' && typedMessages(ctx).some((m) => quoteSpansIn(plainQuoteWords(m), said).length > 0);
}

/**
 * BYTES ONLY (#3471 R2, DL-3): the quote is an exact span of one typed message as typed. No spacing, dash or quote mark is folded.
 * Used where the user's words are NOT re-read afterwards (the goal's current level on B), so the quote is the only evidence.
 */
export function verbatimInTheUsersWords(words: string, ctx: TypedWords): boolean {
  return words !== '' && typedMessages(ctx).some((m) => quoteSpansIn(m, words).length > 0);
}
