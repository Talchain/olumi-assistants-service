/**
 * PATH-B: the ONE literal check the adapters make on the user's words (C5, 19 Oct 2026). The host verifies only that the
 * bytes are literally in the user's own typed messages (`quoteSpansIn`, the existing literal matcher). It proves the words
 * are the user's bytes, never who said the claim or that it is current (PL 14:41Z): authorship stays as declared and read.
 */
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import { plainQuoteWords } from '../../agent-lane/quote-confirmation.js';
import { quoteSpansIn } from '../../agent-lane/stated-by-user.js';

export type TypedWords = Pick<AgentToolContext, 'verified_user_messages' | 'user_turn_text'>;

export function inTheUsersWords(words: string, ctx: TypedWords): boolean {
  const said = plainQuoteWords(words);
  return said !== '' && [...(ctx.verified_user_messages ?? []), ...(ctx.user_turn_text === undefined ? [] : [ctx.user_turn_text])]
    .some((m) => quoteSpansIn(plainQuoteWords(m), said).length > 0);
}
