/**
 * SYS2 E1 · `HistoryStore.seed` (unit). The route rows are `sys2-brief-survives-cold-reseed.route.test.ts`; these pin the
 * store's own contract. Hot and cold carry the same brief bytes. Cold quotes them under the unknown-authorship header,
 * never "the user wrote" (independent review round 1, BLOCKING). The brief is admitted once, by identity. Its marker
 * lives and dies with its history. An unknown start (a full read) claims nothing. Paul's hiring words, verbatim.
 */
import { describe, expect, it } from 'vitest';
import { DURABLE_SEED_ROWS_READ, HistoryStore, OLDER_WORDS_LABEL, RESTORED_FIRST_LABEL, briefFromDurableTurns, historyFromDurableTurns } from '../history-store.js';

const BRIEF = "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.";
const L133 = "You're talking about links, but what about missing data from this decision?";
const user = (text: string) => ({ role: 'user', content: [{ type: 'input_text', text }] });
const firstText = (i: unknown) => ((i as { content?: { text?: string }[] }).content?.[0]?.text);
const olderOf = (h: readonly unknown[]) => h.map(firstText).find((t) => t?.startsWith(OLDER_WORDS_LABEL) || t?.startsWith(RESTORED_FIRST_LABEL));
const head = (h: readonly unknown[]) => olderOf(h)?.split('\n').slice(0, 2);
const quoteCount = (text: string | undefined, words: string) => (text ?? '').split(`- "${words}"`).length - 1;
/** Answer rows newest first, as `readRecent` returns them: `first`, then `n - 1` further turns. */
const rowsOf = (n: number, first = BRIEF) => Array.from({ length: n }, (_, i) => ({ request_hash: `agent_turn:${i}`,
  user_message: i === 0 ? first : i === 1 ? L133 : `Turn ${i + 1}.`, assistant_message: `Reply ${i + 1}.` })).reverse();
const seedCold = (store: HistoryStore, sid: string, rows: ReturnType<typeof rowsOf>) => store.seed(sid, historyFromDurableTurns(rows), [], rows);

describe('SYS2 E1 · HistoryStore.seed', () => {
  it('hot and cold carry the same brief bytes; hot says the user wrote them, cold says authorship is not recorded', () => {
    const hot = new HistoryStore();
    const items: unknown[] = [];
    for (const r of [...rowsOf(16)].reverse()) {
      hot.recordTyped('s', r.user_message);
      items.push(user(r.user_message), { role: 'assistant', content: r.assistant_message });
      hot.set('s', items);
    }
    const cold = new HistoryStore();
    seedCold(cold, 's', rowsOf(16));
    expect(head(hot.get('s'))).toEqual([OLDER_WORDS_LABEL, `- "${BRIEF}"`]);
    expect(head(cold.get('s'))).toEqual([RESTORED_FIRST_LABEL, `- "${BRIEF}"`]);
  });

  it('a later reseeded row (not provably typed) is not carried; nothing reseeded is quoted under "the user wrote"', () => {
    const cold = new HistoryStore();
    seedCold(cold, 's', rowsOf(16));
    const older = olderOf(cold.get('s'))!;
    expect(older).not.toContain(L133);
    expect(older).not.toContain(OLDER_WORDS_LABEL);
  });

  it('AUTHORSHIP: a chip- or template-first conversation is quoted only under the unknown-authorship header', () => {
    const cold = new HistoryStore();
    seedCold(cold, 's', rowsOf(16, 'Use the hiring example.'));
    expect(head(cold.get('s'))).toEqual([RESTORED_FIRST_LABEL, '- "Use the hiring example."']);
    expect(olderOf(cold.get('s'))).not.toContain(OLDER_WORDS_LABEL);
  });

  it('past the seed\'s 20-answer-row cap the brief still leads (30 turns)', () => {
    const cold = new HistoryStore();
    const rows = rowsOf(30);
    expect(historyFromDurableTurns(rows).map(firstText)).not.toContain(BRIEF);
    seedCold(cold, 's', rows);
    expect(head(cold.get('s'))).toEqual([RESTORED_FIRST_LABEL, `- "${BRIEF}"`]);
  });

  it('a short conversation keeps the brief in the window, then admits it ONCE when it drops; later typed words follow under "the user wrote"', () => {
    const cold = new HistoryStore();
    seedCold(cold, 's', rowsOf(3));
    expect(olderOf(cold.get('s'))).toBeUndefined();
    const next = [...cold.get('s')];
    for (let i = 0; i < 9; i += 1) { cold.recordTyped('s', `Later ${i}.`); next.push(user(`Later ${i}.`), { role: 'assistant', content: 'ok' }); }
    cold.set('s', next);
    const older = olderOf(cold.get('s'))!;
    expect(older.split('\n').slice(0, 2)).toEqual([RESTORED_FIRST_LABEL, `- "${BRIEF}"`]);
    expect(quoteCount(older, BRIEF)).toBe(1);
    expect(older).toContain(`${OLDER_WORDS_LABEL}\n`);
    expect(older).toContain('- "Later 0."');
  });

  it('IDENTITY: the same words twice in the dropped rows are admitted once (only the first message is restored)', () => {
    const cold = new HistoryStore();
    const rows = rowsOf(16).map((r) => r.user_message === 'Turn 3.' ? { ...r, user_message: BRIEF } : r);
    seedCold(cold, 's', rows);
    expect(quoteCount(olderOf(cold.get('s')), BRIEF)).toBe(1);
  });

  it('EVICTION follows the history: seed A, seed B, write A, seed C (capacity 2) → A keeps its brief marker', () => {
    const store = new HistoryStore(2, 8);
    const short = rowsOf(3);
    seedCold(store, 'A', short);
    seedCold(store, 'B', short);
    store.set('A', store.get('A')); // A written: most recent
    seedCold(store, 'C', short); // evicts B, not A
    expect(store.has('A')).toBe(true);
    expect(store.has('B')).toBe(false);
    const next = [...store.get('A')];
    for (let i = 0; i < 9; i += 1) next.push(user(`Later ${i}.`), { role: 'assistant', content: 'ok' });
    store.set('A', next);
    expect(head(store.get('A'))).toEqual([RESTORED_FIRST_LABEL, `- "${BRIEF}"`]);
  });

  it('a later seed that finds no first message (unknown start) clears a stale marker', () => {
    const store = new HistoryStore();
    seedCold(store, 's', rowsOf(3));
    const full = Array.from({ length: DURABLE_SEED_ROWS_READ }, (_, i) => ({ request_hash: `agent_turn:${i}`, user_message: i === 0 ? 'Turn 0.' : `Turn ${i}.` })).reverse();
    store.seed('s', [user(BRIEF)], [], full);
    const next = [...store.get('s')];
    for (let i = 0; i < 9; i += 1) next.push(user(`Later ${i}.`), { role: 'assistant', content: 'ok' });
    store.set('s', next);
    expect(olderOf(store.get('s'))).toBeUndefined();
  });

  it('UNKNOWN start: a full read (the rows may not reach the first turn) names no brief; only Agent answer rows count', () => {
    const full = Array.from({ length: DURABLE_SEED_ROWS_READ }, (_, i) => ({ request_hash: `agent_turn:${i}`, user_message: `Turn ${i}.` }));
    expect(briefFromDurableTurns(full)).toBeUndefined();
    expect(briefFromDurableTurns(rowsOf(16))).toBe(BRIEF);
    expect(briefFromDurableTurns([...rowsOf(2), { request_hash: 'sha256:x', user_message: 'Add the option "Test £54 at release".' }])).toBe(BRIEF);
  });
});
