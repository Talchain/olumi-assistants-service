/**
 * Wave 2 staging integration test — short-confirm resume seam.
 *
 * Proves the cross-turn handshake against real Supabase:
 *   Turn N: commitDirectAnswer with a run_analysis chip
 *           → derivePendingActionsFromChips → append_turn_atomic persists
 *           → row in v5_conversation_turns with the pending action
 *   Turn N+1 (read-only seam):
 *           → readMostRecentPendingActions returns the persisted entry
 *           → tryShortConfirmResume on "yes" matches the run_analysis kind
 *           → ready for TurnExecutor to synthesise a RoutingToolCallResult
 *
 * The full TurnExecutor zero-LLM dispatch is exercised by the unit tests
 * in deterministic-short-confirm.test.ts and the in-process mock-adapter
 * tests under src/orchestrator-v5/__tests__. This file only verifies the
 * persistence/read seam against the live DB.
 *
 * Gated on RUN_WAVE0_STAGING=1 + staging env. Cleans up on success or
 * failure; orphan sweep at teardown.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { OlumiResponse } from '@talchain/schemas/boundary';
import { commitDirectAnswer } from '../../src/orchestrator-v5/commit.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { tryShortConfirmResume } from '../../src/orchestrator-v5/routing/deterministic-short-confirm.js';

const SHOULD_RUN =
  process.env.RUN_WAVE0_STAGING === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const RUN_ID = `wave2-short-confirm-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SCENARIO_ID = randomUUID();
const BRIEF_MARKER = `WAVE2 SHORT CONFIRM TEST [${RUN_ID}] — DELETE ME`;
const TURN_ID_PREFIX = `${RUN_ID}-`;

let client: SupabaseClient;
let store: SupabaseSessionStore;

describe.runIf(SHOULD_RUN)('Wave 2 staging: short-confirm resume seam', () => {
  beforeAll(async () => {
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const ensureRes = await client.rpc('ensure_scenario_exists', {
      p_scenario_id: SCENARIO_ID,
      p_user_id: null,
    });
    if (ensureRes.error) throw new Error(`scenario seed failed: ${ensureRes.error.message}`);
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
      await client.from('v5_handler_facts').delete().in('v5_conversation_turn_id', turnRowIds);
    }
    await client.from('v5_conversation_turns').delete().eq('scenario_id', SCENARIO_ID);
    await client.from('scenarios').delete().eq('id', SCENARIO_ID);
    const { count: byMarker } = await client
      .from('scenarios')
      .select('*', { count: 'exact', head: true })
      .like('brief_text', `WAVE2 SHORT CONFIRM TEST [${RUN_ID}]%`);
    const { count: byTurnPrefix } = await client
      .from('v5_conversation_turns')
      .select('*', { count: 'exact', head: true })
      .like('turn_id', `${TURN_ID_PREFIX}%`);
    if ((byMarker ?? 0) + (byTurnPrefix ?? 0) > 0) {
      console.warn(
        `[wave2 cleanup] orphans remain — SCENARIO_ID=${SCENARIO_ID} ` +
          `byMarker=${byMarker} byTurnPrefix=${byTurnPrefix}`,
      );
    }
  });

  it('cross-turn: commit emits a run_analysis pending action; next-turn read returns it; "yes" matches', async () => {
    // Turn N: persist via Wave 1 path.
    const responseWithChip = {
      text: 'Your model looks ready. Want me to run the analysis?',
      suggested_actions: [
        {
          id: 'chip-run-analysis-W2',
          label: 'Run analysis',
          message: 'Run the analysis',
          action_type: 'run_analysis',
        },
      ],
      blocks: [],
    } as unknown as OlumiResponse;
    await commitDirectAnswer(
      responseWithChip,
      {
        scenario_id: SCENARIO_ID,
        turn_id: `${TURN_ID_PREFIX}n`,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:wave2-n',
        llm_calls_used: 0,
        duration_ms: 0,
        handler_facts: [],
      },
      store,
    );

    // Turn N+1 (seam): read back what TurnExecutor's build-turn-context
    // would see, then run the resumer's pure detector against a "yes".
    const pendingActions = await store.readMostRecentPendingActions(SCENARIO_ID);
    expect(pendingActions).toHaveLength(1);
    expect(pendingActions[0]?.action.kind).toBe('run_analysis');
    expect(pendingActions[0]?.chip_id).toBe('chip-run-analysis-W2');

    const dispatch = tryShortConfirmResume({
      message: 'yes',
      pendingActions,
      currentTurnIndex: 1,
      nowMs: Date.now(),
    });
    expect(dispatch.matched).toBe(true);
    if (dispatch.matched) {
      expect(dispatch.dispatch).toBe('pending_action');
      expect(dispatch.pending.action.kind).toBe('run_analysis');
      expect(dispatch.pending.id).toBe(pendingActions[0]?.id);
    }
  });

  it('non-confirmation message does not match', async () => {
    const pendingActions = await store.readMostRecentPendingActions(SCENARIO_ID);
    const dispatch = tryShortConfirmResume({
      message: 'why is this close?',
      pendingActions,
      currentTurnIndex: 1,
      nowMs: Date.now(),
    });
    expect(dispatch).toEqual({ matched: false, skip_reason: 'no_short_confirm' });
  });

  it('after a turn with no resumable chips, next-turn read returns []', async () => {
    // Turn N+2: commit a turn whose chips are prompt-only.
    await commitDirectAnswer(
      {
        text: 'How would you frame this decision?',
        suggested_actions: [
          { id: 'chip-prompt-W2', label: 'Tell me more', message: 'Tell me more' },
        ],
        blocks: [],
      } as unknown as OlumiResponse,
      {
        scenario_id: SCENARIO_ID,
        turn_id: `${TURN_ID_PREFIX}n2`,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:wave2-n2',
        llm_calls_used: 1,
        duration_ms: 30,
        handler_facts: [],
      },
      store,
    );

    const pendingActions = await store.readMostRecentPendingActions(SCENARIO_ID);
    expect(pendingActions).toEqual([]);

    const dispatch = tryShortConfirmResume({
      message: 'yes',
      pendingActions,
      currentTurnIndex: 2,
      nowMs: Date.now(),
    });
    expect(dispatch).toEqual({ matched: false, skip_reason: 'no_pending' });
  });
});

if (!SHOULD_RUN) {
  // TODO: ISSUE-9000 — CI hygiene baseline: inherited skip retained pending triage
  describe.skip('Wave 2 staging short-confirm seam (skipped)', () => {
    it('SHOULD_RUN gate is off — set RUN_WAVE0_STAGING=1 + staging env', () => {
      // intentional skip
    });
  });
}
