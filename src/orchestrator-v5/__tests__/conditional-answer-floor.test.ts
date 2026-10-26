import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import type { PendingAction } from '../session/pending-action.js';
import type { ConditionalAppendOptions, ConditionalSessionAppendOutcome, SessionAppendOutcome, SessionTurnWrite } from '../session/store.js';
import { log } from '../../utils/telemetry.js';
import { SupabaseSessionStore } from '../session/supabase-store.js';
import { SessionLRUCache } from '../session/cache.js';
import { withRecordedOutcome } from '../core-route/turn-request.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const held = (chip: string): PendingAction => ({ id: chip, scenario_id: SCENARIO, chip_id: chip,
  action: { kind: 'run_analysis' }, preconditions: {}, expires_at_turn_count: 12,
  emitted_at_iso: '2026-10-07T00:00:00Z', expires_at_iso: '2026-10-08T00:00:00Z' });
// The arrival was minted after the hold (S-D slice 2 orders held items oldest first within the row).
const hold = held('hold-a'), arrival: PendingAction = { ...held('hold-b'), emitted_at_iso: '2026-10-07T00:00:01Z' };
const scope: PendingAction = { ...held('scope'), action: { kind: 'reconcile_goal_scope', goal_id: 'g', goal_label: 'MRR',
  expected: 'scope', question: 'Which scope?', operands: [], derivations: [] } };
const answer = (pending: readonly PendingAction[]): SessionTurnWrite => ({ scenario_id: SCENARIO, turn_id: 'answer',
  turn_class: 'direct_answer', handler_id: null, request_hash: 'agent_turn:digest', response_emitted: true,
  llm_calls_used: 0, duration_ms: 1, handler_facts: [], assistantMessage: 'Here is your answer.', pending_actions: pending });

// Stage the other request INSIDE append, after the floor's read. Compare row ids,
// never action counts: equal payloads on different rows still mean latest_moved.
function setup(initial: readonly PendingAction[], moves: readonly (readonly PendingAction[])[]) {
  let row = { id: 'row-0', pending: initial };
  let attempt = 0;
  const written: SessionTurnWrite[] = [];
  const calls: { write: SessionTurnWrite; options?: ConditionalAppendOptions }[] = [];
  async function appendAny(write: SessionTurnWrite, options?: ConditionalAppendOptions): Promise<ConditionalSessionAppendOutcome> {
    calls.push({ write, ...(options ? { options } : {}) });
    if (options) {
      const next = moves[attempt++];
      if (next !== undefined) row = { id: `row-${attempt}`, pending: next };
      if (options.expectedLatestRowId !== row.id) return { status: 'latest_moved' };
    }
    written.push(write);
    return { id: 'answer-row' };
  }
  const store = createNoopSessionStore();
  store.append = async (write: SessionTurnWrite): Promise<SessionAppendOutcome> => appendAny(write) as Promise<SessionAppendOutcome>;
  store.appendIfLatest = (write: SessionTurnWrite, options: ConditionalAppendOptions) => appendAny(write, options);
  store.readMostRecentPendingActions = vi.fn(async (_scenario, options) => {
    options?.onLatestRowId?.(row.id);
    return row.pending;
  });
  const run = (write: SessionTurnWrite) => appendCheckedGraphWrite({ store, write, writesGraph: false,
    heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set(initial.map(p => p.chip_id)) } });
  return { store, written, calls, run };
}

afterEach(() => vi.restoreAllMocks());

