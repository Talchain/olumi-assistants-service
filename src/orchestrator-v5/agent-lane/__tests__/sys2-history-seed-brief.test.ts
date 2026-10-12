/**
 * SYS2 E1 · `HistoryStore.seed` (unit). The route row is `sys2-brief-survives-cold-reseed.route.test.ts`; these rows pin
 * the store's own contract: hot and cold carry the same brief, past the seed's 20-row cap too, and an unknown start
 * (a full read) claims nothing. Paul's hiring words, verbatim.
 */
import { describe, expect, it } from 'vitest';
import { DURABLE_SEED_ROWS_READ, HistoryStore, OLDER_WORDS_LABEL, briefFromDurableTurns, historyFromDurableTurns } from '../history-store.js';

const BRIEF = "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.";
const L133 = "You're talking about links, but what about missing data from this decision?";
const user = (text: string) => ({ role: 'user', content: [{ type: 'input_text', text }] });
const firstText = (i: unknown) => ((i as { content?: { text?: string }[] }).content?.[0]?.text);
const olderOf = (h: readonly unknown[]) => h.map(firstText).find((t) => t?.startsWith(OLDER_WORDS_LABEL));
/** Answer rows newest first, as `readRecent` returns them: the brief, then `n - 1` further turns. */
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ request_hash: `agent_turn:${i}`,
  user_message: i === 0 ? BRIEF : i === 1 ? L133 : `Turn ${i + 1}.`, assistant_message: `Reply ${i + 1}.` })).reverse();

describe('SYS2 E1 · HistoryStore.seed', () => {
  it('hot and cold carry the same brief first in the older-words item (16 turns, window 8)', () => {
    const hot = new HistoryStore();
    const items: unknown[] = [];
    for (const r of [...rowsOf(16)].reverse()) {
      hot.recordTyped('s', r.user_message);
      items.push(user(r.user_message), { role: 'assistant', content: r.assistant_message });
      hot.set('s', items);
    }
    const cold = new HistoryStore();
    cold.seed('s', historyFromDurableTurns(rowsOf(16)), [], rowsOf(16));
    const hotFirst = olderOf(hot.get('s'))!.split('\n')[1];
    expect(hotFirst).toBe(`- "${BRIEF}"`);
    expect(olderOf(cold.get('s'))!.split('\n')[1]).toBe(hotFirst);
  });

  it('a later reseeded row (not provably typed) is not presented as the user\'s; the brief is', () => {
    const cold = new HistoryStore();
    cold.seed('s', historyFromDurableTurns(rowsOf(16)), [], rowsOf(16));
    const older = olderOf(cold.get('s'))!;
    expect(older).toContain(`- "${BRIEF}"`);
    expect(older).not.toContain(L133);
  });

  it('past the seed\'s 20-answer-row cap the brief still leads the older words (30 turns)', () => {
    const cold = new HistoryStore();
    const rows = rowsOf(30);
    expect(historyFromDurableTurns(rows).map(firstText)).not.toContain(BRIEF);
    cold.seed('s', historyFromDurableTurns(rows), [], rows);
    expect(olderOf(cold.get('s'))!.split('\n')[1]).toBe(`- "${BRIEF}"`);
  });

  it('a short conversation keeps the brief in the window, then hands it to the older words when it drops later', () => {
    const cold = new HistoryStore();
    cold.seed('s', historyFromDurableTurns(rowsOf(3)), [], rowsOf(3));
    expect(olderOf(cold.get('s'))).toBeUndefined();
    const items = cold.get('s');
    const next = [...items];
    for (let i = 0; i < 8; i += 1) { next.push(user(`Later ${i}.`), { role: 'assistant', content: 'ok' }); cold.recordTyped('s', `Later ${i}.`); }
    cold.set('s', next);
    expect(olderOf(cold.get('s'))!.split('\n')[1]).toBe(`- "${BRIEF}"`);
    expect(olderOf(cold.get('s'))!.split(`"${BRIEF}"`)).toHaveLength(2); // once, not duplicated
  });

  it('UNKNOWN start: a full read (the rows may not reach the first turn) names no brief', () => {
    const full = Array.from({ length: DURABLE_SEED_ROWS_READ }, (_, i) => ({ request_hash: `agent_turn:${i}`, user_message: `Turn ${i}.` }));
    expect(briefFromDurableTurns(full)).toBeUndefined();
    expect(briefFromDurableTurns(rowsOf(16))).toBe(BRIEF);
    // Only an Agent ANSWER row counts: a sub-turn row's words are never the brief.
    expect(briefFromDurableTurns([...rowsOf(2), { request_hash: 'sha256:x', user_message: 'Add the option "Test £54 at release".' }])).toBe(BRIEF);
  });
});
