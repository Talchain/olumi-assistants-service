/**
 * A program turn's history (inventory F7): `programHistoryOf` gives the program's two readers, the quote check's proven typed
 * words and the Conversation's earlier turns, exactly what the Living Model's history window (`history-store.ts`) gave them
 * through `core-turn.ts`, on the same rows. Differential, over rows long enough to pass both windows (the newest 20 answer
 * rows, the newest 40 typed messages), with sub-turn rows, empty words and unproven rows mixed in.
 */
import { describe, expect, it } from 'vitest';
import { programHistoryOf, PROGRAM_HISTORY_ROWS_READ, type DurableRow } from '../program-history.js';
import { DURABLE_SEED_ROWS_READ, HistoryStore, historyFromDurableTurns } from '../../agent-lane/history-store.js';
import { AGENT_ANSWER_REQUEST_HASH_PREFIX } from '../../session/conversation-as-seen.js';

/** What `core-turn.ts` read through the history window before F7, verbatim. */
function legacyOf(rows: readonly DurableRow[], proof: (row: DurableRow) => boolean) {
  const history = new HistoryStore();
  const items = historyFromDurableTurns(rows);
  history.seed('core_s', items, [], rows, proof);
  const earlierTurns = items.flatMap((it) => { const r = it as { role?: unknown; content?: unknown };
    const text = typeof r.content === 'string' ? r.content : Array.isArray(r.content) ? r.content.map((p) => String((p as { text?: unknown }).text ?? '')).join('') : '';
    return (r.role === 'user' || r.role === 'assistant') && text !== '' ? [{ role: r.role, text }] : []; });
  return { verified: history.authorshipWords('core_s').verified, earlierTurns };
}

/** `n` rows, oldest first in the making, returned newest first as `readRecent` gives them. */
function rowsOf(n: number): DurableRow[] {
  const rows: DurableRow[] = [];
  for (let i = 0; i < n; i += 1) {
    if (i % 7 === 3) rows.push({ request_hash: `subturn:${i}`, user_message: `a tool's reason ${i}`, assistant_message: `handler text ${i}` });
    else rows.push({ request_hash: `${AGENT_ANSWER_REQUEST_HASH_PREFIX}${i}${i % 3 === 0 ? '#chip:x' : ''}`,
      user_message: i % 11 === 5 ? '  ' : `message ${i}`, assistant_message: i % 13 === 6 ? '' : `reply ${i}` });
  }
  return rows.reverse();
}
const typedProof = (row: DurableRow): boolean => !String(row.request_hash).includes('#chip:');

describe('a program turn reads its conversation through its own reader (inventory F7)', () => {
  it.each([0, 1, 9, 25, 60, 99])('%i rows: the same proven typed words and earlier turns as the history window gave', (n) => {
    const rows = rowsOf(n);
    expect(programHistoryOf(rows, typedProof)).toEqual(legacyOf(rows, typedProof));
  });

  it('the windows bind: past 40 typed messages only the newest 40 ground the check, and only the newest 20 answer rows open the Conversation', () => {
    const rows = rowsOf(99);
    const { verified, earlierTurns } = programHistoryOf(rows, typedProof);
    expect(verified).toHaveLength(40);
    expect(verified.at(-1)).toBe('message 98');
    expect(earlierTurns.filter((t) => t.role === 'assistant').length).toBeLessThanOrEqual(20);
    expect(earlierTurns.some((t) => t.text.startsWith('a tool\'s reason'))).toBe(false);
    // CONTRAST: the sub-turn rows are in what was read.
    expect(rows.some((r) => r.user_message?.startsWith('a tool\'s reason'))).toBe(true);
    expect(PROGRAM_HISTORY_ROWS_READ).toBe(DURABLE_SEED_ROWS_READ);
  });

  it('a chip\'s words are never the person\'s typed words; with no proof nothing is', () => {
    const rows = rowsOf(9);
    expect(programHistoryOf(rows, typedProof).verified).not.toContain('message 6');
    expect(programHistoryOf(rows, () => false).verified).toEqual([]);
  });
});