describe('S-D.1b conditional answer floor', () => {
  it('S-D slice 2 x S-D.1b: the held reconciliation callback runs on EVERY attempt and only the last attempt is written', async () => {
    const s = setup([hold], [[]]);
    const seen: string[][] = [];
    const run = (write: SessionTurnWrite) => appendCheckedGraphWrite({ store: s.store, write, writesGraph: false,
      heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set([hold.chip_id]),
        onReconciled: (w) => { seen.push((w.pending_actions ?? []).map(p => p.chip_id)); return { ...w, assistantMessage: `attempt ${seen.length}` }; } } });
    expect(await run(answer([hold]))).toEqual({ id: 'answer-row' });
    expect(seen, 'attempt 1 saw the hold; attempt 2 (after the decline landed) did not').toEqual([['hold-a'], []]);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.assistantMessage).toBe('attempt 2');
  });

  it('Not now between read and append: retry never resurrects the declined hold', async () => {
    const s = setup([hold], [[]]);
    expect(await s.run(answer([hold]))).toEqual({ id: 'answer-row' });
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1']);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.pending_actions).toEqual([]);
    expect(s.written[0]?.assistantMessage).toBe('Here is your answer.');
  });

  it('arrival between read and append: retry carries the exact newly minted hold and scope issue', async () => {
    const s = setup([hold], [[hold, arrival, scope]]);
    await s.run(answer([hold]));
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1']);
    expect(s.written[0]?.pending_actions).toEqual([scope, hold, arrival]);
    expect(s.written[0]?.pending_actions?.[2]).toBe(arrival);
  });

  it('CONTROL: stable row means one append with unchanged bytes and object identity', async () => {
    const s = setup([hold], []), write = answer([hold]);
    const bytes = JSON.stringify(write);
    await s.run(write);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.options).toEqual({ expectedLatestRowId: 'row-0' });
    expect(s.written[0]).toBe(write);
    expect(JSON.stringify(s.written[0])).toBe(bytes);
  });

  it('three moved rows: exactly three conditional attempts, then unconditional answer and warning', async () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const s = setup([hold], [[hold], [hold], [hold]]);
    expect(await s.run(answer([hold]))).toEqual({ id: 'answer-row' });
    expect(s.calls.map(c => c.options?.expectedLatestRowId)).toEqual(['row-0', 'row-1', 'row-2', undefined]);
    expect(s.written).toHaveLength(1);
    expect(s.written[0]?.assistantMessage).toBe('Here is your answer.');
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'v5.agent_answer.latest_moved_exhausted' }), expect.any(String));
  });

  it('retry reconciles from the original request, so a temporarily absent hold can return on a fresh row', async () => {
    const s = setup([hold], [[], [hold]]);
    await s.run(answer([hold]));
    expect(s.calls).toHaveLength(3);
    expect(s.written[0]?.pending_actions).toEqual([hold]);
  });

  it('retry discards scope issues merged from an obsolete row', async () => {
    const s = setup([hold, scope], [[hold]]);
    await s.run(answer([hold]));
    expect(s.written[0]?.pending_actions).toEqual([hold]);
  });

  it('CONTROL: callers without heldProposals retain the ordinary append', async () => {
    const s = setup([hold], []), write = answer([hold]);
    await appendCheckedGraphWrite({ store: s.store, write, writesGraph: false });
    expect(s.calls).toEqual([{ write }]);
  });
});

/**
 * ⛔ W9 B1 (Codex on #3800): turn A failed after a save and records itself; between the floor's read and that record's append
 * another request saves card Q. The REAL floor writes through the REAL `SupabaseSessionStore` to a table double: its reads
 * filter and order as PostgREST does, and its RPCs keep the conditional append's contract (a final non-graph answer only,
 * compared with the latest non-claim row).
 */
