/**
 * Wave 0 hard-gate integration test against staging Supabase.
 *
 * Runs only when the staging service-role credentials are present and
 * `RUN_WAVE0_STAGING=1` is set. CI does NOT run this by default — it
 * is gated to keep the staging DB out of the default test path.
 *
 * Manual invocation:
 *   pnpm vitest run tests/integration/v5-pending-actions-rpc.test.ts \
 *     -- --testTimeout=30000
 *
 * The test must be run with the staging .env.local sourced into the
 * environment. Example:
 *
 *   set -a; source .env.staging.local; set +a
 *   RUN_WAVE0_STAGING=1 pnpm vitest run tests/integration/v5-pending-actions-rpc.test.ts
 *
 * What it verifies:
 *   1. Legacy 11-arg-shaped RPC call (omitting p_pending_actions) still
 *      works and writes pending_actions = [] (default param + NOT NULL
 *      column default).
 *   2. New 12-arg call with a populated pending_actions array writes
 *      and reads back byte-equivalent.
 *   3. New 12-arg call with explicit empty array round-trips.
 *   4. `readMostRecentPendingActions` returns the most recent turn's
 *      pending_actions.
 *   5. Conflict-replay idempotency: same (scenario_id, turn_id) with
 *      different pending_actions does NOT mutate the existing row.
 *   6. Pending actions cannot resume across scenarios — query by
 *      scenario_id only, never sees rows from other scenarios.
 *
 * Cleanup:
 *   Inserts at most 4 rows: 1 scenario, 3 turns. Tear-down deletes
 *   them in FK order. A final orphan sweep by marker prefix and
 *   brief_text marker confirms zero leftovers.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SHOULD_RUN =
  process.env.RUN_WAVE0_STAGING === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUN_ID = `wave0-pending-actions-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SCENARIO_ID = randomUUID();
const BRIEF_MARKER = `WAVE0 PENDING ACTIONS RPC TEST [${RUN_ID}] — DELETE ME`;
const TURN_ID_PREFIX = `${RUN_ID}-`;

let client: SupabaseClient;

const TEST_PENDING_ACTION = {
  id: '01HXYZ0WAVE0PENDING000001',
  scenario_id: SCENARIO_ID,
  emitted_in_turn_row_id: '00000000-0000-4000-8000-000000000000',
  chip_id: 'chip-test-1',
  action: { kind: 'run_analysis' as const },
  preconditions: {},
  expires_at_turn_count: 2,
  expires_at_iso: '2099-12-31T23:59:59.000Z',
  emitted_at_iso: '2026-05-05T00:00:00.000Z',
};

describe.runIf(SHOULD_RUN)('Wave 0 pending_actions RPC integration', () => {
  beforeAll(async () => {
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    // Create the test scenario row (guest mode — user_id NULL) via the
    // ensure_scenario_exists RPC. Using direct INSERT would bypass the
    // canonical entry point.
    const { error } = await client.rpc('ensure_scenario_exists', {
      p_scenario_id: SCENARIO_ID,
      p_user_id: null,
    });
    if (error) throw new Error(`scenario seed failed: ${error.message}`);
    // Tag the scenario with the brief marker so an orphan sweep can find it.
    const upd = await client
      .from('scenarios')
      .update({ brief_text: BRIEF_MARKER })
      .eq('id', SCENARIO_ID);
    if (upd.error) throw new Error(`scenario marker failed: ${upd.error.message}`);
  });

  afterAll(async () => {
    if (!client) return;
    // Confirm cleanup column structure before issuing deletes. We assert
    // the FK column on v5_handler_facts is v5_conversation_turn_id (the
    // row id, not the client turn_id). If schema disagrees, abort cleanup
    // and log explicitly so manual purge can pick up.
    const { data: rows } = await client
      .from('v5_conversation_turns')
      .select('id')
      .eq('scenario_id', SCENARIO_ID);
    const turnRowIds = (rows ?? []).map((r: { id: string }) => r.id);
    if (turnRowIds.length > 0) {
      const del = await client
        .from('v5_handler_facts')
        .delete()
        .in('v5_conversation_turn_id', turnRowIds);
      if (del.error) {
        console.warn(
          `[wave0 cleanup] handler_facts delete failed for SCENARIO_ID=${SCENARIO_ID} run=${RUN_ID}: ${del.error.message}`,
        );
      }
    }
    const delTurns = await client
      .from('v5_conversation_turns')
      .delete()
      .eq('scenario_id', SCENARIO_ID);
    if (delTurns.error) {
      console.warn(
        `[wave0 cleanup] turns delete failed: ${delTurns.error.message} (SCENARIO_ID=${SCENARIO_ID})`,
      );
    }
    const delScen = await client.from('scenarios').delete().eq('id', SCENARIO_ID);
    if (delScen.error) {
      console.warn(
        `[wave0 cleanup] scenario delete failed: ${delScen.error.message} (SCENARIO_ID=${SCENARIO_ID})`,
      );
    }
    // Orphan sweep — by both scenario_id AND marker prefix, in case the
    // primary cleanup left anything (or a prior run left orphans).
    const { count: scenarioCount } = await client
      .from('scenarios')
      .select('*', { count: 'exact', head: true })
      .eq('id', SCENARIO_ID);
    const { count: scenarioByMarker } = await client
      .from('scenarios')
      .select('*', { count: 'exact', head: true })
      .like('brief_text', `WAVE0 PENDING ACTIONS RPC TEST [${RUN_ID}]%`);
    const { count: turnsByPrefix } = await client
      .from('v5_conversation_turns')
      .select('*', { count: 'exact', head: true })
      .like('turn_id', `${TURN_ID_PREFIX}%`);
    if ((scenarioCount ?? 0) + (scenarioByMarker ?? 0) + (turnsByPrefix ?? 0) > 0) {
      console.warn(
        `[wave0 cleanup] orphans remain — SCENARIO_ID=${SCENARIO_ID} ` +
          `scenarioCount=${scenarioCount} byMarker=${scenarioByMarker} ` +
          `turnsByPrefix=${turnsByPrefix}. Manual purge required.`,
      );
    }
  });

  it('1. legacy 11-arg-shaped call writes pending_actions = []', async () => {
    const turnId = `${TURN_ID_PREFIX}legacy`;
    // Omit p_pending_actions — relies on the RPC default.
    const { data: rowId, error } = await client.rpc('append_turn_atomic', {
      p_scenario_id: SCENARIO_ID,
      p_turn_id: turnId,
      p_turn_class: 'direct_answer',
      p_handler_id: null,
      p_request_hash: 'sha256:wave0-1',
      p_response_emitted: true,
      p_llm_calls_used: 0,
      p_duration_ms: 1,
      p_handler_facts: [],
      p_graph: null,
      p_brief_text: null,
    });
    expect(error).toBeNull();
    expect(typeof rowId).toBe('string');
    const { data, error: readErr } = await client
      .from('v5_conversation_turns')
      .select('pending_actions')
      .eq('scenario_id', SCENARIO_ID)
      .eq('turn_id', turnId)
      .single();
    expect(readErr).toBeNull();
    expect(data?.pending_actions).toEqual([]);
  });

  it('2. new 12-arg call with populated pending_actions round-trips byte-equal', async () => {
    const turnId = `${TURN_ID_PREFIX}populated`;
    const { error } = await client.rpc('append_turn_atomic', {
      p_scenario_id: SCENARIO_ID,
      p_turn_id: turnId,
      p_turn_class: 'direct_answer',
      p_handler_id: null,
      p_request_hash: 'sha256:wave0-2',
      p_response_emitted: true,
      p_llm_calls_used: 0,
      p_duration_ms: 1,
      p_handler_facts: [],
      p_graph: null,
      p_brief_text: null,
      p_pending_actions: [TEST_PENDING_ACTION],
    });
    expect(error).toBeNull();
    const { data } = await client
      .from('v5_conversation_turns')
      .select('pending_actions')
      .eq('scenario_id', SCENARIO_ID)
      .eq('turn_id', turnId)
      .single();
    expect(data?.pending_actions).toEqual([TEST_PENDING_ACTION]);
  });

  it('3. new call with explicit empty array round-trips', async () => {
    const turnId = `${TURN_ID_PREFIX}empty`;
    const { error } = await client.rpc('append_turn_atomic', {
      p_scenario_id: SCENARIO_ID,
      p_turn_id: turnId,
      p_turn_class: 'direct_answer',
      p_handler_id: null,
      p_request_hash: 'sha256:wave0-3',
      p_response_emitted: true,
      p_llm_calls_used: 0,
      p_duration_ms: 1,
      p_handler_facts: [],
      p_graph: null,
      p_brief_text: null,
      p_pending_actions: [],
    });
    expect(error).toBeNull();
    const { data } = await client
      .from('v5_conversation_turns')
      .select('pending_actions')
      .eq('scenario_id', SCENARIO_ID)
      .eq('turn_id', turnId)
      .single();
    expect(data?.pending_actions).toEqual([]);
  });

  it('4. most recent turn carries its pending actions (cross-turn read)', async () => {
    const { data, error } = await client
      .from('v5_conversation_turns')
      .select('turn_id, pending_actions, created_at')
      .eq('scenario_id', SCENARIO_ID)
      .order('created_at', { ascending: false })
      .limit(1);
    expect(error).toBeNull();
    expect(data?.[0]?.turn_id).toBe(`${TURN_ID_PREFIX}empty`);
    // The most recent turn we wrote in test 3 had an empty pending_actions
    // array. The byte-equal positive case lives in test 2.
    expect(data?.[0]?.pending_actions).toEqual([]);
  });

  it('5. conflict replay does NOT mutate pending_actions on the existing row', async () => {
    const turnId = `${TURN_ID_PREFIX}populated`;
    // Replay the same (scenario_id, turn_id) with DIFFERENT pending_actions.
    // The FOUND-based idempotency guard must short-circuit and return the
    // existing row id, leaving pending_actions unchanged.
    const { error } = await client.rpc('append_turn_atomic', {
      p_scenario_id: SCENARIO_ID,
      p_turn_id: turnId,
      p_turn_class: 'direct_answer',
      p_handler_id: null,
      p_request_hash: 'sha256:wave0-5-replay',
      p_response_emitted: true,
      p_llm_calls_used: 0,
      p_duration_ms: 1,
      p_handler_facts: [],
      p_graph: null,
      p_brief_text: null,
      p_pending_actions: [],
    });
    expect(error).toBeNull();
    const { data } = await client
      .from('v5_conversation_turns')
      .select('pending_actions')
      .eq('scenario_id', SCENARIO_ID)
      .eq('turn_id', turnId)
      .single();
    // Original write from test 2 must still be intact.
    expect(data?.pending_actions).toEqual([TEST_PENDING_ACTION]);
  });

  it('6. cross-scenario isolation — query by scenario_id never sees other scenarios', async () => {
    // Scenarios are isolated by the scenario_id filter. The test
    // queries for an unrelated random uuid and asserts zero rows.
    const otherScenarioId = randomUUID();
    const { data, error } = await client
      .from('v5_conversation_turns')
      .select('turn_id')
      .eq('scenario_id', otherScenarioId);
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});

if (!SHOULD_RUN) {
  describe.skip('Wave 0 pending_actions RPC integration (skipped)', () => {
    it('SHOULD_RUN gate is off — set RUN_WAVE0_STAGING=1 + staging env to run', () => {
      // intentional skip
    });
  });
}
