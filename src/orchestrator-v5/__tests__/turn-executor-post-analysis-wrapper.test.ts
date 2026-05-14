/**
 * V5 Phase 2 workstream A — TurnExecutor integration test for the
 * post-analysis coaching wrapper.
 *
 * Drives `runTurnExecutor` end-to-end with a mocked session store, a
 * routing adapter that emits a text-only direct answer, and a prior
 * `run_analysis` fact carrying review_cards in enrichment. Asserts the
 * wiring at turn-executor.ts:1480-1540 actually injects wrapper chips
 * into the response and emits the recovery telemetry — coverage the
 * pure helper tests cannot provide on their own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TURN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ANALYSE_PAYLOAD = makeMessagePayload({
  turn_id: TURN_ID,
  scenario_id: SCENARIO_ID,
  // V5 P0 stabilisation: the post-analysis advice gate now short-
  // circuits messages like "What should I do?" to a deterministic
  // direct_answer when prior analysis exists. The wrapper test
  // exercises the LLM-call path that follows when the user asks a
  // non-advice post-analysis question — use a phrasing that bypasses
  // the advice gate.
  message: 'Tell me more about the analysis result.',
  turn_class: 'decide',
  stage: 'analyse',
});

const FRAME_PAYLOAD = makeMessagePayload({
  turn_id: TURN_ID,
  scenario_id: SCENARIO_ID,
  message: 'Tell me about my decision.',
  turn_class: 'frame',
  stage: 'frame',
});

let mockedPriorFacts: HandlerFact[] = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [
      // Production-shape `SessionTurn`: every field the
      // `ContextPackConversationTurnSchema` projection reads is
      // populated. Real Supabase rows always carry these — partial
      // shapes here would mask schema regressions in the assembler's
      // non-prod runtime gate.
      {
        id: 'mock-prior-handler-row',
        scenario_id: SCENARIO_ID,
        user_id: null,
        turn_id: 'prior-turn',
        turn_class: 'handler',
        handler_id: 'run_analysis',
        request_hash: 'sha256:mock-prior',
        response_emitted: true,
        llm_calls_used: 1,
        duration_ms: 100,
        created_at: '2026-04-17T11:00:00.000Z',
      },
    ],
    readFactsFor: async () => mockedPriorFacts,
    // Production parity: `SupabaseSessionStore.readFactsFor` delegates to
    // `readFactsWithTurnFor` (single source of truth). When this mock
    // omitted the with-turn variant, `build-turn-context.fetchPriorFacts`
    // hit the legacy fallback that produces an empty `factsWithTurn` array
    // and silently disables the proposed-change synthesis idempotency
    // lookback. Mirror production by emitting one entry per fact, bound
    // to the prior turn's row id and atomic-write timestamp.
    readFactsWithTurnFor: async () =>
      mockedPriorFacts.map((fact) => ({
        fact,
        turn_id: 'mock-prior-handler-row',
        fact_created_at: '2026-04-17T11:00:00.000Z',
      })),
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
  }),
  resetSessionStoreForTests: () => {},
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const baseGraph: GraphStateIngress = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: { value: 100 } },
    { id: 'opt_a', kind: 'option', label: 'A' },
    { id: 'opt_b', kind: 'option', label: 'B' },
  ],
  edges: [
    { from: 'budget', to: 'goal', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
  options: [
    { id: 'opt_a', status: 'ready', interventions: { budget: { value: 100, target_match: { node_id: 'budget' } } } },
    { id: 'opt_b', status: 'ready', interventions: { budget: { value: 50, target_match: { node_id: 'budget' } } } },
  ],
  goal_node_id: 'goal',
} as unknown as GraphStateIngress;

function mkTextResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 5,
  };
}

function textOnlyAdapter(text: string) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkTextResult(text)),
  };
}

function buildFreshRunAnalysisFact(graphHashAtRun: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      win_probabilities: { 'A': 0.62, 'B': 0.38 },
      enrichment: {
        analysis_status: 'computed',
        review_cards: [
          {
            card_id: 'rc_evidence_cost',
            card_type: 'evidence_priority',
            items: [
              {
                node_id: 'budget',
                factor_label: 'Budget',
                suggested_evidence: 'Find published 2024 budget benchmarks.',
              },
            ],
          },
        ],
      },
      graph_hash_at_run: graphHashAtRun,
      computed_at: '2026-04-30T12:00:00.000Z',
    },
  } as HandlerFact;
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  mockedPriorFacts = [];
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

function recoveredEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.post_analysis.direct_answer_recovered');
}

describe('TurnExecutor → post-analysis coaching wrapper integration', () => {
  it('analyse-stage text-only direct_answer with fresh run_analysis fact → wrapper injects chip + telemetry', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const expectedHash = computeAnalysisAffectingGraphHash(baseGraph)!;
    mockedPriorFacts = [buildFreshRunAnalysisFact(expectedHash)];

    const adapter = textOnlyAdapter(
      'Given the analysis, the best next step depends on your priorities.',
    );

    const result = await runTurnExecutor(ANALYSE_PAYLOAD, 'req-int-fresh', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    // Wire-level assertions: the wrapper's chip rode all the way through
    // composeDirectAnswerResponse to the final response.
    expect(result.response.suggested_actions.length).toBeGreaterThanOrEqual(1);
    const wrapperChip = result.response.suggested_actions.find(
      (a) => a.label === 'Add evidence',
    );
    expect(wrapperChip).toBeDefined();
    expect(wrapperChip!.message).toBe('Find published 2024 budget benchmarks.');

    // Recovery telemetry fired with the fact-equivalent payload (no
    // persisted HandlerFact — see post-analysis-wrapper.ts P0 note).
    const ev = recoveredEvent();
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({
      session_id: SCENARIO_ID,
      freshness_at_response: 'fresh',
      selected_review_card_ids: ['rc_evidence_cost'],
    });
    expect(ev!.data.answer_text_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('frame-stage text-only direct_answer → wrapper does NOT fire (silent skip)', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const expectedHash = computeAnalysisAffectingGraphHash(baseGraph)!;
    mockedPriorFacts = [buildFreshRunAnalysisFact(expectedHash)];

    const adapter = textOnlyAdapter('Tell me more about your decision context.');

    const result = await runTurnExecutor(FRAME_PAYLOAD, 'req-int-frame', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    // Frame-stage chips are NOT the wrapper's chips. The wrapper-specific
    // "Add evidence" label must not appear; the existing chip generator
    // can still emit its own frame-stage chips.
    const wrapperChip = result.response.suggested_actions.find(
      (a) => a.label === 'Add evidence',
    );
    expect(wrapperChip).toBeUndefined();
    expect(recoveredEvent()).toBeUndefined();

    // Silent skip — no diagnostic telemetry from the non-trigger path.
    const skippedEvents = events.filter(
      (e) => e.event === 'v5.post_analysis.direct_answer_recovery_skipped',
    );
    expect(skippedEvents).toHaveLength(0);
  });

  it('analyse stage with stale graph (hash mismatch) → wrapper injects single rerun chip', async () => {
    mockedPriorFacts = [buildFreshRunAnalysisFact('stale_hash_no_match')];

    const adapter = textOnlyAdapter(
      'The analysis result is now out of date because the graph changed.',
    );

    const result = await runTurnExecutor(ANALYSE_PAYLOAD, 'req-int-stale', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    const rerunChip = result.response.suggested_actions.find(
      (a) => a.action_type === 'run_analysis',
    );
    expect(rerunChip).toBeDefined();
    expect(rerunChip!.label).toBe('Run analysis');

    // Rerun-only path does not emit Recovered telemetry (chips fired but
    // no review-card mining took place).
    expect(recoveredEvent()).toBeUndefined();
  });

  it('analyse stage with NO prior run_analysis fact → silent skip (freshness=none)', async () => {
    mockedPriorFacts = []; // no prior fact → freshness derives to 'none'

    const adapter = textOnlyAdapter('Some pre-analysis coaching prose.');

    await runTurnExecutor(ANALYSE_PAYLOAD, 'req-int-no-fact', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    expect(recoveredEvent()).toBeUndefined();
    // freshness='none' precedes the no_run_fact branch → silent skip.
    // Per the telemetry-noise policy, the wrapper does NOT emit a
    // diagnostic event for the (very common) "no prior analysis yet"
    // path — every analyse-stage turn before the first run_analysis
    // would otherwise spam the event stream.
    const skippedEvents = events.filter(
      (e) => e.event === 'v5.post_analysis.direct_answer_recovery_skipped',
    );
    expect(skippedEvents).toHaveLength(0);
  });

  // V5 P0 review-P1: executor-level coverage for the post-analysis
  // advice gate. Reuses this file's fresh-run_analysis fixture (the
  // wrapper test infrastructure builds exactly what the advice gate
  // requires: prior_facts → freshness='fresh' → leading_option).
  it('post-analysis advice question with fresh run_analysis fact → advice gate short-circuits, zero LLM calls, no edit_graph dispatch', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const expectedHash = computeAnalysisAffectingGraphHash(baseGraph)!;
    mockedPriorFacts = [buildFreshRunAnalysisFact(expectedHash)];

    const adviceAdapterCall = vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(mkTextResult('UNREACHABLE — gate should have short-circuited.'));
    const adapter = { chatWithTools: adviceAdapterCall };

    const advicePayload = {
      ...ANALYSE_PAYLOAD,
      message: 'How do you recommend we update the decision based on this?',
    };

    const result = await runTurnExecutor(advicePayload, 'req-advice-gate', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    // The adapter must not be called: the gate short-circuits before
    // routeWithToolUse.
    expect(adviceAdapterCall).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.telemetry.failure_type).toBeNull();

    // Deterministic prose contract: leading option label appears,
    // gate's "currently ahead" framing fires, no forbidden wording,
    // no raw IDs, no decimals. The composer's top-driver branch is
    // covered exhaustively at the unit-test level (FIXTURE_ANALYSIS
    // there carries explicit top_drivers); this executor fixture
    // exercises the no-driver fallback prose path because the
    // run_analysis fact builder doesn't carry factor_sensitivity —
    // both prose branches end in "currently ahead", so the assertion
    // holds regardless of which fires.
    expect(result.response.assistant_text).toContain('A');
    expect(result.response.assistant_text).toContain('currently ahead');
    expect(result.response.assistant_text.toLowerCase()).not.toContain('recommendation');
    expect(result.response.assistant_text).not.toMatch(/\d+\.\d+/);
    // No canonical edit_graph no-op denial.
    expect(result.response.assistant_text).not.toContain("I couldn't see a concrete change");

    // Telemetry signals: gate fired, bounded-fallback did NOT fire
    // (this is the happy path, not a routing failure).
    const adviceEv = events.find((e) => e.event === 'v5.post_analysis_advice_gate');
    expect(adviceEv).toBeDefined();
    expect(adviceEv!.data.matched).toBe(true);
    expect(adviceEv!.data.leading_option_present).toBe(true);
    expect(
      events.find((e) => e.event === 'v5.routing_bounded_fallback'),
    ).toBeUndefined();
  });

  // V5 P0 review-P1 stale-safety: an advice question after a graph
  // edit that invalidates the cached analysis must NOT short-circuit
  // through the gate. The gate falls through, normal routing handles
  // staleness.
  it('post-analysis advice question with STALE run_analysis fact → advice gate does NOT short-circuit', async () => {
    // Mismatched hash → freshness derives to 'stale' (or similar
    // non-'fresh' verdict), which gates out.
    mockedPriorFacts = [buildFreshRunAnalysisFact('stale_hash_no_match')];

    const fallbackText = 'The analysis result is now out of date.';
    const adapter = textOnlyAdapter(fallbackText);

    const advicePayload = {
      ...ANALYSE_PAYLOAD,
      message: 'How do you recommend we update the decision based on this?',
    };

    const result = await runTurnExecutor(advicePayload, 'req-advice-gate-stale', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    // The adapter WAS called: the gate fell through.
    expect(adapter.chatWithTools).toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBeGreaterThan(0);

    const adviceEv = events.find((e) => e.event === 'v5.post_analysis_advice_gate');
    expect(adviceEv).toBeDefined();
    expect(adviceEv!.data.matched).toBe(false);
    expect(adviceEv!.data.unmatched_reason).toBe('not_fresh');
  });

  // V5 P0 second-round review-P1: bounded routing-failure fallback
  // must also be freshness-aware. After a graph edit invalidates the
  // cached analysis, a routing failure (e.g. max_tokens) must NOT
  // reassure the user with "your current analysis is still available"
  // or surface an Explain results chip — both would deepen the trust
  // hit by pointing at projections that no longer match the live
  // graph. Asserts the stale-safe branch: stale-aware copy, single
  // Re-run analysis chip, telemetry records the freshness verdict.
  it('max_tokens fallback with STALE prior analysis → stale-safe copy + Re-run chip only (no Explain)', async () => {
    // Mismatched hash → freshness derives to stale/non-fresh.
    mockedPriorFacts = [buildFreshRunAnalysisFact('stale_hash_no_match')];

    const adapterMock = vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Partial answer cut off at...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 2048 } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 200,
      });
    const adapter = { chatWithTools: adapterMock };

    const advicePayload = {
      ...ANALYSE_PAYLOAD,
      // Use a non-advice message so the advice gate never matches and
      // the turn actually reaches routing (where the max_tokens
      // failure fires the bounded fallback).
      message: 'Tell me more about how the analysis was constructed.',
    };

    const result = await runTurnExecutor(advicePayload, 'req-fallback-stale', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    expect(adapterMock).toHaveBeenCalledTimes(1);
    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.telemetry.failure_type).toBe('LLM_UNAVAILABLE');

    // Stale-safe copy: must NOT promise the current analysis is
    // still available; must name the staleness.
    expect(result.response.assistant_text).not.toContain(
      'your current analysis is still available',
    );
    expect(result.response.assistant_text).toContain(
      'model has changed since the last analysis',
    );
    // No raw decimals or forbidden wording.
    expect(result.response.assistant_text).not.toMatch(/\d+\.\d+/);
    expect(result.response.assistant_text.toLowerCase()).not.toContain('recommendation');

    // Chip set: exactly one chip = Re-run analysis. NO Explain
    // results chip (would deepen the trust hit on stale projections).
    expect(result.response.suggested_actions).toHaveLength(1);
    expect(result.response.suggested_actions[0]?.action_type).toBe('run_analysis');
    expect(
      result.response.suggested_actions.some(
        (c) => c.action_type === 'explain_results',
      ),
    ).toBe(false);

    // Telemetry: bounded-fallback fired with the freshness verdict
    // recorded; analysis_ready=false because the stale state must
    // not be claimed as ready.
    const bf = events.find((e) => e.event === 'v5.routing_bounded_fallback');
    expect(bf).toBeDefined();
    expect(bf!.data.routing_error_cause).toBe('unexpected_stop_reason');
    expect(bf!.data.analysis_ready).toBe(false);
    expect(typeof bf!.data.analysis_freshness).toBe('string');
    expect(bf!.data.analysis_freshness).not.toBe('fresh');
  });

  // V5 P0 second-round review-P1: bounded routing-failure fallback
  // with FRESH prior analysis — sanity check on the happy
  // freshness-aware branch (Explain results + Re-run analysis both
  // emitted, "current analysis is still available" copy fires).
  it('max_tokens fallback with FRESH prior analysis → Explain + Re-run chips, reassuring copy', async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
    const expectedHash = computeAnalysisAffectingGraphHash(baseGraph)!;
    mockedPriorFacts = [buildFreshRunAnalysisFact(expectedHash)];

    const adapterMock = vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Partial answer cut off at...' }],
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 2048 } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 200,
      });
    const adapter = { chatWithTools: adapterMock };

    const advicePayload = {
      ...ANALYSE_PAYLOAD,
      message: 'Tell me more about how the analysis was constructed.',
    };

    const result = await runTurnExecutor(advicePayload, 'req-fallback-fresh', {
      routingAdapter: adapter,
      graphState: baseGraph,
    });

    expect(result.response.assistant_text).toContain('your current analysis is still available');
    const actionTypes = result.response.suggested_actions.map((c) => c.action_type);
    expect(actionTypes).toEqual(
      expect.arrayContaining(['explain_results', 'run_analysis']),
    );

    const bf = events.find((e) => e.event === 'v5.routing_bounded_fallback');
    expect(bf).toBeDefined();
    expect(bf!.data.analysis_ready).toBe(true);
    expect(bf!.data.analysis_freshness).toBe('fresh');
  });
});
