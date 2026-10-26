import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionLRUCache } from '../cache.js';
import { StateCommitFailedError, type SessionTurnWrite } from '../store.js';
import { log } from '../../../utils/telemetry.js';
import { isFailedTurnRecord } from '../pending-action.js';
import { RECORDED_OUTCOMES, withRecordedOutcome } from '../../core-route/turn-request.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RPC = 'append_agent_answer_if_latest';
const receipt = { id: 'answer-row', replayed_prior_turn: false, prior_turn_conflict: false };
const guidance = { version: 1 as const, entries: {} };
const offers = [{ id: 'agent-next-test', label: 'Test', message: 'Test the assumption.' }];
const write = (mode = 'plain'): SessionTurnWrite => ({ scenario_id: SCENARIO, turn_id: 'answer', turn_class: 'direct_answer',
  handler_id: null, request_hash: 'agent_turn:digest', response_emitted: true, llm_calls_used: 0,
  duration_ms: 1, handler_facts: [], userMessage: 'What next?', assistantMessage: 'Test the assumption.',
  ...(mode === 'guidance' ? { agent_guidance: guidance } : {}),
  ...(mode === 'offers' ? { suggested_actions: offers, suggested_actions_run_key: '0123456789abcdef' } : {}) });

function setup(rows: unknown[] = []) {
  const filters: unknown[][] = [];
  const chain = Object.fromEntries(['select', 'eq', 'not', 'order', 'limit', 'abortSignal'].map(name =>
    [name, vi.fn((...args: unknown[]) => { filters.push([name, ...args]); return chain; })])) as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
  chain.then = ((done: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: rows, error: null }).then(done, reject)) as never;
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: receipt as unknown, error: null as unknown }));
  const from = vi.fn(() => chain);
  const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
  const evict = vi.spyOn(cache, 'invalidateAll');
  const fresh = () => new SupabaseSessionStore({ from, rpc } as never, cache, { defaultReadLimit: 20 });
  return { fresh, rpc, from, filters, evict };
}
afterEach(() => vi.restoreAllMocks());

