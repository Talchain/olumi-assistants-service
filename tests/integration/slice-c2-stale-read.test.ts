/**
 * Slice C2 — integration Suite E (stale-read cache coherency).
 *
 * Writes a handler fact, then immediately re-reads context for the same
 * scenario through a fresh SupabaseSessionStore. The fresh store has no
 * cache entry; readRecent MUST hit the DB and return the just-persisted
 * turn. This proves the commit-boundary invalidation contract works for
 * handler facts (C2's first real fact-emitting handler).
 *
 * Env-gated (real staging Supabase).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TEST_SCENARIO_ID);
const suite = envReady ? describe : describe.skip;

function freshStore(client: SupabaseClient) {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 20 }),
    { defaultReadLimit: 20 },
  );
}

suite('Slice C2 integration — Suite E (stale-read cache coherency)', () => {
  let client: SupabaseClient;
  const writtenTurnIds: string[] = [];

  beforeAll(() => {
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

  it('write handler fact → fresh store reads it back on next readRecent (no stale path)', async () => {
    const turnId = `c2-stale-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const writeStore = freshStore(client);
    await writeStore.append({
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 100,
      handler_facts: [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: TEST_SCENARIO_ID!,
            leading_option_id: 'opt_a',
            summary: 'Ran analysis on your current scenario.',
            enrichment: { marker: 'stale-read-probe' },
          },
        },
      ],
    });

    // Completely new store + cache: no in-memory path from the write to the
    // read. If the read returns stale data, the commit-boundary invalidation
    // is broken. Since stores don't share cache, this specifically tests the
    // DB-read-after-write path — not LRU invalidation inside a single store.
    const readStore = freshStore(client);
    const turns = await readStore.readRecent(TEST_SCENARIO_ID!);
    const match = turns.find((t) => t.turn_id === turnId);

    expect(match).toBeDefined();
    expect(match!.handler_id).toBe('run_analysis');
    expect(match!.turn_class).toBe('handler');
  });

  it('same store: append then immediate readRecent returns the new turn (LRU invalidation on commit)', async () => {
    const turnId = `c2-stale-same-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const store = freshStore(client);
    // Prime the cache with a read before the write.
    await store.readRecent(TEST_SCENARIO_ID!);

    await store.append({
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'handler',
      handler_id: 'run_analysis',
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 100,
      handler_facts: [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: {
            scenario_id: TEST_SCENARIO_ID!,
            leading_option_id: 'y',
            summary: 'Ran analysis on your current scenario.',
            enrichment: {},
          },
        },
      ],
    });

    const turns = await store.readRecent(TEST_SCENARIO_ID!);
    const match = turns.find((t) => t.turn_id === turnId);
    expect(match).toBeDefined();
  });
});
