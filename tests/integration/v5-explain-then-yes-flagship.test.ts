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

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { commitDirectAnswer } from '../../src/orchestrator-v5/commit.js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { tryShortConfirmResume } from '../../src/orchestrator-v5/routing/deterministic-short-confirm.js';
import { createExplainResultsHandler } from '../../src/orchestrator-v5/tools/handlers/explain-results.js';
import type { HandlerInvocation } from '../../src/orchestrator-v5/tools/registry.js';
import { generateChips } from '../../src/orchestrator-v5/compose/chip-generator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../src/orchestrator-v5/routing/validation-registry.js';
import type { AnalysisProjectionSummary } from '../../src/orchestrator-v5/context/projection-summaries.js';

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

  it('production compose path: explain_results handler → generateChips → commit emits a what_would_flip pending action; "yes" matches it on the next turn', async () => {
    // This test runs the actual production compose sequence end to
    // end against the live DB:
    //   (1) createExplainResultsHandler invocation with a successful
    //       analysis projection (precondition_unmet=false fact)
    //   (2) generateChips against the handler-emitted facts → action
    //       chip with action_type=what_would_flip
    //   (3) build OlumiResponse with the handler's assistant_text +
    //       generated chips
    //   (4) commitDirectAnswer persists the pending action via Wave 1's
    //       derive-pending-actions
    //
    // Earlier flagship attempts hand-built the chip; that fixture
    // could not catch a desync between handler fact shape (e.g.
    // Wave 5a's noop=true / precondition_unmet discriminator), the
    // chip-generator predicate, and the persistence layer.
    const ANALYSIS_PROJECTION: AnalysisProjectionSummary = {
      status: 'complete',
      leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
      runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
      margin_pp: 35,
      robustness_band: 'stable',
      top_drivers: [
        { factor_label: 'Engineering Capacity', sensitivity_value: 0.65 },
        { factor_label: 'Hiring Cost', sensitivity_value: -0.42 },
      ],
      staleness_reason: null,
    };
    // Prior fact: a successful run_analysis. The explain_results
    // handler bails on precondition_unmet when no successful
    // run_analysis fact exists in priorFacts.
    const priorRunAnalysisFact: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Stub.',
        win_probabilities: { opt_a: 0.62, opt_b: 0.27 },
      },
    } as HandlerFact;
    const invocation: HandlerInvocation = {
      context: {
        stage: 'analyse',
        entity_registry: { option_ids: [], goal_id: 'goal_g' },
        capabilities: {},
        messages: [{ role: 'user', content: 'why is this close?' }],
        session_id: SCENARIO_ID,
        request_id: 'req-flagship-explain',
        budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
        prior_turns: [],
        prior_facts: [priorRunAnalysisFact],
        scenarioBriefText: null,
        persistedGraph: null,
      } as unknown as HandlerInvocation['context'],
      payload: {
        turn_id: 't-flagship',
        scenario_id: SCENARIO_ID,
        message: 'why is this close?',
        turn_class: 'analyse',
        stage: 'analyse',
      } as unknown as HandlerInvocation['payload'],
      requestId: 'req-flagship-explain',
      signal: new AbortController().signal,
      orientationText: '',
      analysisReady: {
        status: 'ready',
        options: [
          { option_id: 'opt_a', label: 'Hire Senior Engineer', status: 'ready', interventions: { f: 1 } },
          { option_id: 'opt_b', label: 'Hire Two Mid-Level', status: 'ready', interventions: { f: 0 } },
        ],
        goal_node_id: 'goal_g',
        status_summary: { ready: 2, partial: 0, missing: 0 },
      } as never,
      explanation: undefined, // handler renders deterministic fallback
      analysisProjection: ANALYSIS_PROJECTION,
      analysisFreshness: 'fresh',
    };

    // (1) Invoke the actual production handler.
    const handler = createExplainResultsHandler();
    const handlerOutcome = await handler(invocation);
    expect(handlerOutcome.assistant_text.length).toBeGreaterThan(80);
    expect(handlerOutcome.handler_facts).toHaveLength(1);
    const fact = handlerOutcome.handler_facts[0]!;
    expect(fact.fact_type).toBe('explain_results');
    // Production fact shape: noop=true, precondition_unmet=false on
    // success — the discriminator the Wave 5a chip predicate gates on.
    expect(fact.noop).toBe(true);
    expect((fact as { result?: { precondition_unmet?: unknown } }).result?.precondition_unmet).toBe(false);

    // (2) Run chip-generator over the produced facts.
    const chips = generateChips({
      stage: 'analyse',
      handlerFacts: handlerOutcome.handler_facts,
      analysis: null,
      validationRegistry: HANDLER_VALIDATION_REGISTRY,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0]?.action_type).toBe('what_would_flip');

    // (3) Build the response chip-generator's caller would emit.
    const explainResponse = {
      text: handlerOutcome.assistant_text,
      assistant_text: handlerOutcome.assistant_text,
      suggested_actions: chips,
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
