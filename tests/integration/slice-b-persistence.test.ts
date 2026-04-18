/**
 * Slice B — D6 persistence.
 *
 * End-to-end: write a turn, simulate a cache flush, read it back. Proves
 * session state survives restart (Definition of Done §1 item 1).
 *
 * Runs only when staging Supabase env is set. Cleans up every row it
 * writes so repeated runs don't accumulate garbage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  SessionLRUCache,
} from '../../src/orchestrator-v5/session/cache.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TEST_SCENARIO_ID);
const suite = envReady ? describe : describe.skip;

function freshStore(client: SupabaseClient) {
  const cache = new SessionLRUCache({ maxScenarios: 10, maxTurnsPerScenario: 20 });
  return { store: new SupabaseSessionStore(client, cache, { defaultReadLimit: 20 }), cache };
}

suite('Slice B persistence — two-turn flow survives cache flush', () => {
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

  it('writes turn 1 via RPC; fresh store reads turn 1 back from Supabase', async () => {
    const runId = `persist-${randomUUID()}`;
    const turn1Id = `${runId}-turn-1`;
    writtenTurnIds.push(turn1Id);

    // Turn 1: write via store A (cache A)
    const a = freshStore(client);
    await a.store.append({
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turn1Id,
      turn_class: 'direct_answer',
      handler_id: null,
      request_hash: `sha256:${turn1Id}`,
      response_emitted: true,
      llm_calls_used: 2,
      duration_ms: 100,
      handler_facts: [],
    });

    // Turn 2 simulates a restart: fresh store with a brand-new cache.
    const b = freshStore(client);
    const turns = await b.store.readRecent(TEST_SCENARIO_ID!);
    const ids = turns.map((t) => t.turn_id);
    expect(ids).toContain(turn1Id);
  });

  it('multi-turn write order preserved in DESC-by-created_at readRecent', async () => {
    const runId = `persist-order-${randomUUID()}`;
    const ids = ['a', 'b', 'c'].map((s) => `${runId}-${s}`);
    writtenTurnIds.push(...ids);

    const { store } = freshStore(client);
    for (const id of ids) {
      await store.append({
        scenario_id: TEST_SCENARIO_ID!,
        turn_id: id,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: `sha256:${id}`,
        response_emitted: true,
        llm_calls_used: 2,
        duration_ms: 100,
        handler_facts: [],
      });
      // Small delay so created_at ordering is stable on same-ms inserts.
      await new Promise((r) => setTimeout(r, 10));
    }

    const { store: fresh } = freshStore(client);
    const turns = await fresh.readRecent(TEST_SCENARIO_ID!);
    const writtenIds = turns.map((t) => t.turn_id).filter((id) => id.startsWith(runId));
    // DESC by created_at → c, b, a
    expect(writtenIds).toEqual([ids[2], ids[1], ids[0]]);
  });
});

if (!envReady) {
  describe('Slice B persistence (skipped — env not set)', () => {
    it.skip('missing env', () => undefined);
  });
}
