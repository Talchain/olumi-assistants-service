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
  message: 'What should I do?',
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
});