describe('W9 B1: a failed turn\'s record never replaces the latest cards', () => {
  type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; response_emitted: boolean; pending_actions: unknown; user_message: unknown };
  const like = (pattern: string) => new RegExp(`^${pattern.split('').map((c) => (c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('')}$`, 's');
  function table() {
    const rows: Row[] = [];
    const rpcs: { name: string; expected?: unknown }[] = [];
    let raceAfterRead: (() => void) | undefined;
    const insert = (a: Record<string, unknown>): string => {
      const id = `row-${rows.length + 1}`;
      rows.push({ id, scenario_id: String(a.p_scenario_id), turn_id: String(a.p_turn_id), request_hash: String(a.p_request_hash), response_emitted: a.p_response_emitted === true,
        pending_actions: a.p_pending_actions, user_message: a.p_user_message });
      return id;
    };
    const newest = () => [...rows].reverse().find((r) => !r.turn_id.endsWith(':claim'));
    const from = () => {
      const keep: ((r: Row) => boolean)[] = [];
      let limit = Infinity;
      const chain: Record<string, unknown> = {
        select: () => chain, abortSignal: () => chain, order: () => chain, // newest first, as the store asks
        eq: (c: keyof Row, v: unknown) => { keep.push((r) => r[c] === v); return chain; },
        not: (c: keyof Row, op: string, p: string) => { if (op !== 'like') throw new Error(op); keep.push((r) => !like(p).test(String(r[c]))); return chain; },
        limit: (n: number) => { limit = n; return chain; },
        then: (done: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const data = [...rows].reverse().filter((r) => keep.every((k) => k(r))).slice(0, limit).map(({ id, pending_actions, request_hash }) => ({ id, pending_actions, request_hash }));
          const race = raceAfterRead; raceAfterRead = undefined; race?.();
          return Promise.resolve({ data, error: null }).then(done, reject);
        },
      };
      return chain;
    };
    const rpc = async (name: string, a: Record<string, unknown>) => {
      rpcs.push({ name, ...(name === 'append_agent_answer_if_latest' ? { expected: a.p_expected_latest_row_id } : {}) });
      if (name === 'append_turn_atomic_v2') return { data: insert(a), error: null };
      if (name !== 'append_agent_answer_if_latest') throw new Error(`unexpected rpc ${name}`);
      if (a.p_response_emitted !== true || a.p_graph !== null || !String(a.p_request_hash).startsWith('agent_turn:')) {
        return { data: null, error: { code: 'P0001', message: 'conditional append requires a final non-graph Agent answer' } };
      }
      return (newest()?.id ?? null) !== a.p_expected_latest_row_id ? { data: { status: 'latest_moved' }, error: null } : { data: insert(a), error: null };
    };
    const real = new SupabaseSessionStore({ from, rpc } as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
    const store = createNoopSessionStore();
    store.append = (w) => real.append(w);
    store.appendIfLatest = (w, o) => real.appendIfLatest(w, o);
    store.readMostRecentPendingActions = (s, o) => real.readMostRecentPendingActions(s, o);
    /** Another request saves card Q right after the next read: the window between the floor's read and its append. */
    const cardQSavedAfterNextRead = () => { raceAfterRead = () => { insert({ p_scenario_id: SCENARIO, p_turn_id: 'other-request', p_request_hash: 'agent_turn:other', p_response_emitted: true, p_pending_actions: [cardQ] }); }; };
    return { rows, rpcs, store, cardQSavedAfterNextRead };
  }
  const cardQ = held('hold-q');
  const turnA = (w: Partial<SessionTurnWrite>): SessionTurnWrite => ({ scenario_id: SCENARIO, turn_id: 'turn-a', turn_class: 'direct_answer',
    handler_id: null, request_hash: 'agent_turn:a', response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [],
    userMessage: 'Yes, that is what I meant.', ...w });
  const floor = (store: ReturnType<typeof table>['store'], write: SessionTurnWrite) => appendCheckedGraphWrite({ store, write, writesGraph: false,
    source: 'agent_turn', heldProposals: { isHeld: p => p.chip_id.startsWith('hold-'), seenByThisRequest: new Set<string>() } });
  const SAVED_KEPT = 'The saved change is kept, but the reply didn’t arrive. Send a new message to continue.';

  it('card Q saved between A\'s read and A\'s failed-turn record: the record is kept, and the latest cards are still Q', async () => {
    const t = table();
    t.cardQSavedAfterNextRead();
    await floor(t.store, turnA({ request_hash: withRecordedOutcome('agent_turn:a', 'reply_lost_saved'), response_emitted: false, assistantMessage: SAVED_KEPT }));
    // The record is kept, with the person's words, and holds no cards; it took the plain append, never the conditional one.
    expect(t.rows.map((r) => [r.turn_id, r.response_emitted, r.pending_actions])).toEqual([['other-request', true, [cardQ]], ['turn-a', false, []]]);
    expect(t.rows[1]!.user_message).toBe('Yes, that is what I meant.');
    expect(t.rpcs).toEqual([{ name: 'append_turn_atomic_v2' }]);
    const latestId = vi.fn();
    expect(await t.store.readMostRecentPendingActions(SCENARIO, { validation: 'strict', onLatestRowId: latestId })).toEqual([cardQ]);
    expect(latestId).toHaveBeenCalledExactlyOnceWith('row-2');
    // The next answer compares the record's id (the latest row) and carries Q on, through the conditional append.
    await floor(t.store, turnA({ turn_id: 'turn-b', request_hash: 'agent_turn:b', assistantMessage: 'Here is your answer.' }));
    expect(t.rpcs.slice(1)).toEqual([{ name: 'append_agent_answer_if_latest', expected: 'row-2' }]);
    expect(t.rows.at(-1)?.pending_actions).toEqual([cardQ]);
  });

  it('CONTRAST: a final answer in the same race goes through the conditional append exactly as before: moved, read again, Q carried', async () => {
    const t = table();
    t.cardQSavedAfterNextRead();
    await floor(t.store, turnA({ assistantMessage: 'Here is your answer.' }));
    expect(t.rpcs).toEqual([{ name: 'append_agent_answer_if_latest', expected: null }, { name: 'append_agent_answer_if_latest', expected: 'row-1' }]);
    expect(t.rows.map((r) => [r.turn_id, r.pending_actions])).toEqual([['other-request', [cardQ]], ['turn-a', [cardQ]]]);
    expect(await t.store.readMostRecentPendingActions(SCENARIO, { validation: 'strict' })).toEqual([cardQ]);
  });
});
