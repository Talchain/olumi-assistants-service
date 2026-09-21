/**
 * Wave 1 end-to-end integration test against staging Supabase.
 *
 * Proves the full chip → pending-action path:
 *   commitDirectAnswer(response with run_analysis chip)
 *     → derivePendingActionsFromChips
 *     → SupabaseSessionStore.append
 *     → append_turn_atomic(p_pending_actions=[…])
 *     → row in v5_conversation_turns with the pending action persisted
 *     → readMostRecentPendingActions returns it on the next call
 *
 * Gated on RUN_WAVE0_STAGING=1 + staging env (same gate as the
 * Wave 0 RPC test). Uses a fresh scenario UUID per run; cleans up.
 *
 * Manual invocation:
 *   set -a; source .env.staging.local; set +a
 *   RUN_WAVE0_STAGING=1 pnpm vitest run tests/integration/v5-pending-actions-commit.test.ts
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { OlumiResponse } from '@talchain/schemas/boundary';
import { commitDirectAnswer } from '../../src/orchestrator-v5/commit.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';

const SHOULD_RUN =
  process.env.RUN_WAVE0_STAGING === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUN_ID = `wave1-pa-commit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SCENARIO_ID = randomUUID();
const BRIEF_MARKER = `WAVE1 PA COMMIT TEST [${RUN_ID}] — DELETE ME`;
const TURN_ID_PREFIX = `${RUN_ID}-`;

let client: SupabaseClient;
let store: SupabaseSessionStore;

function makeRunAnalysisChipResponse(): OlumiResponse {
  // Minimal valid OlumiResponse shape: text + a single run_analysis chip.
  // Validators on the wire path won't run because we are calling
  // commitDirectAnswer directly with an in-memory response object.
  return {
    text: 'Your model is ready. Want me to run the analysis?',
    suggested_actions: [
      {
        id: 'chip-run-analysis-1',
        label: 'Run analysis',
        message: 'Run the analysis',
        action_type: 'run_analysis',
      },
    ],
    blocks: [],
  } as unknown as OlumiResponse;
}

describe.runIf(SHOULD_RUN)('Wave 1 end-to-end: chip → pending action persistence', () => {
  beforeAll(async () => {
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await client.rpc('ensure_scenario_exists', {
      p_scenario_id: SCENARIO_ID,
      p_user_id: null,
    });
    if (error) throw new Error(`scenario seed failed: ${error.message}`);
    const upd = await client
      .from('scenarios')
      .update({ brief_text: BRIEF_MARKER })
      .eq('id', SCENARIO_ID);
    if (upd.error) throw new Error(`scenario marker failed: ${upd.error.message}`);

    store = new SupabaseSessionStore(
      client,
      new SessionLRUCache({ maxScenarios: 4, maxTurnsPerScenario: 8 }),
      { defaultReadLimit: 10 },
    );
  });

  afterAll(async () => {
    if (!client) return;
    const { data: rows } = await client
      .from('v5_conversation_turns')
      .select('id')
      .eq('scenario_id', SCENARIO_ID);
    const turnRowIds = (rows ?? []).map((r: { id: string }) => r.id);
    if (turnRowIds.length > 0) {
      await client
        .from('v5_handler_facts')
        .delete()
        .in('v5_conversation_turn_id', turnRowIds);
    }
    await client.from('v5_conversation_turns').delete().eq('scenario_id', SCENARIO_ID);
    await client.from('scenarios').delete().eq('id', SCENARIO_ID);
    // Orphan sweep
    const { count: byId } = await client
      .from('scenarios')
      .select('*', { count: 'exact', head: true })
      .eq('id', SCENARIO_ID);
    const { count: byMarker } = await client
      .from('scenarios')
      .select('*', { count: 'exact', head: true })
      .like('brief_text', `WAVE1 PA COMMIT TEST [${RUN_ID}]%`);
    const { count: byTurnPrefix } = await client
      .from('v5_conversation_turns')
      .select('*', { count: 'exact', head: true })
      .like('turn_id', `${TURN_ID_PREFIX}%`);
    if ((byId ?? 0) + (byMarker ?? 0) + (byTurnPrefix ?? 0) > 0) {
      console.warn(
        `[wave1 cleanup] orphans remain — SCENARIO_ID=${SCENARIO_ID} ` +
          `byId=${byId} byMarker=${byMarker} byTurnPrefix=${byTurnPrefix}`,
      );
    }
  });

  it('chip with action_type=run_analysis produces a persisted pending action via commitDirectAnswer', async () => {
    const turnId = `${TURN_ID_PREFIX}t1`;
    const result = await commitDirectAnswer(
      makeRunAnalysisChipResponse(),
      {
        scenario_id: SCENARIO_ID,
        turn_id: turnId,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:wave1-1',
        llm_calls_used: 0,
        duration_ms: 0,
        handler_facts: [],
      },
      store,
    );
    expect(result.performed).toBe(true);
    expect(typeof result.persisted_row_id).toBe('string');

    // Read back the row and assert pending_actions is populated.
    const { data, error } = await client
      .from('v5_conversation_turns')
      .select('id, pending_actions')
      .eq('scenario_id', SCENARIO_ID)
      .eq('turn_id', turnId)
      .single();
    expect(error).toBeNull();
    const pa = data?.pending_actions as unknown[];
    expect(Array.isArray(pa)).toBe(true);
    expect(pa).toHaveLength(1);
    const entry = pa[0] as Record<string, unknown>;
    expect(entry.scenario_id).toBe(SCENARIO_ID);
    expect(entry.chip_id).toBe('chip-run-analysis-1');
    expect((entry.action as { kind: string }).kind).toBe('run_analysis');
  });

  it('readMostRecentPendingActions returns the persisted action on the next call', async () => {
    const result = await store.readMostRecentPendingActions(SCENARIO_ID);
    expect(result).toHaveLength(1);
    expect(result[0]?.action.kind).toBe('run_analysis');
    expect(result[0]?.chip_id).toBe('chip-run-analysis-1');
    expect(result[0]?.scenario_id).toBe(SCENARIO_ID);
  });

  it('chips without a resumable action_type produce no pending actions', async () => {
    const turnId = `${TURN_ID_PREFIX}t2`;
    const promptOnlyResponse = {
      text: 'How would you frame this decision?',
      suggested_actions: [
        {
          id: 'chip-prompt-1',
          label: 'Tell me more',
          message: 'Tell me more about how to frame it',
          // No action_type — text-prompt chip.
        },
      ],
      blocks: [],
    } as unknown as OlumiResponse;

    await commitDirectAnswer(
      promptOnlyResponse,
      {
        scenario_id: SCENARIO_ID,
        turn_id: turnId,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:wave1-2',
        llm_calls_used: 1,
        duration_ms: 50,
        handler_facts: [],
      },
      store,
    );

    const { data } = await client
      .from('v5_conversation_turns')
      .select('pending_actions')
      .eq('scenario_id', SCENARIO_ID)
      .eq('turn_id', turnId)
      .single();
    expect(data?.pending_actions).toEqual([]);
  });

  it('readMostRecentPendingActions on a turn that emitted no pending actions returns []', async () => {
    // Turn t2 was the most recent and had zero pending actions.
    const result = await store.readMostRecentPendingActions(SCENARIO_ID);
    expect(result).toEqual([]);
  });

  it('caller-supplied pending_actions short-circuit chip derivation', async () => {
    // Wave 3 add-risk uses this path: the handler builds a server-side-only
    // edit_graph_add_risk pending action that has no chip counterpart.
    const turnId = `${TURN_ID_PREFIX}t3`;
    const presupplied = [
      {
        id: 'pa-suppliededitrisk-001',
        scenario_id: SCENARIO_ID,
        chip_id: 'chip-clarify-driver-1',
        action: { kind: 'edit_graph_add_risk' as const, label: 'Cultural cohesion risk' },
        preconditions: { graph_hash: 'sha256:test' },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T00:00:00.000Z',
        emitted_at_iso: '2026-05-05T00:00:00.000Z',
      },
    ];
    await commitDirectAnswer(
      makeRunAnalysisChipResponse(),
      {
        scenario_id: SCENARIO_ID,
        turn_id: turnId,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:wave1-3',
        llm_calls_used: 0,
        duration_ms: 0,
        handler_facts: [],
        pending_actions: presupplied,
      },
      store,
    );
    const { data } = await client
      .from('v5_conversation_turns')
      .select('pending_actions')
      .eq('scenario_id', SCENARIO_ID)
      .eq('turn_id', turnId)
      .single();
    const pa = data?.pending_actions as unknown[];
    expect(pa).toHaveLength(1);
    expect((pa[0] as Record<string, unknown>).action).toEqual({
      kind: 'edit_graph_add_risk',
      label: 'Cultural cohesion risk',
    });
    // The run_analysis chip in the response did NOT produce a pending
    // action because the caller pre-supplied a list.
  });
});

if (!SHOULD_RUN) {
  // TODO: ISSUE-9004 — Wave 1 pending_actions end-to-end parked
  describe.skip('Wave 1 end-to-end (skipped)', () => {
    it('SHOULD_RUN gate is off — set RUN_WAVE0_STAGING=1 + staging env to run', () => {
      // intentional skip
    });
  });
}
