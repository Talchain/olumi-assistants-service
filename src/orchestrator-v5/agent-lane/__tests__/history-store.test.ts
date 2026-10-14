/**
 * ⛔ THE TRIM MUST NOT ORPHAN A `function_call_output`. The items are
 * Responses-API items; a `function_call` and its output are a PAIR, and a
 * reasoning item belongs with the call that follows it. Cutting at an arbitrary
 * index produces a sequence the API rejects — and it would only fail once a
 * conversation got long, i.e. in front of a user, not in a test.
 */

import { describe, it, expect } from 'vitest';
import { dropDanglingCalls, HistoryStore, trimToRecentTurns } from '../history-store.js';

/** One well-formed turn: user message, reasoning, call, output, answer. */
const turn = (n: number) => [
  { role: 'user', content: [{ type: 'input_text', text: `q${n}` }] },
  { type: 'reasoning', id: `r${n}` },
  { type: 'function_call', call_id: `c${n}`, name: 'get_canonical_state', arguments: '{}' },
  { type: 'function_call_output', call_id: `c${n}`, output: '{}' },
  { type: 'message', content: [{ type: 'output_text', text: `a${n}` }] },
];

const conversation = (turns: number) => Array.from({ length: turns }, (_, i) => turn(i)).flat();

describe('trimToRecentTurns', () => {
  it('leaves a short conversation untouched', () => {
    const items = conversation(3);
    expect(trimToRecentTurns(items, 24)).toEqual(items);
  });

  it('keeps the most recent N turns', () => {
    const kept = trimToRecentTurns(conversation(10), 3);
    const users = kept.filter((i) => (i as { role?: string }).role === 'user');
    expect(users).toHaveLength(3);
    expect((users[0] as { content: { text: string }[] }).content[0].text).toBe('q7');
  });

  it('CUTS AT A USER MESSAGE, so no function_call_output is orphaned', () => {
    const kept = trimToRecentTurns(conversation(10), 3);
    expect((kept[0] as { role?: string }).role, 'must begin at a user message').toBe('user');

    // Every output must have its call earlier in the kept window.
    const callIds = new Set(
      kept.filter((i) => (i as { type?: string }).type === 'function_call')
        .map((i) => (i as { call_id: string }).call_id),
    );
    const orphans = kept
      .filter((i) => (i as { type?: string }).type === 'function_call_output')
      .filter((i) => !callIds.has((i as { call_id: string }).call_id));
    expect(orphans, 'orphaned function_call_output(s)').toEqual([]);
  });

  it('contrast control: a naive tail slice DOES orphan one', () => {
    // If this ever stopped orphaning, the test above would prove nothing.
    const items = conversation(10);
    const naive = items.slice(items.length - 12);
    const callIds = new Set(
      naive.filter((i) => (i as { type?: string }).type === 'function_call')
        .map((i) => (i as { call_id: string }).call_id),
    );
    const orphans = naive
      .filter((i) => (i as { type?: string }).type === 'function_call_output')
      .filter((i) => !callIds.has((i as { call_id: string }).call_id));
    expect(orphans.length).toBeGreaterThan(0);
  });
});

describe('HistoryStore', () => {
  it('evicts the oldest session rather than growing without bound', () => {
    const store = new HistoryStore(3, 24);
    for (const id of ['a', 'b', 'c', 'd']) store.set(id, turn(1));
    expect(store.size).toBe(3);
    expect(store.get('a'), 'the oldest must have been evicted').toEqual([]);
    expect(store.get('d')).not.toEqual([]);
  });

  it('treats a write as recent, so an active session is not evicted', () => {
    const store = new HistoryStore(3, 24);
    for (const id of ['a', 'b', 'c']) store.set(id, turn(1));
    store.set('a', turn(2));   // 'a' is active again
    store.set('d', turn(3));   // forces one eviction
    expect(store.get('a'), 'the active session must survive').not.toEqual([]);
    expect(store.get('b'), "'b' is now the oldest").toEqual([]);
  });

  it('trims on write, so one session cannot grow without bound', () => {
    const store = new HistoryStore(10, 2);
    store.set('s', conversation(9));
    const users = store.get('s').filter((i) => (i as { role?: string }).role === 'user');
    expect(users).toHaveLength(2);
  });
});

