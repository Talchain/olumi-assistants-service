import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionLRUCache } from '../cache.js';
import { StateCommitFailedError, type SessionTurnWrite } from '../store.js';
import { log } from '../../../utils/telemetry.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTIONS = [{ id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Run a pre-mortem with me.' }];
const KEY = '0123456789abcdef';
const GUIDANCE = { version: 1 as const, entries: { 'RC-PREMORTEM': { status: 'offered' as const, state_key_hash: '012345abcdef' } } };
const write = (): SessionTurnWrite => ({ scenario_id: SCENARIO, turn_id: 'answer-1', turn_class: 'direct_answer',
  handler_id: null, request_hash: 'agent_turn:digest', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
  handler_facts: [], userMessage: 'What next?', assistantMessage: 'Consider a pre-mortem.',
  suggested_actions: ACTIONS, suggested_actions_run_key: KEY });
const receipt = { id: 'row1', replayed_prior_turn: false, prior_turn_conflict: false };

function setup(rows: unknown[] = [], error: unknown = null, throws = false) {
  const filters: unknown[][] = [];
  const chain = Object.fromEntries(['select', 'eq', 'is', 'like', 'not', 'order', 'limit', 'abortSignal'].map(name =>
    [name, vi.fn((...args: unknown[]) => { filters.push([name, ...args]); return chain; })])) as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
  chain.then = ((done: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    (throws ? Promise.reject(new Error('offline')) : Promise.resolve({ data: rows, error })).then(done, reject)) as never;
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: receipt as unknown, error: null as unknown }));
  const from = vi.fn(() => chain);
  const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
  const evict = vi.spyOn(cache, 'invalidateAll');
  const fresh = () => new SupabaseSessionStore({ from, rpc } as never, cache, { defaultReadLimit: 20 });
  return { fresh, rpc, from, filters, evict };
}

