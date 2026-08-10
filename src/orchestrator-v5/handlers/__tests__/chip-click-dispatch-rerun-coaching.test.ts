/**
 * ROADMAP 2.73 — chip-click run_analysis coaching + decision_review
 * observability.
 *
 * Fix A: the chip dispatch previously composed `coaching: null` hardcoded,
 * so a chip-driven run (first OR rerun) shipped zero STEP-5 coaching prose
 * by construction. It now invokes the SAME `applyCoachingSignal` helper
 * the turn-executor uses:
 *   - first chip run  → FIRST_ANALYSIS_COMPLETE text joins assistant_text
 *   - chip rerun      → RERUN_ANALYSIS_COMPLETE text joins assistant_text,
 *                       and the committed run_analysis fact carries the
 *                       signal marker in its enrichment.
 *
 * Fix C: when the timings/trace gate is on and the decision_review LLM
 * call RETURNS, the dispatch result carries `turnTimings` with the
 * decision_review attribution (#476 parity); a call that never returned
 * produces NO entry (no phantom attribution).
 *
 * Harness mirrors chip-click-dispatch-analysis-ready.test.ts (registry +
 * commit + enricher mocked at their module seams; the coaching helper and
 * composer run REAL).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import type { RunAnalysisScenarioSnapshot } from '../../tools/handlers/run-analysis.js';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  handlerFnMock,
  createRegistryMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  handlerFnMock: vi.fn(),
  createRegistryMock: vi.fn(),
}));

// Mutable holder so tests can vary the stubbed context's prior_facts
// (the rerun discriminator) without re-mocking the module.
const buildTurnContextStub: {
  priorFacts: unknown[];
  scenarioBriefText: string | null;
} = { priorFacts: [], scenarioBriefText: null };

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: vi.fn(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: false,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run the analysis' }],
      session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      request_id: 'req-test',
      budgets: {
        turn_ms: 30000,
        handler_ms: 20000,
        plot_ms: 15000,
        anthropic_ms: 15000,
        openai_ms: 15000,
      },
      prior_turns: [],
      prior_facts: buildTurnContextStub.priorFacts,
      scenarioBriefText: buildTurnContextStub.scenarioBriefText,
      persistedGraph: null,
    })),
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: createRegistryMock,
    getDefaultRegistry: () => new Map([['run_analysis', handlerFnMock]]),
    resolveHandler: (_registry: unknown, id: string) =>
      id === 'run_analysis' ? handlerFnMock : undefined,
  };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

// Minimal schema-valid graph so the snapshot pre-load path resolves.
const READY_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_marketing', kind: 'factor', label: 'Marketing spend' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
  ],
  edges: [
    { from: 'dec_launch', to: 'opt_launch', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_launch', to: 'opt_status_quo', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_launch', to: 'fac_marketing', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_status_quo', to: 'fac_marketing', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_marketing', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

function snapshot(): RunAnalysisScenarioSnapshot {
  return {
    graph: READY_GRAPH,
    options: [
      { id: 'opt_launch', option_id: 'opt_launch', label: 'Launch now', interventions: { fac_marketing: 0.7 } },
      { id: 'opt_status_quo', option_id: 'opt_status_quo', label: 'Status quo', interventions: { fac_marketing: 0.3 } },
    ],
    goal_node_id: 'goal_revenue',
    rawPersistedGraph: READY_GRAPH,
  };
}

function runEnvelope(): Record<string, unknown> {
  return {
    analysis_status: 'completed',
    results: [
      { option_id: 'opt_launch', option_label: 'Launch now', win_probability: 0.62, factor_sensitivity: [] },
      { option_id: 'opt_status_quo', option_label: 'Status quo', win_probability: 0.38, factor_sensitivity: [] },
    ],
  };
}

function handlerOutcome() {
  return {
    assistant_text: 'Launch now came out ahead in 62% of runs of this model.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_launch',
          summary: 'Analysis ran with two options compared.',
          enrichment: runEnvelope(),
          // ROADMAP 2.804 — now LOAD-BEARING. The coaching slot's leader-claim
          // permission comes from the fact chain, which fails CLOSED on a fact
          // with no verdict stamp (the pre-#710 population). An unstamped
          // fixture no longer models a current production turn: `run_analysis`
          // stamps every fact it writes. Exact shape of `projectClaimSafety`.
          constraint_verdict: {
            may_name_leading_option: true,
            constraint_verdict_state: 'not_applicable',
          },
        },
      },
    ],
    llm_calls_used: 0,
  };
}

function priorRunFact(): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_launch',
      summary: 'prior run',
      enrichment: runEnvelope(),
      computed_at: '2026-07-15T00:00:00.000Z',
      graph_hash_at_run: 'hash-prior',
      // ROADMAP 2.804 — stamped for the same reason as the current-turn fact
      // above. This one matters twice over: it is the fact
      // `selectRunAnalysisFact` picks as the DISPLAYED analysis, and an
      // unstamped displayed analysis withholds the leader for the whole turn.
      constraint_verdict: {
        may_name_leading_option: true,
        constraint_verdict_state: 'not_applicable',
      },
    },
  } as unknown as HandlerFact;
}

beforeEach(() => {
  vi.clearAllMocks();
  buildTurnContextStub.priorFacts = [];
  buildTurnContextStub.scenarioBriefText = null;
  loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue(snapshot());
  createRegistryMock.mockImplementation(() => new Map([['run_analysis', handlerFnMock]]));
  handlerFnMock.mockResolvedValue(handlerOutcome());
  enrichRunAnalysisMock.mockImplementation(
    async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
  );
  commitDirectAnswerMock.mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  });
});

describe('chip-click run_analysis — STEP-5 coaching (ROADMAP 2.73 Fix A)', () => {
  it('FIRST chip run: FIRST_ANALYSIS_COMPLETE text joins assistant_text (was coaching: null hardcoded)', async () => {
    buildTurnContextStub.priorFacts = [];

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-first',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.response.assistant_text).toContain('first analysis');
  });

  it('chip RERUN: RERUN_ANALYSIS_COMPLETE text joins assistant_text and names the unchanged leader', async () => {
    buildTurnContextStub.priorFacts = [priorRunFact()];

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-rerun',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    // Same envelope both runs → unchanged leader copy from compareRuns.
    expect(out.response.assistant_text).toContain('unchanged');
    expect(out.response.assistant_text).toContain('Launch now still leads');
    // And the rerun turn must NOT claim to be the first analysis.
    expect(out.response.assistant_text).not.toContain('first analysis');
  });

  it('chip RERUN: committed run_analysis fact carries the signal marker (cache-reader visibility)', async () => {
    buildTurnContextStub.priorFacts = [priorRunFact()];

    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-rerun-fact',
    });

    expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
    const committed = commitDirectAnswerMock.mock.calls[0]![1] as {
      handler_facts: Array<{ result: { enrichment?: Record<string, unknown> } }>;
    };
    expect(committed.handler_facts[0]!.result.enrichment?.coaching_signal_id).toBe(
      'RERUN_ANALYSIS_COMPLETE',
    );
    expect(committed.handler_facts[0]!.result.enrichment?.coaching_signal_turn_id).toBe(
      'req-cc-rerun-fact',
    );
  });
});

describe('chip-click run_analysis — decision_review observability (ROADMAP 2.73 Fix C)', () => {
  let priorAwaitFlag: string | undefined;
  let priorTraceFlag: string | undefined;

  beforeEach(async () => {
    priorAwaitFlag = process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    priorTraceFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = 'true';
    process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true';
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  afterEach(async () => {
    if (priorAwaitFlag === undefined) delete process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW;
    else process.env.V5_RUN_ANALYSIS_AWAIT_DECISION_REVIEW = priorAwaitFlag;
    if (priorTraceFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
    else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = priorTraceFlag;
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  });

  it('threads decision_review attribution into turnTimings when the enricher call RETURNS (#476 parity)', async () => {
    enrichRunAnalysisMock.mockImplementation(
      async ({
        handlerFacts,
        callTelemetrySink,
      }: {
        handlerFacts: unknown[];
        callTelemetrySink?: {
          model?: string;
          provider?: string;
          input_tokens?: number;
          output_tokens?: number;
        };
      }) => {
        if (callTelemetrySink) {
          callTelemetrySink.model = 'gpt-4.1';
          callTelemetrySink.provider = 'openai';
          callTelemetrySink.input_tokens = 1200;
          callTelemetrySink.output_tokens = 800;
        }
        return handlerFacts;
      },
    );

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-dr-telemetry',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.turnTimings).toBeDefined();
    expect(out.turnTimings!.decision_review_model).toBe('gpt-4.1');
    expect(out.turnTimings!.decision_review_provider).toBe('openai');
    expect(out.turnTimings!.decision_review_input_tokens).toBe(1200);
    expect(out.turnTimings!.decision_review_output_tokens).toBe(800);
    expect(typeof out.turnTimings!.decision_review_ms).toBe('number');
    // The sink must actually have been OFFERED to the enricher.
    const call = enrichRunAnalysisMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.callTelemetrySink).toBeDefined();
  });

  it('emits NO turnTimings when the enricher call never returned a result (no phantom attribution)', async () => {
    // Sink left unpopulated — models a skip / timeout inside the enricher.
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-cc-dr-skip',
    });

    if (out.outcome !== 'ok') throw new Error(`expected ok, got ${out.outcome}`);
    expect(out.turnTimings).toBeUndefined();
  });
});
