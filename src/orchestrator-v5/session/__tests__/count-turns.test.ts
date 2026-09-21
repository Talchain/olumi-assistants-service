/**
 * `SupabaseSessionStore.countTurns` — the pre-cap conversation total.
 *
 * The ContextPack was reporting `readRecent`'s WINDOW length as the
 * conversation's length. This is the read that supplies the truth. Two
 * properties are load-bearing:
 *
 *  1. It is a SEPARATE read, not a `count` rider on `readRecent`'s SELECT.
 *     That SELECT does not run on every turn — the LRU short-circuits it
 *     whenever `cached.turns.length >= limit`, which is exactly the
 *     beyond-window case the number describes. A count carried on that query
 *     would be absent or stale precisely when it matters. The cache-hit test
 *     below is the executable form of that argument.
 *
 *  2. It THROWS instead of approximating. The only plausible fallback is the
 *     window length, which is the falsehood being removed; an assume-good
 *     default would reintroduce it silently and no test could see it.
 *
 * Hand-rolled client — no network.
 */

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import { SessionReadError } from '../store.js';

const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface SelectCall {
  table: string;
  cols: string;
  opts: unknown;
  filters: Record<string, unknown>;
}

function makeClient(result: {
  count?: number | null;
  error?: { message: string; code?: string } | null;
  rows?: unknown[];
}): { client: SupabaseClient; selectCalls: SelectCall[] } {
  const selectCalls: SelectCall[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const payload = {
        data: result.rows ?? [],
        error: result.error ?? null,
        count: result.count === undefined ? null : result.count,
      };
      const chain = {
        select: (cols: string, opts?: unknown) => {
          selectCalls.push({ table, cols, opts, filters });
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters[`eq:${col}`] = val;
          return chain;
        },
        order: (col: string, opts: unknown) => {
          filters[`order:${col}`] = opts;
          return chain;
        },
        limit: (n: number) => {
          filters.limit = n;
          return Promise.resolve(payload);
        },
        // `countTurns` ends at `.eq(…)`, so the builder itself is awaited.
        then: (resolve: (v: unknown) => void) => resolve(payload),
      };
      return chain as never;
    }),
  } as unknown as SupabaseClient;
  return { client, selectCalls };
}

function makeStore(client: SupabaseClient, cache?: SessionLRUCache): SupabaseSessionStore {
  return new SupabaseSessionStore(
    client,
    cache ?? new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }),
    { defaultReadLimit: 20 },
  );
}

describe('SupabaseSessionStore.countTurns', () => {
  it('asks PostgREST for an exact count with no rows, scoped to the scenario', async () => {
    const { client, selectCalls } = makeClient({ count: 78 });
    expect(await makeStore(client).countTurns(SCENARIO)).toBe(78);

    expect(selectCalls).toHaveLength(1);
    const call = selectCalls[0];
    expect(call.table).toBe('v5_conversation_turns');
    // `count: 'exact'` is the `Prefer: count=exact` header; `head: true` means
    // PostgREST answers with Content-Range and NO row payload.
    expect(call.opts).toEqual({ count: 'exact', head: true });
    // Scope at the bytes: the service-role client bypasses RLS, so this filter
    // is the only thing between the read and every other scenario's turns.
    expect(call.filters['eq:scenario_id']).toBe(SCENARIO);
    // No LIMIT — a limited count would count the limit.
    expect(call.filters.limit).toBeUndefined();
  });

  it('returns a zero count as zero (not as "unknown")', async () => {
    const { client } = makeClient({ count: 0 });
    expect(await makeStore(client).countTurns(SCENARIO)).toBe(0);
  });

  it('THROWS on a PostgREST error — never falls back to an approximation', async () => {
    const { client } = makeClient({ error: { message: 'boom', code: '42P01' } });
    await expect(makeStore(client).countTurns(SCENARIO)).rejects.toBeInstanceOf(SessionReadError);
  });

  it('THROWS when the count is missing — the silent-fallback shape this removes', async () => {
    const { client } = makeClient({ count: null });
    await expect(makeStore(client).countTurns(SCENARIO)).rejects.toThrow(/no exact count/);
  });

  it('is not short-circuited by the LRU cache that hides readRecent’s query', async () => {
    // The reason this is a separate read. Warm the cache with a full window,
    // then prove `readRecent` issues NO query while `countTurns` still does.
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: randomUUID(),
      scenario_id: SCENARIO,
      user_id: null,
      turn_id: `t-${i}`,
      turn_class: 'direct_answer' as const,
      handler_id: null,
      request_hash: `sha256:t-${i}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 10,
      created_at: `2026-07-2${i % 10}T10:00:00.000+00:00`,
    }));
    const { client, selectCalls } = makeClient({ rows, count: 78 });
    const store = makeStore(client);

    await store.readRecent(SCENARIO); // cold: 1 query, populates the cache
    expect(selectCalls).toHaveLength(1);
    await store.readRecent(SCENARIO); // warm: cached.turns.length >= limit
    expect(selectCalls).toHaveLength(1); // ← still 1: the SELECT did NOT run

    // A `count: 'exact'` rider on that SELECT would therefore have delivered
    // nothing on this turn. The separate read does.
    expect(await store.countTurns(SCENARIO)).toBe(78);
    expect(selectCalls).toHaveLength(2);
    expect(selectCalls[1].opts).toEqual({ count: 'exact', head: true });
  });
});
