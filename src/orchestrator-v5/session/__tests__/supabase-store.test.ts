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

function validRow(turnId: string, createdAt = '2026-04-17T10:00:00.000+00:00') {
  return {
    id: randomUUID(),
    scenario_id: SCENARIO,
    user_id: USER,
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
  it('calls append_turn_atomic with the canonical argument shape', async () => {
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
});

describe('SupabaseSessionStore.checkScenarioExists (Group 3 Task A pre-flight)', () => {
  it('returns true when the scenarios table row exists', async () => {
    const { client, selectCalls } = makeClient({
      selectResult: { data: [{ id: SCENARIO }], error: null },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.checkScenarioExists(SCENARIO)).resolves.toBe(true);
    // Verify the lookup hit the correct table with the correct PK filter.
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0].table).toBe('scenarios');
    expect(selectCalls[0].cols).toBe('id');
    const filters = selectCalls[0].filters as Record<string, unknown>;
    expect(filters['eq:id']).toBe(SCENARIO);
    expect(filters.limit).toBe(1);
  });

  it('returns false when the scenarios row does not exist', async () => {
    const { client } = makeClient({ selectResult: { data: [], error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.checkScenarioExists(SCENARIO)).resolves.toBe(false);
  });

  it('returns false when the driver returns data:null (defensive)', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.checkScenarioExists(SCENARIO)).resolves.toBe(false);
  });

  it('throws SessionReadError on a Supabase-reported SELECT error', async () => {
    const { client } = makeClient({
      selectResult: { error: { message: 'connection reset', code: 'ECONNRESET' } },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.checkScenarioExists(SCENARIO)).rejects.toBeInstanceOf(SessionReadError);
    await expect(store.checkScenarioExists(SCENARIO)).rejects.toMatchObject({ code: 'ECONNRESET' });
  });
});

describe('SupabaseSessionStore.checkScenarioOwnership (Group 3 P0 follow-up)', () => {
  it('calls check_scenario_ownership RPC with canonical args and returns true', async () => {
    const { client, rpcCalls } = makeClient({ rpcResult: { data: true, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.checkScenarioOwnership(SCENARIO, USER)).resolves.toBe(true);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('check_scenario_ownership');
    expect(rpcCalls[0].args).toEqual({ p_scenario_id: SCENARIO, p_user_id: USER });
  });

  it('returns false when RPC reports ownership mismatch', async () => {
    const { client } = makeClient({ rpcResult: { data: false, error: null } });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.checkScenarioOwnership(SCENARIO, USER)).resolves.toBe(false);
  });

  it('throws SessionReadError on RPC transport failure', async () => {
    const { client } = makeClient({
      rpcResult: { error: { message: 'function does not exist', code: '42883' } },
    });
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await expect(store.checkScenarioOwnership(SCENARIO, USER)).rejects.toBeInstanceOf(
      SessionReadError,
    );
  });
});

describe('SupabaseSessionStore.append v1 vs v2 routing (Group 3 P0 follow-up)', () => {
  it('calls append_turn_atomic (v1) when caller_user_id is absent', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await store.append(WRITE);
    expect(rpcCalls[0].fn).toBe('append_turn_atomic');
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_user_id).toBeUndefined();
  });

  it('calls append_turn_atomic_v2 when caller_user_id is present, threading p_user_id', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
      { defaultReadLimit: 20 },
    );
    await store.append({ ...WRITE, caller_user_id: USER });
    expect(rpcCalls[0].fn).toBe('append_turn_atomic_v2');
    const args = rpcCalls[0].args as Record<string, unknown>;
    expect(args.p_user_id).toBe(USER);
    // All the other args remain identical to the v1 shape.
    expect(args.p_scenario_id).toBe(SCENARIO);
    expect(args.p_turn_id).toBe('turn-xyz');
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
