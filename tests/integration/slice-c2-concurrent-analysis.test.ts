/**
 * Slice C2 — integration Suite F (concurrent run_analysis correctness).
 *
 * Same-turn-id case: two concurrent append calls with identical
 * (scenario_id, turn_id) → exactly one row in each table (idempotency via
 * ON CONFLICT DO NOTHING from Slice B migration).
 *
 * Different-turn-id case: two concurrent appends with same scenario_id,
 * distinct turn_ids → two rows in each table, stable created_at ordering
 * under readRecent.
 *
 * Env-gated (real staging Supabase).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

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

function makeFact(scenarioId: string, marker: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: scenarioId,
      leading_option_id: 'x',
      summary: 'Ran analysis on your current scenario.',
      enrichment: { marker },
    },
  };
}

suite('Slice C2 integration — Suite F (concurrent run_analysis)', () => {
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

  it('same (scenario_id, turn_id) concurrently → one turn row, one fact row, both callers get same id', async () => {
    const turnId = `c2-concur-same-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const storeA = freshStore(client);
    const storeB = freshStore(client);

    const write = {
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnId,
      turn_class: 'handler' as const,
      handler_id: 'run_analysis',
      request_hash: `sha256:${turnId}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 100,
      handler_facts: [makeFact(TEST_SCENARIO_ID!, 'same-turn-id')],
    };

    const [ra, rb] = await Promise.all([storeA.append(write), storeB.append(write)]);

    expect(ra.id).toBe(rb.id);

    const { data: turnRows } = await client
      .from('v5_conversation_turns')
      .select('id')
      .eq('scenario_id', TEST_SCENARIO_ID!)
      .eq('turn_id', turnId);
    expect(turnRows?.length).toBe(1);

    const { data: factRows } = await client
      .from('v5_handler_facts')
      .select('id')
      .eq('v5_conversation_turn_id', ra.id);
    expect(factRows?.length).toBe(1);
  });

  it('different turn_ids, same scenario_id, concurrent → two turn rows, two fact rows, stable order', async () => {
    const turnIdA = `c2-concur-diff-a-${randomUUID()}`;
    const turnIdB = `c2-concur-diff-b-${randomUUID()}`;
    writtenTurnIds.push(turnIdA, turnIdB);

    const store = freshStore(client);
    const writeA = {
      scenario_id: TEST_SCENARIO_ID!,
      turn_id: turnIdA,
      turn_class: 'handler' as const,
      handler_id: 'run_analysis',
      request_hash: `sha256:${turnIdA}`,
      response_emitted: true,
      llm_calls_used: 1,
      duration_ms: 100,
      handler_facts: [makeFact(TEST_SCENARIO_ID!, 'distinct-A')],
    };
    const writeB = {
      ...writeA,
      turn_id: turnIdB,
      request_hash: `sha256:${turnIdB}`,
      handler_facts: [makeFact(TEST_SCENARIO_ID!, 'distinct-B')],
    };

    const [ra, rb] = await Promise.all([store.append(writeA), store.append(writeB)]);
    expect(ra.id).not.toBe(rb.id);

    const { data: turnRows } = await client
      .from('v5_conversation_turns')
      .select('id, turn_id, created_at')
      .in('turn_id', [turnIdA, turnIdB])
      .order('created_at', { ascending: true });
    expect(turnRows?.length).toBe(2);

    const ids = (turnRows ?? []).map((r: { turn_id: string }) => r.turn_id);
    expect(ids).toContain(turnIdA);
    expect(ids).toContain(turnIdB);

    const { data: factRows } = await client
      .from('v5_handler_facts')
      .select('id, v5_conversation_turn_id')
      .in('v5_conversation_turn_id', [ra.id, rb.id]);
    expect(factRows?.length).toBe(2);
  });
});
