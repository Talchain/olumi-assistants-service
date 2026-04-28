/**
 * SupabaseSessionStore unit tests (slice B).
 *
 * The Supabase client is hand-rolled: no live network. Assertions cover
 * RPC-invocation shape, error propagation, cache interactions, and row
 * parsing. Content-level — not shape-level — assertions (A1 lesson).
 */

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import {
  SessionReadError,
  StateCommitFailedError,
  type SessionTurnWrite,
} from '../store.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function validRow(turnId: string, createdAt = '2026-04-17T10:00:00.000+00:00', userId: string | null = USER) {
  return {
    id: randomUUID(),
    scenario_id: SCENARIO,
    user_id: userId,
    turn_id: turnId,
    turn_class: 'direct_answer' as const,
    handler_id: null,
    request_hash: `sha256:${turnId}`,
    response_emitted: true,
    llm_calls_used: 2,
    duration_ms: 123,
    created_at: createdAt,
  };
}

interface MockConfig {
  rpcResult?: { data?: unknown; error?: { message: string; code?: string } | null };
  selectResult?: { data?: unknown; error?: { message: string; code?: string } | null };
}

function makeClient(cfg: MockConfig = {}): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: unknown }>;
  selectCalls: Array<{ table: string; cols: string; filters: unknown }>;
} {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const selectCalls: Array<{ table: string; cols: string; filters: unknown }> = [];

  const client = {
    rpc: vi.fn(async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return cfg.rpcResult ?? { data: 'row-id-123', error: null };
    }),
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {};
      const chain = {
        select: (cols: string) => {
          selectCalls.push({ table, cols, filters });
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters[`eq:${col}`] = val;
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          filters[`in:${col}`] = vals;
          return chain;
        },
        order: (col: string, opts: unknown) => {
          filters[`order:${col}`] = opts;
          return chain;
        },
        limit: (n: number) => {
          filters.limit = n;
          // Terminal — return the promise result
          return Promise.resolve(cfg.selectResult ?? { data: [], error: null });
        },
        maybeSingle: () =>
          Promise.resolve(cfg.selectResult ?? { data: null, error: null }),
        // Non-terminal .in followed by terminal awaitable
        then: (resolve: (v: unknown) => void) =>
          resolve(cfg.selectResult ?? { data: [], error: null }),
        insert: (_: unknown) => Promise.resolve(cfg.selectResult ?? { data: null, error: null }),
      };
      Object.assign(builder, chain);
      return chain as never;
    }),
  } as unknown as SupabaseClient;

  return { client, rpcCalls, selectCalls };
}

const WRITE: SessionTurnWrite = {
  scenario_id: SCENARIO,
  turn_id: 'turn-xyz',
  turn_class: 'direct_answer',
  handler_id: null,
  request_hash: 'sha256:abc',
  response_emitted: true,
  llm_calls_used: 2,
  duration_ms: 40,
  handler_facts: [],
};