describe('S-D.1b conditional Agent answer store', () => {
  it.each(['plain', 'guidance', 'offers'])('passes exactly the existing row args plus expected id: %s', async mode => {
    const s = setup(), w = write(mode);
    s.rpc.mockResolvedValueOnce({ data: mode === 'plain' ? 'answer-row' : receipt, error: null });
    expect(await s.fresh().appendIfLatest(w, { expectedLatestRowId: 'floor-row' })).toEqual({ id: 'answer-row' });
    expect(s.rpc).toHaveBeenCalledExactlyOnceWith(RPC, {
      p_expected_latest_row_id: 'floor-row', p_scenario_id: SCENARIO, p_turn_id: 'answer', p_turn_class: 'direct_answer',
      p_handler_id: null, p_request_hash: w.request_hash, p_response_emitted: true, p_llm_calls_used: 0,
      p_duration_ms: 1, p_handler_facts: [], p_graph: null, p_brief_text: null, p_pending_actions: [], p_coaching_state: null,
      p_user_message: w.userMessage, p_assistant_message: w.assistantMessage, p_agent_guidance: w.agent_guidance ?? null,
      p_suggested_actions: mode === 'offers' ? offers : null, p_suggested_actions_run_key: w.suggested_actions_run_key ?? null,
    });
    expect(s.evict).toHaveBeenCalledExactlyOnceWith(SCENARIO);
  });

  it('NULL means no scenario row, still a conditional append', async () => {
    const s = setup();
    s.rpc.mockResolvedValueOnce({ data: 'answer-row', error: null });
    await s.fresh().appendIfLatest(write(), { expectedLatestRowId: null });
    expect(s.rpc.mock.calls[0]?.[0]).toBe(RPC);
    expect(s.rpc.mock.calls[0]?.[1].p_expected_latest_row_id).toBeNull();
  });

  it.each(['PGRST202', '42883'])('RPC absent (%s): identical legacy result and arguments across fresh instances', async code => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    for (const mode of ['plain', 'guidance', 'offers']) {
      const baseline = setup(), s = setup();
      baseline.rpc.mockResolvedValueOnce({ data: mode === 'plain' ? 'answer-row' : receipt, error: null });
      const expected = await baseline.fresh().append(write(mode));
      s.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'function missing' } });
      s.rpc.mockResolvedValueOnce({ data: mode === 'plain' ? 'answer-row' : receipt, error: null });
      expect(await s.fresh().appendIfLatest(write(mode), { expectedLatestRowId: 'floor-row' })).toEqual(expected);
      expect(s.rpc).toHaveBeenCalledTimes(2);
      expect(s.rpc.mock.calls[1]).toEqual(baseline.rpc.mock.calls[0]);
      expect(s.evict).toHaveBeenCalledOnce();
    }
    // Once per process, not once per instance or request. The second parameterised
    // case shares the module and must not produce another missing-RPC warning.
    expect(warn.mock.calls.length).toBe(code === 'PGRST202' ? 1 : 0);
  });

  it('latest_moved returns the typed no-write outcome, no delegate and no cache eviction', async () => {
    const s = setup();
    s.rpc.mockResolvedValueOnce({ data: { status: 'latest_moved' }, error: null });
    const outcome = await s.fresh().appendIfLatest(write('offers'), { expectedLatestRowId: 'floor-row' });
    expect(outcome).toEqual({ status: 'latest_moved' });
    expect(s.rpc).toHaveBeenCalledExactlyOnceWith(RPC, expect.any(Object));
    expect(s.evict).not.toHaveBeenCalled();
    expect(s.from).not.toHaveBeenCalled();
  });

  it.each(['replayed_prior_turn', 'prior_turn_conflict'] as const)('keeps the delegate receipt flag %s', async flag => {
    const s = setup();
    s.rpc.mockResolvedValueOnce({ data: { ...receipt, [flag]: true }, error: null });
    expect(await s.fresh().appendIfLatest(write('offers'), { expectedLatestRowId: 'floor-row' })).toEqual({ id: 'answer-row',
      [flag === 'replayed_prior_turn' ? 'replayedPriorTurn' : 'priorTurnConflict']: true });
  });

  it('other RPC errors never fall back', async () => {
    const s = setup();
    s.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(s.fresh().appendIfLatest(write(), { expectedLatestRowId: null })).rejects.toBeInstanceOf(StateCommitFailedError);
    expect(s.rpc).toHaveBeenCalledOnce();
    expect(s.evict).not.toHaveBeenCalled();
  });

  it.each([{ graph: {} }, { turn_id: 'answer:claim' }, { request_hash: 'internal' }, { handler_id: 'run_analysis' },
    { response_emitted: false }, { briefText: 'brief' }, { coaching_state: {} }, { modelVersion: {} }])('refuses non-final answer shape %j', async patch => {
    const s = setup();
    await expect(s.fresh().appendIfLatest({ ...write(), ...patch } as SessionTurnWrite, { expectedLatestRowId: null })).rejects.toBeInstanceOf(StateCommitFailedError);
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it('additive read reports the same row id, with the original results and exact filter/order', async () => {
    const s = setup([{ id: 'floor-row', pending_actions: [] }]), onLatestRowId = vi.fn();
    expect(await s.fresh().readMostRecentPendingActions(SCENARIO, { validation: 'strict', onLatestRowId })).toEqual([]);
    expect(onLatestRowId).toHaveBeenCalledExactlyOnceWith('floor-row');
    expect(s.filters).toEqual([
      // W9 B1: the read also takes request_hash, to recognise a failed turn's record (rows below).
      ['select', 'id, pending_actions, request_hash'], ['eq', 'scenario_id', SCENARIO], ['not', 'turn_id', 'like', '%:claim'],
      ['order', 'created_at', { ascending: false }], ['limit', 1],
    ]);
    expect(s.from).toHaveBeenCalledExactlyOnceWith('v5_conversation_turns');
    expect(await s.fresh().readMostRecentPendingActions(SCENARIO)).toEqual([]);
  });

  it('empty scenario read reports null, not undefined', async () => {
    const s = setup(), onLatestRowId = vi.fn();
    expect(await s.fresh().readMostRecentPendingActions(SCENARIO, { onLatestRowId })).toEqual([]);
    expect(onLatestRowId).toHaveBeenCalledExactlyOnceWith(null);
  });
});

