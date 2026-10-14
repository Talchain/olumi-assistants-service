import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionLRUCache } from '../cache.js';
import type { SessionTurnWrite } from '../store.js';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { guidanceHistoryOf, guidanceOnAnswer, parseAnswerGuidance } from '../../agent-lane/turn-context/guidance-history.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const meta = (status: 'offered' | 'pressed' | 'dismissed' = 'offered') => ({ version: 1 as const,
  entries: { 'RC-WIDEN': { status, state_key_hash: '012345abcdef' } } });
const write = (): SessionTurnWrite => ({ scenario_id: SCENARIO, turn_id: 'answer-1', turn_class: 'direct_answer',
  handler_id: null, request_hash: 'agent_turn:digest', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
  handler_facts: [], userMessage: 'What next?', assistantMessage: 'Consider another option.', agent_guidance: meta() });

function setup(rows: unknown[] = [], error: unknown = null) {
  const filters: unknown[][] = [];
  const chain = Object.fromEntries(['select', 'eq', 'is', 'like', 'not', 'order', 'limit', 'abortSignal'].map(name =>
    [name, vi.fn((...args: unknown[]) => { filters.push([name, ...args]); return chain; })])) as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
  chain.then = ((done: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(done)) as never;
  const rpc = vi.fn(async () => ({ data: { id: 'row1', replayed_prior_turn: false, prior_turn_conflict: false }, error: null }));
  const from = vi.fn(() => chain);
  const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
  const evict = vi.spyOn(cache, 'invalidateAll');
  const fresh = () => new SupabaseSessionStore({ from, rpc } as never, cache, { defaultReadLimit: 20 });
  return { fresh, rpc, from, filters, evict };
}

describe('content-free guidance on the existing answer', () => {
  it('latest event wins without changing offered cooldown; refuses content and unbounded metadata', () => {
    expect(guidanceHistoryOf([meta('pressed'), meta()])?.['RC-WIDEN']?.status).toBe('pressed');
    expect(guidanceHistoryOf([meta(), meta('pressed')])?.['RC-WIDEN']?.status).toBe('offered');
    expect(parseAnswerGuidance({ ...meta(), copy: 'private words' })).toBeNull();
    expect(parseAnswerGuidance({ version: 1, entries: { 'RC-WIDEN': { ...meta().entries['RC-WIDEN'], label: 'private' } } })).toBeNull();
    expect(parseAnswerGuidance({ version: 1, entries: { 'RC-STRENGTHEN-ITEM:raw-user-id': meta().entries['RC-WIDEN'] } })).toBeNull();
    expect(guidanceHistoryOf([meta(), { version: 2, entries: {} }])).toBeNull();
    expect(guidanceOnAnswer(undefined, {}, { policy_id: 'RC-WIDEN' })).toBeUndefined();
    expect(guidanceOnAnswer(undefined, guidanceHistoryOf([meta()]), { policy_id: 'RC-WIDEN' }))
      .toEqual(meta('pressed'));
  });

  it('sends final text and metadata in ONE RPC and evicts conversation cache after success', async () => {
    const { fresh, rpc, evict } = setup();
    expect(await fresh().append(write())).toEqual({ id: 'row1' });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('append_agent_answer_with_guidance', expect.objectContaining({
      p_agent_guidance: meta(), p_assistant_message: write().assistantMessage, p_graph: null,
    }));
    expect(evict).toHaveBeenCalledWith(SCENARIO);
  });

  it.each(['replayed_prior_turn', 'prior_turn_conflict'] as const)('retains the atomic %s receipt', async flag => {
    const { fresh, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: { id: 'row1', replayed_prior_turn: flag === 'replayed_prior_turn',
      prior_turn_conflict: flag === 'prior_turn_conflict' }, error: null });
    expect(await fresh().append(write())).toEqual({ id: 'row1',
      [flag === 'replayed_prior_turn' ? 'replayedPriorTurn' : 'priorTurnConflict']: true });
  });

  it('never falls back to a lossy legacy RPC if the migration is missing', async () => {
    const { fresh, rpc, evict } = setup();
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'function missing' } } as never);
    await expect(fresh().append(write())).rejects.toThrow(/RPC failed/);
    expect(rpc).toHaveBeenCalledOnce();
    expect(evict).not.toHaveBeenCalled();
  });

  // 0.79 SD-1 (CEE #2657): the wrapper admits ONE run_delivery beside guidance (migration 20261006070522); the store
  // guard is its twin, so a write the DB would take is never refused here, and one it would refuse never leaves.
  const delivery = HandlerFactSchema.parse({ fact_type: 'run_delivery', fact_version: 1, noop: false, result: { run_id: 'run_1',
    record: { record_version: 1, run_id: 'run_1', graph_hash: 'a'.repeat(16), phase3_blocks: [] } } });
  it('⭐ RED: a guidance answer carrying ONE run_delivery is sent in ONE RPC, in the wrapper\'s serialised shape', async () => {
    const { fresh, rpc } = setup();
    expect(await fresh().append({ ...write(), handler_facts: [delivery] })).toEqual({ id: 'row1' });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('append_agent_answer_with_guidance', expect.objectContaining({
      p_agent_guidance: meta(),
      p_handler_facts: [{ handler_id: 'run_delivery', action_type: 'run_delivery', noop: false,
        payload: { fact_type: 'run_delivery', fact_version: 1, result: delivery.result } }],
    }));
  });

  it('every OTHER fact set on a guidance answer is refused before any RPC (two deliveries; any other fact)', async () => {
    const { fresh, rpc } = setup();
    const other = { ...delivery, fact_type: 'run_analysis' } as unknown as HandlerFact;
    for (const facts of [[delivery, delivery], [other], [delivery, other]]) {
      await expect(fresh().append({ ...write(), handler_facts: facts })).rejects.toThrow(/final Agent answer/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects attaching metadata to graph or internal claim writes before any RPC', async () => {
    const { fresh, rpc } = setup();
    const changes: Partial<SessionTurnWrite>[] = [{ graph: {} }, { turn_id: 'answer:claim' }, { request_hash: 'not-agent' }, { handler_id: 'run_analysis' }];
    for (const change of changes) {
      await expect(fresh().append({ ...write(), ...change })).rejects.toThrow(/final Agent answer/);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reads the same durable source across a new store instance, bounded and scenario scoped, without using its cache', async () => {
    const row = { scenario_id: SCENARIO, request_hash: 'agent_turn:hash', turn_id: 'old-answer', agent_guidance: meta('dismissed') };
    const { fresh, from, filters } = setup([row]);
    expect(await fresh().readGuidanceHistory(SCENARIO)).toEqual(meta('dismissed').entries);
    expect(await fresh().readGuidanceHistory(SCENARIO)).toEqual(meta('dismissed').entries);
    expect(from).toHaveBeenCalledTimes(2);
    expect(filters).toContainEqual(['eq', 'scenario_id', SCENARIO]);
    expect(filters).toContainEqual(['not', 'turn_id', 'like', '%:claim']);
    expect(filters).toContainEqual(['limit', 20]);
    expect(filters).toContainEqual(['order', 'id', { ascending: false }]);
  });

  it('old rows with no metadata yield an empty history; failed, malformed or wrong-scope reads are unknown', async () => {
    expect(await setup().fresh().readGuidanceHistory(SCENARIO)).toEqual({});
    await expect(setup([], { message: 'unavailable' }).fresh().readGuidanceHistory(SCENARIO)).rejects.toThrow(/unavailable/);
    for (const row of [
      { scenario_id: 'foreign', request_hash: 'agent_turn:h', turn_id: 't', agent_guidance: meta() },
      { scenario_id: SCENARIO, request_hash: 'handler', turn_id: 't', agent_guidance: meta() },
      { scenario_id: SCENARIO, request_hash: 'agent_turn:h', turn_id: 't:claim', agent_guidance: meta() },
      { scenario_id: SCENARIO, request_hash: 'agent_turn:h', turn_id: 't', agent_guidance: { version: 2 } },
    ]) await expect(setup([row]).fresh().readGuidanceHistory(SCENARIO)).rejects.toThrow(/Guidance history/);
  });
});