describe('SupabaseSessionStore.append', () => {
  it('calls append_turn_atomic with the canonical argument shape (no graph)', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await store.append(WRITE);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('append_turn_atomic');
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_scenario_id).toBe(SCENARIO);
    expect(args.p_turn_id).toBe('turn-xyz');
    expect(args.p_turn_class).toBe('direct_answer');
    expect(args.p_handler_id).toBeNull();
    expect(args.p_request_hash).toBe('sha256:abc');
    expect(args.p_response_emitted).toBe(true);
    expect(args.p_llm_calls_used).toBe(2);
    expect(args.p_duration_ms).toBe(40);
    expect(args.p_handler_facts).toEqual([]);
    // p_graph must be sent as `null` (not omitted) when the write has no
    // graph. This is required to keep PostgREST overload resolution
    // deterministic — see the always-10-args invariant test below and
    // the comment in supabase-store.ts:append.
    expect(args.p_graph).toBeNull();
  });

  it('passes p_graph when write.graph is provided (atomic graph commit)', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    const graph = { nodes: [{ id: 'n1', kind: 'decision', label: 'Launch?' }], edges: [] };
    await store.append({ ...WRITE, graph });
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_graph).toEqual(graph);
  });

  it('returns the persisted row id from the RPC', async () => {
    const { client } = makeClient({ rpcResult: { data: 'abc-def', error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    const result = await store.append(WRITE);
    expect(result.id).toBe('abc-def');
  });

  it('throws StateCommitFailedError with rpc_code on RPC error', async () => {
    const { client } = makeClient({
      rpcResult: { error: { message: 'permission denied', code: '42501' } },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.append(WRITE)).rejects.toBeInstanceOf(StateCommitFailedError);
    await expect(store.append(WRITE)).rejects.toMatchObject({ rpc_code: '42501' });
  });

  it('throws StateCommitFailedError when RPC returns non-string data', async () => {
    const { client } = makeClient({ rpcResult: { data: { not: 'a string' }, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.append(WRITE)).rejects.toBeInstanceOf(StateCommitFailedError);
  });

  it('invalidates the scenario cache on successful append (next read is fresh)', async () => {
    const { client } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    cache.populate(SCENARIO, [
      {
        ...validRow('stale-1'),
        scenario_id: SCENARIO,
      },
    ]);
    expect(cache.getScenario(SCENARIO)).not.toBeNull();

    await store.append(WRITE);
    expect(cache.getScenario(SCENARIO)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// V5 Step 4 regression suite (2026-04-26)
//
// The chip_click run_analysis commit failed in staging with HTTP 500
// (request_id 99a83f32-…) because two append_turn_atomic overloads
// coexisted in the database — a 9-arg and a 10-arg signature. The
// client was sending only 9 named args (p_graph spread conditionally),
// so PostgREST could not disambiguate and returned:
//   "Could not choose the best candidate function between:
//    public.append_turn_atomic(…9 args…),
//    public.append_turn_atomic(…10 args…)"
//
// Fix is two-pronged: (a) migration drops the stale 9-arg overload
// (supabase/migrations/20260426160532_…sql), (b) this suite locks in
// the always-10-args invariant on the client so any future overload
// reintroduction cannot silently wedge commits again.
// ────────────────────────────────────────────────────────────────────

import type { HandlerFact } from '@talchain/schemas/orchestrator';

const RUN_ANALYSIS_FACT: HandlerFact = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO,
    leading_option_id: 'opt-a',
    summary: 'Analysis ran with two options compared.',
    win_probabilities: { 'opt-a': 0.62, 'opt-b': 0.38 },
  },
};

describe('SupabaseSessionStore.append — V5 Step 4 regression (PostgREST overload disambiguation)', () => {
  it('always passes all 10 named args to append_turn_atomic, p_graph=null when absent', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await store.append(WRITE);

    expect(rpcCalls).toHaveLength(1);
    const args = rpcCalls[0].args as Record<string, unknown>;
    const keys = Object.keys(args).sort();

    // The 10-arg invariant. Drift here = PostgREST overload ambiguity
    // can re-emerge if a future migration ever adds another overload.
    expect(keys).toEqual([
      'p_duration_ms',
      'p_graph',
      'p_handler_facts',
      'p_handler_id',
      'p_llm_calls_used',
      'p_request_hash',
      'p_response_emitted',
      'p_scenario_id',
      'p_turn_class',
      'p_turn_id',
    ]);
    expect(args.p_graph).toBeNull();
  });

  it('always passes all 10 named args even when write.graph IS provided', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    const graph = { nodes: [{ id: 'n1', kind: 'decision', label: 'Launch?' }], edges: [] };
    await store.append({ ...WRITE, graph });

    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(Object.keys(args)).toHaveLength(10);
    expect(args.p_graph).toEqual(graph);
  });

  it('serialises a RunAnalysisHandlerFact into the inner-FOR-LOOP payload shape', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await store.append({
      ...WRITE,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      handler_facts: [RUN_ANALYSIS_FACT],
    });

    const args = rpcCalls[0].args as Record<string, unknown>;
    const facts = args.p_handler_facts as Array<Record<string, unknown>>;

    // The migration's inner FOR LOOP at
    // 20260422210000_v5_append_turn_atomic_graph_idempotency_fix.sql:113-129
    // unpacks each entry by these exact keys. Drift here = silent INSERT
    // shape change.
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      handler_id: 'run_analysis',
      action_type: 'run_analysis',
      noop: false,
    });
    expect(facts[0].payload).toMatchObject({
      fact_type: 'run_analysis',
      fact_version: 1,
      result: { scenario_id: SCENARIO, leading_option_id: 'opt-a' },
    });
  });

  it('propagates a PostgREST overload-ambiguity error as StateCommitFailedError (the original Step 4 failure mode)', async () => {
    // Simulates: the 9-arg overload was never dropped, two
    // append_turn_atomic versions coexist in the database, the client
    // sends 10 args BUT PostgREST still returns ambiguity (e.g. if a
    // hypothetical 10-arg AND 11-arg overload coexisted later). This
    // test asserts the error wrapping stays well-formed regardless of
    // the underlying ambiguity scenario.
    const { client } = makeClient({
      rpcResult: {
        error: {
          code: 'PGRST203',
          message:
            'Could not choose the best candidate function between: ' +
            'public.append_turn_atomic(uuid, text, text, text, text, boolean, integer, integer, jsonb), ' +
            'public.append_turn_atomic(uuid, text, text, text, text, boolean, integer, integer, jsonb, jsonb)',
        },
      },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );

    const promise = store.append({
      ...WRITE,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      handler_facts: [RUN_ANALYSIS_FACT],
    });

    await expect(promise).rejects.toBeInstanceOf(StateCommitFailedError);
    await expect(promise).rejects.toMatchObject({
      rpc_code: 'PGRST203',
      message: expect.stringMatching(/Could not choose the best candidate function/),
    });
  });
});

describe('SupabaseSessionStore.readRecent', () => {
  it('returns cached turns on cache hit (no DB round-trip)', async () => {
    const { client, selectCalls } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 2 });
    cache.populate(SCENARIO, [validRow('t1'), validRow('t2')]);

    const got = await store.readRecent(SCENARIO, 2);
    expect(got).toHaveLength(2);
    expect(selectCalls).toHaveLength(0);
  });

  it('queries DB on cache miss and populates cache', async () => {
    const { client, selectCalls } = makeClient({
      selectResult: { data: [validRow('t1'), validRow('t2')], error: null },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    const got = await store.readRecent(SCENARIO);
    expect(got).toHaveLength(2);
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0].table).toBe('v5_conversation_turns');
    // Subsequent call should hit cache
    const second = await store.readRecent(SCENARIO);
    expect(second).toHaveLength(2);
    expect(selectCalls).toHaveLength(1); // no new DB query
  });

  it('throws SessionReadError when the SELECT fails', async () => {
    const { client } = makeClient({
      selectResult: { error: { message: 'table missing', code: '42P01' } },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    await expect(store.readRecent(SCENARIO)).rejects.toBeInstanceOf(SessionReadError);
  });

  it('throws SessionReadError when a row fails SessionTurnSchema parse', async () => {
    const badRow = { ...validRow('t1'), turn_class: 'not_real' };
    const { client } = makeClient({ selectResult: { data: [badRow], error: null } });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    await expect(store.readRecent(SCENARIO)).rejects.toBeInstanceOf(SessionReadError);
  });

  it('accepts rows with user_id: null (guest mode)', async () => {
    const guestRow = validRow('t1', '2026-04-17T10:00:00.000+00:00', null);
    const { client, selectCalls } = makeClient({
      selectResult: { data: [guestRow], error: null },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    const got = await store.readRecent(SCENARIO);
    expect(got).toHaveLength(1);
    expect(got[0].user_id).toBeNull();
    expect(selectCalls).toHaveLength(1);
  });

  it('defaults limit to defaultReadLimit when not passed', async () => {
    const { client, selectCalls } = makeClient({
      selectResult: { data: [], error: null },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 7 });
    await store.readRecent(SCENARIO);
    // Check the limit filter ended up as 7
    const filters = selectCalls[0].filters as Record<string, unknown>;
    expect(filters.limit).toBe(7);
  });
});

describe('SupabaseSessionStore.readFactsFor', () => {
  it('short-circuits on empty turn-id list without hitting DB', async () => {
    const { client, selectCalls } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    const got = await store.readFactsFor([]);
    expect(got).toEqual([]);
    expect(selectCalls).toHaveLength(0);
  });

  it('throws SessionReadError on DB error', async () => {
    const { client } = makeClient({
      selectResult: { error: { message: 'boom', code: '42P01' } },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    await expect(store.readFactsFor(['row-1'])).rejects.toBeInstanceOf(SessionReadError);
  });

  // V5 review: regression guards for the correctness fixes introduced
  // alongside the Task 1.4 analysis fallback.
  it('orders facts by created_at DESC (newest-first)', async () => {
    const { client, selectCalls } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    await store.readFactsFor(['row-a', 'row-b']);
    expect(selectCalls).toHaveLength(1);
    const filters = selectCalls[0].filters as Record<string, unknown>;
    expect(filters['order:created_at']).toEqual({ ascending: false });
  });

  it('filters against v5_conversation_turn_id (the row id column, not turn_id)', async () => {
    // Critical correctness guard: the FK column in v5_handler_facts
    // references v5_conversation_turns.id (the DB-generated row UUID),
    // NOT v5_conversation_turns.turn_id (the client-generated string).
    // Callers must pass SessionTurn.id values here.
    const { client, selectCalls } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    const rowIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    await store.readFactsFor(rowIds);
    expect(selectCalls).toHaveLength(1);
    const filters = selectCalls[0].filters as Record<string, unknown>;
    expect(filters['in:v5_conversation_turn_id']).toEqual(rowIds);
    // Must NOT filter on the client-side turn_id column.
    expect(filters['in:turn_id']).toBeUndefined();
  });

  // Regression guard for the 2026-04-28 staging Step 5 silent fact-drop.
  // The write path (`mapFactsForRpc`) projects the wire shape into a split
  // DB shape — `payload` JSONB carries `{fact_type, fact_version, result}`
  // while `noop` is its own column. The read path must rejoin them before
  // HandlerFactSchema validation, otherwise `.strict()` rejects every row
  // and `prior_facts` is silently empty. The exact staging row shape:
  //   { noop: false, payload: { fact_type, fact_version: 1, result: {...} } }
  it('hydrates noop column into payload before HandlerFactSchema validation', async () => {
    // This is the verbatim shape captured from staging scenario
    // 40927e27-bf1f-4788-b86f-40eeadaa4fca v5_handler_facts row
    // e16c7656-8171-49e3-90d6-7bf916b45ac0 on 2026-04-28: noop is a DB
    // column (false), payload contains {fact_type, fact_version, result}
    // — and importantly NOT noop. Pre-fix this row threw SessionReadError.
    const stagingRow = {
      noop: false,
      handler_id: 'run_analysis',
      action_type: 'run_analysis',
      payload: {
        fact_type: 'run_analysis',
        fact_version: 1,
        result: {
          scenario_id: '40927e27-bf1f-4788-b86f-40eeadaa4fca',
          leading_option_id: 'opt_hire_local',
          summary: 'Analysis complete',
        },
      },
    };
    const { client } = makeClient({
      selectResult: { data: [stagingRow], error: null },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    const facts = await store.readFactsFor(['96404c69-ad9c-41f2-b4f5-f624ffa0ded2']);
    expect(facts).toHaveLength(1);
    const fact = facts[0];
    expect(fact.fact_type).toBe('run_analysis');
    expect(fact.fact_version).toBe(1);
    expect(fact.noop).toBe(false);
    if (fact.fact_type === 'run_analysis') {
      expect(fact.result.leading_option_id).toBe('opt_hire_local');
    }
  });

  it('honours payload-side noop when DB column is absent (legacy / future writers)', async () => {
    // Defence in depth: if a future writer ever puts noop inside the
    // payload, do not double-write or clobber it.
    const legacyRow = {
      // noop column intentionally absent
      payload: {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: true,
        result: {
          scenario_id: '11111111-1111-4111-8111-111111111111',
          leading_option_id: null,
          summary: 'noop suppression',
        },
      },
    };
    const { client } = makeClient({
      selectResult: { data: [legacyRow], error: null },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    const facts = await store.readFactsFor(['row-1']);
    expect(facts).toHaveLength(1);
    expect(facts[0].noop).toBe(true);
  });

  it('defaults noop to false when both DB column and payload field are absent', async () => {
    // Backstop for legacy rows that pre-date the column. Without this
    // path the schema would still reject and `prior_facts` would empty.
    const ancientRow = {
      payload: {
        fact_type: 'run_analysis',
        fact_version: 1,
        result: {
          scenario_id: '22222222-2222-4222-8222-222222222222',
          leading_option_id: 'opt_a',
          summary: 'pre-noop schema',
        },
      },
    };
    const { client } = makeClient({
      selectResult: { data: [ancientRow], error: null },
    });
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    const facts = await store.readFactsFor(['row-1']);
    expect(facts).toHaveLength(1);
    expect(facts[0].noop).toBe(false);
  });

  // Round-trip: write a run_analysis fact via the same `append` path
  // that chip-click-dispatch.ts uses, capture what `mapFactsForRpc`
  // sends to Supabase, simulate that as the row shape on read, and
  // confirm `readFactsFor` hydrates it back into a valid HandlerFact.
  // Pre-fix this round-trip failed because `mapFactsForRpc` writes
  // payload without noop and `readFactsFor` parsed payload raw.
  it('round-trips a run_analysis fact through append → readFactsFor hydration', async () => {
    const { client, rpcCalls } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    const runAnalysisFact = {
      fact_type: 'run_analysis' as const,
      fact_version: 1 as const,
      noop: false,
      result: {
        scenario_id: SCENARIO,
        leading_option_id: 'opt_hire_local',
        summary: 'Analysis ran successfully',
      },
    };

    await store.append({
      scenario_id: SCENARIO,
      turn_id: 'turn-roundtrip',
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: 'sha256:roundtrip',
      response_emitted: true,
      llm_calls_used: 0,
      duration_ms: 50,
      handler_facts: [runAnalysisFact],
    });

    expect(rpcCalls).toHaveLength(1);
    const rpcArgs = rpcCalls[0].args as Record<string, unknown>;
    const dbFacts = rpcArgs.p_handler_facts as Array<{
      handler_id: string;
      action_type: string;
      noop: boolean;
      payload: Record<string, unknown>;
    }>;
    expect(dbFacts).toHaveLength(1);
    // Sanity: the write splits noop out of payload.
    expect(dbFacts[0].noop).toBe(false);
    expect(dbFacts[0].payload).not.toHaveProperty('noop');
    expect(dbFacts[0].payload.fact_type).toBe('run_analysis');

    // Now read the same shape back. SELECT-shape mirrors what Supabase
    // returns: `{ payload, handler_id, action_type, noop }`.
    const dbRow = {
      payload: dbFacts[0].payload,
      handler_id: dbFacts[0].handler_id,
      action_type: dbFacts[0].action_type,
      noop: dbFacts[0].noop,
    };
    const { client: readClient } = makeClient({
      selectResult: { data: [dbRow], error: null },
    });
    const readStore = new SupabaseSessionStore(readClient, cache, { defaultReadLimit: 20 });

    const facts = await readStore.readFactsFor(['row-roundtrip']);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual(runAnalysisFact);
  });
});

describe('SupabaseSessionStore.loadGraph', () => {
  it('returns null when scenarios.graph is null (no graph stored yet)', async () => {
    const { client, selectCalls } = makeClient({
      selectResult: { data: { graph: null }, error: null },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    const result = await store.loadGraph(SCENARIO);
    expect(result).toBeNull();
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0].table).toBe('scenarios');
  });

  it('returns null when maybeSingle returns no row (scenario row absent)', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    expect(await store.loadGraph(SCENARIO)).toBeNull();
  });

  it('returns the graph when present', async () => {
    const graph = { nodes: [{ id: 'n1', kind: 'factor', label: 'Churn' }], edges: [] };
    const { client } = makeClient({ selectResult: { data: { graph }, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    expect(await store.loadGraph(SCENARIO)).toEqual(graph);
  });

  it('throws SessionReadError on DB error', async () => {
    const { client } = makeClient({
      selectResult: { error: { message: 'permission denied', code: '42501' } },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.loadGraph(SCENARIO)).rejects.toBeInstanceOf(SessionReadError);
  });
});

describe('SupabaseSessionStore.ensureScenarioExists (upsert-on-append pre-flight)', () => {
  it('invokes ensure_scenario_exists with the caller-supplied scenario_id + user_id', async () => {
    const { client, rpcCalls } = makeClient({
      rpcResult: { data: USER, error: null },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.ensureScenarioExists(SCENARIO, USER)).resolves.toEqual({
      user_id: USER,
    });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('ensure_scenario_exists');
    expect(rpcCalls[0].args).toEqual({
      p_scenario_id: SCENARIO,
      p_user_id: USER,
    });
  });

  it('returns the authoritative owner when it differs from the caller (cross-tenant signal)', async () => {
    // The RPC re-reads scenarios.user_id regardless of whether it inserted,
    // so a pre-existing row with a different owner surfaces as a non-matching
    // user_id. The STORE itself does not reject — that decision lives in the
    // pre-flight caller (build-turn-context.preflightEnsureScenario).
    const otherOwner = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const { client } = makeClient({
      rpcResult: { data: otherOwner, error: null },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.ensureScenarioExists(SCENARIO, USER)).resolves.toEqual({
      user_id: otherOwner,
    });
  });

  it('throws SessionReadError on an RPC-level error', async () => {
    const { client } = makeClient({
      rpcResult: { error: { message: 'connection reset', code: 'ECONNRESET' } },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.ensureScenarioExists(SCENARIO, USER)).rejects.toBeInstanceOf(
      SessionReadError,
    );
    await expect(store.ensureScenarioExists(SCENARIO, USER)).rejects.toMatchObject({
      code: 'ECONNRESET',
    });
  });

  it('throws SessionReadError when the RPC returns a non-string (shape drift guard)', async () => {
    const { client } = makeClient({
      rpcResult: { data: { unexpected: 'object' }, error: null },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.ensureScenarioExists(SCENARIO, USER)).rejects.toBeInstanceOf(
      SessionReadError,
    );
  });
});

describe('SupabaseSessionStore invalidation delegation', () => {
  it('invalidateScoped delegates to the cache layer', async () => {
    const { client } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    cache.populate(SCENARIO, [validRow('t1')]);
    const result = await store.invalidateScoped(SCENARIO, { kind: 'structural' });
    expect(result.entries_invalidated).toEqual(['t1']);
  });

  it('invalidateAll delegates to the cache layer', async () => {
    const { client } = makeClient();
    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    cache.populate(SCENARIO, [validRow('t1'), validRow('t2')]);
    const result = await store.invalidateAll(SCENARIO);
    expect(result.entries_invalidated).toEqual(['t1', 't2']);
    expect(cache.getScenario(SCENARIO)).toBeNull();
  });
});

describe('SupabaseSessionStore.storeDraftGraph', () => {
  const GRAPH = {
    nodes: [{ id: 'dec_launch', kind: 'decision', label: 'Launch?' }],
    edges: [{ from: 'dec_launch', to: 'goal_revenue', kind: 'influences', weight: 1 }],
  };

  it('calls store_draft_graph RPC with p_scenario_id and p_graph', async () => {
    const { client, rpcCalls } = makeClient({ rpcResult: { data: null, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await store.storeDraftGraph(SCENARIO, GRAPH);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('store_draft_graph');
    expect(rpcCalls[0].args).toEqual({
      p_scenario_id: SCENARIO,
      p_graph: GRAPH,
    });
  });

  it('resolves without returning a value on success', async () => {
    const { client } = makeClient({ rpcResult: { data: null, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.storeDraftGraph(SCENARIO, GRAPH)).resolves.toBeUndefined();
  });

  it('throws StateCommitFailedError with rpc_code on RPC error', async () => {
    const { client } = makeClient({
      rpcResult: { error: { message: 'scenario not found', code: 'P0001' } },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.storeDraftGraph(SCENARIO, GRAPH)).rejects.toBeInstanceOf(
      StateCommitFailedError,
    );
    await expect(store.storeDraftGraph(SCENARIO, GRAPH)).rejects.toMatchObject({
      rpc_code: 'P0001',
    });
  });
});