/**
 * W9 B1 (Codex on #3800): a failed turn's record (`core-turn.ts`, its typed `reply_lost…` outcome) is the latest row, but it
 * holds no cards: the latest pending read names ITS id (what the conditional append compares) and returns the cards of the
 * newest row that is not one, read after that id.
 */
describe('W9 B1: the latest pending read passes over a failed turn\'s record', () => {
  const card = { id: 'q', scenario_id: SCENARIO, chip_id: 'hold-q', action: { kind: 'run_analysis' }, preconditions: {},
    expires_at_turn_count: 12, emitted_at_iso: '2026-10-26T00:00:00Z', expires_at_iso: '2026-10-27T00:00:00Z' };
  const failed = { id: 'failed-row', pending_actions: [], request_hash: withRecordedOutcome('agent_turn:digest', 'reply_lost_saved') };
  /** Each read answers with the next of `answers`; every query's filters are kept apart. */
  function reads(...answers: unknown[][]) {
    const queries: unknown[][][] = [];
    const from = vi.fn(() => {
      const filters: unknown[][] = [];
      queries.push(filters);
      const answer = answers[queries.length - 1] ?? [];
      const chain = Object.fromEntries(['select', 'eq', 'not', 'order', 'limit', 'abortSignal'].map(name =>
        [name, vi.fn((...args: unknown[]) => { filters.push([name, ...args]); return chain; })])) as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
      chain.then = ((done: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve({ data: answer, error: null }).then(done, reject)) as never;
      return chain;
    });
    const store = new SupabaseSessionStore({ from, rpc: vi.fn() } as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
    return { store, queries };
  }

  it('the failed record\'s id is the latest; the cards are the newest other row\'s, read with the record passed over', async () => {
    const r = reads([failed], [{ id: 'card-row', pending_actions: [card], request_hash: 'agent_turn:other' }]), onLatestRowId = vi.fn();
    expect(await r.store.readMostRecentPendingActions(SCENARIO, { validation: 'strict', onLatestRowId })).toEqual([card]);
    expect(onLatestRowId).toHaveBeenCalledExactlyOnceWith('failed-row');
    expect(r.queries[1]).toEqual([
      ['select', 'id, pending_actions, request_hash'], ['eq', 'scenario_id', SCENARIO], ['not', 'turn_id', 'like', '%:claim'],
      ['not', 'request_hash', 'like', '%#outcome:reply_lost%'], ['order', 'created_at', { ascending: false }], ['limit', 1],
    ]);
  });

  it('CONTRAST: a final answer with a recorded outcome (reply_empty) is read as before, one query, its own cards', async () => {
    const r = reads([{ id: 'answer-row', pending_actions: [card], request_hash: withRecordedOutcome('agent_turn:digest', 'reply_empty') }]);
    expect(await r.store.readMostRecentPendingActions(SCENARIO, { validation: 'strict' })).toEqual([card]);
    expect(r.queries).toHaveLength(1);
  });

  it('a pass-over the database did not apply is an unknown, never the record\'s empty cards', async () => {
    const r = reads([failed], [failed]);
    await expect(r.store.readMostRecentPendingActions(SCENARIO)).rejects.toThrow('a failed turn\'s record was not passed over');
  });

  it('the rule is the route\'s own typed outcomes: every reply_lost outcome, never reply_empty or a plain answer', () => {
    expect(RECORDED_OUTCOMES.map((o) => [o, isFailedTurnRecord({ request_hash: withRecordedOutcome('agent_turn:digest', o) })]))
      .toEqual([['reply_lost_saved', true], ['reply_lost_may_finish', true], ['reply_lost', true], ['reply_empty', false]]);
    expect(isFailedTurnRecord({ request_hash: 'agent_turn:digest' })).toBe(false);
  });
});
