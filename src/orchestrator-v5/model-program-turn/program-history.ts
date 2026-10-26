/**
 * What a program turn knows of the conversation before it, from the scenario's durable answer rows: the person's proven typed
 * words (the program tools' quote check, `program-tools.ts`) and the earlier turns that open the agent's Conversation
 * (`sdk-turn.ts`). Nothing else on a program turn reads the conversation, so the Living Model's history window
 * (`agent-lane/history-store.ts`) never runs on one (ALPHA-CODE-INVENTORY §1 F7). Same values as that window gave these two
 * readers (`__tests__/program-history.test.ts`).
 */
import { isAgentAnswerRow } from '../session/conversation-as-seen.js';

/** The raw rows a turn reads so that {@link EARLIER_TURNS} answer rows survive the drop of claim and sub-turn rows. */
export const PROGRAM_HISTORY_ROWS_READ = 100;
/** The answer rows that open the agent's Conversation. */
const EARLIER_TURNS = 20;
/** How many typed messages ground the quote check. */
const TYPED_WORDS = 40;

export type DurableRow = { request_hash?: string | null; user_message?: string | null; assistant_message?: string | null };
export type EarlierTurn = { readonly role: 'user' | 'assistant'; readonly text: string };

/**
 * `rows` newest first, as `readRecent` returns them. ⛔ Only the agent's OWN answer rows: a sub-turn's row carries a tool's
 * reason as `user_message`, words the person never wrote. `typed` is the route's proof that a row's words were typed
 * (`typedRowProof`); every other row's words are never the person's.
 */
export function programHistoryOf(rows: readonly DurableRow[], typed: (row: DurableRow) => boolean): {
  readonly verified: readonly string[]; readonly earlierTurns: readonly EarlierTurn[];
} {
  const answers = [...rows].reverse().filter((t) => isAgentAnswerRow(t) && (!!t.user_message?.trim() || !!t.assistant_message?.trim()));
  return {
    verified: answers.flatMap((t) => (t.user_message?.trim() && typed(t) ? [t.user_message] : [])).slice(-TYPED_WORDS),
    earlierTurns: answers.slice(-EARLIER_TURNS).flatMap((t): EarlierTurn[] => [
      ...(t.user_message?.trim() ? [{ role: 'user' as const, text: t.user_message }] : []),
      ...(t.assistant_message?.trim() ? [{ role: 'assistant' as const, text: t.assistant_message }] : []),
    ]),
  };
}
