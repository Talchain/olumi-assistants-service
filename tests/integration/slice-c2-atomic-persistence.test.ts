/**
 * Slice C2 — integration Suite D (atomic persistence).
 *
 * R4 hard-stop: if this suite finds partial persistence possible in CI
 * staging, that's a Slice B contract violation. Halt overnight work; Paul
 * decides whether to roll back Slice B or re-scope C2.
 *
 * Proves: append_turn_atomic is atomic across turn + fact inserts. If the
 * fact insert fails (invalid payload triggering a CHECK), the turn insert
 * rolls back. If the turn insert unique-conflicts, fact inserts do not
 * proceed.
 *
 * Env-gated (real staging Supabase).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_SCENARIO_ID = process.env.TEST_SCENARIO_ID;

const envReady = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && TEST_SCENARIO_ID);
const suite = envReady ? describe : describe.skip;

suite('Slice C2 integration — Suite D (atomic persistence)', () => {
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

  it('idempotent turn insert: same (scenario_id, turn_id) twice → one row, no duplicate fact', async () => {
    const turnId = `c2-atomic-dup-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const args = {
      p_scenario_id: TEST_SCENARIO_ID!,
      p_turn_id: turnId,
      p_turn_class: 'handler',
      p_handler_id: 'run_analysis',
      p_request_hash: `sha256:${turnId}`,
      p_response_emitted: true,
      p_llm_calls_used: 1,
      p_duration_ms: 100,
      p_handler_facts: [
        {
          handler_id: 'run_analysis',
          action_type: 'run_analysis',
          noop: false,
          payload: {
            fact_type: 'run_analysis',
            fact_version: 1,
            result: {
              scenario_id: TEST_SCENARIO_ID!,
              leading_option_id: 'x',
              summary: 'Ran analysis on your current scenario.',
              enrichment: {},
            },
          },
        },
      ],
    };

    // Fire RPC twice — second should hit ON CONFLICT DO NOTHING + SELECT-
    // back-existing-id per migration body.
    const { data: d1, error: e1 } = await client.rpc('append_turn_atomic', args);
    expect(e1).toBeNull();
    const { data: d2, error: e2 } = await client.rpc('append_turn_atomic', args);
    expect(e2).toBeNull();
    expect(d1).toBe(d2);

    // Exactly one turn row
    const { data: turnRows } = await client
      .from('v5_conversation_turns')
      .select('id')
      .eq('scenario_id', TEST_SCENARIO_ID!)
      .eq('turn_id', turnId);
    expect(turnRows?.length).toBe(1);

    // Exactly one fact row (second RPC hit CONFLICT → didn't insert fact)
    const { data: factRows } = await client
      .from('v5_handler_facts')
      .select('id')
      .eq('v5_conversation_turn_id', d1 as string);
    expect(factRows?.length).toBe(1);
  });

  it('malformed fact payload (missing required fact_type) surfaces as RPC error — no partial row', async () => {
    // R4 hard-stop test: if a malformed fact payload is accepted silently,
    // or if it inserts the turn but skips the fact, that is atomicity
    // violation. Both are grounds for halt.
    const turnId = `c2-atomic-bad-${randomUUID()}`;
    writtenTurnIds.push(turnId);

    const args = {
      p_scenario_id: TEST_SCENARIO_ID!,
      p_turn_id: turnId,
      p_turn_class: 'handler',
      p_handler_id: 'run_analysis',
      p_request_hash: `sha256:${turnId}`,
      p_response_emitted: true,
      p_llm_calls_used: 1,
      p_duration_ms: 100,
      // Deliberate contract break: handler_facts entry missing action_type
      p_handler_facts: [
        {
          // no handler_id
          // no action_type
          noop: false,
          payload: { malformed: true },
        },
      ],
    };

    const { error } = await client.rpc('append_turn_atomic', args);

    if (error === null) {
      // If the RPC accepted it: verify either the turn DIDN'T land (atomic
      // rollback) OR the fact column accepted NULL and this is the expected
      // schema behaviour. R4 halt fires when the TURN is persisted but the
      // fact shape violates an implicit contract without surfacing the error.
      const { data: turnRows } = await client
        .from('v5_conversation_turns')
        .select('id')
        .eq('scenario_id', TEST_SCENARIO_ID!)
        .eq('turn_id', turnId);
      const { data: factRows } = await client
        .from('v5_handler_facts')
        .select('id, action_type, handler_id')
        .eq('scenario_id', TEST_SCENARIO_ID!)
        .order('created_at', { ascending: false })
        .limit(5);

      // The v5_handler_facts.action_type column is NOT NULL per migration —
      // a missing action_type should reject the fact insert. If the migration
      // declared it nullable instead, this assertion would surface the
      // contract drift.
      const insertedFacts = factRows?.filter(
        (r: { action_type: string; handler_id: string }) =>
          r.handler_id === null || r.action_type === null,
      );
      if (turnRows?.length === 1 && (insertedFacts?.length ?? 0) > 0) {
        // Atomicity claim intact — turn + fact both present. This means the
        // RPC silently accepted NULL handler_id/action_type, which is not
        // what the migration claims. R4: halt.
        throw new Error(
          'R4 atomicity halt: RPC accepted malformed fact shape silently. Slice B CHECK constraint may be weaker than documented.',
        );
      }
      if (turnRows?.length === 1 && (insertedFacts?.length ?? 0) === 0) {
        // Turn inserted, fact skipped. R4 halt: non-atomic.
        throw new Error(
          'R4 atomicity halt: turn persisted without fact. append_turn_atomic contract violated.',
        );
      }
      // If both are absent, the RPC rolled back on fact insert → atomicity OK
      // (even though no error surfaced to caller — suboptimal but atomic).
      expect(turnRows?.length ?? 0).toBe(0);
    } else {
      // RPC surfaced the error → transaction rolled back → no rows
      const { data: turnRows } = await client
        .from('v5_conversation_turns')
        .select('id')
        .eq('scenario_id', TEST_SCENARIO_ID!)
        .eq('turn_id', turnId);
      expect(turnRows?.length ?? 0).toBe(0);
    }
  });
});
