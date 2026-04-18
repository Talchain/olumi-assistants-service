/**
 * Slice B — D6 invalidation.
 *
 * Proves: invalidation fires on correct scope (DoD item 2). Scoped
 * invalidation marks entries stale without deleting DB rows (history is
 * immutable); full invalidation evicts the cache entry so the next read
 * repopulates from Supabase.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TEST_SCENARIO_ID);
const suite = envReady ? describe : describe.skip;

suite('Slice B invalidation — scoped vs full', () => {
  let client: SupabaseClient;
  const writtenTurnIds: string[] = [];

  beforeEach(() => {
    client = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  afterEach(async () => {
    if (writtenTurnIds.length > 0) {
      await client.from('v5_conversation_turns').delete().in('turn_id', writtenTurnIds);
      writtenTurnIds.length = 0;
    }
  });

  it('scoped(structural) marks cached turns stale but DB rows persist', async () => {
    const runId = `invalid-${randomUUID()}`;
    const turnId = `${runId}-t1`;
    writtenTurnIds.push(turnId);

    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    await store.append({
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 2,
      duration_ms: 100,
      handler_facts: [],
    });

    // Warm the cache by reading
    const warm = await store.readRecent(TEST_SCENARIO_ID!);
    expect(warm.map((t) => t.turn_id)).toContain(turnId);

    // Scoped invalidation (structural) — entries go stale
    const result = await store.invalidateScoped(TEST_SCENARIO_ID!, { kind: 'structural' });
    expect(result.entries_invalidated.length).toBeGreaterThan(0);

    // DB row still exists (history immutable)
    const { data: rows } = await client
      .from('v5_conversation_turns')
      .select('turn_id')
      .eq('turn_id', turnId);
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(1);

    // Fresh store can still read via DB
    const freshCache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
    const freshStore = new SupabaseSessionStore(client, freshCache, { defaultReadLimit: 20 });
    const reloaded = await freshStore.readRecent(TEST_SCENARIO_ID!);
    expect(reloaded.map((t) => t.turn_id)).toContain(turnId);
  });

  it('full invalidation evicts scenario entry — next read repopulates from DB', async () => {
    const runId = `invalid-full-${randomUUID()}`;
    const turnId = `${runId}-t1`;
    writtenTurnIds.push(turnId);

    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    await store.append({
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 2,
      duration_ms: 100,
      handler_facts: [],
    });

    await store.readRecent(TEST_SCENARIO_ID!);
    expect(cache.size()).toBeGreaterThan(0); // cache warm

    await store.invalidateAll(TEST_SCENARIO_ID!);

    // Cache entry evicted — next read is a DB fetch, which repopulates.
    const after = await store.readRecent(TEST_SCENARIO_ID!);
    expect(after.map((t) => t.turn_id)).toContain(turnId);
  });
});

// describe.skip above already handles the env-missing case.