describe('X4 final-answer offers persistence', () => {
  it.each([false, true])('RED: exact 18 RPC arguments, guidance=%s, one atomic receipt', async withGuidance => {
    const { fresh, rpc, evict } = setup();
    const w = { ...write(), ...(withGuidance ? { agent_guidance: GUIDANCE } : {}) };
    expect(await fresh().append(w)).toEqual({ id: 'row1' });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('append_agent_answer_with_offers', {
      p_scenario_id: SCENARIO, p_turn_id: w.turn_id, p_turn_class: 'direct_answer', p_handler_id: null,
      p_request_hash: w.request_hash, p_response_emitted: true, p_llm_calls_used: 0, p_duration_ms: 1,
      p_handler_facts: [], p_graph: null, p_brief_text: null, p_pending_actions: [], p_coaching_state: null,
      p_user_message: w.userMessage, p_assistant_message: w.assistantMessage,
      p_agent_guidance: withGuidance ? GUIDANCE : null, p_suggested_actions: ACTIONS, p_suggested_actions_run_key: KEY,
    });
    expect(evict).toHaveBeenCalledExactlyOnceWith(SCENARIO);
  });

  it('RED: absent Run binding is explicitly null; empty offers keep the existing RPC', async () => {
    const { fresh, rpc } = setup();
    await fresh().append({ ...write(), suggested_actions_run_key: undefined });
    expect(rpc.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ p_suggested_actions_run_key: null }));
    rpc.mockResolvedValueOnce({ data: 'row2', error: null });
    await fresh().append({ ...write(), suggested_actions: [] });
    expect(rpc.mock.calls[1]?.[0]).toBe('append_turn_atomic_v2');
    expect(rpc.mock.calls[1]?.[1]).not.toHaveProperty('p_suggested_actions');
  });

  it.each(['replayed_prior_turn', 'prior_turn_conflict'] as const)('RED: preserves %s', async flag => {
    const { fresh, rpc } = setup();
    rpc.mockResolvedValueOnce({ data: { ...receipt, [flag]: true }, error: null });
    expect(await fresh().append(write())).toEqual({ id: 'row1',
      [flag === 'replayed_prior_turn' ? 'replayedPriorTurn' : 'priorTurnConflict']: true });
  });

  it.each([{ graph: {} }, { turn_class: 'handler', handler_id: 'run_analysis' }, { turn_id: 'answer:claim' },
    { request_hash: 'sha256:internal' }, { response_emitted: false }, { briefText: 'new brief' },
    { coaching_state: {} }, { modelVersion: {} }] as Partial<SessionTurnWrite>[])('RED: refuses non-answer offers before RPC: %j', async patch => {
    const { fresh, rpc } = setup();
    await expect(fresh().append({ ...write(), ...patch })).rejects.toBeInstanceOf(StateCommitFailedError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['PGRST202', '42883'])('RED: missing-function %s falls back once, with and without guidance', async code => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      for (const withGuidance of [false, true]) {
        const { fresh, rpc } = setup();
        rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'function missing' } });
        rpc.mockResolvedValueOnce({ data: withGuidance ? receipt : 'row1', error: null });
        expect(await fresh().append({ ...write(), ...(withGuidance ? { agent_guidance: GUIDANCE } : {}) })).toEqual({ id: 'row1' });
        expect(rpc).toHaveBeenCalledTimes(2);
        expect(rpc.mock.calls[1]?.[0]).toBe(withGuidance ? 'append_agent_answer_with_guidance' : 'append_turn_atomic_v2');
        expect(rpc.mock.calls[1]?.[1]).not.toHaveProperty('p_suggested_actions');
        expect(rpc.mock.calls[1]?.[1]).not.toHaveProperty('p_suggested_actions_run_key');
        if (withGuidance) expect(rpc.mock.calls[1]?.[1]).toHaveProperty('p_agent_guidance', GUIDANCE);
      }
      expect(warn).toHaveBeenCalledTimes(2);
    } finally { warn.mockRestore(); }
  });

  it('CONTROL: other errors and malformed receipts still throw, never fall back', async () => {
    for (const response of [{ data: null, error: { code: '23514', message: 'constraint' } },
      { data: 'not-a-receipt', error: null }, { data: { ...receipt, replayed_prior_turn: true, prior_turn_conflict: true }, error: null }]) {
      const { fresh, rpc, evict } = setup();
      rpc.mockResolvedValueOnce(response);
      await expect(fresh().append(write())).rejects.toBeInstanceOf(StateCommitFailedError);
      expect(rpc).toHaveBeenCalledOnce(); expect(evict).not.toHaveBeenCalled();
    }
  });

  it('RED: latest offers use one narrow uncached scenario query; null binding is valid', async () => {
    for (const runKey of [KEY, null]) {
      const { fresh, from, filters } = setup([{ turn_id: 'answer-1', request_hash: 'agent_turn:h',
        suggested_actions: ACTIONS, suggested_actions_run_key: runKey }]);
      expect(await fresh().readLatestAnswerOffers(SCENARIO)).toEqual({ turn_id: 'answer-1', suggested_actions: ACTIONS, run_key: runKey });
      expect(from).toHaveBeenCalledExactlyOnceWith('v5_conversation_turns');
      expect(filters).toContainEqual(['select', 'turn_id, request_hash, suggested_actions, suggested_actions_run_key']);
      expect(filters).toContainEqual(['eq', 'scenario_id', SCENARIO]);
      expect(filters).toContainEqual(['like', 'request_hash', 'agent_turn:%']);
      expect(filters).toContainEqual(['not', 'turn_id', 'like', '%:claim']);
      expect(filters).toContainEqual(['order', 'created_at', { ascending: false }]);
      expect(filters).toContainEqual(['order', 'turn_id', { ascending: false }]);
      expect(filters).toContainEqual(['limit', 1]);
      expect(filters.some(f => f[0] === 'not' && f[1] === 'suggested_actions')).toBe(false);
      await fresh().readLatestAnswerOffers(SCENARIO); expect(from).toHaveBeenCalledTimes(2);
    }
  });

  it('RED: missing columns, failed/throwing reads and malformed envelopes are null, never throw', async () => {
    const row = { turn_id: 'answer-1', request_hash: 'agent_turn:h', suggested_actions: ACTIONS, suggested_actions_run_key: KEY };
    for (const patch of [{ suggested_actions: null }, { suggested_actions: {} }, { suggested_actions: [] },
      { suggested_actions: Array(9).fill(ACTIONS[0]) }, { suggested_actions: [{ ...ACTIONS[0], action_type: 'run_analysis' }] },
      { suggested_actions: [{ ...ACTIONS[0], detail: 'approval' }] }, { suggested_actions: [{ ...ACTIONS[0], id: 'agent-approve-proposal:p' }] },
      { suggested_actions: [{ ...ACTIONS[0], label: '' }] }, { suggested_actions: [{ ...ACTIONS[0], message: 'x'.repeat(401) }] },
      { suggested_actions: [{ ...ACTIONS[0], label: 'x'.repeat(81) }] }, { suggested_actions: [{ id: ACTIONS[0]!.id, label: 'label' }] },
      { suggested_actions: [null] }, { suggested_actions: [{ ...ACTIONS[0], id: 'agent-next-pre-mortem\n' }] }, { suggested_actions_run_key: '0123456789abcde' }, { suggested_actions_run_key: undefined }, { suggested_actions_run_key: KEY + '\n' },
      { request_hash: 'sha256:internal' }, { turn_id: 'answer:claim' }]) {
      expect(await setup([{ ...row, ...patch }]).fresh().readLatestAnswerOffers(SCENARIO)).toBeNull();
    }
    expect(await setup([{ turn_id: 'old', request_hash: 'agent_turn:h' }]).fresh().readLatestAnswerOffers(SCENARIO)).toBeNull();
    expect(await setup([], { code: '42703', message: 'missing column' }).fresh().readLatestAnswerOffers(SCENARIO)).toBeNull();
    expect(await setup([], { message: 'offline' }).fresh().readLatestAnswerOffers(SCENARIO)).toBeNull();
    expect(await setup([], null, true).fresh().readLatestAnswerOffers(SCENARIO)).toBeNull();
    expect(await setup().fresh().readLatestAnswerOffers(SCENARIO)).toBeNull();
  });
});

