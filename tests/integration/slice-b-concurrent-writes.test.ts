/**
 * Slice B — D6 concurrent-writes.
 *
 * Proves: write idempotency holds under real concurrency (DoD item 3).
 * Two Promise.all() appends with identical (scenario_id, turn_id) reach
 * the RPC concurrently; ON CONFLICT (scenario_id, turn_id) DO NOTHING
 * ensures exactly one row is materialised and both callers receive the
 * same row id with no surfaced error.
 *
 * This is the actual race-condition test — not sequential writes dressed
 * up as "concurrent". The Promise.all is what fires both RPCs before
 * either returns.
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

suite('Slice B concurrent-writes — idempotency under real concurrency', () => {
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

  it('two concurrent appends with identical (scenario_id, turn_id) produce exactly one row', async () => {
    const turnId = `concurrent-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const makeStore = () => {
      const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
      return new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });
    };
    const storeA = makeStore();
    const storeB = makeStore();

    const write = {
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'direct_answer' as const,
      handler_id: null,
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 2,
      duration_ms: 100,
      handler_facts: [],
    };

    // Fire both concurrently — Promise.all triggers both RPCs before either
    // resolves. One wins the INSERT, the other hits ON CONFLICT and returns
    // the existing row's id (per append_turn_atomic body: the IF NOT FOUND
    // branch looks up the row by (scenario_id, turn_id)).
    const [ra, rb] = await Promise.all([storeA.append(write), storeB.append(write)]);

    // Both callers receive the same row id — ON CONFLICT path returned the
    // winner's id from the SELECT branch.
    expect(ra.id).toBe(rb.id);

    // Exactly one row in DB.
    const { data: rows, error } = await client
      .from('v5_conversation_turns')
      .select('id, turn_id')
      .eq('turn_id', turnId);
    expect(error).toBeNull();
    expect(rows).not.toBeNull();
    expect(rows!.length).toBe(1);
    expect(rows![0].id).toBe(ra.id);
  });

  it('sequential append of same (scenario_id, turn_id) is also idempotent (retry semantics)', async () => {
    const turnId = `retry-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const cache = new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 });
    const store = new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 });

    const write = {
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'direct_answer' as const,
      handler_id: null,
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 2,
      duration_ms: 100,
      handler_facts: [],
    };

    const first = await store.append(write);
    const second = await store.append(write);
    const third = await store.append(write);

    expect(first.id).toBe(second.id);
    expect(second.id).toBe(third.id);

    const { data: rows } = await client
      .from('v5_conversation_turns')
      .select('id')
      .eq('turn_id', turnId);
    expect(rows!.length).toBe(1);
  });
});

if (!envReady) {
  describe('Slice B concurrent-writes (skipped — env not set)', () => {
    it.skip('missing env', () => undefined);
  });
}