describe('a stored history is VALID INPUT by construction', () => {
  /**
   * ⛔ Measured in the deployed service's logs: one `function_call` with no
   * output made every subsequent turn 502 — permanently, because the bad item
   * stayed in the stored history. The cause is fixed in the loop; this is the
   * guard that stops the class recurring through any other writer.
   */
  const call = (id: string) => ({ type: 'function_call', name: 'get_canonical_state', arguments: '{}', call_id: id });
  const output = (id: string) => ({ type: 'function_call_output', call_id: id, output: '{}' });

  it('drops a call nothing answered, and keeps the answered one', () => {
    const kept = dropDanglingCalls([{ role: 'user' }, call('a'), call('b'), output('a')]);
    expect(kept).toEqual([{ role: 'user' }, call('a'), output('a')]);
  });

  it('never drops an OUTPUT — that is the API’s other rejection', () => {
    const items = [output('ghost'), { role: 'user' }];
    expect(dropDanglingCalls(items)).toEqual(items);
  });

  it('leaves a well-formed history untouched — the contrast control', () => {
    const items = [{ role: 'user' }, call('a'), output('a'), { type: 'message' }];
    expect(dropDanglingCalls(items)).toEqual(items);
  });

  it('the store applies it on read', () => {
    const store = new HistoryStore();
    store.set('s', [{ role: 'user' }, call('a'), call('orphan'), output('a')]);
    const got = store.get('s');
    expect(got.filter((i) => (i as { type?: string }).type === 'function_call')).toEqual([call('a')]);
  });
});



describe('A2h authorship grounding keeps boundaries and source tiers', () => {
  it('retains a verified multiline statement after more than forty typed messages', () => {
    const store = new HistoryStore();
    const first = 'Senior engineer salary\ncosts £120k per year.';
    let messages: unknown[] = [];
    for (let i = 0; i < 45; i++) {
      const text = i === 0 ? first : `message ${i}`;
      store.recordTyped('s', text);
      messages = [...store.get('s'), { role: 'user', content: [{ type: 'input_text', text }] }];
      store.set('s', messages);
    }
    expect(store.typedWords('s')).not.toContain(first);
    expect(store.authorshipWords('s').verified).toContain(first);
    expect(store.authorshipWords('s').unknown).toEqual([]);
  });
  it('keeps both windowed and older cold-seeded rows unknown', () => {
    const store = new HistoryStore(10, 2);
    store.seed('s', conversation(4), []);
    expect(store.authorshipWords('s').verified).toEqual([]);
    expect(store.authorshipWords('s').unknown).toEqual(['q0', 'q1', 'q2', 'q3']);
    store.recordTyped('s', 'q1');
    expect(store.authorshipWords('s').unknown).toContain('q1');
    expect(store.authorshipWords('s').verified).toContain('q1');
  });
});


describe('A2i source coverage for K3 search misses', () => {
  it('a complete live source may classify a miss; the typed-history cap makes it incomplete', () => {
    const store = new HistoryStore();
    store.recordTyped('s', 'The opening message.');
    store.set('s', conversation(1));
    expect(store.authorshipWords('s').complete).toBe(true);
    for (let i = 1; i < 40; i++) store.recordTyped('s', `message ${i}`);
    expect(store.authorshipWords('s').complete).toBe(false);
  });
  it('fresh or failed source coverage stays incomplete on later turns', () => {
    const store = new HistoryStore();
    expect(store.authorshipWords('s').complete).toBe(false);
    store.recordTyped('s', 'A later message.', false);
    store.set('s', conversation(1));
    store.recordTyped('s', 'Another message.');
    expect(store.authorshipWords('s').complete).toBe(false);
    expect(store.authorshipWords('s').verified).toEqual(['A later message.', 'Another message.']);
  });
  it('an empty restored source is incomplete even after fresh typing', () => {
    const store = new HistoryStore();
    store.seed('s', [], []);
    store.recordTyped('s', 'A later message.');
    store.set('s', conversation(1));
    expect(store.authorshipWords('s').complete).toBe(false);
  });
});