describe('X4 migration boundaries (static, no database required)', () => {
  const sql = readFileSync(new URL('../../../../supabase/migrations/20261006230000_agent_answer_offers.sql', import.meta.url), 'utf8');
  const rollback = readFileSync(new URL('../../../../supabase/migrations/rollback/20261006230000_agent_answer_offers_rollback.sql.do-not-apply', import.meta.url), 'utf8');
  it('RED: narrow invoker wrapper delegates both paths and uses the full 18-type grants', () => {
    expect(sql).toMatch(/RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER/);
    expect(sql).toContain('SET search_path = pg_catalog, public');
    expect(sql).toMatch(/IF p_agent_guidance IS NOT NULL THEN[\s\S]*public\.append_agent_answer_with_guidance\([\s\S]*ELSE[\s\S]*public\.append_turn_atomic_v2\(/);
    expect(sql).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION public\.append_(?:turn_atomic_v2|agent_answer_with_guidance)/);
    expect(sql).toContain('jsonb_array_length(p_suggested_actions) NOT BETWEEN 1 AND 8');
    expect(sql).toContain("(v_action - 'id' - 'label' - 'message') <> '{}'::jsonb");
    expect(sql).toContain("'^agent-[a-z0-9-]{1,80}$'"); expect(sql).toContain("'^[0-9a-f]{16}$'");
    expect(sql).toContain('char_length(v_action->>\'label\') NOT BETWEEN 1 AND 80');
    expect(sql).toContain('char_length(v_action->>\'message\') NOT BETWEEN 1 AND 400');
    expect(sql).not.toMatch(/p_handler_facts IS DISTINCT/);
    const signature = 'uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb, text, jsonb, jsonb, text, text, jsonb, jsonb, text';
    expect(sql.split(signature)).toHaveLength(3); expect(rollback).toContain(signature);
    expect(sql).toContain('FROM PUBLIC, anon, authenticated'); expect(sql).toContain('TO service_role');
  });
  it('RED: lock then existence then delegate then stamp only new exact answer rows; rollback loses offers only', () => {
    expect(sql.indexOf('FOR UPDATE')).toBeLessThan(sql.indexOf('SELECT id, request_hash'));
    expect(sql.indexOf('SELECT id, request_hash')).toBeLessThan(sql.indexOf('v_receipt := public.'));
    expect(sql).toMatch(/IF v_existing IS NULL THEN\s+UPDATE public\.v5_conversation_turns/);
    expect(sql).toContain('AND request_hash = p_request_hash');
    expect(sql).toContain("IF NOT FOUND THEN RAISE EXCEPTION 'offers answer row not found'");
    expect(rollback).toContain('DROP COLUMN IF EXISTS suggested_actions_run_key');
    expect(rollback).not.toMatch(/DROP.*(?:agent_guidance|append_turn_atomic_v2)/);
  });
  it('CONTROL: hot conversation select and store update-call count stay unchanged', () => {
    const storeSource = readFileSync(new URL('../supabase-store.ts', import.meta.url), 'utf8');
    const hot = storeSource.match(/const V5_CONVERSATION_TURN_COLUMNS\s*=\s*([^;]+);/)?.[1];
    expect(hot).toBeDefined(); expect(hot).not.toContain('suggested_actions');
    expect(storeSource.match(/\.update\(/g) ?? []).toHaveLength(2);
  });
});
