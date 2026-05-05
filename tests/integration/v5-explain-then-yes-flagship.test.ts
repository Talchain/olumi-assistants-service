/**
 * Wave 5 flagship two-turn transcript test against staging Supabase.
 *
 * Pins the brief's evidence #1 end to end at the persistence seam:
 *
 *   Turn N:   commitDirectAnswer with a successful explain_results
 *             response carrying the chip set chip-generator emits
 *             after such a turn → the row in v5_conversation_turns
 *             carries a what_would_flip pending action.
 *
 *   Turn N+1: readMostRecentPendingActions returns the persisted
 *             entry → tryShortConfirmResume matches "yes" against
 *             the what_would_flip pending action → dispatch is
 *             routed at synthesis time (the actual TurnExecutor
 *             resume path is exercised in unit + route-level tests
 *             — this test pins the seam against the live DB).
 *
 * Why a separate flagship test: prior unit tests asserted chip
 * generation in isolation OR pending-action persistence in isolation.
 * Neither caught the production-shape gap where the chip-emit
 * predicate matched a synthetic fact but no production fact —
 * because the seam between handler-fact shape, chip emission, and
 * pending-action derivation was not exercised end to end.
 *
 * Gated on RUN_WAVE0_STAGING=1 + staging env. Cleans up.
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

const RUN_ID = `wave5-flagship-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const SCENARIO_ID = randomUUID();
const BRIEF_MARKER = `WAVE5 FLAGSHIP TEST [${RUN_ID}] — DELETE ME`;
const TURN_ID_PREFIX = `${RUN_ID}-`;

let client: SupabaseClient;
let store: SupabaseSessionStore;

describe.runIf(SHOULD_RUN)('Wave 5 flagship: explain_results → yes resume seam', () => {
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
  });

  it('explain_results response with the post-explain chip emits a what_would_flip pending action; "yes" on the next turn matches it', async () => {
    // Turn N: simulate the post-explain composition by directly
    // constructing the response chip-generator would emit after a
    // successful explain_results turn (label + action_type as pinned
    // in explain-results-flip-chip.test.ts).
    const explainResponse = {
      text: 'The leading option performs best by 14 points. Would you like to explore what would change this result?',
      suggested_actions: [
        {
          id: 'chip_action_what_would_flip',
          label: 'Explore what would change this',
          message: 'Explore what would change the result.',
          action_type: 'what_would_flip',
        },
      ],
      blocks: [],
    } as unknown as OlumiResponse;
    await commitDirectAnswer(
      explainResponse,
      {
        scenario_id: SCENARIO_ID,
        turn_id: `${TURN_ID_PREFIX}n`,
        turn_class: 'direct_answer',
        handler_id: null,
        request_hash: 'sha256:wave5-flagship-n',
        llm_calls_used: 0,
        duration_ms: 0,
        handler_facts: [],
      },
      store,
    );

    // Verify a what_would_flip pending action landed.
    const pendingActions = await store.readMostRecentPendingActions(SCENARIO_ID);
    expect(pendingActions).toHaveLength(1);
    expect(pendingActions[0]?.action.kind).toBe('what_would_flip');
    expect(pendingActions[0]?.chip_id).toBe('chip_action_what_would_flip');

    // Turn N+1: the resumer matches "yes" against the persisted
    // pending action. With fresh analysis the dispatch is
    // pending_action; with stale analysis it would downgrade to
    // rerun_analysis_required. This test pins the fresh path —
    // freshness gating is exercised separately in
    // deterministic-short-confirm.test.ts.
    const dispatch = tryShortConfirmResume({
      message: 'yes',
      pendingActions,
      currentTurnIndex: 1,
      nowMs: Date.now(),
      analysisFreshness: 'fresh',
    });
    expect(dispatch.matched).toBe(true);
    if (dispatch.matched && dispatch.dispatch === 'pending_action') {
      expect(dispatch.pending.action.kind).toBe('what_would_flip');
      expect(dispatch.pending.id).toBe(pendingActions[0]?.id);
    } else {
      throw new Error(
        `expected pending_action dispatch with what_would_flip kind, got ${JSON.stringify(dispatch)}`,
      );
    }
  });
});

if (!SHOULD_RUN) {
  describe.skip('Wave 5 flagship (skipped)', () => {
    it('SHOULD_RUN gate is off — set RUN_WAVE0_STAGING=1 + staging env', () => {
      // intentional skip
    });
  });
}
